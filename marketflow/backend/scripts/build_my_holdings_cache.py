"""
Build enriched My Holdings JSON (cache-only, fs-based).

Input:
- backend/output/my_holdings.json (from CSV import or manual edit)

Output:
- backend/output/my_holdings.json (enriched, data_version=my_holdings_v2)
- output/cache/my_holdings.json (compat mirror)
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple


DATA_VERSION = "my_holdings_v2"
RERUN_HINT = "python backend/scripts/build_my_holdings_cache.py"


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def db_path() -> str:
    return os.path.join(repo_root(), "data", "marketflow.db")


def raw_input_candidates() -> List[str]:
    return [
        os.path.join(repo_root(), "backend", "output", "my_holdings.json"),
        os.path.join(repo_root(), "output", "my_holdings.json"),
    ]


def output_targets() -> List[str]:
    return [
        os.path.join(repo_root(), "backend", "output", "my_holdings.json"),
        os.path.join(repo_root(), "output", "cache", "my_holdings.json"),
    ]


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def to_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def to_float_or_none(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        text = str(v).strip()
        if text == "":
            return None
        text = text.replace(",", "").replace("$", "").replace("%", "")
        value = float(text)
        if value != value:
            return None
        return value
    except Exception:
        return None


def normalize_symbol(v: Any) -> str:
    s = str(v or "").strip().upper()
    if not s:
        return ""
    if not re.match(r"^[A-Z0-9.\-]{1,15}$", s):
        return ""
    return s


def load_raw_holdings() -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    for p in raw_input_candidates():
        if not os.path.exists(p):
            continue
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f), p
        except Exception:
            continue
    return None, None


def resolve_row_value(row: Dict[str, Any], key: str) -> Optional[float]:
    return to_float_or_none(row.get(key))


def normalize_raw_positions(raw: Dict[str, Any]) -> Tuple[float, List[Dict[str, Any]], List[Dict[str, Any]]]:
    cash = to_float(raw.get("cash"), 0.0)
    src_rows = raw.get("positions") if isinstance(raw.get("positions"), list) else []
    out: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []

    for idx, item in enumerate(src_rows, start=1):
        if not isinstance(item, dict):
            errors.append({"type": "row", "line": idx, "message": "Position row is not an object"})
            continue

        symbol = normalize_symbol(item.get("symbol"))
        if not symbol:
            errors.append({"type": "row", "line": idx, "message": "Invalid symbol"})
            continue

        shares = to_float_or_none(item.get("shares"))
        if shares is None:
            shares = to_float_or_none(item.get("qty"))
        if shares is None or shares <= 0:
            errors.append({"type": "row", "line": idx, "symbol": symbol, "message": "Invalid shares/qty"})
            continue

        avg_cost = to_float_or_none(item.get("avg_cost"))
        if avg_cost is None:
            avg_cost = 0.0

        out.append(
            {
                "symbol": symbol,
                "shares": float(shares),
                "avg_cost": float(avg_cost),
                "input": item,
            }
        )
    return cash, out, errors


def fetch_latest_indicators(conn: sqlite3.Connection, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    if not symbols:
        return {}
    placeholders = ",".join("?" for _ in symbols)
    sql = f"""
    SELECT i.symbol, i.date, i.sma20, i.sma50, i.sma200, i.rsi14
    FROM indicators_daily i
    INNER JOIN (
      SELECT symbol, MAX(date) AS max_date
      FROM indicators_daily
      WHERE symbol IN ({placeholders})
      GROUP BY symbol
    ) m ON m.symbol = i.symbol AND m.max_date = i.date
    """
    rows = conn.execute(sql, symbols).fetchall()
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        out[str(r[0])] = {
            "date": r[1],
            "sma20": to_float_or_none(r[2]),
            "sma50": to_float_or_none(r[3]),
            "sma200": to_float_or_none(r[4]),
            "rsi14": to_float_or_none(r[5]),
        }
    return out


def fetch_ohlcv_series(conn: sqlite3.Connection, symbols: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    if not symbols:
        return {}
    placeholders = ",".join("?" for _ in symbols)
    date_from = (datetime.now() - timedelta(days=500)).strftime("%Y-%m-%d")
    sql = f"""
    SELECT symbol, date, close, high, low, volume
    FROM ohlcv_daily
    WHERE symbol IN ({placeholders})
      AND date >= ?
    ORDER BY symbol ASC, date DESC
    """
    rows = conn.execute(sql, [*symbols, date_from]).fetchall()
    out: Dict[str, List[Dict[str, Any]]] = {s: [] for s in symbols}
    for r in rows:
        symbol = str(r[0])
        out.setdefault(symbol, []).append(
            {
                "date": str(r[1]),
                "close": to_float_or_none(r[2]),
                "high": to_float_or_none(r[3]),
                "low": to_float_or_none(r[4]),
                "volume": to_float_or_none(r[5]),
            }
        )
    return out


def sma_latest(closes_desc: List[float], window: int) -> Optional[float]:
    if window <= 0 or len(closes_desc) < window:
        return None
    return sum(closes_desc[:window]) / float(window)


def rsi_latest_from_closes_desc(closes_desc: List[float], period: int = 14) -> Optional[float]:
    if len(closes_desc) < period + 1:
        return None
    closes_asc = list(reversed(closes_desc))
    gains: List[float] = []
    losses: List[float] = []
    for i in range(1, period + 1):
        diff = closes_asc[i] - closes_asc[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    for i in range(period + 1, len(closes_asc)):
        diff = closes_asc[i] - closes_asc[i - 1]
        gain = max(diff, 0.0)
        loss = max(-diff, 0.0)
        avg_gain = ((avg_gain * (period - 1)) + gain) / period
        avg_loss = ((avg_loss * (period - 1)) + loss) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def max_drawdown_from_history(history: List[Dict[str, Any]]) -> Optional[float]:
    if not history:
        return None
    peak = to_float(history[0].get("equity"), 0.0)
    if peak <= 0:
        return None
    mdd = 0.0
    for row in history:
        eq = to_float(row.get("equity"), 0.0)
        if eq > peak:
            peak = eq
        if peak > 0:
            drawdown = (eq - peak) / peak * 100.0
            if drawdown < mdd:
                mdd = drawdown
    return round(mdd, 4)


def build_portfolio_history(
    positions: List[Dict[str, Any]],
    series_map: Dict[str, List[Dict[str, Any]]],
    cash: float,
) -> List[Dict[str, Any]]:
    if not positions:
        return []

    symbols = [p["symbol"] for p in positions]
    date_set = set()
    series_by_symbol: Dict[str, Dict[str, float]] = {}
    for symbol in symbols:
        rows = series_map.get(symbol, [])
        per_date: Dict[str, float] = {}
        for row in rows[:320]:
            close = to_float_or_none(row.get("close"))
            if close is None:
                continue
            date = str(row.get("date"))
            date_set.add(date)
            per_date[date] = close
        series_by_symbol[symbol] = per_date
    dates = sorted(date_set)
    if not dates:
        return []

    last_price = {p["symbol"]: float(p.get("avg_cost") or 0.0) for p in positions}
    history: List[Dict[str, Any]] = []
    for date in dates:
        total_equity = float(cash)
        for p in positions:
            symbol = p["symbol"]
            maybe_close = series_by_symbol.get(symbol, {}).get(date)
            if maybe_close is not None and maybe_close > 0:
                last_price[symbol] = maybe_close
            total_equity += float(p["shares"]) * float(last_price.get(symbol, 0.0))
        history.append({"date": date, "equity": round(total_equity, 4)})
    return history[-252:]


def round_or_none(v: Optional[float], digits: int = 4) -> Optional[float]:
    if v is None:
        return None
    return round(float(v), digits)


def build_payload(raw: Optional[Dict[str, Any]], raw_path: Optional[str]) -> Dict[str, Any]:
    if raw is None:
        return {
            "data_version": DATA_VERSION,
            "generated_at": now_iso(),
            "status": "missing_input",
            "source": None,
            "source_path": raw_path,
            "summary": {
                "total_equity": 0.0,
                "total_cost": 0.0,
                "total_pnl": 0.0,
                "today_pnl": 0.0,
                "mdd_portfolio_pct": None,
                "cash": 0.0,
                "position_count": 0,
            },
            "positions": [],
            "errors": [{"type": "missing_input", "message": "my_holdings.json not found"}],
            "rerun_hint": "POST /api/my/import-csv or run python backend/scripts/import_holdings_csv.py --csv docs/my_holdings_template_v2.csv",
        }

    cash, positions, parse_errors = normalize_raw_positions(raw)
    inherited_errors = raw.get("errors") if isinstance(raw.get("errors"), list) else []
    all_errors: List[Dict[str, Any]] = [*inherited_errors, *parse_errors]

    if not positions:
        return {
            "data_version": DATA_VERSION,
            "generated_at": now_iso(),
            "status": "empty_positions",
            "source": raw.get("source"),
            "source_path": raw_path,
            "summary": {
                "total_equity": round(cash, 4),
                "total_cost": round(cash, 4),
                "total_pnl": 0.0,
                "today_pnl": 0.0,
                "mdd_portfolio_pct": None,
                "cash": round(cash, 4),
                "position_count": 0,
            },
            "positions": [],
            "errors": all_errors,
            "rerun_hint": RERUN_HINT,
        }

    conn = sqlite3.connect(db_path())
    try:
        ind_map = fetch_latest_indicators(conn, [p["symbol"] for p in positions])
        series_map = fetch_ohlcv_series(conn, [p["symbol"] for p in positions])
    finally:
        conn.close()

    enriched_rows: List[Dict[str, Any]] = []
    as_of_dates: List[str] = []
    total_equity_without_cash = 0.0
    total_cost_without_cash = 0.0
    total_today_pnl = 0.0

    for p in positions:
        symbol = p["symbol"]
        shares = float(p["shares"])
        avg_cost = float(p["avg_cost"])
        input_row = p.get("input") if isinstance(p.get("input"), dict) else {}
        rows_desc = series_map.get(symbol, [])
        closes_desc = [float(x["close"]) for x in rows_desc if x.get("close") is not None]
        highs_desc = [float(x["high"]) for x in rows_desc if x.get("high") is not None]
        lows_desc = [float(x["low"]) for x in rows_desc if x.get("low") is not None]
        latest_volume = rows_desc[0].get("volume") if rows_desc else None

        computed_today_close = closes_desc[0] if len(closes_desc) >= 1 else None
        computed_yesterday_close = closes_desc[1] if len(closes_desc) >= 2 else None
        computed_change_pct = (
            ((computed_today_close - computed_yesterday_close) / computed_yesterday_close * 100.0)
            if computed_today_close is not None and computed_yesterday_close not in (None, 0.0)
            else None
        )
        computed_equity = (shares * computed_today_close) if computed_today_close is not None else None
        computed_cost_basis = shares * avg_cost
        computed_buy_total = computed_cost_basis
        computed_pnl_today = (
            shares * (computed_today_close - computed_yesterday_close)
            if computed_today_close is not None and computed_yesterday_close is not None
            else None
        )
        computed_volume_k = (latest_volume / 1000.0) if latest_volume is not None else None
        computed_high_52w = max(highs_desc[:252]) if highs_desc else None
        computed_low_52w = min(lows_desc[:252]) if lows_desc else None
        computed_ma5 = sma_latest(closes_desc, 5)
        computed_ma120 = sma_latest(closes_desc, 120)
        computed_ma200 = (
            to_float_or_none((ind_map.get(symbol) or {}).get("sma200"))
            or sma_latest(closes_desc, 200)
        )
        computed_rsi = (
            to_float_or_none((ind_map.get(symbol) or {}).get("rsi14"))
            or rsi_latest_from_closes_desc(closes_desc, 14)
        )
        sparkline_30 = list(reversed(closes_desc[:30])) if len(closes_desc) >= 2 else []

        today_close = resolve_row_value(input_row, "today_close")
        if today_close is None:
            today_close = computed_today_close
        yesterday_close = resolve_row_value(input_row, "yesterday_close")
        if yesterday_close is None:
            yesterday_close = computed_yesterday_close

        equity = resolve_row_value(input_row, "equity")
        if equity is None:
            equity = (shares * today_close) if today_close is not None else computed_equity

        cost_basis = resolve_row_value(input_row, "cost_basis")
        if cost_basis is None:
            cost_basis = computed_cost_basis

        buy_total = resolve_row_value(input_row, "buy_total")
        if buy_total is None:
            buy_total = computed_buy_total

        change_pct = resolve_row_value(input_row, "change_pct")
        if change_pct is None:
            change_pct = computed_change_pct

        pnl_today = resolve_row_value(input_row, "pnl_today")
        if pnl_today is None:
            pnl_today = computed_pnl_today

        cum_pnl_usd = resolve_row_value(input_row, "cum_pnl_usd")
        if cum_pnl_usd is None and equity is not None and cost_basis is not None:
            cum_pnl_usd = equity - cost_basis

        cum_return_pct = resolve_row_value(input_row, "cum_return_pct")
        if cum_return_pct is None and cum_pnl_usd is not None and cost_basis not in (None, 0.0):
            cum_return_pct = (cum_pnl_usd / cost_basis) * 100.0

        rsi = resolve_row_value(input_row, "rsi")
        if rsi is None:
            rsi = computed_rsi

        volume_k = resolve_row_value(input_row, "volume_k")
        if volume_k is None:
            volume_k = computed_volume_k

        high_52w = resolve_row_value(input_row, "high_52w")
        if high_52w is None:
            high_52w = computed_high_52w

        low_52w = resolve_row_value(input_row, "low_52w")
        if low_52w is None:
            low_52w = computed_low_52w

        ma5 = resolve_row_value(input_row, "ma5")
        if ma5 is None:
            ma5 = computed_ma5

        ma120 = resolve_row_value(input_row, "ma120")
        if ma120 is None:
            ma120 = computed_ma120

        ma200 = resolve_row_value(input_row, "ma200")
        if ma200 is None:
            ma200 = computed_ma200

        row_mdd_pct = resolve_row_value(input_row, "mdd_pct")
        note = str(input_row.get("note") or "").strip() if isinstance(input_row, dict) else ""

        latest_date = str(rows_desc[0]["date"]) if rows_desc else None
        if latest_date:
            as_of_dates.append(latest_date)

        if equity is not None:
            total_equity_without_cash += equity
        if cost_basis is not None:
            total_cost_without_cash += cost_basis
        if pnl_today is not None:
            total_today_pnl += pnl_today

        enriched_rows.append(
            {
                "symbol": symbol,
                "yesterday_close": round_or_none(yesterday_close, 6),
                "today_close": round_or_none(today_close, 6),
                "change_pct": round_or_none(change_pct, 6),
                "pnl_today": round_or_none(pnl_today, 6),
                "avg_cost": round_or_none(avg_cost, 6),
                "equity": round_or_none(equity, 6),
                "cost_basis": round_or_none(cost_basis, 6),
                "buy_total": round_or_none(buy_total, 6),
                "rsi": round_or_none(rsi, 6),
                "position_pct": None,
                "shares": round_or_none(shares, 6),
                "cum_return_pct": round_or_none(cum_return_pct, 6),
                "cum_pnl_usd": round_or_none(cum_pnl_usd, 6),
                "mdd_pct": round_or_none(row_mdd_pct, 6),
                "volume_k": round_or_none(volume_k, 6),
                "high_52w": round_or_none(high_52w, 6),
                "low_52w": round_or_none(low_52w, 6),
                "ma5": round_or_none(ma5, 6),
                "ma120": round_or_none(ma120, 6),
                "ma200": round_or_none(ma200, 6),
                "note": note,
                "as_of_date": latest_date,
                "sparkline_30": [round(float(x), 6) for x in sparkline_30],
            }
        )

    total_equity = cash + total_equity_without_cash
    total_cost = cash + total_cost_without_cash
    total_pnl = total_equity - total_cost
    if total_equity <= 0:
        total_equity = cash + total_cost_without_cash

    for row in enriched_rows:
        eq = to_float_or_none(row.get("equity"))
        if eq is None or total_equity <= 0:
            row["position_pct"] = None
        else:
            row["position_pct"] = round((eq / total_equity) * 100.0, 6)

    portfolio_history = build_portfolio_history(positions, series_map, cash)
    mdd_portfolio_pct = max_drawdown_from_history(portfolio_history)

    status = "partial" if all_errors else "ok"
    payload = {
        "data_version": DATA_VERSION,
        "generated_at": now_iso(),
        "status": status,
        "source": raw.get("source"),
        "source_path": raw_path,
        "as_of_date": max(as_of_dates) if as_of_dates else None,
        "summary": {
            "total_equity": round(total_equity, 6),
            "total_cost": round(total_cost, 6),
            "total_pnl": round(total_pnl, 6),
            "today_pnl": round(total_today_pnl, 6),
            "mdd_portfolio_pct": round_or_none(mdd_portfolio_pct, 6),
            "cash": round(cash, 6),
            "position_count": len(enriched_rows),
        },
        "positions": enriched_rows,
        "errors": all_errors,
        "rerun_hint": RERUN_HINT,
    }
    return payload


def write_outputs(payload: Dict[str, Any]) -> List[str]:
    written: List[str] = []
    for target in output_targets():
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        written.append(target)
    return written


def main() -> int:
    raw, raw_path = load_raw_holdings()
    payload = build_payload(raw, raw_path)
    written = write_outputs(payload)

    print("build_my_holdings_cache.py")
    print(f"status={payload.get('status')}")
    print(f"positions={payload.get('summary', {}).get('position_count', 0)}")
    print(f"total_equity={payload.get('summary', {}).get('total_equity', 0)}")
    print(f"errors={len(payload.get('errors') or [])}")
    for p in written:
        print(f"[OK] {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
