from __future__ import annotations

from pathlib import Path
from typing import Dict


_CACHE: Dict[str, str] = {}
_FILE_DIR = Path(__file__).resolve().parent


def _prompt_root_candidates() -> list[Path]:
    roots: list[Path] = []
    seen: set[str] = set()
    for base in (
        Path.cwd(),
        _FILE_DIR.parent,
        _FILE_DIR.parents[1] if len(_FILE_DIR.parents) > 1 else None,
        _FILE_DIR.parents[2] if len(_FILE_DIR.parents) > 2 else None,
    ):
        if base is None:
            continue
        candidate = (base / "prompts").resolve()
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        roots.append(candidate)
    return roots


def _candidate_paths(path: str) -> list[Path]:
    raw = Path(path)
    if raw.is_absolute():
        return [raw]

    text = str(raw).replace("\\", "/").strip("/")
    variants = [raw]

    if text.startswith("marketflow/prompts/"):
        variants.append(Path(text.removeprefix("marketflow/prompts/")))
    if text.startswith("marketflow/"):
        variants.append(Path(text.removeprefix("marketflow/")))
    if text.startswith("prompts/"):
        variants.append(Path(text.removeprefix("prompts/")))

    roots = _prompt_root_candidates()
    candidates: list[Path] = []
    seen: set[str] = set()
    for variant in variants:
        for root in roots:
            candidate = (root / variant).resolve()
            key = str(candidate)
            if key not in seen:
                seen.add(key)
                candidates.append(candidate)
    return candidates


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
        "transmission_map": load_prompt("engine_knowledge/transmission/transmission_map.md"),
        "track_b_velocity": load_prompt("engine_knowledge/tracks/track_b_velocity.md"),
        "track_a_credit": load_prompt("engine_knowledge/tracks/track_a_credit.md"),
        "track_c_event": load_prompt("engine_knowledge/tracks/track_c_event.md"),
        "mss_engine": load_prompt("engine_knowledge/core/mss_engine.md"),
    }


def get_narrative_templates() -> Dict[str, str]:
    return {
        "briefing_v1": load_prompt("engine_narrative/briefing_v1.md"),
        "watchlist_v1": load_prompt("engine_narrative/watchlist_v1.md"),
        "portfolio_v1": load_prompt("engine_narrative/portfolio_v1.md"),
        "account_manager_v1": load_prompt("engine_narrative/account_manager_v1.md"),
    }
