// =============================================================================
// DIAGNOSIS AGENT TESTS — Task 4.3
// =============================================================================
// Unit tests for DiagnosisAgent covering:
//   1. Deterministic error code mapping across all 12 FailureCategory enums.
//   2. Signal extraction (error code match, late night high-risk window, recurring mandate).
//   3. Root cause explanation generation for each failure category.
//   4. Fallback behavior for unmapped error codes (UNKNOWN category, 0.4 confidence).
//   5. Fraud block recoverability invariants.
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DiagnosisAgent } from "../src/lib/agents/diagnosis-agent.js";
import type { PaymentFailureEvent } from "../src/lib/types.js";

function createMockEvent(overrides: Partial<PaymentFailureEvent> = {}): PaymentFailureEvent {
  return {
    externalId: "pay_diag_test_001",
    merchantId: "merch_001",
    customerId: "cust_001",
    amount: 1500,
    currency: "INR",
    method: "UPI",
    bank: "HDFC",
    upiApp: "GPAY",
    errorCode: "BANK_TIMEOUT",
    errorDescription: "Bank server did not respond",
    isRecurring: false,
    subscriptionId: null,
    mandateId: null,
    timestamp: new Date("2025-01-15T04:30:00.000Z"), // 10:00 AM IST
    ...overrides,
  };
}

describe("DiagnosisAgent — Error Code Mapping", () => {
  const agent = new DiagnosisAgent();

  const testCases = [
    { errorCode: "BANK_TIMEOUT", expectedCategory: "BANK_TIMEOUT", isRecoverable: true },
    { errorCode: "SERVER_TIMEOUT", expectedCategory: "BANK_TIMEOUT", isRecoverable: true },
    { errorCode: "GATEWAY_TIMEOUT", expectedCategory: "BANK_TIMEOUT", isRecoverable: true },
    { errorCode: "INSUFFICIENT_FUNDS", expectedCategory: "INSUFFICIENT_FUNDS", isRecoverable: true },
    { errorCode: "INSUFFICIENT_BALANCE", expectedCategory: "INSUFFICIENT_FUNDS", isRecoverable: true },
    { errorCode: "CARD_DECLINED", expectedCategory: "CARD_DECLINED", isRecoverable: true },
    { errorCode: "DO_NOT_HONOR", expectedCategory: "CARD_DECLINED", isRecoverable: true },
    { errorCode: "RESTRICTED_CARD", expectedCategory: "CARD_DECLINED", isRecoverable: true },
    { errorCode: "NETWORK_ERROR", expectedCategory: "NETWORK_ERROR", isRecoverable: true },
    { errorCode: "CONNECTION_FAILED", expectedCategory: "NETWORK_ERROR", isRecoverable: true },
    { errorCode: "UPI_PSP_ERROR", expectedCategory: "UPI_PSP_ERROR", isRecoverable: true },
    { errorCode: "PSP_TIMEOUT", expectedCategory: "UPI_PSP_ERROR", isRecoverable: true },
    { errorCode: "VPA_NOT_FOUND", expectedCategory: "UPI_PSP_ERROR", isRecoverable: true },
    { errorCode: "OTP_EXPIRED", expectedCategory: "OTP_EXPIRED", isRecoverable: true },
    { errorCode: "OTP_TIMEOUT", expectedCategory: "OTP_EXPIRED", isRecoverable: true },
    { errorCode: "LIMIT_EXCEEDED", expectedCategory: "LIMIT_EXCEEDED", isRecoverable: true },
    { errorCode: "DAILY_LIMIT", expectedCategory: "LIMIT_EXCEEDED", isRecoverable: true },
    { errorCode: "FRAUD_DETECTED", expectedCategory: "FRAUD_BLOCK", isRecoverable: false },
    { errorCode: "SUSPECTED_FRAUD", expectedCategory: "FRAUD_BLOCK", isRecoverable: false },
    { errorCode: "MANDATE_EXPIRED", expectedCategory: "MANDATE_EXPIRED", isRecoverable: true },
    { errorCode: "MANDATE_REVOKED", expectedCategory: "MANDATE_EXPIRED", isRecoverable: true },
    { errorCode: "CHECKOUT_ABANDONED", expectedCategory: "CHECKOUT_ABANDONED", isRecoverable: true },
    { errorCode: "SUBSCRIPTION_FAILED", expectedCategory: "SUBSCRIPTION_FAILED", isRecoverable: true },
    { errorCode: "SUBSCRIPTION_CANCELLED", expectedCategory: "SUBSCRIPTION_FAILED", isRecoverable: true },
  ];

  for (const { errorCode, expectedCategory, isRecoverable } of testCases) {
    it(`Maps error code ${errorCode} -> category ${expectedCategory}`, async () => {
      const event = createMockEvent({ errorCode });
      const diagnosis = await agent.diagnose(event);

      assert.equal(diagnosis.category, expectedCategory);
      assert.equal(diagnosis.isRecoverable, isRecoverable);
      assert.equal(diagnosis.confidence, 0.85);
      assert.ok(diagnosis.rootCause.length > 0);
    });
  }

  it("Handles unrecognized error code: returns UNKNOWN with 0.40 confidence", async () => {
    const event = createMockEvent({ errorCode: "UNKNOWN_CUSTOM_ERROR_404" });
    const diagnosis = await agent.diagnose(event);

    assert.equal(diagnosis.category, "UNKNOWN");
    assert.equal(diagnosis.confidence, 0.40);
    assert.equal(diagnosis.isRecoverable, true);
    assert.ok(diagnosis.rootCause.includes("UNKNOWN_CUSTOM_ERROR_404"));
  });
});

describe("DiagnosisAgent — Signal Extraction", () => {
  const agent = new DiagnosisAgent();

  it("Extracts late_night_failure signal during late night hours (23:00 - 02:00)", async () => {
    // 23:30 local time
    const lateNightDate = new Date("2025-01-15T23:30:00");
    const event = createMockEvent({
      errorCode: "BANK_TIMEOUT",
      timestamp: lateNightDate,
    });

    const diagnosis = await agent.diagnose(event);
    const lateNightSignal = diagnosis.signals.find((s) => s.name === "late_night_failure");

    assert.ok(lateNightSignal !== undefined);
    assert.equal(lateNightSignal?.weight, 0.7);
  });

  it("Extracts recurring_payment signal when isRecurring is true", async () => {
    const event = createMockEvent({
      isRecurring: true,
      subscriptionId: "sub_premium_monthly",
    });

    const diagnosis = await agent.diagnose(event);
    const recurringSignal = diagnosis.signals.find((s) => s.name === "recurring_payment");

    assert.ok(recurringSignal !== undefined);
    assert.equal(recurringSignal?.value, "sub_premium_monthly");
    assert.equal(recurringSignal?.weight, 0.6);
  });
});
