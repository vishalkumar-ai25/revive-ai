import React from "react";
import { Play, Sparkles, RefreshCw } from "lucide-react";

export function SimulationControls({
  onRefresh,
}: {
  onRefresh: () => void;
}) {
  const [running, setRunning] = React.useState(false);
  const [batchCount, setBatchCount] = React.useState(100);

  const runSimulation = async (mode: "single" | "batch") => {
    setRunning(true);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, count: batchCount }),
      });
      const data = await res.json();
      if (data.success) {
        onRefresh();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-emerald-400" />
        <div>
          <h3 className="text-sm font-semibold text-white">Batch Simulation & Evaluation Bench</h3>
          <p className="text-xs text-slate-400">
            Stress-test autonomous recovery pipeline on synthetic Indian payment failure distribution
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={batchCount}
          onChange={(e) => setBatchCount(Number(e.target.value))}
          disabled={running}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value={20}>Batch: 20 Payments</option>
          <option value={50}>Batch: 50 Payments</option>
          <option value={100}>Batch: 100 Payments</option>
          <option value={500}>Batch: 500 Payments</option>
        </select>

        <button
          onClick={() => runSimulation("single")}
          disabled={running}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5 text-cyan-400" />
          Simulate 1 Failure
        </button>

        <button
          onClick={() => runSimulation("batch")}
          disabled={running}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white shadow-md shadow-emerald-950 transition hover:bg-emerald-500 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Executing Pipeline..." : "Run Batch Simulation"}
        </button>
      </div>
    </div>
  );
}
