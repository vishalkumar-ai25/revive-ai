// =============================================================================
// RECOVERY PIPELINE END-TO-END TESTS — Task 4.2
// =============================================================================
// Comprehensive test suite covering:
//   1. Full multi-agent pipeline flow (Diagnosis -> Risk Assessment -> Strategy Selection).
//   2. Deterministic rule-based fallback when LLM is bypassed, unconfigured, or throws.
//   3. Retry pipeline execution via processRetry() (bypassing DiagnosisAgent and duplicate audit logs).
//   4. Resilience against noisy / malformed webhook payloads ("chaos" inputs).
//   5. Audit trail schema and provenance invariants.
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RecoveryPipeline } from "../src/lib/agents/index.js";
import { VirtualClock } from "../src/lib/time/clock.js";
import type {
  CustomerHistory,
  DiagnosisResult,
  PaymentFailureEvent,
} from "../src/lib/types.js";

// Helper to create a base mock payment failure event
function createMockEvent(overrides: Partial<PaymentFailureEvent> = {}): PaymentFailureEvent {
  return {
    externalId: "pay_pipe_test_001",
    merchantId: "merch_001",
    customerId: "cust_001",
    amount: 2499,
    currency: "INR",
    method: "UPI",
    bank: "HDFC",
    upiApp: "GPAY",
    errorCode: "BANK_TIMEOUT",
    errorDescription: "HDFC bank server did not respond within timeout window",
    isRecurring: false,
    subscriptionId: null,
    mandateId: null,
    timestamp: new Date("2025-01-15T04:30:00.000Z"), // 10:00 AM IST
    ...overrides,
  };
}

const mockCustomerHistory: CustomerHistory = {
  totalPurchases: 8,
  lifetimeValue: 18500,
  previousFailures: 1,
  daysSinceLastPurchase: 14,
};

// ---------------------------------------------------------------------------
// 1. Full Multi-Agent Pipeline Flow (process())
// ---------------------------------------------------------------------------

describe("RecoveryPipeline — Full Multi-Agent Flow (process())", () => {
  const clock = new VirtualClock(new Date("2025-01-15T04:30:00.000Z"));
  const pipeline = new RecoveryPipeline(clock);

  it("Standard recoverable failure: classifies, scores risk, selects SMART_RETRY", async () => {
    const event = createMockEvent({ errorCode: "BANK_TIMEOUT" });
    const result = await pipeline.process(event, mockCustomerHistory, "pay_db_001");

    // Stage 1: Diagnosis
    assert.equal(result.diagnosis.category, "BANK_TIMEOUT");
    assert.equal(result.diagnosis.isRecoverable, true);
    assert.ok(result.diagnosis.confidence >= 0.8);
    assert.ok(result.diagnosis.rootCause.includes("HDFC"));

    // Stage 2: Risk Assessment
    assert.ok(result.riskAssessment.recoveryProbability > 0.6);
    assert.equal(result.riskAssessment.shouldAttemptRecovery, true);
    assert.ok(result.riskAssessment.factors.length > 0);

    // Stage 3: Strategy Selection
    assert.equal(result.strategy.strategy, "SMART_RETRY");
    assert.ok(result.strategy.confidence >= 0.7);
    assert.ok(result.strategy.executionParams.scheduledAt instanceof Date);
    assert.ok(result.processingTimeMs >= 0);
  });

  it("Cart abandonment: diagnoses checkout drop-off, selects CUSTOMER_NUDGE", async () => {
    const event = createMockEvent({
      errorCode: "CHECKOUT_ABANDONED",
      errorDescription: "Customer abandoned payment session",
    });
    const result = await pipeline.process(event, mockCustomerHistory);

    assert.equal(result.diagnosis.category, "CHECKOUT_ABANDONED");
    assert.equal(result.diagnosis.isRecoverable, true);
    assert.equal(result.strategy.strategy, "CUSTOMER_NUDGE");
    assert.equal(result.strategy.executionParams.channel, "email");
    assert.ok(result.strategy.executionParams.messageContent !== null);
  });

  it("Fraud zero-tolerance: halts recovery with DO_NOTHING and shouldAttemptRecovery: false", async () => {
    const event = createMockEvent({
      errorCode: "FRAUD_DETECTED",
      errorDescription: "Transaction declined - suspected fraudulent activity",
    });
    const result = await pipeline.process(event, mockCustomerHistory);

    assert.equal(result.diagnosis.category, "FRAUD_BLOCK");
    assert.equal(result.diagnosis.isRecoverable, false);
    assert.equal(result.riskAssessment.shouldAttemptRecovery, false);
    assert.equal(result.strategy.strategy, "DO_NOTHING");
    assert.ok(result.strategy.reasoning.includes("Recovery skipped"));
  });

  it("Recurring mandate failure: routes to MandateRetrySequencer with mandateSchedule", async () => {
    const event = createMockEvent({
      isRecurring: true,
      mandateId: "mandate_sub_999",
      errorCode: "BANK_TIMEOUT",
    });
    const result = await pipeline.process(event, mockCustomerHistory);

    assert.equal(result.strategy.strategy, "SMART_RETRY");
    assert.ok(result.strategy.executionParams.mandateSchedule !== null);
    assert.equal(result.strategy.executionParams.mandateSchedule?.attemptNumber, 1);
    assert.equal(result.strategy.executionParams.mandateSchedule?.rail, "UPI_AUTOPAY");
    assert.ok(result.strategy.executionParams.mandateSchedule?.preDebitNotificationSentAt instanceof Date);
  });
});

