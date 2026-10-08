"""
graph_twin.py -- Synthetic flow simulation + anomaly injection + classification.
"""
import random
import networkx as nx

from classifier import classify_event, diff_pct_from_flows


def build_network() -> nx.DiGraph:
    """Offline fallback -- small hand-built network."""
    NODE_COORDS = {
        "Bandra Station":  (19.054840, 72.840690),
        "S.V. Road":       (19.055194, 72.837331),
        "Turner Road":     (19.059305, 72.834682),
        "Hill Road":       (19.055201, 72.830831),
        "Carter Road":     (19.059973, 72.822219),
        "Linking Road":    (19.065015, 72.834562),
        "Waterfield Road": (19.059177, 72.834174),
    }
    G = nx.DiGraph()
    for name, (lat, lon) in NODE_COORDS.items():
        G.add_node(name, lat=lat, lon=lon, street=name)

    edges = [
        ("Bandra Station", "S.V. Road"),
        ("S.V. Road", "Turner Road"),
        ("S.V. Road", "Hill Road"),
        ("Hill Road", "Carter Road"),
        ("Turner Road", "Linking Road"),
        ("Turner Road", "Waterfield Road"),
    ]
    for u, v in edges:
        base_flow = round(random.uniform(20, 40), 1)
        G.add_edge(
            u, v,
            flow_in=base_flow, flow_out=base_flow,
            status="Normal", classification="Normal",
            confidence=1.0, duration_steps=0, isolated=False,
            road_class="distribution", length_m=200.0, street=v,
            geometry=[(G.nodes[u]["lon"], G.nodes[u]["lat"]),
                      (G.nodes[v]["lon"], G.nodes[v]["lat"])],
        )
    return G


def inject_anomaly(G: nx.DiGraph, edge: tuple, event_type: str, severity: float = None):
    u, v = edge
    if not G.has_edge(u, v):
        return
    data = G[u][v]

    if event_type == "clear":
        data["flow_out"] = data["flow_in"]
        data["status"] = "Normal"
        data["classification"] = "Normal"
        data["confidence"] = 1.0
        data["duration_steps"] = 0
        data["isolated"] = False
        return

    if severity is None:
        severity = {
            "leak":  random.uniform(0.15, 0.30),
            "theft": random.uniform(0.20, 0.45),
            "burst": random.uniform(0.65, 0.95),
        }[event_type]

    data["flow_out"] = round(data["flow_in"] * (1 - severity), 2)
    data["_onset"] = "gradual" if event_type == "leak" else "sudden"
    data["duration_steps"] = 1


def classify_step(G: nx.DiGraph):
    results = []
    for u, v, data in G.edges(data=True):
        diff_pct = diff_pct_from_flows(data["flow_in"], data["flow_out"])

        if diff_pct < 8:
            data["duration_steps"] = 0
        else:
            data["duration_steps"] = data.get("duration_steps", 0) + 1

        onset = data.get("_onset", "gradual")
        result = classify_event(diff_pct, onset, data["duration_steps"])

        data["classification"] = result.label
        data["confidence"] = result.confidence
        data["status"] = result.label

        if result.label in ("Theft", "Burst") and result.confidence > 0.7:
            data["isolated"] = True

        results.append({
            "edge": f"{u} → {v}",
            "edge_id": f"{u}__{v}",
            "zone": str(v),
            "diff_pct": round(diff_pct, 1),
            "classification": result.label,
            "confidence": result.confidence,
            "isolated": data["isolated"],
            "onset": onset,
            "duration_steps": data["duration_steps"],
        })
    return results


def zone_status(G: nx.DiGraph, zone_node) -> str:
    for u, v, data in G.in_edges(zone_node, data=True):
        if data.get("isolated"):
            return "Maintenance"
        if data["classification"] != "Normal":
            return data["classification"]
    return "Stable"


if __name__ == "__main__":
    G = build_network()
    inject_anomaly(G, ("Turner Road", "Linking Road"), "theft")
    for step in range(1, 5):
        classify_step(G)
        d = G["Turner Road"]["Linking Road"]
        print(f"step {step}: class={d['classification']} conf={d['confidence']:.2f}")