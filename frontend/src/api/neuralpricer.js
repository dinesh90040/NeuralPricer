// frontend/src/api/neuralpricer.js
// API helper layer — pricing + greeks + live chain + Mongo-backed auth/history.
const BASE =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    (import.meta.env.VITE_API_BASE || import.meta.env.REACT_APP_API_BASE)) ||
  "http://localhost:8000";

/* ── Session token (MongoDB-backed) ──────────────────────────────────────── */
export const TOKEN_KEY = "np_token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function apiFetch(path, options = {}, timeoutMs = 240000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try {
        const j = JSON.parse(text);
        if (j && j.detail) message = j.detail;
      } catch {
        /* keep raw body */
      }
      const err = new Error(message || `API error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error("Request timed out — is the backend running?");
    }
    if (e instanceof TypeError) {
      throw new Error("Cannot reach API — start the backend (python main.py --port 8000)");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Pricing ─────────────────────────────────────────────────────────────── */
export const priceOption = (params) =>
  apiFetch("/api/price", { method: "POST", body: JSON.stringify(params) });

export const priceBatch = (list) =>
  apiFetch("/api/price/batch", { method: "POST", body: JSON.stringify(list) });

export const fetchGreeks = (params) =>
  apiFetch("/api/greeks", { method: "POST", body: JSON.stringify(params) });

export const fetchSpot = (currency = "BTC") =>
  apiFetch(`/api/spot/${currency}`);

export const fetchCandles = (currency = "BTC", resolution = "5", hours = 24) =>
  apiFetch(`/api/candles/${currency}?resolution=${encodeURIComponent(resolution)}&hours=${hours}`);

export const fetchChain = (currency = "BTC", expiry = null) => {
  const query = expiry ? `?expiry=${encodeURIComponent(expiry)}` : "";
  return apiFetch(`/api/live-chain/${currency}${query}`);
};

export const fetchLiveChain = async (currency = "BTC") => {
  const result = await fetchChain(currency);
  return result.items || [];
};

export const checkHealth = () => apiFetch("/api/health", {}, 8000);

/* ── Auth (Flask + MongoDB) ──────────────────────────────────────────────── */
export const register = (data) =>
  apiFetch("/api/auth/register", { method: "POST", body: JSON.stringify(data) }, 20000);

export const login = (data) =>
  apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify(data) }, 20000);

export const logout = () => apiFetch("/api/auth/logout", { method: "POST" }, 8000);

export const me = () => apiFetch("/api/auth/me", {}, 8000);

/* ── Quote history (MongoDB price_logs) ──────────────────────────────────── */
export const fetchHistory = (limit = 20) =>
  apiFetch(`/api/history?limit=${limit}`, {}, 8000);

export const API_BASE = BASE;