// ---------------------------------------------------------------------------
// 2. Deterministic Rule Fallback (LLM Bypass & Resilience)
// ---------------------------------------------------------------------------

describe("RecoveryPipeline — Rule-Based Fallback & Error Resilience", () => {
  const clock = new VirtualClock(new Date("2025-01-15T04:30:00.000Z"));
  const pipeline = new RecoveryPipeline(clock);

  it("Maps all primary payment gateway error codes to valid FailureCategory enums", async () => {
    const errorCodesToTest = [
      { code: "BANK_TIMEOUT", expected: "BANK_TIMEOUT" },
      { code: "INSUFFICIENT_FUNDS", expected: "INSUFFICIENT_FUNDS" },
      { code: "CARD_DECLINED", expected: "CARD_DECLINED" },
      { code: "NETWORK_ERROR", expected: "NETWORK_ERROR" },
      { code: "UPI_PSP_ERROR", expected: "UPI_PSP_ERROR" },
      { code: "OTP_EXPIRED", expected: "OTP_EXPIRED" },
      { code: "LIMIT_EXCEEDED", expected: "LIMIT_EXCEEDED" },
      { code: "FRAUD_DETECTED", expected: "FRAUD_BLOCK" },
      { code: "MANDATE_EXPIRED", expected: "MANDATE_EXPIRED" },
      { code: "CHECKOUT_ABANDONED", expected: "CHECKOUT_ABANDONED" },
      { code: "SUBSCRIPTION_FAILED", expected: "SUBSCRIPTION_FAILED" },
    ];

    for (const { code, expected } of errorCodesToTest) {
      const event = createMockEvent({ errorCode: code });
      const result = await pipeline.process(event, mockCustomerHistory);
      assert.equal(
        result.diagnosis.category,
        expected,
        `Error code ${code} should map to ${expected}`,
      );
    }
  });

  it("Handles unknown error codes gracefully by falling back to UNKNOWN category", async () => {
    const event = createMockEvent({
      errorCode: "RANDOM_BANK_ERR_9988",
      errorDescription: "Unrecognized proprietary bank code",
    });
    const result = await pipeline.process(event, mockCustomerHistory);

    assert.equal(result.diagnosis.category, "UNKNOWN");
    assert.equal(result.diagnosis.confidence, 0.4);
    assert.ok(result.diagnosis.rootCause.includes("Unable to determine root cause"));
  });

  it("Expired mandate routes to customer re-authorization with ALT_PAYMENT", async () => {
    const event = createMockEvent({
      errorCode: "MANDATE_EXPIRED",
      isRecurring: true,
      mandateId: "mandate_exp_123",
    });
    const result = await pipeline.process(event, mockCustomerHistory);

    assert.equal(result.diagnosis.category, "MANDATE_EXPIRED");
    assert.equal(result.strategy.strategy, "ALT_PAYMENT");
    assert.equal(result.strategy.executionParams.channel, "email");
    assert.ok(result.strategy.executionParams.messageContent?.includes("re-authorize"));
  });
});

// ---------------------------------------------------------------------------
// 3. Retry Pipeline Lifecycle (processRetry())
// ---------------------------------------------------------------------------

