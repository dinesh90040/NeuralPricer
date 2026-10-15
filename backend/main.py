"""NeuralPricer backend — Flask + MongoDB.

Replaces the FastAPI entrypoint (kept as main_fastapi.py.bak). Same API
surface the React dashboard already consumes, plus Mongo-backed auth
(register/login/sessions) and quote history.

Run:  python main.py        (http://127.0.0.1:8000)
"""

import os
import re
import uuid
from datetime import datetime, timedelta

import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError, PyMongoError

# Optional .env support (MODEL_DIR / PORT / MONGO_URI)
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# ── PyTorch is optional: API still serves Black-Scholes without it ────────────
try:
    import torch
    import joblib
    _TORCH_AVAILABLE = True
except Exception as _torch_err:  # pragma: no cover - environment dependent
    torch = None
    joblib = None
    _TORCH_AVAILABLE = False
    print(f"[NeuralPricer] torch unavailable, NN disabled: {_torch_err}")

from black_scholes import bs_price_and_greeks
from data_collector import fetch_full_snapshot

# ── App ───────────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(
    app,
    origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_headers="*",
    supports_credentials=True,
)

# ── MongoDB ───────────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/")
MONGO_DB = os.getenv("MONGO_DB", "neuralpricer")

_mongo_client = None
_db = None
_last_attempt = 0.0


def get_db():
    """Lazy Mongo connection with 15s retry throttle when the server is down."""
    global _mongo_client, _db, _last_attempt
    if _db is not None:
        return _db
    now = datetime.utcnow().timestamp()
    if now - _last_attempt < 15:
        return None
    _last_attempt = now
    try:
        _mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2500)
        _mongo_client.admin.command("ping")
        _db = _mongo_client[MONGO_DB]
        _db.users.create_index("email", unique=True)
        _db.price_logs.create_index([("ts", -1)])
        _db.sessions.create_index("token", unique=True)
        _db.sessions.create_index("expires", expireAfterSeconds=0)
        print(f"[NeuralPricer] MongoDB connected: {MONGO_URI} / {MONGO_DB}")
    except Exception as e:
        print(f"[NeuralPricer] MongoDB unavailable: {e}")
        return None
    return _db


def mongo_ok():
    return get_db() is not None


# ── Model + scalers ───────────────────────────────────────────────────────────
MODEL_DIR = os.getenv("MODEL_DIR", "../models")

_model = None
_scaler_X = None
_scaler_y = None


def get_model():
    global _model, _scaler_X, _scaler_y
    if not _TORCH_AVAILABLE:
        return None, None, None
    if _model is None:
        model_path = os.path.join(MODEL_DIR, "best_model_scripted.pt")
        sx_path = os.path.join(MODEL_DIR, "scaler_X.pkl")
        sy_path = os.path.join(MODEL_DIR, "scaler_y.pkl")

        if not all(os.path.exists(p) for p in [model_path, sx_path, sy_path]):
            return None, None, None

        try:
            _model = torch.jit.load(model_path, map_location="cpu")
            _model.eval()
            _scaler_X = joblib.load(sx_path)
            _scaler_y = joblib.load(sy_path)
        except Exception as e:
            print(f"[NeuralPricer] failed to load model: {e}")
            return None, None, None
    return _model, _scaler_X, _scaler_y


# ── Helpers ───────────────────────────────────────────────────────────────────
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def parse_price_body(body):
    """Validate and normalise a price request body → dict or None."""
    try:
        return {
            "S": float(body["S"]),
            "K": float(body["K"]),
            "T": float(body["T"]),
            "r": float(body["r"]),
            "sigma": float(body["sigma"]),
            "is_call": int(body["is_call"]),
        }
    except (KeyError, TypeError, ValueError):
        return None


def build_features(p):
    mon = p["S"] / p["K"]
    return np.array([[
        p["S"], p["K"], p["T"], p["r"], p["sigma"], p["is_call"],
        mon, float(np.log(mon)), float(np.sqrt(max(p["T"], 1e-8))),
    ]])


def nn_infer(features, model, scaler_X, scaler_y):
    X_s = scaler_X.transform(features)
    t = torch.tensor(X_s, dtype=torch.float32)
    with torch.no_grad():
        out = model(t)
    return float(scaler_y.inverse_transform(out.numpy())[0, 0])


