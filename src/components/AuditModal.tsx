import React from "react";
import { X, Bot } from "lucide-react";

interface AuditLogEntry {
  id: string;
  agentName: string;
  action: string;
  reasoning: string;
  metadata: any;
  createdAt: string;
}

interface PaymentDetails {
  id: string;
  externalId: string;
  amount: number;
  currency: string;
  method: string;
  bank: string | null;
  status: string;
  errorCode: string | null;
  customer: {
    email: string;
    totalPurchases: number;
    lifetimeValue: number;
  };
  failureEvent: {
    category: string;
    rootCause: string;
    diagnosisConfidence: number;
    recoveryProbability: number;
  } | null;
}

export function AuditModal({
  paymentId,
  onClose,
}: {
  paymentId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = React.useState<{
    payment: PaymentDetails;
    auditLogs: AuditLogEntry[];
  } | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!paymentId) return;
    setLoading(true);
    fetch(`/api/audit/${paymentId}`)
      .then((res) => res.json())
      .then((res) => {
        if (res.success) setData(res.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [paymentId]);

  if (!paymentId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-700 bg-[#0f172a] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                Agent Chain-of-Thought & Provenance Audit
              </h3>
              <p className="font-mono text-xs text-slate-400">
                Payment ID: {data?.payment.externalId ?? paymentId}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-140px)] overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400">
              Fetching audit records from immutable trail...
            </div>
          ) : !data ? (
            <div className="py-12 text-center text-sm text-rose-400">
              Failed to load audit trail for this transaction.
            </div>
          ) : (
            <>
              {/* Payment Summary Context */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:grid-cols-4 text-xs">
                <div>
                  <span className="text-slate-400">Amount</span>
                  <div className="font-mono font-semibold text-white text-sm">
                    ₹{data.payment.amount.toLocaleString("en-IN")}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400">Method / Bank</span>
                  <div className="font-medium text-slate-200">
                    {data.payment.method} {data.payment.bank ? `(${data.payment.bank})` : ""}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400">Customer LTV</span>
                  <div className="font-medium text-emerald-400">
                    ₹{data.payment.customer?.lifetimeValue?.toLocaleString("en-IN") ?? 0}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400">Current Status</span>
                  <div className="font-semibold text-cyan-300">
                    {data.payment.status}
                  </div>
                </div>
              </div>

              {/* Step-by-Step Decision Trace */}
              <div>
                <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Autonomous Decision Pipeline
                </h4>

                <div className="relative space-y-6 border-l-2 border-slate-800 pl-6 ml-2">
                  {data.auditLogs.map((log) => {
                    const isDiagnosis = log.agentName === "DiagnosisAgent";
                    const isRisk = log.agentName === "RiskAssessmentAgent";
                    const isStrategy = log.agentName === "StrategyAgent";
                    const isStopping = log.agentName === "StoppingRulesEngine";

                    return (
                      <div key={log.id} className="relative">
                        <span
                          className={`absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-[#0f172a] ${
                            isDiagnosis
                              ? "bg-indigo-500"
                              : isRisk
                              ? "bg-amber-500"
                              : isStrategy
                              ? "bg-emerald-500"
                              : isStopping
                              ? "bg-rose-500"
                              : "bg-cyan-500"
                          }`}
                        />
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-200">
                              {log.agentName}
                            </span>
                            <span className="text-[11px] font-mono text-slate-500">
                              {new Date(log.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="mt-1 text-xs font-medium text-slate-300">
                            Action: <span className="font-mono text-cyan-400">{log.action}</span>
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-slate-300 bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
                            {log.reasoning}
                          </p>

                          {log.metadata && Object.keys(log.metadata).length > 0 && (
                            <details className="mt-2 text-[11px] text-slate-400">
                              <summary className="cursor-pointer font-medium hover:text-slate-300">
                                View Structured Evidence Payload
                              </summary>
                              <pre className="mt-2 overflow-x-auto rounded bg-black/60 p-2 font-mono text-[10px] text-slate-300">
                                {JSON.stringify(log.metadata, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
