// =============================================================================
// MANDATE RETRY SEQUENCER TESTS — Tasks 3.2, 3.3, 3.4
// =============================================================================
// Comprehensive test suite covering:
//   1. Unit tests for MandateRetrySequencer (timing, 4-attempt cap, rail switching,
//      24h pre-debit notifications, expired mandate handling, fraud blocking).
//   2. StrategyAgent mandate routing integration.
//   3. Multi-attempt pipeline lifecycle integration testing with StoppingRulesEngine
//      verifying attempts 3 (T+96h) and 4 (T+144h) survive beyond the standard
//      72h window and terminate at 168h.
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MandateRetrySequencer } from "../src/lib/agents/mandate-sequencer.js";
import { StrategyAgent } from "../src/lib/agents/strategy-agent.js";
import { StoppingRulesEngine } from "../src/lib/engine/stopping-rules.js";
import { VirtualClock } from "../src/lib/time/clock.js";
import type {
  DiagnosisResult,
  PaymentFailureEvent,
  RiskAssessmentResult,
} from "../src/lib/types.js";

// Helper to create a base mock recurring mandate failure event
function createMockMandateEvent(
  overrides: Partial<PaymentFailureEvent> = {},
): PaymentFailureEvent {
  return {
    externalId: "pay_mandate_test_001",
    merchantId: "merch_001",
    customerId: "cust_001",
    amount: 1999,
    currency: "INR",
    method: "UPI",
    bank: "HDFC",
    upiApp: "GPAY",
    errorCode: "BANK_TIMEOUT",
    errorDescription: "Bank server timeout during auto-debit",
    isRecurring: true,
    subscriptionId: "sub_001",
    mandateId: "mandate_hdfc_001",
    timestamp: new Date("2025-01-15T04:30:00.000Z"), // 10:00 AM IST Jan 15
    ...overrides,
  };
}

const mockDiagnosis: DiagnosisResult = {
  category: "BANK_TIMEOUT",
  rootCause: "HDFC auto-debit processing gateway timeout",
  confidence: 0.9,
  isRecoverable: true,
  signals: [{ name: "bank_timeout", value: "true", weight: 0.8 }],
};

const mockRiskAssessment: RiskAssessmentResult = {
  recoveryProbability: 0.85,
  shouldAttemptRecovery: true,
  factors: [
    { name: "customerLtv", score: 0.85, weight: 0.5, detail: "Active subscriber" },
  ],
  reasoning: "High-value active subscriber with transient bank error",
};

// ---------------------------------------------------------------------------
// 1. MandateRetrySequencer Unit Tests
// ---------------------------------------------------------------------------

