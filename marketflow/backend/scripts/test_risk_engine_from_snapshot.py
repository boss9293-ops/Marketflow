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


from backend.services.risk_input_builder import (  # noqa: E402
    build_core_risk_inputs,
    build_risk_context_map,
    load_latest_engine_reference,
    run_risk_engine_from_snapshot,
)


OUTPUT_DIR = BACKEND_DIR / "output" / "risk"
REPORT_PATH = OUTPUT_DIR / "test_risk_engine_from_snapshot.json"


def _symbol_summary(payload: Dict[str, Any] | None) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {"loaded": False}
    return {
        "loaded": bool(payload.get("input_loaded")),
        "price": payload.get("price"),
        "change_pct": payload.get("change_pct"),
        "context_loaded": bool(payload.get("context_loaded")),
        "loaded_context_symbols": payload.get("loaded_context_symbols", []),
    }


def build_report() -> Dict[str, Any]:
    risk_inputs = build_core_risk_inputs(use_cache=True)
    context_map = build_risk_context_map(use_cache=True)
    engine_reference = load_latest_engine_reference()
    result = run_risk_engine_from_snapshot(use_cache=True, save=True)

    snapshot_meta = result.get("snapshot_meta") if isinstance(result.get("snapshot_meta"), dict) else {}
    risk_outputs = result.get("risk_outputs") if isinstance(result.get("risk_outputs"), dict) else {}
    warnings = result.get("warnings") if isinstance(result.get("warnings"), list) else []

    tqqq_input = risk_inputs.get("TQQQ")
    qqq_input = risk_inputs.get("QQQ")
    tqqq_output = risk_outputs.get("TQQQ")
    qqq_output = risk_outputs.get("QQQ")

    context_loaded_symbols = sorted(context_map.keys())
    input_ok = bool(tqqq_input and tqqq_input.get("input_loaded") and qqq_input and qqq_input.get("input_loaded"))
    output_ok = bool(tqqq_output and qqq_output)
    engine_ok = bool(engine_reference and engine_reference.get("loaded"))

    assessment = "FAIL"
    if input_ok and output_ok:
        assessment = "PASS" if engine_ok else "PARTIAL"
    elif input_ok or output_ok:
        assessment = "PARTIAL"

    report = {
        "input": {
            "symbols_requested": ["TQQQ", "QQQ"],
            "snapshot_age_minutes": snapshot_meta.get("snapshot_age_minutes"),
            "is_stale": snapshot_meta.get("is_stale"),
            "context_loaded_symbols": context_loaded_symbols,
            "TQQQ": _symbol_summary(tqqq_input),
            "QQQ": _symbol_summary(qqq_input),
        },
        "output": {
            "mode": result.get("mode"),
            "engine_loaded": engine_ok,
            "engine_source": engine_reference.get("source") if isinstance(engine_reference, dict) else None,
            "TQQQ": {
                "risk_state": tqqq_output.get("risk_state") if isinstance(tqqq_output, dict) else None,
                "risk_score": tqqq_output.get("risk_score") if isinstance(tqqq_output, dict) else None,
            },
            "QQQ": {
                "risk_state": qqq_output.get("risk_state") if isinstance(qqq_output, dict) else None,
                "risk_score": qqq_output.get("risk_score") if isinstance(qqq_output, dict) else None,
            },
            "warnings": warnings,
        },
        "file": {
            "script": str(Path(__file__).resolve()),
            "saved": result.get("output_paths", {}),
        },
        "assessment": assessment,
        "snapshot_meta": snapshot_meta,
        "engine_meta": result.get("engine_meta"),
    }
    return report


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    report = build_report()
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Snapshot age: {report['input']['snapshot_age_minutes']}  stale={report['input']['is_stale']}")
    print(f"Engine source: {report['output']['engine_source']}  loaded={report['output']['engine_loaded']}")
    print(f"TQQQ: {report['output']['TQQQ']}")
    print(f"QQQ: {report['output']['QQQ']}")
    print(f"Assessment: {report['assessment']}")
    print(f"Written: {REPORT_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
