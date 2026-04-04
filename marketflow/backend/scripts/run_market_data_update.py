from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
MARKETFLOW_DIR = BACKEND_DIR.parent

for path in (MARKETFLOW_DIR, BACKEND_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))


from backend.services.market_data_service import (  # noqa: E402
    build_core_cache_payload,
    collect_core_prices,
    ensure_dir,
    make_session,
    now_iso,
    open_db,
    OUTPUT_CACHE_DIR,
    read_back_core_rows,
    upsert_core_price_records,
)
from backend.services.movers_service import (  # noqa: E402
    build_movers_cache_payload,
    collect_movers,
    read_back_mover_rows,
    upsert_mover_records,
)


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _cache_paths() -> Dict[str, Path]:
    ensure_dir(OUTPUT_CACHE_DIR)
    return {
        "core": OUTPUT_CACHE_DIR / "core_price_snapshot_latest.json",
        "movers": OUTPUT_CACHE_DIR / "movers_snapshot_latest.json",
        "report": OUTPUT_CACHE_DIR / "market_data_update_report.json",
    }


def _build_assessment(core_summary: Dict[str, Any], movers_summary: Dict[str, Any], db_summary: Dict[str, Any], cache_ok: bool) -> str:
    core_total = int(core_summary.get("total") or 0)
    core_valid = int(core_summary.get("valid") or 0)
    core_rate = (core_valid / core_total) if core_total else 0.0
    movers_by_category = movers_summary.get("by_category") or {}
    movers_ok = all(int((movers_by_category.get(cat) or {}).get("count") or 0) > 0 for cat in ("gainers", "most_active", "unusual_volume"))
    db_ok = bool(db_summary.get("stable"))

    if core_rate >= 0.9 and movers_ok and db_ok and cache_ok:
        return "PASS"
    if core_valid > 0 or any(int((movers_by_category.get(cat) or {}).get("count") or 0) > 0 for cat in ("gainers", "most_active", "unusual_volume")):
        return "PARTIAL"
    return "FAIL"


def run_market_data_update() -> Dict[str, Any]:
    as_of = now_iso()
    session = make_session()

    core_result = collect_core_prices(as_of=as_of, session=session)
    movers_result = collect_movers(as_of=as_of, session=session)

    conn = open_db()
    try:
        core_pass1 = upsert_core_price_records(conn, core_result["records"])
        core_pass2 = upsert_core_price_records(conn, core_result["records"])
        movers_pass1 = upsert_mover_records(conn, movers_result["records"])
        movers_pass2 = upsert_mover_records(conn, movers_result["records"])

        core_rows = read_back_core_rows(conn, limit=5)
        mover_rows = read_back_mover_rows(conn, limit=10)
    finally:
        conn.close()

    cache_paths = _cache_paths()
    core_cache = build_core_cache_payload(core_result)
    movers_cache = build_movers_cache_payload(movers_result)
    _write_json(cache_paths["core"], core_cache)
    _write_json(cache_paths["movers"], movers_cache)

    report = {
        "timestamp": as_of,
        "input": {
            "symbols_count": len(core_result["records"]),
            "movers_categories": list(movers_result.get("categories", {}).keys()),
            "tested_symbols": [record.get("symbol") for record in core_result["records"]],
        },
        "fetch": {
            "tradingview_success_count": core_result["fetch_summary"].get("tradingview_success_count", 0),
            "yahoo_fallback_count": core_result["fetch_summary"].get("yahoo_fallback_count", 0),
            "source_fail_count": core_result["fetch_summary"].get("source_fail_count", 0),
            "movers_fetched": len(movers_result.get("records", [])),
            "sample_core_raw": core_result["raw_records"][:2],
            "sample_mover_raw": movers_result["raw_records"][:3],
        },
        "normalization": {
            "core": core_result["summary"],
            "movers": movers_result["summary"],
        },
        "db": {
            "core": {
                "first_pass": core_pass1,
                "second_pass": core_pass2,
            },
            "movers": {
                "first_pass": movers_pass1,
                "second_pass": movers_pass2,
            },
            "insert_count": int(core_pass1["inserted"]) + int(movers_pass1["inserted"]),
            "update_count": int(core_pass1["updated"]) + int(movers_pass1["updated"]),
            "duplicate_count": int(core_pass2["duplicates"]) + int(movers_pass2["duplicates"]),
            "stable": core_pass1["row_count"] == core_pass2["row_count"] and movers_pass1["row_count"] == movers_pass2["row_count"],
            "core_row_count": core_pass2["row_count"],
            "movers_row_count": movers_pass2["row_count"],
            "read_back_core_sample": core_rows,
            "read_back_mover_sample": mover_rows,
        },
        "cache": {
            "generated": cache_paths["core"].exists() and cache_paths["movers"].exists(),
            "core_price_snapshot_latest": str(cache_paths["core"]),
            "movers_snapshot_latest": str(cache_paths["movers"]),
        },
    }

    report["assessment"] = _build_assessment(
        core_result["summary"],
        movers_result["summary"],
        report["db"],
        bool(report["cache"]["generated"]),
    )

    _write_json(cache_paths["report"], report)
    return report


def main() -> int:
    report = run_market_data_update()
    print("1. Input")
    print(f"- symbols count: {report['input']['symbols_count']}")
    print(f"- movers categories: {', '.join(report['input']['movers_categories'])}")
    print()
    print("2. Fetch Result")
    print(f"- tradingview success count: {report['fetch']['tradingview_success_count']}")
    print(f"- yahoo fallback count: {report['fetch']['yahoo_fallback_count']}")
    print(f"- movers fetched: {report['fetch']['movers_fetched']}")
    print(f"- sample core raw: {json.dumps(report['fetch']['sample_core_raw'][:1], ensure_ascii=False)}")
    print(f"- sample mover raw: {json.dumps(report['fetch']['sample_mover_raw'][:1], ensure_ascii=False)}")
    print()
    print("3. DB Result")
    print(f"- insert count: {report['db']['insert_count']}")
    print(f"- update count: {report['db']['update_count']}")
    print(f"- duplicate count: {report['db']['duplicate_count']}")
    print(f"- stable rerun: {report['db']['stable']}")
    print(f"- core row count: {report['db']['core_row_count']}")
    print(f"- movers row count: {report['db']['movers_row_count']}")
    print(f"- read-back core sample: {json.dumps(report['db']['read_back_core_sample'][:2], ensure_ascii=False)}")
    print(f"- read-back mover sample: {json.dumps(report['db']['read_back_mover_sample'][:2], ensure_ascii=False)}")
    print()
    print("4. Cache")
    print(f"- core_price_snapshot_latest.json: {report['cache']['generated']}")
    print(f"- movers_snapshot_latest.json: {report['cache']['generated']}")
    print(f"- report: {report['cache']['generated']}")
    print()
    print("5. Assessment")
    print(f"- {report['assessment']}")
    return 0 if report["assessment"] != "FAIL" else 2


if __name__ == "__main__":
    raise SystemExit(main())
