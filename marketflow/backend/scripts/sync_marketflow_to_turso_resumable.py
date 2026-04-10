from __future__ import annotations

import argparse
import itertools
import os
import shutil
import sqlite3
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

BACKEND_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR_STR = str(BACKEND_DIR)
if BACKEND_DIR_STR not in sys.path:
    sys.path.insert(0, BACKEND_DIR_STR)

from services.data_contract import live_db_path


DEFAULT_TURSO_URL = "libsql://marketos-boss9293.aws-us-east-1.turso.io"
MAX_SQL_VARIABLES = 32766
DEFAULT_BATCH_ROWS = 2000
DEFAULT_SYNC_ROWS = 25000


@dataclass(frozen=True)
class TableMeta:
    name: str
    columns: tuple[str, ...]
    row_count: int
    max_rowid: int


@dataclass(frozen=True)
class SourceCatalog:
    tables: list[TableMeta]
    objects: list[tuple[str, str, str, str]]
    sqlite_sequence: list[tuple[str, int]]
    user_version: int
    application_id: int


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def default_source_db() -> Path:
    return live_db_path()


def default_stage_dir() -> Path:
    return (repo_root() / "temp" / "turso-upload").resolve()


def default_stage_db() -> Path:
    return default_stage_dir() / "marketflow-upload.db"


def default_verify_dir() -> Path:
    return (repo_root() / "temp" / "turso-verify").resolve()


def default_verify_db() -> Path:
    return default_verify_dir() / "marketflow-verify.db"


