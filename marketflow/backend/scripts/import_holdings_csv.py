"""
Import holdings CSV (v2/v1 compatible) into backend/output/my_holdings.json.

Usage:
  python backend/scripts/import_holdings_csv.py --csv docs/my_holdings_template_v2.csv
  python backend/scripts/import_holdings_csv.py --csv path/to/file.csv --output backend/output/my_holdings.json
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


RERUN_HINT = "python backend/scripts/import_holdings_csv.py --csv docs/my_holdings_template_v2.csv"

CANONICAL_COLUMNS = [
    "symbol",
    "yesterday_close",
    "today_close",
    "change_pct",
    "pnl_today",
    "avg_cost",
    "equity",
    "cost_basis",
    "buy_total",
    "rsi",
    "position_pct",
    "shares",
    "cum_return_pct",
    "cum_pnl_usd",
    "mdd_pct",
    "volume_k",
    "high_52w",
    "low_52w",
    "ma5",
    "ma120",
    "ma200",
    "note",
]

COLUMN_ALIASES: Dict[str, List[str]] = {
    "symbol": ["symbol", "ticker"],
    "yesterday_close": ["yesterday_close", "prev_close", "y_close"],
    "today_close": ["today_close", "close", "current_price"],
    "change_pct": ["change_pct", "change", "change_percent", "chg_pct"],
    "pnl_today": ["pnl_today", "today_pnl", "daily_pnl"],
    "avg_cost": ["avg_cost", "average_cost", "avg_price", "cost_avg"],
    "equity": ["equity", "market_value"],
    "cost_basis": ["cost_basis", "cost_value"],
    "buy_total": ["buy_total", "buy_amount", "invested_amount"],
    "rsi": ["rsi", "rsi14"],
    "position_pct": ["position_pct", "weight_pct", "position_percent", "weight_percent"],
    "shares": ["shares", "qty", "quantity"],
    "cum_return_pct": ["cum_return_pct", "return_pct", "total_return_pct"],
    "cum_pnl_usd": ["cum_pnl_usd", "cum_pnl", "total_pnl_usd", "pnl_total"],
    "mdd_pct": ["mdd_pct", "max_drawdown_pct"],
    "volume_k": ["volume_k", "vol_k"],
    "high_52w": ["high_52w", "high52w", "high_52_week"],
    "low_52w": ["low_52w", "low52w", "low_52_week"],
    "ma5": ["ma5", "sma5"],
    "ma120": ["ma120", "sma120"],
    "ma200": ["ma200", "sma200"],
    "note": ["note", "memo", "comment"],
}


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def default_output_path() -> str:
    return os.path.join(repo_root(), "backend", "output", "my_holdings.json")


def normalize_symbol(raw: Any) -> str:
    s = str(raw or "").strip().upper()
    if not s:
        return ""
    if not re.match(r"^[A-Z0-9.\-]{1,15}$", s):
        return ""
    return s


def parse_number(raw: Any, *, allow_percent: bool = True) -> Optional[float]:
    text = str(raw or "").strip()
    if not text:
        return None
    text = text.replace(",", "").replace("$", "")
    if allow_percent:
        text = text.replace("%", "")
    try:
        value = float(text)
    except Exception:
        return None
    if value != value:
        return None
    return value


def row_empty(row: Dict[str, Any]) -> bool:
    return not any(str(v or "").strip() for v in row.values())


def resolve_column_map(fieldnames: List[str]) -> Tuple[Dict[str, Optional[str]], List[str]]:
    lower_to_original = {str(name).strip().lower(): name for name in (fieldnames or [])}
    resolved: Dict[str, Optional[str]] = {}
    used_original_names: List[str] = []
    for canonical in CANONICAL_COLUMNS:
        found = None
        for alias in COLUMN_ALIASES.get(canonical, []):
            if alias in lower_to_original:
                found = lower_to_original[alias]
                break
        resolved[canonical] = found
        if found:
            used_original_names.append(found)
    return resolved, used_original_names


def build_unknown_column_errors(fieldnames: List[str], used_original_names: List[str]) -> List[Dict[str, Any]]:
    errors: List[Dict[str, Any]] = []
    used_lower = {str(x).strip().lower() for x in used_original_names}
    for name in fieldnames or []:
        n = str(name).strip()
        if not n:
            continue
        if n.lower() in used_lower:
            continue
        errors.append(
            {
                "type": "unknown_column",
                "column": n,
                "message": f"Unsupported column '{n}'. It will be ignored.",
            }
        )
    return errors


def load_positions(csv_path: str) -> Tuple[List[Dict[str, Any]], Dict[str, Any], List[Dict[str, Any]]]:
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        if not fieldnames:
            raise ValueError("CSV header is missing.")

        colmap, used_names = resolve_column_map(fieldnames)
        errors: List[Dict[str, Any]] = build_unknown_column_errors(fieldnames, used_names)

        if not colmap.get("symbol"):
            errors.append(
                {
                    "type": "schema",
                    "column": "symbol",
                    "message": "Missing required column: symbol",
                }
            )
        if not colmap.get("shares"):
            errors.append(
                {
                    "type": "schema",
                    "column": "shares",
                    "message": "Missing required column: shares (or qty/quantity for v1 compatibility)",
                }
            )

        positions: List[Dict[str, Any]] = []
        rows_total = 0
        rows_skipped_empty = 0
        rows_rejected = 0

        numeric_optional_fields = [
            "yesterday_close",
            "today_close",
            "change_pct",
            "pnl_today",
            "equity",
            "cost_basis",
            "buy_total",
            "rsi",
            "position_pct",
            "cum_return_pct",
            "cum_pnl_usd",
            "mdd_pct",
            "volume_k",
            "high_52w",
            "low_52w",
            "ma5",
            "ma120",
            "ma200",
        ]

        for line_no, row in enumerate(reader, start=2):
            rows_total += 1
            if row_empty(row):
                rows_skipped_empty += 1
                continue

            symbol_key = colmap.get("symbol")
            shares_key = colmap.get("shares")
            avg_cost_key = colmap.get("avg_cost")
            note_key = colmap.get("note")

            symbol = normalize_symbol(row.get(symbol_key) if symbol_key else "")
            if not symbol:
                rows_rejected += 1
                errors.append(
                    {
                        "type": "row",
                        "line": line_no,
                        "column": "symbol",
                        "message": "Invalid symbol",
                    }
                )
                continue

            shares = parse_number(row.get(shares_key) if shares_key else None, allow_percent=False)
            if shares is None or shares <= 0:
                rows_rejected += 1
                errors.append(
                    {
                        "type": "row",
                        "line": line_no,
                        "symbol": symbol,
                        "column": "shares",
                        "message": "Invalid shares value (must be > 0)",
                    }
                )
                continue

            avg_cost = parse_number(row.get(avg_cost_key) if avg_cost_key else None, allow_percent=False)
            if avg_cost is None:
                avg_cost = 0.0
                errors.append(
                    {
                        "type": "row",
                        "line": line_no,
                        "symbol": symbol,
                        "column": "avg_cost",
                        "message": "avg_cost missing/invalid, defaulted to 0",
                    }
                )

            item: Dict[str, Any] = {
                "symbol": symbol,
                "shares": round(float(shares), 6),
                "avg_cost": round(float(avg_cost), 6),
            }

            for field in numeric_optional_fields:
                key = colmap.get(field)
                if not key:
                    continue
                raw_value = row.get(key)
                if str(raw_value or "").strip() == "":
                    continue
                parsed = parse_number(raw_value, allow_percent=True)
                if parsed is None:
                    errors.append(
                        {
                            "type": "row",
                            "line": line_no,
                            "symbol": symbol,
                            "column": field,
                            "message": f"Invalid numeric value: {raw_value}",
                        }
                    )
                    continue
                item[field] = round(float(parsed), 6)

            if note_key:
                note_val = str(row.get(note_key) or "").strip()
                if note_val:
                    item["note"] = note_val

            positions.append(item)

    report = {
        "rows_total": rows_total,
        "rows_imported": len(positions),
        "rows_rejected": rows_rejected,
        "rows_skipped_empty": rows_skipped_empty,
        "errors_count": len(errors),
    }
    return positions, report, errors


def build_payload(
    positions: List[Dict[str, Any]],
    report: Dict[str, Any],
    errors: List[Dict[str, Any]],
    source_csv: str,
) -> Dict[str, Any]:
    total_cost = 0.0
    for p in positions:
        total_cost += float(p.get("shares", 0) or 0) * float(p.get("avg_cost", 0) or 0)

    if not positions and errors:
        status = "error"
    elif errors:
        status = "partial"
    elif positions:
        status = "ok"
    else:
        status = "empty_positions"

    return {
        "data_version": "my_holdings_import_v2",
        "generated_at": now_iso(),
        "status": status,
        "source": "csv_import",
        "source_csv": source_csv,
        "summary": {
            "position_count": len(positions),
            "total_cost": round(total_cost, 2),
            "total_equity": None,
            "cash": 0.0,
            "note": "Imported CSV parsed. Run build_my_holdings_cache.py to enrich with market data.",
        },
        "positions": positions,
        "import_report": report,
        "errors": errors,
        "rerun_hint": RERUN_HINT,
    }


def run(csv_path: str, output_path: str) -> Dict[str, Any]:
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    positions, report, errors = load_positions(csv_path)
    payload = build_payload(positions, report, errors, csv_path)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    return payload


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Import holdings CSV into my_holdings.json")
    p.add_argument("--csv", required=True, help="Path to holdings CSV")
    p.add_argument("--output", default=default_output_path(), help="Output JSON path")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    try:
        payload = run(args.csv, args.output)
    except Exception as e:
        print(f"[ERROR] {e}")
        return 1

    report = payload.get("import_report") or {}
    print(
        json.dumps(
            {
                "ok": payload.get("status") in {"ok", "partial", "empty_positions"},
                "output": args.output,
                "status": payload.get("status"),
                "positions": len(payload.get("positions") or []),
                "rows_rejected": int(report.get("rows_rejected", 0) or 0),
                "errors_count": len(payload.get("errors") or []),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
