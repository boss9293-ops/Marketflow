"""
Import holdings data from selected Google Sheets tabs.

Usage:
  python backend/scripts/import_holdings_tabs.py --sheet_url <URL> --tabs "Goal,Tab1"
  python backend/scripts/import_holdings_tabs.py --sheet_id <ID> --tabs "Goal,Tab1"

History ranges (header row included in the range):
  Header row: D49:I49
  Data rows:   D50:I999

Positions table:
  - Auto-detect header row containing '醫낅ぉ' and '?댁젣醫낃?'
  - Read until first blank row
  - Fallback to POSITIONS_RANGE env var if detection fails

Outputs:
  backend/output/my_holdings_goal.json  (Goal tab positions + history)
  backend/output/my_holdings_tabs.json  (normal tabs positions + history)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

try:
    from services.data_contract import artifact_path as contract_artifact_path
except Exception:
    try:
        from backend.services.data_contract import artifact_path as contract_artifact_path
    except Exception:
        contract_artifact_path = None

GOAL_RANGE = "D49:I999"
NORMAL_RANGE = "D49:I999"
NORMAL_SNAPSHOT_RANGE = "E13:F21"
GOAL_SNAPSHOT_RANGE = "G15:H22"

DEFAULT_EXCLUDED = {"readme", "holidays", "rsi", "x", "main", "rsi_main", "pricedata__rsi__main"}

POSITIONS_SCAN_RANGE = os.getenv("POSITIONS_SCAN_RANGE", "D1:Z120")
POSITIONS_RANGE = os.getenv("POSITIONS_RANGE", "D1:Z40")

RERUN_HINT_TEMPLATE = (
    "python backend/scripts/import_holdings_tabs.py --sheet_id {sheet_id} --tabs {tabs}"
)


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def output_path(relative_path: str) -> str:
    rel = str(relative_path or "").replace("\\", "/").lstrip("/")
    if contract_artifact_path is not None:
        try:
            return str(contract_artifact_path(rel))
        except Exception:
            pass
    return os.path.join(repo_root(), "backend", "output", rel)


def extract_sheet_id(url_or_id: str) -> str:
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url_or_id)
    if m:
        return m.group(1)
    return url_or_id.strip()


def allow_stub() -> bool:
    return os.getenv("SHEETS_ALLOW_STUB", "").strip().lower() in {"1", "true", "yes"}


def is_excluded_tab(title: str) -> bool:
    low = title.lower()
    return low in DEFAULT_EXCLUDED or low.startswith("_")


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
    raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON must be a JSON string or valid file path.")


def fetch_range(sheet_id: str, tab_title: str, cell_range: str, sa_info: Dict[str, Any]) -> List[List[Any]]:
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError as e:
        raise RuntimeError("Missing Google API libs. Install: pip install google-auth google-api-python-client") from e

    scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    creds = service_account.Credentials.from_service_account_info(sa_info, scopes=scopes)
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)

    full_range = f"'{tab_title}'!{cell_range}"
    resp = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=sheet_id, range=full_range)
        .execute()
    )
    return [list(r) for r in resp.get("values", []) or []]


def cell_str(row: List[Any], idx: int) -> str:
    if idx < 0 or idx >= len(row):
        return ""
    return str(row[idx] or "").strip()


def parse_number(raw: str) -> Optional[float]:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        text = text.replace(",", "").replace("$", "").replace("₩", "").replace("%", "")
        return float(text)
    except Exception:
        return None


def parse_goal_snapshot_summary(rows: List[List[Any]]) -> Dict[str, Any]:
    """Parse Goal!G14:H23 key/value summary block into normalized + raw fields."""
    raw_pairs: List[Dict[str, Any]] = []
    normalized: Dict[str, Any] = {}
    for row in rows or []:
        if not isinstance(row, list):
            continue
        key = cell_str(row, 0)
        val_text = cell_str(row, 1)
        if not key and not val_text:
            continue
        raw_pairs.append({"label": key or "", "value": val_text or ""})

        low = (key or "").strip().lower()
        num = parse_number(val_text)
        is_pct = "%" in (val_text or "")

        if "금일수익" in key:
            normalized["today_pnl"] = num
        elif "금일 변동" in key or "금일변동" in key:
            normalized["today_pnl_pct"] = num if is_pct else num
        elif "매수액" in key or "매수 원금" in key or "매수원금" in key:
            normalized["buy_total"] = num
        elif "평가액" in key:
            normalized["total_equity"] = num
        elif "현금잔고" in key:
            normalized["cash"] = num
        elif "계좌총액" in key:
            normalized["account_total"] = num
        elif "총투입금" in key:
            normalized["total_invested"] = num
        elif "달러총수익" in key:
            normalized["total_pnl"] = num
        elif "원화총액" in key:
            normalized["krw_total"] = num
        elif "계좌수익률" in key:
            normalized["account_return_pct"] = num if is_pct else num
        elif "today pnl" in low:
            normalized["today_pnl"] = num
        elif "today %" in low or "today change" in low:
            normalized["today_pnl_pct"] = num
        elif "cash" in low:
            normalized["cash"] = num

    return {"raw": raw_pairs, "normalized": normalized, "range": GOAL_SNAPSHOT_RANGE}
    text = text.replace(",", "").replace("$", "").replace("%", "")
    text = text.replace("₩", "").replace("￦", "").replace("원", "")
    text = text.replace("▲", "").replace("▼", "").replace("△", "").replace("▽", "")
    text = text.replace("+", "")
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    m = re.search(r"-?\d+(?:\.\d+)?", text)
    if not m:
        return None
    try:
        v = float(m.group(0))
        if v != v:
            return None
        return v
    except Exception:
        return None


def normalize_date(raw: str) -> Optional[str]:
    text = (raw or "").strip()
    if not text:
        return None

    # The sheet uses values like "22.04.08." for 2022-04-08.
    # Parse this explicitly so dateutil does not misread it as 2001/2002-style dates.
    text = text.rstrip(".")

    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return text
    m = re.match(r"^(\d{4})/(\d{1,2})/(\d{1,2})$", text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", text)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    m = re.match(r"^(\d{4})\.(\d{1,2})\.(\d{1,2})$", text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.match(r"^(\d{2})\.(\d{1,2})\.(\d{1,2})$", text)
    if m:
        yy = int(m.group(1))
        year = 2000 + yy if yy < 70 else 1900 + yy
        return f"{year}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.match(r"^(\d{2})/(\d{1,2})/(\d{1,2})$", text)
    if m:
        yy = int(m.group(1))
        year = 2000 + yy if yy < 70 else 1900 + yy
        return f"{year}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"

    try:
        serial = int(float(text))
        if 20000 < serial < 90000:
            base = date(1899, 12, 30)
            d = base + timedelta(days=serial)
            return d.strftime("%Y-%m-%d")
    except Exception:
        pass

    try:
        from dateutil import parser as dateutil_parser

        d = dateutil_parser.parse(text, dayfirst=False)
        return d.strftime("%Y-%m-%d")
    except Exception:
        return None


def detect_columns(header_row: List[Any]) -> Dict[str, int]:
    aliases: Dict[str, List[str]] = {
        "date": ["date", "날짜", "일자"],
        "total": [
            "total",
            "총자산",
            "총액",
            "total asset",
            "합계",
            "계좌총액",
            "총평가액",
            "평가액",
            "계좌잔고",
        ],
        "in": [
            "in",
            "투입",
            "투입금",
            "투입액",
            "매입",
            "매수",
            "매수금",
            "매수총액",
            "원금",
            "invested",
            "cost",
            "buy",
        ],
        "pl": [
            "p/l",
            "pl",
            "손익",
            "손익금",
            "수익",
            "수익금",
            "profit/loss",
            "pnl",
            "gain/loss",
            "누적손익",
            "누적손익금",
            "누적수익",
            "누적수익금",
        ],
        "pl_pct": [
            "p/l(%)",
            "pl(%)",
            "손익률",
            "수익률",
            "수익율",
            "return(%)",
            "pct",
            "pl_pct",
            "p/l %",
            "누적수익률",
            "누적손익률",
        ],
        "delta": ["delta", "변동", "d/d", "chg", "diff", "증감"],
    }
    idx_map: Dict[str, int] = {}
    for i, cell in enumerate(header_row):
        lower = str(cell or "").strip().lower()
        if not lower:
            continue
        for canon, variants in aliases.items():
            if canon in idx_map:
                continue
            for variant in variants:
                v = str(variant).strip().lower()
                if not v:
                    continue
                if (len(v) <= 2) or (v.isascii() and len(v) <= 3):
                    matched = lower == v
                else:
                    matched = v in lower
                if matched:
                    idx_map[canon] = i
                    break
    return idx_map


def parse_history(rows: List[List[Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if not rows:
        return [], {"header": None, "rows_total": 0, "rows_imported": 0, "rows_skipped": 0, "rows_blank_date": 0}

    header_row = rows[0]
    col_map = detect_columns(header_row)

    data_points: List[Dict[str, Any]] = []
    rows_total = 0
    rows_skipped = 0
    rows_blank_date = 0

    for row in rows[1:]:
        rows_total += 1
        raw_date = cell_str(row, col_map.get("date", -1))
        if not raw_date:
            rows_blank_date += 1
            break

        date_str = normalize_date(raw_date)
        if date_str is None:
            rows_skipped += 1
            continue

        def get_num(key: str) -> Optional[float]:
            return parse_number(cell_str(row, col_map.get(key, -1)))

        total = get_num("total")
        in_val = get_num("in")
        pl = get_num("pl")
        pl_pct = get_num("pl_pct")
        delta = get_num("delta")

        if total is None and in_val is None and pl is None and pl_pct is None and delta is None:
            rows_skipped += 1
            continue

        data_points.append(
            {
                "date": date_str,
                "total": total,
                "in": in_val,
                "pl": pl,
                "pl_pct": pl_pct,
                "delta": delta,
            }
        )

    return data_points, {
        "header": [str(c or "").strip() for c in header_row],
        "col_map": col_map,
        "rows_total": rows_total,
        "rows_imported": len(data_points),
        "rows_skipped": rows_skipped,
        "rows_blank_date": rows_blank_date,
    }


def normalize_headers(header_row: List[Any]) -> List[str]:
    columns: List[str] = []
    counts: Dict[str, int] = {}
    for i, cell in enumerate(header_row):
        name = str(cell or "").strip()
        if not name:
            name = f"col_{i+1}"
        if name in counts:
            counts[name] += 1
            name = f"{name}_{counts[name]}"
        else:
            counts[name] = 1
        columns.append(name)
    return columns


def find_positions_header_idx(rows: List[List[Any]]) -> int:
    for idx, row in enumerate(rows):
        cells = [str(c or "").strip() for c in row]
        if any("종목" in c for c in cells) and any("어제종가" in c for c in cells):
            return idx
        if any("symbol" in c.lower() for c in cells) and any("yesterday" in c.lower() for c in cells):
            return idx
    return -1


def parse_positions_rows(rows: List[List[Any]], header_idx: int) -> Tuple[List[str], List[Dict[str, Any]]]:
    header_row = rows[header_idx] if header_idx >= 0 else []
    columns = normalize_headers(header_row)
    positions: List[Dict[str, Any]] = []
    for row in rows[header_idx + 1 :]:
        if not any(str(c or "").strip() for c in row):
            break
        item: Dict[str, Any] = {}
        for i, col in enumerate(columns):
            item[col] = str(row[i]).strip() if i < len(row) else ""
        positions.append(item)
    return columns, positions


def fetch_positions_table(sheet_id: str, tab_title: str, sa_info: Dict[str, Any]) -> Tuple[List[str], List[Dict[str, Any]], str]:
    # Scan range to auto-detect header
    scan_rows = fetch_range(sheet_id, tab_title, POSITIONS_SCAN_RANGE, sa_info)
    header_idx = find_positions_header_idx(scan_rows)
    if header_idx >= 0:
        columns, positions = parse_positions_rows(scan_rows, header_idx)
        return columns, positions, POSITIONS_SCAN_RANGE

    # Fallback to explicit range
    fallback_rows = fetch_range(sheet_id, tab_title, POSITIONS_RANGE, sa_info)
    header_idx = 0
    for i, row in enumerate(fallback_rows):
        if any(str(c or "").strip() for c in row):
            header_idx = i
            break
    columns, positions = parse_positions_rows(fallback_rows, header_idx)
    return columns, positions, POSITIONS_RANGE


def merge_points(existing: List[Dict[str, Any]], new_points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_date: Dict[str, Dict[str, Any]] = {}
    for p in existing or []:
        if not isinstance(p, dict):
            continue
        d = str(p.get("date") or "")
        if d:
            by_date[d] = p
    for p in new_points or []:
        if not isinstance(p, dict):
            continue
        d = str(p.get("date") or "")
        if not d:
            continue
        by_date[d] = p
    return [by_date[k] for k in sorted(by_date.keys())]


def write_json(path: str, payload: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Import holdings tabs from Google Sheets")
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--sheet_url", help="Full Google Sheets URL")
    group.add_argument("--sheet_id", help="Spreadsheet ID")
    p.add_argument(
        "--tabs",
        default="Goal",
        help='Comma-separated tab titles to import (default: "Goal")',
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    raw_input = args.sheet_url or args.sheet_id or ""
    sheet_id = extract_sheet_id(raw_input)
    tab_list = [t.strip() for t in args.tabs.split(",") if t.strip()]

    if not sheet_id:
        print("[ERROR] sheet_id missing.", file=sys.stderr)
        return 1
    if not tab_list:
        print("[ERROR] --tabs is empty.", file=sys.stderr)
        return 1

    sa_raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    rerun = RERUN_HINT_TEMPLATE.format(sheet_id=sheet_id, tabs=",".join(tab_list))

    prev_goal_path = output_path("my_holdings_goal.json")
    prev_tabs_path = output_path("my_holdings_tabs.json")
    prev_goal = {}
    prev_tabs = {}
    if os.path.exists(prev_goal_path):
        try:
            with open(prev_goal_path, "r", encoding="utf-8") as f:
                prev_goal = json.load(f)
        except Exception:
            prev_goal = {}
    if os.path.exists(prev_tabs_path):
        try:
            with open(prev_tabs_path, "r", encoding="utf-8") as f:
                prev_tabs = json.load(f)
        except Exception:
            prev_tabs = {}
    if not sa_raw:
        msg = "GOOGLE_SERVICE_ACCOUNT_JSON not set. Provide service account JSON or set SHEETS_ALLOW_STUB=1."
        if allow_stub():
            print("[SKIP] GOOGLE_SERVICE_ACCOUNT_JSON not set. Writing stub outputs.")
            stub_history = [{"date": "2025-01-01", "total": 100000, "in": 90000, "pl": 10000, "pl_pct": 11.11}]
            stub_positions = [{"종목": "AAPL", "어제종가": "189.8", "보유수량": "10", "비고": "stub"}]
            goal_payload = {
                "sheet_id": sheet_id,
                "tab": "Goal",
                "positions_columns": ["종목", "어제종가", "보유수량", "비고"],
                "positions": stub_positions,
                "positions_range": POSITIONS_RANGE,
                "history": merge_points(prev_goal.get("history") or [], stub_history),
                "history_range": GOAL_RANGE,
                "parse_report": {"source": "stub"},
                "generated_at": now_iso(),
                "rerun_hint": rerun,
            }
            tabs_list = prev_tabs.get("tabs") or []
            for t in tab_list:
                if t.lower() == "goal" or is_excluded_tab(t):
                    continue
                tabs_list.append(
                    {
                        "name": t,
                        "type": "normal",
                        "positions_columns": ["종목", "어제종가", "보유수량", "비고"],
                        "positions": stub_positions,
                        "positions_range": POSITIONS_RANGE,
                        "history": stub_history,
                        "history_range": NORMAL_RANGE,
                    }
                )
            tabs_payload = {
                "sheet_id": sheet_id,
                "selected_tabs": [t for t in tab_list if t.lower() != "goal" and not is_excluded_tab(t)],
                "tabs": tabs_list,
                "errors": [],
                "generated_at": now_iso(),
                "rerun_hint": rerun,
            }
            write_json(prev_goal_path, goal_payload)
            write_json(prev_tabs_path, tabs_payload)
            print(json.dumps({"ok": True, "source": "stub", "tabs": tab_list, "output": [prev_goal_path, prev_tabs_path]}, ensure_ascii=False))
            return 0
        print(f"[FAIL] {msg}", file=sys.stderr)
        print(json.dumps({"ok": False, "error": msg, "output": [prev_goal_path, prev_tabs_path]}, ensure_ascii=False))
        return 2
    try:
        sa_info = load_service_account_info(sa_raw)
    except Exception as e:
        print(f"[FAIL] Could not load service account: {e}", file=sys.stderr)
        return 1

    goal_payload: Optional[Dict[str, Any]] = None
    normal_tabs: List[Dict[str, Any]] = []
    errors: List[str] = []

    for tab in tab_list:
        if is_excluded_tab(tab):
            print(f"  [SKIP] {tab} excluded by default.")
            continue

        is_goal = tab.lower() == "goal"
        
        if "한국" in tab:
            history_range = "D49:H999"
            snapshot_range = "E13:F21"
        else:
            history_range = "D49:I999"
            snapshot_range = "G15:H22"
            
        print(f"  Fetching '{tab}' positions + {history_range} ...", flush=True)

        try:
            positions_columns, positions, positions_range = fetch_positions_table(sheet_id, tab, sa_info)
            history_rows = fetch_range(sheet_id, tab, history_range, sa_info)
            history, report = parse_history(history_rows)
            history = merge_points([], history)
            snapshot_summary = parse_goal_snapshot_summary(fetch_range(sheet_id, tab, snapshot_range, sa_info))

            tab_payload = {
                "name": tab,
                "type": "goal" if is_goal else "normal",
                "positions_columns": positions_columns,
                "positions": positions,
                "positions_range": positions_range,
                "history": history,
                "history_range": history_range,
                "history_report": report,
                "snapshot_summary": snapshot_summary,
            }

            if is_goal:
                goal_payload = tab_payload
            else:
                normal_tabs.append(tab_payload)
        except Exception as e:
            err_msg = f"Tab '{tab}': {e}"
            print(f"  [FAIL] {err_msg}", file=sys.stderr)
            errors.append(err_msg)

    if goal_payload is None:
        goal_payload = {
            "name": "Goal",
            "type": "goal",
            "positions_columns": [],
            "positions": [],
            "positions_range": POSITIONS_RANGE,
            "history": [],
            "history_range": GOAL_RANGE,
            "history_report": {},
            "snapshot_summary": {"raw": [], "normalized": {}, "range": GOAL_SNAPSHOT_RANGE},
        }

    goal_out = {
        "sheet_id": sheet_id,
        "tab": "Goal",
        **goal_payload,
        "errors": errors,
        "generated_at": now_iso(),
        "rerun_hint": rerun,
    }
    goal_path = output_path("my_holdings_goal.json")
    write_json(goal_path, goal_out)

    tabs_out = {
        "sheet_id": sheet_id,
        "selected_tabs": [t["name"] for t in normal_tabs],
        "tabs": normal_tabs,
        "errors": errors,
        "generated_at": now_iso(),
        "rerun_hint": rerun,
    }
    tabs_path = output_path("my_holdings_tabs.json")
    write_json(tabs_path, tabs_out)

    result = {
        "ok": len(errors) == 0,
        "goal_rows": len(goal_out.get("history") or []),
        "normal_tabs": len(normal_tabs),
        "errors": errors,
        "outputs": [goal_path, tabs_path],
        "rerun_hint": rerun,
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())



