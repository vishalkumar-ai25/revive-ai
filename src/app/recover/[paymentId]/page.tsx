import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { StoppingRulesEngine } from "@/lib/engine/stopping-rules";
import type { PaymentFailureEvent } from "@/lib/types";
import { ShieldAlert, CheckCircle2, AlertCircle } from "lucide-react";
import ClientRecoveryUI from "./ClientRecoveryUI";

export default async function RecoverPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;

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
    notFound();
  }

  const isFraud = payment.errorCode === "FRAUD_DETECTED" || payment.errorCode === "SUSPECTED_FRAUD";

  if (isFraud) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-8 text-center border-t-4 border-red-500">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Security Alert</h1>
          <p className="text-gray-600 mb-6">
            This transaction was blocked for security reasons. Please contact your bank.
          </p>
        </div>
      </div>
    );
  }

  if (payment.status === "RECOVERED") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-8 text-center border-t-4 border-green-500">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful</h1>
          <p className="text-gray-600">
            This payment has already been successfully recovered. Thank you!
          </p>
        </div>
      </div>
    );
  }

  // Re-evaluate stopping rules defensively on SSR
  const rulesEngine = new StoppingRulesEngine();
  const event: PaymentFailureEvent = {
    externalId: payment.externalId,
    merchantId: payment.merchantId,
    customerId: payment.customerId,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    errorCode: payment.errorCode || "UNKNOWN",
    timestamp: payment.failedAt,
    isRecurring: payment.isRecurring,
    mandateId: payment.mandateId,
    errorDescription: payment.errorDescription || "",
    bank: payment.bank,
    upiApp: payment.upiApp,
    subscriptionId: payment.subscriptionId,
  };

  const decision = rulesEngine.evaluate(
    event,
    payment.recoveryAttempts,
    isFraud
  );

  if (decision.shouldStop || payment.status === "DEAD") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-8 text-center border-t-4 border-amber-500">
          <AlertCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Link Expired</h1>
          <p className="text-gray-600">
            This recovery link is no longer valid. {decision.shouldStop ? decision.reason : "The recovery window has closed."}
          </p>
        </div>
      </div>
    );
  }

  return <ClientRecoveryUI payment={payment} />;
}
