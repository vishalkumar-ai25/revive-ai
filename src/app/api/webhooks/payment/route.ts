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
    const json = await req.json();
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
    const result = await engine.processFailure(event);

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
