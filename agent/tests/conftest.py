"""Shared test setup: real map layers and app texts, saved demo hotspots, no network, no API key."""
import json
from pathlib import Path

import pytest

from vauban_agent.api import build_context
from vauban_agent.config import REPO_DIR, Settings
from vauban_agent.data import Hotspots
from vauban_agent.knowledge import HashEmbedder

FIXTURES = Path(__file__).parent / "fixtures"


def make_settings(**kw) -> Settings:
    base = dict(mistral_api_key="", supabase_url="", supabase_anon_key="", data_dir=REPO_DIR / "public" / "data",
                app_dir=REPO_DIR, allowed_origins=("http://localhost:5173",), rate_per_minute=6, rate_per_day=60,
                daily_budget=2000, min_interval_s=0, max_steps=6, hotspot_ttl_s=60, use_nominatim=False)
    base.update(kw)
    return Settings(**base)


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def ctx(settings):
    return build_context(settings, HashEmbedder(), Hotspots.from_files(FIXTURES))


class ScriptedModel:
    """Plays the LLM: returns the scripted messages in order and records what it was sent."""

    def __init__(self, *script):
        self.script, self.sent = list(script), []

    def chat(self, messages, tools=None, tool_choice="auto"):
        self.sent.append({"messages": [dict(m) for m in messages], "tool_choice": tool_choice})
        return self.script.pop(0) if self.script else {"role": "assistant", "content": "done"}


def call(name: str, args: dict, id_: str = "call00001") -> dict:
    return {"id": id_, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def tool_msg(*calls) -> dict:
    return {"role": "assistant", "content": "", "tool_calls": list(calls)}


def say(text: str) -> dict:
    return {"role": "assistant", "content": text}
