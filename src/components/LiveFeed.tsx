import React from "react";
import { CheckCircle2, XCircle, Clock, AlertOctagon, Eye } from "lucide-react";

interface PaymentItem {
  id: string;
  externalId: string;
  amount: number;
  currency: string;
  method: string;
  bank: string | null;
  upiApp: string | null;
  status: string;
  errorCode: string | null;
  createdAt: string;
  customer: {
    email: string;
  };
  failureEvent: {
    category: string;
    rootCause: string;
    recoveryProbability: number;
  } | null;
  recoveryAttempts: Array<{
    strategy: string;
    outcome: string;
    attemptNumber: number;
  }>;
}

export function LiveFeed({
  payments,
  onSelectPayment,
}: {
  payments: PaymentItem[];
  onSelectPayment: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 shadow-xl backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Live Recovery Activity Feed</h2>
          <p className="text-xs text-slate-400">
            Real-time multi-agent triage, autonomous interventions, and audit logs
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Live Agent Pipeline
        </span>
      </div>

      <div className="mt-4 divide-y divide-slate-800/60 overflow-hidden">
        {payments.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            No payment events recorded yet. Run a simulation batch or send a webhook event.
          </div>
        ) : (
          payments.map((p) => {
            const latestAttempt = p.recoveryAttempts[0];
            const prob = p.failureEvent?.recoveryProbability
              ? (p.failureEvent.recoveryProbability * 100).toFixed(0)
              : null;

            return (
              <div
                key={p.id}
                className="group flex flex-col justify-between gap-3 py-3.5 transition hover:bg-slate-800/30 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {p.status === "RECOVERED" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    ) : p.status === "RECOVERY_IN_PROGRESS" ? (
                      <Clock className="h-5 w-5 text-amber-400 animate-spin" />
                    ) : p.status === "DEAD" ? (
                      <AlertOctagon className="h-5 w-5 text-rose-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-slate-500" />
                    )}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-white">
                        ₹{p.amount.toLocaleString("en-IN")}
                      </span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
                        {p.method}
                      </span>
                      {p.bank && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                          {p.bank}
                        </span>
                      )}
                      {prob && (
                        <span className="text-[11px] text-slate-400">
                          Prob: <span className="text-cyan-400 font-medium">{prob}%</span>
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400 line-clamp-1">
                      {p.failureEvent?.rootCause ?? p.errorCode ?? "Processing..."}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <div className="text-right">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${
                        p.status === "RECOVERED"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : p.status === "RECOVERY_IN_PROGRESS"
                          ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                          : p.status === "DEAD"
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {latestAttempt?.strategy
                        ? `${latestAttempt.strategy} (${p.status})`
                        : p.status}
                    </span>
                    <div className="text-[10px] text-slate-500">
                      {new Date(p.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => onSelectPayment(p.id)}
                    className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-700"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Audit
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
