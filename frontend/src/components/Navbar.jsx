import React, { useEffect, useState } from "react";
import { Activity, Zap, Gauge, Waves, Timer, LogOut, LayoutDashboard } from "lucide-react";
import { checkHealth } from "../api/neuralpricer";
import { ThemeToggle } from "./ui";

const TABS = [
  { id: "dashboard", label: "Dashboard",    icon: LayoutDashboard },
  { id: "pricer",    label: "Option Pricer", icon: Zap },
  { id: "greeks",    label: "Greeks",        icon: Activity },
  { id: "chain",     label: "Live Chain",    icon: Waves },
  { id: "surface",   label: "Price Surface", icon: Gauge },
  { id: "benchmark", label: "Benchmark",     icon: Timer },
];

export function useApiHealth(pollMs = 10000) {
  const [health, setHealth] = useState({ status: "checking", model_ready: false, torch_available: false });
  const [lastLatency, setLastLatency] = useState(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const t0 = performance.now();
      try {
        const h = await checkHealth();
        if (!alive) return;
        setLastLatency(Math.round(performance.now() - t0));
        setHealth({ ...h, status: "online" });
      } catch {
        if (alive) setHealth({ status: "offline", model_ready: false });
      }
    };
    poll();
    const id = setInterval(poll, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [pollMs]);

  return { health, lastLatency };
}

export default function Navbar({ active, setPage, health, lastLatency, theme, onToggleTheme, user, onLogout, onHome }) {
  const online = health.status === "online";
  const modelReady = !!(health.model_loaded ?? health.model_ready);
  const mongoOk = health.mongo === "ok";

  return (
    <nav className="bg-np-panel/90 backdrop-blur border-b border-np-border px-4 md:px-6 py-3 flex items-center gap-4 md:gap-6 sticky top-0 z-50">
      <button
        onClick={onHome}
        title="Back to landing page"
        className="font-mono font-bold text-np-accent text-base tracking-tight select-none whitespace-nowrap hover:opacity-80 transition-opacity"
      >
        ⚡ NeuralPricer
      </button>

      <div className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setPage(t.id)}
              title={t.label}
              aria-label={t.label}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-1.5 px-3 md:px-4 py-1.5 rounded text-sm font-medium transition-all duration-150 whitespace-nowrap
                ${isActive
                  ? "bg-np-accent text-np-bg shadow-[0_0_12px_rgba(88,166,255,0.4)]"
                  : "text-np-muted hover:text-np-text hover:bg-np-border"}`}
            >
              <Icon size={14} />
              <span className="hidden xl:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-3 md:gap-4">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} className="hidden sm:flex" />
        <div
          className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded border border-np-border"
          title={modelReady ? "Neural network model loaded" : "NN unavailable — Black–Scholes pricing only"}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${modelReady ? "bg-np-green" : "bg-np-amber"}`} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-np-muted">
            {modelReady ? "NN model active" : "NN unavailable"}
          </span>
        </div>

        <div
          className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded border border-np-border"
          title={mongoOk ? "MongoDB connected — quotes & sessions persisted" : "MongoDB unavailable"}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${mongoOk ? "bg-np-green" : "bg-np-red"}`} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-np-muted">Mongo</span>
        </div>

        <div className="flex items-center gap-2">          <span className={`w-2 h-2 rounded-full ${online ? "bg-np-green animate-pulse-slow" : "bg-np-red"}`} />
          <span className="font-mono text-xs text-np-muted whitespace-nowrap">
            {online ? `API${lastLatency != null ? ` · ${lastLatency}ms` : ""}` : "API offline"}
          </span>
        </div>

        {user && (
          <div className="flex items-center gap-2 pl-3 border-l border-np-border">
            <span
              className="w-6 h-6 rounded-full bg-np-accent/15 border border-np-accent/50 flex items-center justify-center
                         font-mono text-[10px] font-bold text-np-accent select-none"
              title={user.email}
            >
              {(user.name || "?").charAt(0).toUpperCase()}
            </span>
            <span className="hidden lg:inline font-mono text-xs text-np-muted whitespace-nowrap max-w-[90px] truncate">
              {user.name}
            </span>
            <button
              onClick={onLogout}
              title="Sign out"
              aria-label="Sign out"
              className="p-1.5 rounded text-np-muted hover:text-np-red hover:bg-np-red/10 transition-all"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
