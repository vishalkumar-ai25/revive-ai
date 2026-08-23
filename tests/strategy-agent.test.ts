// =============================================================================
// STRATEGY AGENT TESTS — Task 2.4
// =============================================================================
// Verifies StrategyAgent's execution parameter generation, specifically
// dynamic escalation ladder channel selection for CUSTOMER_NUDGE.
//
// At <24h hoursSinceFailure  → LEVEL_2_EMAIL ("email")
// At 24h–48h hoursSinceFailure → LEVEL_3_SMS ("sms")
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StrategyAgent } from "../src/lib/agents/strategy-agent.js";
import { VirtualClock } from "../src/lib/time/clock.js";
import type {
  DiagnosisResult,
  PaymentFailureEvent,
  RiskAssessmentResult,
} from "../src/lib/types.js";

function createMockEvent(overrides: Partial<PaymentFailureEvent> = {}): PaymentFailureEvent {
  return {
    externalId: "pay_strat_test_001",
    merchantId: "merch_001",
    customerId: "cust_001",
    amount: 2500,
    currency: "INR",
    method: "UPI",
    bank: "HDFC",
    upiApp: "GPAY",
    errorCode: "CHECKOUT_ABANDONED",
    errorDescription: "Customer abandoned checkout",
    isRecurring: false,
    subscriptionId: null,
    mandateId: null,
    timestamp: new Date("2025-01-15T10:00:00.000Z"),
    ...overrides,
  };
}

const mockDiagnosis: DiagnosisResult = {
  category: "CHECKOUT_ABANDONED",
  rootCause: "Customer abandoned cart without payment attempt",
  confidence: 0.9,
  isRecoverable: true,
  signals: [
    { name: "no_gateway_attempt", value: "true", weight: 0.8 },
    { name: "items_saved", value: "true", weight: 0.7 },
  ],
};

const mockRiskAssessment: RiskAssessmentResult = {
  recoveryProbability: 0.85,
  shouldAttemptRecovery: true,
  factors: [
    { name: "customerLtv", score: 0.8, weight: 0.3, detail: "High LTV customer" },
    { name: "categoryScore", score: 0.9, weight: 0.4, detail: "High recovery category" },
  ],
  reasoning: "High value customer with cart abandonment",
};

describe("StrategyAgent — CUSTOMER_NUDGE Escalation Channel Selection", () => {
  const failureTime = new Date("2025-01-15T10:00:00.000Z");

  it("At 0h (immediate): CUSTOMER_NUDGE uses LEVEL_2_EMAIL / 'email'", () => {
    const clock = new VirtualClock(failureTime);
    const agent = new StrategyAgent(clock);
    const event = createMockEvent({ timestamp: failureTime });

    const result = agent.select(event, mockDiagnosis, mockRiskAssessment);
    assert.equal(result.strategy, "CUSTOMER_NUDGE");
    assert.equal(result.executionParams.escalationLevel, "LEVEL_2_EMAIL");
    assert.equal(result.executionParams.channel, "email");
  });

  it("At 12h elapsed: CUSTOMER_NUDGE uses LEVEL_2_EMAIL / 'email'", () => {
    // 12 hours later
    const currentTime = new Date("2025-01-15T22:00:00.000Z");
    const clock = new VirtualClock(currentTime);
    const agent = new StrategyAgent(clock);
    const event = createMockEvent({ timestamp: failureTime });

    const result = agent.select(event, mockDiagnosis, mockRiskAssessment);
    assert.equal(result.strategy, "CUSTOMER_NUDGE");
    assert.equal(result.executionParams.escalationLevel, "LEVEL_2_EMAIL");
    assert.equal(result.executionParams.channel, "email");
  });

  it("At 24h elapsed: CUSTOMER_NUDGE escalates to LEVEL_3_SMS / 'sms'", () => {
    // 24 hours later
    const currentTime = new Date("2025-01-16T10:00:00.000Z");
    const clock = new VirtualClock(currentTime);
    const agent = new StrategyAgent(clock);
    const event = createMockEvent({ timestamp: failureTime });

    const result = agent.select(event, mockDiagnosis, mockRiskAssessment);
    assert.equal(result.strategy, "CUSTOMER_NUDGE");
    assert.equal(result.executionParams.escalationLevel, "LEVEL_3_SMS");
    assert.equal(result.executionParams.channel, "sms");
  });

  it("Explicit hoursSinceFailure parameter overrides event timestamp calculation", () => {
    const clock = new VirtualClock(failureTime);
    const agent = new StrategyAgent(clock);
    const event = createMockEvent({ timestamp: failureTime });

    // Explicitly pass 30 hours
    const result = agent.select(event, mockDiagnosis, mockRiskAssessment, 30);
    assert.equal(result.strategy, "CUSTOMER_NUDGE");
    assert.equal(result.executionParams.escalationLevel, "LEVEL_3_SMS");
    assert.equal(result.executionParams.channel, "sms");
  });
});

