from fastapi.testclient import TestClient

from vauban_agent.api import RateLimiter, create_app
from vauban_agent.data import Hotspots
from vauban_agent.knowledge import HashEmbedder
from conftest import FIXTURES, ScriptedModel, make_settings, say


def client(model=None, **kw):
    app = create_app(make_settings(**kw), model=model, embedder=HashEmbedder(), hotspots=Hotspots.from_files(FIXTURES))
    return TestClient(app)


def test_health():
    assert client().get("/api/health").json() == {"ok": True, "llm": False}


def test_no_key_means_503():
    r = client().post("/api/chat", json={"message": "hi"})
    assert r.status_code == 503


def test_chat_returns_answer_and_highlights():
    r = client(ScriptedModel(say("Hello"))).post("/api/chat", json={"message": "hi", "lang": "en"})
    assert r.status_code == 200
    body = r.json()
    assert body["answer"] == "Hello"
    assert body["highlights"]["type"] == "FeatureCollection"


def test_message_length_is_capped():
    r = client(ScriptedModel()).post("/api/chat", json={"message": "x" * 501})
    assert r.status_code == 422


def test_rate_limit_per_minute_in_the_right_language():
    c = client(ScriptedModel(*[say("ok")] * 5), rate_per_minute=2)
    assert c.post("/api/chat", json={"message": "a"}).status_code == 200
    assert c.post("/api/chat", json={"message": "b"}).status_code == 200
    r = c.post("/api/chat", json={"message": "c", "lang": "en"})
    assert r.status_code == 429 and "Wait a minute" in r.json()["detail"]


def test_cors_only_allows_the_app():
    c = client()
    ok = c.options("/api/chat", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    bad = c.options("/api/chat", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in bad.headers


def test_rate_limiter_day_and_budget():
    rl = RateLimiter(per_minute=100, per_day=3, daily_budget=4)
    t = 1_700_000_000.0
    assert [rl.check("a", t + i * 61) for i in range(4)] == [None, None, None, "day"]
    assert rl.check("b", t + 300) is None          # 4th request overall: still within budget
    assert rl.check("c", t + 301) == "budget"      # budget shared by everyone
