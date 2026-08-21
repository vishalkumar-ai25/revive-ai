import React from "react";
import { TrendingUp, AlertTriangle, ShieldCheck, Zap } from "lucide-react";

export interface SummaryData {
  totalPayments: number;
  failedPayments: number;
  recoveredPayments: number;
  inProgressPayments: number;
  totalAtRiskAmount: number;
  recoveredAmount: number;
  recoveryRate: number;
}

export function MetricCards({ summary }: { summary?: SummaryData }) {
  const atRisk = summary?.totalAtRiskAmount ?? 0;
  const recovered = summary?.recoveredAmount ?? 0;
  const rate = summary?.recoveryRate ?? 0;
  const inProgress = summary?.inProgressPayments ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Total At Risk */}
      <div className="rounded-xl border border-rose-900/40 bg-gradient-to-b from-rose-950/20 to-slate-900/60 p-5 shadow-lg backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-rose-400">
            Revenue At Risk
          </span>
          <div className="rounded-lg bg-rose-500/10 p-2 text-rose-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4">
          <div className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            ₹{atRisk.toLocaleString("en-IN")}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {summary?.failedPayments ?? 0} failed / degraded transactions
          </p>
        </div>
      </div>

      {/* Recovered Revenue */}
      <div className="rounded-xl border border-emerald-800/40 bg-gradient-to-b from-emerald-950/20 to-slate-900/60 p-5 shadow-lg backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Recovered Revenue
          </span>
          <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400">
            <TrendingUp className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4">
          <div className="text-2xl font-bold tracking-tight text-emerald-300 sm:text-3xl">
            ₹{recovered.toLocaleString("en-IN")}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {summary?.recoveredPayments ?? 0} transactions salvaged autonomously
          </p>
        </div>
      </div>

      {/* Recovery Success Rate */}
      <div className="rounded-xl border border-cyan-800/40 bg-gradient-to-b from-cyan-950/20 to-slate-900/60 p-5 shadow-lg backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
            Recovery Rate
          </span>
          <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-400">
            <Zap className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4">
          <div className="text-2xl font-bold tracking-tight text-cyan-300 sm:text-3xl">
            {rate.toFixed(1)}%
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Across bounded retry & nudge workflows
          </p>
        </div>
      </div>

      {/* Active Workflows */}
      <div className="rounded-xl border border-violet-800/40 bg-gradient-to-b from-violet-950/20 to-slate-900/60 p-5 shadow-lg backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">
            Active Recoveries
          </span>
          <div className="rounded-lg bg-violet-500/10 p-2 text-violet-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4">
          <div className="text-2xl font-bold tracking-tight text-violet-300 sm:text-3xl">
            {inProgress}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Agents reasoning or awaiting scheduled window
          </p>
        </div>
      </div>
    </div>
  );
}
