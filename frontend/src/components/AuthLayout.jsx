import React from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { ThemeToggle } from "./ui";

/* ── Labeled input with leading icon (shared by login + signup) ───────────── */
export function AuthField({ label, type = "text", value, onChange, placeholder, icon: Icon, error, hint, autoComplete }) {
  const [show, setShow] = React.useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && show ? "text" : type;

  return (
    <label className="block">
      <span className="block text-xs font-mono text-np-muted uppercase tracking-wider mb-1.5">
        {label}
        {hint && <span className="float-right normal-case text-np-border">{hint}</span>}
      </span>
      <div className="relative">
        {Icon && (
          <Icon
            size={15}
            className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${
              error ? "text-np-red" : "text-np-muted"
            }`}
          />
        )}
        <input
          type={inputType}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={`w-full bg-np-bg border rounded-lg pl-9 ${isPassword ? "pr-10" : "pr-4"} py-2.5 text-sm text-np-text
                     placeholder:text-np-muted/60 font-mono transition-all duration-150
                     focus:outline-none focus:ring-1
                     ${error
                       ? "border-np-red focus:border-np-red focus:ring-np-red/40"
                       : "border-np-border focus:border-np-accent focus:ring-np-accent/40"}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-np-muted hover:text-np-accent transition-colors"
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
      {error && <span className="block text-xs font-mono text-np-red mt-1 animate-fade-in">{error}</span>}
    </label>
  );
}

/* ── Checkbox row ─────────────────────────────────────────────────────────── */
export function CheckRow({ checked, onChange, children }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer group select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 accent-np-accent cursor-pointer"
      />
      <span className="text-xs text-np-muted group-hover:text-np-text transition-colors leading-relaxed">
        {children}
      </span>
    </label>
  );
}

/* ── Split-screen auth shell ──────────────────────────────────────────────── */
export default function AuthLayout({ theme, onToggleTheme, onNavigate, children }) {
  return (
    <div className="min-h-screen bg-np-bg text-np-text flex">
      {/* Left: branded panel (desktop only) */}
      <aside className="hidden lg:flex relative w-[46%] max-w-[620px] flex-col justify-between overflow-hidden border-r border-np-border bg-np-panel p-10 xl:p-14">
        <div className="orb w-96 h-96 -top-24 -left-24 bg-np-accent/25 animate-float" />
        <div className="orb w-80 h-80 bottom-10 -right-24 bg-np-violet/20 animate-float-slow" />
        <div className="orb w-64 h-64 bottom-40 left-1/3 bg-np-cyan/15 animate-float" />

        <button
          onClick={() => onNavigate("landing")}
          className="relative flex items-center gap-2 font-mono font-bold text-np-accent text-lg w-fit hover:opacity-80 transition-opacity"
        >
          ⚡ NeuralPricer
        </button>

        <div className="relative">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-np-cyan mb-4">Deep learning pricing engine</p>
          <h2 className="text-3xl xl:text-4xl font-bold leading-tight tracking-tight">
            The quant terminal for <span className="text-gradient">neural option pricing</span>.
          </h2>
          <ul className="mt-8 space-y-3.5">
            {[
              "Hybrid Black-Scholes + PyTorch MLP pricing",
              "Live Deribit chains fetched in ~2 seconds",
              "Full Greeks, volatility surface & benchmarks",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-sm text-np-muted">
                <CheckCircle2 size={16} className="text-np-green mt-0.5 shrink-0" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative grid grid-cols-3 gap-3">
          {[
            { k: "409K", v: "dataset rows" },
            { k: "6ms", v: "median price" },
            { k: "5", v: "greeks" },
          ].map((s) => (
            <div key={s.v} className="border border-np-border rounded-lg px-3 py-2.5 bg-np-bg/60 backdrop-blur">
              <p className="font-mono font-bold text-np-text">{s.k}</p>
              <p className="text-[10px] uppercase tracking-wider text-np-muted">{s.v}</p>
            </div>
          ))}
        </div>
      </aside>

      {/* Right: form area */}
      <main className="relative flex-1 flex flex-col">
        <div className="orb w-72 h-72 -top-20 -right-16 bg-np-violet/15 animate-float-slow lg:hidden" />

        <div className="relative flex items-center justify-between px-5 sm:px-8 py-5">
          <button
            onClick={() => onNavigate("landing")}
            className="flex items-center gap-1.5 text-xs font-mono text-np-muted hover:text-np-accent transition-colors"
          >
            <ArrowLeft size={14} /> Back to home
          </button>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>

        <div className="relative flex-1 flex items-center justify-center px-5 sm:px-8 pb-12">
          <div className="w-full max-w-md animate-slide-up">{children}</div>
        </div>

        <div className="relative px-5 sm:px-8 pb-6 text-center">
          <p className="font-mono text-[10px] text-np-muted/60 uppercase tracking-wider">
            ⚡ NeuralPricer v1.0.0 — Flask · MongoDB · PyTorch · React
          </p>
        </div>
      </main>
    </div>
  );
}
