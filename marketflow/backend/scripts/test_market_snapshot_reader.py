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


from backend.services.market_snapshot_reader import (  # noqa: E402
    OUTPUT_CACHE_DIR,
    CORE_CACHE_PATH,
    MOVERS_CACHE_PATH,
    REPORT_CACHE_PATH,
    get_latest_core_prices,
    get_latest_movers,
    get_latest_price,
    get_market_snapshot_for_briefing,
    get_reader_paths,
    get_snapshot_age_minutes,
    is_snapshot_stale,
    ensure_dir,
)


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def build_report() -> Dict[str, Any]:
    paths = get_reader_paths()

    core_prices = get_latest_core_prices()
    sample_symbol = "QQQ"
    sample_price = get_latest_price(sample_symbol)
    gainers = get_latest_movers("gainers")
    movers_all = get_latest_movers()
    briefing_snapshot = get_market_snapshot_for_briefing()
    snapshot_age_minutes = get_snapshot_age_minutes()
    stale = is_snapshot_stale()

    briefing_keys = list(briefing_snapshot.keys())
    expected_keys = ["indices", "macro", "etfs", "mega_caps", "meta"]
    core_ok = len(core_prices) > 0
    gainers_ok = len(gainers) > 0
    sample_ok = sample_price is not None
    briefing_ok = briefing_keys == expected_keys
    age_ok = snapshot_age_minutes is not None
    stale_ok = stale is False

    if core_ok and gainers_ok and sample_ok and briefing_ok and age_ok and stale_ok:
        assessment = "PASS"
    elif core_ok or gainers_ok or sample_ok or briefing_ok:
        assessment = "PARTIAL"
    else:
        assessment = "FAIL"

    return {
        "timestamp": briefing_snapshot.get("meta", {}).get("fetched_at") or briefing_snapshot.get("meta", {}).get("as_of"),
        "input": {
            "cache_paths": [str(CORE_CACHE_PATH), str(MOVERS_CACHE_PATH), str(REPORT_CACHE_PATH)],
            "db_path": paths.get("selected_db_path"),
        },
        "output": {
            "core_count": len(core_prices),
            "movers_count": len(movers_all),
            "gainers_count": len(gainers),
            "sample_price_symbol": sample_symbol,
            "sample_price_found": sample_ok,
            "sample_price": sample_price,
            "briefing_snapshot_keys": briefing_keys,
            "snapshot_age_minutes": snapshot_age_minutes,
            "is_stale": stale,
        },
        "file": {
            "script": str(Path(__file__).resolve()),
            "saved": [str(OUTPUT_CACHE_DIR / "market_snapshot_reader_test.json")],
        },
        "assessment": assessment,
    }


def main() -> int:
    ensure_dir(OUTPUT_CACHE_DIR)
    report = build_report()
    out_path = OUTPUT_CACHE_DIR / "market_snapshot_reader_test.json"
    _write_json(out_path, report)

    print("1. Input")
    print(f"- cache paths: {', '.join(report['input']['cache_paths'])}")
    print(f"- db path: {report['input']['db_path']}")
    print()
    print("2. Output")
    print(f"- core_count: {report['output']['core_count']}")
    print(f"- movers_count: {report['output']['movers_count']}")
    print(f"- gainers_count: {report['output']['gainers_count']}")
    print(f"- sample symbol lookup result: {report['output']['sample_price_symbol']} / found={report['output']['sample_price_found']}")
    print(f"- briefing snapshot keys: {report['output']['briefing_snapshot_keys']}")
    print(f"- snapshot age / stale: {report['output']['snapshot_age_minutes']} min / {report['output']['is_stale']}")
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