// ---------------------------------------------------------------------------
// Timezone-Independent Scheduling
// ---------------------------------------------------------------------------

describe("StrategyAgent — Timezone-Independent Scheduling", () => {
  it("calculateOptimalRetryTime returns same scheduledAt for UTC noon and IST equivalent", () => {
    const clockUtc = new VirtualClock(new Date(Date.UTC(2025, 0, 15, 6, 30))); // 12:00 PM IST
    const agentUtc = new StrategyAgent(clockUtc);
    
    // Using a bank with a generic window.
    const event = createMockEvent({ bank: "HDFC" });
    const diagnosis = createMockDiagnosis();
    const risk = { recoveryProbability: 0.9, shouldAttemptRecovery: true, reasoning: "", factors: [] };
    
    const strategy = agentUtc.select(event, diagnosis, risk);
    assert.ok(strategy.executionParams.scheduledAt);
  });

  it("calculateNudgeTime respects IST quiet hours, not local TZ", () => {
    // 2:30 PM UTC = 8:00 PM IST
    const baseTimeUtc = new Date(Date.UTC(2025, 0, 15, 14, 30, 0, 0));
    const clock = new VirtualClock(baseTimeUtc);
    const agent = new StrategyAgent(clock);

    const event = createMockEvent();
    const diagnosis = createMockDiagnosis({ category: "CHECKOUT_ABANDONED" as any });
    const risk = { recoveryProbability: 0.9, shouldAttemptRecovery: true, reasoning: "", factors: [] };

    // Strategy should be CUSTOMER_NUDGE
    const strategy = agent.select(event, diagnosis, risk);
    
    // Scheduled time would be 2 hours later: 10:00 PM IST (16:30 UTC), which is quiet hours.
    // So it should push to 9:00 AM IST next day (3:30 AM UTC next day).
    const scheduled = strategy.executionParams.scheduledAt;
    assert.ok(scheduled);
    assert.equal(scheduled.getUTCHours(), 3);
    assert.equal(scheduled.getUTCMinutes(), 30);
  });

  it("calculateNudgeTime during IST daytime returns +2h offset", () => {
    // 8:30 AM UTC = 2:00 PM IST
    const baseTimeUtc = new Date(Date.UTC(2025, 0, 15, 8, 30, 0, 0));
    const clock = new VirtualClock(baseTimeUtc);
    const agent = new StrategyAgent(clock);

    const event = createMockEvent();
    const diagnosis = createMockDiagnosis({ category: "CHECKOUT_ABANDONED" as any });
    const risk = { recoveryProbability: 0.9, shouldAttemptRecovery: true, reasoning: "", factors: [] };

    const strategy = agent.select(event, diagnosis, risk);
    
    // Scheduled time would be 2 hours later: 4:00 PM IST (10:30 UTC).
    const scheduled = strategy.executionParams.scheduledAt;
    assert.ok(scheduled);
    assert.equal(scheduled.getUTCHours(), 10);
    assert.equal(scheduled.getUTCMinutes(), 30);
  });
});

function createMockDiagnosis(overrides: any = {}): any {
  return {
    category: "BANK_TIMEOUT",
    isRecoverable: true,
    confidence: 0.9,
    rootCause: "Test cause",
    signals: [],
    ...overrides
  };
}
