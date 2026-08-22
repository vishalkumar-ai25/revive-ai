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
  byStrategy: Record<string, { count: number; recovered: number }>;
  byFailureCategory: Record<string, { count: number; recovered: number }>;
  stoppedByRules: number;
  fraudBlocked: number;
}

type PaymentWithAttempts = Payment & {
  recoveryAttempts: RecoveryAttempt[];
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

    // 2. Ingest all events (creates initial PENDING recovery attempts)
    console.info(`  📥 Ingesting ${count} failed payment events...`);
    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      try {
        await this.engine.intake(event);
      } catch (error) {
        console.error(`  ❌ Error ingesting payment ${i + 1}:`, error);
      }

      if ((i + 1) % 100 === 0 || i === events.length - 1) {
        console.info(`  📊 Ingested ${i + 1}/${count} payments`);
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

    return {
      totalPayments,
      totalAmountAtRisk: Math.round(totalAmountAtRisk),
      paymentsRecovered,
      amountRecovered: Math.round(amountRecovered),
      recoveryRate: Math.round(recoveryRate * 10000) / 100,
      avgProcessingTimeMs,
      byStrategy,
      byFailureCategory,
      stoppedByRules,
      fraudBlocked,
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
    console.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 REVIVE AI — BATCH RECOVERY REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Total Failed Payments:      ${report.totalPayments.toLocaleString()}
  Total Revenue at Risk:      ₹${report.totalAmountAtRisk.toLocaleString()}

  ✅ Payments Recovered:      ${report.paymentsRecovered.toLocaleString()}
  ✅ Revenue Recovered:       ₹${report.amountRecovered.toLocaleString()}
  📈 Recovery Rate:           ${report.recoveryRate}%
  ⏱  Avg Processing Time:    ${report.avgProcessingTimeMs}ms

  STRATEGY BREAKDOWN:
${Object.entries(report.byStrategy)
  .map(
    ([s, v]) =>
      `    ${s.padEnd(22)} ${v.count} attempted → ${v.recovered} recovered`,
  )
  .join("\n")}

  STOPPING RULES:
    Stopped by rules:         ${report.stoppedByRules}
    Fraud blocked:            ${report.fraudBlocked}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

  await db.$disconnect();
}

// Only run if executed directly (not imported)
if (require.main === module) {
  main().catch(console.error);
}
