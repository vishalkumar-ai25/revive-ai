// =============================================================================
// RISK ASSESSMENT AGENT
// =============================================================================
// Evaluates whether a failed payment is worth recovering and calculates a
// recovery probability score (0.0 - 1.0) based on multiple weighted factors:
//   - Failure category (bank issue vs. customer issue vs. fraud)
//   - Customer lifetime value and purchase history
//   - Payment amount vs. recovery cost threshold
//   - Time-of-day signals
//
// This agent answers the question: "CAN we recover this, and SHOULD we try?"
// =============================================================================

import { STOPPING_RULES } from "@/lib/constants";
import type {
  CustomerHistory,
  DiagnosisResult,
  PaymentFailureEvent,
  RiskAssessmentResult,
  RiskFactor,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Base recovery rates by failure category (empirical estimates for India)
// ---------------------------------------------------------------------------

const CATEGORY_RECOVERY_RATES: Record<string, number> = {
  BANK_TIMEOUT: 0.75,
  NETWORK_ERROR: 0.70,
  UPI_PSP_ERROR: 0.65,
  OTP_EXPIRED: 0.50,
  CHECKOUT_ABANDONED: 0.45,
  SUBSCRIPTION_FAILED: 0.55,
  INSUFFICIENT_FUNDS: 0.30,
  CARD_DECLINED: 0.25,
  LIMIT_EXCEEDED: 0.35,
  MANDATE_EXPIRED: 0.20,
  FRAUD_BLOCK: 0.0, // Never attempt recovery
  UNKNOWN: 0.15,
};

// ---------------------------------------------------------------------------
// Risk Assessment Agent
// ---------------------------------------------------------------------------

export class RiskAssessmentAgent {
  /**
   * Assess the recovery probability for a failed payment.
   * Returns a score and a clear recommendation on whether to attempt recovery.
   */
  assess(
    event: PaymentFailureEvent,
    diagnosis: DiagnosisResult,
    customerHistory: CustomerHistory,
  ): RiskAssessmentResult {
    const factors: RiskFactor[] = [];

    // --- Factor 1: Failure Category Base Rate ---
    const categoryRate = CATEGORY_RECOVERY_RATES[diagnosis.category] ?? 0.15;
    factors.push({
      name: "failure_category",
      score: categoryRate,
      weight: 0.35,
      detail: `${diagnosis.category} has a base recovery rate of ${(categoryRate * 100).toFixed(0)}%`,
    });

    // --- Factor 2: Customer Lifetime Value ---
    const clvScore = this.scoreCustomerValue(customerHistory);
    factors.push({
      name: "customer_lifetime_value",
      score: clvScore,
      weight: 0.25,
      detail: customerHistory.totalPurchases > 0
        ? `Returning customer (${customerHistory.totalPurchases} purchases, ₹${customerHistory.lifetimeValue.toFixed(0)} LTV)`
        : "First-time customer — no purchase history",
    });

    // --- Factor 3: Payment Amount ---
    const amountScore = this.scoreAmount(event.amount);
    factors.push({
      name: "payment_amount",
      score: amountScore,
      weight: 0.20,
      detail: `₹${event.amount} — ${event.amount > 5000 ? "high-value, worth pursuing" : event.amount < STOPPING_RULES.MIN_RECOVERY_AMOUNT_INR ? "below minimum threshold" : "standard value"}`,
    });

    // --- Factor 4: Diagnosis Confidence ---
    factors.push({
      name: "diagnosis_confidence",
      score: diagnosis.confidence,
      weight: 0.10,
      detail: `Diagnosis confidence: ${(diagnosis.confidence * 100).toFixed(0)}% — ${diagnosis.confidence > 0.7 ? "high certainty" : "uncertain diagnosis"}`,
    });

    // --- Factor 5: Recoverability Signal ---
    const recoverabilityScore = diagnosis.isRecoverable ? 1.0 : 0.0;
    factors.push({
      name: "recoverability",
      score: recoverabilityScore,
      weight: 0.10,
      detail: diagnosis.isRecoverable
        ? "Diagnosis indicates this failure type is recoverable"
        : "Diagnosis indicates this failure is NOT recoverable (e.g., fraud block)",
    });

    // --- Calculate Weighted Score ---
    let recoveryProbability = factors.reduce(
      (sum, factor) => sum + factor.score * factor.weight,
      0,
    );

    // --- Apply Decay for Repeated Attempts ---
    // Decay: each prior failure drastically reduces subsequent recovery probability (multiplicative).
    // Rationale: real payment failures are NOT independent Bernoulli trials.
    // Decay factor 0.1 ensures 4-attempt compound recovery for a high-base-rate
    // category stays realistic (e.g. 76% on attempt 1, ~78% cumulative) rather than approaching 100%.
    const decayFactor = Math.pow(STOPPING_RULES.RETRY_PROBABILITY_DECAY, customerHistory.previousFailures);
    recoveryProbability = Math.max(0, Math.min(1, recoveryProbability * decayFactor));

    // --- Apply Stopping Rules ---
    const shouldAttemptRecovery = this.shouldAttempt(
      recoveryProbability,
      event,
      diagnosis,
    );

    // --- Generate Reasoning ---
    const reasoning = this.generateReasoning(
      recoveryProbability,
      shouldAttemptRecovery,
      factors,
      event,
    );

    return {
      recoveryProbability: Math.round(recoveryProbability * 100) / 100,
      shouldAttemptRecovery,
      reasoning,
      factors,
    };
  }

  // -------------------------------------------------------------------------
  // Scoring Functions
  // -------------------------------------------------------------------------

  private scoreCustomerValue(history: CustomerHistory): number {
    if (history.totalPurchases === 0) return 0.3; // New customer — moderate
    if (history.totalPurchases >= 5 && history.lifetimeValue >= 10000) return 0.95; // High-value loyal
    if (history.totalPurchases >= 2) return 0.7; // Returning customer
    return 0.5; // Single previous purchase
  }

  private scoreAmount(amount: number): number {
    if (amount < STOPPING_RULES.MIN_RECOVERY_AMOUNT_INR) return 0.05; // Not worth recovering
    if (amount > 10000) return 0.95; // High-value — definitely pursue
    if (amount > 5000) return 0.80;
    if (amount > 1000) return 0.60;
    return 0.40;
  }

  // -------------------------------------------------------------------------
  // Stopping Rule Evaluation
  // -------------------------------------------------------------------------

  private shouldAttempt(
    probability: number,
    event: PaymentFailureEvent,
    diagnosis: DiagnosisResult,
  ): boolean {
    // Hard stop: fraud blocks are never retried
    if (diagnosis.category === "FRAUD_BLOCK") return false;

    // Hard stop: payment not marked as recoverable
    if (!diagnosis.isRecoverable) return false;

    // Hard stop: amount too small to justify recovery cost
    if (event.amount < STOPPING_RULES.MIN_RECOVERY_AMOUNT_INR) return false;

    // Soft stop: probability below threshold
    if (probability < STOPPING_RULES.MIN_RECOVERY_PROBABILITY) return false;

    return true;
  }

  // -------------------------------------------------------------------------
  // Reasoning Generation
  // -------------------------------------------------------------------------

  private generateReasoning(
    probability: number,
    shouldAttempt: boolean,
    factors: RiskFactor[],
    event: PaymentFailureEvent,
  ): string {
    if (!shouldAttempt) {
      if (event.amount < STOPPING_RULES.MIN_RECOVERY_AMOUNT_INR) {
        return `Recovery not attempted: ₹${event.amount} is below the minimum threshold of ₹${STOPPING_RULES.MIN_RECOVERY_AMOUNT_INR}.`;
      }
      if (probability < STOPPING_RULES.MIN_RECOVERY_PROBABILITY) {
        return `Recovery not attempted: probability of ${(probability * 100).toFixed(0)}% is below the ${(STOPPING_RULES.MIN_RECOVERY_PROBABILITY * 100).toFixed(0)}% threshold.`;
      }
      return "Recovery not attempted due to stopping rule evaluation.";
    }

    const topFactor = factors.reduce((best, f) =>
      f.score * f.weight > best.score * best.weight ? f : best,
    );

    return `Recovery probability: ${(probability * 100).toFixed(0)}%. Primary signal: ${topFactor.detail}. Recommending recovery attempt for ₹${event.amount}.`;
  }
}
