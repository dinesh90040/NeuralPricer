import requests
import pandas as pd
import numpy as np
from datetime import datetime
import time
import os


DERIBIT_BASE = "https://www.deribit.com/api/v2/public"


def get_spot_price(currency="BTC"):
    """Fetch the current index price for BTC or ETH."""
    resp = requests.get(
        f"{DERIBIT_BASE}/get_index_price",
        params={"index_name": f"{currency.lower()}_usd"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["result"]["index_price"]


def get_instruments(currency="BTC"):
    """Fetch all active option instruments."""
    resp = requests.get(
        f"{DERIBIT_BASE}/get_instruments",
        params={"currency": currency, "kind": "option", "expired": "false"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["result"]


def get_ticker(instrument_name):
    """Fetch live ticker data for one instrument."""
    try:
        resp = requests.get(
            f"{DERIBIT_BASE}/ticker",
            params={"instrument_name": instrument_name},
            timeout=5,
        )
        if resp.status_code != 200:
            return None
        return resp.json()["result"]
    except Exception:
        return None


def _parse_instrument_name(name):
    """'BTC-27NOV26-73000-P' -> (strike, is_call, expiry_datetime_utc)."""
    from datetime import timezone

    parts = name.split("-")
    if len(parts) < 4:
        return None
    opt_char = parts[-1].upper()
    if opt_char not in ("C", "P"):
        return None
    try:
        strike = float("-".join(parts[2:-1]))
    except ValueError:
        return None
    try:
        expiry = datetime.strptime(parts[1], "%d%b%y")
    except ValueError:
        return None
    # Deribit options settle at 08:00 UTC on expiry day.
    # Returned as naive UTC to match datetime.utcfromtimestamp elsewhere.
    expiry = expiry.replace(hour=8, tzinfo=None)
    return strike, (1 if opt_char == "C" else 0), expiry


def _fetch_book_summary(currency="BTC"):
    """Single-request bulk fetch of every active option for the currency."""
    resp = requests.get(
        f"{DERIBIT_BASE}/get_book_summary_by_currency",
        params={"currency": currency, "kind": "option"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["result"]


def _rows_from_summary(summary, spot, risk_free_rate, currency, now_utc):
    """Convert bulk book-summary records into dataset rows (guide schema)."""
    rows = []
    for item in summary:
        name = item.get("instrument_name")
        bid = item.get("bid_price")
        ask = item.get("ask_price")
        mark_iv = item.get("mark_iv")
        if (
            not name
            or bid is None
            or ask is None
            or bid <= 0
            or ask <= 0
            or not mark_iv
        ):
            continue

        parsed = _parse_instrument_name(name)
        if parsed is None:
            continue
        strike, is_call, expiry_dt = parsed
        T = (expiry_dt - now_utc).total_seconds() / (365 * 24 * 3600)
        if T <= 0:
            continue

        mid_price = (bid + ask) / 2 * spot
        rows.append({
            "instrument":    name,
            "expiry":        expiry_dt.date().isoformat(),
            "S":             spot,
            "K":             strike,
            "T":             T,
            "r":             risk_free_rate,
            "sigma":         mark_iv / 100.0,   # Deribit gives IV in %
            "is_call":       is_call,
            "mid_price":     mid_price,
            "bid_usd":       bid * spot,
            "ask_usd":       ask * spot,
            "volume":        item.get("volume", 0),
            "open_interest": item.get("open_interest", 0),
            "snapshot_time": now_utc.isoformat(),
            "currency":      currency,
        })
    return rows


def fetch_full_snapshot(currency="BTC", risk_free_rate=0.045):
    """
    Pull a complete snapshot of all active options for the given currency.
    Fast path: one bulk request (get_book_summary_by_currency).
    Fallback: guide's per-instrument ticker loop.
    Returns a cleaned DataFrame ready for feature engineering.
    """
    from datetime import timezone

    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] Fetching {currency} snapshot...")
    spot = get_spot_price(currency)
    print(f"  Spot price: ${spot:,.2f}")

    rows = []
    try:
        summary = _fetch_book_summary(currency)
        rows = _rows_from_summary(summary, spot, risk_free_rate, currency, now_utc)
        print(f"  Bulk summary: {len(summary)} instruments -> {len(rows)} rows")
    except Exception as e:
        print(f"  Bulk fetch failed ({e}); falling back to per-instrument loop...")

    if not rows:
        # ── Guide's original path: one ticker request per instrument ─────────
        instruments = get_instruments(currency)
        print(f"  Instruments found: {len(instruments)}")
        for i, instr in enumerate(instruments):
            ticker = get_ticker(instr["instrument_name"])
            if ticker is None:
                continue
            if not ticker.get("mark_iv") or not ticker.get("mark_price"):
                continue
            bid = ticker.get("best_bid_price")
            ask = ticker.get("best_ask_price")
            if bid is None or ask is None or bid <= 0 or ask <= 0:
                continue

            expiry_ms = instr["expiration_timestamp"]
            expiry_dt = datetime.utcfromtimestamp(expiry_ms / 1000)
            T = (expiry_dt - datetime.utcnow()).total_seconds() / (365 * 24 * 3600)
            if T <= 0:
                continue

            rows.append({
                "instrument":    instr["instrument_name"],
                "expiry":        expiry_dt.date().isoformat(),
                "S":             spot,
                "K":             float(instr["strike"]),
                "T":             T,
                "r":             risk_free_rate,
                "sigma":         ticker["mark_iv"] / 100.0,
                "is_call":       1 if instr["option_type"] == "call" else 0,
                "mid_price":     (bid + ask) / 2 * spot,
                "bid_usd":       bid * spot,
                "ask_usd":       ask * spot,
                "volume":        ticker.get("stats", {}).get("volume", 0),
                "open_interest": ticker.get("open_interest", 0),
                "snapshot_time": datetime.utcnow().isoformat(),
                "currency":      currency,
            })
            if i % 50 == 49:
                time.sleep(0.3)

    if not rows:
        print("  WARNING: no rows collected.")
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["moneyness"]     = df["S"] / df["K"]
    df["log_moneyness"] = np.log(df["moneyness"])
    df["sqrt_T"]        = np.sqrt(df["T"])

    # Quality filters
    df = df[df["mid_price"] > 0]
    df = df[df["sigma"] > 0.01]
    df = df[df["T"] > 1 / 365]
    df = df[df["mid_price"] < df["S"]]
    df = df[np.isfinite(df["log_moneyness"])]

    print(f"  Clean rows collected: {len(df)}")
    return df


def run_snapshot_loop(
    n_snapshots=79,
    interval_seconds=300,
    currencies=None,
    save_dir="data/snapshots",
):
    if currencies is None:
        currencies = ["BTC", "ETH"]
    os.makedirs(save_dir, exist_ok=True)
    print(f"Starting snapshot loop: {n_snapshots} snapshots every {interval_seconds}s")

    for i in range(n_snapshots):
        print(f"\n=== Snapshot {i + 1}/{n_snapshots} ===")
        all_dfs = []
        for cur in currencies:
            try:
                df = fetch_full_snapshot(cur)
                if not df.empty:
                    all_dfs.append(df)
            except Exception as e:
                print(f"  ERROR ({cur}): {e}")

        if all_dfs:
            combined = pd.concat(all_dfs, ignore_index=True)
            fname = f"{save_dir}/snap_{int(time.time())}.parquet"
            combined.to_parquet(fname, index=False)
            print(f"  Saved: {fname}")

        if i < n_snapshots - 1:
            print(f"  Next snapshot in {interval_seconds}s...")
            time.sleep(interval_seconds)

    print("\nSnapshot loop complete.")


def fetch_yfinance_snapshot(tickers=None, risk_free_rate=0.045):
    """Fetch full option chains for a list of US equity tickers (yfinance)."""
    import yfinance as yf

    if tickers is None:
        tickers = ["AAPL", "SPY", "TSLA", "NVDA"]
    all_dfs = []

    for symbol in tickers:
        try:
            ticker = yf.Ticker(symbol)
            spot = ticker.history(period="1d")["Close"].iloc[-1]
            today = pd.Timestamp(datetime.now().date())

            for expiry in ticker.options:
                chain = ticker.option_chain(expiry)
                for opt_type, df in [("call", chain.calls), ("put", chain.puts)]:
                    df = df.copy()
                    expiry_date = pd.to_datetime(expiry)
                    T = (expiry_date - today).days / 365.0
                    if T <= 0:
                        continue

                    df["S"] = spot
                    df["K"] = df["strike"]
                    df["T"] = T
                    df["r"] = risk_free_rate
                    df["sigma"] = df["impliedVolatility"]
                    df["is_call"] = 1 if opt_type == "call" else 0
                    df["mid_price"] = (df["bid"] + df["ask"]) / 2
                    df["ticker"] = symbol
                    df["snapshot_time"] = datetime.utcnow().isoformat()

                    all_dfs.append(df[[
                        "S", "K", "T", "r", "sigma", "is_call",
                        "mid_price", "bid", "ask", "volume", "openInterest",
                        "ticker", "snapshot_time",
                    ]])

        except Exception as e:
            print(f"  ERROR for {symbol}: {e}")

    if not all_dfs:
        return pd.DataFrame()

    result = pd.concat(all_dfs, ignore_index=True)
    result = result.rename(columns={"openInterest": "open_interest"})

    # Feature engineering
    result["moneyness"] = result["S"] / result["K"]
    result["log_moneyness"] = np.log(result["moneyness"])
    result["sqrt_T"] = np.sqrt(result["T"])

    # Quality filters
    result = result[result["mid_price"] > 0]
    result = result[result["sigma"] > 0]
    result = result[result["T"] > 1 / 365]

    return result


if __name__ == "__main__":
    # Quick single test
    df = fetch_full_snapshot("BTC")
    if not df.empty:
        print("\nSample rows:")
        print(df[["instrument", "S", "K", "T", "sigma", "is_call", "mid_price"]].head(5))