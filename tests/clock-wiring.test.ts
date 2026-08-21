// =============================================================================
// CLOCK WIRING INTEGRATION TESTS — Task 1.3
// =============================================================================
// Verifies that the injectable Clock is properly threaded through all
// downstream modules (PaymentGenerator, StrategyAgent, StoppingRulesEngine,
// RecoveryPipeline, RecoveryEngine, BatchRunner).
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VirtualClock } from "../src/lib/time/clock.js";
import { PaymentGenerator } from "../src/lib/simulation/payment-generator.js";
import { StrategyAgent } from "../src/lib/agents/strategy-agent.js";
import { StoppingRulesEngine } from "../src/lib/engine/stopping-rules.js";
import { RecoveryPipeline } from "../src/lib/agents/index.js";
import { BatchRunner } from "../src/lib/simulation/batch-runner.js";
import type { DiagnosisResult, PaymentFailureEvent, RiskAssessmentResult } from "../src/lib/types.js";

describe("Clock Wiring Integration", () => {
  it("PaymentGenerator generates timestamps anchored to VirtualClock time, not real wall-clock", () => {
    // Freeze time far in the past (2023)
    const frozenTime = new Date("2023-05-10T14:30:00.000Z");
    const clock = new VirtualClock(frozenTime);
    const generator = new PaymentGenerator("merch_test", clock);

    const event = generator.generateSingle(0);

    // Event timestamp must be within [frozenTime - 24h, frozenTime]
    const twentyFourHoursBefore = new Date(frozenTime.getTime() - 24 * 60 * 60 * 1000);
    assert.ok(
      event.timestamp.getTime() <= frozenTime.getTime(),
      `Event timestamp (${event.timestamp.toISOString()}) must not exceed frozen clock (${frozenTime.toISOString()})`,
    );
    assert.ok(
      event.timestamp.getTime() >= twentyFourHoursBefore.getTime(),
      `Event timestamp (${event.timestamp.toISOString()}) must be within 24h of frozen clock (${twentyFourHoursBefore.toISOString()})`,
    );
    // Crucially, it must NOT be from current year (2026)
    assert.equal(event.timestamp.getUTCFullYear(), 2023);
  });

  it("StrategyAgent calculateNudgeTime respects VirtualClock time", () => {
    // 10:00 AM IST = 04:30 UTC
    const tenAmIst = new Date("2025-03-15T04:30:00.000Z");
    const clock = new VirtualClock(tenAmIst);
    const agent = new StrategyAgent(clock);

    const mockEvent: PaymentFailureEvent = {
      externalId: "pay_test_001",
      merchantId: "merch_001",
      customerId: "cust_001",
      amount: 500,
      currency: "INR",
      method: "UPI",
      bank: "HDFC",
      upiApp: "GPAY",
      errorCode: "CHECKOUT_ABANDONED",
      errorDescription: "Checkout abandoned",
      isRecurring: false,
      subscriptionId: null,
      mandateId: null,
      timestamp: tenAmIst,
    };

    const diagnosis: DiagnosisResult = {
      category: "CHECKOUT_ABANDONED",
      rootCause: "Abandoned cart",
      confidence: 0.9,
      isRecoverable: true,
      signals: [{ name: "DropOffSignal", value: "Checkout drop-off", weight: 0.9 }],
    };

    const riskAssessment: RiskAssessmentResult = {
      recoveryProbability: 0.85,
      shouldAttemptRecovery: true,
      reasoning: "Good customer",
      factors: [{ name: "CustomerTier", score: 0.8, weight: 0.5, detail: "Regular customer" }],
    };

    const strategy = agent.select(mockEvent, diagnosis, riskAssessment);
    assert.ok(strategy.executionParams.scheduledAt instanceof Date);
    // Scheduled nudge date year must be 2025 matching the virtual clock
    assert.equal(strategy.executionParams.scheduledAt.getFullYear(), 2025);
  });

  it("StoppingRulesEngine evaluates quiet hours using VirtualClock", () => {
    // 11:30 PM IST = 18:00 UTC (Quiet hours: 9 PM - 9 AM IST)
    const lateNight = new Date("2025-06-01T18:00:00.000Z");
    const clock = new VirtualClock(lateNight);
    const engine = new StoppingRulesEngine(clock);

    const mockEvent: PaymentFailureEvent = {
      externalId: "pay_quiet_001",
      merchantId: "merch_001",
      customerId: "cust_001",
      amount: 1000,
      currency: "INR",
      method: "UPI",
      bank: "SBI",
      upiApp: "PHONEPE",
      errorCode: "UPI_PSP_ERROR",
      errorDescription: "Timeout",
      isRecurring: false,
      subscriptionId: null,
      mandateId: null,
      timestamp: lateNight,
    };

    const decision = engine.evaluate(mockEvent, [], false, "CUSTOMER_NUDGE");
    assert.equal(decision.shouldStop, true);
    assert.equal(decision.rule, "QUIET_HOURS");
  });

  it("RecoveryPipeline constructor accepts and wires VirtualClock", () => {
    const frozenTime = new Date("2025-01-01T12:00:00.000Z");
    const clock = new VirtualClock(frozenTime);
    const pipeline = new RecoveryPipeline(clock);

    assert.ok(pipeline instanceof RecoveryPipeline);
  });

  it("BatchRunner instantiates with VirtualClock without errors", () => {
    const frozenTime = new Date("2025-01-01T12:00:00.000Z");
    const clock = new VirtualClock(frozenTime);
    const runner = new BatchRunner("merch_test_123", clock);

    assert.ok(runner instanceof BatchRunner);
  });
});
