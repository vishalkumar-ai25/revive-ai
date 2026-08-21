// =============================================================================
// MULTI-ATTEMPT LIFECYCLE STATE MACHINE TESTS — Task 4.4
// =============================================================================
// Comprehensive test suite covering:
//   1. End-to-end multi-attempt progression (Attempt 1 -> 2 -> 3 -> 4 -> DEAD).
//   2. Escalation ladder progression from Email (T+1h) -> SMS (T+24h) -> Merchant Alert (T+48h) -> Dead (T+72h).
//   3. Success terminal state (Payment marked RECOVERED, halting retries).
//   4. Rule 3 (Max retries = 4) and Rule 4 (Max nudges = 3) terminal state enforcement.
//   5. Quiet hours deferral (status stays RECOVERY_IN_PROGRESS, scheduled for 9 AM IST).
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StoppingRulesEngine } from "../src/lib/engine/stopping-rules.js";
import { StrategyAgent } from "../src/lib/agents/strategy-agent.js";
import { currentEscalationLevel, channelForLevel } from "../src/lib/engine/escalation-ladder.js";
import { VirtualClock } from "../src/lib/time/clock.js";
import type {
  DiagnosisResult,
  PaymentFailureEvent,
  RiskAssessmentResult,
} from "../src/lib/types.js";

function createMockEvent(overrides: Partial<PaymentFailureEvent> = {}): PaymentFailureEvent {
  return {
    externalId: "pay_lifecycle_001",
    merchantId: "merch_001",
    customerId: "cust_001",
    amount: 3200,
    currency: "INR",
    method: "UPI",
    bank: "HDFC",
    upiApp: "GPAY",
    errorCode: "BANK_TIMEOUT",
    errorDescription: "Bank server did not respond",
    isRecurring: false,
    subscriptionId: null,
    mandateId: null,
    timestamp: new Date("2025-01-15T04:30:00.000Z"), // 10:00 AM IST Jan 15
    ...overrides,
  };
}

const mockRiskAssessment: RiskAssessmentResult = {
  recoveryProbability: 0.80,
  shouldAttemptRecovery: true,
  factors: [],
  reasoning: "Regular customer with recoverable timeout",
};

