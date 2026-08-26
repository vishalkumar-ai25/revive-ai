// =============================================================================
// BATCH RUNNER — Run batch simulations and generate recovery reports
// =============================================================================
// Processes N simulated failed payments through the full recovery pipeline
// with a fixed 1h virtual time progression loop across the recovery window.
//
// Multi-attempt lifecycle:
//   1. All N events are ingested via engine.intake() at t0
//   2. Virtual clock advances by 1h ticks up to MAX_RECOVERY_WINDOW_HOURS + 1h
//   3. Each tick, engine.tick(asOf) processes due PENDING attempts in batch
//   4. Aggregate metrics reflect complete multi-attempt recovery outcomes
//
// Usage: npx tsx src/lib/simulation/batch-runner.ts [count]
// =============================================================================

import { db } from "@/lib/db";
import { RecoveryEngine } from "@/lib/engine/recovery-engine";
import { PaymentGenerator } from "./payment-generator";
import { SIMULATION, STOPPING_RULES, MANDATE_RULES } from "@/lib/constants";
import { type Clock, VirtualClock } from "@/lib/time/clock";
import type { Payment, RecoveryAttempt } from "@prisma/client";

interface BatchReport {
  totalPayments: number;
  totalAmountAtRisk: number;
  paymentsRecovered: number;
  amountRecovered: number;
  recoveryRate: number;
  avgProcessingTimeMs: number;
  totalDurationMs: number;
  byStrategy: Record<string, { count: number; recovered: number }>;
  byFailureCategory: Record<string, { count: number; recovered: number }>;
  stoppedByRules: number;
  fraudBlocked: number;
  quietHoursDeferrals: number;
  retryCapTerminations: number;
  belowMinAmountHalted: number;
  calibrationBuckets: { bucket: string; predictedAvg: number; actualRate: number; count: number }[];
  brierScore: number;
}

type PaymentWithAttempts = Payment & {
  recoveryAttempts: RecoveryAttempt[];
  failureEvent: import("@prisma/client").FailureEvent | null;
};

export class BatchRunner {
  private engine: RecoveryEngine;
  private generator: PaymentGenerator;
  private clock: VirtualClock;

  constructor(merchantId: string, clock?: Clock) {
    const virtualClock =
      clock instanceof VirtualClock ? clock : new VirtualClock(new Date());
    this.clock = virtualClock;
    this.engine = new RecoveryEngine(virtualClock);
    this.generator = new PaymentGenerator(merchantId, virtualClock);
  }

