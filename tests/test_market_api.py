import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import main as backend  # noqa: E402
from data_collector import _rows_from_summary  # noqa: E402


@pytest.fixture(autouse=True)
def clear_market_cache():
    with backend._market_cache_lock:
        backend._spot_cache.clear()
        backend._chain_cache.clear()
    yield
    with backend._market_cache_lock:
        backend._spot_cache.clear()
        backend._chain_cache.clear()


def sample_chain():
    base = {
        "S": 85000.0,
        "T": 0.25,
        "r": 0.045,
        "sigma": 0.65,
        "moneyness": 1.0,
        "log_moneyness": 0.0,
        "sqrt_T": 0.5,
        "expiry": "2026-12-25",
        "mid_price": 11000.0,
        "bid_usd": 10800.0,
        "ask_usd": 11200.0,
        "open_interest": 12.0,
        "volume": 4.0,
    }
    return pd.DataFrame([
        {**base, "instrument": "BTC-25DEC26-85000-C", "K": 85000.0, "is_call": 1},
        {**base, "instrument": "BTC-25DEC26-85000-P", "K": 85000.0, "is_call": 0},
    ])


def test_live_chain_returns_all_contract_fields_and_expiry_filter(monkeypatch):
    monkeypatch.setattr(backend, "fetch_full_snapshot", lambda currency: sample_chain())
    monkeypatch.setattr(backend, "get_model", lambda: (None, None, None))
    client = backend.app.test_client()

    response = client.get("/api/live-chain/BTC?expiry=2026-12-25")

    assert response.status_code == 200
    payload = response.get_json()
    assert len(payload["items"]) == 2
    assert payload["stale"] is False
    assert payload["expiries"] == ["2026-12-25"]
    item = payload["items"][0]
    assert {
        "instrument", "expiry", "strike", "is_call", "spot", "T", "mark_iv",
        "mid_price", "bid_usd", "ask_usd", "open_interest", "volume",
        "bs_price", "bs_greeks", "nn_price",
    }.issubset(item)
    assert item["nn_price"] is None


def test_live_chain_serves_last_cache_as_stale_on_deribit_failure(monkeypatch):
    monkeypatch.setattr(backend, "fetch_full_snapshot", lambda currency: sample_chain())
    monkeypatch.setattr(backend, "get_model", lambda: (None, None, None))
    client = backend.app.test_client()
    first = client.get("/api/live-chain/ETH")
    assert first.status_code == 200

    backend._chain_cache["ETH"]["fetched_at"] = datetime.now(timezone.utc) - timedelta(seconds=10)

    def fail_fetch(currency):
        raise ConnectionError("Deribit unavailable")

    monkeypatch.setattr(backend, "fetch_full_snapshot", fail_fetch)
    stale = client.get("/api/live-chain/ETH")

    assert stale.status_code == 200
    assert stale.get_json()["stale"] is True
    assert len(stale.get_json()["items"]) == 2


def test_live_chain_uses_cached_snapshot_within_ttl(monkeypatch):
    calls = []

    def fetch(currency):
        calls.append(currency)
        return sample_chain()

    monkeypatch.setattr(backend, "fetch_full_snapshot", fetch)
    monkeypatch.setattr(backend, "get_model", lambda: (None, None, None))
    client = backend.app.test_client()

    first = client.get("/api/live-chain/BTC")
    second = client.get("/api/live-chain/BTC")

    assert first.status_code == second.status_code == 200
    assert calls == ["BTC"]


def test_spot_endpoint_returns_deribit_index(monkeypatch):
    monkeypatch.setattr(backend, "get_spot_price", lambda currency: 65000.25)

    response = backend.app.test_client().get("/api/spot/BTC")

    assert response.status_code == 200
    assert response.get_json()["spot"] == 65000.25
    assert response.get_json()["currency"] == "BTC"


