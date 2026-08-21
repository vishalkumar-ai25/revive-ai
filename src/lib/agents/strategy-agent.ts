// =============================================================================
// STRATEGY AGENT
// =============================================================================
// Given a diagnosis and risk assessment, selects the optimal recovery strategy
// and generates execution parameters (timing, channel, message content).
//
// Uses a weighted scoring algorithm across all available strategies, then
// selects the highest-scoring one that passes applicability checks.
//
// Strategies:
//   SMART_RETRY       — Schedule retry at optimal bank-specific time
//   CUSTOMER_NUDGE    — Send personalized recovery message via email/SMS
//   ALT_PAYMENT       — Suggest alternative payment method
//   ESCALATE_MERCHANT — Alert merchant for manual intervention
//   DO_NOTHING        — Log and close (fraud, opt-out, or below threshold)
// =============================================================================

import type { EscalationLevel, PaymentMethod, RecoveryStrategy } from "@prisma/client";
import {
  BANK_RETRY_WINDOWS,
  MANDATE_RULES,
  STRATEGY_WEIGHTS,
} from "@/lib/constants";
import {
  channelForLevel,
  currentEscalationLevel,
} from "@/lib/engine/escalation-ladder";
import type {
  DiagnosisResult,
  ExecutionParams,
  PaymentFailureEvent,
  RiskAssessmentResult,
  StrategyResult,
} from "@/lib/types";
import { type Clock, SystemClock } from "@/lib/time/clock";
import { MandateRetrySequencer } from "./mandate-sequencer";

// ---------------------------------------------------------------------------
// Alternative method mapping — what to suggest when a method fails
// ---------------------------------------------------------------------------

const ALT_METHOD_MAP: Partial<Record<PaymentMethod, PaymentMethod>> = {
  UPI: "DEBIT_CARD",
  DEBIT_CARD: "CREDIT_CARD",
  CREDIT_CARD: "UPI",
  NETBANKING: "UPI",
  WALLET: "UPI",
  MANDATE: "UPI",
};

// ---------------------------------------------------------------------------
// Strategy Agent
// ---------------------------------------------------------------------------

export class StrategyAgent {
  private clock: Clock;
  private mandateSequencer: MandateRetrySequencer;

  constructor(clock: Clock = new SystemClock()) {
    this.clock = clock;
    this.mandateSequencer = new MandateRetrySequencer(clock);
  }

  /**
   * Select the best recovery strategy for a failed payment.
   */
  select(
    event: PaymentFailureEvent,
    diagnosis: DiagnosisResult,
    riskAssessment: RiskAssessmentResult,
    hoursSinceFailure?: number,
  ): StrategyResult {
    const hours =
      hoursSinceFailure ??
      Math.max(
        0,
        (this.clock.now().getTime() - event.timestamp.getTime()) /
          (1000 * 60 * 60),
      );

    // If risk assessment says don't attempt, return DO_NOTHING
    if (!riskAssessment.shouldAttemptRecovery) {
      return {
        strategy: "DO_NOTHING",
        reasoning: `Recovery skipped: ${riskAssessment.reasoning}`,
        confidence: 0.95,
        executionParams: this.buildParams("DO_NOTHING", event, diagnosis, hours),
      };
    }

    // --- Recurring Mandate Route ---
    // If recurring payment with mandateId or mandate-expired error, route to MandateRetrySequencer
    if (
      event.isRecurring &&
      (Boolean(event.mandateId) || diagnosis.category === "MANDATE_EXPIRED")
    ) {
      // Determine attempts so far from hours if not provided
      let attemptsCount = 0;
      if (hours >= 144) attemptsCount = 3;
      else if (hours >= 96) attemptsCount = 2;
      else if (hours >= 48) attemptsCount = 1;
      else attemptsCount = 0;

      const mandateResult = this.mandateSequencer.evaluate(
        event,
        diagnosis,
        attemptsCount,
      );

      if (mandateResult.isExpiredMandate) {
        return {
          strategy: "ALT_PAYMENT",
          reasoning: mandateResult.reasoning,
          confidence: 0.85,
          executionParams: {
            scheduledAt: null,
            channel: "email",
            messageContent:
              "Your recurring payment mandate has expired or was revoked. Please re-authorize your payment method to continue your subscription.",
            maxRetries: 1,
            alternativeMethod: ALT_METHOD_MAP[event.method] ?? "UPI",
            escalationLevel: currentEscalationLevel(hours),
            mandateSchedule: null,
          },
        };
      }

      if (mandateResult.shouldRetry && mandateResult.schedule) {
        const schedule = mandateResult.schedule;
        const isCustomerFacing =
          schedule.strategy === "ALT_PAYMENT" ||
          schedule.strategy === "CUSTOMER_NUDGE";

        return {
          strategy: schedule.strategy,
          reasoning: mandateResult.reasoning,
          confidence: 0.9,
          executionParams: {
            scheduledAt: schedule.scheduledAt,
            channel: isCustomerFacing ? "email" : "onscreen",
            messageContent:
              schedule.strategy === "ALT_PAYMENT"
                ? `Mandate retry fallback: Please complete your subscription payment using ${schedule.rail === "ON_DEMAND_LINK" ? "a direct payment link" : schedule.rail}.`
                : null,
            maxRetries: MANDATE_RULES.MAX_ATTEMPTS,
            alternativeMethod:
              schedule.rail === "ON_DEMAND_LINK"
                ? (ALT_METHOD_MAP[event.method] ?? "UPI")
                : null,
            escalationLevel: currentEscalationLevel(hours),
            mandateSchedule: schedule,
          },
        };
      }

      if (!mandateResult.shouldRetry) {
        const strategy: RecoveryStrategy =
          mandateResult.terminationReason === "FRAUD_DETECTED"
            ? "DO_NOTHING"
            : "ESCALATE_MERCHANT";

        return {
          strategy,
          reasoning: mandateResult.reasoning,
          confidence: 0.95,
          executionParams: {
            scheduledAt: null,
            channel:
              strategy === "ESCALATE_MERCHANT"
                ? "merchant_dashboard"
                : null,
            messageContent:
              strategy === "ESCALATE_MERCHANT"
                ? `Mandate recovery halted (${mandateResult.terminationReason ?? "max attempts exceeded"}). Manual merchant intervention required.`
                : null,
            maxRetries: 0,
            alternativeMethod: null,
            escalationLevel:
              strategy === "ESCALATE_MERCHANT"
                ? ("LEVEL_4_MERCHANT_ALERT" as EscalationLevel)
                : ("LEVEL_5_DEAD" as EscalationLevel),
            mandateSchedule: null,
          },
        };
      }
    }

    // Score each strategy
    const scores = this.scoreStrategies(event, diagnosis, riskAssessment);

    // Select highest scoring applicable strategy
    const sorted = scores.sort((a, b) => b.score - a.score);
    const best = sorted[0];

    if (!best || best.score <= 0) {
      return {
        strategy: "DO_NOTHING",
        reasoning: "No applicable recovery strategy found.",
        confidence: 0.5,
        executionParams: this.buildParams("DO_NOTHING", event, diagnosis, hours),
      };
    }

    return {
      strategy: best.strategy,
      reasoning: best.reasoning,
      confidence: Math.round(best.score * 100) / 100,
      executionParams: this.buildParams(best.strategy, event, diagnosis, hours),
    };
  }

