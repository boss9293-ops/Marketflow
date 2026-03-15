from enum import Enum
import os


class AIProvider(str, Enum):
    GPT = "gpt"
    GEMINI = "gemini"


DEFAULT_GPT_MODEL = "gpt-4o-mini"
DEFAULT_GEMINI_MODEL = "gemini-1.5-flash-latest"
DEFAULT_TIMEOUT_SEC = 30
DEFAULT_RETRY = 2


def _as_int(value: str, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def get_timeout_sec() -> int:
    return max(1, _as_int(os.getenv("TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)), DEFAULT_TIMEOUT_SEC))


def get_retry_count() -> int:
    return max(0, _as_int(os.getenv("RETRY", str(DEFAULT_RETRY)), DEFAULT_RETRY))


def get_model(provider: AIProvider) -> str:
    if provider == AIProvider.GPT:
        return os.getenv("GPT_MODEL", DEFAULT_GPT_MODEL).strip() or DEFAULT_GPT_MODEL
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    return model if model.startswith("models/") else f"models/{model}"


def get_api_key(provider: AIProvider) -> str:
    if provider == AIProvider.GPT:
        key = (os.getenv("GPT_API_KEY", "").strip() or os.getenv("OPENAI_API_KEY", "").strip())
        if not key:
            raise RuntimeError(
                "Missing GPT API key. Set GPT_API_KEY (or OPENAI_API_KEY) in your environment."
            )
        return key

    key = (os.getenv("GEMINI_API_KEY", "").strip() or os.getenv("GOOGLE_API_KEY", "").strip())
    if not key:
        raise RuntimeError(
            "Missing Gemini API key. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your environment."
        )
    return key
