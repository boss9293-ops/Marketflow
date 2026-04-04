from __future__ import annotations

import json
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
MARKETFLOW_DIR = BACKEND_DIR.parent

for path in (MARKETFLOW_DIR, BACKEND_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))


from backend.services.risk_input_builder import run_risk_engine_from_snapshot  # noqa: E402


def main() -> int:
    result = run_risk_engine_from_snapshot(use_cache=True, save=True)
    snapshot_meta = result.get("snapshot_meta") if isinstance(result.get("snapshot_meta"), dict) else {}
    engine_meta = result.get("engine_meta") if isinstance(result.get("engine_meta"), dict) else {}
    risk_outputs = result.get("risk_outputs") if isinstance(result.get("risk_outputs"), dict) else {}

    print(f"Snapshot source: {snapshot_meta.get('source')}  age={snapshot_meta.get('snapshot_age_minutes')}  stale={snapshot_meta.get('is_stale')}")
    print(f"Engine source: {engine_meta.get('source')}  loaded={engine_meta.get('loaded')}  state={engine_meta.get('risk_state')}  score={engine_meta.get('risk_score')}")
    for symbol in ("TQQQ", "QQQ"):
        payload = risk_outputs.get(symbol)
        if not payload:
            print(f"{symbol}: skipped")
            continue
        print(
            f"{symbol}: {payload.get('risk_state')} "
            f"score={payload.get('risk_score')} "
            f"price={payload.get('price')} change={payload.get('change_pct')}"
        )

    print("Written files:")
    output_paths = result.get("output_paths") if isinstance(result.get("output_paths"), dict) else {}
    for key, value in output_paths.items():
        print(f"  {key}: {value}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
