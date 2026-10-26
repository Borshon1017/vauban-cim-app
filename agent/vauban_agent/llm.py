"""Mistral API client: chat with tool calling, and embeddings. No GPU here; the model runs on Mistral's side."""
import time

import httpx
import numpy as np

API = "https://api.mistral.ai/v1"


class LLMError(RuntimeError):
    pass


class MistralClient:
    def __init__(self, api_key: str, chat_model: str, embed_model: str, timeout: float = 45, min_interval_s: float = 0):
        self.chat_model, self.embed_model = chat_model, embed_model
        self._http = httpx.Client(base_url=API, timeout=timeout, headers={"Authorization": f"Bearer {api_key}"})
        # the free plan allows about one request every 2 s on some models: space calls out instead of hitting 429s
        self._min_interval, self._last = min_interval_s, 0.0

    def _post(self, path: str, body: dict) -> dict:
        for attempt in range(4):
            wait = self._min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            r = self._http.post(path, json=body)
            if r.status_code == 429 or r.status_code >= 500:   # rate limited or hiccup: back off and retry
                time.sleep(2.0 * (attempt + 1))
                continue
            if r.status_code >= 400:
                raise LLMError(f"Mistral {r.status_code}: {r.text[:300]}")
            return r.json()
        raise LLMError(f"Mistral unavailable ({r.status_code})")

    def chat(self, messages: list[dict], tools: list[dict] | None = None, tool_choice: str = "auto") -> dict:
        """Returns the assistant message: {"role", "content", "tool_calls"?}."""
        body = {"model": self.chat_model, "messages": messages, "temperature": 0.2}
        if tools:
            body["tools"], body["tool_choice"] = tools, tool_choice
        return self._post("/chat/completions", body)["choices"][0]["message"]

    def embed(self, texts: list[str]) -> np.ndarray:
        out = []
        for i in range(0, len(texts), 64):
            data = self._post("/embeddings", {"model": self.embed_model, "input": texts[i:i + 64]})["data"]
            out.extend(d["embedding"] for d in sorted(data, key=lambda d: d["index"]))
        return np.asarray(out, dtype=np.float32)
