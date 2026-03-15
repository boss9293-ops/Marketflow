"""
Optional Google Sheets pull for holdings.

Disabled by default. Required env vars:
- GOOGLE_SHEETS_ID
- GOOGLE_SHEETS_RANGE
- GOOGLE_SERVICE_ACCOUNT_JSON

Writes:
- backend/output/my_holdings.json
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


RERUN_HINT = "Set GOOGLE_* env vars then run: python backend/scripts/pull_google_sheet_holdings.py"


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def output_path() -> str:
    return os.path.join(repo_root(), "backend", "output", "my_holdings.json")


def env_or_empty(key: str) -> str:
    return os.getenv(key, "").strip()


def normalize_symbol(raw: Any) -> str:
    s = str(raw or "").strip().upper()
    if not s:
        return ""
    if not re.match(r"^[A-Z0-9.\-]{1,15}$", s):
        return ""
    return s


def parse_float(raw: Any) -> Optional[float]:
    try:
        v = float(str(raw).strip())
    except Exception:
        return None
    if v != v:
        return None
    return v


def load_service_account_info(raw: str) -> Dict[str, Any]:
    # Allow either raw JSON string or a file path in GOOGLE_SERVICE_ACCOUNT_JSON.
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


def fetch_sheet_rows(sheet_id: str, sheet_range: str, service_account_info: Dict[str, Any]) -> List[List[Any]]:
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except Exception as e:
        raise RuntimeError(
            "Missing Google API dependencies. Install with: pip install google-auth google-api-python-client"
        ) from e

    scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    creds = service_account.Credentials.from_service_account_info(service_account_info, scopes=scopes)
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    resp = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=sheet_id, range=sheet_range)
        .execute()
    )
    rows = resp.get("values", []) or []
    if not isinstance(rows, list):
        rows = []
    return rows


def parse_positions(rows: List[List[Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if not rows:
        return [], {
            "rows_total": 0,
            "rows_imported": 0,
            "rows_rejected": 0,
            "rows_skipped_empty": 0,
            "rejected": [],
        }

    headers = [str(x or "").strip().lower() for x in rows[0]]
    idx_symbol = headers.index("symbol") if "symbol" in headers else -1
    idx_shares = headers.index("shares") if "shares" in headers else -1
    idx_avg_cost = headers.index("avg_cost") if "avg_cost" in headers else -1
    idx_currency = headers.index("currency") if "currency" in headers else -1

    if idx_symbol < 0 or idx_shares < 0 or idx_avg_cost < 0:
        raise ValueError("Google sheet header must include: symbol,shares,avg_cost (currency optional).")

    def cell(row: List[Any], idx: int) -> str:
        if idx < 0 or idx >= len(row):
            return ""
        return str(row[idx] or "").strip()

    positions: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    rows_total = 0
    rows_skipped_empty = 0

    for line_no, row in enumerate(rows[1:], start=2):
        rows_total += 1
        if not any(str(c or "").strip() for c in row):
            rows_skipped_empty += 1
            continue

        symbol = normalize_symbol(cell(row, idx_symbol))
        if not symbol:
            rejected.append({"line": line_no, "reason": "invalid symbol"})
            continue

        shares = parse_float(cell(row, idx_shares))
        avg_cost = parse_float(cell(row, idx_avg_cost))
        if shares is None or avg_cost is None:
            rejected.append({"line": line_no, "symbol": symbol, "reason": "invalid shares/avg_cost"})
            continue
        if shares <= 0:
            rejected.append({"line": line_no, "symbol": symbol, "reason": "shares must be > 0"})
            continue
        if avg_cost < 0:
            rejected.append({"line": line_no, "symbol": symbol, "reason": "avg_cost must be >= 0"})
            continue

        item: Dict[str, Any] = {
            "symbol": symbol,
            "shares": round(shares, 6),
            "avg_cost": round(avg_cost, 6),
        }
        cur = cell(row, idx_currency).upper() if idx_currency >= 0 else ""
        if cur:
            item["currency"] = cur

        positions.append(item)

    report = {
        "rows_total": rows_total,
        "rows_imported": len(positions),
        "rows_rejected": len(rejected),
        "rows_skipped_empty": rows_skipped_empty,
        "rejected": rejected,
    }
    return positions, report


def build_payload(
    positions: List[Dict[str, Any]],
    report: Dict[str, Any],
    sheet_id: str,
    sheet_range: str,
) -> Dict[str, Any]:
    total_cost = 0.0
    for p in positions:
        total_cost += float(p.get("shares", 0) or 0) * float(p.get("avg_cost", 0) or 0)

    status = "ok" if positions else "empty_positions"
    return {
        "data_version": "my_holdings_raw_v2",
        "generated_at": now_iso(),
        "status": status,
        "source": "google_sheets",
        "source_sheet": {
            "id": sheet_id,
            "range": sheet_range,
        },
        "summary": {
            "position_count": len(positions),
            "total_cost": round(total_cost, 2),
            "total_equity": None,
            "note": "total_equity placeholder until live price valuation is available",
        },
        "positions": positions,
        "import_report": report,
        "rerun_hint": RERUN_HINT,
    }


def write_payload(payload: Dict[str, Any], out: str) -> None:
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def main() -> int:
    sheet_id = env_or_empty("GOOGLE_SHEETS_ID")
    sheet_range = env_or_empty("GOOGLE_SHEETS_RANGE")
    sa_raw = env_or_empty("GOOGLE_SERVICE_ACCOUNT_JSON")

    missing = []
    if not sheet_id:
        missing.append("GOOGLE_SHEETS_ID")
    if not sheet_range:
        missing.append("GOOGLE_SHEETS_RANGE")
    if not sa_raw:
        missing.append("GOOGLE_SERVICE_ACCOUNT_JSON")
    if missing:
        print(
            "[SKIP] Google Sheets pull disabled by default. Missing env: "
            + ", ".join(missing)
        )
        return 0

    try:
        sa_info = load_service_account_info(sa_raw)
        rows = fetch_sheet_rows(sheet_id, sheet_range, sa_info)
        positions, report = parse_positions(rows)
        payload = build_payload(positions, report, sheet_id, sheet_range)
    except Exception as e:
        print(f"[FAIL] Google Sheets pull failed: {e}")
        return 1

    out = output_path()
    write_payload(payload, out)
    print(
        json.dumps(
            {
                "ok": True,
                "output": out,
                "positions": len(positions),
                "rows_rejected": int(report.get("rows_rejected", 0) or 0),
                "status": payload.get("status", "ok"),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
