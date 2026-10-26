"""Everything the agent can read. All of it is already public:
- the city layers in public/data/*.geojson (the same files the map draws)
- get_hotspots(): 50 m squares with reports from at least 3 different people, plus approved comments
- category names from src/i18n.js
There is deliberately no path to the private reports table.
"""
import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import httpx

from .geo import centre

# layer -> (file, id prefix, what one feature is)
LAYERS = {
    "lamps": ("lamps.geojson", "lamp", "street lamp"),
    "signals": ("signals.geojson", "sig", "traffic light"),
    "crossings": ("crossings.geojson", "cross", "pedestrian crossing"),
    "benches": ("benches.geojson", "bench", "bench"),
    "bus": ("bus.geojson", "bus", "bus stop"),
    "parking": ("parking.geojson", "park", "disabled parking spot"),
    "trees": ("trees.geojson", "tree", "tree"),
    "buildings": ("buildings.geojson", "bldg", "building"),
}
CROSSING_KIND = {"s": "with traffic lights", "u": "uncontrolled (no lights)", "m": "marked, no lights"}


@dataclass
class Feature:
    id: str
    layer: str
    lon: float
    lat: float
    props: dict

    def describe(self) -> dict:
        """Only the attributes that mean something to a person."""
        p, out = self.props, {}
        if self.layer in ("lamps", "signals", "benches", "buildings") and p.get("h") is not None:
            out["height_m"] = p["h"]
        if self.layer == "trees" and p.get("z") is not None:
            out["top_height_m"] = p["z"]
        if self.layer == "crossings":
            out["kind"] = CROSSING_KIND.get(p.get("k"), "unknown")
        if self.layer == "bus":
            out["name"] = p.get("n")
        if self.layer == "parking":
            out["places"], out["address"] = p.get("n"), p.get("a")
        if self.layer == "buildings" and p.get("u"):
            out["use"] = p["u"]
        return out


def load_layers(data_dir: Path) -> dict[str, list[Feature]]:
    layers = {}
    for name, (file, prefix, _) in LAYERS.items():
        fc = json.loads((data_dir / file).read_text(encoding="utf-8"))
        feats = []
        for i, f in enumerate(fc["features"]):
            lon, lat = centre(f["geometry"])
            feats.append(Feature(f"{prefix}{i}", name, lon, lat, f.get("properties") or {}))
        layers[name] = feats
    return layers


def load_categories(i18n_js: Path) -> dict[str, dict]:
    """CATEGORY_FALLBACK rows: ['code', 'English', 'French', 'topic']."""
    src = i18n_js.read_text(encoding="utf-8")
    block = re.search(r"CATEGORY_FALLBACK\s*=\s*\[(.*?)\];", src, re.S).group(1)
    rows = re.findall(r"\[\s*'([^']+)',\s*'([^']*)',\s*'([^']*)',\s*'([^']+)'\s*\]", block)
    return {code: {"en": en, "fr": fr, "topic": topic} for code, en, fr, topic in rows}


@dataclass
class Cell:
    """One public hotspot square."""
    id: str
    topic: str
    lon: float
    lat: float
    reports: int
    avg_score: float          # 1 = bad (red) .. 3 = good (green)
    top_category: str
    avg_count: float | None   # crowd: people around
    avg_difficulty: float | None
    comments: list[str] = field(default_factory=list)


def cell_id(topic: str, lon: float, lat: float) -> str:
    h = hashlib.sha1(f"{topic}:{lon:.6f},{lat:.6f}".encode()).hexdigest()[:6]
    return f"{topic[0]}{h}"   # e.g. s3fa21c (safety) / c08be1d (crowd)


def parse_hotspots(topic: str, fc: dict) -> list[Cell]:
    cells = []
    for f in fc.get("features") or []:
        lon, lat = f["geometry"]["coordinates"]
        p = f["properties"]
        cells.append(Cell(cell_id(topic, lon, lat), topic, lon, lat, int(p["reports"]), float(p["avg_score"]),
                          p.get("top_category") or "other", p.get("avg_count"), p.get("avg_difficulty"),
                          [c for c in (p.get("comments") or []) if c]))
    return cells


class Hotspots:
    """get_hotspots() through the public REST API, cached for a minute (the map itself refreshes every 30 s)."""

    def __init__(self, fetch: Callable[[str], dict], ttl_s: int = 60):
        self._fetch, self._ttl, self._cache = fetch, ttl_s, {}

    def get(self, topic: str) -> list[Cell]:
        hit = self._cache.get(topic)
        if hit and time.monotonic() - hit[0] < self._ttl:
            return hit[1]
        cells = parse_hotspots(topic, self._fetch(topic))
        self._cache[topic] = (time.monotonic(), cells)
        return cells

    @classmethod
    def from_supabase(cls, url: str, anon_key: str, ttl_s: int = 60) -> "Hotspots":
        client = httpx.Client(base_url=url.rstrip("/"), timeout=10,
                              headers={"apikey": anon_key, "Content-Type": "application/json"})

        def fetch(topic: str) -> dict:
            r = client.post("/rest/v1/rpc/get_hotspots", json={"p_topic": topic})
            r.raise_for_status()
            return r.json()

        return cls(fetch, ttl_s)

    @classmethod
    def from_files(cls, folder: Path) -> "Hotspots":
        return cls(lambda t: json.loads((folder / f"hotspots_{t}.json").read_text(encoding="utf-8")), ttl_s=10**9)
