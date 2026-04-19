"""
Build holdings time-series cache JSON.

Reads:
  backend/output/my_holdings_goal.json
  backend/output/my_holdings_tabs.json

Writes:
  backend/output/my_holdings_ts.json
  output/cache/my_holdings_ts.json

Output schema:
  {
    "data_version": "...",
    "sheet_id": "...",
    "generated_at": "...",
    "rerun_hint": "...",
    "active_tabs": ["Goal", "Tab1", ...],
    "tabs": [
      { "name": "Tab1", "type": "normal", "positions": [...], "history": [...] }
    ],
    "goal": { "positions": [...], "history": [...] }
  }
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

try:
    from services.data_contract import artifact_path as contract_artifact_path
except Exception:
    try:
        from backend.services.data_contract import artifact_path as contract_artifact_path
    except Exception:
        contract_artifact_path = None

DATA_VERSION = "my_holdings_ts_v3"

RERUN_HINT = (
    "python backend/scripts/import_holdings_tabs.py --sheet_id <ID> --tabs Goal,<tab1> "
    "&& python backend/scripts/build_holdings_ts_cache.py"
)


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def input_goal_path() -> str:
    return artifact_path("my_holdings_goal.json")


def input_tabs_path() -> str:
    return artifact_path("my_holdings_tabs.json")


def output_path() -> str:
    return artifact_path("my_holdings_ts.json")


def cache_output_path() -> str:
    return artifact_path("cache/my_holdings_ts.json")


def artifact_path(relative_path: str) -> str:
    rel = str(relative_path or "").replace("\\", "/").lstrip("/")
    if contract_artifact_path is not None:
        try:
            return str(contract_artifact_path(rel))
        except Exception:
            pass
    return os.path.join(repo_root(), "backend", "output", rel)


def load_json(path: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def sort_history(points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    try:
        return sorted(points, key=lambda p: str(p.get("date") or ""))
    except Exception:
        return points


def missing_payload(missing: List[str]) -> Dict[str, Any]:
    return {
        "data_version": DATA_VERSION,
        "status": "missing_input",
        "sheet_id": None,
        "generated_at": now_iso(),
        "missing_inputs": missing,
        "active_tabs": [],
        "tabs": [],
        "goal": {"positions": [], "history": []},
        "rerun_hint": RERUN_HINT,
    }


def main() -> int:
    goal_raw = load_json(input_goal_path())
    tabs_raw = load_json(input_tabs_path())

    missing: List[str] = []
    if goal_raw is None:
        missing.append("my_holdings_goal.json")
    if tabs_raw is None:
        missing.append("my_holdings_tabs.json")

    if missing:
        print(f"[WARN] Missing inputs: {', '.join(missing)}")
        print(f"[WARN] Keeping existing output if present: {output_path()}")
        return 1

    sheet_id = (goal_raw or {}).get("sheet_id") or (tabs_raw or {}).get("sheet_id")
    rerun = (goal_raw or {}).get("rerun_hint") or (tabs_raw or {}).get("rerun_hint") or RERUN_HINT

    tabs: List[Dict[str, Any]] = []
    for t in (tabs_raw or {}).get("tabs") or []:
        history = sort_history(t.get("history") or [])
        tabs.append(
            {
                "name": t.get("name"),
                "type": t.get("type", "normal"),
                "positions": t.get("positions") or [],
                "positions_columns": t.get("positions_columns") or [],
                "history": history,
                "history_range": t.get("history_range"),
                "positions_range": t.get("positions_range"),
                "snapshot_summary": t.get("snapshot_summary"),
            }
        )

    goal = {
        "name": "Goal",
        "type": "goal",
        "positions": (goal_raw or {}).get("positions") or [],
        "positions_columns": (goal_raw or {}).get("positions_columns") or [],
        "history": sort_history((goal_raw or {}).get("history") or []),
        "history_range": (goal_raw or {}).get("history_range"),
        "positions_range": (goal_raw or {}).get("positions_range"),
        "snapshot_summary": (goal_raw or {}).get("snapshot_summary"),
    }

    active_tabs = []
    if goal.get("history") or goal.get("positions"):
        active_tabs.append("Goal")
    active_tabs.extend([t.get("name") for t in tabs if t.get("name")])

    payload = {
        "data_version": DATA_VERSION,
        "status": "ok",
        "sheet_id": sheet_id,
        "generated_at": now_iso(),
        "rerun_hint": rerun,
        "active_tabs": active_tabs,
        "tabs": tabs,
        "goal": goal,
    }

    out = output_path()
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    cache_out = cache_output_path()
    os.makedirs(os.path.dirname(cache_out), exist_ok=True)
    with open(cache_out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print("build_holdings_ts_cache.py")
    print(f"  tabs={len(tabs)} goal_rows={len(goal.get('history') or [])}")
    print(f"[OK] {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
