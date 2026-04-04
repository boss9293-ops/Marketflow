from __future__ import annotations

from pathlib import Path
from typing import Dict


_CACHE: Dict[str, str] = {}
_FILE_DIR = Path(__file__).resolve().parent
_MARKETFLOW_ROOT = _FILE_DIR.parents[1]
_REPO_ROOT = _FILE_DIR.parents[2]
_PROMPTS_ROOT = _MARKETFLOW_ROOT / "prompts"


def _candidate_paths(path: str) -> list[Path]:
    raw = Path(path)
    if raw.is_absolute():
        return [raw]

    return [
        Path.cwd() / raw,
        _REPO_ROOT / raw,
        _MARKETFLOW_ROOT / raw,
        _PROMPTS_ROOT / raw,
    ]


def _resolve_prompt_path(path: str) -> Path:
    for candidate in _candidate_paths(path):
        if candidate.exists():
            return candidate.resolve()
    raise FileNotFoundError(f"Prompt file not found: {path}")


def load_prompt(path: str) -> str:
    resolved = _resolve_prompt_path(path)
    cache_key = str(resolved)

    if cache_key in _CACHE:
        return _CACHE[cache_key]

    content = resolved.read_text(encoding="utf-8")
    _CACHE[cache_key] = content
    return content


def get_engine_knowledge() -> Dict[str, str]:
    return {
        "transmission_map": load_prompt("marketflow/prompts/engine_knowledge/transmission/transmission_map.md"),
        "track_b_velocity": load_prompt("marketflow/prompts/engine_knowledge/tracks/track_b_velocity.md"),
        "track_a_credit": load_prompt("marketflow/prompts/engine_knowledge/tracks/track_a_credit.md"),
        "track_c_event": load_prompt("marketflow/prompts/engine_knowledge/tracks/track_c_event.md"),
        "mss_engine": load_prompt("marketflow/prompts/engine_knowledge/core/mss_engine.md"),
    }


def get_narrative_templates() -> Dict[str, str]:
    return {
        "briefing_v1": load_prompt("marketflow/prompts/engine_narrative/briefing_v1.md"),
        "watchlist_v1": load_prompt("marketflow/prompts/engine_narrative/watchlist_v1.md"),
        "portfolio_v1": load_prompt("marketflow/prompts/engine_narrative/portfolio_v1.md"),
    }
