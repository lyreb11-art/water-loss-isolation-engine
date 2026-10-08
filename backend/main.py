"""
main.py -- FastAPI backend for the Water Loss Isolation Engine.

Server-owned simulation loop, read-only /api/simulate/step, ML classification
endpoint. Run: uvicorn main:app --reload --port 8000
"""

import asyncio
import os
import re
import joblib
from contextlib import asynccontextmanager
from datetime import datetime
from threading import Lock as ThreadLock
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db
from graph_twin import inject_anomaly, classify_step, zone_status
import osm_network


TICK_INTERVAL_SECONDS = 4.0

GRAPH_STATE = {
    "G": None,
    "place_name": "Bandra West, Mumbai, India",
    "source": "",
    "residual_history": [],
    "_last_results": [],
    "_sim_running": True,
    "tick_count": 0,
}

_graph_lock = asyncio.Lock()
_load_lock = ThreadLock()


# ---------------------------------------------------------------------
# ML model
# ---------------------------------------------------------------------
_ML_PATH = os.path.join(os.path.dirname(__file__), "ml", "model.joblib")
_ML_BUNDLE = None


def _get_ml_model():
    global _ML_BUNDLE
    if _ML_BUNDLE is None and os.path.exists(_ML_PATH):
        _ML_BUNDLE = joblib.load(_ML_PATH)
        print(f"[OK] ML model loaded from {_ML_PATH}")
    return _ML_BUNDLE


