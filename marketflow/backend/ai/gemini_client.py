import time
from typing import Any, Dict, List

import requests

from .ai_types import AIResult
from .logger import log_call, sanitize_error
from .providers import AIProvider, get_api_key, get_model, get_retry_count, get_timeout_sec


GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


def _extract_text(data: Dict[str, Any]) -> str:
    try:
        candidates = data.get("candidates") or []
        if not candidates:
            return ""
        content = (candidates[0] or {}).get("content") or {}
        parts: List[Dict[str, Any]] = content.get("parts") or []
        lines: List[str] = []
        for part in parts:
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                lines.append(text.strip())
        return "\n".join(lines).strip()
    except Exception:
        return ""


def _model_candidates(model: str) -> List[str]:
    candidates: List[str] = [model]
    if model.startswith("models/"):
        base = model.split("models/", 1)[1]
    else:
        base = model
    if base and not base.endswith("-latest"):
        candidates.append(f"models/{base}-latest")
    candidates.extend(["models/gemini-2.0-flash", "models/gemini-2.5-flash"])
    # Deduplicate while preserving order.
    return list(dict.fromkeys(candidates))


def generate_text(
    task: str,
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
    max_tokens: int = 800,
) -> AIResult:
    provider = AIProvider.GEMINI.value
    model = get_model(AIProvider.GEMINI)
    api_key = get_api_key(AIProvider.GEMINI)
    timeout_sec = get_timeout_sec()
    retry = get_retry_count()

    start = time.perf_counter()
    last_error = ""
    selected_model = model

    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": float(temperature), "maxOutputTokens": int(max_tokens)},
    }

    for candidate in _model_candidates(model):
        selected_model = candidate
        url = f"{GEMINI_BASE_URL}/{candidate}:generateContent?key={api_key}"

        for attempt in range(retry + 1):
            try:
                response = requests.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json=payload,
                    timeout=timeout_sec,
                )
                if response.status_code == 404:
                    last_error = sanitize_error(f"404 model not found for {candidate}")
                    break
                response.raise_for_status()
                data = response.json()
                text = _extract_text(data)
                latency_ms = int((time.perf_counter() - start) * 1000)
                log_call(provider=provider, model=candidate, task=task, latency_ms=latency_ms, ok=True)
                return AIResult(
                    provider=provider,
                    model=candidate,
                    text=text,
                    usage=data.get("usageMetadata"),
                    latency_ms=latency_ms,
                    raw=data,
                    cached=False,
                )
            except Exception as exc:
                last_error = sanitize_error(str(exc))
                if attempt >= retry:
                    break

    latency_ms = int((time.perf_counter() - start) * 1000)
    log_call(provider=provider, model=selected_model, task=task, latency_ms=latency_ms, ok=False, error=last_error)
    return AIResult(
        provider=provider,
        model=selected_model,
        text="",
        usage=None,
        latency_ms=latency_ms,
        error=last_error or "Unknown Gemini error",
        raw=None,
        cached=False,
    )