describe("RecoveryPipeline — Retry Pipeline (processRetry())", () => {
  const clock = new VirtualClock(new Date("2025-01-17T04:30:00.000Z")); // T+48h
  const pipeline = new RecoveryPipeline(clock);

  const persistedDiagnosis: DiagnosisResult = {
    category: "BANK_TIMEOUT",
    rootCause: "HDFC bank timeout on initial attempt",
    confidence: 0.85,
    isRecoverable: true,
    signals: [{ name: "error_code_match", value: "BANK_TIMEOUT", weight: 0.9 }],
  };

  it("Executes Risk Assessment & Strategy Selection while preserving existing diagnosis", async () => {
    const event = createMockEvent({ timestamp: new Date("2025-01-15T04:30:00.000Z") });
    const retryResult = await pipeline.processRetry(
      event,
      persistedDiagnosis,
      mockCustomerHistory,
      "pay_db_002",
    );

    // Diagnosis is carried through intact
    assert.equal(retryResult.diagnosis.category, "BANK_TIMEOUT");
    assert.equal(retryResult.diagnosis.rootCause, persistedDiagnosis.rootCause);

    // Risk and Strategy stages execute cleanly
    assert.equal(retryResult.riskAssessment.shouldAttemptRecovery, true);
    assert.equal(retryResult.strategy.strategy, "SMART_RETRY");
    assert.ok(retryResult.processingTimeMs >= 0);
  });

  it("Re-evaluates customer history on subsequent attempts", async () => {
    const highFailureHistory: CustomerHistory = {
      ...mockCustomerHistory,
      previousFailures: 4,
      totalPurchases: 1,
    };
    const event = createMockEvent();

    const result = await pipeline.processRetry(
      event,
      persistedDiagnosis,
      highFailureHistory,
    );

    // Risk score reflects historical failures
    assert.ok(result.riskAssessment.recoveryProbability < 0.85);
  });
});

// ---------------------------------------------------------------------------
// 4. Resilience Against Noisy / Malformed Webhooks ("Chaos" Inputs)
// ---------------------------------------------------------------------------

describe("RecoveryPipeline — Chaos & Malformed Webhook Payload Resilience", () => {
  const clock = new VirtualClock(new Date("2025-01-15T04:30:00.000Z"));
  const pipeline = new RecoveryPipeline(clock);

  it("Processes payload with null bank and null upiApp without throwing", async () => {
    const event = createMockEvent({
      bank: null,
      upiApp: null,
      errorCode: "NETWORK_ERROR",
    });

    const result = await pipeline.process(event, mockCustomerHistory);
    assert.equal(result.diagnosis.category, "NETWORK_ERROR");
    assert.ok(result.strategy.strategy !== null);
  });

  it("Processes micro-transactions (₹1.00) without division by zero or NaN", async () => {
    const event = createMockEvent({ amount: 1.0 });
    const result = await pipeline.process(event, mockCustomerHistory);

    assert.ok(!isNaN(result.riskAssessment.recoveryProbability));
    assert.ok(!isNaN(result.strategy.confidence));
  });

  it("Processes high-value enterprise transactions (₹500,000)", async () => {
    const event = createMockEvent({ amount: 500000 });
    const result = await pipeline.process(event, mockCustomerHistory);

    assert.ok(result.riskAssessment.recoveryProbability > 0);
    assert.ok(result.riskAssessment.factors.some((f) => f.name === "payment_amount"));
  });

  it("Handles empty error description without string slicing exceptions", async () => {
    const event = createMockEvent({ errorDescription: "" });
    const result = await pipeline.process(event, mockCustomerHistory);

    assert.ok(result.diagnosis.rootCause.length > 0);
  });
});

// ---------------------------------------------------------------------------
// 5. Audit Trail Schema & Provenance Invariants
// ---------------------------------------------------------------------------

describe("RecoveryPipeline — Audit Trail Provenance", () => {
  const clock = new VirtualClock(new Date("2025-01-15T04:30:00.000Z"));
  const pipeline = new RecoveryPipeline(clock);

  it("PipelineResult structure conforms to authoritative PipelineResult interface", async () => {
    const event = createMockEvent();
    const result = await pipeline.process(event, mockCustomerHistory, "pay_audit_test");

    // Strict schema check on top-level result
    assert.ok("diagnosis" in result);
    assert.ok("riskAssessment" in result);
    assert.ok("strategy" in result);
    assert.ok("processingTimeMs" in result);

    // Diagnosis schema
    assert.ok(typeof result.diagnosis.category === "string");
    assert.ok(typeof result.diagnosis.confidence === "number");
    assert.ok(typeof result.diagnosis.isRecoverable === "boolean");
    assert.ok(Array.isArray(result.diagnosis.signals));

    // Risk Assessment schema
    assert.ok(typeof result.riskAssessment.recoveryProbability === "number");
    assert.ok(typeof result.riskAssessment.shouldAttemptRecovery === "boolean");
    assert.ok(Array.isArray(result.riskAssessment.factors));

    // Strategy schema
    assert.ok(typeof result.strategy.strategy === "string");
    assert.ok(typeof result.strategy.confidence === "number");
    assert.ok(typeof result.strategy.executionParams === "object");
  });
});
