import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { StoppingRulesEngine } from "@/lib/engine/stopping-rules";
import type { PaymentFailureEvent } from "@/lib/types";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  try {
    const { paymentId } = await params;
    
    // 1. Fetch payment and history
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      include: {
        customer: true,
        recoveryAttempts: {
          select: { attemptNumber: true, strategy: true, outcome: true },
        },
      },
    });

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (payment.status === "RECOVERED") {
      return NextResponse.json({ error: "Payment already recovered" }, { status: 400 });
    }

    if (payment.status === "DEAD") {
      return NextResponse.json({ error: "Recovery window closed" }, { status: 400 });
    }

    // 2. Re-evaluate stopping rules defensively before accepting payment
    const rulesEngine = new StoppingRulesEngine();
    const event: PaymentFailureEvent = {
      externalId: payment.externalId,
      merchantId: payment.merchantId,
      customerId: payment.customerId,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      errorCode: payment.errorCode || "UNKNOWN",
      timestamp: payment.createdAt,
      isRecurring: payment.isRecurring,
      mandateId: payment.mandateId,
      errorDescription: "",
      bank: null,
      upiApp: null,
      subscriptionId: null,
    };

    const isFraud = payment.errorCode === "FRAUD_DETECTED" || payment.errorCode === "SUSPECTED_FRAUD";

    const decision = rulesEngine.evaluate(
      event,
      payment.recoveryAttempts,
      isFraud
    );

    if (decision.shouldStop) {
      return NextResponse.json({ 
        error: "Recovery prohibited by stopping rules", 
        reason: decision.reason 
      }, { status: 403 });
    }

    // 3. Mark recovered
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "RECOVERED",
        auditLogs: {
          create: {
            agentName: "ClientRecoveryPage",
            action: "PAYMENT_RECOVERED",
            reasoning: "Customer completed payment via recovery page link",
            metadata: { source: "web_ui" },
          },
        },
      },
    });

    return NextResponse.json({ success: true, message: "Payment successfully recovered." });

  } catch (error) {
    console.error("Recovery API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
