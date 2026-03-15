import time
from typing import Any, Dict

import requests

from .ai_types import AIResult
from .logger import log_call, sanitize_error
from .providers import AIProvider, get_api_key, get_model, get_retry_count, get_timeout_sec


OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"


def _extract_text(data: Dict[str, Any]) -> str:
    try:
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        content = message.get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    parts.append(item["text"])
            return "\n".join(parts).strip()
    except Exception:
        pass
    return ""


def generate_text(
    task: str,
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
    max_tokens: int = 800,
) -> AIResult:
    provider = AIProvider.GPT.value
    model = get_model(AIProvider.GPT)
    api_key = get_api_key(AIProvider.GPT)
    timeout_sec = get_timeout_sec()
    retry = get_retry_count()

    start = time.perf_counter()
    last_error = ""

    for attempt in range(retry + 1):
        try:
            response = requests.post(
                OPENAI_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": float(temperature),
                    "max_tokens": int(max_tokens),
                },
                timeout=timeout_sec,
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
            last_error = sanitize_error(str(exc))
            if attempt >= retry:
                break

    latency_ms = int((time.perf_counter() - start) * 1000)
    log_call(provider=provider, model=model, task=task, latency_ms=latency_ms, ok=False, error=last_error)
    return AIResult(
        provider=provider,
        model=model,
        text="",
        usage=None,
        latency_ms=latency_ms,
        error=last_error or "Unknown GPT error",
        raw=None,
        cached=False,
    )
