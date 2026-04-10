from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence


CONTRACT_VERSION = "data_contract_v1"
DEFAULT_DATA_MODE = "live"
DEFAULT_SOURCE_PROFILE = "self_hosted"
DEFAULT_SNAPSHOT_NAME = "playback"


DEFAULT_ARTIFACT_KEYS: tuple[str, ...] = (
    "risk_v1.json",
    "risk_v1_playback.json",
    "risk_v1_sim.json",
    "mss_history.json",
    "vr_survival.json",
    "vr_survival_playback.json",
    "current_90d.json",
    "market_tape.json",
    "briefing.json",
    "vr_pattern_dashboard.json",
    "cache/overview.json",
    "cache/snapshots_120d.json",
    "cache/market_state.json",
    "cache/health_snapshot.json",
    "cache/action_snapshot.json",
    "cache/context_news.json",
    "cache/market-headlines-history.json",
    "cache/ticker-news-history-v2-1630.json",
    "cache/context_narrative_cache.json",
    "cache/context_narrative_usage.json",
    "cache/daily_briefing.json",
    "cache/daily_briefing_v3.json",
    "ai/std_risk/latest.json",
    "ai/macro/latest.json",
    "ai/integrated/latest.json",
)


@dataclass(frozen=True)
class DataPaths:
    repo_root: Path
    backend_dir: Path
    data_root: Path
    live_db: Path
    runtime_db: Path
    snapshot_root: Path
    playback_db: Path
    output_root: Path
    cache_root: Path
    manifest_path: Path
    schema_path: Path


def _env_value(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def backend_dir() -> Path:
    return repo_root() / "backend"


def data_root() -> Path:
    return repo_root() / "data"


def output_root() -> Path:
    return backend_dir() / "output"


def cache_root() -> Path:
    return output_root() / "cache"


def snapshot_root() -> Path:
    return backend_dir() / "data" / "snapshots"


def live_db_path() -> Path:
    return (data_root() / "marketflow.db").resolve()


def core_db_path() -> Path:
    return live_db_path()


def engine_db_path() -> Path:
    """Legacy alias for the canonical live DB path."""
    return live_db_path()


def snapshot_db_path(name: str = DEFAULT_SNAPSHOT_NAME) -> Path:
    safe_name = (name or DEFAULT_SNAPSHOT_NAME).strip().replace("\\", "_").replace("/", "_")
    if not safe_name:
        safe_name = DEFAULT_SNAPSHOT_NAME
    return (snapshot_root() / f"{safe_name}.db").resolve()


def schema_path() -> Path:
    return (backend_dir() / "db" / "schema.sql").resolve()


def manifest_path() -> Path:
    return (cache_root() / "data_manifest.json").resolve()


def data_mode() -> str:
    value = _env_value("MARKETFLOW_DATA_MODE")
    return value.lower() if value else DEFAULT_DATA_MODE


def source_profile() -> str:
    value = _env_value(
        "MARKETFLOW_DATA_SOURCE_PROFILE",
        "MARKETFLOW_DATA_PROFILE",
        "MARKETFLOW_SOURCE_PROFILE",
    )
    return value.lower() if value else DEFAULT_SOURCE_PROFILE


def artifact_path(relative_path: str) -> Path:
    rel = str(relative_path).replace("\\", "/").strip("/")
    if not rel:
        return output_root().resolve()
    if rel.startswith("cache/"):
        return (cache_root() / rel[len("cache/") :]).resolve()
    return (output_root() / Path(rel)).resolve()


def data_paths(snapshot_name: str = DEFAULT_SNAPSHOT_NAME) -> DataPaths:
    return DataPaths(
        repo_root=repo_root(),
        backend_dir=backend_dir(),
        data_root=data_root(),
        live_db=live_db_path(),
        runtime_db=engine_db_path(),
        snapshot_root=snapshot_root(),
        playback_db=snapshot_db_path(snapshot_name),
        output_root=output_root(),
        cache_root=cache_root(),
        manifest_path=manifest_path(),
        schema_path=schema_path(),
    )


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _stat_meta(path: Path) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "path": str(path.resolve()) if path.exists() else str(path),
        "exists": path.exists(),
    }
    if not path.exists():
        return meta
    try:
        stat = path.stat()
        meta["size_bytes"] = stat.st_size
        meta["modified_at"] = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        pass
    return meta


def _sha256_file(path: Path) -> str | None:
    if not path.exists() or not path.is_file():
        return None
    digest = hashlib.sha256()
    try:
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except Exception:
        return None


