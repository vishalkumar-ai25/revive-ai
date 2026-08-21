// =============================================================================
// STOPPING RULES TESTS — Task 1.1
// =============================================================================
// Tests for StoppingRulesEngine covering all 6 rules, with special focus on
// quiet hours behavior (allowing SMART_RETRY, ALT_PAYMENT, ESCALATE_MERCHANT,
// and pre-pipeline calls while blocking CUSTOMER_NUDGE during 9 PM - 9 AM IST).
// Run with: npm test (tsx --test)
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VirtualClock } from "../src/lib/time/clock.js";
import { StoppingRulesEngine } from "../src/lib/engine/stopping-rules.js";
import type { PaymentFailureEvent } from "../src/lib/types.js";

// Helper to create a base mock event
function createMockEvent(overrides: Partial<PaymentFailureEvent> = {}): PaymentFailureEvent {
  return {
    externalId: "pay_test_sr_001",
    merchantId: "merch_001",
    customerId: "cust_001",
    amount: 1500,
    currency: "INR",
    method: "UPI",
    bank: "HDFC",
    upiApp: "GPAY",
    errorCode: "BANK_TIMEOUT",
    errorDescription: "Bank server timeout",
    isRecurring: false,
    subscriptionId: null,
    mandateId: null,
    timestamp: new Date("2025-01-15T10:00:00.000Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Quiet Hours Tests (Rule 6)
// ---------------------------------------------------------------------------

describe("StoppingRulesEngine — Quiet Hours (Rule 6)", () => {
  // 17:30 UTC = 23:00 IST (11:00 PM IST — inside quiet hours: 21:00 to 09:00 IST)
  const elevenPmIst = new Date("2025-01-15T17:30:00.000Z");

  it("SMART_RETRY passed as strategy during quiet hours → shouldStop === false", () => {
    const clock = new VirtualClock(elevenPmIst);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: elevenPmIst });

    const decision = engine.evaluate(event, [], false, "SMART_RETRY");
    assert.equal(decision.shouldStop, false);
    assert.equal(decision.rule, null);
  });

  it("ALT_PAYMENT passed as strategy during quiet hours → shouldStop === false", () => {
    const clock = new VirtualClock(elevenPmIst);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: elevenPmIst });

    const decision = engine.evaluate(event, [], false, "ALT_PAYMENT");
    assert.equal(decision.shouldStop, false);
    assert.equal(decision.rule, null);
  });

  it("ESCALATE_MERCHANT passed as strategy during quiet hours → shouldStop === false", () => {
    const clock = new VirtualClock(elevenPmIst);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: elevenPmIst });

    const decision = engine.evaluate(event, [], false, "ESCALATE_MERCHANT");
    assert.equal(decision.shouldStop, false);
    assert.equal(decision.rule, null);
  });

  it("CUSTOMER_NUDGE passed as strategy during quiet hours → shouldStop === true, rule === 'QUIET_HOURS'", () => {
    const clock = new VirtualClock(elevenPmIst);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: elevenPmIst });

    const decision = engine.evaluate(event, [], false, "CUSTOMER_NUDGE");
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.rule, "QUIET_HOURS");
    assert.ok(decision.reason.includes("quiet hours"));
  });

  it("No strategy argument at all (pre-pipeline call) → shouldStop === false even during quiet hours", () => {
    const clock = new VirtualClock(elevenPmIst);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: elevenPmIst });

    // Pre-pipeline call: strategy is omitted/undefined
    const decision = engine.evaluate(event, [], false);
    assert.equal(decision.shouldStop, false);
    assert.equal(decision.rule, null);
  });

  it("CUSTOMER_NUDGE during daytime (10 AM IST) → shouldStop === false", () => {
    // 04:30 UTC = 10:00 AM IST (outside quiet hours)
    const tenAmIst = new Date("2025-01-15T04:30:00.000Z");
    const clock = new VirtualClock(tenAmIst);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: tenAmIst });

    const decision = engine.evaluate(event, [], false, "CUSTOMER_NUDGE");
    assert.equal(decision.shouldStop, false);
    assert.equal(decision.rule, null);
  });
});

// ---------------------------------------------------------------------------
// Other Stopping Rules (Rules 1 - 5)
// ---------------------------------------------------------------------------

