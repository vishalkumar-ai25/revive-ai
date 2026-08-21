// =============================================================================
// ANALYTICS API ROUTE
// =============================================================================
// GET /api/analytics
// Returns comprehensive dashboard metrics, failure category breakdowns,
// recent recovery activities, and escalation queues.
// =============================================================================

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    // 1. Overall Payment Metrics
    const totalPayments = await db.payment.count();
    const failedPayments = await db.payment.count({
      where: { status: { in: ["FAILED", "DEAD"] } },
    });
    const recoveredPayments = await db.payment.count({
      where: { status: "RECOVERED" },
    });
    const inProgressPayments = await db.payment.count({
      where: { status: "RECOVERY_IN_PROGRESS" },
    });

    // Sum of amounts
    const amountStats = await db.payment.groupBy({
      by: ["status"],
      _sum: {
        amount: true,
      },
    });

    let totalAtRiskAmount = 0;
    let recoveredAmount = 0;

    for (const stat of amountStats) {
      if (stat.status === "FAILED" || stat.status === "DEAD" || stat.status === "RECOVERY_IN_PROGRESS") {
        totalAtRiskAmount += stat._sum.amount ?? 0;
      }
      if (stat.status === "RECOVERED") {
        recoveredAmount += stat._sum.amount ?? 0;
      }
    }

    // 2. Failure Category Breakdown
    const categoryStats = await db.failureEvent.groupBy({
      by: ["category"],
      _count: {
        category: true,
      },
    });

    // 3. Strategy Usage Breakdown
    const strategyStats = await db.recoveryAttempt.groupBy({
      by: ["strategy", "outcome"],
      _count: {
        id: true,
      },
    });

    // 4. Recent Payments with full diagnosis & attempts
    const recentPayments = await db.payment.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        failureEvent: true,
        recoveryAttempts: {
          orderBy: { attemptNumber: "desc" },
          take: 1,
        },
      },
    });

    // 5. Escalation Queue (High value or level 4 alerts)
    const escalationQueue = await db.recoveryAttempt.findMany({
      where: {
        escalationLevel: "LEVEL_4_MERCHANT_ALERT",
        outcome: "PENDING",
      },
      include: {
        payment: {
          include: {
            customer: true,
            failureEvent: true,
          },
        },
      },
      take: 10,
    });

    // 6. Latest Batch Run
    const latestBatchRun = await db.batchRun.findFirst({
      orderBy: { startedAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalPayments,
          failedPayments,
          recoveredPayments,
          inProgressPayments,
          totalAtRiskAmount: Math.round(totalAtRiskAmount),
          recoveredAmount: Math.round(recoveredAmount),
          recoveryRate:
            totalPayments > 0
              ? Math.round((recoveredPayments / (failedPayments + recoveredPayments || 1)) * 10000) / 100
              : 0,
        },
        categoryStats: categoryStats.map((c) => ({
          category: c.category,
          count: c._count.category,
        })),
        strategyStats,
        recentPayments,
        escalationQueue,
        latestBatchRun,
      },
    });
  } catch (error) {
    console.error("[Analytics API Error]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load analytics",
      },
      { status: 500 },
    );
  }
}
