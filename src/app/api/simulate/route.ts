// =============================================================================
// SIMULATION API ROUTE
// =============================================================================
// POST /api/simulate
// Triggers a batch simulation run or creates a single test failure.
// =============================================================================

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { BatchRunner } from "@/lib/simulation/batch-runner";
import { PaymentGenerator } from "@/lib/simulation/payment-generator";
import { RecoveryEngine } from "@/lib/engine/recovery-engine";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const count = typeof body.count === "number" ? body.count : 50;
    const mode = body.mode === "single" ? "single" : "batch";

    // Ensure demo merchant exists
    const merchant = await db.merchant.upsert({
      where: { email: "merchant@razorpay-demo.com" },
      update: {},
      create: {
        name: "UrbanKicks India",
        email: "merchant@razorpay-demo.com",
        industry: "E-Commerce",
      },
    });

    if (mode === "single") {
      const generator = new PaymentGenerator(merchant.id);
      const singleEvent = generator.generateSingle(Date.now() % 1000);
      const engine = new RecoveryEngine();
      const result = await engine.processFailure(singleEvent);

      return NextResponse.json({
        success: true,
        mode: "single",
        data: result,
      });
    }

    // Run batch simulation asynchronously or synchronously for smaller batches
    const runner = new BatchRunner(merchant.id);
    const report = await runner.run(count);

    return NextResponse.json({
      success: true,
      mode: "batch",
      data: report,
    });
  } catch (error) {
    console.error("[Simulate API Error]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal simulation error",
      },
      { status: 500 },
    );
  }
}
