import React, { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid,
} from "recharts";
import { priceBatch } from "../api/neuralpricer";
import {
  Panel, PageHeader, ErrorBanner, Loading, GreekBadge,
  CHART_TOOLTIP, AXIS_TICK,
} from "../components/ui";

const GREEKS = ["delta", "gamma", "vega", "theta", "rho"];
const COLORS = {
  delta: "#58A6FF", gamma: "#39D2C0", vega: "#BC8CFF",
  theta: "#F85149", rho: "#D29922",
};

function generateSpotRange(baseParams, nPoints = 60) {
  const S_min = baseParams.K * 0.6;
  const S_max = baseParams.K * 1.4;
  const step = (S_max - S_min) / nPoints;
  return Array.from({ length: nPoints + 1 }, (_, i) => ({
    ...baseParams,
    S: parseFloat((S_min + i * step).toFixed(2)),
  }));
}

function GreekChart({ data, greek, strike, height = 240, compact = false }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 14, left: 0, bottom: 5 }}>
        <CartesianGrid stroke="var(--np-chart-grid)" strokeDasharray="3 3" strokeOpacity={0.5} />
        <XAxis dataKey="S" tick={AXIS_TICK} axisLine={{ stroke: "var(--np-chart-grid)" }} tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          interval={compact ? "preserveStartEnd" : undefined} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false}
          tickFormatter={(v) => (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(1))}
          width={compact ? 54 : 64} />
        <Tooltip contentStyle={CHART_TOOLTIP}
          formatter={(v) => [Number(v).toFixed(6), greek]}
          labelFormatter={(l) => `Spot $${Number(l).toLocaleString()}`} />
        <ReferenceLine x={strike} stroke="#D29922" strokeDasharray="4 4"
          label={{ value: "K", fill: "#D29922", fontSize: 11, fontFamily: "monospace", position: "insideTopLeft" }} />
        <ReferenceLine y={0} stroke="rgb(var(--np-muted))" strokeOpacity={0.6} />
        <Line type="monotone" dataKey={greek} stroke={COLORS[greek]} strokeWidth={2.2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function Greeks() {
  const [params, setParams] = useState({ K: 85000, T: 0.25, r: 0.045, sigma: 0.65, is_call: 1 });
  const [activeGreek, setActiveGreek] = useState("delta");
  const [showAll, setShowAll] = useState(false);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(null);

  const handleChange = (name, val) => setParams((p) => ({ ...p, [name]: val }));

  const handlePlot = async () => {
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const spotRange = generateSpotRange(params);
      // One batch call instead of 61 individual requests
      const results = await priceBatch(spotRange);
      const data = spotRange.map((p, i) => ({
        S: Math.round(p.S),
        delta: results[i]?.greeks?.delta,
        gamma: results[i]?.greeks?.gamma,
        vega: results[i]?.greeks?.vega,
        theta: results[i]?.greeks?.theta,
        rho: results[i]?.greeks?.rho,
        price: results[i]?.bs_price,
      }));
      if (data.every((d) => d.delta == null)) {
        setError("Batch pricing returned no Greeks — check backend logs.");
      } else {
        setChartData(data);
        setElapsed(((performance.now() - t0) / 1000).toFixed(2));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const activeValueAtStrike = useMemo(() => {
    if (!chartData.length) return null;
    const mid = chartData.reduce((best, row) =>
      Math.abs(row.S - params.K) < Math.abs(best.S - params.K) ? row : best
    );
    return mid;
  }, [chartData, params.K]);

  const input = (label, name, step) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-mono text-np-muted uppercase tracking-wider">{label}</label>
      <input
        type="number" value={params[name]} step={step}
        onChange={(e) => handleChange(name, parseFloat(e.target.value))}
        className="bg-np-bg border border-np-border rounded px-3 py-2 text-np-text font-mono
                   text-sm focus:outline-none focus:border-np-accent w-full"
      />
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <PageHeader
        title="Greeks Explorer"
        subtitle="See how each Greek moves as spot sweeps around the strike — 61 points in a single batch request."
      />

      <Panel className="p-5 animate-slide-up">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
          {input("Strike (K)", "K", 500)}
          {input("Maturity (T)", "T", 0.05)}
          {input("Vol (σ)", "sigma", 0.05)}
          {input("Rate (r)", "r", 0.005)}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono text-np-muted uppercase tracking-wider">Type</label>
            <select
              value={params.is_call}
              onChange={(e) => handleChange("is_call", parseInt(e.target.value))}
              className="bg-np-bg border border-np-border rounded px-3 py-2 text-np-text font-mono
                         text-sm focus:outline-none focus:border-np-accent h-[38px]"
            >
              <option value={1}>Call</option>
              <option value={0}>Put</option>
            </select>
          </div>
        </div>
        <button
          onClick={handlePlot}
          disabled={loading}
          className="px-6 py-2.5 bg-np-accent text-np-bg rounded font-mono font-semibold
                     text-sm hover:opacity-90 disabled:opacity-50 transition-all
                     shadow-[0_0_16px_rgba(88,166,255,0.35)]"
        >
          {loading ? "Computing…" : "Plot Greeks →"}
        </button>
        {elapsed && !loading && (
          <span className="ml-4 font-mono text-xs text-np-muted">
            61 points priced in {elapsed}s
          </span>
        )}
      </Panel>

      <ErrorBanner message={error} />
      {loading && <Loading text="Pricing 61 spot points via batch endpoint…" />}

      {chartData.length > 0 && !loading && (
        <div className="animate-slide-up space-y-6">
          {/* Greek selector badges with value at the strike */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {GREEKS.map((g) => (
              <GreekBadge
                key={g}
                name={g}
                value={activeValueAtStrike?.[g]}
                active={!showAll && activeGreek === g}
                onClick={() => { setActiveGreek(g); setShowAll(false); }}
              />
            ))}
          </div>

          {showAll ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {GREEKS.map((g) => (
                <Panel key={g} className="p-4">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-np-muted mb-2">
                    {g} <span style={{ color: COLORS[g] }}>{g[0].toUpperCase()}</span>
                  </h3>
                  <GreekChart data={chartData} greek={g} strike={params.K} height={190} compact />
                </Panel>
              ))}
            </div>
          ) : (
            <Panel className="p-5 glow-accent">
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <div className="flex gap-2 flex-wrap">
                  {GREEKS.map((g) => (
                    <button
                      key={g}
                      onClick={() => setActiveGreek(g)}
                      className={`px-3 py-1.5 rounded font-mono text-xs font-semibold transition-all
                        ${activeGreek === g
                          ? "bg-np-accent text-np-bg"
                          : "border border-np-border text-np-muted hover:text-np-text"}`}
                    >
                      {g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowAll(true)}
                  className="px-3 py-1.5 rounded font-mono text-xs border border-np-border
                             text-np-muted hover:text-np-text transition-all"
                >
                  ⊞ Show all five
                </button>
              </div>
              <GreekChart data={chartData} greek={activeGreek} strike={params.K} height={300} />
              <p className="text-[11px] text-np-muted mt-2 font-mono text-center">
                spot vs {activeGreek} — dashed amber line = strike (K = {params.K.toLocaleString()})
              </p>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