describe("MandateRetrySequencer — Unit Tests", () => {
  const failureTime = new Date("2025-01-15T04:30:00.000Z"); // Jan 15, 10:00 AM IST

  it("Attempt 1 (T+0): Schedules immediate debit via UPI_AUTOPAY with T-24h pre-debit notification", () => {
    const clock = new VirtualClock(failureTime);
    const sequencer = new MandateRetrySequencer(clock);
    const event = createMockMandateEvent({ timestamp: failureTime });

    const result = sequencer.evaluate(event, mockDiagnosis, 0);

    assert.equal(result.shouldRetry, true);
    assert.equal(result.isExpiredMandate, false);
    assert.ok(result.schedule !== null, "T+0 schedule must be produced");
    assert.equal(result.schedule.attemptNumber, 1);
    assert.equal(result.schedule.rail, "UPI_AUTOPAY");
    assert.equal(result.schedule.strategy, "SMART_RETRY");
    assert.equal(result.schedule.scheduledAt.getTime(), failureTime.getTime());

    // Pre-debit notification is exactly 24h before scheduledAt
    const expectedPreDebit = new Date(failureTime.getTime() - 24 * 60 * 60 * 1000);
    assert.equal(
      result.schedule.preDebitNotificationSentAt?.getTime(),
      expectedPreDebit.getTime(),
    );
    assert.ok(result.reasoning.includes("Attempt 1"));
    assert.ok(result.reasoning.includes("Pre-debit notification"));
  });

  it("Attempt 2 (T+48h): Spaced +48h at optimal bank clearing window (10:15 AM IST)", () => {
    const clock = new VirtualClock(new Date("2025-01-17T04:30:00.000Z"));
    const sequencer = new MandateRetrySequencer(clock);
    const event = createMockMandateEvent({ timestamp: failureTime });

    // 1 attempt executed previously
    const result = sequencer.evaluate(event, mockDiagnosis, 1);

    assert.equal(result.shouldRetry, true);
    assert.ok(result.schedule !== null, "T+48h schedule must be produced");
    assert.equal(result.schedule.attemptNumber, 2);
    assert.equal(result.schedule.rail, "UPI_AUTOPAY");
    assert.equal(result.schedule.strategy, "SMART_RETRY");

    // 10:15 AM IST on Jan 17 is 04:45 UTC on Jan 17
    const expectedScheduledAt = new Date("2025-01-17T04:45:00.000Z");
    assert.equal(
      result.schedule.scheduledAt.toISOString(),
      expectedScheduledAt.toISOString(),
    );

    // Pre-debit notification is 24h prior: Jan 16, 04:45 UTC
    const expectedPreDebit = new Date("2025-01-16T04:45:00.000Z");
    assert.equal(
      result.schedule.preDebitNotificationSentAt?.toISOString(),
      expectedPreDebit.toISOString(),
    );
    assert.ok(result.reasoning.includes("salary deposit"));
  });

  it("Attempt 3 (T+96h): Switches rail to E_NACH at optimal bank window (10:15 AM IST)", () => {
    const clock = new VirtualClock(new Date("2025-01-19T04:30:00.000Z"));
    const sequencer = new MandateRetrySequencer(clock);
    const event = createMockMandateEvent({ timestamp: failureTime });

    // 2 attempts executed previously
    const result = sequencer.evaluate(event, mockDiagnosis, 2);

    assert.equal(result.shouldRetry, true);
    assert.ok(result.schedule !== null, "T+96h schedule must be produced");
    assert.equal(result.schedule.attemptNumber, 3);
    assert.equal(result.schedule.rail, "E_NACH");
    assert.equal(result.schedule.strategy, "SMART_RETRY");

    // 10:15 AM IST on Jan 19 is 04:45 UTC on Jan 19
    const expectedScheduledAt = new Date("2025-01-19T04:45:00.000Z");
    assert.equal(
      result.schedule.scheduledAt.toISOString(),
      expectedScheduledAt.toISOString(),
    );

    // Pre-debit notification is 24h prior: Jan 18, 04:45 UTC
    const expectedPreDebit = new Date("2025-01-18T04:45:00.000Z");
    assert.equal(
      result.schedule.preDebitNotificationSentAt?.toISOString(),
      expectedPreDebit.toISOString(),
    );
    assert.ok(result.reasoning.includes("Rail fallback to E_NACH"));
  });

  it("Attempt 4 (T+144h): Switches to ON_DEMAND_LINK with ALT_PAYMENT strategy", () => {
    const clock = new VirtualClock(new Date("2025-01-21T04:30:00.000Z"));
    const sequencer = new MandateRetrySequencer(clock);
    const event = createMockMandateEvent({ timestamp: failureTime });

    // 3 attempts executed previously
    const result = sequencer.evaluate(event, mockDiagnosis, 3);

    assert.equal(result.shouldRetry, true);
    assert.ok(result.schedule !== null, "T+144h schedule must be produced");
    assert.equal(result.schedule.attemptNumber, 4);
    assert.equal(result.schedule.rail, "ON_DEMAND_LINK");
    assert.equal(result.schedule.strategy, "ALT_PAYMENT");

    const expectedScheduledAt = new Date("2025-01-21T04:45:00.000Z");
    assert.equal(
      result.schedule.scheduledAt.toISOString(),
      expectedScheduledAt.toISOString(),
    );
    assert.ok(result.reasoning.includes("ON_DEMAND_LINK"));
  });

  it("Maximum 4 attempts cap: Halts after 4 executed attempts", () => {
    const clock = new VirtualClock(new Date("2025-01-21T10:00:00.000Z"));
    const sequencer = new MandateRetrySequencer(clock);
    const event = createMockMandateEvent({ timestamp: failureTime });

    // 4 attempts already executed
    const result = sequencer.evaluate(event, mockDiagnosis, 4);

    assert.equal(result.shouldRetry, false);
    assert.equal(result.schedule, null);
    assert.equal(result.terminationReason, "MAX_ATTEMPTS_EXCEEDED");
    assert.ok(result.reasoning.includes("4 mandate debit attempts exhausted"));
  });

  it("Recovery window hard stop: Halts when hoursSinceFailure > 168h", () => {
    // 170 hours after failure
    const pastWindow = new Date(failureTime.getTime() + 170 * 60 * 60 * 1000);
    const clock = new VirtualClock(pastWindow);
    const sequencer = new MandateRetrySequencer(clock);
    const event = createMockMandateEvent({ timestamp: failureTime });

    const result = sequencer.evaluate(event, mockDiagnosis, 2);

    assert.equal(result.shouldRetry, false);
    assert.equal(result.schedule, null);
    assert.equal(result.terminationReason, "MANDATE_WINDOW_EXPIRED");
    assert.ok(result.reasoning.includes("168h has expired"));
  });

  it("Expired / Revoked mandate: Halts auto-debit and prompts customer re-authorization", () => {
    const clock = new VirtualClock(failureTime);
    const sequencer = new MandateRetrySequencer(clock);
    const event = createMockMandateEvent({
      errorCode: "MANDATE_EXPIRED",
      errorDescription: "Auto-debit mandate expired",
    });

    const expiredDiagnosis: DiagnosisResult = {
      category: "MANDATE_EXPIRED",
      rootCause: "Mandate expired or revoked",
      confidence: 0.95,
      isRecoverable: true,
      signals: [],
    };

    const result = sequencer.evaluate(event, expiredDiagnosis, 0);

    assert.equal(result.shouldRetry, false);
    assert.equal(result.isExpiredMandate, true);
    assert.equal(result.schedule, null);
    assert.equal(result.terminationReason, "MANDATE_EXPIRED");
    assert.ok(result.reasoning.includes("re-authorization workflow"));
  });

  it("Fraud-blocked mandate: Immediately prohibits retry", () => {
    const clock = new VirtualClock(failureTime);
    const sequencer = new MandateRetrySequencer(clock);
    const event = createMockMandateEvent({ errorCode: "FRAUD_DETECTED" });

    const fraudDiagnosis: DiagnosisResult = {
      category: "FRAUD_BLOCK",
      rootCause: "Fraud detected on recurring mandate",
      confidence: 0.99,
      isRecoverable: false,
      signals: [],
    };

    const result = sequencer.evaluate(event, fraudDiagnosis, 0);

    assert.equal(result.shouldRetry, false);
    assert.equal(result.schedule, null);
    assert.equal(result.terminationReason, "FRAUD_DETECTED");
  });

  it("Card payment method: Uses CARD_AUTODEBIT rail for initial attempts", () => {
    const clock = new VirtualClock(failureTime);
    const sequencer = new MandateRetrySequencer(clock);
    const event = createMockMandateEvent({
      method: "DEBIT_CARD",
      timestamp: failureTime,
    });

    const result = sequencer.evaluate(event, mockDiagnosis, 0);

    assert.equal(result.shouldRetry, true);
    assert.ok(result.schedule !== null, "Card autodebit T+0 schedule must be produced");
    assert.equal(result.schedule.rail, "CARD_AUTODEBIT");
    // T+0 is immediate — scheduledAt must equal failureTime (no bank window alignment for attempt 1)
    assert.equal(
      result.schedule.scheduledAt.getTime(),
      failureTime.getTime(),
      "T+0 card autodebit should schedule at failure time",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. StrategyAgent Mandate Routing Tests
// ---------------------------------------------------------------------------

describe("StrategyAgent — Mandate Routing Integration", () => {
  const failureTime = new Date("2025-01-15T04:30:00.000Z");

  it("Routes recurring mandate to SMART_RETRY with mandateSchedule at T+0", () => {
    const clock = new VirtualClock(failureTime);
    const agent = new StrategyAgent(clock);
    const event = createMockMandateEvent({ timestamp: failureTime });

    const result = agent.select(event, mockDiagnosis, mockRiskAssessment);

    assert.equal(result.strategy, "SMART_RETRY");
    assert.ok(result.executionParams.mandateSchedule !== null, "T+0 mandateSchedule must be produced");
    assert.equal(result.executionParams.mandateSchedule?.attemptNumber, 1);
    assert.equal(result.executionParams.mandateSchedule?.rail, "UPI_AUTOPAY");
    // T+0 mandate should schedule at failure time (immediate, no bank window alignment)
    assert.equal(
      result.executionParams.mandateSchedule?.scheduledAt.getTime(),
      failureTime.getTime(),
      "T+0 mandate should schedule at failure time",
    );
  });

  it("Routes recurring mandate to SMART_RETRY with E_NACH rail at T+96h", () => {
    const timeT96 = new Date(failureTime.getTime() + 96 * 60 * 60 * 1000);
    const clock = new VirtualClock(timeT96);
    const agent = new StrategyAgent(clock);
    const event = createMockMandateEvent({ timestamp: failureTime });

    const result = agent.select(event, mockDiagnosis, mockRiskAssessment, 96);

    assert.equal(result.strategy, "SMART_RETRY");
    assert.ok(result.executionParams.mandateSchedule !== null, "T+96h mandateSchedule must be produced");
    assert.equal(result.executionParams.mandateSchedule?.attemptNumber, 3);
    assert.equal(result.executionParams.mandateSchedule?.rail, "E_NACH");
    // 10:15 AM IST = 04:45 UTC on Jan 19 (T+96h from Jan 15 failure, bank window aligned)
    const scheduledT96 = result.executionParams.mandateSchedule!.scheduledAt;
    assert.equal(scheduledT96.getUTCHours(), 4, "T+96h should target 04:45 UTC (10:15 AM IST)");
    assert.equal(scheduledT96.getUTCMinutes(), 45, "T+96h should target 04:45 UTC (10:15 AM IST)");
    assert.equal(scheduledT96.getUTCDate(), 19, "T+96h should land on Jan 19");
  });

  it("Routes recurring mandate to ALT_PAYMENT with ON_DEMAND_LINK at T+144h", () => {
    const timeT144 = new Date(failureTime.getTime() + 144 * 60 * 60 * 1000);
    const clock = new VirtualClock(timeT144);
    const agent = new StrategyAgent(clock);
    const event = createMockMandateEvent({ timestamp: failureTime });

    const result = agent.select(event, mockDiagnosis, mockRiskAssessment, 144);

    assert.equal(result.strategy, "ALT_PAYMENT");
    assert.ok(result.executionParams.mandateSchedule !== null, "T+144h mandateSchedule must be produced");
    assert.equal(result.executionParams.mandateSchedule?.attemptNumber, 4);
    assert.equal(result.executionParams.mandateSchedule?.rail, "ON_DEMAND_LINK");
    assert.equal(result.executionParams.channel, "email");
    // 10:15 AM IST = 04:45 UTC on Jan 21 (T+144h from Jan 15 failure, bank window aligned)
    const scheduledT144 = result.executionParams.mandateSchedule!.scheduledAt;
    assert.equal(scheduledT144.getUTCHours(), 4, "T+144h should target 04:45 UTC (10:15 AM IST)");
    assert.equal(scheduledT144.getUTCMinutes(), 45, "T+144h should target 04:45 UTC (10:15 AM IST)");
    assert.equal(scheduledT144.getUTCDate(), 21, "T+144h should land on Jan 21");
  });

  it("Routes expired mandate to ALT_PAYMENT re-authorization workflow", () => {
    const clock = new VirtualClock(failureTime);
    const agent = new StrategyAgent(clock);
    const event = createMockMandateEvent({
      errorCode: "MANDATE_EXPIRED",
      timestamp: failureTime,
    });

    const expiredDiagnosis: DiagnosisResult = {
      category: "MANDATE_EXPIRED",
      rootCause: "Mandate expired",
      confidence: 0.95,
      isRecoverable: true,
      signals: [],
    };

    const result = agent.select(event, expiredDiagnosis, mockRiskAssessment);

    assert.equal(result.strategy, "ALT_PAYMENT");
    assert.equal(result.executionParams.channel, "email");
    assert.ok(
      result.executionParams.messageContent?.includes("re-authorize"),
    );
  });

  it("Non-recurring payment does NOT use mandate sequencer", () => {
    const clock = new VirtualClock(failureTime);
    const agent = new StrategyAgent(clock);
    const nonMandateEvent: PaymentFailureEvent = {
      ...createMockMandateEvent({ timestamp: failureTime }),
      isRecurring: false,
      subscriptionId: null,
      mandateId: null,
      errorCode: "CHECKOUT_ABANDONED",
    };

    const cartDiagnosis: DiagnosisResult = {
      category: "CHECKOUT_ABANDONED",
      rootCause: "Customer abandoned cart",
      confidence: 0.9,
      isRecoverable: true,
      signals: [],
    };

    const result = agent.select(nonMandateEvent, cartDiagnosis, mockRiskAssessment);
    assert.equal(result.strategy, "CUSTOMER_NUDGE");
    assert.equal(result.executionParams.mandateSchedule, undefined);
  });
});

// ---------------------------------------------------------------------------
// 3. Multi-Attempt Pipeline Lifecycle Integration (Finding 2 Resolution)
// ---------------------------------------------------------------------------

describe("Mandate Multi-Attempt Pipeline Lifecycle (Finding 2 Resolution)", () => {
  const failureTime = new Date("2025-01-15T04:30:00.000Z"); // Jan 15, 10:00 AM IST

  it("Mandate payment survives past standard 72h window and executes attempts at T+48h, T+96h, T+144h", () => {
    const clock = new VirtualClock(failureTime);
    const stoppingRules = new StoppingRulesEngine(clock);
    const strategyAgent = new StrategyAgent(clock);
    const event = createMockMandateEvent({ timestamp: failureTime });

    // --- T+0h: Initial Debit Attempt 1 ---
    const stopDecisionT0 = stoppingRules.evaluate(event, [], false);
    assert.equal(stopDecisionT0.shouldStop, false);

    const stratT0 = strategyAgent.select(event, mockDiagnosis, mockRiskAssessment, 0);
    assert.equal(stratT0.strategy, "SMART_RETRY");
    assert.equal(stratT0.executionParams.mandateSchedule?.attemptNumber, 1);

    // --- T+48h: Attempt 1 Failed -> Schedule Attempt 2 ---
    clock.advanceHours(48);
    const attemptsAfter1 = [
      { attemptNumber: 1, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
    ];
    const stopDecisionT48 = stoppingRules.evaluate(event, attemptsAfter1, false);
    assert.equal(stopDecisionT48.shouldStop, false);

    const stratT48 = strategyAgent.select(event, mockDiagnosis, mockRiskAssessment, 48);
    assert.equal(stratT48.strategy, "SMART_RETRY");
    assert.equal(stratT48.executionParams.mandateSchedule?.attemptNumber, 2);

    // --- T+96h: Attempt 2 Failed -> Schedule Attempt 3 (Beyond 72h standard window!) ---
    // THIS IS THE CRITICAL CHECK FOR FINDING 2:
    // A standard payment would be halted at 72h by Rule 5.
    // Mandate payment MUST survive to T+96h and beyond!
    clock.advanceHours(48); // now T+96h
    const attemptsAfter2 = [
      { attemptNumber: 1, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 2, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
    ];
    const stopDecisionT96 = stoppingRules.evaluate(event, attemptsAfter2, false);
    assert.equal(
      stopDecisionT96.shouldStop,
      false,
      "Mandate payment at T+96h must NOT be stopped by 72h standard window!",
    );

    const stratT96 = strategyAgent.select(event, mockDiagnosis, mockRiskAssessment, 96);
    assert.equal(stratT96.strategy, "SMART_RETRY");
    assert.equal(stratT96.executionParams.mandateSchedule?.attemptNumber, 3);
    assert.equal(stratT96.executionParams.mandateSchedule?.rail, "E_NACH");

    // --- T+144h: Attempt 3 Failed -> Schedule Attempt 4 ---
    clock.advanceHours(48); // now T+144h
    const attemptsAfter3 = [
      { attemptNumber: 1, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 2, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
      { attemptNumber: 3, strategy: "SMART_RETRY" as const, outcome: "FAILED" as const },
    ];
    const stopDecisionT144 = stoppingRules.evaluate(event, attemptsAfter3, false);
    assert.equal(
      stopDecisionT144.shouldStop,
      false,
      "Mandate payment at T+144h must NOT be stopped by 72h standard window!",
    );

    const stratT144 = strategyAgent.select(event, mockDiagnosis, mockRiskAssessment, 144);
    assert.equal(stratT144.strategy, "ALT_PAYMENT");
    assert.equal(stratT144.executionParams.mandateSchedule?.attemptNumber, 4);
    assert.equal(stratT144.executionParams.mandateSchedule?.rail, "ON_DEMAND_LINK");

    // --- T+170h: Window Expiry (> 168h) -> Stopped by Rule 5 ---
    clock.advanceHours(26); // now T+170h
    const stopDecisionT170 = stoppingRules.evaluate(event, attemptsAfter3, false);
    assert.equal(stopDecisionT170.shouldStop, true);
    assert.equal(stopDecisionT170.rule, "RECOVERY_WINDOW_EXPIRED");
    assert.ok(stopDecisionT170.reason.includes("168-hour"));
  });

  it("Standard non-mandate payment is stopped at T+73h while mandate payment proceeds", () => {
    const clock = new VirtualClock(new Date(failureTime.getTime() + 73 * 60 * 60 * 1000));
    const stoppingRules = new StoppingRulesEngine(clock);

    const standardEvent = {
      ...createMockMandateEvent({ timestamp: failureTime }),
      isRecurring: false,
      mandateId: null,
    };
    const mandateEvent = createMockMandateEvent({ timestamp: failureTime });

    const standardDecision = stoppingRules.evaluate(standardEvent, [], false);
    assert.equal(
      standardDecision.shouldStop,
      true,
      "Standard payment must expire at 72h window",
    );
    assert.equal(standardDecision.rule, "RECOVERY_WINDOW_EXPIRED");

    const mandateDecision = stoppingRules.evaluate(mandateEvent, [], false);
    assert.equal(
      mandateDecision.shouldStop,
      false,
      "Mandate payment must NOT expire at 72h (allowed up to 168h)",
    );
  });
});