def test_candles_endpoint_uses_deribit_chart_parameters(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"result": {
                "status": "ok",
                "ticks": [1790000000000],
                "open": [100.0],
                "high": [110.0],
                "low": [90.0],
                "close": [105.0],
                "volume": [12.0],
            }}

    requested = {}

    def fake_get(url, params, timeout):
        requested.update(url=url, params=params, timeout=timeout)
        return FakeResponse()

    monkeypatch.setattr(backend.requests, "get", fake_get)

    response = backend.app.test_client().get("/api/candles/ETH?resolution=60&hours=24")

    assert response.status_code == 200
    assert requested["params"]["instrument_name"] == "ETH-PERPETUAL"
    assert requested["params"]["resolution"] == "60"
    assert requested["params"]["start_timestamp"] < requested["params"]["end_timestamp"]
    assert response.get_json()["candles"][0] == {
        "time": 1790000000,
        "open": 100.0,
        "high": 110.0,
        "low": 90.0,
        "close": 105.0,
        "volume": 12.0,
    }


def test_batch_model_inference_matches_single_inference():
    torch = pytest.importorskip("torch")

    class IdentityScaler:
        def transform(self, values):
            return values

        def inverse_transform(self, values):
            return values

    class DeterministicModel:
        def __call__(self, values):
            return values[:, :1] * 0.01 + values[:, 1:2] * 0.02

    frame = sample_chain()
    model = DeterministicModel()
    scaler = IdentityScaler()

    batched = backend.nn_infer_batch(frame, model, scaler, scaler)
    single = [
        backend.nn_infer(
            frame.loc[[index], backend.CHAIN_FEATURES].to_numpy(dtype=float),
            model,
            scaler,
            scaler,
        )
        for index in frame.index
    ]

    assert torch is backend.torch
    assert np.allclose(batched, single)


def test_model_artifacts_load_when_present(monkeypatch):
    if not backend._TORCH_AVAILABLE:
        pytest.skip("PyTorch is unavailable")
    model_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    required = ["best_model_scripted.pt", "scaler_X.pkl", "scaler_y.pkl"]
    if not all(os.path.isfile(os.path.join(model_dir, name)) for name in required):
        pytest.skip("Local model artifacts are not present")

    monkeypatch.setattr(backend, "MODEL_DIR", os.path.abspath(model_dir))
    monkeypatch.setattr(backend, "_model", None)
    monkeypatch.setattr(backend, "_scaler_X", None)
    monkeypatch.setattr(backend, "_scaler_y", None)

    model, scaler_x, scaler_y = backend.get_model()

    assert model is not None
    assert scaler_x.n_features_in_ == len(backend.CHAIN_FEATURES)
    assert scaler_y is not None

    frame = sample_chain()
    frame = pd.concat([frame] * 32, ignore_index=True)
    frame["S"] = np.linspace(70000, 100000, len(frame))
    frame["K"] = np.linspace(65000, 105000, len(frame))
    frame["T"] = np.linspace(0.03, 1.5, len(frame))
    frame["sigma"] = np.linspace(0.2, 1.5, len(frame))
    frame["moneyness"] = frame["S"] / frame["K"]
    frame["log_moneyness"] = np.log(frame["moneyness"])
    frame["sqrt_T"] = np.sqrt(frame["T"])

    batched = backend.nn_infer_batch(frame, model, scaler_x, scaler_y)
    single = np.array([
        backend.nn_infer(
            frame.loc[[index], backend.CHAIN_FEATURES].to_numpy(dtype=float),
            model,
            scaler_x,
            scaler_y,
        )
        for index in frame.index
    ])

    assert np.max(np.abs(batched - single)) <= 0.04


def test_snapshot_collector_skips_missing_or_non_positive_quotes():
    now = datetime(2026, 10, 15, 12, tzinfo=timezone.utc).replace(tzinfo=None)
    rows = _rows_from_summary([
        {
            "instrument_name": "BTC-25DEC26-85000-C",
            "bid_price": 0.01,
            "ask_price": 0.02,
            "mark_iv": 65.0,
        },
        {
            "instrument_name": "BTC-25DEC26-85000-P",
            "bid_price": 0,
            "ask_price": 0.02,
            "mark_iv": 65.0,
        },
        {
            "instrument_name": "BTC-25DEC26-85000-P",
            "bid_price": 0.01,
            "ask_price": None,
            "mark_iv": 65.0,
        },
    ], spot=85000, risk_free_rate=0.045, currency="BTC", now_utc=now)

    assert len(rows) == 1
    assert rows[0]["expiry"] == "2026-12-25"
