import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts";
import { RefreshCw, Search, ArrowUpDown } from "lucide-react";
import { fetchLiveChain } from "../api/neuralpricer";
import {
  Panel, PageHeader, MetricCard, ErrorBanner, Loading, SkeletonRows,
  CHART_TOOLTIP, AXIS_TICK,
} from "../components/ui";

const COLUMNS = [
  { key: "instrument",     label: "Instrument", sortable: true },
  { key: "S",              label: "Spot",       sortable: true, num: true },
  { key: "K",              label: "Strike",     sortable: true, num: true },
  { key: "days",           label: "Days Left",  sortable: true, num: true },
  { key: "sigma",          label: "IV",         sortable: true, num: true },
  { key: "is_call",        label: "Type",       sortable: true },
  { key: "mid_price",      label: "Mid Price",  sortable: true, num: true },
  { key: "nn_price",       label: "NN Price",   sortable: true, num: true },
  { key: "gapPct",         label: "NN−Mid %",   sortable: true, num: true },
];

export default function LiveChain() {
  const [currency, setCurrency] = useState("BTC");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState(null);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // all | call | put
  const [sort, setSort] = useState({ key: "instrument", dir: 1 });
  const [elapsed, setElapsed] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const rows = await fetchLiveChain(currency);
      setData(rows);
      setLastFetch(new Date().toLocaleTimeString());
      setElapsed(((performance.now() - t0) / 1000).toFixed(1));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [currency]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 60000); // refresh every 60s
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const enriched = useMemo(() => {
    return data.map((r) => ({
      ...r,
      days: Math.round(r.T * 365),
      gapPct:
        r.nn_price != null && r.mid_price
          ? ((r.nn_price - r.mid_price) / r.mid_price) * 100
          : null,
    }));
  }, [data]);

  const view = useMemo(() => {
    let rows = enriched;
    if (query.trim()) {
      const q = query.trim().toUpperCase();
      rows = rows.filter((r) => (r.instrument || "").toUpperCase().includes(q));
    }
    if (typeFilter !== "all") {
      rows = rows.filter((r) => (typeFilter === "call" ? r.is_call === 1 : r.is_call === 0));
    }
    const { key, dir } = sort;
    rows = [...rows].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return dir * av.localeCompare(bv);
      return dir * (av - bv);
    });
    return rows;
  }, [enriched, query, typeFilter, sort]);

  const stats = useMemo(() => {
    if (!enriched.length) return null;
    const spot = enriched[0].S;
    const ivs = enriched.map((r) => r.sigma).filter((v) => v > 0);
    const calls = enriched.filter((r) => r.is_call === 1).length;
    const nnRows = enriched.filter((r) => r.nn_price != null);
    return {
      spot,
      contracts: enriched.length,
      avgIv: ivs.reduce((a, b) => a + b, 0) / ivs.length,
      minT: Math.min(...enriched.map((r) => r.days)),
      maxT: Math.max(...enriched.map((r) => r.days)),
      calls,
      puts: enriched.length - calls,
      nnCount: nnRows.length,
    };
  }, [enriched]);

  // IV smile: log-moneyness vs IV, per option type
  const smiles = useMemo(() => ({
    call: enriched.filter((r) => r.is_call === 1 && r.sigma > 0 && r.log_moneyness != null)
      .map((r) => ({ x: r.log_moneyness, iv: r.sigma * 100, K: r.K })),
    put: enriched.filter((r) => r.is_call === 0 && r.sigma > 0 && r.log_moneyness != null)
      .map((r) => ({ x: r.log_moneyness, iv: r.sigma * 100, K: r.K })),
  }), [enriched]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));

  const money = (v) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Live Option Chain"
        subtitle={
          <>
            Real-time data from Deribit
            {lastFetch && <> · Last updated <span className="font-mono text-np-accent">{lastFetch}</span></>}
            {elapsed && <> · fetched in {elapsed}s</>}
          </>
        }
        right={
          <div className="flex gap-2 items-center flex-wrap">
            {["BTC", "ETH"].map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className={`px-4 py-1.5 rounded font-mono text-sm font-semibold transition-all
                  ${currency === c
                    ? "bg-np-accent text-np-bg shadow-[0_0_12px_rgba(88,166,255,0.4)]"
                    : "border border-np-border text-np-muted hover:text-np-text"}`}
              >
                {c}
              </button>
            ))}
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={`px-3 py-1.5 rounded font-mono text-xs transition-all border
                ${autoRefresh
                  ? "border-np-green text-np-green bg-np-green/10"
                  : "border-np-border text-np-muted hover:text-np-text"}`}
              title="Auto-refresh every 60 seconds"
            >
              {autoRefresh ? "◉ auto 60s" : "○ auto"}
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded border border-np-border
                         text-np-muted text-sm hover:text-np-text transition-all disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        }
      />

      <ErrorBanner message={error} />

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4 animate-fade-in">
          <MetricCard label="Spot" value={money(stats.spot)} color="text-np-accent" sub={`${currency} index`} />
          <MetricCard label="Contracts" value={stats.contracts} sub={`${stats.calls}C / ${stats.puts}P`} />
          <MetricCard label="Avg IV" value={`${(stats.avgIv * 100).toFixed(1)}%`} color="text-np-amber" sub="average mark IV" />
          <MetricCard label="Expiries" value={`${stats.minT}–${stats.maxT}d`} sub="days to expiry" />
          <MetricCard
            label="NN Priced"
            value={stats.nnCount > 0 ? `${stats.nnCount}/${stats.contracts}` : "—"}
            color={stats.nnCount > 0 ? "text-np-green" : "text-np-muted"}
            sub={stats.nnCount > 0 ? "model loaded" : "model not loaded"}
          />
          <MetricCard label="Source" value="Deribit" color="text-np-cyan" sub="public REST API" />
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-np-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter instrument… e.g. 26SEP25 or 90000"
            className="bg-np-panel border border-np-border rounded pl-9 pr-3 py-2 text-sm
                       font-mono text-np-text w-72 focus:outline-none focus:border-np-accent"
          />
        </div>
        <div className="flex rounded border border-np-border overflow-hidden">
          {[["all", "All"], ["call", "Calls"], ["put", "Puts"]].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTypeFilter(id)}
              className={`px-3 py-1.5 text-xs font-mono transition-all
                ${typeFilter === id ? "bg-np-accent text-np-bg" : "text-np-muted hover:text-np-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-xs text-np-muted">
          {view.length} of {enriched.length} rows
        </span>
      </div>

      {/* Table */}
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-np-border text-np-muted bg-np-panel">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => col.sortable && toggleSort(col.key)}
                    className={`px-4 py-3 font-medium uppercase tracking-wider whitespace-nowrap
                      ${col.num ? "text-right" : "text-left"}
                      ${col.sortable ? "cursor-pointer hover:text-np-accent select-none" : ""}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sort.key === col.key && (
                        <ArrowUpDown size={11} className="text-np-accent" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && data.length === 0 && <SkeletonRows rows={8} cols={COLUMNS.length} />}
              {!loading && view.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-np-muted">
                    {data.length === 0
                      ? "No data — click Refresh, or check that the backend is running (port 8000)."
                      : "No rows match the current filter."}
                  </td>
                </tr>
              )}
              {view.map((row, i) => (
                <tr
                  key={`${row.instrument}-${i}`}
                  className="border-b border-np-border/40 hover:bg-np-border/20 transition-colors"
                >
                  <td className="px-4 py-2.5 text-np-accent whitespace-nowrap">{row.instrument}</td>
                  <td className="px-4 py-2.5 text-right">{money(row.S)}</td>
                  <td className="px-4 py-2.5 text-right">{money(row.K)}</td>
                  <td className="px-4 py-2.5 text-right">{row.days}d</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={row.sigma > 1 ? "text-np-red" : row.sigma > 0.6 ? "text-np-amber" : "text-np-text"}>
                      {(row.sigma * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold
                        ${row.is_call
                          ? "bg-green-900/40 text-np-green"
                          : "bg-red-900/40 text-np-red"}`}
                    >
                      {row.is_call ? "CALL" : "PUT"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">${Number(row.mid_price).toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-np-accent">
                    {row.nn_price != null ? `$${Number(row.nn_price).toFixed(2)}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {row.gapPct == null ? (
                      <span className="text-np-muted">—</span>
                    ) : (
                      <span className={Math.abs(row.gapPct) < 5 ? "text-np-green" : "text-np-amber"}>
                        {row.gapPct > 0 ? "+" : ""}{row.gapPct.toFixed(2)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && data.length > 0 && (
          <div className="px-4 py-2 border-t border-np-border text-np-muted font-mono text-[11px] flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-np-accent border-t-transparent rounded-full animate-spin" />
            refreshing…
          </div>
        )}
      </Panel>

      {/* IV smile */}
      {smiles.call.length + smiles.put.length > 0 && (
        <Panel className="p-5 animate-slide-up">
          <h2 className="text-sm font-semibold text-np-text mb-1 flex items-center gap-2">
            <span className="w-1 h-4 bg-np-amber rounded-full" />
            Implied volatility smile
          </h2>
          <p className="text-xs text-np-muted mb-4 font-mono">
            log-moneyness log(S/K) vs mark IV — the smile is exactly what Black-Scholes assumes away
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
              <CartesianGrid stroke="var(--np-chart-grid)" strokeDasharray="3 3" strokeOpacity={0.5} />
              <XAxis type="number" dataKey="x" name="log-moneyness" tick={AXIS_TICK}
                axisLine={{ stroke: "var(--np-chart-grid)" }} tickLine={false}
                tickFormatter={(v) => v.toFixed(2)}
                label={{ value: "log(S/K)", position: "insideBottom", offset: -2, fill: "rgb(var(--np-muted))", fontSize: 11 }} />
              <YAxis type="number" dataKey="iv" name="IV" tick={AXIS_TICK} axisLine={false}
                tickLine={false} tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <Tooltip contentStyle={CHART_TOOLTIP}
                formatter={(v, n) => (n === "IV" ? [`${Number(v).toFixed(1)}%`, "IV"] : [Number(v).toFixed(4), n])}
                labelFormatter={() => ""} />
              <ReferenceLine x={0} stroke="#D29922" strokeDasharray="4 4"
                label={{ value: "ATM", fill: "#D29922", fontSize: 10, fontFamily: "monospace" }} />
              <Scatter data={smiles.call} fill="#3FB950" fillOpacity={0.65} r={3} />
              <Scatter data={smiles.put} fill="#F85149" fillOpacity={0.65} r={3} />
            </ScatterChart>
          </ResponsiveContainer>
          <div className="flex gap-4 justify-center mt-2 text-[11px] font-mono text-np-muted">
            <span><span className="inline-block w-2 h-2 rounded-full bg-np-green mr-1.5" />calls</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-np-red mr-1.5" />puts</span>
            <span>amber = at-the-money</span>
          </div>
        </Panel>
      )}

      {loading && data.length === 0 && !error && (
        <Loading text="Fetching live chain from Deribit — first load pulls every active instrument…" />
      )}
    </div>
  );
}
