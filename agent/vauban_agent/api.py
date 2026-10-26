"""HTTP API for the app: POST /api/chat, GET /api/health.

Run locally:  uv run uvicorn vauban_agent.api:app --reload --port 8000
"""
import logging
import threading
import time
from collections import defaultdict, deque
from dataclasses import asdict

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import agent
from .config import Settings
from .data import Hotspots, load_categories, load_layers
from .geo import load_ring
from .knowledge import HashEmbedder, KnowledgeIndex, app_info_chunks, markdown_chunks
from .llm import LLMError, MistralClient
from .tools import Context, nominatim

log = logging.getLogger("vauban_agent")


class Turn(BaseModel):
    role: str
    content: str = Field(max_length=4000)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    history: list[Turn] = Field(default_factory=list, max_length=12)
    lang: str = "fr"


class RateLimiter:
    """Per visitor: N per minute and M per day. Plus one budget for everyone, to cap the API bill."""

    def __init__(self, per_minute: int, per_day: int, daily_budget: int):
        self.per_minute, self.per_day, self.budget = per_minute, per_day, daily_budget
        self._hits: dict[str, deque] = defaultdict(deque)
        self._day, self._spent = time.strftime("%Y-%m-%d"), 0
        self._lock = threading.Lock()

    def check(self, who: str, now: float | None = None) -> str | None:
        now = now or time.time()
        with self._lock:
            today = time.strftime("%Y-%m-%d", time.localtime(now))
            if today != self._day:
                self._day, self._spent = today, 0
            q = self._hits[who]
            while q and now - q[0] > 86400:
                q.popleft()
            if self._spent >= self.budget:
                return "budget"
            if len(q) >= self.per_day:
                return "day"
            if sum(1 for t in q if now - t < 60) >= self.per_minute:
                return "minute"
            q.append(now)
            self._spent += 1
            return None


def build_context(settings: Settings, embedder=None, hotspots: Hotspots | None = None) -> Context:
    app_dir = settings.app_dir
    knowledge = KnowledgeIndex(embedder or HashEmbedder())
    knowledge.set_docs(app_info_chunks(app_dir / "src" / "i18n.js")
                       + markdown_chunks(app_dir / "docs" / "MAP-DATA-AND-API.md", "map data documentation"))
    ring = load_ring(app_dir / "src" / "vauban.js")
    if hotspots is None:
        hotspots = Hotspots.from_supabase(settings.supabase_url, settings.supabase_anon_key, settings.hotspot_ttl_s)
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    geocode = nominatim({"w": min(xs), "s": min(ys), "e": max(xs), "n": max(ys)},
                        "vauban-map-agent (JUNIA student project)") if settings.use_nominatim else None
    return Context(load_layers(settings.data_dir), hotspots, knowledge,
                   load_categories(app_dir / "src" / "i18n.js"), ring, geocode)


MESSAGES = {
    "fr": {"minute": "Doucement ! Attends une minute avant de poser une autre question.",
           "day": "Tu as atteint la limite de questions pour aujourd’hui. Reviens demain !",
           "budget": "L’assistant a atteint sa limite du jour. Reviens demain !",
           "llm": "L’assistant ne répond pas pour le moment. Réessaie dans un instant."},
    "en": {"minute": "Easy! Wait a minute before asking another question.",
           "day": "You have reached today’s question limit. Come back tomorrow!",
           "budget": "The assistant has reached its limit for today. Come back tomorrow!",
           "llm": "The assistant is not answering right now. Try again in a moment."},
}


def create_app(settings: Settings | None = None, model=None, embedder=None, hotspots: Hotspots | None = None) -> FastAPI:
    settings = settings or Settings()
    if model is None and settings.mistral_api_key:
        model = MistralClient(settings.mistral_api_key, settings.chat_model, settings.embed_model,
                              min_interval_s=settings.min_interval_s)
        embedder = embedder or model
    ctx = build_context(settings, embedder, hotspots)
    limiter = RateLimiter(settings.rate_per_minute, settings.rate_per_day, settings.daily_budget)
    lock = threading.Lock()   # one Context per process: answer one question at a time

    app = FastAPI(title="Vauban map assistant", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins),
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.get("/api/health")
    def health():
        return {"ok": True, "llm": model is not None}

    @app.post("/api/chat")
    def chat(body: ChatIn, request: Request):
        lang = body.lang if body.lang in MESSAGES else "fr"
        if model is None:
            raise HTTPException(503, "The assistant is not configured (no MISTRAL_API_KEY).")
        fwd = request.headers.get("x-forwarded-for", "")
        who = fwd.split(",")[0].strip() or (request.client.host if request.client else "?")
        blocked = limiter.check(who)
        if blocked:
            raise HTTPException(429, MESSAGES[lang][blocked])
        t0 = time.time()
        try:
            with lock:
                ans = agent.run(model, ctx, body.message.strip(), [t.model_dump() for t in body.history],
                                lang, settings.max_steps)
        except LLMError:
            log.exception("LLM call failed")
            raise HTTPException(502, MESSAGES[lang]["llm"])
        log.info("answered in %.1fs with %d tool calls", time.time() - t0, len(ans.steps))
        return {"answer": ans.text, "highlights": ans.highlights, "sources": ans.sources,
                "steps": [asdict(s) for s in ans.steps]}

    return app


def __getattr__(name):   # lazy, so importing this module in tests does not need a key or the network
    if name == "app":
        return create_app()
    raise AttributeError(name)