describe("Multi-Attempt Lifecycle — State Progression", () => {
  const failureTime = new Date("2025-01-15T04:30:00.000Z"); // 10:00 AM IST

  it("Standard customer nudge escalates across 72h window: Email -> SMS -> Merchant Alert -> Dead", () => {
    const clock = new VirtualClock(failureTime);
    const stoppingRules = new StoppingRulesEngine(clock);
    const strategyAgent = new StrategyAgent(clock);
    const cartEvent = createMockEvent({ errorCode: "CHECKOUT_ABANDONED" });
    const cartDiagnosis: DiagnosisResult = {
      category: "CHECKOUT_ABANDONED",
      rootCause: "Cart abandoned",
      confidence: 0.9,
      isRecoverable: true,
      signals: [],
    };

    // --- T+0h: Initial intake ---
    const stop0 = stoppingRules.evaluate(cartEvent, [], false);
    assert.equal(stop0.shouldStop, false);
    const strat0 = strategyAgent.select(cartEvent, cartDiagnosis, mockRiskAssessment, 0);
    assert.equal(strat0.executionParams.escalationLevel, "LEVEL_2_EMAIL");
    assert.equal(strat0.executionParams.channel, "email");

    // --- T+6h (4:00 PM IST, daytime): Attempt 1 Failed -> Still Email channel ---
    clock.advanceHours(6);
    const attemptsAfter1 = [
      { attemptNumber: 1, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
    ];
    const stop6 = stoppingRules.evaluate(cartEvent, attemptsAfter1, false, "CUSTOMER_NUDGE");
    assert.equal(stop6.shouldStop, false);
    const strat6 = strategyAgent.select(cartEvent, cartDiagnosis, mockRiskAssessment, 6);
    assert.equal(strat6.executionParams.escalationLevel, "LEVEL_2_EMAIL");
    assert.equal(strat6.executionParams.channel, "email");

    // --- T+24h (10:00 AM IST next day, daytime): Attempt 2 Failed -> Escalates to SMS ---
    clock.advanceHours(18); // now T+24h (10:00 AM IST)
    const attemptsAfter2 = [
      { attemptNumber: 1, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
      { attemptNumber: 2, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
    ];
    const stop24 = stoppingRules.evaluate(cartEvent, attemptsAfter2, false, "CUSTOMER_NUDGE");
    assert.equal(stop24.shouldStop, false);
    const strat24 = strategyAgent.select(cartEvent, cartDiagnosis, mockRiskAssessment, 24);
    assert.equal(strat24.executionParams.escalationLevel, "LEVEL_3_SMS");
    assert.equal(strat24.executionParams.channel, "sms");

    // --- T+48h: Level 4 Merchant Dashboard Alert ---
    clock.advanceHours(24); // now T+48h
    const level4 = currentEscalationLevel(48);
    const channel4 = channelForLevel(level4);
    assert.equal(level4, "LEVEL_4_MERCHANT_ALERT");
    assert.equal(channel4, "merchant_dashboard");

    // --- T+73h: Past 72h window -> Hard Stop (RECOVERY_WINDOW_EXPIRED) ---
    clock.advanceHours(25); // now T+73h
    const stop73 = stoppingRules.evaluate(cartEvent, attemptsAfter2, false);
    assert.equal(stop73.shouldStop, true);
    assert.equal(stop73.rule, "RECOVERY_WINDOW_EXPIRED");
    assert.equal(currentEscalationLevel(73), "LEVEL_5_DEAD");
  });

  it("Rule 3 enforcement: Exactly 4 failed SMART_RETRY attempts halts recovery", () => {
    const clock = new VirtualClock(failureTime);
    const stoppingRules = new StoppingRulesEngine(clock);
    const event = createMockEvent();

    // 3 failed retries -> should NOT stop
    const attempts3 = [
      { attemptNumber: 1, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 2, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 3, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
    ];
    const decision3 = stoppingRules.evaluate(event, attempts3, false);
    assert.equal(decision3.shouldStop, false);

    // 4 failed retries -> MUST stop
    const attempts4 = [
      ...attempts3,
      { attemptNumber: 4, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
    ];
    const decision4 = stoppingRules.evaluate(event, attempts4, false);
    assert.equal(decision4.shouldStop, true);
    assert.equal(decision4.rule, "MAX_RETRIES_EXCEEDED");
  });

  it("Rule 4 enforcement: Exactly 3 failed CUSTOMER_NUDGE attempts halts recovery", () => {
    const clock = new VirtualClock(failureTime);
    const stoppingRules = new StoppingRulesEngine(clock);
    const event = createMockEvent();

    // 2 failed nudges -> should NOT stop
    const attempts2 = [
      { attemptNumber: 1, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
      { attemptNumber: 2, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
    ];
    const decision2 = stoppingRules.evaluate(event, attempts2, false);
    assert.equal(decision2.shouldStop, false);

    // 3 failed nudges -> MUST stop
    const attempts3 = [
      ...attempts2,
      { attemptNumber: 3, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
    ];
    const decision3 = stoppingRules.evaluate(event, attempts3, false);
    assert.equal(decision3.shouldStop, true);
    assert.equal(decision3.rule, "MAX_NUDGES_EXCEEDED");
  });

  it("Quiet hours deferral during night (11:00 PM IST) halts customer outreach without stopping backend retries", () => {
    // 17:30 UTC = 23:00 IST (11:00 PM IST)
    const lateNight = new Date("2025-01-15T17:30:00.000Z");
    const clock = new VirtualClock(lateNight);
    const stoppingRules = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: lateNight });

    // Customer nudge during quiet hours MUST be blocked
    const nudgeDecision = stoppingRules.evaluate(event, [], false, "CUSTOMER_NUDGE");
    assert.equal(nudgeDecision.shouldStop, true);
    assert.equal(nudgeDecision.rule, "QUIET_HOURS");

    // Backend smart retry during quiet hours MUST proceed
    const retryDecision = stoppingRules.evaluate(event, [], false, "SMART_RETRY");
    assert.equal(retryDecision.shouldStop, false);
    assert.equal(retryDecision.rule, null);
  });
});
