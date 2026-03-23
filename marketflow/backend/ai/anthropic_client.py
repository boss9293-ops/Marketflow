"""
Claude (Anthropic) client — mirrors gpt_client.py pattern.
Uses Anthropic Messages API via requests (no SDK dependency).
"""
import time
import json
from typing import Any, Dict

import requests

from .ai_types import AIResult
from .logger import log_call, sanitize_error
from .providers import AIProvider, get_api_key, get_model, get_retry_count, get_timeout_sec

ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION      = "2023-06-01"


def _extract_text(data: Dict[str, Any]) -> str:
    try:
        content = data.get("content") or []
        parts = [block["text"] for block in content if block.get("type") == "text"]
        return "\n".join(parts).strip()
    except Exception:
        return ""


def generate_text(
    task: str,
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
    max_tokens: int = 1200,
) -> AIResult:
    provider  = AIProvider.CLAUDE.value
    model     = get_model(AIProvider.CLAUDE)
    api_key   = get_api_key(AIProvider.CLAUDE)
    timeout   = get_timeout_sec()
    retry     = get_retry_count()

    start = time.perf_counter()
    last_error = ""

    for attempt in range(retry + 1):
        try:
            response = requests.post(
                ANTHROPIC_MESSAGES_URL,
                headers={
                    "x-api-key":         api_key,
                    "anthropic-version": ANTHROPIC_VERSION,
                    "content-type":      "application/json",
                },
                json={
                    "model":      model,
                    "max_tokens": int(max_tokens),
                    "temperature": float(temperature),
                    "system":     system,
                    "messages":   [{"role": "user", "content": user}],
                },
                timeout=timeout,
            )
            response.raise_for_status()
            data = response.json()
            text = _extract_text(data)
            latency_ms = int((time.perf_counter() - start) * 1000)
            log_call(provider=provider, model=model, task=task, latency_ms=latency_ms, ok=True)
            return AIResult(
                provider=provider,
                model=model,
                text=text,
                usage=data.get("usage"),
                latency_ms=latency_ms,
                raw=data,
                cached=False,
            )
        except Exception as exc:
            last_error = sanitize_error(exc)
            if attempt < retry:
                time.sleep(1.5 ** attempt)

    latency_ms = int((time.perf_counter() - start) * 1000)
    log_call(provider=provider, model=model, task=task, latency_ms=latency_ms, ok=False, error=last_error)
    return AIResult(
        provider=provider,
        model=model,
        text="",
        latency_ms=latency_ms,
        error=last_error,
    )
