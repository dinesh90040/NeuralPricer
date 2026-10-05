import React from "react";
import { Moon, Sun } from "lucide-react";

/* ── Panel: the standard glassy card container ─────────────────────────────── */
export function Panel({ children, className = "", glow = false }) {
  return (
    <div
      className={`bg-np-panel border border-np-border rounded-xl ${glow ? "glow-accent" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/* ── Section heading ───────────────────────────────────────────────────────── */
export function PageHeader({ title, subtitle, right = null }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 animate-slide-up">
      <div>
        <h1 className="text-xl font-semibold text-np-text tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-np-muted mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/* ── Number field with label (per guide) ───────────────────────────────────── */
export function Field({ label, name, value, onChange, step = 0.01, min = 0, max, hint }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-mono text-np-muted uppercase tracking-wider flex justify-between">
        <span>{label}</span>
        {hint && <span className="text-np-border normal-case">{hint}</span>}
      </label>
      <input
        type="number"
        name={name}
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(name, parseFloat(e.target.value))}
        className="bg-np-bg border border-np-border rounded px-3 py-2 text-np-text
                   font-mono text-sm focus:outline-none focus:border-np-accent
                   focus:ring-1 focus:ring-np-accent/40 transition-colors w-full"
      />
    </div>
  );
}

/* ── Range slider with live value readout ──────────────────────────────────── */
export function Slider({ label, value, onChange, min, max, step, format = (v) => v }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-baseline">
        <span className="text-xs font-mono text-np-muted uppercase tracking-wider">{label}</span>
        <span className="text-xs font-mono text-np-accent font-semibold">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

/* ── Metric card ───────────────────────────────────────────────────────────── */
export function MetricCard({ label, value, color = "text-np-text", sub, icon = null, pulse = false }) {
  return (
    <div className="bg-np-panel border border-np-border rounded-xl p-4 transition-all hover:border-np-accent/40 hover:-translate-y-0.5 duration-200">
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono text-np-muted uppercase tracking-wider mb-1">{label}</p>
        {icon && <span className="text-np-muted">{icon}</span>}
      </div>
      <p className={`text-2xl font-mono font-semibold tabular-nums ${color} ${pulse ? "animate-pulse" : ""}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-np-muted mt-1">{sub}</p>}
    </div>
  );
}

/* ── Greek badge ───────────────────────────────────────────────────────────── */
const GREEK_SYMBOLS = { delta: "Δ", gamma: "Γ", vega: "ν", theta: "Θ", rho: "ρ" };
const GREEK_COLORS = {
  delta: "text-np-accent",
  gamma: "text-np-cyan",
  vega: "text-np-violet",
  theta: "text-np-red",
  rho: "text-np-amber",
};

export function GreekBadge({ name, value, active = false, onClick = null }) {
  const symbol = GREEK_SYMBOLS[name] ?? "";
  const color = GREEK_COLORS[name] ?? "text-np-accent";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`bg-np-panel border rounded-xl p-4 text-center transition-all duration-200 w-full
        ${active ? "border-np-accent glow-accent" : "border-np-border hover:border-np-accent/40"}
        ${onClick ? "cursor-pointer" : ""}`}
    >
      <p className="text-xs font-mono text-np-muted uppercase tracking-wider mb-1.5">
        {name} <span className={color}>{symbol}</span>
      </p>
      <p className={`text-xl font-mono font-semibold tabular-nums ${color}`}>
        {value === null || value === undefined || Number.isNaN(value) ? "—" : Number(value).toFixed(4)}
      </p>
    </Tag>
  );
}

/* ── Error / warning banners ───────────────────────────────────────────────── */
export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="bg-red-900/20 border border-np-red rounded-xl p-4 text-np-red text-sm font-mono animate-fade-in flex items-start gap-2">
      <span className="mt-0.5">✕</span>
      <span className="break-all">{message}</span>
    </div>
  );
}

export function NoteBanner({ message }) {
  if (!message) return null;
  return (
    <div className="bg-yellow-900/20 border border-np-amber rounded-xl p-4 text-np-amber text-sm font-mono animate-fade-in flex items-start gap-2">
      <span className="mt-0.5">⚠</span>
      <span>{message}</span>
    </div>
  );
}

/* ── Loading state ─────────────────────────────────────────────────────────── */
export function Loading({ text = "Loading…" }) {
  return (
    <div className="flex items-center gap-3 text-np-muted text-sm font-mono py-8 justify-center">
      <span className="w-4 h-4 border-2 border-np-accent border-t-transparent rounded-full animate-spin" />
      {text}
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 6 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-np-border/40">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3">
              <div className="skeleton h-3 rounded" style={{ width: `${50 + ((r + c) % 4) * 12}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}/* ── Dark / light theme toggle ──────────────────────────────────────────────── */
export function ThemeToggle({ theme, onToggle, className = "" }) {
  const light = theme === "light";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Switch to dark mode" : "Switch to light mode"}
      className={`flex items-center gap-1.5 border border-np-border rounded-full px-2.5 py-1.5
                  text-np-muted hover:text-np-text hover:border-np-accent/60 hover:glow-accent
                  transition-all duration-200 ${className}`}
    >
      {light ? <Moon size={14} /> : <Sun size={14} />}
      <span className="font-mono text-[10px] uppercase tracking-wider hidden sm:inline">
        {light ? "Dark" : "Light"}        </span>
      </button>
  );
}

/* ── Tooltip styling shared by all Recharts charts ─────────────────────────── */
/* Resolved through CSS variables so charts follow the active theme. */

export const CHART_TOOLTIP = {
  background: "rgb(var(--np-panel))",
  border: "1px solid rgb(var(--np-border))",
  borderRadius: 8,
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 12,
  color: "rgb(var(--np-text))",
};

export const AXIS_TICK = {
  fill: "rgb(var(--np-muted))",
  fontSize: 11,
  fontFamily: "JetBrains Mono, monospace",
};
