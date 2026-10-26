"""Small geometry helpers. The district is about 2 km across, so a flat-earth distance is accurate to centimetres."""
import json
import math
import re
from pathlib import Path

M_PER_DEG_LAT = 111_320.0


def dist_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    k = math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon2 - lon1) * M_PER_DEG_LAT * k, (lat2 - lat1) * M_PER_DEG_LAT)


def centre(geometry: dict) -> tuple[float, float]:
    """Representative point (lon, lat): the point itself, the middle of a line, the mean of a polygon's outer ring."""
    kind, c = geometry["type"], geometry["coordinates"]
    if kind == "Point":
        pts = [c]
    elif kind == "LineString":
        pts = c
    elif kind == "Polygon":
        pts = c[0][:-1] or c[0]
    elif kind == "MultiPolygon":
        pts = c[0][0][:-1] or c[0][0]
    else:
        raise ValueError(f"unsupported geometry {kind}")
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def load_ring(vauban_js: Path) -> list[list[float]]:
    """Read the district boundary from src/vauban.js so the app and the agent share one source."""
    m = re.search(r"VAUBAN_RING\s*=\s*(\[\[.*?\]\]);", vauban_js.read_text(encoding="utf-8"), re.S)
    if not m:
        raise ValueError("VAUBAN_RING not found in vauban.js")
    return json.loads(m.group(1))


def inside(lon: float, lat: float, ring: list[list[float]]) -> bool:
    """Ray casting, same as inVauban() in the app."""
    ins = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            ins = not ins
        j = i
    return ins
