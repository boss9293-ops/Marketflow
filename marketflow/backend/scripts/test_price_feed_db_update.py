"""
WO-DATA-01 price feed DB update test.

Reads the normalized JSON produced by test_price_feed_access.py and verifies:
1) Safe insert into a test-only SQLite database
2) Idempotent upsert on a second pass
3) Read-back integrity and duplicate suppression
"""
from __future__ import annotations

import json
import sqlite3
import sys
import traceback
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from db_utils import db_connect


OUTPUT_SUBDIR = "price_feed_test"
NORMALIZED_JSON_NAME = "price_feed_normalized.json"
RAW_JSON_NAME = "price_feed_raw.json"
DB_FILE_NAME = "test_market_data.sqlite"
TABLE_NAME = "test_price_feed_snapshot"

ALLOWED_ASSET_CLASSES = {"index", "commodity", "gold", "stock", "etf"}


def backend_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def output_dir() -> Path:
    return backend_dir() / "output" / OUTPUT_SUBDIR


def db_path() -> Path:
    return backend_dir() / "db" / DB_FILE_NAME


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def dedupe_records(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    deduped: List[Dict[str, Any]] = []
    for record in records:
        key = (record.get("symbol"), record.get("as_of"), record.get("source"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(record)
    return deduped


def init_test_price_db(path: Path) -> sqlite3.Connection:
    ensure_parent_dir(path)
    conn = db_connect(str(path))
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_class TEXT NOT NULL,
            symbol TEXT NOT NULL,
            name TEXT,
            price REAL NOT NULL,
            change_pct REAL,
            source TEXT NOT NULL,
            as_of TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            currency TEXT,
            raw_symbol TEXT,
            validation_status TEXT,
            validation_issues TEXT,
            UNIQUE(symbol, as_of, source)
        )
        """
    )
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_asset_symbol ON {TABLE_NAME}(asset_class, symbol)"
    )
    conn.commit()
    return conn


def count_rows(conn: sqlite3.Connection) -> int:
    row = conn.execute(f"SELECT COUNT(*) FROM {TABLE_NAME}").fetchone()
    return int(row[0]) if row else 0


def count_duplicate_rows(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        f"""
        SELECT COUNT(*) - COUNT(DISTINCT symbol || '|' || as_of || '|' || source)
        FROM {TABLE_NAME}
        """
    ).fetchone()
    return int(row[0]) if row else 0


def upsert_test_price_records(
    conn: sqlite3.Connection,
    records: List[Dict[str, Any]],
    *,
    fetched_at: str,
) -> int:
    sql = f"""
    INSERT INTO {TABLE_NAME} (
        asset_class,
        symbol,
        name,
        price,
        change_pct,
        source,
        as_of,
        fetched_at,
        currency,
        raw_symbol,
        validation_status,
        validation_issues
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, as_of, source) DO UPDATE SET
        asset_class = excluded.asset_class,
        name = excluded.name,
        price = excluded.price,
        change_pct = excluded.change_pct,
        fetched_at = excluded.fetched_at,
        currency = excluded.currency,
        raw_symbol = excluded.raw_symbol,
        validation_status = excluded.validation_status,
        validation_issues = excluded.validation_issues
    """

    params = []
    for record in records:
        params.append(
            (
                record.get("asset_class"),
                record.get("symbol"),
                record.get("name"),
                record.get("price"),
                record.get("change_pct"),
                record.get("source"),
                record.get("as_of"),
                fetched_at,
                record.get("currency"),
                record.get("raw_symbol"),
                record.get("validation_status"),
                json.dumps(record.get("validation_issues", []), ensure_ascii=False),
            )
        )

    before = conn.total_changes
    conn.executemany(sql, params)
    conn.commit()
    return int(conn.total_changes - before)


def read_back_test_rows(conn: sqlite3.Connection, limit: int = 10) -> List[Dict[str, Any]]:
    rows = conn.execute(
        f"""
        SELECT
            id,
            asset_class,
            symbol,
            name,
            price,
            change_pct,
            source,
            as_of,
            fetched_at,
            currency,
            raw_symbol,
            validation_status,
            validation_issues
        FROM {TABLE_NAME}
        ORDER BY asset_class, symbol, source
        LIMIT ?
        """,
        (limit,),
    ).fetchall()

    result: List[Dict[str, Any]] = []
    for row in rows:
        result.append(
            {
                "id": row[0],
                "asset_class": row[1],
                "symbol": row[2],
                "name": row[3],
                "price": row[4],
                "change_pct": row[5],
                "source": row[6],
                "as_of": row[7],
                "fetched_at": row[8],
                "currency": row[9],
                "raw_symbol": row[10],
                "validation_status": row[11],
                "validation_issues": row[12],
            }
        )
    return result


def summarize_records(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_asset_class = defaultdict(lambda: {"count": 0, "valid": 0, "suspicious": 0, "invalid": 0})
    by_source = defaultdict(lambda: {"count": 0, "valid": 0, "suspicious": 0, "invalid": 0})
    for record in records:
        asset_class = str(record.get("asset_class") or "unknown")
        source = str(record.get("source") or "unknown")
        status = str(record.get("validation_status") or "unknown")
        by_asset_class[asset_class]["count"] += 1
        by_source[source]["count"] += 1
        if status in by_asset_class[asset_class]:
            by_asset_class[asset_class][status] += 1
        if status in by_source[source]:
            by_source[source][status] += 1
    return {
        "records_count": len(records),
        "by_asset_class": dict(sorted(by_asset_class.items())),
        "by_source": dict(sorted(by_source.items())),
    }


def build_assessment(
    *,
    normalized_records: List[Dict[str, Any]],
    before_count: int,
    after_first_count: int,
    after_second_count: int,
    duplicate_rows: int,
) -> str:
    statuses = Counter(record.get("validation_status") for record in normalized_records)
    asset_groups = {record.get("asset_class") for record in normalized_records}

    if len(asset_groups) < len(ALLOWED_ASSET_CLASSES):
        return "FAIL"
    if statuses.get("invalid", 0) > 0:
        return "FAIL"
    if duplicate_rows != 0:
        return "FAIL"
    if after_first_count < before_count:
        return "FAIL"
    if after_second_count != after_first_count:
        return "FAIL"
    if statuses.get("suspicious", 0) > 0:
        return "PARTIAL"
    return "PASS"


def build_report() -> Dict[str, Any]:
    out_dir = output_dir()
    normalized_path = out_dir / NORMALIZED_JSON_NAME
    raw_path = out_dir / RAW_JSON_NAME
    db_file = db_path()

    normalized_payload = load_json(normalized_path)
    raw_payload = load_json(raw_path)
    normalized_records = dedupe_records(normalized_payload.get("records", []))
    normalized_summary = summarize_records(normalized_records)
    raw_summary = raw_payload.get("summary", {})
    attempt_summary = raw_payload.get("attempt_summary", {})

    conn = init_test_price_db(db_file)
    try:
        before_count = count_rows(conn)

        pass1_fetched_at = now_iso()
        pass1_changes = upsert_test_price_records(conn, normalized_records, fetched_at=pass1_fetched_at)
        after_first_count = count_rows(conn)

        pass2_fetched_at = now_iso()
        pass2_changes = upsert_test_price_records(conn, normalized_records, fetched_at=pass2_fetched_at)
        after_second_count = count_rows(conn)

        duplicate_rows = count_duplicate_rows(conn)
        sample_rows = read_back_test_rows(conn, limit=10)
    finally:
        conn.close()

    assessment = build_assessment(
        normalized_records=normalized_records,
        before_count=before_count,
        after_first_count=after_first_count,
        after_second_count=after_second_count,
        duplicate_rows=duplicate_rows,
    )

    report = {
        "timestamp": now_iso(),
        "input": {
            "tested_sources": list(attempt_summary.get("by_source", {}).keys())
            or list(normalized_payload.get("summary", {}).get("by_source", {}).keys()),
            "tested_asset_groups": sorted(list({record.get("asset_class") for record in normalized_records})),
            "tested_symbols": [record.get("symbol") for record in normalized_records],
        },
        "fetch_result": {
            "raw_summary": raw_summary,
            "attempt_summary": attempt_summary,
            "sample_raw_rows": raw_payload.get("assets", [])[:3],
        },
        "normalization_result": {
            "summary": normalized_summary,
            "records": normalized_records,
        },
        "db_result": {
            "db_path": str(db_file),
            "table_name": TABLE_NAME,
            "before_row_count": before_count,
            "after_first_row_count": after_first_count,
            "after_second_row_count": after_second_count,
            "duplicate_rows": duplicate_rows,
            "pass1_changes": pass1_changes,
            "pass2_changes": pass2_changes,
            "read_back_sample_rows": sample_rows,
        },
        "file": {
            "script": str(Path(__file__).resolve()),
            "saved": {
                RAW_JSON_NAME: str(raw_path),
                NORMALIZED_JSON_NAME: str(normalized_path),
                "price_feed_db_test.json": str(out_dir / "price_feed_db_test.json"),
            },
        },
        "assessment": assessment,
    }

    out_json = out_dir / "price_feed_db_test.json"
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def print_report(report: Dict[str, Any]) -> None:
    print("=== Price Feed DB Test ===")
    print("Input")
    tested_sources = report["input"].get("tested_sources", [])
    print(f"  tested sources: {', '.join(tested_sources) if isinstance(tested_sources, list) else tested_sources}")
    print(f"  tested asset groups: {', '.join(report['input'].get('tested_asset_groups', []))}")
    print(f"  tested symbols: {', '.join(report['input'].get('tested_symbols', []))}")
    print("Fetch Result")
    raw_summary = report["fetch_result"].get("raw_summary", {})
    for source_name, counts in raw_summary.get("by_source", {}).items():
        print(
            f"  {source_name}: total={counts.get('count', 0)} "
            f"valid={counts.get('valid', 0)} suspicious={counts.get('suspicious', 0)} invalid={counts.get('invalid', 0)}"
        )
    attempt_summary = report["fetch_result"].get("attempt_summary", {})
    if attempt_summary:
        print("  source attempts:")
        for source_name, counts in attempt_summary.get("by_source", {}).items():
            print(
                f"    {source_name}: attempts={counts.get('attempts', 0)} "
                f"success={counts.get('success', 0)} fail={counts.get('fail', 0)}"
            )
    sample_raw_rows = report["fetch_result"].get("sample_raw_rows", [])
    if sample_raw_rows:
        print(f"  sample raw row symbols: {', '.join(str(item.get('symbol')) for item in sample_raw_rows)}")
    print("Normalization Result")
    norm_summary = report["normalization_result"].get("summary", {})
    print(f"  valid count: {sum(v.get('valid', 0) for v in norm_summary.get('by_asset_class', {}).values())}")
    print(f"  suspicious count: {sum(v.get('suspicious', 0) for v in norm_summary.get('by_asset_class', {}).values())}")
    print(f"  invalid count: {sum(v.get('invalid', 0) for v in norm_summary.get('by_asset_class', {}).values())}")
    print("DB Result")
    db_result = report["db_result"]
    print(f"  db path: {db_result['db_path']}")
    print(f"  inserted rows (first pass): {db_result['pass1_changes']}")
    print(f"  updated rows (second pass): {db_result['pass2_changes']}")
    print(f"  before row count: {db_result['before_row_count']}")
    print(f"  after first row count: {db_result['after_first_row_count']}")
    print(f"  after second row count: {db_result['after_second_row_count']}")
    print(f"  duplicate rows: {db_result['duplicate_rows']}")
    if db_result.get("read_back_sample_rows"):
        sample = db_result["read_back_sample_rows"][0]
        print(f"  read-back sample: {sample.get('symbol')} {sample.get('price')} {sample.get('source')}")
    print("File")
    print(f"  Script: {report['file']['script']}")
    for name, path in report["file"]["saved"].items():
        print(f"  Saved: {Path(path)}")
    print("Assessment")
    print(f"  {report['assessment']}")


def main() -> int:
    try:
        report = build_report()
        print_report(report)
        return 0
    except Exception as exc:  # pragma: no cover - top-level guard
        print(f"[ERROR] Price feed DB test failed: {exc}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