# ---------------------------------------------------------------------
# Graph loading
# ---------------------------------------------------------------------
def _ensure_graph():
    if GRAPH_STATE["G"] is not None:
        return GRAPH_STATE["G"]
    with _load_lock:
        if GRAPH_STATE["G"] is None:
            G, source = osm_network.build_network_from_place(GRAPH_STATE["place_name"])
            GRAPH_STATE["G"] = G
            GRAPH_STATE["source"] = source
            print(f"[OK] Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    return GRAPH_STATE["G"]


def _advance_simulation():
    G = GRAPH_STATE["G"]
    if G is None:
        return
    results = classify_step(G)
    GRAPH_STATE["_last_results"] = results
    GRAPH_STATE["tick_count"] += 1

    if results:
        max_res = max(r["diff_pct"] for r in results)
        GRAPH_STATE["residual_history"].append({
            "t": datetime.now().strftime("%H:%M:%S"),
            "residual": max_res,
        })
        GRAPH_STATE["residual_history"] = GRAPH_STATE["residual_history"][-40:]

    for r in results:
        if r["classification"] != "Normal":
            db.add_synthetic_event(r["edge"], r["zone"], r["diff_pct"],
                                   r["classification"], r["confidence"])


async def _sim_loop():
    while True:
        try:
            await asyncio.sleep(TICK_INTERVAL_SECONDS)
            if GRAPH_STATE["G"] is None:
                continue
            async with _graph_lock:
                if not GRAPH_STATE["_sim_running"]:
                    continue
                _advance_simulation()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[WARN] sim loop tick failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    print("[OK] Database initialised.")
    _get_ml_model()
    task = asyncio.create_task(_sim_loop())
    print(f"[OK] Simulation loop started (interval {TICK_INTERVAL_SECONDS}s)")
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Water Loss Isolation Engine API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _diff_pct(d):
    fi = float(d.get("flow_in", 0))
    fo = float(d.get("flow_out", 0))
    if fi <= 0:
        return 0.0
    return max(0.0, (fi - fo) / fi * 100)


def _serialize_graph(G):
    nodes = [
        {"id": str(n), "lat": d["lat"], "lon": d["lon"], "street": d.get("street", "")}
        for n, d in G.nodes(data=True)
    ]
    edges = []
    for u, v, d in G.edges(data=True):
        geom = d.get("geometry") or [
            (G.nodes[u]["lon"], G.nodes[u]["lat"]),
            (G.nodes[v]["lon"], G.nodes[v]["lat"]),
        ]
        edges.append({
            "id": f"{u}__{v}",
            "source": str(u),
            "target": str(v),
            "path": [[float(x), float(y)] for x, y in geom],
            "street": d.get("street", ""),
            "road_class": d.get("road_class", "distribution"),
            "classification": d.get("classification", "Normal"),
            "confidence": float(d.get("confidence", 1.0)),
            "flow_in": float(d.get("flow_in", 0)),
            "flow_out": float(d.get("flow_out", 0)),
            "isolated": bool(d.get("isolated", False)),
            "diff_pct": _diff_pct(d),
        })
    return {"nodes": nodes, "edges": edges}


def _current_state():
    G = GRAPH_STATE["G"]
    return {
        "results": GRAPH_STATE["_last_results"],
        "graph": _serialize_graph(G) if G else {"nodes": [], "edges": []},
        "residual_history": GRAPH_STATE["residual_history"],
        "tick_count": GRAPH_STATE["tick_count"],
        "sim_running": GRAPH_STATE["_sim_running"],
        "tick_interval": TICK_INTERVAL_SECONDS,
    }


def _street_sort_key(s: str):
    parts = re.split(r'(\d+)', s)
    return [(0, int(p)) if p.isdigit() else (1, p.lower()) for p in parts if p]


@app.get("/")
def root():
    return {"status": "ok", "service": "Water Loss Isolation Engine API", "version": "2.0.0"}


@app.get("/api/graph")
async def get_graph():
    G = await asyncio.to_thread(_ensure_graph)
    async with _graph_lock:
        return {
            "place_name": GRAPH_STATE["place_name"],
            "source": GRAPH_STATE["source"],
            "graph": _serialize_graph(G),
            "tick_count": GRAPH_STATE["tick_count"],
        }


class LoadRegionRequest(BaseModel):
    place_name: str


@app.post("/api/graph/load")
async def load_region(req: LoadRegionRequest):
    try:
        G, source = await asyncio.to_thread(
            osm_network.build_network_from_place, req.place_name
        )
        async with _graph_lock:
            GRAPH_STATE["G"] = G
            GRAPH_STATE["place_name"] = req.place_name
            GRAPH_STATE["source"] = source
            GRAPH_STATE["residual_history"] = []
            GRAPH_STATE["_last_results"] = []
            GRAPH_STATE["tick_count"] = 0
        return {"source": source, "place_name": req.place_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/simulate/step")
async def api_step():
    await asyncio.to_thread(_ensure_graph)
    async with _graph_lock:
        return _current_state()


@app.post("/api/simulate/tick")
async def api_tick():
    await asyncio.to_thread(_ensure_graph)
    async with _graph_lock:
        _advance_simulation()
        return _current_state()


@app.post("/api/simulate/pause")
async def api_pause():
    async with _graph_lock:
        GRAPH_STATE["_sim_running"] = False
    return {"ok": True, "sim_running": False}


@app.post("/api/simulate/resume")
async def api_resume():
    async with _graph_lock:
        GRAPH_STATE["_sim_running"] = True
    return {"ok": True, "sim_running": True}


@app.get("/api/simulate/status")
async def api_sim_status():
    async with _graph_lock:
        return {
            "sim_running": GRAPH_STATE["_sim_running"],
            "tick_interval": TICK_INTERVAL_SECONDS,
            "tick_count": GRAPH_STATE["tick_count"],
        }


@app.get("/api/simulate/residuals")
async def api_residuals():
    async with _graph_lock:
        return {"residual_history": GRAPH_STATE["residual_history"]}


class InjectRequest(BaseModel):
    edge_id: str
    event_type: str
    severity: Optional[float] = None
    actor: Optional[str] = "unknown"


@app.post("/api/simulate/inject")
async def api_inject(req: InjectRequest):
    await asyncio.to_thread(_ensure_graph)
    try:
        u_str, v_str = req.edge_id.split("__")
    except ValueError:
        raise HTTPException(status_code=400, detail="edge_id must be 'u__v'")

    async with _graph_lock:
        G = GRAPH_STATE["G"]

        def _resolve(s: str):
            if s in G.nodes:
                return s
            if s.isdigit():
                n = int(s)
                if n in G.nodes:
                    return n
            return None

        u = _resolve(u_str)
        v = _resolve(v_str)
        if u is None or v is None:
            raise HTTPException(status_code=404, detail=f"Edge {req.edge_id} not found")

        inject_anomaly(G, (u, v), req.event_type, severity=req.severity)

        if req.event_type == "clear":
            db.add_audit(req.actor, "unisolate", req.edge_id, "manual clear")
        else:
            db.add_audit(req.actor, "inject", req.edge_id, req.event_type)

    return {"ok": True, "edge_id": req.edge_id, "event_type": req.event_type}


class UnisolateRequest(BaseModel):
    edge_id: str
    actor: Optional[str] = "unknown"


@app.post("/api/simulate/unisolate")
async def api_unisolate(req: UnisolateRequest):
    await asyncio.to_thread(_ensure_graph)
    try:
        u_str, v_str = req.edge_id.split("__")
    except ValueError:
        raise HTTPException(status_code=400, detail="edge_id must be 'u__v'")

    async with _graph_lock:
        G = GRAPH_STATE["G"]

        def _resolve(s: str):
            if s in G.nodes:
                return s
            if s.isdigit():
                n = int(s)
                if n in G.nodes:
                    return n
            return None

        u = _resolve(u_str)
        v = _resolve(v_str)
        if u is None or v is None:
            raise HTTPException(status_code=404, detail=f"Edge {req.edge_id} not found")

        inject_anomaly(G, (u, v), "clear")
        db.add_audit(req.actor, "unisolate", req.edge_id, "manual restore")

    return {"ok": True, "edge_id": req.edge_id}


class ClearAllRequest(BaseModel):
    actor: Optional[str] = "unknown"


@app.post("/api/simulate/clear-all")
async def api_clear_all(req: ClearAllRequest):
    await asyncio.to_thread(_ensure_graph)
    async with _graph_lock:
        G = GRAPH_STATE["G"]
        count = 0
        for u, v in list(G.edges()):
            d = G[u][v]
            if d.get("isolated") or d.get("classification") != "Normal":
                inject_anomaly(G, (u, v), "clear")
                count += 1
        db.add_audit(req.actor, "clear-all", None, f"cleared {count} segment(s)")
    return {"ok": True, "cleared": count}


@app.get("/api/audit")
def api_audit(limit: int = 20):
    rows = db.latest_audit(limit=limit)
    return {"audit": [dict(r) for r in rows]}


@app.get("/api/zones")
async def api_zones():
    await asyncio.to_thread(_ensure_graph)
    async with _graph_lock:
        G = GRAPH_STATE["G"]
        leaves = [n for n in G.nodes() if G.out_degree(n) == 0] or list(G.nodes())
        leaves = leaves[:40]
        zones = [{
            "id": str(n),
            "street": G.nodes[n].get("street", str(n)),
            "status": zone_status(G, n),
        } for n in leaves]
        return {"zones": zones}


@app.get("/api/streets")
async def api_streets(limit: int = 200):
    await asyncio.to_thread(_ensure_graph)
    async with _graph_lock:
        G = GRAPH_STATE["G"]
        streets = {
            d.get("street")
            for _, d in G.nodes(data=True)
            if d.get("street") and not d["street"].startswith("Junction")
        }
        sorted_streets = sorted(streets, key=_street_sort_key)
        return {"streets": sorted_streets[:limit]}


# ---------------------------------------------------------------------
# ML classification endpoint
# ---------------------------------------------------------------------
class MLPredictRequest(BaseModel):
    diff_pct: float
    diff_pct_lag1: float
    diff_pct_lag3: float
    slope: float
    duration_steps: int
    flow_in_norm: float


@app.post("/api/ml/predict")
async def api_ml_predict(req: MLPredictRequest):
    bundle = _get_ml_model()
    if bundle is None:
        raise HTTPException(status_code=503, detail="ML model not loaded. Run train_model.py first.")
    features = bundle["features"]
    X = [[getattr(req, f) for f in features]]
    model = bundle["model"]
    pred = model.predict(X)[0]
    proba = float(model.predict_proba(X)[0].max())
    return {"label": str(pred), "confidence": round(proba, 3)}


# ---------------------------------------------------------------------
# Complaints / live / etc.
# ---------------------------------------------------------------------
class ComplaintRequest(BaseModel):
    zone: str
    name: str
    message: str


@app.post("/api/complaints")
def api_add_complaint(req: ComplaintRequest):
    db.add_complaint(req.zone, req.name, req.message)
    return {"ok": True}


@app.get("/api/complaints")
def api_list_complaints():
    rows = db.list_complaints()
    return {"complaints": [dict(r) for r in rows]}


class UpdateComplaintRequest(BaseModel):
    status: str
    official_reply: Optional[str] = None


@app.patch("/api/complaints/{complaint_id}")
def api_update_complaint(complaint_id: int, req: UpdateComplaintRequest):
    db.update_complaint(complaint_id, req.status, req.official_reply)
    return {"ok": True}


@app.get("/api/live")
def api_live(limit: int = 40):
    rows = db.latest_live_readings(limit=limit)
    return {"readings": [dict(r) for r in rows]}


class LiveReadingRequest(BaseModel):
    flow_in: float
    flow_out: float
    diff_pct: float
    classification: str
    confidence: float
    valve_closed: bool = False


@app.post("/api/live")
def api_add_live(req: LiveReadingRequest):
    db.add_live_reading(req.flow_in, req.flow_out, req.diff_pct,
                        req.classification, req.confidence, req.valve_closed)
    return {"ok": True}