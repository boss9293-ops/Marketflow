"""
List tabs from a Google Spreadsheet and write sheet_tabs.json.

Usage:
  python backend/scripts/list_sheet_tabs.py --sheet_url "https://docs.google.com/spreadsheets/d/SHEET_ID/edit..."
  python backend/scripts/list_sheet_tabs.py --sheet_id SHEET_ID

Env vars (all optional — without them, skeleton/stub mode runs):
  GOOGLE_SERVICE_ACCOUNT_JSON  path to service-account JSON, or raw JSON string

Output:
  backend/output/sheet_tabs.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional


# Tabs excluded by default (case-insensitive exact match)
DEFAULT_EXCLUDED = {"readme", "holidays", "rsi"}
# Exclude tabs starting with "_" as non-data/aux tabs
def is_excluded(title: str) -> bool:
    low = title.lower()
    return low in DEFAULT_EXCLUDED or low.startswith("_")

RERUN_HINT = "python backend/scripts/list_sheet_tabs.py --sheet_id <ID>"


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def output_path() -> str:
    return os.path.join(repo_root(), "backend", "output", "sheet_tabs.json")


def extract_sheet_id(url_or_id: str) -> str:
    """Extract sheet ID from a docs.google.com URL or return as-is if already an ID."""
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url_or_id)
    if m:
        return m.group(1)
    return url_or_id.strip()


def allow_stub() -> bool:
    return os.getenv("SHEETS_ALLOW_STUB", "").strip().lower() in {"1", "true", "yes"}


def load_service_account_info(raw: str) -> Dict[str, Any]:
    if raw.startswith("{"):
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON must decode to a JSON object.")
        return data
    if os.path.exists(raw):
        with open(raw, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("Service account file must contain a JSON object.")
        return data
    raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON must be a JSON string or a valid file path.")


def fetch_tabs_via_api(sheet_id: str, sa_info: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fetch sheet tab metadata using Google Sheets API."""
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError as e:
        raise RuntimeError(
            "Missing Google API libs. Install: pip install google-auth google-api-python-client"
        ) from e

    scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    creds = service_account.Credentials.from_service_account_info(sa_info, scopes=scopes)
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)

    meta = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
    sheets = meta.get("sheets", [])
    tabs: List[Dict[str, Any]] = []
    for s in sheets:
        props = s.get("properties", {})
        title = str(props.get("title", "")).strip()
        tabs.append({"title": title, "sheet_id_int": props.get("sheetId")})
    return tabs


def classify_tabs(raw_tabs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for t in raw_tabs:
        title = t["title"]
        excluded = is_excluded(title)
        kind = "goal" if title.lower() == "goal" else "normal"
        result.append(
            {
                "title": title,
                "name": title,
                "kind": kind,
                "excluded": excluded,
            }
        )
    return result


def build_stub_tabs() -> List[Dict[str, Any]]:
    """Return stub structure when API is unavailable."""
    return [
        {"title": "Goal", "kind": "goal", "excluded": False},
        {"title": "Sheet1", "kind": "normal", "excluded": False},
        {"title": "Sheet2", "kind": "normal", "excluded": False},
        {"title": "ReadMe", "kind": "normal", "excluded": True},
        {"title": "_Notes", "kind": "normal", "excluded": True},
    ]


def build_payload(
    sheet_id: str,
    tabs: List[Dict[str, Any]],
    source: str,
    error: Optional[str] = None,
) -> Dict[str, Any]:
    excluded_default = [t["title"] for t in tabs if t.get("excluded")]
    selectable = [t for t in tabs if not t.get("excluded")]
    return {
        "sheet_id": sheet_id,
        "tabs": tabs,
        "selectable": [t["title"] for t in selectable],
        "excluded_default": excluded_default,
        "excluded_rules": ["ReadMe", "Holidays", "RSI", "tabs starting with '_'"],
        "source": source,
        "error": error,
        "generated_at": now_iso(),
        "rerun_hint": f"python backend/scripts/list_sheet_tabs.py --sheet_id {sheet_id}",
        "import_hint": (
            f"python backend/scripts/import_holdings_tabs.py "
            f"--sheet_id {sheet_id} --tabs Goal,<tab1>,<tab2>"
        ),
    }


def write_payload(payload: Dict[str, Any]) -> str:
    out = output_path()
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return out


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="List Google Spreadsheet tabs")
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--sheet_url", help="Full Google Sheets URL")
    group.add_argument("--sheet_id", help="Spreadsheet ID")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    raw_input = args.sheet_url if args.sheet_url else args.sheet_id
    sheet_id = extract_sheet_id(raw_input)

    if not sheet_id:
        print("[ERROR] Could not extract sheet ID.")
        return 1

    sa_raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()

    if not sa_raw:
        msg = "GOOGLE_SERVICE_ACCOUNT_JSON not set. Provide service account JSON or set SHEETS_ALLOW_STUB=1."
        if allow_stub():
            print("[SKIP] GOOGLE_SERVICE_ACCOUNT_JSON not set -- writing stub sheet_tabs.json")
            tabs = classify_tabs(build_stub_tabs())
            payload = build_payload(sheet_id, tabs, source="stub", error=msg)
            out = write_payload(payload)
            print(json.dumps({"ok": True, "source": "stub", "tabs": len(tabs), "output": out}, ensure_ascii=False))
            return 0
        payload = build_payload(sheet_id, [], source="missing_credentials", error=msg)
        out = write_payload(payload)
        print(f"[FAIL] {msg}", file=sys.stderr)
        print(json.dumps({"ok": False, "error": msg, "output": out}, ensure_ascii=False))
        return 2

    try:
        sa_info = load_service_account_info(sa_raw)
        raw_tabs = fetch_tabs_via_api(sheet_id, sa_info)
        tabs = classify_tabs(raw_tabs)
        payload = build_payload(sheet_id, tabs, source="google_api")
        out = write_payload(payload)
        print(json.dumps({"ok": True, "source": "google_api", "tabs": len(tabs), "output": out}, ensure_ascii=False))
        return 0
    except Exception as e:
        print(f"[FAIL] {e}", file=sys.stderr)
        if allow_stub():
            # Write stub so downstream has a baseline when explicitly allowed.
            tabs = build_stub_tabs()
            payload = build_payload(sheet_id, classify_tabs(tabs), source="error", error=str(e))
        else:
            payload = build_payload(sheet_id, [], source="error", error=str(e))
        out = write_payload(payload)
        print(json.dumps({"ok": False, "error": str(e), "output": out}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
