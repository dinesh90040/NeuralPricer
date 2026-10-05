import React, { useEffect, useState } from "react";
import Navbar, { useApiHealth } from "./components/Navbar";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Pricer from "./pages/Pricer";
import Greeks from "./pages/Greeks";
import LiveChain from "./pages/LiveChain";
import Surface from "./pages/Surface";
import Benchmark from "./pages/Benchmark";
import { useTheme } from "./theme";
import { getToken, setToken, logout as apiLogout, me as apiMe } from "./api/neuralpricer";

const USER_KEY = "np_user";

function loadUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const { theme, toggle } = useTheme();
  const [route, setRoute] = useState("landing"); // landing | login | signup | app
  const [page, setPage] = useState("pricer"); // dashboard tab
  const [user, setUser] = useState(loadUser);
  const { health, lastLatency } = useApiHealth(10000);

  // Scroll to top whenever a new top-level page opens.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  // Re-validate a persisted MongoDB session on load.
  useEffect(() => {
    if (!getToken()) return;
    apiMe()
      .then((res) => {
        if (res && res.user) {
          setUser((u) => u || res.user);
          setRoute((r) => (r === "landing" ? "app" : r));
        }
      })
      .catch(() => setToken(null));
  }, []);

  // The dashboard is behind auth — "Launch dashboard" must land on login
  // when there is no live MongoDB session.
  const navigate = (r) => setRoute(r === "app" && (!user || !getToken()) ? "login" : r);

  const handleAuth = (u) => {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch {
      /* ignore */
    }
    setUser(u);
    setRoute("app");
  };

  const handleLogout = () => {
    apiLogout().catch(() => {}); // best-effort server-side session revoke
    setToken(null);
    try {
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
    setRoute("landing");
  };

  if (route === "landing") {
    return <Landing theme={theme} onToggleTheme={toggle} onNavigate={navigate} health={health} />;
  }
  if (route === "login") {
    return <Login theme={theme} onToggleTheme={toggle} onNavigate={navigate} onAuth={handleAuth} />;
  }
  if (route === "signup") {
    return <Signup theme={theme} onToggleTheme={toggle} onNavigate={navigate} onAuth={handleAuth} />;
  }

  const pages = {
    pricer:    <Pricer />,
    greeks:    <Greeks />,
    chain:     <LiveChain />,
    surface:   <Surface />,
    benchmark: <Benchmark health={health} />,
  };
  return (
    <div className="min-h-screen bg-np-bg bg-grid text-np-text font-sans">
      <Navbar
        active={page}
        setPage={setPage}
        health={health}
        lastLatency={lastLatency}
        theme={theme}
        onToggleTheme={toggle}
        user={user}
        onLogout={handleLogout}
        onHome={() => setRoute("landing")}
      />
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-8">{pages[page]}</main>
      <footer className="max-w-7xl mx-auto px-4 md:px-6 pb-8 pt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono text-np-muted/70">
        <span>⚡ NeuralPricer v1.0.0</span>
        <span>Flask · MongoDB · PyTorch · Deribit + yfinance live data</span>
        <span className="ml-auto">Deep Learning Option Pricing Engine</span>
      </footer>
    </div>
  );
}
