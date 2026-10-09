"""
main.py -- FastAPI backend for the Water Loss Isolation Engine.

Server-owned simulation loop, read-only /api/simulate/step, ML classification
endpoint. Run: uvicorn main:app --reload --port 8000
"""

import asyncio
import os
import re
import json
import joblib
import networkx as nx
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


def _get_ml_model(reload: bool = False):
    global _ML_BUNDLE
    if (_ML_BUNDLE is None or reload) and os.path.exists(_ML_PATH):
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
    data = req.model_dump() if hasattr(req, "model_dump") else req.dict()
    data["duration_steps"] = min(30, max(0, data.get("duration_steps", 0)))
    X = [[data[f] for f in features]]
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
    status: Optional[str] = "Resolved"
    official_reply: Optional[str] = None


@app.patch("/api/complaints/{complaint_id}")
def api_update_complaint(complaint_id: int, req: UpdateComplaintRequest):
    db.update_complaint(complaint_id, req.status or "Resolved", req.official_reply)
    return {"ok": True}


# ---------------------------------------------------------------------
# Citizen Complaint Tracking & Lifecycle
# ---------------------------------------------------------------------
class DispatchRequest(BaseModel):
    depot_node: Optional[str] = None
    note: Optional[str] = None


class WorkLogEntry(BaseModel):
    action_type: str
    notes: Optional[str] = None
    metadata: Optional[dict] = None


VALID_ACTIONS = {
    "crew_dispatched", "crew_arrived", "assessment", "excavation_started",
    "pipe_replaced", "joint_resealed", "valve_adjusted", "temporary_patch",
    "pressure_test", "supply_restored", "resolved",
}


def _estimate_households_near(G, node, radius_m=200):
    import math
    if not node or node not in G.nodes:
        return 0
    lat0, lon0 = G.nodes[node]["lat"], G.nodes[node]["lon"]
    count = 0
    for n, d in G.nodes(data=True):
        dlat = (d["lat"] - lat0) * 111000
        dlon = (d["lon"] - lon0) * 111000 * math.cos(math.radians(lat0))
        if (dlat**2 + dlon**2) ** 0.5 <= radius_m:
            count += 1
    return max(1, count * 3)   # ~3 households per residential node


def _find_node_by_street(G, street_name):
    if not street_name:
        return None
    s_target = street_name.strip().lower()
    # 1. Match node's street attribute
    for n, d in G.nodes(data=True):
        st = (d.get("street") or "").strip().lower()
        if st and (st == s_target or s_target in st or st in s_target):
            return n
    # 2. Match edge's street attribute (OSM ways store street names on edges)
    for u, v, d in G.edges(data=True):
        st = (d.get("street") or "").strip().lower()
        if st and (st == s_target or s_target in st or st in s_target):
            return u
    # 3. Fallback to any node if available
    nodes = list(G.nodes())
    return nodes[0] if nodes else None


