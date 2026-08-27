import crypto from "crypto";
// =============================================================================
// WEBHOOK INGESTION API ROUTE
// =============================================================================
// POST /api/webhooks/payment
// Receives payment events (failed, abandoned, subscription halted) from
// payment gateways like Razorpay or internal simulators.
// =============================================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { RecoveryEngine } from "@/lib/engine/recovery-engine";
import type { PaymentFailureEvent } from "@/lib/types";

const paymentFailureSchema = z.object({
  externalId: z.string(),
  merchantId: z.string(),
  customerId: z.string(),
  amount: z.number().positive(),
  currency: z.string().default("INR"),
  method: z.enum([
    "UPI",
    "CREDIT_CARD",
    "DEBIT_CARD",
    "NETBANKING",
    "WALLET",
    "EMI",
    "MANDATE",
  ]),
  bank: z.string().nullable().optional(),
  upiApp: z.string().nullable().optional(),
  errorCode: z.string(),
  errorDescription: z.string(),
  isRecurring: z.boolean().default(false),
  subscriptionId: z.string().nullable().optional(),
  mandateId: z.string().nullable().optional(),
  timestamp: z.string().transform((str) => new Date(str)).optional(),
});

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("X-Razorpay-Signature");
    const secret = process.env.WEBHOOK_SIGNING_SECRET;

    if (!secret || !signature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    // The X-Razorpay-Signature is checked between line 50 - 53
    const expectedSig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (signature.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const json = JSON.parse(rawBody);
    const parsed = paymentFailureSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid payment event payload",
          details: parsed.error.format(),
        },
        { status: 400 },
      );
    }

    const data = parsed.data;
    const event: PaymentFailureEvent = {
      externalId: data.externalId,
      merchantId: data.merchantId,
      customerId: data.customerId,
      amount: data.amount,
      currency: data.currency,
      method: data.method,
      bank: data.bank ?? null,
      upiApp: data.upiApp ?? null,
      errorCode: data.errorCode,
      errorDescription: data.errorDescription,
      isRecurring: data.isRecurring,
      subscriptionId: data.subscriptionId ?? null,
      mandateId: data.mandateId ?? null,
      timestamp: data.timestamp ?? new Date(),
    };

    const engine = new RecoveryEngine();
    const intakeResult = await engine.intake(event);
    let result = intakeResult;

    if (intakeResult.outcome !== "STOPPED_BY_RULE") {
      const tickResults = await engine.tick(new Date());
      const matchedTick = tickResults.find((r) => r.paymentId === intakeResult.paymentId);
      
      result = {
        paymentId: intakeResult.paymentId,
        strategy: matchedTick ? matchedTick.strategy : intakeResult.strategy,
        outcome: matchedTick ? matchedTick.outcome : intakeResult.outcome,
        processingTimeMs: intakeResult.processingTimeMs,
      };
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[Webhook Error]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
