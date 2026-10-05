import React, { useMemo, useState } from "react";
import { priceBatch } from "../api/neuralpricer";
import {
  Panel, PageHeader, ErrorBanner, Loading, MetricCard,
} from "../components/ui";

/* Price / value surface: strikes × maturities heatmap via /api/price/batch */

function niceColor(t) {
  // 0 → deep blue, 0.5 → teal, 1 → amber/red  (quant heatmap ramp)
  const stops = [
    [13, 17, 23],
    [22, 60, 100],
    [34, 130, 150],
    [63, 185, 80],
    [210, 153, 34],
    [248, 81, 73],
  ];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const STRIKE_STEPS = [0.7, 0.8, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2, 1.3];
const TENORS = [0.02, 0.08, 0.25, 0.5, 0.75, 1.0];

export default function Surface() {
  const [S, setS] = useState(85000);
  const [r, setR] = useState(0.045);
  const [sigma, setSigma] = useState(0.65);
  const [isCall, setIsCall] = useState(1);
  const [metric, setMetric] = useState("price"); // price | nn
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(null);

  const cells = useMemo(() => STRIKE_STEPS.length * TENORS.length, []);

  const build = async () => {
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const reqs = [];
      for (const t of TENORS) {
        for (const m of STRIKE_STEPS) {
          reqs.push({ S, K: Math.round((S * m) / 100) * 100, T: t, r, sigma, is_call: isCall });
        }
      }
      const res = await priceBatch(reqs);
      const rows = reqs.map((q, i) => ({ ...q, ...(res[i] || {}) }));
      setGrid(rows);
      setElapsed(((performance.now() - t0) / 1000).toFixed(2));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const values = useMemo(() => {
    if (!grid) return [];
    return grid
      .map((c) => (metric === "nn" ? c.nn_price : c.bs_price))
      .filter((v) => v != null);
  }, [grid, metric]);

  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;

  const cellValue = (c) => (metric === "nn" ? c.nn_price : c.bs_price);

  const numInput = (label, value, set, step, minV = 0) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-mono text-np-muted uppercase tracking-wider">{label}</label>
      <input
        type="number" value={value} step={step} min={minV}
        onChange={(e) => set(parseFloat(e.target.value))}
        className="bg-np-bg border border-np-border rounded px-3 py-2 text-np-text font-mono
                   text-sm focus:outline-none focus:border-np-accent w-full"
      />
    </div>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Price Surface"
        subtitle={`${cells} contracts priced in one batch — heatmap of option value across strikes × maturities.`}
        right={
          <div className="flex rounded border border-np-border overflow-hidden">
            {[["price", "BS price"], ["nn", "NN price"]].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setMetric(id)}
                className={`px-3 py-1.5 text-xs font-mono transition-all
                  ${metric === id ? "bg-np-accent text-np-bg" : "text-np-muted hover:text-np-text"}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      <Panel className="p-5 animate-slide-up">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
          {numInput("Spot (S)", S, setS, 100, 1)}
          {numInput("Rate (r)", r, setR, 0.005)}
          {numInput("Vol (σ)", sigma, setSigma, 0.05, 0.01)}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono text-np-muted uppercase tracking-wider">Type</label>
            <select
              value={isCall}
              onChange={(e) => setIsCall(parseInt(e.target.value))}
              className="bg-np-bg border border-np-border rounded px-3 py-2 text-np-text font-mono
                         text-sm focus:outline-none focus:border-np-accent h-[38px]"
            >
              <option value={1}>Call</option>
              <option value={0}>Put</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5 justify-end">
            <button
              onClick={build}
              disabled={loading}
              className="h-[38px] px-5 bg-np-accent text-np-bg rounded font-mono font-semibold
                         text-sm hover:opacity-90 disabled:opacity-50 transition-all
                         shadow-[0_0_16px_rgba(88,166,255,0.35)]"
            >
              {loading ? "Pricing…" : `Price ${cells} cells →`}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-np-muted font-mono">
          strikes = 70%…130% of spot · tenors = 1 week → 1 year · change inputs then re-price to refresh
        </p>
      </Panel>

      <ErrorBanner message={error} />
      {loading && <Loading text={`Batch-pricing ${cells} contracts…`} />}

      {grid && !loading && (
        <div className="animate-slide-up space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Min value" value={`$${min.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} sub="lowest cell" />
            <MetricCard label="Max value" value={`$${max.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} sub="highest cell" />
            <MetricCard
              label="NN coverage"
              value={grid.some((c) => c.nn_price != null) ? "active" : "BS only"}
              color={grid.some((c) => c.nn_price != null) ? "text-np-green" : "text-np-amber"}
              sub={metric === "nn" && !grid.some((c) => c.nn_price != null) ? "train the model to enable" : "data source"}
            />
            <MetricCard label="Batch time" value={`${elapsed}s`} color="text-np-cyan" sub={`${cells} contracts`} />
          </div>

          <Panel className="p-5 overflow-x-auto">
            <h2 className="text-sm font-semibold text-np-text mb-4 flex items-center gap-2">
              <span className="w-1 h-4 bg-np-cyan rounded-full" />
              {metric === "nn" ? "Neural network price" : "Black-Scholes price"} heatmap ($)
            </h2>

            <table className="border-separate border-spacing-1 min-w-[640px]">
              <thead>
                <tr>
                  <th className="text-[10px] font-mono uppercase tracking-wider text-np-muted p-2 text-left">
                    T ↓ / K →
                  </th>
                  {STRIKE_STEPS.map((m) => (
                    <th key={m} className="text-[10px] font-mono text-np-muted p-2 text-center">
                      {(m * 100).toFixed(0)}%{" "}
                      <span className="block text-np-border">
                        {(S * m / 1000).toFixed(0)}k
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TENORS.map((t) => (
                  <tr key={t}>
                    <td className="text-[10px] font-mono text-np-muted p-2 whitespace-nowrap">
                      {t < 0.08 ? `${Math.round(t * 365)}d` : `${(t * 12).toFixed(1)}mo`}
                    </td>
                    {STRIKE_STEPS.map((m) => {
                      const cell = grid.find(
                        (c) => Math.abs(c.T - t) < 1e-9 && Math.abs(c.K - Math.round((S * m) / 100) * 100) < 1
                      );
                      const v = cell ? cellValue(cell) : null;
                      const norm = max > min && v != null ? (v - min) / (max - min) : 0.5;
                      return (
                        <td
                          key={m}
                          title={
                            v == null
                              ? "No NN model — train the model first"
                              : `K=${Math.round(S * m).toLocaleString()} · T=${t} · $${v.toFixed(2)}`
                          }
                          className="w-20 h-14 rounded text-center align-middle transition-transform
                                     hover:scale-105 hover:z-10 relative cursor-default"
                          style={{
                            background: v == null ? "rgb(var(--np-panel))" : niceColor(norm),
                            border: v == null ? "1px dashed rgb(var(--np-border))" : "1px solid rgba(13,17,23,0.6)",
                          }}
                        >
                          <span
                            className="font-mono text-xs font-semibold tabular-nums"
                            style={{ color: v == null ? "rgb(var(--np-muted))" : norm > 0.62 ? "#0D1117" : "#E6EDF3" }}
                          >
                            {v == null ? "—" : `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Legend */}
            <div className="flex items-center gap-3 mt-5">
              <span className="text-[10px] font-mono text-np-muted">low ${min.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <div className="h-2 flex-1 max-w-xs rounded-full" style={{ background: `linear-gradient(90deg, ${niceColor(0)}, ${niceColor(0.25)}, ${niceColor(0.5)}, ${niceColor(0.75)}, ${niceColor(1)})` }} />
              <span className="text-[10px] font-mono text-np-muted">high ${max.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="ml-auto text-[10px] font-mono text-np-muted">
                hover a cell for detail · dashed = unavailable (no NN model)
              </span>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
