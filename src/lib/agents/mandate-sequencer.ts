// =============================================================================
// MANDATE RETRY SEQUENCER — Task 3.2c
// =============================================================================
// Deterministic agent for recurring e-mandate and auto-debit recovery.
//
// Operational Policy (ReviveAI Mandate Policy):
//   1. 4-Attempt Retry Cap: Maximum 4 debit attempts per recurring cycle to
//      prevent excessive bank fees and customer friction.
//   2. Salary-Cycle Spacing: Attempt 2 spaced at T+48h to align with bank
//      clearing and salary deposit windows.
//   3. Optimal Bank Windows: Attempts scheduled at 10:15 AM IST for high-traffic
//      clearing banks (HDFC, SBI, ICICI).
//   4. Automatic Rail Switching: UPI Autopay -> e-NACH -> Card / On-Demand link.
//   5. 24h Pre-Debit Notification: Every debit attempt is preceded by a
//      pre-debit notification (recorded in `preDebitNotificationSentAt`).
//   6. 168-Hour Window: Hard stop at 7 days (168h); unrecovered mandates
//      escalate to merchant.
//   7. Expired/Revoked Mandates: Halted immediately from auto-debit; routed to
//      customer re-authorization workflow.
//
// NOTE: Limits and schedules represent ReviveAI's self-imposed retry policy,
// informed by e-mandate industry practice and regulatory summaries.
// =============================================================================

import type { PaymentMethod, RecoveryAttempt, RecoveryStrategy } from "@prisma/client";
import { MANDATE_RULES } from "@/lib/constants";
import type {
  DiagnosisResult,
  MandatePaymentRail,
  MandateRetrySchedule,
  MandateSequencerResult,
  PaymentFailureEvent,
} from "@/lib/types";
import { type Clock, SystemClock } from "@/lib/time/clock";

export class MandateRetrySequencer {
  private clock: Clock;

  constructor(clock: Clock = new SystemClock()) {
    this.clock = clock;
  }

  /**
   * Evaluate a mandate failure and generate the next retry schedule or termination decision.
   *
   * @param event The failed payment event (recurring / mandate context)
   * @param diagnosis Root cause diagnosis from DiagnosisAgent
   * @param attemptsSoFar Previous attempts array or count of executed attempts
   */
  evaluate(
    event: PaymentFailureEvent,
    diagnosis: DiagnosisResult,
    attemptsSoFar:
      | number
      | Pick<RecoveryAttempt, "attemptNumber" | "strategy" | "outcome">[] = 0,
  ): MandateSequencerResult {
    // 1. Guard against fraud
    if (
      diagnosis.category === "FRAUD_BLOCK" ||
      event.errorCode === "FRAUD_DETECTED"
    ) {
      return {
        shouldRetry: false,
        isExpiredMandate: false,
        schedule: null,
        reasoning:
          "Fraud block detected on recurring mandate debit. Auto-debit retry is strictly prohibited.",
        terminationReason: "FRAUD_DETECTED",
      };
    }

    // 2. Guard against expired or revoked mandates (re-auth required, no auto-debit)
    if (
      diagnosis.category === "MANDATE_EXPIRED" ||
      event.errorCode === "MANDATE_EXPIRED" ||
      event.errorCode === "MANDATE_REVOKED"
    ) {
      return {
        shouldRetry: false,
        isExpiredMandate: true,
        schedule: null,
        reasoning:
          "Auto-debit mandate has expired or was revoked by customer. Auto-debit retries are halted on invalid token. Initiating customer re-authorization workflow.",
        terminationReason: "MANDATE_EXPIRED",
      };
    }

    // 3. Count executed attempts
    const executedCount =
      typeof attemptsSoFar === "number"
        ? attemptsSoFar
        : attemptsSoFar.filter(
            (a) => a.outcome === "FAILED" || a.outcome === "SUCCESS",
          ).length;

    // 4. Check maximum attempt limit (4 attempts max)
    if (executedCount >= MANDATE_RULES.MAX_ATTEMPTS) {
      return {
        shouldRetry: false,
        isExpiredMandate: false,
        schedule: null,
        reasoning: `Maximum ${MANDATE_RULES.MAX_ATTEMPTS} mandate debit attempts exhausted. Halting auto-debit retries to prevent bank charges and escalating to merchant.`,
        terminationReason: "MAX_ATTEMPTS_EXCEEDED",
      };
    }

    // 5. Check 168-hour (7-day) mandate recovery window
    const hoursSinceFailure =
      (this.clock.now().getTime() - event.timestamp.getTime()) / (1000 * 60 * 60);

    if (hoursSinceFailure > MANDATE_RULES.WINDOW_HOURS) {
      return {
        shouldRetry: false,
        isExpiredMandate: false,
        schedule: null,
        reasoning: `Mandate recovery window of ${MANDATE_RULES.WINDOW_HOURS}h has expired (${hoursSinceFailure.toFixed(1)}h elapsed). Halting retries per ReviveAI mandate policy.`,
        terminationReason: "MANDATE_WINDOW_EXPIRED",
      };
    }

    // 6. Determine next attempt parameters
    const nextAttemptNumber = executedCount + 1;
    const schedule = this.generateSchedule(
      event,
      nextAttemptNumber,
      hoursSinceFailure,
    );

    return {
      shouldRetry: true,
      isExpiredMandate: false,
      schedule,
      reasoning: schedule.reasoning,
      terminationReason: null,
    };
  }