describe("StoppingRulesEngine — Core Rules (1 - 5)", () => {
  const baseTime = new Date("2025-01-15T05:00:00.000Z"); // 10:30 AM IST

  it("Rule 1: isFraudBlocked === true → shouldStop === true, rule === 'FRAUD_BLOCK'", () => {
    const clock = new VirtualClock(baseTime);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: baseTime });

    const decision = engine.evaluate(event, [], true);
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.rule, "FRAUD_BLOCK");
  });

  it("Rule 2: amount < 50 INR → shouldStop === true, rule === 'BELOW_MIN_AMOUNT'", () => {
    const clock = new VirtualClock(baseTime);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ amount: 49.99, timestamp: baseTime });

    const decision = engine.evaluate(event, [], false);
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.rule, "BELOW_MIN_AMOUNT");
  });

  it("Rule 3: retryAttempts >= 4 → shouldStop === true, rule === 'MAX_RETRIES_EXCEEDED'", () => {
    const clock = new VirtualClock(baseTime);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: baseTime });

    const previousAttempts = [
      { attemptNumber: 1, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 2, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 3, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 4, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
    ];

    const decision = engine.evaluate(event, previousAttempts, false);
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.rule, "MAX_RETRIES_EXCEEDED");
  });

  it("Rule 4: nudgeAttempts >= 3 → shouldStop === true, rule === 'MAX_NUDGES_EXCEEDED'", () => {
    const clock = new VirtualClock(baseTime);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: baseTime });

    const previousAttempts = [
      { attemptNumber: 1, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
      { attemptNumber: 2, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
      { attemptNumber: 3, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
    ];

    const decision = engine.evaluate(event, previousAttempts, false);
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.rule, "MAX_NUDGES_EXCEEDED");
  });

  it("Rule 5: hoursSinceFailure > 72 → shouldStop === true, rule === 'RECOVERY_WINDOW_EXPIRED'", () => {
    const failureTime = new Date("2025-01-15T00:00:00.000Z");
    const currentTime = new Date("2025-01-18T01:00:00.000Z"); // 73 hours later
    const clock = new VirtualClock(currentTime);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: failureTime });

    const decision = engine.evaluate(event, [], false);
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.rule, "RECOVERY_WINDOW_EXPIRED");
  });
});

// ---------------------------------------------------------------------------
// Outcome Filtering Tests (Rules 3 & 4 — Task 2.3)
// ---------------------------------------------------------------------------

describe("StoppingRulesEngine — Outcome Filtering for Rules 3 & 4", () => {
  const baseTime = new Date("2025-01-15T05:00:00.000Z"); // 10:30 AM IST

  it("4x SMART_RETRY PENDING → Rule 3 does NOT fire (0 executed retries)", () => {
    const clock = new VirtualClock(baseTime);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: baseTime });

    const previousAttempts = [
      { attemptNumber: 1, strategy: "SMART_RETRY" as const, outcome: "PENDING" as const },
      { attemptNumber: 2, strategy: "SMART_RETRY" as const, outcome: "PENDING" as const },
      { attemptNumber: 3, strategy: "SMART_RETRY" as const, outcome: "PENDING" as const },
      { attemptNumber: 4, strategy: "SMART_RETRY" as const, outcome: "PENDING" as const },
    ];

    const decision = engine.evaluate(event, previousAttempts, false);
    assert.equal(decision.shouldStop, false);
    assert.equal(decision.rule, null);
  });

  it("4x SMART_RETRY FAILED + 1x PENDING → Rule 3 DOES fire (4 executed >= MAX_RETRY_ATTEMPTS)", () => {
    const clock = new VirtualClock(baseTime);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: baseTime });

    const previousAttempts = [
      { attemptNumber: 1, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 2, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 3, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 4, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 5, strategy: "SMART_RETRY" as const, outcome: "PENDING" as const },
    ];

    const decision = engine.evaluate(event, previousAttempts, false);
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.rule, "MAX_RETRIES_EXCEEDED");
  });

  it("3x CUSTOMER_NUDGE FAILED + 1x PENDING → Rule 4 DOES fire (3 executed >= MAX_NUDGE_MESSAGES)", () => {
    const clock = new VirtualClock(baseTime);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: baseTime });

    const previousAttempts = [
      { attemptNumber: 1, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
      { attemptNumber: 2, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
      { attemptNumber: 3, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
      { attemptNumber: 4, strategy: "CUSTOMER_NUDGE" as const, outcome: "PENDING" as const },
    ];

    const decision = engine.evaluate(event, previousAttempts, false);
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.rule, "MAX_NUDGES_EXCEEDED");
  });

  it("2x CUSTOMER_NUDGE FAILED + 1x PENDING → Rule 4 does NOT fire", () => {
    const clock = new VirtualClock(baseTime);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: baseTime });

    const previousAttempts = [
      { attemptNumber: 1, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
      { attemptNumber: 2, strategy: "CUSTOMER_NUDGE" as const, outcome: "FAILED" as const },
      { attemptNumber: 3, strategy: "CUSTOMER_NUDGE" as const, outcome: "PENDING" as const },
    ];

    const decision = engine.evaluate(event, previousAttempts, false);
    assert.equal(decision.shouldStop, false);
    assert.equal(decision.rule, null);
  });

  it("1x SMART_RETRY STOPPED_BY_RULE + 3x SMART_RETRY FAILED → Rule 3 does NOT fire", () => {
    const clock = new VirtualClock(baseTime);
    const engine = new StoppingRulesEngine(clock);
    const event = createMockEvent({ timestamp: baseTime });

    const previousAttempts = [
      { attemptNumber: 1, strategy: "SMART_RETRY" as const, outcome: "STOPPED_BY_RULE" as const },
      { attemptNumber: 2, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 3, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 4, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
    ];

    const decision = engine.evaluate(event, previousAttempts, false);
    assert.equal(decision.shouldStop, false);
    assert.equal(decision.rule, null);
  });
});
