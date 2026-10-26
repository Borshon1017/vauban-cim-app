"""Settings, read from the environment (and agent/.env when running locally)."""
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

AGENT_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = AGENT_DIR.parent
load_dotenv(AGENT_DIR / ".env")


def _int(name: str, default: int) -> int:
    return int(os.getenv(name, default))


@dataclass(frozen=True)
class Settings:
    mistral_api_key: str = field(default_factory=lambda: os.getenv("MISTRAL_API_KEY", ""))
    chat_model: str = field(default_factory=lambda: os.getenv("MISTRAL_MODEL", "ministral-14b-2512"))
    embed_model: str = field(default_factory=lambda: os.getenv("MISTRAL_EMBED_MODEL", "mistral-embed"))
    # the same public values the web app uses: the agent only ever sees what the public map shows
    supabase_url: str = field(default_factory=lambda: os.getenv("SUPABASE_URL", ""))
    supabase_anon_key: str = field(default_factory=lambda: os.getenv("SUPABASE_ANON_KEY", ""))
    # where the map layers, translations and docs are; in Docker they are copied next to the code
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", REPO_DIR / "public" / "data")))
    app_dir: Path = field(default_factory=lambda: Path(os.getenv("APP_DIR", REPO_DIR)))
    allowed_origins: tuple[str, ...] = field(default_factory=lambda: tuple(
        o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()))
    # the endpoint is public and every question costs an LLM call, so it is rate limited
    rate_per_minute: int = field(default_factory=lambda: _int("RATE_PER_MINUTE", 6))
    rate_per_day: int = field(default_factory=lambda: _int("RATE_PER_DAY", 60))
    daily_budget: int = field(default_factory=lambda: _int("DAILY_BUDGET", 2000))  # all visitors together
    min_interval_s: float = field(default_factory=lambda: float(os.getenv("MISTRAL_MIN_INTERVAL_S", "2.1")))
    max_steps: int = field(default_factory=lambda: _int("MAX_STEPS", 6))
    hotspot_ttl_s: int = field(default_factory=lambda: _int("HOTSPOT_TTL_S", 60))
    use_nominatim: bool = field(default_factory=lambda: os.getenv("USE_NOMINATIM", "1") == "1")
