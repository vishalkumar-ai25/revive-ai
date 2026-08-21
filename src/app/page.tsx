"use client";

import React from "react";
import { MetricCards } from "@/components/MetricCards";
import { LiveFeed } from "@/components/LiveFeed";
import { SimulationControls } from "@/components/SimulationControls";
import { AuditModal } from "@/components/AuditModal";
import { ShieldCheck, RefreshCw, Zap, Landmark } from "lucide-react";

export default function Dashboard() {
  const [data, setData] = React.useState<any>(null);
  const [selectedPaymentId, setSelectedPaymentId] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    try {
      const res = await fetch("/api/analytics");
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch (e) {
      console.error("Failed to load dashboard data:", e);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-[#070b13] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Navigation / Brand Header */}
        <div className="flex flex-col justify-between gap-4 border-b border-slate-800/80 pb-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-950">
              <Zap className="h-6 w-6 text-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                  ReviveAI
                </h1>
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                  Track 03 · Autonomous Revenue Recovery
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Multi-Agent Triage · Dynamic Interventions · Bounded Retries · Compliant Audit Trails
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300">
              <Landmark className="h-4 w-4 text-slate-400" />
              <span>Razorpay AI Buildathon 2026</span>
            </div>
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>

        {/* Simulation Action Bar */}
        <SimulationControls onRefresh={fetchData} />

        {/* Main Metric KPIs */}
        <MetricCards summary={data?.summary} />

        {/* Failure Categories & Strategy Distribution */}
        {data?.categoryStats && data.categoryStats.length > 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm lg:col-span-2">
              <h3 className="text-sm font-semibold text-white">Failure Root Cause Distribution</h3>
              <p className="text-xs text-slate-400 mb-4">
                Categorized by DiagnosisAgent across Indian PSPs and banks
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {data.categoryStats.map((cat: any) => (
                  <div
                    key={cat.category}
                    className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-3"
                  >
                    <div className="text-[11px] font-medium text-slate-400 truncate">
                      {cat.category}
                    </div>
                    <div className="mt-1 text-lg font-bold text-white">{cat.count}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm">
              <h3 className="text-sm font-semibold text-white">Guardrails & Compliance</h3>
              <p className="text-xs text-slate-400 mb-4">
                Enforcing non-negotiable stopping rules
              </p>
              <ul className="space-y-2.5 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>Max 4 Retries with Exponential Backoff</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>Quiet Hours Respect (9 PM – 9 AM IST)</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>Fraud Blocks Zero-Retry Policy</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>Full Immutable Audit Trail Logged</span>
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Live Recovery Feed */}
        <LiveFeed
          payments={data?.recentPayments ?? []}
          onSelectPayment={(id) => setSelectedPaymentId(id)}
        />

        {/* Audit Modal */}
        <AuditModal
          paymentId={selectedPaymentId}
          onClose={() => setSelectedPaymentId(null)}
        />
      </div>
    </div>
  );
}
