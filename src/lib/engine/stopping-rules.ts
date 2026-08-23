import { toIstHour } from "@/lib/time/ist";
// =============================================================================
// STOPPING RULES ENGINE
// =============================================================================
// Evaluates whether a recovery attempt should proceed or be halted.
// Implements the "stopping rules" requirement from the judging criteria.
//
// Rules are evaluated in priority order — the first matching rule wins.
// Every stop decision is recorded with the rule name for audit purposes.
// =============================================================================

import type { RecoveryAttempt, RecoveryStrategy } from "@prisma/client";
import { CUSTOMER_FACING_STRATEGIES, MANDATE_RULES, QUIET_HOURS, STOPPING_RULES } from "@/lib/constants";
import type { PaymentFailureEvent } from "@/lib/types";
import { type Clock, SystemClock } from "@/lib/time/clock";

export interface StopDecision {
  shouldStop: boolean;
  rule: string | null;
  reason: string;
}

export class StoppingRulesEngine {
  private clock: Clock;

  constructor(clock: Clock = new SystemClock()) {
    this.clock = clock;
  }

  /**
   * Evaluate all stopping rules for a payment.
   * Returns the first rule that triggers a stop, or clears the attempt.
   */
  evaluate(
    event: PaymentFailureEvent,
    previousAttempts: Pick<RecoveryAttempt, "attemptNumber" | "strategy" | "outcome">[],
    isFraudBlocked: boolean,
    strategy?: RecoveryStrategy,
  ): StopDecision {
    // Rule 1: NEVER retry fraud-blocked payments
    if (isFraudBlocked) {
      return {
        shouldStop: true,
        rule: "FRAUD_BLOCK",
        reason: "Payment was flagged as fraud by the issuing bank. Recovery prohibited.",
      };
    }

    if (strategy === "DO_NOTHING") {
      return {
        shouldStop: true,
        rule: "STRATEGY_DO_NOTHING",
        reason: "Agent elected to DO_NOTHING. Recovery aborted.",
      };
    }

    // Rule 2: Amount too small to justify recovery cost
    if (event.amount < STOPPING_RULES.MIN_RECOVERY_AMOUNT_INR) {
      return {
        shouldStop: true,
        rule: "BELOW_MIN_AMOUNT",
        reason: `₹${event.amount} is below the minimum recovery threshold of ₹${STOPPING_RULES.MIN_RECOVERY_AMOUNT_INR}.`,
      };
    }

    // Rule 3: Maximum retry attempts exceeded
    // Only count EXECUTED attempts (FAILED or SUCCESS) — not PENDING or STOPPED_BY_RULE.
    const retryAttempts = previousAttempts.filter(
      (a) =>
        a.strategy === "SMART_RETRY" &&
        (a.outcome === "FAILED" || a.outcome === "SUCCESS"),
    );
    if (retryAttempts.length >= STOPPING_RULES.MAX_RETRY_ATTEMPTS) {
      return {
        shouldStop: true,
        rule: "MAX_RETRIES_EXCEEDED",
        reason: `Maximum ${STOPPING_RULES.MAX_RETRY_ATTEMPTS} retry attempts reached.`,
      };
    }

    // Rule 3b: Maximum ALT_PAYMENT attempts exceeded
    const altPaymentAttempts = previousAttempts.filter(
      (a) =>
        a.strategy === "ALT_PAYMENT" &&
        (a.outcome === "FAILED" || a.outcome === "SUCCESS"),
    );
    if (altPaymentAttempts.length >= STOPPING_RULES.MAX_ALT_PAYMENT_ATTEMPTS) {
      return {
        shouldStop: true,
        rule: "MAX_ALT_PAYMENT_EXCEEDED",
        reason: `Maximum ${STOPPING_RULES.MAX_ALT_PAYMENT_ATTEMPTS} alternative payment suggestion attempts reached.`,
      };
    }

    // Rule 3c: Maximum ESCALATE_MERCHANT attempts exceeded
    const escalateAttempts = previousAttempts.filter(
      (a) =>
        a.strategy === "ESCALATE_MERCHANT" &&
        (a.outcome === "FAILED" || a.outcome === "SUCCESS"),
    );
    if (escalateAttempts.length >= STOPPING_RULES.MAX_ESCALATE_MERCHANT_ATTEMPTS) {
      return {
        shouldStop: true,
        rule: "MAX_ESCALATE_MERCHANT_EXCEEDED",
        reason: `Maximum ${STOPPING_RULES.MAX_ESCALATE_MERCHANT_ATTEMPTS} merchant escalation attempts reached.`,
      };
    }

    // Rule 4: Maximum nudge messages exceeded
    // Same reasoning — count delivered nudges only, not scheduled-but-unexecuted ones.
    const nudgeAttempts = previousAttempts.filter(
      (a) =>
        a.strategy === "CUSTOMER_NUDGE" &&
        (a.outcome === "FAILED" || a.outcome === "SUCCESS"),
    );
    if (nudgeAttempts.length >= STOPPING_RULES.MAX_NUDGE_MESSAGES) {
      return {
        shouldStop: true,
        rule: "MAX_NUDGES_EXCEEDED",
        reason: `Maximum ${STOPPING_RULES.MAX_NUDGE_MESSAGES} customer nudges sent. Stopping to avoid spam.`,
      };
    }

    // Rule 5: Recovery window expired
    // Standard payments: 72 hours. Recurring e-mandates: 168 hours (7 days, per ReviveAI mandate policy).
    const isMandate = Boolean(event.isRecurring && event.mandateId);
    const maxWindowHours = isMandate
      ? MANDATE_RULES.WINDOW_HOURS
      : STOPPING_RULES.MAX_RECOVERY_WINDOW_HOURS;

    const hoursSinceFailure =
      (this.clock.now().getTime() - event.timestamp.getTime()) / (1000 * 60 * 60);
    if (hoursSinceFailure > maxWindowHours) {
      return {
        shouldStop: true,
        rule: "RECOVERY_WINDOW_EXPIRED",
        reason: `${maxWindowHours}-hour recovery window has expired.`,
      };
    }

    // Rule 6: Quiet hours — don't contact customers between 9PM and 9AM IST
    // Only applies to customer-facing outreach strategies (e.g. CUSTOMER_NUDGE).
    if (strategy && CUSTOMER_FACING_STRATEGIES.includes(strategy) && this.isQuietHours()) {
      return {
        shouldStop: true,
        rule: "QUIET_HOURS",
        reason: `Currently in quiet hours (${QUIET_HOURS.START_HOUR}:00 - ${QUIET_HOURS.END_HOUR}:00 IST). Customer contact paused.`,
      };
    }

    // All rules passed — recovery may proceed
    return {
      shouldStop: false,
      rule: null,
      reason: "All stopping rules cleared. Recovery may proceed.",
    };
  }

  /**
   * Check if current time is within quiet hours (9PM - 9AM IST).
   */
  private isQuietHours(): boolean {
    const istHour = toIstHour(this.clock.now());
    return istHour >= QUIET_HOURS.START_HOUR || istHour < QUIET_HOURS.END_HOUR;
  }
}
