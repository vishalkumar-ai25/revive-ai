"use client";

import { useState } from "react";
import { CreditCard, Smartphone, ShieldCheck, Loader2 } from "lucide-react";
import type { Payment, Customer } from "@prisma/client";
import { CUSTOMER_SAFE_MESSAGES } from "@/lib/constants";

export default function ClientRecoveryUI({
  payment,
  signature,
}: {
  payment: Payment & { customer: Customer };
  signature: string;
}) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePayment = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/recover/${payment.id}?sig=${signature}`, {
        method: "POST",
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || "Payment failed");
      
      setSuccess(true);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-8 text-center border-t-4 border-green-500">
          <ShieldCheck className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Simulated Payment Confirmation</h1>
          <p className="text-gray-600 mb-6">
            ₹{payment.amount.toLocaleString()} has been marked as recovered for the demo.
          </p>
          <p className="text-sm text-gray-500">You can safely close this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 flex justify-center">
      <div className="max-w-md w-full space-y-8">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-indigo-600 px-6 py-8 text-white text-center">
            <h2 className="text-2xl font-bold">Complete Your Payment</h2>
            <p className="mt-2 text-indigo-100 opacity-90 text-sm">
              Your previous payment of ₹{payment.amount.toLocaleString()} did not go through due to 
              {CUSTOMER_SAFE_MESSAGES[payment.errorCode || "UNKNOWN"] || CUSTOMER_SAFE_MESSAGES["UNKNOWN"]}.
            </p>
          </div>

          <div className="p-6">
            {/* Order Summary */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-100">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-500 text-sm">Order Total</span>
                <span className="text-gray-900 font-bold text-lg">₹{payment.amount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Customer</span>
                <span className="text-gray-700 text-sm font-medium">{payment.customer.email}</span>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">
                {error}
              </div>
            )}

            {/* Payment Methods */}
            <div className="space-y-3 mb-8">
              <p className="text-sm font-semibold text-gray-700 mb-2">Select Payment Method</p>
              
              <label className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50 border-indigo-500 bg-indigo-50 transition-colors">
                <input type="radio" name="payment_method" className="text-indigo-600 focus:ring-indigo-500" defaultChecked />
                <CreditCard className="ml-4 w-5 h-5 text-gray-600" />
                <span className="ml-3 font-medium text-gray-900">Credit / Debit Card</span>
              </label>

              <label className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50 border-gray-200 transition-colors opacity-60">
                <input type="radio" name="payment_method" className="text-indigo-600" disabled />
                <Smartphone className="ml-4 w-5 h-5 text-gray-400" />
                <span className="ml-3 font-medium text-gray-500">UPI / QR (Currently disabled)</span>
              </label>
            </div>

            {/* Pay Button */}
            <button
              onClick={handlePayment}
              disabled={loading}
              className="w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-lg shadow-sm text-lg font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-70 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" />
                  Processing securely...
                </>
              ) : (
                `Pay ₹${payment.amount.toLocaleString()}`
              )}
            </button>
            
            <div className="mt-4 flex items-center justify-center text-xs text-gray-400">
              <ShieldCheck className="w-4 h-4 mr-1" />
              Simulated Environment
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