def _load_json(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def summarize_json_artifact(relative_path: str) -> dict[str, Any]:
    path = artifact_path(relative_path)
    summary = _stat_meta(path)
    summary["relative_path"] = relative_path
    payload = _load_json(path)
    if isinstance(payload, dict):
        summary["json_type"] = "dict"
        summary["top_level_keys"] = list(payload.keys())[:30]
        for key in (
            "generated_at",
            "data_version",
            "schema_version",
            "data_date",
            "date",
            "as_of",
            "window_start",
            "window_end",
            "slot",
        ):
            if key in payload and payload.get(key) is not None:
                summary[key] = payload.get(key)
        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
        for key in ("generated_at", "data_version", "schema_version", "data_date", "date", "as_of", "slot"):
            if key not in summary and meta.get(key) is not None:
                summary[key] = meta.get(key)
        if "count" in payload and payload.get("count") is not None:
            summary["count"] = payload.get("count")
        if "trading_days" in payload and payload.get("trading_days") is not None:
            summary["trading_days"] = payload.get("trading_days")
        if "window_start" in payload and payload.get("window_start") is not None:
            summary["window_start"] = payload.get("window_start")
        if "window_end" in payload and payload.get("window_end") is not None:
            summary["window_end"] = payload.get("window_end")
    elif isinstance(payload, list):
        summary["json_type"] = "list"
        summary["count"] = len(payload)
    elif payload is not None:
        summary["json_type"] = type(payload).__name__
    return summary


def summarize_sqlite_db(path: Path, *, sample_tables: int = 40) -> dict[str, Any]:
    summary = _stat_meta(path)
    summary["user_version"] = None
    summary["application_id"] = None
    summary["table_count"] = 0
    summary["tables"] = []
    if not path.exists():
        return summary

    try:
        conn = sqlite3.connect(str(path))
    except Exception as exc:
        summary["error"] = f"{exc.__class__.__name__}: {exc}"
        return summary

    try:
        try:
            summary["user_version"] = int(conn.execute("PRAGMA user_version").fetchone()[0] or 0)
        except Exception:
            summary["user_version"] = None
        try:
            summary["application_id"] = int(conn.execute("PRAGMA application_id").fetchone()[0] or 0)
        except Exception:
            summary["application_id"] = None

        try:
            rows = conn.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                  AND name NOT LIKE 'sqlite_%'
                ORDER BY rowid
                """
            ).fetchall()
            names = [str(row[0]) for row in rows]
            summary["table_count"] = len(names)
            summary["tables"] = names[:sample_tables]
        except Exception as exc:
            summary["error"] = f"{exc.__class__.__name__}: {exc}"
    finally:
        try:
            conn.close()
        except Exception:
            pass
    return summary


def schema_summary() -> dict[str, Any]:
    path = schema_path()
    summary = _stat_meta(path)
    summary["sha256"] = _sha256_file(path)
    return summary


def build_manifest(
    artifact_keys: Sequence[str] | None = None,
    *,
    snapshot_name: str = DEFAULT_SNAPSHOT_NAME,
) -> dict[str, Any]:
    keys = tuple(artifact_keys or DEFAULT_ARTIFACT_KEYS)
    paths = data_paths(snapshot_name=snapshot_name)
    return {
        "manifest_version": CONTRACT_VERSION,
        "generated_at": now_iso(),
        "data_mode": data_mode(),
        "source_profile": source_profile(),
        "paths": {
            "repo_root": str(paths.repo_root),
            "backend_dir": str(paths.backend_dir),
            "data_root": str(paths.data_root),
            "live_db": str(paths.live_db),
            "runtime_db": str(paths.runtime_db),
            "snapshot_root": str(paths.snapshot_root),
            "playback_db": str(paths.playback_db),
            "output_root": str(paths.output_root),
            "cache_root": str(paths.cache_root),
            "manifest_path": str(paths.manifest_path),
        },
        "schema": schema_summary(),
        "databases": {
            "live": summarize_sqlite_db(paths.live_db),
            "runtime": summarize_sqlite_db(paths.runtime_db),
            "playback": summarize_sqlite_db(paths.playback_db),
        },
        "artifacts": {key: summarize_json_artifact(key) for key in keys},
    }


def write_manifest(
    manifest: dict[str, Any] | None = None,
    *,
    path: Path | None = None,
    artifact_keys: Sequence[str] | None = None,
    snapshot_name: str = DEFAULT_SNAPSHOT_NAME,
) -> Path:
    target = path or manifest_path()
    payload = manifest or build_manifest(artifact_keys=artifact_keys, snapshot_name=snapshot_name)
    _ensure_parent(target)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return target


def load_manifest(path: Path | None = None) -> dict[str, Any]:
    target = path or manifest_path()
    payload = _load_json(target)
    return payload if isinstance(payload, dict) else {}


def as_dict(snapshot_name: str = DEFAULT_SNAPSHOT_NAME) -> dict[str, Any]:
    return asdict(data_paths(snapshot_name=snapshot_name))