def env_value(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def remove_path(path: Path) -> None:
    if path.exists():
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                path.unlink()
            except FileNotFoundError:
                pass


def remove_sqlite_artifacts(db_path: Path) -> None:
    for suffix in ("", "-wal", "-shm"):
        remove_path(Path(str(db_path) + suffix))


def list_user_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY rowid
        """
    ).fetchall()
    return [str(row[0]) for row in rows]


def list_user_objects(conn: sqlite3.Connection) -> list[tuple[str, str, str, str]]:
    rows = conn.execute(
        """
        SELECT type, name, tbl_name, sql
        FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
          AND sql IS NOT NULL
        ORDER BY
          CASE type
            WHEN 'table' THEN 0
            WHEN 'view' THEN 1
            WHEN 'index' THEN 2
            WHEN 'trigger' THEN 3
            ELSE 4
          END,
          rowid
        """
    ).fetchall()
    return [(str(row[0]), str(row[1]), str(row[2]), str(row[3])) for row in rows]


def table_columns(conn: sqlite3.Connection, table: str) -> tuple[str, ...]:
    rows = conn.execute(f"PRAGMA table_info({quote_ident(table)})").fetchall()
    return tuple(str(row[1]) for row in rows)


def table_row_count(conn: sqlite3.Connection, table: str) -> int:
    value = conn.execute(f"SELECT COUNT(*) FROM {quote_ident(table)}").fetchone()
    return int(value[0] if value else 0)


def table_max_rowid(conn: sqlite3.Connection, table: str) -> int:
    value = conn.execute(
        f"SELECT COALESCE(MAX(rowid), 0) FROM {quote_ident(table)}"
    ).fetchone()
    return int(value[0] if value else 0)


def read_source_catalog(source_db: Path) -> SourceCatalog:
    with sqlite3.connect(str(source_db)) as conn:
        tables: list[TableMeta] = []
        objects = list_user_objects(conn)
        for table_name in list_user_tables(conn):
            tables.append(
                TableMeta(
                    name=table_name,
                    columns=table_columns(conn, table_name),
                    row_count=table_row_count(conn, table_name),
                    max_rowid=table_max_rowid(conn, table_name),
                )
            )

        sqlite_sequence: list[tuple[str, int]] = []
        try:
            sqlite_sequence = [
                (str(row[0]), int(row[1]))
                for row in conn.execute("SELECT name, seq FROM sqlite_sequence").fetchall()
            ]
        except sqlite3.OperationalError:
            pass

        user_version = int(conn.execute("PRAGMA user_version").fetchone()[0] or 0)
        application_id = int(conn.execute("PRAGMA application_id").fetchone()[0] or 0)

    return SourceCatalog(
        tables=tables,
        objects=objects,
        sqlite_sequence=sqlite_sequence,
        user_version=user_version,
        application_id=application_id,
    )


def _try_execute_pragma(conn, pragma_sql: str) -> None:
    try:
        conn.execute(pragma_sql)
    except Exception as exc:
        print(f"[WARN] Skipping unsupported pragma: {pragma_sql} ({exc})", flush=True)


def configure_replica_connection(conn) -> None:
    _try_execute_pragma(conn, "PRAGMA foreign_keys = OFF")
    _try_execute_pragma(conn, "PRAGMA synchronous = OFF")
    _try_execute_pragma(conn, "PRAGMA temp_store = MEMORY")
    _try_execute_pragma(conn, "PRAGMA cache_size = -200000")
    _try_execute_pragma(conn, "PRAGMA busy_timeout = 5000")
    _try_execute_pragma(conn, "PRAGMA journal_mode = OFF")


def open_turso_replica(replica_path: Path, turso_url: str, auth_token: str):
    try:
        import libsql
    except ImportError as exc:
        raise RuntimeError(
            "Missing dependency: libsql. Install it first with `pip install -r marketflow/backend/requirements.txt`."
        ) from exc

    if not os.environ.get("SSL_CERT_FILE"):
        try:
            import certifi

            os.environ["SSL_CERT_FILE"] = certifi.where()
        except Exception:
            pass

    conn = libsql.connect(str(replica_path), sync_url=turso_url, auth_token=auth_token)
    configure_replica_connection(conn)
    return conn


def drop_existing_user_objects(conn) -> None:
    current_objects = list_user_objects(conn)
    for object_type in ("trigger", "index", "view", "table"):
        for typ, name, _, _ in current_objects:
            if typ != object_type:
                continue
            print(f"[DROP] {typ} {name}", flush=True)
            conn.execute(f"DROP {typ.upper()} IF EXISTS {quote_ident(name)}")


def object_exists(conn, object_type: str, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?",
        (object_type, name),
    ).fetchone()
    return row is not None


def transaction(conn, statements: Sequence[tuple[str, tuple | list | None]]) -> None:
    conn.execute("BEGIN IMMEDIATE")
    try:
        for sql, params in statements:
            if params is None:
                conn.execute(sql)
            else:
                conn.execute(sql, params)
        conn.execute("COMMIT")
    except Exception:
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        raise


def sync_replica(
    replica_conn,
    replica_path: Path,
    turso_url: str,
    auth_token: str,
    label: str,
    retries: int = 3,
):
    last_exc: Exception | None = None
    conn = replica_conn
    for attempt in range(1, retries + 1):
        try:
            print(f"[SYNC] {label} (attempt {attempt})", flush=True)
            if hasattr(conn, "sync"):
                conn.sync()
            print(f"[OK] {label}", flush=True)
            return conn
        except Exception as exc:
            last_exc = exc
            print(f"[WARN] Sync failed for {label}: {exc}", flush=True)
            try:
                conn.close()
            except Exception:
                pass
            if attempt < retries:
                time.sleep(min(10, attempt * 2))
                conn = open_turso_replica(replica_path, turso_url, auth_token)
    assert last_exc is not None
    raise last_exc


def ensure_schema(replica_conn, catalog: SourceCatalog, replica_path: Path, turso_url: str, auth_token: str):
    tables = [obj for obj in catalog.objects if obj[0] == "table"]
    views = [obj for obj in catalog.objects if obj[0] == "view"]

    missing_tables = [obj for obj in tables if not object_exists(replica_conn, "table", obj[1])]
    if missing_tables:
        print(f"[BUILD] Creating {len(missing_tables)} tables...", flush=True)
        stmts = []
        for _, name, _, sql in missing_tables:
            print(f"[SCHEMA] table {name}", flush=True)
            stmts.append((sql, None))
        transaction(replica_conn, stmts)
        replica_conn = sync_replica(replica_conn, replica_path, turso_url, auth_token, "schema tables")

    missing_views = [obj for obj in views if not object_exists(replica_conn, "view", obj[1])]
    if missing_views:
        print(f"[BUILD] Creating {len(missing_views)} views...", flush=True)
        stmts = []
        for _, name, _, sql in missing_views:
            print(f"[SCHEMA] view {name}", flush=True)
            stmts.append((sql, None))
        transaction(replica_conn, stmts)
        replica_conn = sync_replica(replica_conn, replica_path, turso_url, auth_token, "schema views")

    return replica_conn


def stage_table_rowid(conn, table: str) -> int:
    value = conn.execute(f"SELECT COALESCE(MAX(rowid), 0) FROM {quote_ident(table)}").fetchone()
    return int(value[0] if value else 0)


def insert_batch(replica_conn, table: str, columns: tuple[str, ...], rows: list[tuple]) -> None:
    if not rows:
        return

    column_sql = ", ".join(quote_ident(column) for column in columns)
    placeholder = "(" + ", ".join(["?"] * len(columns)) + ")"
    sql = (
        f"INSERT INTO main.{quote_ident(table)} ({column_sql}) VALUES "
        + ", ".join([placeholder] * len(rows))
    )
    params = list(itertools.chain.from_iterable(row[1:] for row in rows))
    transaction(replica_conn, [(sql, params)])


def import_table(
    replica_conn,
    source_conn: sqlite3.Connection,
    meta: TableMeta,
    batch_rows: int,
    sync_rows: int,
    replica_path: Path,
    turso_url: str,
    auth_token: str,
):
    if meta.max_rowid == 0:
        print(f"[SKIP] table {meta.name} is empty", flush=True)
        return replica_conn

    resume_rowid = stage_table_rowid(replica_conn, meta.name)
    if resume_rowid > meta.max_rowid:
        raise RuntimeError(
            f"Stage table {meta.name} has rowid {resume_rowid} beyond source max rowid {meta.max_rowid}. "
            "Use --fresh to start over."
        )
    if resume_rowid == meta.max_rowid:
        print(f"[SKIP] table {meta.name} already complete ({meta.row_count} rows)", flush=True)
        return replica_conn

    max_rows_per_stmt = max(1, min(batch_rows, MAX_SQL_VARIABLES // max(1, len(meta.columns))))
    column_sql = ", ".join(quote_ident(column) for column in meta.columns)
    print(
        f"[COPY] table {meta.name} resume_rowid={resume_rowid} source_rows={meta.row_count} "
        f"batch={max_rows_per_stmt} sync_every={sync_rows}",
        flush=True,
    )

    imported = 0
    rows_since_sync = 0
    while True:
        rows = source_conn.execute(
            f"SELECT rowid, {column_sql} FROM {quote_ident(meta.name)} "
            "WHERE rowid > ? ORDER BY rowid LIMIT ?",
            (resume_rowid, max_rows_per_stmt),
        ).fetchall()
        if not rows:
            break

        insert_batch(replica_conn, meta.name, meta.columns, rows)
        resume_rowid = int(rows[-1][0])
        imported += len(rows)
        rows_since_sync += len(rows)

        if rows_since_sync >= sync_rows:
            print(f"[COPY] table {meta.name}: {imported} rows", flush=True)
            replica_conn = sync_replica(
                replica_conn,
                replica_path,
                turso_url,
                auth_token,
                f"table {meta.name} ({imported} rows)",
            )
            rows_since_sync = 0

    if imported and rows_since_sync > 0:
        print(f"[COPY] table {meta.name}: {imported} rows", flush=True)
        replica_conn = sync_replica(
            replica_conn,
            replica_path,
            turso_url,
            auth_token,
            f"table {meta.name} final ({imported} rows)",
        )

    if resume_rowid != meta.max_rowid:
        raise RuntimeError(
            f"Table {meta.name} stopped at rowid {resume_rowid}, expected {meta.max_rowid}. "
            "The stage DB looks incomplete."
        )

    print(f"[DONE] table {meta.name}: {imported} rows", flush=True)
    return replica_conn


def create_missing_objects(
    replica_conn,
    objects: list[tuple[str, str, str, str]],
    object_type: str,
    replica_path: Path,
    turso_url: str,
    auth_token: str,
):
    missing = [obj for obj in objects if not object_exists(replica_conn, object_type, obj[1])]
    if not missing:
        return replica_conn

    print(f"[BUILD] Creating {len(missing)} {object_type}s...", flush=True)
    stmts = []
    for _, name, _, sql in missing:
        print(f"[{object_type.upper()}] {name}", flush=True)
        stmts.append((sql, None))
    transaction(replica_conn, stmts)
    replica_conn = sync_replica(
        replica_conn,
        replica_path,
        turso_url,
        auth_token,
        f"{object_type}s",
    )
    return replica_conn


def sync_metadata(replica_conn, catalog: SourceCatalog, replica_path: Path, turso_url: str, auth_token: str):
    if catalog.sqlite_sequence:
        print("[SEQ] Updating sqlite_sequence", flush=True)
        stmts: list[tuple[str, tuple | list | None]] = [("DELETE FROM sqlite_sequence", None)]
        for seq_name, seq_value in catalog.sqlite_sequence:
            stmts.append(
                (
                    "INSERT INTO sqlite_sequence(name, seq) VALUES (?, ?)",
                    (seq_name, int(seq_value)),
                )
            )
        try:
            transaction(replica_conn, stmts)
        except sqlite3.OperationalError:
            pass
        else:
            replica_conn = sync_replica(replica_conn, replica_path, turso_url, auth_token, "sqlite_sequence")

    print("[META] Applying PRAGMAs", flush=True)
    transaction(
        replica_conn,
        [
            (f"PRAGMA user_version = {catalog.user_version}", None),
            (f"PRAGMA application_id = {catalog.application_id}", None),
        ],
    )
    replica_conn = sync_replica(replica_conn, replica_path, turso_url, auth_token, "metadata")
    return replica_conn


def finalize_replica(replica_conn, catalog: SourceCatalog, replica_path: Path, turso_url: str, auth_token: str):
    indexes = [obj for obj in catalog.objects if obj[0] == "index"]
    triggers = [obj for obj in catalog.objects if obj[0] == "trigger"]

    replica_conn = create_missing_objects(replica_conn, indexes, "index", replica_path, turso_url, auth_token)
    replica_conn = create_missing_objects(replica_conn, triggers, "trigger", replica_path, turso_url, auth_token)
    replica_conn = sync_metadata(replica_conn, catalog, replica_path, turso_url, auth_token)
    return replica_conn


def verify_table_counts(source_db: Path, target_conn) -> list[tuple[str, int, int]]:
    mismatches: list[tuple[str, int, int]] = []
    with sqlite3.connect(str(source_db)) as source_conn:
        source_tables = list_user_tables(source_conn)
        target_tables = list_user_tables(target_conn)

        if source_tables != target_tables:
            missing = [t for t in source_tables if t not in target_tables]
            extra = [t for t in target_tables if t not in source_tables]
            message = []
            if missing:
                message.append(f"missing={missing}")
            if extra:
                message.append(f"extra={extra}")
            raise RuntimeError("Target table set does not match source table set: " + ", ".join(message))

        for table in source_tables:
            src_count = table_row_count(source_conn, table)
            dst_count = table_row_count(target_conn, table)
            if src_count != dst_count:
                mismatches.append((table, src_count, dst_count))

    return mismatches


def cleanup_stage(stage_dir: Path) -> None:
    if stage_dir.exists():
        shutil.rmtree(stage_dir, ignore_errors=True)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Upload local marketflow.db into a Turso database.")
    parser.add_argument(
        "--source-db",
        default=str(default_source_db()),
        help="Path to the local live SQLite file (default: repo data/marketflow.db).",
    )
    parser.add_argument(
        "--stage-db",
        default=str(default_stage_db()),
        help="Path to the persistent local staging replica used for resumable uploads.",
    )
    parser.add_argument(
        "--turso-url",
        default=env_value("TURSO_DATABASE_URL", "LIBSQL_URL", "TURSO_URL") or DEFAULT_TURSO_URL,
        help="Turso database URL, e.g. libsql://<db>-<org>.turso.io",
    )
    parser.add_argument(
        "--auth-token",
        default=env_value("TURSO_AUTH_TOKEN", "LIBSQL_AUTH_TOKEN", "TURSO_TOKEN"),
        help="Turso auth token.",
    )
    parser.add_argument(
        "--batch-rows",
        type=int,
        default=DEFAULT_BATCH_ROWS,
        help="Maximum rows per INSERT statement batch.",
    )
    parser.add_argument(
        "--sync-rows",
        type=int,
        default=DEFAULT_SYNC_ROWS,
        help="Rows to commit locally before forcing a Turso sync.",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Drop existing remote user objects and start the upload from scratch.",
    )
    parser.add_argument(
        "--no-verify",
        action="store_true",
        help="Skip post-upload row-count verification against a fresh Turso replica.",
    )
    args = parser.parse_args(argv)

    source_db = Path(args.source_db).expanduser().resolve()
    stage_db = Path(args.stage_db).expanduser().resolve()

    if not source_db.exists():
        print(f"[ERROR] Source DB not found: {source_db}", file=sys.stderr)
        return 1

    turso_url = args.turso_url.strip()
    if not turso_url:
        print("[ERROR] Missing Turso URL. Set TURSO_DATABASE_URL or pass --turso-url.", file=sys.stderr)
        return 1

    auth_token = args.auth_token.strip()
    if not auth_token:
        print("[ERROR] Missing Turso auth token. Set TURSO_AUTH_TOKEN or pass --auth-token.", file=sys.stderr)
        return 1

    try:
        catalog = read_source_catalog(source_db)
        if not catalog.tables:
            print(f"[WARN] No user tables found in {source_db}. Nothing to upload.")
            return 0

        ensure_parent_dir(stage_db)

        print(f"[INFO] Source DB: {source_db}", flush=True)
        print(f"[INFO] Stage DB:  {stage_db}", flush=True)
        print(f"[INFO] Tables:    {len(catalog.tables)}", flush=True)

        source_conn = sqlite3.connect(str(source_db))
        try:
            replica_conn = open_turso_replica(stage_db, turso_url, auth_token)
            try:
                if args.fresh:
                    print("[RESET] Dropping existing remote objects...", flush=True)
                    drop_existing_user_objects(replica_conn)
                replica_conn = ensure_schema(replica_conn, catalog, stage_db, turso_url, auth_token)
                for meta in catalog.tables:
                    replica_conn = import_table(
                        replica_conn,
                        source_conn,
                        meta,
                        args.batch_rows,
                        args.sync_rows,
                        stage_db,
                        turso_url,
                        auth_token,
                    )

                replica_conn = finalize_replica(replica_conn, catalog, stage_db, turso_url, auth_token)
                replica_conn = sync_replica(replica_conn, stage_db, turso_url, auth_token, "final sync")
                print("[OK] Turso sync complete.", flush=True)
            finally:
                try:
                    replica_conn.close()
                except Exception:
                    pass
        finally:
            source_conn.close()

        if args.no_verify:
            return 0

        verify_dir = default_verify_dir()
        verify_db = default_verify_db()
        cleanup_stage(verify_dir)
        ensure_parent_dir(verify_db)
        try:
            print("[VERIFY] Opening fresh libSQL replica...", flush=True)
            verify_conn = open_turso_replica(verify_db, turso_url, auth_token)
            try:
                print("[VERIFY] Pulling back a fresh Turso snapshot...", flush=True)
                verify_conn = sync_replica(verify_conn, verify_db, turso_url, auth_token, "verify sync")
                mismatches = verify_table_counts(source_db, verify_conn)
                if mismatches:
                    print("[ERROR] Row-count mismatch after Turso sync:", file=sys.stderr)
                    for table, src_count, dst_count in mismatches:
                        print(f" - {table}: source={src_count} target={dst_count}", file=sys.stderr)
                    return 1

                print(f"[OK] Verified {len(catalog.tables)} tables against Turso.", flush=True)
                return 0
            finally:
                try:
                    verify_conn.close()
                except Exception:
                    pass
        finally:
            cleanup_stage(verify_dir)
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
