from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from services.data_contract import backend_dir, live_db_path, now_iso

GOOGLE_SA_KEY = "google_service_account_json"
GOOGLE_SA_FILE_PATH = (backend_dir() / "config" / "google_sa.json").resolve()


def _connect() -> sqlite3.Connection:
    db_path = Path(live_db_path())
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_kv (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_app_kv_updated_at ON app_kv(updated_at);")


def _read_db_value(conn: sqlite3.Connection, key: str) -> str:
    ensure_schema(conn)
    row = conn.execute("SELECT value FROM app_kv WHERE key = ?", (key,)).fetchone()
    if not row:
        return ""
    value = row["value"] if isinstance(row, sqlite3.Row) else row[0]
    return str(value or "").strip()


def _write_db_value(conn: sqlite3.Connection, key: str, value: str) -> None:
    ensure_schema(conn)
    conn.execute(
        """
        INSERT INTO app_kv(key, value, updated_at)
        VALUES(?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at;
        """,
        (key, value, now_iso()),
    )
    conn.commit()


def _delete_db_value(conn: sqlite3.Connection, key: str) -> None:
    ensure_schema(conn)
    conn.execute("DELETE FROM app_kv WHERE key = ?", (key,))
    conn.commit()


def _read_file_value(path: Path | None = None) -> str:
    target = path or GOOGLE_SA_FILE_PATH
    try:
        if not target.exists():
            return ""
        return target.read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def _write_file_value(value: str, path: Path | None = None) -> None:
    target = path or GOOGLE_SA_FILE_PATH
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value, encoding="utf-8")
    except Exception:
        pass


def _delete_file_value(path: Path | None = None) -> None:
    target = path or GOOGLE_SA_FILE_PATH
    try:
        if target.exists():
            target.unlink()
    except Exception:
        pass


def resolve_google_service_account_json(*, include_file_fallback: bool = True) -> tuple[str, str]:
    env_value = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if env_value:
        return env_value, "env"

    try:
        with _connect() as conn:
            db_value = _read_db_value(conn, GOOGLE_SA_KEY)
            if db_value:
                return db_value, "db"
    except Exception:
        pass

    if include_file_fallback:
        file_value = _read_file_value()
        if file_value:
            return file_value, "file"

    return "", "none"


def get_google_service_account_json() -> str:
    value, _ = resolve_google_service_account_json()
    return value


def save_google_service_account_json(value: str) -> None:
    normalized = value.strip()
    if not normalized:
        raise ValueError("service account JSON is empty")

    try:
        parsed = json.loads(normalized)
        if not isinstance(parsed, dict):
            raise ValueError("service account JSON must be an object")
        if parsed.get("type") != "service_account":
            raise ValueError('service account JSON must have type="service_account"')
        canonical = json.dumps(parsed, ensure_ascii=False, indent=2)
    except Exception as exc:
        raise ValueError(str(exc)) from exc

    with _connect() as conn:
        _write_db_value(conn, GOOGLE_SA_KEY, canonical)
    _write_file_value(canonical)


def delete_google_service_account_json() -> None:
    try:
        with _connect() as conn:
            _delete_db_value(conn, GOOGLE_SA_KEY)
    except Exception:
        pass
    _delete_file_value()


def get_google_service_account_status() -> tuple[bool, str]:
    value, source = resolve_google_service_account_json()
    return bool(value), source
