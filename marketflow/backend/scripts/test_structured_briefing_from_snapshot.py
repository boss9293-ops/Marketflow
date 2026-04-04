from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
MARKETFLOW_DIR = BACKEND_DIR.parent

for path in (MARKETFLOW_DIR, BACKEND_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))


from backend.services.market_snapshot_reader import (  # noqa: E402
    get_market_snapshot_for_briefing,
    get_reader_paths,
)
from backend.scripts.build_structured_briefing import (  # noqa: E402
    build_structured_briefing_from_snapshot,
    save_structured_briefing,
)


OUTPUT_DIR = BACKEND_DIR / "output" / "structured_briefing"
REPORT_PATH = OUTPUT_DIR / "test_structured_briefing_from_snapshot.json"

CORE_GROUPS = {
    "indices": ["SPX", "NDX", "IXIC", "RUT", "VIX"],
    "macro": ["US10Y", "DXY", "WTI", "GOLD"],
    "etfs": ["SPY", "QQQ", "TQQQ", "SOXL", "SMH"],
    "mega_caps": ["NVDA", "MSFT", "AAPL", "AMZN", "META"],
}


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def flatten_symbols(snapshot: Dict[str, Any]) -> List[str]:
    symbols: List[str] = []
    for group in ("indices", "macro", "etfs", "mega_caps"):
        group_data = snapshot.get(group)
        if isinstance(group_data, dict):
            for symbol in group_data.keys():
                if symbol not in symbols:
                    symbols.append(symbol)
    return symbols


def missing_symbols(snapshot: Dict[str, Any]) -> List[str]:
    missing: List[str] = []
    for group, expected in CORE_GROUPS.items():
        group_data = snapshot.get(group)
        available = set(group_data.keys()) if isinstance(group_data, dict) else set()
        for symbol in expected:
            if symbol not in available and symbol not in missing:
                missing.append(symbol)
    return missing


def build_report() -> Dict[str, Any]:
    paths = get_reader_paths()
    snapshot = get_market_snapshot_for_briefing(use_cache=True)
    briefing = build_structured_briefing_from_snapshot(use_cache=True)

    snapshot_keys = list(snapshot.keys()) if isinstance(snapshot, dict) else []
    symbols_used = flatten_symbols(snapshot) if isinstance(snapshot, dict) else []
    missing = missing_symbols(snapshot) if isinstance(snapshot, dict) else []
    proxy_used = None
    if isinstance(briefing, dict):
        proxy_used = (
            briefing.get("data_source_meta", {}).get("tech_proxy_symbol")
            if isinstance(briefing.get("data_source_meta"), dict)
            else None
        )

    saved_files: List[str] = [str(REPORT_PATH)]
    saved_briefing_path = None
    if isinstance(briefing, dict):
        saved_briefing_path = save_structured_briefing(briefing)
        saved_files.insert(0, str(saved_briefing_path))

    market_levels = briefing.get("market_levels") if isinstance(briefing, dict) else None
    market_snapshot = briefing.get("market_snapshot") if isinstance(briefing, dict) else None
    historical_context = briefing.get("historical_context") if isinstance(briefing, dict) else None
    data_source_meta = briefing.get("data_source_meta") if isinstance(briefing, dict) else None

    market_levels_ok = isinstance(market_levels, dict) and any(value is not None for value in market_levels.values())
    market_snapshot_ok = isinstance(market_snapshot, dict) and any(value is not None for value in market_snapshot.values())
    historical_unknown_ok = isinstance(historical_context, dict) and historical_context.get("short_term_status") == "unknown"
    meta_ok = isinstance(data_source_meta, dict) and bool(data_source_meta)
    core_fields_ok = all(
        isinstance(briefing, dict) and briefing.get(key) is not None
        for key in ("market_regime", "cross_asset_signal", "risk_quality", "headline", "one_line_takeaway")
    )
    briefing_ok = isinstance(briefing, dict) and core_fields_ok and market_levels_ok and market_snapshot_ok and meta_ok

    if briefing_ok and historical_unknown_ok:
        assessment = "PASS"
    elif isinstance(briefing, dict):
        assessment = "PARTIAL"
    else:
        assessment = "FAIL"

    return {
        "timestamp": briefing.get("date") if isinstance(briefing, dict) else None,
        "input": {
            "cache_paths": [str(paths.get("core_cache_path")), str(paths.get("movers_cache_path"))],
            "db_path": paths.get("selected_db_path"),
            "snapshot_keys_found": snapshot_keys,
            "symbols_used": symbols_used,
            "proxy_used": proxy_used,
            "missing_symbols": missing,
        },
        "output": {
            "market_regime": briefing.get("market_regime") if isinstance(briefing, dict) else None,
            "cross_asset_signal": briefing.get("cross_asset_signal") if isinstance(briefing, dict) else None,
            "risk_quality": briefing.get("risk_quality") if isinstance(briefing, dict) else None,
            "headline": briefing.get("headline") if isinstance(briefing, dict) else None,
            "one_line_takeaway": briefing.get("one_line_takeaway") if isinstance(briefing, dict) else None,
            "market_levels": market_levels,
            "market_snapshot": market_snapshot,
            "historical_short_term_status": historical_context.get("short_term_status") if isinstance(historical_context, dict) else None,
            "data_source_meta": data_source_meta,
        },
        "file": {
            "script": str(Path(__file__).resolve()),
            "saved": saved_files,
        },
        "assessment": assessment,
    }


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    report = build_report()
    write_json(REPORT_PATH, report)

    print("1. Input")
    print(f"- snapshot keys found: {report['input']['snapshot_keys_found']}")
    print(f"- symbols used: {report['input']['symbols_used']}")
    print(f"- proxy used: {report['input']['proxy_used']}")
    print(f"- missing symbols: {report['input']['missing_symbols']}")
    print()
    print("2. Output")
    print(f"- market_regime: {report['output']['market_regime']}")
    print(f"- cross_asset_signal: {report['output']['cross_asset_signal']}")
    print(f"- risk_quality: {report['output']['risk_quality']}")
    print(f"- headline: {report['output']['headline']}")
    print(f"- market_levels: {report['output']['market_levels']}")
    print(f"- market_snapshot: {report['output']['market_snapshot']}")
    print(f"- historical short_term_status: {report['output']['historical_short_term_status']}")
    print(f"- data_source_meta: {report['output']['data_source_meta']}")
    print()
    print("3. File")
    print(f"- Script: {report['file']['script']}")
    print("- Saved:")
    for saved in report["file"]["saved"]:
        print(f"  - {saved}")
    print()
    print("4. Assessment")
    print(f"- {report['assessment']}")
    return 0 if report["assessment"] != "FAIL" else 2


if __name__ == "__main__":
    raise SystemExit(main())
