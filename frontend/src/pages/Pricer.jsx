import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, Cell, CartesianGrid,
} from "recharts";
import { priceOption, fetchHistory } from "../api/neuralpricer";
import {
  Panel, PageHeader, Field, Slider, MetricCard, GreekBadge,
  ErrorBanner, NoteBanner, Loading, CHART_TOOLTIP, AXIS_TICK,
} from "../components/ui";

const DEFAULTS = { S: 85000, K: 85000, T: 0.25, r: 0.045, sigma: 0.65, is_call: 1 };

function isValid(p) {
  return (
    Number.isFinite(p.S) && p.S > 0 &&
    Number.isFinite(p.K) && p.K > 0 &&
    Number.isFinite(p.T) && p.T > 0 &&
    Number.isFinite(p.r) && p.r >= 0 &&
    Number.isFinite(p.sigma) && p.sigma > 0
  );
}

export default function Pricer() {
  const [params, setParams] = useState(DEFAULTS);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqSeq = useRef(0);

  // MongoDB quote history
  const [history, setHistory] = useState([]);
  const [histErr, setHistErr] = useState(null);
  const [histScope, setHistScope] = useState(null);
  const lastHistFetch = useRef(0);

  async function loadHistory(force = false) {
    const now = Date.now();
    if (!force && now - lastHistFetch.current < 3000) return; // throttle
    lastHistFetch.current = now;
    try {
      const res = await fetchHistory(12);
      setHistory(res.items || []);
      setHistScope(res.scope || null);
      setHistErr(null);
    } catch (e) {
      setHistErr(e.message);
    }
  }

  useEffect(() => { loadHistory(true); /* eslint-disable-next-line */ }, []);

  const handleChange = (name, val) => setParams((p) => ({ ...p, [name]: val }));

  // Debounced live pricing — re-price automatically ~400ms after any change
  useEffect(() => {
    if (!isValid(params)) return;
    const id = setTimeout(() => runPrice(params), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function runPrice(p = params) {
    if (!isValid(p)) {
      setError("Invalid inputs — S, K, T, r, sigma must be positive numbers.");
      return;
    }
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await priceOption(p);
      if (seq === reqSeq.current) {
        setResult(data);
        loadHistory(); // quote was persisted to MongoDB server-side
      }
    } catch (e) {
      if (seq === reqSeq.current) setError(e.message);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }

  // Payoff / P&L at expiry across a spot range around the strike
  const payoffData = useMemo(() => {
    const K = params.K;
    if (!Number.isFinite(K) || K <= 0) return [];
    const premium = result?.bs_price ?? null;
    const lo = K * 0.6, hi = K * 1.4, n = 80;
    const rows = Array.from({ length: n + 1 }, (_, i) => {
      const s = lo + ((hi - lo) * i) / n;
      const intrinsic = params.is_call === 1 ? Math.max(s - K, 0) : Math.max(K - s, 0);
      return {
        S: Math.round(s),
        payoff: premium != null ? intrinsic - premium : intrinsic,
        intrinsic,
      };
    });
    return rows;
  }, [params.K, params.is_call, result?.bs_price]);

  const breakEven = useMemo(() => {
    const prem = result?.bs_price;
    if (prem == null) return null;
    return params.is_call === 1 ? params.K + prem : params.K - prem;
  }, [result?.bs_price, params.K, params.is_call]);

  const comparison = result
    ? [
        { name: "NN", value: result.nn_price ?? 0, color: "#58A6FF", missing: result.nn_price == null },
        { name: "BS", value: result.bs_price, color: "#3FB950", missing: false },
      ]
    : [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <PageHeader
        title="Option Pricer"
        subtitle="Neural network + Black-Scholes side by side — results refresh live as you adjust inputs."
        right={
          <div className="flex gap-2">
            {[1, 0].map((c) => (
              <button
                key={c}
                onClick={() => handleChange("is_call", c)}
                className={`px-4 py-1.5 rounded font-mono text-sm font-semibold transition-all
                  ${params.is_call === c
                    ? c === 1 ? "bg-np-green text-np-bg" : "bg-np-red text-white"
                    : "border border-np-border text-np-muted hover:text-np-text"}`}
              >
                {c === 1 ? "CALL" : "PUT"}
              </button>
            ))}
          </div>
        }
      />

      {/* ── Input panel ─────────────────────────────────────────────────────── */}
      <Panel className="p-5 animate-slide-up">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-5">
          <Field label="Spot (S)" name="S" value={params.S} onChange={handleChange} step={100} min={1} />
          <Field label="Strike (K)" name="K" value={params.K} onChange={handleChange} step={100} min={1} />
          <Field label="Maturity T" name="T" value={params.T} onChange={handleChange} step={0.01} min={0.001} />
          <Field label="Rate (r)" name="r" value={params.r} onChange={handleChange} step={0.001} min={0} />
          <Field label="Vol (σ)" name="sigma" value={params.sigma} onChange={handleChange} step={0.01} min={0.01} />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono text-np-muted uppercase tracking-wider">Type</label>
            <select
              value={params.is_call}
              onChange={(e) => handleChange("is_call", parseInt(e.target.value))}
              className="bg-np-bg border border-np-border rounded px-3 py-2 text-np-text font-mono
                         text-sm focus:outline-none focus:border-np-accent transition-colors h-[38px]"
            >
              <option value={1}>Call</option>
              <option value={0}>Put</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mb-5">
          <Slider
            label="Spot price" value={params.S} min={Math.max(1, params.K * 0.5)} max={params.K * 1.5}
            step={Math.max(1, Math.round(params.K / 2000))}
            onChange={(v) => handleChange("S", v)} format={(v) => `$${Number(v).toLocaleString()}`}
          />
          <Slider
            label="Implied volatility" value={params.sigma} min={0.05} max={2} step={0.01}
            onChange={(v) => handleChange("sigma", v)} format={(v) => `${(v * 100).toFixed(0)}%`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => runPrice()}
            disabled={loading || !isValid(params)}
            className="px-6 py-2.5 bg-np-accent text-np-bg rounded font-mono font-semibold
                       text-sm hover:opacity-90 disabled:opacity-50 transition-all
                       shadow-[0_0_16px_rgba(88,166,255,0.35)]"
          >
            {loading ? "Pricing…" : "Price Option →"}
          </button>
          <button
            onClick={() => setParams({ ...params, K: params.S })}
            className="px-4 py-2.5 border border-np-border rounded font-mono text-sm
                       text-np-muted hover:text-np-text hover:border-np-accent transition-all"
          >
            ⇄ Set ATM (K = S)
          </button>
          <button
            onClick={() => setParams(DEFAULTS)}
            className="px-4 py-2.5 border border-np-border rounded font-mono text-sm
                       text-np-muted hover:text-np-text hover:border-np-accent transition-all"
          >
            ↺ Reset
          </button>
          <span className="ml-auto font-mono text-xs text-np-muted">
            {loading ? "computing…" : result ? "auto-updated" : "awaiting inputs"}
          </span>
        </div>
      </Panel>

      <ErrorBanner message={error} />
      {result?.note && <NoteBanner message={result.note} />}

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {result && (
        <div className="animate-slide-up space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="NN Price"
              value={result.nn_price != null ? `$${result.nn_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "No model"}
              color="text-np-accent"
              sub="Neural network inference"
            />
            <MetricCard
              label="BS Price"
              value={`$${result.bs_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              color="text-np-green"
              sub="Black-Scholes analytical"
            />
            <MetricCard
              label="Abs Error"
              value={result.abs_error != null ? `$${result.abs_error.toFixed(4)}` : "—"}
              color={result.abs_error != null ? "text-np-green" : "text-np-muted"}
              sub="|NN − BS|"
            />
            <MetricCard
              label="NN vs Black-Scholes %"
              value={result.pct_error != null ? `${result.pct_error.toFixed(3)}%` : "—"}
              color={result.pct_error != null ? "text-np-green" : "text-np-muted"}
              sub="relative to BS price"
            />
          </div>
          {result.bs_price < 5 && result.pct_error != null && (
            <NoteBanner message="The NN-vs-Black-Scholes percentage gap can look large when the option price is very cheap." />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Greeks */}
            <Panel className="p-5">
              <h2 className="text-sm font-semibold text-np-text mb-4 flex items-center gap-2">
                <span className="w-1 h-4 bg-np-accent rounded-full" />
                Greeks — Black-Scholes analytical
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {result.greeks &&
                  Object.entries(result.greeks).map(([k, v]) => (
                    <GreekBadge key={k} name={k} value={v} />
                  ))}
              </div>
              <p className="text-[11px] text-np-muted mt-4 font-mono leading-relaxed">
                Δ spot sensitivity · Γ Δ rate of change · ν per 1% vol · Θ per day decay · ρ per 1% rate
              </p>
            </Panel>

            {/* NN vs BS comparison */}
            <Panel className="p-5">
              <h2 className="text-sm font-semibold text-np-text mb-4 flex items-center gap-2">
                <span className="w-1 h-4 bg-np-green rounded-full" />
                NN vs Black-Scholes
              </h2>
              {result.nn_price != null ? (
                <ResponsiveContainer width="100%" height={170}>
                  <BarChart data={comparison} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: "var(--np-chart-grid)" }} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                    <Tooltip contentStyle={CHART_TOOLTIP}
                      formatter={(v) => [`$${Number(v).toFixed(2)}`, "price"]} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={64}>
                      {comparison.map((e, i) => (
                        <Cell key={i} fill={e.color} fillOpacity={e.missing ? 0.3 : 1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[170px] flex flex-col items-center justify-center text-center gap-2">
                  <p className="text-np-amber font-mono text-sm">Model not loaded</p>
                  <p className="text-np-muted text-xs max-w-xs">
                    Train the model (<span className="font-mono">training/train.py</span>) and place{" "}
                    <span className="font-mono">best_model_scripted.pt</span> + scalers in{" "}
                    <span className="font-mono">models/</span> — NN prices appear automatically.
                  </p>
                </div>
              )}
            </Panel>
          </div>

          {/* Payoff diagram */}
          <Panel className="p-5">
            <h2 className="text-sm font-semibold text-np-text mb-1 flex items-center gap-2">
              <span className="w-1 h-4 bg-np-violet rounded-full" />
              Payoff &amp; P&amp;L at expiry
            </h2>
            <p className="text-xs text-np-muted mb-4 font-mono">
              premium = ${result.bs_price.toFixed(2)} · break-even ={" "}
              {breakEven != null ? `$${breakEven.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={payoffData} margin={{ top: 5, right: 16, left: 8, bottom: 5 }}>
                <CartesianGrid stroke="var(--np-chart-grid)" strokeDasharray="3 3" strokeOpacity={0.5} />
                <XAxis dataKey="S" tick={AXIS_TICK} axisLine={{ stroke: "var(--np-chart-grid)" }} tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={CHART_TOOLTIP}
                  formatter={(v, n) => [`$${Number(v).toFixed(2)}`, n]}
                  labelFormatter={(l) => `Spot $${Number(l).toLocaleString()}`} />
                <ReferenceLine y={0} stroke="rgb(var(--np-muted))" />
                <ReferenceLine x={params.K} stroke="#D29922" strokeDasharray="4 4"
                  label={{ value: "K", fill: "#D29922", fontSize: 11, fontFamily: "monospace", position: "insideTopLeft" }} />
                {breakEven != null && (
                  <ReferenceLine x={breakEven} stroke="#3FB950" strokeDasharray="4 4"
                    label={{ value: "BE", fill: "#3FB950", fontSize: 11, fontFamily: "monospace", position: "insideTopRight" }} />
                )}
                <Line type="monotone" dataKey="payoff" stroke="#BC8CFF" strokeWidth={2.5} dot={false} name="P&L" />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-np-muted mt-2 font-mono text-center">
              dashed amber = strike · dashed green = break-even · {params.is_call === 1 ? "call" : "put"} payoff net of premium
            </p>
          </Panel>
        </div>
      )}

      {!result && !error && loading && <Loading text="Pricing…" />}

      {/* ── MongoDB quote history ──────────────────────────────────────── */}
      <Panel className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-1 h-4 bg-np-cyan rounded-full" />
          <h2 className="text-sm font-semibold text-np-text">Recent quotes — MongoDB</h2>
          <button
            onClick={() => loadHistory(true)}
            className="ml-auto px-3 py-1 border border-np-border rounded font-mono text-xs
                       text-np-muted hover:text-np-text hover:border-np-accent transition-all"
          >
            ↻ Refresh
          </button>
        </div>
        <p className="text-xs text-np-muted font-mono mb-4">
          Every pricing request is written to the <span className="text-np-cyan">price_logs</span> collection
          {histScope === "user" ? " and attributed to your account." : ". Sign in to attribute quotes to your account."}
        </p>

        {histErr ? (
          <p className="text-np-red font-mono text-xs">{histErr}</p>
        ) : history.length === 0 ? (
          <p className="text-np-muted font-mono text-xs">
            No quotes yet — adjust the inputs above and the first row appears here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-np-muted uppercase tracking-wider text-[10px] border-b border-np-border">
                  <th className="text-left py-2 pr-3">Time</th>
                  <th className="text-left py-2 pr-3">User</th>
                  <th className="text-right py-2 pr-3">Spot</th>
                  <th className="text-right py-2 pr-3">Strike</th>
                  <th className="text-right py-2 pr-3">T</th>
                  <th className="text-right py-2 pr-3">Vol</th>
                  <th className="text-left py-2 pr-3">Type</th>
                  <th className="text-right py-2">BS price</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={h.id || i} className="border-b border-np-border/50 hover:bg-np-border/30 transition-colors">
                    <td className="py-1.5 pr-3 text-np-muted whitespace-nowrap">
                      {h.ts ? new Date(h.ts).toLocaleTimeString() : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-np-muted max-w-[120px] truncate">{h.user || "anon"}</td>
                    <td className="py-1.5 pr-3 text-right">{Number(h.S).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right">{Number(h.K).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right">{h.T}</td>
                    <td className="py-1.5 pr-3 text-right">{h.sigma}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${h.is_call ? "bg-np-green/15 text-np-green" : "bg-np-red/15 text-np-red"}`}>
                        {h.is_call ? "CALL" : "PUT"}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-np-green">${Number(h.bs_price).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