@app.get("/api/complaints/{cid}")
def api_get_complaint(cid: int):
    conn = db.get_conn()
    row = conn.execute("SELECT * FROM complaints WHERE id=?", (cid,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Complaint not found")
    return dict(row)


@app.post("/api/complaints/{cid}/dispatch")
def api_dispatch(cid: int, req: DispatchRequest):
    G = _ensure_graph()
    conn = db.get_conn()
    complaint = conn.execute("SELECT * FROM complaints WHERE id=?", (cid,)).fetchone()
    if not complaint:
        conn.close()
        raise HTTPException(404, "Complaint not found")

    # pick depot: explicit > first node > any node
    depot = req.depot_node or list(G.nodes())[0]

    # find target node by street name (complaint.zone)
    target = _find_node_by_street(G, complaint["zone"])
    if not target:
        conn.close()
        raise HTTPException(400, f"No graph node matches zone '{complaint['zone']}'")

    # compute shortest path along real street network
    try:
        path = nx.shortest_path(G, depot, target, weight="length_m")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        path = [depot, target]  # fallback: direct line

    # build polyline (lon, lat) along the actual geometry
    route_coords = []
    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        geom = G[u][v].get("geometry") if G.has_edge(u, v) else None
        if not geom:
            geom = [
                (G.nodes[u]["lon"], G.nodes[u]["lat"]),
                (G.nodes[v]["lon"], G.nodes[v]["lat"]),
            ]
        route_coords.extend([[float(x), float(y)] for x, y in geom])
        route_coords.append([G.nodes[v]["lon"], G.nodes[v]["lat"]])

    now = db.now_iso()
    conn.execute(
        """UPDATE complaints
           SET status='In Progress', stage='dispatched',
               dispatched_at=?, assigned_depot=?
           WHERE id=?""",
        (now, depot, cid),
    )
    conn.execute(
        """INSERT INTO work_logs
           (complaint_id, action_type, notes, metadata, logged_by, logged_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (cid, "crew_dispatched", req.note or "Crew dispatched to site",
         json.dumps({"depot": depot}), "admin", now),
    )
    conn.commit()
    conn.close()

    return {
        "ok": True,
        "route": route_coords,
        "target_node": target,
        "target_lat": G.nodes[target]["lat"],
        "target_lon": G.nodes[target]["lon"],
        "eta_seconds": 12,
    }


@app.post("/api/complaints/{cid}/onsite")
def api_onsite(cid: int):
    now = db.now_iso()
    conn = db.get_conn()
    conn.execute(
        "UPDATE complaints SET stage='onsite', onsite_at=? WHERE id=?",
        (now, cid),
    )
    conn.execute(
        """INSERT INTO work_logs
           (complaint_id, action_type, notes, metadata, logged_by, logged_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (cid, "crew_arrived", "Crew on-site, assessing the issue",
         json.dumps({}), "admin", now),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/complaints/{cid}/resolve")
def api_resolve(cid: int, req: UpdateComplaintRequest):
    now = db.now_iso()
    conn = db.get_conn()
    conn.execute(
        """UPDATE complaints
           SET status='Resolved', stage='resolved',
               resolved_at=?, official_reply=?
           WHERE id=?""",
        (now, req.official_reply or "Issue resolved", cid),
    )
    conn.execute(
        """INSERT INTO work_logs
           (complaint_id, action_type, notes, metadata, logged_by, logged_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (cid, "resolved", req.official_reply or "Work completed",
         json.dumps({}), "admin", now),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/complaints/{cid}/worklog")
def api_add_worklog(cid: int, entry: WorkLogEntry):
    if entry.action_type not in VALID_ACTIONS:
        raise HTTPException(400, f"Invalid action_type: {entry.action_type}")

    conn = db.get_conn()
    now = db.now_iso()
    conn.execute(
        """INSERT INTO work_logs
           (complaint_id, action_type, notes, metadata, logged_by, logged_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (cid, entry.action_type, entry.notes,
         json.dumps(entry.metadata or {}), "admin", now),
    )

    # side effects: certain actions advance the complaint stage
    if entry.action_type == "crew_arrived":
        conn.execute("UPDATE complaints SET stage='onsite', onsite_at=? WHERE id=?",
                     (now, cid))
    elif entry.action_type == "resolved":
        conn.execute("UPDATE complaints SET status='Resolved', stage='resolved', resolved_at=? WHERE id=?",
                     (now, cid))
    elif entry.action_type == "crew_dispatched":
        conn.execute("UPDATE complaints SET status='In Progress', stage='dispatched', dispatched_at=? WHERE id=?",
                     (now, cid))

    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/complaints/{cid}/worklog")
def api_get_worklog(cid: int):
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT * FROM work_logs WHERE complaint_id=? ORDER BY id ASC", (cid,)
    ).fetchall()
    conn.close()
    return {
        "entries": [
            {
                "id": r["id"],
                "action_type": r["action_type"],
                "notes": r["notes"],
                "metadata": json.loads(r["metadata"] or "{}"),
                "logged_by": r["logged_by"],
                "logged_at": r["logged_at"],
            }
            for r in rows
        ]
    }


@app.get("/api/complaints/{cid}/route")
def api_route(cid: int):
    G = _ensure_graph()
    conn = db.get_conn()
    complaint = conn.execute("SELECT * FROM complaints WHERE id=?", (cid,)).fetchone()
    conn.close()
    if not complaint:
        raise HTTPException(404, "Complaint not found")

    target = _find_node_by_street(G, complaint["zone"])
    if not target:
        return {"route": None}

    depot = complaint["assigned_depot"] or list(G.nodes())[0]
    try:
        path = nx.shortest_path(G, depot, target, weight="length_m")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        path = [depot, target]

    route_coords = []
    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        geom = G[u][v].get("geometry") if G.has_edge(u, v) else None
        if not geom:
            geom = [
                (G.nodes[u]["lon"], G.nodes[u]["lat"]),
                (G.nodes[v]["lon"], G.nodes[v]["lat"]),
            ]
        route_coords.extend([[float(x), float(y)] for x, y in geom])
        route_coords.append([G.nodes[v]["lon"], G.nodes[v]["lat"]])

    return {
        "route": route_coords,
        "target_node": target,
        "target_lat": G.nodes[target]["lat"],
        "target_lon": G.nodes[target]["lon"],
    }


@app.get("/api/complaints/{cid}/impact")
def api_complaint_impact(cid: int):
    conn = db.get_conn()
    complaint = conn.execute("SELECT * FROM complaints WHERE id=?", (cid,)).fetchone()
    conn.close()
    if not complaint:
        raise HTTPException(404, "Complaint not found")

    # average loss % for this zone from recent synthetic events
    events = db.latest_synthetic_events(limit=500)
    zone_events = [e for e in events if e.get("zone") == complaint["zone"]]
    if zone_events:
        avg_diff_pct = sum(e["diff_pct"] for e in zone_events) / len(zone_events)
    elif events:
        avg_diff_pct = sum(e["diff_pct"] for e in events) / len(events)
    else:
        avg_diff_pct = 18.5

    # flow rate at the zone's incoming or outgoing edge
    G = _ensure_graph()
    target_node = _find_node_by_street(G, complaint["zone"])
    flow_rate_lpm = 0
    if target_node:
        edges_connected = list(G.in_edges(target_node, data=True)) or list(G.out_edges(target_node, data=True))
        if edges_connected:
            flow_rate_lpm = edges_connected[0][2].get("flow_in") or edges_connected[0][2].get("flow_out", 0)
    if flow_rate_lpm <= 0:
        flow_rate_lpm = 35.0

    # water lost per day, assumed recovered after fix
    water_saved_lpd = flow_rate_lpm * 60 * 24 * (avg_diff_pct / 100)
    cost_saved = water_saved_lpd * 15 / 1000          # BMC ₹15 per 1000L
    co2_avoided = water_saved_lpd * 0.2 / 1000        # kg CO2

    households = _estimate_households_near(G, target_node, radius_m=200) if target_node else 0

    downtime_min = None
    if complaint["dispatched_at"] and complaint["resolved_at"]:
        try:
            d1 = datetime.fromisoformat(complaint["dispatched_at"])
            d2 = datetime.fromisoformat(complaint["resolved_at"])
            downtime_min = round((d2 - d1).total_seconds() / 60)
        except Exception:
            pass

    return {
        "water_saved_lpd": round(water_saved_lpd),
        "cost_saved_per_day": round(cost_saved, 2),
        "households_served": households,
        "downtime_minutes": downtime_min,
        "co2_avoided_kg_per_day": round(co2_avoided, 2),
        "avg_loss_pct_in_zone": round(avg_diff_pct, 1),
    }


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