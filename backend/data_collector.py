import requests
import pandas as pd
import numpy as np
from datetime import datetime
import time
import os


DERIBIT_BASE = "https://www.deribit.com/api/v2/public"


def get_spot_price(currency="BTC"):
    resp = requests.get(
        f"{DERIBIT_BASE}/get_index_price",
        params={"index_name": f"{currency.lower()}_usd"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["result"]["index_price"]


def get_instruments(currency="BTC"):
    resp = requests.get(
        f"{DERIBIT_BASE}/get_instruments",
        params={"currency": currency, "kind": "option", "expired": "false"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["result"]


def get_ticker(instrument_name):
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


def fetch_full_snapshot(currency="BTC", risk_free_rate=0.045):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] Fetching {currency} snapshot...")
    spot = get_spot_price(currency)
    print(f"  Spot price: ${spot:,.2f}")

    instruments = get_instruments(currency)
    print(f"  Instruments found: {len(instruments)}")

    rows = []
    for i, instr in enumerate(instruments):
        ticker = get_ticker(instr["instrument_name"])
        if ticker is None:
            continue
        if not ticker.get("mark_iv") or not ticker.get("mark_price"):
            continue
        bid = ticker.get("best_bid_price")
        ask = ticker.get("best_ask_price")
        if bid is None or ask is None:
            continue

        expiry_ms  = instr["expiration_timestamp"]
        expiry_dt  = datetime.utcfromtimestamp(expiry_ms / 1000)
        T          = (expiry_dt - datetime.utcnow()).total_seconds() / (365 * 24 * 3600)
        if T <= 0:
            continue

        mid_price = (bid + ask) / 2 * spot

        rows.append({
            "instrument":    instr["instrument_name"],
            "S":             spot,
            "K":             float(instr["strike"]),
            "T":             T,
            "r":             risk_free_rate,
            "sigma":         ticker["mark_iv"] / 100.0,
            "is_call":       1 if instr["option_type"] == "call" else 0,
            "mid_price":     mid_price,
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
    n_snapshots=48,
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


if __name__ == "__main__":
    # Quick single test
    df = fetch_full_snapshot("BTC")
    if not df.empty:
        print("\nSample rows:")
        print(df[["instrument", "S", "K", "T", "sigma", "is_call", "mid_price"]].head(5))