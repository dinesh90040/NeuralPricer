import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, RefreshCw, Timer,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { fetchCandles, fetchChain, fetchSpot } from "../api/neuralpricer";
import {
  ErrorBanner, GreekBadge, Loading, MetricCard, NoteBanner, PageHeader, Panel,
} from "../components/ui";
import MarketCandles from "../components/MarketCandles";

const TIMEFRAMES = [
  { id: "5m", resolution: "5", hours: 24 },
  { id: "1h", resolution: "60", hours: 168 },
  { id: "1D", resolution: "1D", hours: 720 },
];
const QUOTE_REFRESH_MS = 15_000;
const SPOT_REFRESH_MS = 3_000;
const CANDLE_REFRESH_MS = 15_000;

function money(value, digits = 2) {
  return Number.isFinite(Number(value))
    ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })}`
    : "—";
}

function OptionQuote({ option, selected, onSelect }) {
  if (!option) return <span className="text-np-muted">—</span>;
  const gap = option.nn_price == null || !option.mid_price
    ? null
    : ((option.nn_price - option.mid_price) / option.mid_price) * 100;
  return (
    <button
      type="button"
      onClick={() => onSelect(option)}
      aria-label={`${option.is_call ? "Call" : "Put"} ${option.strike}, market ${money(option.mid_price)}`}
      aria-pressed={selected}
      className={`w-full rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-np-accent
        ${selected ? "border-np-accent bg-np-accent/10" : "border-transparent hover:border-np-border"}
        ${option.inTheMoney ? "bg-np-green/5" : ""}`}
    >
      <span className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-mono leading-tight sm:grid-cols-3">
        <span className="text-np-text" title="Market mid">{money(option.mid_price)}</span>
        <span className="text-np-muted" title="Mark implied volatility">{option.mark_iv.toFixed(1)}% IV</span>
        <span className="text-np-muted" title="Open interest">OI {option.open_interest.toLocaleString()}</span>
        <span className="text-np-muted" title="24-hour volume">Vol {option.volume.toLocaleString()}</span>
        <span className={option.nn_price == null ? "text-np-amber" : "text-np-accent"} title="Neural network estimate">
          NN {money(option.nn_price)}
        </span>
        <span className={gap == null ? "text-np-muted" : Math.abs(gap) >= 25 ? "text-np-amber" : "text-np-green"} title="NN vs market mid">
          Gap {gap == null ? "—" : `${gap > 0 ? "+" : ""}${gap.toFixed(1)}%`}
        </span>
      </span>
    </button>
  );
}

function ContractDetail({ contract, chain }) {
  const strike = contract.strike;
  const spot = contract.spot;
  const premium = contract.mid_price;
  const payoff = useMemo(() => {
    const low = strike * 0.7;
    const high = strike * 1.3;
    return Array.from({ length: 51 }, (_, index) => {
      const price = low + ((high - low) * index) / 50;
      const intrinsic = contract.is_call ? Math.max(price - strike, 0) : Math.max(strike - price, 0);
      return { spot: price, pnl: intrinsic - premium };
    });
  }, [contract.is_call, premium, strike]);
  const smile = useMemo(() => chain
    .filter((row) => row.expiry === contract.expiry)
    .map((row) => ({ strike: row.strike, iv: row.mark_iv, is_call: row.is_call })), [chain, contract.expiry]);

  return (
    <section aria-label="Selected contract details" className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Panel className="p-4">
        <h2 className="text-sm font-semibold text-np-text">{contract.instrument}</h2>
        <p className="mt-1 text-xs font-mono text-np-muted">
          {contract.is_call ? "CALL" : "PUT"} · expiry {contract.expiry}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MetricCard label="Market mid" value={money(contract.mid_price)} sub={`Bid ${money(contract.bid_usd)} · Ask ${money(contract.ask_usd)}`} />
          <MetricCard label="Black–Scholes" value={money(contract.bs_price)} sub="mark IV estimate" />
          <MetricCard label="Neural network" value={money(contract.nn_price)} color={contract.nn_price == null ? "text-np-amber" : "text-np-accent"} sub={contract.nn_price == null ? "NN unavailable" : "model estimate"} />
        </div>
        <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 gap-2">
          {Object.entries(contract.bs_greeks || {}).map(([name, value]) => (
            <GreekBadge key={name} name={name} value={value} />
          ))}
        </div>
        {contract.nn_price != null && contract.mid_price < 5 && (
          <p className="mt-3 text-[11px] text-np-amber font-mono">
            Percentage gaps can look large on very cheap options.
          </p>
        )}
      </Panel>
      <Panel className="p-4">
        <h2 className="text-sm font-semibold text-np-text mb-3">Expiry payoff at current premium</h2>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={payoff} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="pnl-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3FB950" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#3FB950" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--np-chart-grid)" strokeDasharray="3 3" />
            <XAxis dataKey="spot" tick={{ fontSize: 10, fill: "rgb(var(--np-muted))" }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <YAxis tick={{ fontSize: 10, fill: "rgb(var(--np-muted))" }} tickFormatter={(v) => money(v, 0)} width={54} />
            <Tooltip formatter={(v) => [money(v), "P&L"]} labelFormatter={(v) => `Underlying ${money(v)}`} />
            <Area type="monotone" dataKey="pnl" stroke="#3FB950" fill="url(#pnl-fill)" />
          </AreaChart>
        </ResponsiveContainer>
        <p className="text-[10px] font-mono text-np-muted">At expiry, before fees; premium uses the current market mid.</p>
      </Panel>
      <Panel className="p-4">
        <h2 className="text-sm font-semibold text-np-text mb-1">Implied-volatility smile</h2>
        <p className="text-[10px] text-np-muted font-mono mb-2">Deribit mark IV by strike · selected expiry</p>
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--np-chart-grid)" strokeDasharray="3 3" />
            <XAxis type="number" dataKey="strike" tick={{ fontSize: 10, fill: "rgb(var(--np-muted))" }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <YAxis type="number" dataKey="iv" tick={{ fontSize: 10, fill: "rgb(var(--np-muted))" }} tickFormatter={(v) => `${v}%`} width={38} />
            <Tooltip formatter={(v, name) => [name === "iv" ? `${Number(v).toFixed(1)}%` : v, name === "iv" ? "Mark IV" : name]} labelFormatter={() => ""} />
            <Scatter data={smile.filter((row) => row.is_call)} fill="#3FB950" name="Calls" />
            <Scatter data={smile.filter((row) => !row.is_call)} fill="#F85149" name="Puts" />
          </ScatterChart>
        </ResponsiveContainer>
      </Panel>
      <span className="sr-only">Current spot is {money(spot)}.</span>
    </section>
  );
}

export default function Dashboard({ health, theme }) {
  const [currency, setCurrency] = useState("BTC");
  const [timeframe, setTimeframe] = useState(TIMEFRAMES[0]);
  const [spots, setSpots] = useState({});
  const [spotError, setSpotError] = useState(null);
  const [candles, setCandles] = useState([]);
  const [candlesLoaded, setCandlesLoaded] = useState(false);
  const [candlesError, setCandlesError] = useState(null);
  const [chain, setChain] = useState([]);
  const [expiries, setExpiries] = useState([]);
  const [expiry, setExpiry] = useState(null);
  const [selected, setSelected] = useState(null);
  const [chainLoading, setChainLoading] = useState(true);
  const [chainError, setChainError] = useState(null);
  const [stale, setStale] = useState(false);
  const [chainUpdated, setChainUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const refreshSpots = useCallback(async () => {
    const results = await Promise.allSettled(["BTC", "ETH"].map((symbol) => fetchSpot(symbol)));
    const failures = [];
    setSpots((current) => {
      const next = { ...current };
      results.forEach((result, index) => {
        const symbol = ["BTC", "ETH"][index];
        if (result.status === "fulfilled") next[symbol] = result.value.spot;
        else failures.push(`${symbol}: ${result.reason.message}`);
      });
      return next;
    });
    setSpotError(failures.length ? failures.join(" · ") : null);
  }, []);

  const refreshCandles = useCallback(async () => {
    try {
      const result = await fetchCandles(currency, timeframe.resolution, timeframe.hours);
      setCandles(result.candles);
      setCandlesLoaded(true);
      setCandlesError(null);
    } catch (e) {
      setCandlesLoaded(true);
      setCandlesError(e.message);
    }
  }, [currency, timeframe]);

  const refreshChain = useCallback(async (showLoading = false) => {
    if (showLoading) setChainLoading(true);
    setChainError(null);
    try {
      const result = await fetchChain(currency, expiry);
      setChain(result.items || []);
      setExpiries(result.expiries || []);
      setStale(!!result.stale);
      setChainUpdated(result.last_updated || null);
      if (!expiry && result.expiries?.length) {
        setExpiry(result.expiries[0]);
      }
    } catch (e) {
      setChainError(e.message);
      setStale(true);
    } finally {
      setChainLoading(false);
    }
  }, [currency, expiry]);

  useEffect(() => {
    refreshSpots();
    const id = window.setInterval(refreshSpots, SPOT_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refreshSpots]);

  useEffect(() => {
    refreshCandles();
    if (!autoRefresh) return undefined;
    const id = window.setInterval(refreshCandles, CANDLE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, refreshCandles]);

  useEffect(() => {
    setExpiry(null);
    setSelected(null);
    setChain([]);
    setChainLoading(true);
  }, [currency]);

  useEffect(() => {
    refreshChain(true);
    if (!autoRefresh) return undefined;
    const id = window.setInterval(() => refreshChain(false), QUOTE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, refreshChain]);

  const spot = spots[currency] || chain[0]?.spot || 0;
  const strikes = useMemo(() => {
    const groups = new Map();
    for (const option of chain) {
      const key = Number(option.strike);
      const group = groups.get(key) || { strike: key, call: null, put: null };
      const contract = {
        ...option,
        inTheMoney: option.is_call ? spot > key : spot < key,
      };
      if (option.is_call) group.call = contract;
      else group.put = contract;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.strike - b.strike);
  }, [chain, spot]);
  const atmStrike = useMemo(() => strikes.reduce(
    (closest, row) => Math.abs(row.strike - spot) < Math.abs(closest - spot) ? row.strike : closest,
    strikes[0]?.strike ?? 0,
  ), [spot, strikes]);
  const selectedContract = selected
    ? chain.find((row) => row.instrument === selected.instrument) || selected
    : null;
  const timeframeData = candlesError && candles.length
    ? "Candles could not be refreshed; showing the last loaded chart."
    : null;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Deribit Options"
        subtitle="BTC and ETH index, perpetual candles, and the live European options chain."
        right={
          <label className="flex items-center gap-2 rounded border border-np-border px-3 py-2 text-xs font-mono text-np-muted">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            Auto-refresh
          </label>
        }
      />

      <section aria-label="BTC and ETH index prices" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {["BTC", "ETH"].map((symbol) => (
          <button
            type="button"
            key={symbol}
            onClick={() => setCurrency(symbol)}
            aria-pressed={currency === symbol}
            className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-np-accent
              ${currency === symbol ? "border-np-accent bg-np-accent/5" : "border-np-border bg-np-panel hover:border-np-accent/50"}`}
          >
            <span className="text-xs font-mono uppercase tracking-wider text-np-muted">{symbol} index</span>
            <span className="mt-1 block text-2xl font-mono font-semibold text-np-text">
              {spots[symbol] ? money(spots[symbol]) : "—"}
            </span>
            <span className="mt-1 block text-[10px] font-mono text-np-muted">Updated every 3 seconds</span>
          </button>
        ))}
      </section>

      {spotError && <NoteBanner message={`Spot refresh issue: ${spotError}`} />}
      {!health.model_loaded && (
        <NoteBanner message="NN unavailable — showing Black–Scholes prices only. Check model files and the backend PyTorch environment." />
      )}
      <NoteBanner message="Educational project only. Model prices are estimates, not investment advice or a forecast of market direction. BTC and ETH European-style options only; model estimates are intended for expiries at least 1 day away and volatility around 20–150%." />

      <Panel className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold text-np-text">{currency}-PERPETUAL</h2>
          <span className="text-[10px] font-mono text-np-muted">Deribit OHLC · index quote refreshes separately</span>
          {TIMEFRAMES.map((range) => (
            <button
              key={range.id}
              type="button"
              aria-pressed={timeframe.id === range.id}
              onClick={() => setTimeframe(range)}
              className={`rounded px-3 py-1.5 text-xs font-mono ${timeframe.id === range.id ? "bg-np-accent text-np-bg" : "border border-np-border text-np-muted hover:text-np-text"}`}
            >
              {range.id}
            </button>
          ))}
        </div>
        {candlesError && !candles.length ? (
          <ErrorBanner message={candlesError} />
        ) : candles.length ? (
          <>
            {timeframeData && <NoteBanner message={timeframeData} />}
            <MarketCandles currency={currency} candles={candles} theme={theme} />
          </>
        ) : candlesLoaded ? (
          <p className="py-12 text-center text-sm font-mono text-np-muted">No candle data returned for this timeframe.</p>
        ) : (
          <Loading text={`Loading ${currency} candles from Deribit…`} />
        )}
      </Panel>

      <section aria-labelledby="chain-heading" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="chain-heading" className="text-base font-semibold text-np-text">Options chain</h2>
          <span className="font-mono text-xs text-np-muted">{chain.length} contracts · {expiry || "loading expiries"}</span>
          <span className="ml-auto flex items-center gap-2 text-xs font-mono text-np-muted">
            {stale && <span className="text-np-amber"><AlertTriangle size={13} className="inline" /> Stale data</span>}
            {chainUpdated && <span>Updated {new Date(chainUpdated).toLocaleTimeString()}</span>}
            <button
              type="button"
              onClick={() => refreshChain(true)}
              disabled={chainLoading}
              aria-label="Refresh options chain"
              className="rounded border border-np-border p-2 hover:text-np-accent disabled:opacity-50"
            >
              <RefreshCw size={14} className={chainLoading ? "animate-spin" : ""} />
            </button>
          </span>
        </div>

        {chainError && <ErrorBanner message={chainError} />}
        {expiries.length > 0 && (
          <div role="tablist" aria-label="Option expiry dates" className="flex gap-2 overflow-x-auto pb-1">
            {expiries.map((date) => (
              <button
                key={date}
                type="button"
                role="tab"
                aria-selected={expiry === date}
                onClick={() => { setExpiry(date); setSelected(null); }}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-mono ${expiry === date ? "border-np-accent bg-np-accent text-np-bg" : "border-np-border text-np-muted hover:text-np-text"}`}
              >
                {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" })}
              </button>
            ))}
          </div>
        )}

        {chainLoading && !chain.length ? (
          <Loading text="Fetching live Deribit chain…" />
        ) : strikes.length ? (
          <>
            <Panel className="hidden overflow-hidden lg:block">
              <div className="grid grid-cols-[minmax(0,1fr)_90px_minmax(0,1fr)] gap-2 border-b border-np-border bg-np-panel px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-np-muted">
                <span>Calls · price / IV / OI / vol / NN / gap</span>
                <span className="text-center">Strike</span>
                <span className="text-right">Puts · price / IV / OI / vol / NN / gap</span>
              </div>
              <div className="max-h-[540px] overflow-y-auto">
                {strikes.map((row) => (
                  <div key={row.strike} className="grid grid-cols-[minmax(0,1fr)_90px_minmax(0,1fr)] items-center gap-2 border-b border-np-border/40 px-2 py-1 last:border-0">
                    <OptionQuote option={row.call} selected={selected?.instrument === row.call?.instrument} onSelect={setSelected} />
                    <span className={`text-center font-mono text-xs font-semibold ${row.strike === atmStrike ? "rounded bg-np-amber/15 py-2 text-np-amber" : "text-np-muted"}`}>
                      {row.strike.toLocaleString()}
                      {row.strike === atmStrike && <span className="block text-[9px]">ATM</span>}
                    </span>
                    <OptionQuote option={row.put} selected={selected?.instrument === row.put?.instrument} onSelect={setSelected} />
                  </div>
                ))}
              </div>
            </Panel>
            <div className="space-y-2 lg:hidden">
              {strikes.map((row) => (
                <Panel key={row.strike} className="p-2">
                  <div className={`mb-1 text-center font-mono text-xs font-semibold ${row.strike === atmStrike ? "text-np-amber" : "text-np-muted"}`}>
                    Strike {row.strike.toLocaleString()} {row.strike === atmStrike ? "· ATM" : ""}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <div>
                      <p className="px-2 text-[9px] font-mono uppercase text-np-green">Call</p>
                      <OptionQuote option={row.call} selected={selected?.instrument === row.call?.instrument} onSelect={setSelected} />
                    </div>
                    <div>
                      <p className="px-2 text-[9px] font-mono uppercase text-np-red">Put</p>
                      <OptionQuote option={row.put} selected={selected?.instrument === row.put?.instrument} onSelect={setSelected} />
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
            {selectedContract && <ContractDetail contract={selectedContract} chain={chain} />}
          </>
        ) : !chainError ? (
          <Panel className="p-6 text-center text-sm text-np-muted">No contracts are available for this expiry.</Panel>
        ) : null}

        <p className="text-[11px] font-mono text-np-muted">
          Neural-network gap is NN estimate vs market mid, not a buy/sell signal. The percentage gap can look large on very cheap options.
        </p>
      </section>

      <Panel className="flex items-start gap-2 p-3 text-[11px] font-mono text-np-muted">
        <Timer size={14} className="mt-0.5 shrink-0 text-np-accent" />
        Spot polls every 3 seconds; chain and chart refresh every 15 seconds when auto-refresh is enabled. This app is educational, not investment advice.
      </Panel>
    </div>
  );
}
