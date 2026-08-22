import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { db } from "./src/lib/db.js";
import { RecoveryEngine } from "./src/lib/engine/recovery-engine.js";
import { VirtualClock } from "./src/lib/time/clock.js";

describe("RecoveryEngine — Quiet Hours (Bug 2 Regression)", () => {
  before(async () => {
    // Clear relevant tables
    await db.auditLog.deleteMany({});
    await db.recoveryAttempt.deleteMany({});
    await db.failureEvent.deleteMany({});
    await db.payment.deleteMany({});
    
    // Create the dummy merchant to satisfy FK
    await db.merchant.upsert({
      where: { id: "merch_002" },
      create: { id: "merch_002", name: "Test Merchant", email: "merch2@test.com" },
      update: {},
    });
  });

  it("tick() defers second attempt to next 9AM IST if it hits quiet hours, instead of killing", async () => {
    // Intake at 5 PM IST (11:30 UTC)
    const t0 = new Date("2025-01-15T11:30:00.000Z");
    const clock = new VirtualClock(t0);
    const engine = new RecoveryEngine(clock);

    const event = {
      externalId: "pay_bug2_A", merchantId: "merch_002", customerId: "cust_001",
      amount: 1000, currency: "INR", method: "UPI" as const, bank: "HDFC", upiApp: "GPAY",
      errorCode: "BANK_TIMEOUT", errorDescription: "Timeout", isRecurring: false, subscriptionId: null, mandateId: null,
      timestamp: t0,
    };

    // Intake at 5 PM IST. It schedules Attempt 1.
    await engine.intake(event);

    // Wait, wait. "tick() post-retry" is what we changed in Site 3.
    // If it's 5 PM IST, the first attempt executes immediately (if scheduledAt <= now).
    // Let's run tick() right away to execute Attempt 1.
    // Wait, SMART_RETRY or CUSTOMER_NUDGE? CUSTOMER_NUDGE is blocked by quiet hours, SMART_RETRY isn't.
    // Let's make sure it's a CUSTOMER_NUDGE that hits quiet hours.
    // If we use CHECKOUT_ABANDONED, the StrategyAgent uses CUSTOMER_NUDGE.
    
    const cartEvent = {
      ...event,
      errorCode: "CHECKOUT_ABANDONED",
    };

    // But wait, if it's CHECKOUT_ABANDONED, Attempt 1 is scheduled for 1 hour after intake (T+1h).
    // Let's just mock StrategyAgent or something, or just use the exact flow:
    // Intake at 5 PM. Attempt 1 is scheduled for 6 PM (T+1h).
    await engine.intake(cartEvent);
    
    // Advance 6 hours to 11 PM IST (23:00 IST = 17:30 UTC).
    // This executes Attempt 1 (which fails, because we simulate outcome with 85% probability usually, but let's assume it fails).
    // Or wait, simulateOutcome is randomized! We might recover.
    // Let's just use db to force outcome FAILED for Attempt 1? 
    // We can't easily force it, but simulateOutcome is just a method we could overwrite, or we can just try it.
    // Actually, `tick()` executes and calls `simulateOutcome`.
    // Let's just stub `Math.random` to always return 0.99 (guaranteed failure).
    const originalRandom = Math.random;
    Math.random = () => 0.99;

    clock.advanceHours(6); // Now 11:30 PM IST (18:00 UTC)
    
    // Attempt 1 executes at 11:30 PM IST. It fails.
    // Then tick() calculates Strategy for Attempt 2 (CUSTOMER_NUDGE at T+24h).
    // But wait, postRetryStopDecision is checked *immediately* for the next attempt.
    // If the next attempt is CUSTOMER_NUDGE, and the *current* time (11:30 PM) is in quiet hours, does it stop?
    // Let's look at stopping rules: evaluate() checks if `strategy === "CUSTOMER_NUDGE" && isQuietHours(asOf)`.
    // Yes, 11:30 PM is quiet hours. So postRetryStopDecision WILL return shouldStop=true, rule="QUIET_HOURS".
    // With Bug 2, this would kill the payment (status="DEAD").
    // With our fix, it defers it (status="RECOVERY_IN_PROGRESS", schedules Attempt 2 for 9 AM IST).
    
    await engine.tick(clock.now());
    
    // Restore random
    Math.random = originalRandom;

    const payment = await db.payment.findUniqueOrThrow({ where: { externalId: cartEvent.externalId } });
    assert.equal(payment.status, "RECOVERY_IN_PROGRESS");
    
    const attempts = await db.recoveryAttempt.findMany({ where: { paymentId: payment.id }, orderBy: { attemptNumber: "asc" } });
    // Attempt 1 executed at 11 PM, failed.
    // Attempt 2 should be PENDING, deferred to 9 AM IST next day.
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].outcome, "FAILED");
    assert.equal(attempts[1].outcome, "PENDING");
    
    const scheduledHour = attempts[1].scheduledAt!.getUTCHours();
    const scheduledMin = attempts[1].scheduledAt!.getUTCMinutes();
    assert.equal(scheduledHour, 3); // 3:30 UTC = 9:00 AM IST
    assert.equal(scheduledMin, 30);
  });
});