def price_one(p):
    """Black-Scholes (+ NN when loaded) for one normalised request dict."""
    model, scaler_X, scaler_y = get_model()
    bs_out = bs_price_and_greeks(p["S"], p["K"], p["T"], p["r"], p["sigma"], p["is_call"])
    bs_p = bs_out["price"]

    result = {
        "bs_price": round(bs_p, 4),
        "greeks": {k: round(v, 6) for k, v in bs_out["greeks"].items()},
        "inputs": p,
    }

    if model is not None:
        nn_p = nn_infer(build_features(p), model, scaler_X, scaler_y)
        result["nn_price"] = round(nn_p, 4)
        result["abs_error"] = round(abs(nn_p - bs_p), 6)
        result["pct_error"] = round(abs(nn_p - bs_p) / bs_p * 100, 4) if bs_p > 0 else 0
    else:
        result["nn_price"] = None
        result["abs_error"] = None
        result["pct_error"] = None
        result["note"] = "Model not loaded — showing BS price only. Train the model first."
    return result


def current_user():
    """Resolve Bearer token → {email, name} or None."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    db = get_db()
    if db is None:
        return None
    token = auth[7:].strip()
    try:
        sess = db.sessions.find_one({"token": token, "expires": {"$gt": datetime.utcnow()}})
    except PyMongoError:
        return None
    if not sess:
        return None
    return {"email": sess.get("email"), "name": sess.get("name")}


def create_session(db, email, name):
    token = uuid.uuid4().hex + uuid.uuid4().hex
    db.sessions.insert_one({
        "token": token,
        "email": email,
        "name": name,
        "created": datetime.utcnow(),
        "expires": datetime.utcnow() + timedelta(days=30),
    })
    return token


def log_quote(p, result, user_email):
    """Persist every single-quote request into Mongo (fire-and-forget)."""
    db = get_db()
    if db is None:
        return
    try:
        db.price_logs.insert_one({
            "ts": datetime.utcnow(),
            "user": user_email,
            "S": p["S"], "K": p["K"], "T": p["T"],
            "r": p["r"], "sigma": p["sigma"], "is_call": p["is_call"],
            "bs_price": result["bs_price"],
            "nn_price": result["nn_price"],
        })
    except PyMongoError as e:
        print(f"[NeuralPricer] quote log failed: {e}")


# ── Routes: core API (same surface as the old FastAPI app) ────────────────────
@app.get("/")
def root():
    model, _, _ = get_model()
    return {
        "status": "NeuralPricer API running (Flask)",
        "model_loaded": model is not None,
        "mongo": "ok" if mongo_ok() else "down",
        "version": "2.0.0",
    }


@app.get("/api/health")
def health():
    model, _, _ = get_model()
    return {
        "status": "ok",
        "model_ready": model is not None,
        "torch_available": _TORCH_AVAILABLE,
        "mongo": "ok" if mongo_ok() else "down",
    }


@app.post("/api/price")
def price_endpoint():
    body = request.get_json(silent=True)
    p = parse_price_body(body)
    if p is None:
        return jsonify(detail="Invalid request — need S, K, T, r, sigma, is_call"), 400
    try:
        result = price_one(p)
    except Exception as e:
        return jsonify(detail=str(e)), 500
    user = current_user()
    log_quote(p, result, user["email"] if user else None)
    return jsonify(result)


@app.post("/api/price/batch")
def price_batch():
    body = request.get_json(silent=True)
    if not isinstance(body, list):
        return jsonify(detail="Expected a JSON array of price requests"), 400
    results = []
    for item in body:
        p = parse_price_body(item)
        if p is None:
            results.append({"error": "invalid request"})
            continue
        try:
            r = price_one(p)
            results.append({"bs_price": r["bs_price"], "greeks": r["greeks"],
                            "nn_price": r["nn_price"]})
        except Exception as e:
            results.append({"error": str(e)})
    return jsonify(results)


@app.post("/api/greeks")
def greeks():
    p = parse_price_body(request.get_json(silent=True))
    if p is None:
        return jsonify(detail="Invalid request — need S, K, T, r, sigma, is_call"), 400
    try:
        out = bs_price_and_greeks(p["S"], p["K"], p["T"], p["r"], p["sigma"], p["is_call"])
        return jsonify(
            greeks={k: round(v, 8) for k, v in out["greeks"].items()},
            bs_price=round(out["price"], 6),
        )
    except Exception as e:
        return jsonify(detail=str(e)), 500


@app.get("/api/live-chain/<currency>")
def live_chain(currency):
    try:
        df = fetch_full_snapshot(currency.upper())
        if df.empty:
            return jsonify(detail="No data returned from Deribit"), 404

        model, scaler_X, scaler_y = get_model()
        top = df.head(50).copy()
        nn_prices = []
        for _, row in top.iterrows():
            if model is not None:
                try:
                    f = np.array([[row.S, row.K, row.T, row.r, row.sigma,
                                   row.is_call, row.moneyness,
                                   row.log_moneyness, row.sqrt_T]])
                    nn_prices.append(round(nn_infer(f, model, scaler_X, scaler_y), 2))
                except Exception:
                    nn_prices.append(None)
            else:
                nn_prices.append(None)

        top["nn_price"] = nn_prices
        # keep nn_price as null (not 0); zero-fill other numeric NaNs
        top = top.fillna({c: 0 for c in top.columns if c != "nn_price"})
        return jsonify(top.to_dict(orient="records"))
    except Exception as e:
        return jsonify(detail=str(e)), 500


# ── Routes: auth (MongoDB users + sessions) ───────────────────────────────────
@app.post("/api/auth/register")
def register():
    db = get_db()
    if db is None:
        return jsonify(detail="Database unavailable — is MongoDB running?"), 503
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")

    if len(name) < 2:
        return jsonify(detail="Name must be at least 2 characters"), 400
    if not EMAIL_RE.match(email):
        return jsonify(detail="Enter a valid email address"), 400
    if len(password) < 8:
        return jsonify(detail="Password must be at least 8 characters"), 400

    try:
        db.users.insert_one({
            "name": name,
            "email": email,
            "password": generate_password_hash(password),
            "created_at": datetime.utcnow(),
        })
    except DuplicateKeyError:
        return jsonify(detail="An account with this email already exists"), 409
    except PyMongoError as e:
        return jsonify(detail=f"Database error: {e}"), 500

    token = create_session(db, email, name)
    return jsonify(token=token, user={"name": name, "email": email})


@app.post("/api/auth/login")
def login():
    db = get_db()
    if db is None:
        return jsonify(detail="Database unavailable — is MongoDB running?"), 503
    body = request.get_json(silent=True) or {}
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")

    user = db.users.find_one({"email": email})
    if not user or not check_password_hash(user["password"], password):
        return jsonify(detail="Invalid email or password"), 401

    token = create_session(db, email, user.get("name", email))
    return jsonify(token=token, user={"name": user.get("name", email), "email": email})


@app.post("/api/auth/logout")
def logout():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        db = get_db()
        if db is not None:
            try:
                db.sessions.delete_one({"token": auth[7:].strip()})
            except PyMongoError:
                pass
    return jsonify(ok=True)


@app.get("/api/auth/me")
def me():
    user = current_user()
    if user is None:
        return jsonify(detail="Not authenticated"), 401
    return jsonify(user=user)


# ── Routes: quote history (MongoDB price_logs) ────────────────────────────────
@app.get("/api/history")
def history():
    db = get_db()
    if db is None:
        return jsonify(items=[], mongo="down")
    try:
        limit = max(1, min(int(request.args.get("limit", 20)), 100))
        user = current_user()
        query = {"user": user["email"]} if user else {}
        rows = list(db.price_logs.find(query, {"_id": 0}).sort("ts", -1).limit(limit))
        for r in rows:
            r["ts"] = r["ts"].isoformat() + "Z"
        return jsonify(items=rows, mongo="ok", scope="user" if user else "global")
    except Exception as e:
        return jsonify(detail=str(e)), 500


# ── Entry ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Note: some shells export PORT=0 — fall back to 8000 in that case.
    try:
        port = int(os.getenv("PORT", "8000") or 0)
    except ValueError:
        port = 0
    if port <= 0:
        port = 8000
    print(f"[NeuralPricer] Flask API on http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, threaded=True)
