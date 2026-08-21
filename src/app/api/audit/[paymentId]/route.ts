// =============================================================================
// AUDIT TRAIL API ROUTE
// =============================================================================
// GET /api/audit/[paymentId]
// Returns the chronological chain-of-thought and decision logs for a payment.
// =============================================================================

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: { paymentId: string } },
) {
  try {
    const paymentId = params.paymentId;

    const payment = await db.payment.findFirst({
      where: {
        OR: [{ id: paymentId }, { externalId: paymentId }],
      },
      include: {
        customer: true,
        failureEvent: true,
        recoveryAttempts: true,
      },
    });

    if (!payment) {
      return NextResponse.json(
        { success: false, error: "Payment not found" },
        { status: 404 },
      );
    }

    const auditLogs = await db.auditLog.findMany({
      where: { paymentId: payment.id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      success: true,
      data: {
        payment,
        auditLogs,
      },
    });
  } catch (error) {
    console.error("[Audit API Error]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch audit trail",
      },
      { status: 500 },
    );
  }
}