  /**
   * Generate scheduling parameters for a specific attempt number.
   */
  private generateSchedule(
    event: PaymentFailureEvent,
    attemptNumber: number,
    _hoursSinceFailure: number,
  ): MandateRetrySchedule {
    const spacingHours =
      MANDATE_RULES.RETRY_SPACING_HOURS[attemptNumber - 1] ??
      (attemptNumber - 1) * 48;

    // Calculate base scheduled date
    const baseDate = new Date(
      event.timestamp.getTime() + spacingHours * 60 * 60 * 1000,
    );

    // For attempts >= 2, align with optimal bank processing hour (10:15 AM IST)
    const scheduledAt =
      attemptNumber === 1 ? baseDate : this.alignToOptimalBankHour(baseDate);

    // Pre-debit notification timestamp (24h before scheduled debit)
    const preDebitNotificationSentAt = new Date(
      scheduledAt.getTime() -
        MANDATE_RULES.PRE_DEBIT_NOTIFICATION_HOURS * 60 * 60 * 1000,
    );

    // Select rail & strategy based on attempt number
    const rail = this.selectRail(attemptNumber, event.method);
    const strategy: RecoveryStrategy =
      attemptNumber === 4 ? "ALT_PAYMENT" : "SMART_RETRY";

    const reasoning = this.buildReasoning(
      attemptNumber,
      spacingHours,
      rail,
      scheduledAt,
      preDebitNotificationSentAt,
      event.bank,
    );

    return {
      attemptNumber,
      scheduledAt,
      preDebitNotificationSentAt,
      rail,
      strategy,
      reasoning,
    };
  }

  /**
   * Select the appropriate payment rail for an attempt with progressive fallback.
   * Attempt 1-2: Primary rail (UPI Autopay / Card Autodebit)
   * Attempt 3: Alternative clearing rail (e-NACH)
   * Attempt 4: On-demand payment link / alternate method
   */
  private selectRail(
    attemptNumber: number,
    initialMethod: PaymentMethod,
  ): MandatePaymentRail {
    if (attemptNumber <= 2) {
      if (initialMethod === "DEBIT_CARD" || initialMethod === "CREDIT_CARD") {
        return "CARD_AUTODEBIT";
      }
      return "UPI_AUTOPAY";
    }

    if (attemptNumber === 3) {
      // Fallback rail for attempt 3
      return "E_NACH";
    }

    // Attempt 4: Switch to on-demand payment link / alternate rail
    return "ON_DEMAND_LINK";
  }

  /**
   * Align a date to 10:15 AM IST (04:45 UTC).
   */
  private alignToOptimalBankHour(date: Date): Date {
    // IST is UTC+5:30 (330 minutes)
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(date.getTime() + istOffsetMs);

    const year = istTime.getUTCFullYear();
    const month = istTime.getUTCMonth();
    const day = istTime.getUTCDate();

    // 10:15 AM IST corresponds to 04:45 UTC
    let alignedUtc = new Date(Date.UTC(year, month, day, 4, 45, 0, 0));

    // If aligned time is in the past relative to target base date, advance to next day's 10:15 AM IST
    if (alignedUtc.getTime() < date.getTime()) {
      alignedUtc = new Date(alignedUtc.getTime() + 24 * 60 * 60 * 1000);
    }

    return alignedUtc;
  }

  /**
   * Construct human-readable reasoning for the scheduled attempt.
   */
  private buildReasoning(
    attemptNumber: number,
    spacingHours: number,
    rail: MandatePaymentRail,
    scheduledAt: Date,
    preDebitNotificationSentAt: Date,
    bank: string | null,
  ): string {
    const bankStr = bank ? `for ${bank}` : "";
    const preDebitIso = preDebitNotificationSentAt.toISOString();
    const scheduledIso = scheduledAt.toISOString();

    if (attemptNumber === 1) {
      return `Attempt 1 (T+0h): Initial debit attempt via ${rail}. Pre-debit notification scheduled at ${preDebitIso}.`;
    }

    if (attemptNumber === 2) {
      return `Attempt 2 (T+${spacingHours}h): Spaced +48h to align with salary deposit / bank clearing cycle ${bankStr}. Scheduled for ${scheduledIso} (10:15 AM IST optimal bank window) via ${rail}. 24h pre-debit notification at ${preDebitIso}.`;
    }

    if (attemptNumber === 3) {
      return `Attempt 3 (T+${spacingHours}h): Rail fallback to ${rail} scheduled at ${scheduledIso} (10:15 AM IST bank clearing window). 24h pre-debit notification at ${preDebitIso}.`;
    }

    return `Attempt 4 (T+${spacingHours}h): Final auto-debit attempt switching to ${rail} (alternative method / on-demand link) at ${scheduledIso}. 24h pre-debit notification at ${preDebitIso}.`;
  }
}
