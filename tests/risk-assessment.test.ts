// =============================================================================
// RISK ASSESSMENT AGENT TESTS — Task 4.3
// =============================================================================
// Unit tests for RiskAssessmentAgent covering:
//   1. Base category recovery probability rates.
//   2. Customer Lifetime Value (CLV) scoring tiers.
//   3. Transaction amount scoring and minimum amount gating.
//   4. Hard stopping rules (FRAUD_BLOCK, unrecoverable flags, below minimum).
//   5. Factor array composition and reasoning generation.
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RiskAssessmentAgent } from "../src/lib/agents/risk-assessment-agent.js";
import type {
  CustomerHistory,
  DiagnosisResult,
  PaymentFailureEvent,
} from "../src/lib/types.js";

function createMockEvent(overrides: Partial<PaymentFailureEvent> = {}): PaymentFailureEvent {
  return {
    externalId: "pay_risk_test_001",
    merchantId: "merch_001",
    customerId: "cust_001",
    amount: 2500,
    currency: "INR",
    method: "UPI",
    bank: "HDFC",
    upiApp: "GPAY",
    errorCode: "BANK_TIMEOUT",
    errorDescription: "Bank timeout",
    isRecurring: false,
    subscriptionId: null,
    mandateId: null,
    timestamp: new Date("2025-01-15T04:30:00.000Z"),
    ...overrides,
  };
}

function createMockDiagnosis(overrides: Partial<DiagnosisResult> = {}): DiagnosisResult {
  return {
    category: "BANK_TIMEOUT",
    rootCause: "HDFC bank server timeout",
    confidence: 0.85,
    isRecoverable: true,
    signals: [],
    ...overrides,
  };
}

const defaultCustomer: CustomerHistory = {
  totalPurchases: 5,
  lifetimeValue: 12000,
  previousFailures: 0,
  daysSinceLastPurchase: 10,
};

describe("RiskAssessmentAgent — Recovery Probability Scoring", () => {
  const agent = new RiskAssessmentAgent();

  it("Calculates high recovery probability (>0.75) for BANK_TIMEOUT on loyal high-LTV customer", () => {
    const event = createMockEvent({ amount: 15000 });
    const diagnosis = createMockDiagnosis({ category: "BANK_TIMEOUT" });
    const result = agent.assess(event, diagnosis, defaultCustomer);

    assert.ok(result.recoveryProbability >= 0.75);
    assert.equal(result.shouldAttemptRecovery, true);
    assert.equal(result.factors.length, 5);
  });

  it("CLV Tier: First-time customer receives lower CLV score (0.30) than loyal customer (0.95)", () => {
    const event = createMockEvent();
    const diagnosis = createMockDiagnosis();

    const newCustomer: CustomerHistory = {
      totalPurchases: 0,
      lifetimeValue: 0,
      previousFailures: 0,
      daysSinceLastPurchase: null,
    };

    const newResult = agent.assess(event, diagnosis, newCustomer);
    const loyalResult = agent.assess(event, diagnosis, defaultCustomer);

    const newClv = newResult.factors.find((f) => f.name === "customer_lifetime_value");
    const loyalClv = loyalResult.factors.find((f) => f.name === "customer_lifetime_value");

    assert.equal(newClv?.score, 0.30);
    assert.equal(loyalClv?.score, 0.95);
    assert.ok(loyalResult.recoveryProbability > newResult.recoveryProbability);
  });

  it("Amount Tier: High-value transaction (>₹10,000) scores 0.95 amount score", () => {
    const event = createMockEvent({ amount: 15000 });
    const diagnosis = createMockDiagnosis();
    const result = agent.assess(event, diagnosis, defaultCustomer);

    const amountFactor = result.factors.find((f) => f.name === "payment_amount");
    assert.equal(amountFactor?.score, 0.95);
  });
});

describe("RiskAssessmentAgent — Hard Stopping Rules", () => {
  const agent = new RiskAssessmentAgent();

  it("Fraud Block: shouldAttemptRecovery is ALWAYS false with 0.00 base rate", () => {
    const event = createMockEvent({ errorCode: "FRAUD_DETECTED" });
    const diagnosis = createMockDiagnosis({
      category: "FRAUD_BLOCK",
      isRecoverable: false,
    });

    const result = agent.assess(event, diagnosis, defaultCustomer);

    assert.equal(result.shouldAttemptRecovery, false);
    const catFactor = result.factors.find((f) => f.name === "failure_category");
    assert.equal(catFactor?.score, 0.0);
    assert.ok(result.reasoning.includes("Recovery not attempted"));
  });

  it("Below Minimum Amount (< ₹50): shouldAttemptRecovery is false", () => {
    const event = createMockEvent({ amount: 45.0 }); // Under ₹50
    const diagnosis = createMockDiagnosis();

    const result = agent.assess(event, diagnosis, defaultCustomer);

    assert.equal(result.shouldAttemptRecovery, false);
    assert.ok(result.reasoning.includes("below the minimum threshold"));
  });

  it("Unrecoverable Flag: shouldAttemptRecovery is false when isRecoverable is false", () => {
    const event = createMockEvent();
    const diagnosis = createMockDiagnosis({ isRecoverable: false });

    const result = agent.assess(event, diagnosis, defaultCustomer);

    assert.equal(result.shouldAttemptRecovery, false);
  });
});
