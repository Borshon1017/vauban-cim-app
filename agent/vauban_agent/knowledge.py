"""Retrieval (the R in RAG): semantic search over the project's own texts and the approved comments.

Two sources:
- docs: the "Legend and information" texts of the app (privacy, what is collected, who sees what) in FR and EN,
  and docs/MAP-DATA-AND-API.md (where the map data comes from)
- comments: the approved comments that get_hotspots() already shows on the public map, tied to their square

The index is small (a few hundred chunks), so it lives in memory as a numpy matrix. Embeddings are cached by text,
so refreshing the comments only embeds the new ones.
"""
import hashlib
import html
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from .data import Cell


class Embedder(Protocol):
    def embed(self, texts: list[str]) -> np.ndarray: ...


class HashEmbedder:
    """Offline fallback and test embedder: hashed bag of words (and word pairs). Crude, but deterministic."""

    def __init__(self, dim: int = 512):
        self.dim = dim

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, t in enumerate(texts):
            words = re.findall(r"\w+", t.lower())
            for tok in words + [a + " " + b for a, b in zip(words, words[1:])]:
                out[i, int(hashlib.md5(tok.encode()).hexdigest(), 16) % self.dim] += 1
        return out


@dataclass
class Chunk:
    id: str
    kind: str          # "doc" or "comment"
    text: str
    meta: dict


def _clean(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s.replace("\\n", " "))
    return html.unescape(s).replace(" ", " ").replace("‑", "-").strip()


def app_info_chunks(i18n_js: Path) -> list[Chunk]:
    """The info.* texts for each language, read straight from src/i18n.js."""
    src = i18n_js.read_text(encoding="utf-8")
    sections = {"fr": src[src.index("  fr: {"):src.index("  en: {")], "en": src[src.index("  en: {"):]}
    chunks = []
    for lang, block in sections.items():
        for key, _, val in re.findall(r"'(info\.[\w.]+)':\s*([\"'])((?:(?!\2)[^\\]|\\.)*)\2", block):
            text = _clean(val)
            if len(text) > 40:
                chunks.append(Chunk(f"doc:{key}.{lang}", "doc", text, {"lang": lang, "source": "app info"}))
    return chunks


def markdown_chunks(md: Path, source: str) -> list[Chunk]:
    parts = re.split(r"\n(?=## )", md.read_text(encoding="utf-8"))
    out = []
    for i, part in enumerate(parts):
        text = re.sub(r"`", "", part).strip()
        if len(text) > 80:
            out.append(Chunk(f"doc:{md.stem.lower()}-{i}", "doc", text[:1800], {"lang": "en", "source": source}))
    return out


def comment_chunks(cells: list[Cell]) -> list[Chunk]:
    out = []
    for c in cells:
        for j, text in enumerate(dict.fromkeys(c.comments)):   # same comment twice in a square: keep one
            out.append(Chunk(f"comment:{c.id}:{j}", "comment", text,
                             {"cell": c.id, "topic": c.topic, "lat": round(c.lat, 6), "lon": round(c.lon, 6)}))
    return out


class KnowledgeIndex:
    def __init__(self, embedder: Embedder):
        self.embedder = embedder
        self._cache: dict[str, np.ndarray] = {}
        self.docs: list[Chunk] = []
        self.comments: list[Chunk] = []
        self._matrix = np.zeros((0, 1), dtype=np.float32)
        self._rows: list[Chunk] = []

    def _vectors(self, texts: list[str]) -> np.ndarray:
        missing = [t for t in dict.fromkeys(texts) if t not in self._cache]
        if missing:
            for t, v in zip(missing, self.embedder.embed(missing)):
                n = np.linalg.norm(v)
                self._cache[t] = v / n if n else v
        return np.stack([self._cache[t] for t in texts]) if texts else np.zeros((0, 1), dtype=np.float32)

    def _rebuild(self) -> None:
        self._rows = self.docs + self.comments
        self._matrix = self._vectors([c.text for c in self._rows])

    def set_docs(self, docs: list[Chunk]) -> None:
        self.docs = docs
        self._rebuild()

    def set_comments(self, comments: list[Chunk]) -> None:
        if [c.id + c.text for c in comments] != [c.id + c.text for c in self.comments]:
            self.comments = comments
            self._rebuild()

    def search(self, query: str, k: int = 5, kind: str | None = None, topic: str | None = None) -> list[tuple[Chunk, float]]:
        if not self._rows:
            return []
        q = self._vectors([query])[0]
        scores = self._matrix @ q
        hits = []
        for i in np.argsort(-scores):
            c = self._rows[int(i)]
            if (kind and c.kind != kind) or (topic and c.meta.get("topic", topic) != topic):
                continue
            hits.append((c, float(scores[i])))
            if len(hits) == k:
                break
        return hits
