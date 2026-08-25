// =============================================================================
// CONCURRENCY GUARD INTEGRATION TEST
// =============================================================================
// Verifies that concurrent tick() calls cannot double-claim the same PENDING
// RecoveryAttempt rows, using real PostgreSQL SELECT FOR UPDATE SKIP LOCKED.
//
// This is the first live-database integration test in the suite.
// It auto-skips if DATABASE_URL is missing or doesn't point to a local database.
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { RecoveryEngine } from "../src/lib/engine/recovery-engine";
import { VirtualClock } from "../src/lib/time/clock";

// ---------------------------------------------------------------------------
// Safety guard: refuse to run against non-local databases
// ---------------------------------------------------------------------------

try {
  process.loadEnvFile?.();
} catch {
  // Ignore missing .env
}

const DATABASE_URL = process.env.DATABASE_URL ?? "";

function isLocalDatabase(url: string): boolean {
  return (
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("::1") ||
    url.includes(":5432")
  );
}

// Unique prefix to tag all test data for safe cleanup
const TEST_TAG = `__CONCURRENCY_TEST_${Date.now()}__`;

// ---------------------------------------------------------------------------
// Claim function: mirrors the CTE from RecoveryEngine.tick()
// ---------------------------------------------------------------------------

async function claimBatch(
  db: PrismaClient,
  asOf: Date,
  batchSize: number = 20,
): Promise<string[]> {
  const claimedRows = await db.$queryRaw<{ id: string }[]>`
    WITH due AS (
      SELECT ra.id
      FROM recovery_attempts ra
      JOIN payments p ON ra."paymentId" = p.id
      WHERE ra.outcome = 'PENDING'
        AND ra."claimedAt" IS NULL
        AND (ra."scheduledAt" IS NULL OR ra."scheduledAt" <= ${asOf})
        AND p.status = 'RECOVERY_IN_PROGRESS'
      ORDER BY ra."createdAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE OF ra SKIP LOCKED
    )
    UPDATE recovery_attempts
    SET "claimedAt" = NOW(), "updatedAt" = NOW()
    FROM due
    WHERE recovery_attempts.id = due.id
    RETURNING recovery_attempts.id
  `;

  return claimedRows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Concurrency Guard — Row-Level Locking Integration Test", { skip: !isLocalDatabase(DATABASE_URL) && "DATABASE_URL is not a local database" }, () => {
  let db: PrismaClient;
  let merchantId: string;
  let customerId: string;
  let paymentIds: string[] = [];
  let attemptIds: string[] = [];

  const TOTAL_PENDING = 30; // More than one batch (20) to test multi-caller distribution

  before(async () => {
    db = new PrismaClient({ log: ["error"] });
    await db.$connect();

    // Create test merchant
    const merchant = await db.merchant.create({
      data: {
        name: `${TEST_TAG}_merchant`,
        email: `${TEST_TAG}@test.com`,
        industry: "Test",
      },
    });
    merchantId = merchant.id;

    // Create test customer
    const customer = await db.customer.create({
      data: {
        id: `${TEST_TAG}_cust`,
        email: `${TEST_TAG}_cust@test.com`,
        totalPurchases: 5,
        lifetimeValue: 10000,
      },
    });
    customerId = customer.id;

    // Seed TOTAL_PENDING payments, each with one PENDING recovery attempt
    for (let i = 0; i < TOTAL_PENDING; i++) {
      const payment = await db.payment.create({
        data: {
          externalId: `${TEST_TAG}_pay_${i}`,
          merchantId,
          customerId,
          amount: 500 + i,
          currency: "INR",
          method: "UPI",
          bank: "HDFC",
          status: "RECOVERY_IN_PROGRESS",
          errorCode: "BANK_TIMEOUT",
          errorDescription: "Test timeout",
          failedAt: new Date(),
        },
      });
      paymentIds.push(payment.id);

      const attempt = await db.recoveryAttempt.create({
        data: {
          paymentId: payment.id,
          attemptNumber: 1,
          strategy: "SMART_RETRY",
          escalationLevel: "LEVEL_1_ONSCREEN",
          outcome: "PENDING",
          scheduledAt: new Date(Date.now() - 60000), // Due 1 minute ago
          claimedAt: null,
        },
      });
      attemptIds.push(attempt.id);
    }
  });

  after(async () => {
    // Cleanup all test data, regardless of test outcome
    try {
      if (attemptIds.length > 0) {
        await db.recoveryAttempt.deleteMany({
          where: { id: { in: attemptIds } },
        });
      }
      if (paymentIds.length > 0) {
        await db.payment.deleteMany({
          where: { id: { in: paymentIds } },
        });
      }
      if (customerId) {
        await db.customer.deleteMany({
          where: { id: customerId },
        });
      }
      if (merchantId) {
        await db.merchant.deleteMany({
          where: { id: merchantId },
        });
      }
    } catch (cleanupError) {
      console.error("Cleanup failed:", cleanupError);
    } finally {
      await db.$disconnect();
    }
  });

  it("Concurrent claim operations produce zero overlap and claim all due rows", async () => {
    const asOf = new Date(); // All seeded attempts are due (scheduledAt in the past)

    // Fire 3 concurrent claim operations — genuinely concurrent via Promise.all
    const [claimed1, claimed2, claimed3] = await Promise.all([
      claimBatch(db, asOf, 20),
      claimBatch(db, asOf, 20),
      claimBatch(db, asOf, 20),
    ]);

    // 1. Check no overlap between any pair of callers
    const set1 = new Set(claimed1);
    const set2 = new Set(claimed2);

    for (const id of claimed2) {
      assert.equal(set1.has(id), false, `ID ${id} was double-claimed by caller 1 and 2`);
    }
    for (const id of claimed3) {
      assert.equal(set1.has(id), false, `ID ${id} was double-claimed by caller 1 and 3`);
      assert.equal(set2.has(id), false, `ID ${id} was double-claimed by caller 2 and 3`);
    }

    // 2. Total claimed across all callers equals total seeded rows
    const totalClaimed = claimed1.length + claimed2.length + claimed3.length;
    assert.equal(
      totalClaimed,
      TOTAL_PENDING,
      `Expected ${TOTAL_PENDING} total claimed, got ${totalClaimed} (${claimed1.length} + ${claimed2.length} + ${claimed3.length})`,
    );

    // 3. Every seeded attempt was claimed exactly once
    const allClaimed = new Set([...claimed1, ...claimed2, ...claimed3]);
    for (const attemptId of attemptIds) {
      assert.ok(
        allClaimed.has(attemptId),
        `Attempt ${attemptId} was not claimed by any caller`,
      );
    }

    // 4. All claimed rows should now have claimedAt set
    const claimedAttempts = await db.recoveryAttempt.findMany({
      where: { id: { in: attemptIds } },
      select: { id: true, claimedAt: true },
    });
    for (const attempt of claimedAttempts) {
      assert.notEqual(
        attempt.claimedAt,
        null,
        `Attempt ${attempt.id} should have claimedAt set after claim`,
      );
    }
  });

  it("Second claim attempt on already-claimed rows returns empty", async () => {
    // All rows were claimed in the previous test — a new claim should get nothing
    const asOf = new Date();
    const claimed = await claimBatch(db, asOf, 20);
    assert.equal(
      claimed.length,
      0,
      "No rows should be available for claiming after all have been claimed",
    );
  });

  it("Regression: Quiet hours deferral resets claimedAt to null so it can be picked up later", async () => {
    // 1. Create a fresh payment just for this test
    const payment = await db.payment.create({
      data: {
        externalId: `${TEST_TAG}_quiet_hours`,
        merchantId,
        customerId,
        amount: 999,
        currency: "INR",
        method: "UPI",
        bank: "HDFC",
        status: "RECOVERY_IN_PROGRESS",
        errorCode: "BANK_TIMEOUT",
        failedAt: new Date(),
      },
    });
    paymentIds.push(payment.id);

    // 2. Seed a CUSTOMER_NUDGE attempt (strategy that triggers quiet hours) 
    // that is due NOW but hasn't been claimed yet.
    const attempt = await db.recoveryAttempt.create({
      data: {
        paymentId: payment.id,
        attemptNumber: 1,
        strategy: "CUSTOMER_NUDGE",
        escalationLevel: "LEVEL_1_ONSCREEN",
        outcome: "PENDING",
        scheduledAt: new Date(Date.UTC(2025, 0, 15, 16, 29, 0)), // Due 1 minute before quietTime
        claimedAt: null, // Ready to claim
      },
    });
    attemptIds.push(attempt.id);

    // 3. Set clock to 10 PM IST (16:30 UTC), which is squarely in quiet hours (9 PM - 9 AM)
    const quietTime = new Date(Date.UTC(2025, 0, 15, 16, 30, 0));
    const clock = new VirtualClock(quietTime);
    const engine = new RecoveryEngine(clock);

    // 4. Run tick() - this will claim the row and then defer it due to quiet hours
    await engine.tick(quietTime);

    // 5. Assert the row was updated to next 9 AM IST and claimedAt was reset to null
    const deferredAttempt = await db.recoveryAttempt.findUniqueOrThrow({
      where: { id: attempt.id }
    });
    assert.equal(deferredAttempt.outcome, "PENDING", "Should still be PENDING");
    assert.equal(deferredAttempt.claimedAt, null, "claimedAt must be reset to null");
    
    // next 9 AM IST on Jan 15 16:30 UTC is Jan 16 03:30 UTC
    const next9AmUtc = new Date(Date.UTC(2025, 0, 16, 3, 30, 0));
    assert.equal(deferredAttempt.scheduledAt?.getTime(), next9AmUtc.getTime(), "Should be deferred to 9 AM IST");

    // 6. Fast forward clock to 9:01 AM IST
    const morningTime = new Date(Date.UTC(2025, 0, 16, 3, 31, 0));
    const morningClock = new VirtualClock(morningTime);
    const morningEngine = new RecoveryEngine(morningClock);
    
    // 7. Tick again - since claimedAt is null, it should be successfully claimed and processed now
    const results = await morningEngine.tick(morningTime);
    
    // Should have processed this payment
    const processedOurPayment = results.some(r => r.paymentId === payment.id);
    assert.ok(processedOurPayment, "Attempt should be picked up and processed after quiet hours end");
    
    // Check outcome is no longer PENDING
    const finalAttempt = await db.recoveryAttempt.findUniqueOrThrow({
      where: { id: attempt.id }
    });
    assert.notEqual(finalAttempt.outcome, "PENDING", "Attempt should be fully executed");
  });
});