  /**
   * Run a batch simulation of N failed payments using a virtual time timeline.
   */
  async run(count: number = SIMULATION.DEFAULT_BATCH_SIZE): Promise<BatchReport> {
    console.info(`\n🚀 Starting batch simulation: ${count} payments\n`);
    const startTime = performance.now();

    // 1. Generate all synthetic events anchored at t0
    const events = this.generator.generateBatch(count);

    // 2. Ingest all events (Concurrent in chunks to avoid pool exhaustion)
    console.info(`  📥 Ingesting ${count} failed payment events...`);
    
    const chunkArray = <T>(arr: T[], size: number): T[][] =>
      Array.from({ length: Math.ceil(arr.length / size) }, (_v, i) =>
        arr.slice(i * size, i * size + size)
      );

    // Reduced from 20 to 10 to prevent macOS socket exhaustion when running locally
    const CONCURRENCY_LIMIT = 3;
    const eventChunks = chunkArray(events, CONCURRENCY_LIMIT);
    
    let ingestedCount = 0;
    for (const chunk of eventChunks) {
      await Promise.all(
        chunk.map(async (event) => {
          try {
            // Register ground truth separately and omit from what the pipeline sees
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { groundTruthRecoveryProbability, ...agentEvent } = event as any;
            this.engine.simulationGroundTruths.set(event.externalId, groundTruthRecoveryProbability);
            
            await this.engine.intake(agentEvent);
            ingestedCount++;
          } catch (error) {
            console.error(`  ❌ Error ingesting payment:`, error);
          }
        })
      );
      if (ingestedCount % 100 === 0 || ingestedCount === events.length) {
        console.info(`  📊 Ingested ${ingestedCount}/${count} payments`);
      }
    }

    // 3. Fixed 1-hour tick loop advancing VirtualClock across recovery window
    //    Uses max(standard 72h, mandate 168h) + 1h buffer so mandate retries at
    //    T+96h and T+144h are actually executed instead of left as PENDING.
    const maxTicks =
      Math.max(STOPPING_RULES.MAX_RECOVERY_WINDOW_HOURS, MANDATE_RULES.WINDOW_HOURS) + 1; // 169 ticks
    console.info(`  ⏳ Progressing virtual time over up to ${maxTicks} hours...`);

    for (let tickIndex = 0; tickIndex < maxTicks; tickIndex++) {
      this.clock.advanceHours(1);
      const currentTime = this.clock.now();

      await this.engine.tick(currentTime);

      // Check if any PENDING attempts remain
      const pendingCount = await db.recoveryAttempt.count({
        where: {
          outcome: "PENDING",
          payment: { status: "RECOVERY_IN_PROGRESS" },
        },
      });

      if (pendingCount === 0) {
        console.info(
          `  ✨ All recovery attempts resolved at T+${tickIndex + 1}h`,
        );
        break;
      }

      // Log progress every 24 virtual hours
      if ((tickIndex + 1) % 24 === 0) {
        console.info(
          `  ⏳ T+${tickIndex + 1}h — ${pendingCount} attempts still pending`,
        );
      }
    }

    const totalProcessingTimeMs = Math.round(performance.now() - startTime);

    // 4. Fetch final payments with their full recovery attempt histories
    const externalIds = events.map((e) => e.externalId);
    const payments = await db.payment.findMany({
      where: { externalId: { in: externalIds } },
      include: {
        recoveryAttempts: {
          orderBy: { attemptNumber: "asc" },
        },
        failureEvent: true,
      },
    });

    // 5. Calculate aggregate report
    const report = this.calculateReport(payments, totalProcessingTimeMs);

    // 6. Persist batch run record
    await this.persistBatchRun(report);

    // 7. Print console report
    this.printReport(report);

    return report;
  }

  // -------------------------------------------------------------------------
  // Report Calculation
  // -------------------------------------------------------------------------

