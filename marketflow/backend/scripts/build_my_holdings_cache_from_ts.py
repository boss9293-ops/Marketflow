"""
Build holdings snapshot cache from holdings tabs output.

Reads:
  backend/output/my_holdings_tabs.json

Writes:
  backend/output/my_holdings_cache.json

Logic:
  - For each selected normal tab, take last non-empty history row and aggregate totals.
  - Positions table is sourced from each tab's positions table (top table).
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

try:
    from services.data_contract import artifact_path as contract_artifact_path
except Exception:
    try:
        from backend.services.data_contract import artifact_path as contract_artifact_path
    except Exception:
        contract_artifact_path = None

DATA_VERSION = "my_holdings_ts_snapshot_v2"


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def input_tabs_path() -> str:
    return artifact_path("my_holdings_tabs.json")


def input_goal_path() -> str:
    return artifact_path("my_holdings_goal.json")


def output_path() -> str:
    return artifact_path("my_holdings_cache.json")


def artifact_path(relative_path: str) -> str:
    rel = str(relative_path or "").replace("\\", "/").lstrip("/")
    if contract_artifact_path is not None:
        try:
            return str(contract_artifact_path(rel))
        except Exception:
            pass
    return os.path.join(repo_root(), "backend", "output", rel)


def parse_number(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        f = float(raw)
        if f != f:
            return None
        return f
    text = str(raw).strip()
    if not text:
        return None
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
        f = float(m.group(0))
        if f != f:
            return None
        return f
    except Exception:
        return None


def safe_float(v: Any) -> Optional[float]:
    return parse_number(v)


def last_non_empty(points: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for p in reversed(points or []):
        if not isinstance(p, dict):
            continue
        total = safe_float(p.get("total"))
        in_val = safe_float(p.get("in"))
        pl = safe_float(p.get("pl"))
        pl_pct = safe_float(p.get("pl_pct"))
        if total is not None or in_val is not None or pl is not None or pl_pct is not None:
            return {
                "date": p.get("date"),
                "total": total,
                "in": in_val,
                "pl": pl,
                "pl_pct": pl_pct,
            }
    return None


def get_first_string(row: Dict[str, Any], keys: List[str]) -> str:
    for k in keys:
        val = row.get(k)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def get_first_number(row: Dict[str, Any], keys: List[str]) -> Optional[float]:
    for k in keys:
        val = parse_number(row.get(k))
        if val is not None:
            return val
    return None


def map_position_row(row: Dict[str, Any], tab_name: str) -> Optional[Dict[str, Any]]:
    symbol = get_first_string(row, ["symbol", "Symbol", "종목", "티커", "Ticker"])
    if not symbol:
        return None

    shares = get_first_number(row, ["shares", "Shares", "주식수", "수량", "qty", "QTY"])
    avg_cost = get_first_number(row, ["avg_cost", "Avg Cost", "매수가", "평단가", "평균단가"])
    equity = get_first_number(row, ["equity", "Equity", "평가액", "시장가치"])
    cost_basis = get_first_number(row, ["cost_basis", "Cost Basis", "매수총액", "매입금액", "매수금액"])
    buy_total = get_first_number(row, ["buy_total", "Buy Total", "매수총액", "매입금액", "매수금액"])

    today_close = get_first_number(row, ["today_close", "Today", "오늘", "현재가"])
    yesterday_close = get_first_number(row, ["yesterday_close", "어제종가", "전일종가"])
    change_pct = get_first_number(row, ["change_pct", "Change %", "변동(%)", "등락률"])
    pnl_today = get_first_number(row, ["pnl_today", "PnL Today", "오늘 수익", "금일손익"])

    position_pct = get_first_number(row, ["position_pct", "Position %", "포지션(%)", "비중", "비중(%)"])
    cum_pnl_usd = get_first_number(row, ["cum_pnl_usd", "Cum PnL USD", "누적수익금($)", "누적손익금", "수익금"])
    cum_return_pct = get_first_number(
        row, ["cum_return_pct", "Cum Return %", "누적수익률(%)", "누작수익률(%)", "누적손익률(%)"]
    )
    mdd_pct = get_first_number(row, ["mdd_pct", "MDD %", "MDD"])
    rsi = get_first_number(row, ["rsi", "RSI"])
    volume_k = get_first_number(row, ["volume_k", "Volume (K)", "거래량(K)"])
    high_52w = get_first_number(row, ["high_52w", "H 52", "52주고가"])
    low_52w = get_first_number(row, ["low_52w", "L 52", "52주저가"])
    ma5 = get_first_number(row, ["ma5", "MA(5)", "5일선"])
    ma120 = get_first_number(row, ["ma120", "MA(120)", "120일선"])
    ma200 = get_first_number(row, ["ma200", "MA(200)", "200일선"])
    note = get_first_string(row, ["note", "Note", "비고"])

    if equity is None and shares is not None and today_close is not None:
        equity = shares * today_close
    if cost_basis is None:
        if buy_total is not None:
            cost_basis = buy_total
        elif shares is not None and avg_cost is not None:
            cost_basis = shares * avg_cost
    if buy_total is None and cost_basis is not None:
        buy_total = cost_basis

    if pnl_today is None and shares is not None and today_close is not None and yesterday_close is not None:
        pnl_today = shares * (today_close - yesterday_close)
    if change_pct is None and today_close is not None and yesterday_close not in (None, 0):
        change_pct = (today_close - yesterday_close) / yesterday_close * 100.0

    if cum_pnl_usd is None and equity is not None and cost_basis is not None:
        cum_pnl_usd = equity - cost_basis
    if cum_return_pct is None and cost_basis not in (None, 0) and cum_pnl_usd is not None:
        cum_return_pct = (cum_pnl_usd / cost_basis) * 100.0

    return {
        "symbol": symbol,
        "shares": shares,
        "position_pct": position_pct,
        "today_close": today_close,
        "yesterday_close": yesterday_close,
        "change_pct": change_pct,
        "pnl_today": pnl_today,
        "avg_cost": avg_cost,
        "equity": equity,
        "cost_basis": cost_basis,
        "buy_total": buy_total,
        "cum_pnl_usd": cum_pnl_usd,
        "cum_return_pct": cum_return_pct,
        "mdd_pct": mdd_pct,
        "rsi": rsi,
        "volume_k": volume_k,
        "high_52w": high_52w,
        "low_52w": low_52w,
        "ma5": ma5,
        "ma120": ma120,
        "ma200": ma200,
        "note": note,
        "_tab": tab_name,
    }


def main() -> int:
    src = input_tabs_path()
    if not os.path.exists(src):
        print("[WARN] my_holdings_tabs.json missing")
        print(f"[WARN] Keeping existing output if present: {output_path()}")
        return 1

    with open(src, "r", encoding="utf-8") as f:
        tabs_payload = json.load(f)
    goal_payload: Dict[str, Any] = {}
    goal_src = input_goal_path()
    if os.path.exists(goal_src):
        try:
            with open(goal_src, "r", encoding="utf-8") as f:
                loaded_goal = json.load(f)
                if isinstance(loaded_goal, dict):
                    goal_payload = loaded_goal
        except Exception:
            goal_payload = {}

    tabs = tabs_payload.get("tabs") or []
    selected_tabs = [t.get("name") for t in tabs if t.get("name")]
    sheet_id = tabs_payload.get("sheet_id")
    errors = tabs_payload.get("errors") or []

    total_equity = 0.0
    total_cost = 0.0
    total_pnl = 0.0
    last_dates: List[str] = []

    positions_by_tab: Dict[str, List[Dict[str, Any]]] = {}
    positions_columns_by_tab: Dict[str, List[str]] = {}
    positions_canon: List[Dict[str, Any]] = []

    for tab in tabs:
        name = tab.get("name")
        if not name:
            continue
        tab_positions = tab.get("positions") or []
        positions_by_tab[name] = tab_positions
        positions_columns_by_tab[name] = tab.get("positions_columns") or []

        for row in tab_positions:
            mapped = map_position_row(row, name)
            if mapped:
                positions_canon.append(mapped)

        last_row = last_non_empty(tab.get("history") or [])
        if not last_row:
            continue
        equity = last_row.get("total")
        cost = last_row.get("in")
        pnl = last_row.get("pl")
        if isinstance(equity, (int, float)):
            total_equity += float(equity)
        if isinstance(cost, (int, float)):
            total_cost += float(cost)
        if isinstance(pnl, (int, float)):
            total_pnl += float(pnl)
        if last_row.get("date"):
            last_dates.append(str(last_row.get("date")))


    positions_flat: List[Dict[str, Any]] = []
    for tab_name, rows in positions_by_tab.items():
        for row in rows:
            item = dict(row)
            item["_tab"] = tab_name
            positions_flat.append(item)

    pos_total_equity = sum(p.get("equity") or 0 for p in positions_canon if isinstance(p.get("equity"), (int, float)))
    pos_total_cost = sum(
        p.get("cost_basis") or 0 for p in positions_canon if isinstance(p.get("cost_basis"), (int, float))
    )
    pos_total_pnl = sum(
        p.get("cum_pnl_usd") or 0 for p in positions_canon if isinstance(p.get("cum_pnl_usd"), (int, float))
    )

    if total_equity <= 0 and pos_total_equity > 0:
        total_equity = pos_total_equity
    if total_cost <= 0 and pos_total_cost > 0:
        total_cost = pos_total_cost
    if total_pnl == 0 and pos_total_pnl != 0:
        total_pnl = pos_total_pnl

    total_pnl_pct = (total_pnl / total_cost * 100.0) if total_cost > 0 else None

    if total_equity > 0:
        for p in positions_canon:
            if p.get("position_pct") is None and isinstance(p.get("equity"), (int, float)):
                p["position_pct"] = (p["equity"] / total_equity) * 100.0

    status = "error" if errors else ("ok" if positions_flat else "empty")
    payload = {
        "data_version": DATA_VERSION,
        "status": status,
        "source": "holdings_tabs",
        "sheet_id": sheet_id,
        "selected_tabs": selected_tabs,
        "generated_at": now_iso(),
        "errors": errors,
        "summary": {
            "total_equity": round(total_equity, 2),
            "total_cost": round(total_cost, 2),
            "total_pnl": round(total_pnl, 2),
            "total_pnl_pct": round(total_pnl_pct, 4) if total_pnl_pct is not None else None,
            "position_count": len(positions_canon) if positions_canon else len(positions_flat),
            "as_of_date": max(last_dates) if last_dates else None,
        },
        "snapshot_summary": (goal_payload.get("snapshot_summary") if isinstance(goal_payload.get("snapshot_summary"), dict) else None),
        "positions": positions_canon if positions_canon else positions_flat,
        "positions_by_tab": positions_by_tab,
        "positions_columns_by_tab": positions_columns_by_tab,
        "rerun_hint": "python backend/run_all.py --mode holdings --sheet_id <ID> --tabs Goal,<tab1>",
    }

    os.makedirs(os.path.dirname(output_path()), exist_ok=True)
    with open(output_path(), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print("build_my_holdings_cache_from_ts.py")
    print(f"  positions={len(positions_flat)}")
    print(f"  total_equity={payload['summary']['total_equity']}")
    print(f"[OK] {output_path()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
