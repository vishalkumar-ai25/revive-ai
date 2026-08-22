import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { db } from "./src/lib/db.js";
import { RecoveryEngine } from "./src/lib/engine/recovery-engine.js";
import { VirtualClock } from "./src/lib/time/clock.js";

describe("RecoveryEngine — Temporal Correctness (Bug 1 Regression)", () => {
  before(async () => {
    // Clear relevant tables
    await db.auditLog.deleteMany({});
    await db.recoveryAttempt.deleteMany({});
    await db.failureEvent.deleteMany({});
    await db.payment.deleteMany({});
    
    // Create the dummy merchant to satisfy FK
    await db.merchant.upsert({
      where: { id: "merch_001" },
      create: { id: "merch_001", name: "Test Merchant", email: "merch1@test.com" },
      update: {},
    });
  });

  it("tick() reconstructs event.timestamp from failedAt, avoiding clock drift", async () => {
    const t0 = new Date("2025-01-15T12:00:00.000Z");
    const clock = new VirtualClock(t0);
    const engine = new RecoveryEngine(clock);

    // Payment A failed exactly at t0
    const eventA = {
      externalId: "pay_bug1_A", merchantId: "merch_001", customerId: "cust_001",
      amount: 1000, currency: "INR", method: "UPI" as const, bank: "HDFC", upiApp: "GPAY",
      errorCode: "BANK_TIMEOUT", errorDescription: "Timeout", isRecurring: false, subscriptionId: null, mandateId: null,
      timestamp: t0,
    };

    // Payment B failed 20 hours BEFORE t0
    const tMinus20 = new Date(t0.getTime() - 20 * 60 * 60 * 1000);
    const eventB = {
      externalId: "pay_bug1_B", merchantId: "merch_001", customerId: "cust_002",
      amount: 1000, currency: "INR", method: "UPI" as const, bank: "HDFC", upiApp: "GPAY",
      errorCode: "BANK_TIMEOUT", errorDescription: "Timeout", isRecurring: false, subscriptionId: null, mandateId: null,
      timestamp: tMinus20,
    };

    // Intake both at t0
    await engine.intake(eventA);
    await engine.intake(eventB);

    // Verify DB insertion has the correct failedAt
    const pA = await db.payment.findUniqueOrThrow({ where: { externalId: "pay_bug1_A" } });
    const pB = await db.payment.findUniqueOrThrow({ where: { externalId: "pay_bug1_B" } });
    assert.equal(pA.failedAt.toISOString(), t0.toISOString());
    assert.equal(pB.failedAt.toISOString(), tMinus20.toISOString());

    // Advance clock by 5 hours (so A is T+5h, B is T+25h)
    clock.advanceHours(5);
    
    // Process B via tick. B is >24h old, should escalate to SMS level.
    await engine.tick(clock.now());

    const attemptsA = await db.recoveryAttempt.findMany({ where: { paymentId: pA.id }, orderBy: { attemptNumber: "desc" } });
    const attemptsB = await db.recoveryAttempt.findMany({ where: { paymentId: pB.id }, orderBy: { attemptNumber: "desc" } });
    
    // The latest attempt (PENDING) should reflect the correct escalation level
    // Wait, attemptA index 0 might be PENDING from tick scheduling it, or from intake if tick didn't execute it.
    // At T+5h, A should have executed its initial attempt and scheduled Attempt 2.
    // A failed at t0. At t0, it schedules Attempt 1 as PENDING. At T+5h, tick executes Attempt 1, fails it, schedules Attempt 2.
    assert.equal(attemptsA[0].escalationLevel, "LEVEL_2_EMAIL");
    assert.equal(attemptsB[0].escalationLevel, "LEVEL_3_SMS");
  });
});
