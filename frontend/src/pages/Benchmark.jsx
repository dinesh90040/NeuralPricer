import React, { useMemo, useRef, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid, ReferenceLine, LineChart, Line,
} from "recharts";
import { Zap, Cpu, Dice5, Radio } from "lucide-react";
import { priceOption, API_BASE } from "../api/neuralpricer";
import {
  Panel, PageHeader, MetricCard, ErrorBanner, Loading, CHART_TOOLTIP, AXIS_TICK,
} from "../components/ui";

/* Reference numbers from the guides (README / SETUP_GUIDE): */
const speedData = [
  { name: "NeuralPricer (GPU)", ms: 3.2, color: "#3FB950", icon: "zap" },
  { name: "Black-Scholes (CPU)", ms: 48, color: "#58A6FF", icon: "cpu" },
  { name: "Monte Carlo 10k paths", ms: 26400, color: "#F85149", icon: "dice" },
];

const accuracyRows = [
  ["RMSE", "$0.084"],
  ["MAE", "$0.041"],
  ["R²", "0.99971"],
  ["Max error", "$1.23"],
  ["Speedup vs MC", "8,250×"],
  ["Training time", "~35 min (T4)"],
  ["Inference batch", "50,000 contracts"],
];

const SAMPLE = { S: 85000, K: 85000, T: 0.25, r: 0.045, sigma: 0.65, is_call: 1 };

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export default function Benchmark({ health }) {
  const [latencies, setLatencies] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [runs, setRuns] = useState(0);
  const samplesRef = useRef([]);

  /* Live client-side benchmark: hits /api/price N times and records real latency */
  const runLiveBenchmark = async (n = 30) => {
    setRunning(true);
    setError(null);
    samplesRef.current = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      try {
        await priceOption({ ...SAMPLE, S: SAMPLE.S + (i % 7) * 137 });
        samplesRef.current.push(performance.now() - t0);
      } catch (e) {
        setError(e.message);
        break;
      }
    }
    setLatencies([...samplesRef.current]);
    setRuns((r) => r + 1);
    setRunning(false);
  };

  const stats = useMemo(() => {
    if (!latencies.length) return null;
    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = sum / sorted.length;
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    return {
      avg, p50, p95,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      rps: 1000 / avg,
      n: sorted.length,
    };
  }, [latencies]);

  const latencySeries = useMemo(
    () => latencies.map((ms, i) => ({ i: i + 1, ms: Math.round(ms * 100) / 100 })),
    [latencies]
  );

  const icons = { zap: Zap, cpu: Cpu, dice: Dice5 };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <PageHeader
        title="Benchmark"
        subtitle="NeuralPricer vs Black-Scholes vs Monte Carlo — reference numbers from the guides, plus a live latency test against your running API."
      />

      <ErrorBanner message={error} />

      {/* Reference speed + accuracy */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-np-text mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-np-green rounded-full" />
            Inference speed — 50k contracts (log scale)
          </h2>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={speedData} layout="vertical" margin={{ top: 5, right: 16, left: 8, bottom: 5 }}>
              <CartesianGrid stroke="var(--np-chart-grid)" strokeDasharray="3 3" strokeOpacity={0.5} horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} axisLine={{ stroke: "var(--np-chart-grid)" }} tickLine={false}
                scale="log" domain={[1, 100000]}
                tickFormatter={(v) => (v >= 1000 ? `${v / 1000}s` : `${v}ms`)}
                ticks={[1, 10, 100, 1000, 10000, 100000]} />
              <YAxis type="category" dataKey="name" width={140} tick={AXIS_TICK}
                axisLine={false} tickLine={false} tickFormatter={(v) => v} />
              <Tooltip contentStyle={CHART_TOOLTIP}
                cursor={{ fill: "rgba(88,166,255,0.06)" }}
                formatter={(v) => [v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`, "time"]} />
              <Bar dataKey="ms" radius={[0, 4, 4, 0]} barSize={22}>
                {speedData.map((e, i) => (
                  <Cell key={i} fill={e.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-3 text-[11px] font-mono text-np-muted">
            {speedData.map((d) => (
              <span key={d.name} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                {d.name}
              </span>
            ))}
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-np-text mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-np-accent rounded-full" />
            Accuracy metrics (held-out test set)
          </h2>
          <table className="w-full text-sm font-mono">
            <tbody>
              {accuracyRows.map(([label, val]) => (
                <tr key={label} className="border-b border-np-border/40 last:border-0">
                  <td className="py-2.5 text-np-muted">{label}</td>
                  <td className="py-2.5 text-np-accent font-semibold text-right">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* Live benchmark */}
      <Panel className="p-5 glow-accent">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-semibold text-np-text flex items-center gap-2">
            <span className="w-1 h-4 bg-np-violet rounded-full" />
            Live API latency test — measured in your browser
            <Radio size={13} className={`text-np-violet ${running ? "animate-pulse" : ""}`} />
          </h2>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-np-muted">POST {API_BASE}/api/price</span>
            <button
              onClick={() => runLiveBenchmark(30)}
              disabled={running}
              className="px-5 py-2 bg-np-violet text-np-bg rounded font-mono font-semibold
                         text-sm hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {running ? "Running…" : "Run 30-call benchmark"}
            </button>
          </div>
        </div>

        {running && <Loading text="Sending sequential pricing requests…" />}

        {stats && !running && (
          <div className="space-y-5 animate-slide-up">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <MetricCard label="Median" value={`${stats.p50.toFixed(0)} ms`} color="text-np-accent" sub="p50 round-trip" />
              <MetricCard label="p95" value={`${stats.p95.toFixed(0)} ms`} color="text-np-violet" sub="worst-case tail" />
              <MetricCard label="Min" value={`${stats.min.toFixed(0)} ms`} color="text-np-green" sub="fastest call" />
              <MetricCard label="Throughput" value={`${stats.rps.toFixed(1)}/s`} color="text-np-cyan" sub="sequential, no concurrency" />
              <MetricCard label="Samples" value={stats.n} sub={`run #${runs}`} />
            </div>

            <div>
              <h3 className="text-xs font-mono text-np-muted uppercase tracking-wider mb-2">
                Latency per call (ms)
              </h3>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={latencySeries} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke="var(--np-chart-grid)" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <XAxis dataKey="i" tick={AXIS_TICK} axisLine={{ stroke: "var(--np-chart-grid)" }} tickLine={false}
                    label={{ value: "call #", position: "insideBottomRight", offset: -2, fill: "rgb(var(--np-muted))", fontSize: 10 }} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}ms`} />
                  <Tooltip contentStyle={CHART_TOOLTIP}
                    formatter={(v) => [`${v} ms`, "latency"]}
                    labelFormatter={(l) => `call ${l}`} />
                  <ReferenceLine y={stats.p50} stroke="#58A6FF" strokeDasharray="4 4"
                    label={{ value: "p50", fill: "#58A6FF", fontSize: 10, fontFamily: "monospace" }} />
                  <Line type="monotone" dataKey="ms" stroke="#BC8CFF" strokeWidth={2} dot={{ r: 2, fill: "#BC8CFF" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {!stats && !running && (
          <p className="text-xs text-np-muted font-mono">
            Run the benchmark to measure real round-trip latency: browser → Flask → Black-Scholes
            {health?.model_ready ? " → PyTorch NN" : " (NN inactive until a model is trained)"} → browser.
          </p>
        )}
      </Panel>

      {/* Key takeaway */}
      <Panel className="p-5">
        <h2 className="text-sm font-semibold text-np-text mb-2">Key takeaway</h2>
        <p className="text-sm text-np-muted leading-relaxed">
          NeuralPricer is <span className="text-np-accent font-mono font-semibold">8,250×</span> faster
          than Monte Carlo pricing while achieving R² of <span className="text-np-green font-mono font-semibold">0.99971</span> against
          the analytical Black-Scholes formula. The model was trained for ~35 minutes on a free
          Google Colab T4 GPU. Once deployed, a batch of 50,000 contracts is priced in under 4ms —
          while the live numbers above show what your own API actually delivers right now.
        </p>
      </Panel>
    </div>
  );
}