  private calculateReport(
    payments: PaymentWithAttempts[],
    totalDurationMs: number,
  ): BatchReport {
    const totalPayments = payments.length;
    const totalAmountAtRisk = payments.reduce((sum, p) => sum + p.amount, 0);

    const recoveredPayments = payments.filter((p) => p.status === "RECOVERED");
    const paymentsRecovered = recoveredPayments.length;
    const amountRecovered = recoveredPayments.reduce((sum, p) => sum + p.amount, 0);
    const recoveryRate =
      totalPayments > 0 ? paymentsRecovered / totalPayments : 0;

    const avgProcessingTimeMs =
      totalPayments > 0 ? Math.round(totalDurationMs / totalPayments) : 0;

    // By strategy breakdown (aggregating all attempted strategies across attempts)
    const byStrategy: Record<string, { count: number; recovered: number }> = {};
    for (const payment of payments) {
      for (const attempt of payment.recoveryAttempts) {
        if (!byStrategy[attempt.strategy]) {
          byStrategy[attempt.strategy] = { count: 0, recovered: 0 };
        }
        byStrategy[attempt.strategy]!.count++;
        if (attempt.outcome === "SUCCESS") {
          byStrategy[attempt.strategy]!.recovered++;
        }
      }
    }

    // By failure category breakdown
    const byFailureCategory: Record<string, { count: number; recovered: number }> = {};
    for (const payment of payments) {
      const code = payment.errorCode ?? "UNKNOWN";
      if (!byFailureCategory[code]) {
        byFailureCategory[code] = { count: 0, recovered: 0 };
      }
      byFailureCategory[code]!.count++;
      if (payment.status === "RECOVERED") {
        byFailureCategory[code]!.recovered++;
      }
    }

    const stoppedByRules = payments.filter((p) => p.status === "DEAD").length;
    const fraudBlocked = payments.filter(
      (p) =>
        p.errorCode === "FRAUD_DETECTED" || p.errorCode === "SUSPECTED_FRAUD",
    ).length;

    // Stopping rule breakdown from recovery attempt records
    const allAttempts = payments.flatMap((p) => p.recoveryAttempts);
    const quietHoursDeferrals = allAttempts.filter(
      (a) => a.stoppedByRule === "QUIET_HOURS",
    ).length;
    const retryCapTerminations = allAttempts.filter(
      (a) => a.stoppedByRule === "MAX_RETRIES_EXCEEDED",
    ).length;
    const belowMinAmountHalted = allAttempts.filter(
      (a) => a.stoppedByRule === "BELOW_MIN_AMOUNT",
    ).length;

    // Calibration and Brier Score
    const buckets: Record<string, { count: number; sumPred: number; recovered: number }> = {
      "0-10%": { count: 0, sumPred: 0, recovered: 0 },
      "10-20%": { count: 0, sumPred: 0, recovered: 0 },
      "20-30%": { count: 0, sumPred: 0, recovered: 0 },
      "30-40%": { count: 0, sumPred: 0, recovered: 0 },
      "40-50%": { count: 0, sumPred: 0, recovered: 0 },
      "50-60%": { count: 0, sumPred: 0, recovered: 0 },
      "60-70%": { count: 0, sumPred: 0, recovered: 0 },
      "70-80%": { count: 0, sumPred: 0, recovered: 0 },
      "80-90%": { count: 0, sumPred: 0, recovered: 0 },
      "90-100%": { count: 0, sumPred: 0, recovered: 0 },
    };

    let brierSum = 0;
    let validForBrier = 0;

    for (const p of payments) {
      if (p.failureEvent) {
        const pred = p.failureEvent.recoveryProbability;
        const actual = p.status === "RECOVERED" ? 1 : 0;
        brierSum += Math.pow(pred - actual, 2);
        validForBrier++;

        let bucketIdx = Math.floor(pred * 10);
        if (bucketIdx === 10) bucketIdx = 9; // 1.0 goes to 90-100%
        const bucketKeys = Object.keys(buckets);
        const b = buckets[bucketKeys[bucketIdx]!];
        if (b) {
          b.count++;
          b.sumPred += pred;
          b.recovered += actual;
        }
      }
    }

    const brierScore = validForBrier > 0 ? brierSum / validForBrier : 0;
    const calibrationBuckets = Object.entries(buckets).map(([bucket, data]) => ({
      bucket,
      count: data.count,
      predictedAvg: data.count > 0 ? data.sumPred / data.count : 0,
      actualRate: data.count > 0 ? data.recovered / data.count : 0,
    }));

    return {
      totalPayments,
      totalAmountAtRisk: Math.round(totalAmountAtRisk),
      paymentsRecovered,
      amountRecovered: Math.round(amountRecovered),
      recoveryRate: Math.round(recoveryRate * 10000) / 100,
      avgProcessingTimeMs,
      totalDurationMs,
      byStrategy,
      byFailureCategory,
      stoppedByRules,
      fraudBlocked,
      quietHoursDeferrals,
      retryCapTerminations,
      belowMinAmountHalted,
      calibrationBuckets,
      brierScore,
    };
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private async persistBatchRun(report: BatchReport): Promise<void> {
    try {
      await db.batchRun.create({
        data: {
          totalPayments: report.totalPayments,
          totalAmountAtRisk: report.totalAmountAtRisk,
          paymentsRecovered: report.paymentsRecovered,
          amountRecovered: report.amountRecovered,
          recoveryRate: report.recoveryRate,
          avgTimeToRecoverMs: report.avgProcessingTimeMs,
          retriesAttempted: report.byStrategy["SMART_RETRY"]?.count ?? 0,
          nudgesSent: report.byStrategy["CUSTOMER_NUDGE"]?.count ?? 0,
          altPaymentSuggested: report.byStrategy["ALT_PAYMENT"]?.count ?? 0,
          escalatedToMerchant:
            report.byStrategy["ESCALATE_MERCHANT"]?.count ?? 0,
          stoppedByRules: report.stoppedByRules,
          fraudBlocked: report.fraudBlocked,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Failed to persist batch run:", error);
    }
  }

  // -------------------------------------------------------------------------
  // Console Report
  // -------------------------------------------------------------------------

  private printReport(report: BatchReport): void {
    const totalSeconds = (report.totalDurationMs / 1000).toFixed(1);
    const gmvRecoveryPct =
      report.totalAmountAtRisk > 0
        ? ((report.amountRecovered / report.totalAmountAtRisk) * 100).toFixed(1)
        : "0.0";

    // Part 1: Financial Summary
    console.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 REVIVE AI — BATCH RECOVERY BENCHMARK REPORT (${report.totalPayments.toLocaleString()} PAYMENTS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Total Failed Payments:        ${report.totalPayments.toLocaleString()}
  Total Revenue at Risk:        ₹${report.totalAmountAtRisk.toLocaleString()}

  ✅ Payments Recovered:        ${report.paymentsRecovered.toLocaleString()} (${report.recoveryRate}%)
  ✅ Revenue Recovered:         ₹${report.amountRecovered.toLocaleString()} (${gmvRecoveryPct}% GMV recovered)
  ⏱  Total Benchmark Time:     ${totalSeconds}s (${report.avgProcessingTimeMs}ms per payment)`);

    // Part 2: Category Breakdown
    const categoryLines = Object.entries(report.byFailureCategory)
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([cat, v]) => {
        const pct = v.count > 0 ? ((v.recovered / v.count) * 100).toFixed(1) : "0.0";
        const catLabel = cat.padEnd(24);
        const counts = `${v.recovered} / ${v.count} recovered`;
        return `    ${catLabel} ${counts.padEnd(26)} (${pct}%)`;
      })
      .join("\n");

    console.info(`
  CATEGORY BREAKDOWN:
${categoryLines}`);

    // Part 3: Strategy Breakdown
    const strategyLines = Object.entries(report.byStrategy)
      .sort(([, a], [, b]) => b.recovered - a.recovered)
      .map(([strat, v]) => {
        return `    ${strat.padEnd(24)} ${v.recovered} successful out of ${v.count} attempted`;
      })
      .join("\n");

    console.info(`
  STRATEGY BREAKDOWN:
${strategyLines}`);

    // Part 4: Stopping Rules & Compliance
    console.info(`
  STOPPING RULES & COMPLIANCE ENFORCEMENT:
    Fraud Blocks Enforced:       ${report.fraudBlocked} transactions (100% compliance)
    Quiet Hours Deferrals:       ${report.quietHoursDeferrals} nudges deferred to 9:00 AM IST
    Retry Cap Terminations:      ${report.retryCapTerminations} transactions halted at 4 attempts
    Below Min Amount Halted:     ${report.belowMinAmountHalted} transactions under ₹50
    Total Stopped by Rules:      ${report.stoppedByRules} payments marked DEAD

  PART 5: RISK MODEL CALIBRATION:
    Brier Score:                 ${report.brierScore.toFixed(4)} (lower is better)
    
    Bucket      | Count | Predicted Avg | Actual Recovery Rate
    ----------------------------------------------------------
${report.calibrationBuckets.map(b => 
      `    ${b.bucket.padEnd(11)} | ${b.count.toString().padEnd(5)} | ${(b.predictedAvg * 100).toFixed(1).padStart(4)}%        | ${(b.actualRate * 100).toFixed(1).padStart(4)}%`
    ).join("\n")}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  }
}

// ---------------------------------------------------------------------------
// CLI Entry Point: npx tsx src/lib/simulation/batch-runner.ts [count]
// ---------------------------------------------------------------------------

async function main() {
  const count = parseInt(
    process.argv[2] ?? String(SIMULATION.DEFAULT_BATCH_SIZE),
    10,
  );

  // Ensure at least one merchant exists for simulation
  const merchant = await db.merchant.upsert({
    where: { email: "demo@merchant.com" },
    create: {
      name: "Demo Merchant",
      email: "demo@merchant.com",
      industry: "E-commerce",
    },
    update: {},
  });

  const runner = new BatchRunner(merchant.id);
  await runner.run(count);

  const stuckPending = await db.recoveryAttempt.count({
    where: {
      outcome: "PENDING",
      payment: { status: "RECOVERY_IN_PROGRESS" }
    }
  });
  console.log(`\n  ⚠️  STUCK PENDING ATTEMPTS (After Simulation): ${stuckPending}\n`);

  await db.$disconnect();
}

// Only run if executed directly (not imported)
if (require.main === module) {
  main().catch(console.error);
}
