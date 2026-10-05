import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowRight, Brain, CheckCircle2, ChevronRight, Cpu, Database, Gauge,
  Layers, LineChart, Network, Rocket, Server, Sparkles, Terminal, Timer, Waves,
  Zap, LogIn, UserPlus,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { CHART_TOOLTIP, ThemeToggle } from "../components/ui";

/* ── Black–Scholes math (client-side, no API needed for the hero demo) ────── */
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

function bsPrice(S, K, days, r, sigma, isCall) {
  const T = days / 365;
  if (T <= 0 || sigma <= 0 || S <= 0) return isCall ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / sq;
  const d2 = d1 - sq;
  return isCall
    ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2)
    : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

/* ── Scroll reveal ────────────────────────────────────────────────────────── */
function Reveal({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${shown ? "visible" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ── Animated counter ─────────────────────────────────────────────────────── */
function CountUp({ to, duration = 1300, decimals = 0, suffix = "", prefix = "" }) {
  const [val, setVal] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t) => {
          const p = Math.min(1, (t - t0) / duration);
          setVal(to * (1 - Math.pow(1 - p, 3)));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, duration]);
  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {val.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

/* ── Hero mini-pricer ─────────────────────────────────────────────────────── */
function HeroPricingCard({ theme }) {
  const SPOT = 85000;
  const [strike, setStrike] = useState(90000);
  const [days, setDays] = useState(30);
  const [iv, setIv] = useState(0.55);

  const accent = theme === "light" ? "#1F6FEB" : "#58A6FF";
  const amber = theme === "light" ? "#9A6700" : "#D29922";

  const call = bsPrice(SPOT, strike, days, 0.05, iv, true);
  const put = bsPrice(SPOT, strike, days, 0.05, iv, false);

  const chartData = useMemo(() => {
    const pts = [];
    const lo = SPOT * 0.72;
    const hi = SPOT * 1.28;
    for (let i = 0; i <= 48; i++) {
      const s = lo + ((hi - lo) * i) / 48;
      pts.push({ S: s, call: bsPrice(s, strike, days, 0.05, iv, true) });
    }
    return pts;
  }, [strike, days, iv]);

  const MiniSlider = ({ label, value, onChange, min, max, step, format }) => (
    <div>
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-[10px] font-mono text-np-muted uppercase tracking-wider">{label}</span>
        <span className="text-[11px] font-mono text-np-accent font-semibold">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );

  return (
    <div className="relative animate-float">
      <div className="absolute -inset-3 bg-np-accent/10 blur-2xl rounded-3xl" />
      <div className="relative bg-np-panel border border-np-border rounded-2xl p-5 sm:p-6 glow-accent">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-np-green animate-pulse-slow" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-np-muted">
              BTC-USDT · live BS quote
            </span>
          </div>
          <span className="font-mono text-[10px] text-np-muted px-1.5 py-0.5 border border-np-border rounded">
            r = 5%
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-np-bg border border-np-border rounded-lg p-3">
            <p className="text-[10px] font-mono text-np-muted uppercase tracking-wider">Spot</p>
            <p className="font-mono font-semibold text-sm mt-0.5">${SPOT.toLocaleString("en-US")}</p>
          </div>
          <div className="bg-np-bg border border-np-accent/50 rounded-lg p-3">
            <p className="text-[10px] font-mono text-np-accent uppercase tracking-wider">Call</p>
            <p className="font-mono font-semibold text-sm mt-0.5 text-np-green">
              ${call.toFixed(0)}
            </p>
          </div>
          <div className="bg-np-bg border border-np-violet/50 rounded-lg p-3">
            <p className="text-[10px] font-mono text-np-violet uppercase tracking-wider">Put</p>
            <p className="font-mono font-semibold text-sm mt-0.5 text-np-red">${put.toFixed(0)}</p>
          </div>
        </div>

        <div className="h-[170px] -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--np-chart-grid)" strokeDasharray="3 3" strokeOpacity={0.5} />
              <XAxis
                dataKey="S"
                tick={{ fill: "rgb(var(--np-muted))", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: "var(--np-chart-grid)" }}
                tickLine={false}
                tickFormatter={(v) => `${Math.round(v / 1000)}k`}
              />
              <YAxis
                tick={{ fill: "rgb(var(--np-muted))", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
              />
              <Tooltip contentStyle={CHART_TOOLTIP} labelFormatter={(v) => `Spot $${Math.round(v).toLocaleString("en-US")}`} formatter={(v) => [`$${v.toFixed(0)}`, "Call"]} />
              <ReferenceLine x={strike} stroke={amber} strokeDasharray="4 4" />
              <Area type="monotone" dataKey="call" stroke={accent} strokeWidth={2.2} fill="url(#heroFill)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 space-y-3.5 pt-4 border-t border-np-border">
          <MiniSlider label="Strike" value={strike} onChange={setStrike} min={60000} max={120000} step={1000} format={(v) => `$${v.toLocaleString("en-US")}`} />
          <MiniSlider label="Days to expiry" value={days} onChange={setDays} min={1} max={180} step={1} format={(v) => `${v}d`} />
          <MiniSlider label="Implied vol" value={iv} onChange={setIv} min={0.1} max={1.5} step={0.01} format={(v) => `${(v * 100).toFixed(0)}%`} />
        </div>

        <p className="mt-4 font-mono text-[10px] text-np-muted/70 text-center">
          computed in-browser · same engine as /api/price
        </p>
      </div>
    </div>
  );
}

/* ── Animated progress bar (grows when scrolled into view) ────────────────── */
function Bar({ pct, className = "" }) {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setW(pct);
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pct]);
  return (
    <div
      ref={ref}
      className={`h-full rounded-full transition-[width] duration-1000 ease-out ${className}`}
      style={{ width: `${w}%` }}
    />
  );
}

/* ── Page sections data ───────────────────────────────────────────────────── */
const FEATURES = [
  { icon: Brain, color: "text-np-accent", bg: "bg-np-accent/10", border: "border-np-accent/30",
    title: "Neural + BS hybrid",
    body: "A TorchScript MLP scores every quote alongside analytic Black-Scholes — compare both live on each request." },
  { icon: Activity, color: "text-np-cyan", bg: "bg-np-cyan/10", border: "border-np-cyan/30",
    title: "Full Greeks desk",
    body: "Δ Γ ν Θ ρ from closed form, swept across 61 strikes in milliseconds with small-multiple charts." },
  { icon: Waves, color: "text-np-green", bg: "bg-np-green/10", border: "border-np-green/30",
    title: "Live option chains",
    body: "Deribit bulk endpoints return an entire chain in ~2s. Sort, search, filter and auto-refresh every 60s." },
  { icon: Gauge, color: "text-np-violet", bg: "bg-np-violet/10", border: "border-np-violet/30",
    title: "Volatility surface",
    body: "A strike × tenor heatmap with interpolated IV cells — read the whole smile in a single glance." },
  { icon: Timer, color: "text-np-amber", bg: "bg-np-amber/10", border: "border-np-amber/30",
    title: "Benchmark harness",
    body: "In-browser latency tests measure median, p95 and throughput on your own machine, call by call." },
  { icon: Database, color: "text-np-red", bg: "bg-np-red/10", border: "border-np-red/30",
    title: "Hybrid dataset",
    body: "409K rows blending real Deribit snapshots with calibrated synthetic quotes, shipped as Parquet." },
];

const PIPELINE = [
  { icon: Database, title: "Collect", body: "Deribit book summaries + yfinance snapshots → Parquet" },
  { icon: Layers, title: "Engineer", body: "9 features: moneyness, log-moneyness, √T, is_call…" },
  { icon: Cpu, title: "Train", body: "MLP 256-256-128-64 · Huber loss · AdamW · TorchScript" },
  { icon: Server, title: "Serve", body: "Flask: /api/price · /api/greeks · /api/live-chain · MongoDB auth" },
  { icon: LineChart, title: "Visualize", body: "React dashboard with Recharts, live and debounced" },
];

const MODEL_LAYERS = [
  { n: "9", label: "Input" },
  { n: "256", label: "Dense" },
  { n: "256", label: "Dense" },
  { n: "128", label: "Dense" },
  { n: "64", label: "Dense" },
  { n: "1", label: "Price" },
];

const TICKER = [
  ["BTC-27DEC25-100000-C", "+4.21%", true],
  ["BTC-27DEC25-100000-P", "−3.08%", false],
  ["BTC-28MAR26-90000-C", "+1.77%", true],
  ["ETH-26DEC25-4000-C", "+6.02%", true],
  ["BTC-26DEC25-80000-P", "−2.14%", false],
  ["ETH-27DEC25-3000-P", "+0.88%", true],
  ["BTC-31JUL26-120000-C", "+2.35%", true],
  ["BTC-26DEC25-85000-C", "−1.02%", false],
];

const PERF = [
  { label: "NeuralPricer inference", ms: "6 ms", pct: 8, color: "bg-np-green" },
  { label: "p95 latency", ms: "9 ms", pct: 12, color: "bg-np-accent" },
  { label: "61-call Greeks batch", ms: "60 ms", pct: 30, color: "bg-np-violet" },
  { label: "Full BTC chain fetch", ms: "~2.0 s", pct: 95, color: "bg-np-amber" },
];

/* ── Landing page ─────────────────────────────────────────────────────────── */
export default function Landing({ theme, onToggleTheme, onNavigate, health }) {
  const online = health?.status === "online";
  const navLinks = [
    { href: "#features", label: "Features" },
    { href: "#pipeline", label: "How it works" },
    { href: "#performance", label: "Performance" },
  ];

  return (
    <div className="min-h-screen bg-np-bg bg-grid text-np-text font-sans overflow-x-hidden">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-np-bg/80 border-b border-np-border/60">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center gap-6">
          <button onClick={() => onNavigate("landing")} className="font-mono font-bold text-np-accent tracking-tight select-none">
            ⚡ NeuralPricer
          </button>
          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="text-sm text-np-muted hover:text-np-text transition-colors">
                {l.label}
              </a>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button
              onClick={() => onNavigate("login")}
              className="flex items-center gap-1.5 text-sm text-np-muted hover:text-np-text transition-colors px-2.5 py-1.5"
            >
              <LogIn size={14} /> <span className="hidden sm:inline">Log in</span>
            </button>
            <button
              onClick={() => onNavigate("signup")}
              className="flex items-center gap-1.5 text-sm font-semibold bg-np-accent text-np-bg px-3.5 py-1.5 rounded-lg
                         hover:brightness-110 transition-all shadow-[0_0_14px_rgba(88,166,255,0.35)]"
            >
              <UserPlus size={14} /> Get started
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <header className="relative">
        <div className="orb w-[420px] h-[420px] -top-32 -left-32 bg-np-accent/20 animate-float" />
        <div className="orb w-[360px] h-[360px] top-40 -right-24 bg-np-violet/15 animate-float-slow" />
        <div className="orb w-72 h-72 top-[520px] left-1/3 bg-np-cyan/10 animate-float" />

        <div className="relative max-w-7xl mx-auto px-4 md:px-6 pt-16 md:pt-24 pb-16 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 border border-np-border rounded-full pl-2 pr-3.5 py-1 bg-np-panel/70 backdrop-blur mb-7 animate-fade-in">
              <span className={`w-2 h-2 rounded-full ${online ? "bg-np-green animate-pulse-slow" : "bg-np-amber"}`} />
              <span className="font-mono text-[11px] text-np-muted">
                {online ? "API online · live Deribit + yfinance data" : "API offline · demo runs fully in-browser"}
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl xl:text-6xl font-bold tracking-tight leading-[1.05]">
              Price options at <span className="text-gradient">neural speed</span>.
            </h1>
            <p className="mt-5 text-base sm:text-lg text-np-muted max-w-xl leading-relaxed">
              NeuralPricer blends analytic Black-Scholes with a trained PyTorch network — wrapped in a real-time
              Flask service and a quant-grade React dashboard.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={() => onNavigate("signup")}
                className="flex items-center gap-2 bg-np-accent text-np-bg font-semibold px-6 py-3 rounded-xl
                           hover:brightness-110 active:scale-[0.98] transition-all shadow-[0_0_28px_rgba(88,166,255,0.4)]"
              >
                Create free account <ArrowRight size={16} />
              </button>
              <button
                onClick={() => onNavigate("app")}
                className="flex items-center gap-2 border border-np-border text-np-text font-medium px-6 py-3 rounded-xl
                           hover:border-np-accent/60 hover:bg-np-panel transition-all"
              >
                <Rocket size={16} className="text-np-accent" /> Launch dashboard
              </button>
            </div>

            <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl">
              {[
                { to: 409223, suffix: "", label: "training rows", decimals: 0 },
                { to: 9, suffix: "", label: "model features", decimals: 0 },
                { to: 6, suffix: " ms", label: "median latency", decimals: 0 },
                { to: 5, suffix: "", label: "greeks tracked", decimals: 0 },
              ].map((s, i) => (
                <Reveal key={s.label} delay={i * 90}>
                  <div className="border-l-2 border-np-accent/50 pl-3">
                    <p className="font-mono text-xl sm:text-2xl font-bold text-np-text">
                      <CountUp to={s.to} decimals={s.decimals} suffix={s.suffix} />
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-np-muted mt-0.5">{s.label}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          <Reveal delay={150}>
            <HeroPricingCard theme={theme} />
          </Reveal>
        </div>
      </header>

      {/* ── Ticker marquee ──────────────────────────────────────────────── */}
      <section className="border-y border-np-border/60 bg-np-panel/50 backdrop-blur py-3 marquee-mask">
        <div className="marquee-track">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0">
              {TICKER.map(([sym, chg, up]) => (
                <span key={`${copy}-${sym}`} className="flex items-center gap-2 px-6 font-mono text-xs whitespace-nowrap">
                  <span className="text-np-muted">{sym}</span>
                  <span className={up ? "text-np-green" : "text-np-red"}>{up ? "▲" : "▼"} {chg}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section id="features" className="max-w-7xl mx-auto px-4 md:px-6 py-20 md:py-28 scroll-mt-20">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-np-cyan text-center">Capabilities</p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mt-3">
            Everything a desk needs, <span className="text-gradient">one terminal</span>
          </h2>
          <p className="text-np-muted text-center mt-4 max-w-2xl mx-auto">
            From raw exchange snapshots to deployed inference — five views over one pricing engine.
          </p>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-12">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 70}>
              <div className="group h-full bg-np-panel border border-np-border rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-np-accent/50 hover:glow-accent">
                <div className={`w-11 h-11 rounded-xl border ${f.bg} ${f.border} flex items-center justify-center mb-4 transition-transform group-hover:scale-110`}>
                  <f.icon size={20} className={f.color} />
                </div>
                <h3 className="font-semibold tracking-tight flex items-center gap-1">
                  {f.title}
                  <ChevronRight size={14} className="text-np-muted opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                </h3>
                <p className="text-sm text-np-muted mt-2 leading-relaxed">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Pipeline ────────────────────────────────────────────────────── */}
      <section id="pipeline" className="relative border-y border-np-border/60 bg-np-panel/40 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-20 md:py-28">
          <Reveal>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-np-cyan text-center">How it works</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mt-3">
              From exchange tick to <span className="text-gradient">network output</span>
            </h2>
          </Reveal>

          <div className="mt-14 grid md:grid-cols-5 gap-4 relative">
            <div className="hidden md:block absolute top-[46px] left-[10%] right-[10%] h-px pipe-dots opacity-50" />
            {PIPELINE.map((p, i) => (
              <Reveal key={p.title} delay={i * 110}>
                <div className="relative bg-np-bg border border-np-border rounded-2xl p-5 text-center h-full
                                transition-all duration-300 hover:border-np-accent/50 hover:-translate-y-1">
                  <div className="w-12 h-12 mx-auto rounded-full bg-np-panel border border-np-accent/40 flex items-center justify-center
                                  shadow-[0_0_16px_rgba(88,166,255,0.25)]">
                    <p.icon size={19} className="text-np-accent" />
                  </div>
                  <p className="font-mono text-[10px] text-np-muted uppercase tracking-widest mt-3">
                    step {String(i + 1).padStart(2, "0")}
                  </p>
                  <h3 className="font-semibold mt-0.5">{p.title}</h3>
                  <p className="text-xs text-np-muted mt-2 leading-relaxed">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Model architecture */}
          <Reveal delay={120}>
            <div className="mt-14 bg-np-bg border border-np-border rounded-2xl p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-2">
                  <Network size={16} className="text-np-violet" />
                  <span className="font-mono text-xs uppercase tracking-wider text-np-muted">
                    OptionPricingNet architecture
                  </span>
                </div>
                <span className="font-mono text-[10px] text-np-muted px-2 py-1 border border-np-border rounded">
                  ~110K params · TorchScript export
                </span>
              </div>
              <div className="flex items-stretch gap-2 md:gap-3 overflow-x-auto pb-2">
                {MODEL_LAYERS.map((l, i) => (
                  <React.Fragment key={i}>
                    <div
                      className={`flex-1 min-w-[74px] rounded-xl border px-2 py-4 text-center transition-all duration-500
                        ${i === 0
                          ? "border-np-cyan/50 bg-np-cyan/5"
                          : i === MODEL_LAYERS.length - 1
                          ? "border-np-green/50 bg-np-green/5"
                          : "border-np-accent/40 bg-np-accent/5"}`}
                    >
                      <p className="font-mono text-lg font-bold">{l.n}</p>
                      <p className="font-mono text-[9px] uppercase tracking-wider text-np-muted mt-1">{l.label}</p>
                    </div>
                    {i < MODEL_LAYERS.length - 1 && (
                      <div className="self-center text-np-muted text-xs animate-pulse-slow select-none">→</div>
                    )}
                  </React.Fragment>
                ))}
              </div>
              <p className="font-mono text-[10px] text-np-muted/70 mt-4">
                StandardScaler inputs · ReLU activations · Huber loss · AdamW · batch 256
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Performance ─────────────────────────────────────────────────── */}
      <section id="performance" className="max-w-7xl mx-auto px-4 md:px-6 py-20 md:py-28 scroll-mt-20">
        <div className="grid lg:grid-cols-2 gap-12 items-start">
          <Reveal>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-np-cyan">Performance</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mt-3">
              Millisecond quotes, <span className="text-gradient">measured honestly</span>
            </h2>
            <p className="text-np-muted mt-4 leading-relaxed max-w-lg">
              The Benchmark page runs a live latency test in your browser — real calls against the real API, not
              marketing numbers. Here is what a typical run looks like.
            </p>

            <div className="mt-8 space-y-5">
              {PERF.map((p, i) => (
                <div key={p.label}>
                  <div className="flex justify-between items-baseline mb-2">
                    <span className="text-sm text-np-muted">{p.label}</span>
                    <span className="font-mono text-sm font-semibold text-np-text">{p.ms}</span>
                  </div>
                  <div className="h-2 rounded-full bg-np-panel border border-np-border overflow-hidden">
                    <Bar pct={p.pct} className={p.color} />
                  </div>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={150}>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { v: <CountUp to={61.8} decimals={1} suffix=" /s" />, l: "sustained calls/sec", c: "text-np-green" },
                { v: <CountUp to={9} suffix=" ms" />, l: "p95 response time", c: "text-np-accent" },
                { v: <CountUp to={61} />, l: "strikes per Greeks sweep", c: "text-np-violet" },
                { v: <CountUp to={2} decimals={1} suffix=" s" />, l: "full BTC chain fetch", c: "text-np-amber" },
              ].map((m) => (
                <div key={m.l} className="bg-np-panel border border-np-border rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:border-np-accent/40 duration-200">
                  <p className={`font-mono text-3xl font-bold ${m.c}`}>{m.v}</p>
                  <p className="text-xs text-np-muted mt-1.5 uppercase tracking-wider">{m.l}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 bg-np-panel border border-np-border rounded-2xl p-5 flex items-start gap-3">
              <Sparkles size={16} className="text-np-cyan mt-0.5 shrink-0" />
              <p className="text-sm text-np-muted leading-relaxed">
                Reference comparison from the model card: the network answers in{" "}
                <span className="text-np-green font-mono">3.2 ms</span> vs Black-Scholes at{" "}
                <span className="text-np-accent font-mono">48 ms</span> and Monte Carlo at{" "}
                <span className="text-np-red font-mono">26.4 s</span> — three orders of magnitude apart.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-4 md:px-6 pb-20 md:pb-28">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-np-accent/40 bg-np-panel p-10 md:p-16 text-center glow-accent">
            <div className="orb w-96 h-96 -top-32 left-1/4 bg-np-accent/25" />
            <div className="orb w-72 h-72 -bottom-32 right-1/4 bg-np-violet/20" />
            <div className="relative">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                Open the <span className="text-gradient">terminal</span>
              </h2>
              <p className="text-np-muted mt-4 max-w-xl mx-auto">
                Spin up the dashboard, price a live BTC option, and watch the Greeks move — no credit card, no setup
                beyond the two servers.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <button
                  onClick={() => onNavigate("signup")}
                  className="flex items-center gap-2 bg-np-accent text-np-bg font-semibold px-6 py-3 rounded-xl
                             hover:brightness-110 active:scale-[0.98] transition-all shadow-[0_0_28px_rgba(88,166,255,0.4)]"
                >
                  Get started free <ArrowRight size={16} />
                </button>
                <button
                  onClick={() => onNavigate("login")}
                  className="flex items-center gap-2 border border-np-border text-np-text font-medium px-6 py-3 rounded-xl
                             hover:border-np-accent/60 transition-all"
                >
                  I have an account
                </button>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-np-border/60 bg-np-panel/40">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-10 flex flex-col md:flex-row md:items-center gap-6">
          <div>
            <p className="font-mono font-bold text-np-accent">⚡ NeuralPricer</p>
            <p className="text-xs text-np-muted mt-1">Deep Learning Option Pricing Engine — Group 5, DSPL mini project.</p>
          </div>
          <div className="md:ml-auto flex flex-wrap items-center gap-2">
            {[Terminal, Database, Cpu, Server, LineChart].map((Icon, i) => (
              <span key={i} className="flex items-center gap-1.5 border border-np-border rounded-full px-3 py-1 font-mono text-[10px] text-np-muted uppercase tracking-wider">
                <Icon size={11} /> {["Deribit", "yfinance", "PyTorch", "Flask", "React"][i]}
              </span>
            ))}
          </div>
        </div>
        <div className="border-t border-np-border/40">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-mono text-np-muted/70">
            <span>⚡ NeuralPricer v1.0.0</span>
            <span>Flask · MongoDB · PyTorch · Deribit + yfinance live data</span>
            <span className="md:ml-auto">© 2026 Group 5 — built for learning, not trading advice</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
