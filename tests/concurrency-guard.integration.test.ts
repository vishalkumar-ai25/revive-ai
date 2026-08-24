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
});