  // -------------------------------------------------------------------------
  // Strategy Scoring
  // -------------------------------------------------------------------------

  private scoreStrategies(
    event: PaymentFailureEvent,
    diagnosis: DiagnosisResult,
    riskAssessment: RiskAssessmentResult,
  ): Array<{ strategy: RecoveryStrategy; score: number; reasoning: string }> {
    const results: Array<{ strategy: RecoveryStrategy; score: number; reasoning: string }> = [];

    for (const [strategy, config] of Object.entries(STRATEGY_WEIGHTS)) {
      const typedStrategy = strategy as RecoveryStrategy;
      const isApplicable = config.applicableCategories.includes(diagnosis.category);

      if (!isApplicable) {
        results.push({
          strategy: typedStrategy,
          score: 0,
          reasoning: `${strategy} not applicable for ${diagnosis.category}`,
        });
        continue;
      }

      // Score = basePriority × recoveryProbability × category match bonus
      const score =
        config.basePriority *
        riskAssessment.recoveryProbability *
        (isApplicable ? 1.2 : 0.3);

      results.push({
        strategy: typedStrategy,
        score,
        reasoning: this.buildReasoning(typedStrategy, event, diagnosis, score),
      });
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Execution Parameter Generation
  // -------------------------------------------------------------------------

  private buildParams(
    strategy: RecoveryStrategy,
    event: PaymentFailureEvent,
    diagnosis: DiagnosisResult,
    hoursSinceFailure: number = 0,
  ): ExecutionParams {
    const base: ExecutionParams = {
      scheduledAt: null,
      channel: null,
      messageContent: null,
      maxRetries: 1,
      alternativeMethod: null,
      escalationLevel: "LEVEL_1_ONSCREEN" as EscalationLevel,
    };

    switch (strategy) {
      case "SMART_RETRY":
        return {
          ...base,
          scheduledAt: this.calculateOptimalRetryTime(event),
          channel: "onscreen",
          maxRetries: 3,
          messageContent: `Your payment of ₹${event.amount} didn't go through. We'll retry at a better time.`,
        };

      case "CUSTOMER_NUDGE": {
        // Nudge escalation: <24h -> LEVEL_2_EMAIL ("email"), >=24h -> LEVEL_3_SMS ("sms")
        const effectiveHours = Math.max(1, hoursSinceFailure);
        const escalationLevel = currentEscalationLevel(effectiveHours);
        const channelStr = channelForLevel(escalationLevel);
        const channel = (channelStr === "none" ? null : channelStr) as
          | "email"
          | "sms"
          | "onscreen"
          | "merchant_dashboard"
          | null;

        return {
          ...base,
          scheduledAt: this.calculateNudgeTime(),
          channel,
          escalationLevel,
          messageContent: this.generateNudgeMessage(event, diagnosis),
          maxRetries: 1,
        };
      }

      case "ALT_PAYMENT":
        return {
          ...base,
          channel: "onscreen",
          alternativeMethod: ALT_METHOD_MAP[event.method] ?? "UPI",
          messageContent: `Your ${event.method} payment didn't go through. Try paying with ${ALT_METHOD_MAP[event.method] ?? "UPI"} instead.`,
          maxRetries: 1,
        };

      case "ESCALATE_MERCHANT":
        return {
          ...base,
          channel: "merchant_dashboard",
          escalationLevel: "LEVEL_4_MERCHANT_ALERT" as EscalationLevel,
          messageContent: `High-value recovery opportunity: Customer attempted ₹${event.amount} payment ${event.isRecurring ? "(recurring)" : ""} — failed due to ${diagnosis.rootCause}. Manual follow-up recommended.`,
          maxRetries: 0,
        };

      case "DO_NOTHING":
      default:
        return {
          ...base,
          escalationLevel: "LEVEL_5_DEAD" as EscalationLevel,
        };
    }
  }

  // -------------------------------------------------------------------------
  // Timing Calculations
  // -------------------------------------------------------------------------

  /** Calculate the optimal retry time based on bank-specific success windows. */
  private calculateOptimalRetryTime(event: PaymentFailureEvent): Date {
    const bank = event.bank ?? "DEFAULT";
    const window = BANK_RETRY_WINDOWS[bank] ?? BANK_RETRY_WINDOWS["DEFAULT"]!;

    const now = this.clock.now();
    const retryDate = new Date(now);

    // If current hour is in the avoid window or before best window, schedule for next best window
    const currentHour = now.getHours();
    if (
      window.avoidHours.includes(currentHour) ||
      currentHour < window.bestHourStart ||
      currentHour > window.bestHourEnd
    ) {
      // Schedule for the middle of the best window tomorrow
      retryDate.setDate(retryDate.getDate() + (currentHour > window.bestHourEnd ? 1 : 0));
      retryDate.setHours(
        Math.floor((window.bestHourStart + window.bestHourEnd) / 2),
        15,
        0,
        0,
      );
    } else {
      // We're in the good window — retry in 30 minutes
      retryDate.setMinutes(retryDate.getMinutes() + 30);
    }

    return retryDate;
  }

  /** Calculate nudge time — 2 hours from now, but respect quiet hours. */
  private calculateNudgeTime(): Date {
    const nudge = this.clock.now();
    nudge.setHours(nudge.getHours() + 2);

    // If nudge would land in quiet hours (9PM-9AM), push to 9AM
    const nudgeHour = nudge.getHours();
    if (nudgeHour >= 21 || nudgeHour < 9) {
      nudge.setDate(nudge.getDate() + (nudgeHour >= 21 ? 1 : 0));
      nudge.setHours(9, 0, 0, 0);
    }

    return nudge;
  }

  // -------------------------------------------------------------------------
  // Message Generation
  // -------------------------------------------------------------------------

  private generateNudgeMessage(
    event: PaymentFailureEvent,
    diagnosis: DiagnosisResult,
  ): string {
    if (diagnosis.category === "CHECKOUT_ABANDONED") {
      return `Hi! You left items worth ₹${event.amount} in your cart. Your order is still saved — complete your purchase before it expires!`;
    }

    if (diagnosis.category === "SUBSCRIPTION_FAILED") {
      return `Your subscription payment of ₹${event.amount} didn't go through. Update your payment method to keep your subscription active.`;
    }

    return `Your payment of ₹${event.amount} couldn't be completed. Tap below to try again — it only takes a moment.`;
  }

  // -------------------------------------------------------------------------
  // Reasoning
  // -------------------------------------------------------------------------

  private buildReasoning(
    strategy: RecoveryStrategy,
    event: PaymentFailureEvent,
    diagnosis: DiagnosisResult,
    score: number,
  ): string {
    const reasons: Record<RecoveryStrategy, string> = {
      SMART_RETRY: `${diagnosis.category} is a transient failure. Scheduling retry at optimal time for ${event.bank ?? "bank"}.`,
      CUSTOMER_NUDGE: `Customer action needed. Sending personalized recovery message via email.`,
      ALT_PAYMENT: `${event.method} failed — suggesting ${ALT_METHOD_MAP[event.method] ?? "alternative"} as fallback.`,
      ESCALATE_MERCHANT: `Multiple signals suggest manual intervention needed. Alerting merchant dashboard.`,
      DO_NOTHING: `Recovery not warranted. Logging and closing.`,
    };

    return `${reasons[strategy]} (score: ${(score * 100).toFixed(0)}%)`;
  }
}
