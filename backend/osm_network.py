"""
osm_network.py -- Builds the digital twin from REAL Mumbai streets via OSMnx.
"""
import os
import pickle
import random
import networkx as nx
import osmnx as ox

CACHE_DIR = ".osm_cache"
os.makedirs(CACHE_DIR, exist_ok=True)

DEFAULT_PLACE = "Bandra West, Mumbai, India"
MAX_EDGES = 3500

TRUNK_CLASSES = {"trunk", "primary", "secondary"}


def _cache_path(place_name: str) -> str:
    safe = "".join(c if c.isalnum() else "_" for c in place_name)[:80]
    return os.path.join(CACHE_DIR, f"{safe}.pkl")


def _cap_graph_edges(G):
    if G.number_of_edges() <= MAX_EDGES:
        return G

    edges = list(G.edges(keys=True))
    G.remove_edges_from(edges[MAX_EDGES:])
    G.remove_nodes_from(list(nx.isolates(G)))
    return G


def _fetch_road_graph(place_name: str):
    cache = _cache_path(place_name)
    if os.path.exists(cache):
        with open(cache, "rb") as f:
            return _cap_graph_edges(pickle.load(f))

    G = ox.graph_from_place(place_name, network_type="drive", simplify=True)
    G = ox.truncate.largest_component(G, strongly=False)
    G = _cap_graph_edges(G)

    with open(cache, "wb") as f:
        pickle.dump(G, f)
    return G


def _classify_road(edge_data: dict) -> str:
    hw = edge_data.get("highway", "residential")
    if isinstance(hw, list):
        hw = hw[0]
    return "trunk" if hw in TRUNK_CLASSES else "distribution"


def _base_flow_for(road_class: str, length_m: float) -> float:
    base = random.uniform(60, 120) if road_class == "trunk" else random.uniform(15, 45)
    return round(base * (1 + length_m / 5000), 2)


def _node_street_name(road, node):
    for _, _, d in road.out_edges(node, data=True):
        nm = d.get("name", "")
        if isinstance(nm, list):
            nm = nm[0]
        if nm:
            return nm
    return f"Junction {node}"


def _edge_geometry(edge_data, G, u, v):
    geom = edge_data.get("geometry")
    if geom is None:
        return [(G.nodes[u]["lon"], G.nodes[u]["lat"]),
                (G.nodes[v]["lon"], G.nodes[v]["lat"])]
    return [(x, y) for x, y in geom.coords]


def _offline_fallback():
    """Self-contained fallback -- does NOT import graph_twin."""
    NODE_COORDS = {
        "Bandra Station":  (19.054840, 72.840690),
        "S.V. Road":       (19.055194, 72.837331),
        "Turner Road":     (19.059305, 72.834682),
        "Hill Road":       (19.055201, 72.830831),
        "Carter Road":     (19.059973, 72.822219),
        "Linking Road":    (19.065015, 72.834562),
        "Waterfield Road": (19.059177, 72.834174),
    }
    edges = [
        ("Bandra Station", "S.V. Road"),
        ("S.V. Road", "Turner Road"),
        ("S.V. Road", "Hill Road"),
        ("Hill Road", "Carter Road"),
        ("Turner Road", "Linking Road"),
        ("Turner Road", "Waterfield Road"),
    ]
    G = nx.DiGraph()
    for name, (lat, lon) in NODE_COORDS.items():
        G.add_node(name, lat=lat, lon=lon, street=name)
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


def build_network_from_place(place_name: str = DEFAULT_PLACE):
    try:
        road = _fetch_road_graph(place_name)
        G = nx.DiGraph()

        for n, data in road.nodes(data=True):
            G.add_node(n, lat=data["y"], lon=data["x"],
                       street=_node_street_name(road, n))

        for u, v, k, data in road.edges(keys=True, data=True):
            if G.has_edge(u, v) or G.has_edge(v, u):
                continue
            road_class = _classify_road(data)
            length_m = float(data.get("length", 50.0))
            base_flow = _base_flow_for(road_class, length_m)

            street_name = data.get("name", "Unnamed Road")
            if isinstance(street_name, list):
                street_name = street_name[0]

            G.add_edge(
                u, v,
                flow_in=base_flow, flow_out=base_flow,
                status="Normal", classification="Normal",
                confidence=1.0, duration_steps=0, isolated=False,
                road_class=road_class, length_m=length_m,
                street=street_name,
                geometry=_edge_geometry(data, G, u, v),
            )

<<<<<<< HEAD
        source = (f"Real Mumbai street network via OpenStreetMap "
=======
        source = (f"✅ Real Mumbai street network via OpenStreetMap "
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f
                  f"({G.number_of_nodes()} junctions · {G.number_of_edges()} segments · "
                  f"region: {place_name})")
        return G, source

    except Exception as e:
        fb = _offline_fallback()
<<<<<<< HEAD
        return fb, (f"OpenStreetMap unavailable ({type(e).__name__}: {e}). "
=======
        return fb, (f"⚠️ OpenStreetMap unavailable ({type(e).__name__}: {e}). "
>>>>>>> babbc12ee2f070745c17028f47c1dc5cd09fd76f
                    f"Using offline Bandra West sample.")


if __name__ == "__main__":
    G, src = build_network_from_place("Bandra West, Mumbai, India")
    print(src)
    for i, (u, v, d) in enumerate(G.edges(data=True)):
        print(f"  {d['street']:<30} class={d['road_class']:<12} flow_in={d['flow_in']}")
        if i >= 8:
            break