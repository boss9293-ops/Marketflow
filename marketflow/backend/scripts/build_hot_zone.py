"""
Build HOT ZONE cache JSON (v2).

Reads from data/marketflow.db (live):
  - ohlcv_daily
  - indicators_daily
  - universe_symbols

Outputs:
  output/hot_zone.json

Top-level structure:
{
  "generated_at": "...",
  "leaders": [...],
  "trending": [...],
  "summary": {...}
}
"""
from __future__ import annotations

import json
import os
import sqlite3
import traceback
from datetime import datetime
from typing import Any, Dict, List, Optional


TRIGGER_WEIGHTS: Dict[str, int] = {
    "3D_UP": 15,
    "VOLUME_2X": 20,
    "RSI>70": 15,
    "NEW_HIGH_20D": 20,
    "AI_SCORE_90+": 20,
    "GAP_UP": 10,
}

HOT_THRESHOLD = 50
LEADERS_LIMIT = 15
TRENDING_LIMIT = 20
LOOKBACK_DAYS = 220


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def db_path() -> str:
    return os.path.join(repo_root(), "data", "marketflow.db")


def output_path() -> str:
    return os.path.join(repo_root(), "output", "hot_zone.json")


def backend_output_path() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "output", "hot_zone.json"))


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def write_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def calc_ai_score(
    ret1d: Optional[float],
    rsi14: Optional[float],
    macd: Optional[float],
    macd_signal: Optional[float],
    close: Optional[float],
    sma20: Optional[float],
    sma50: Optional[float],
) -> int:
    """Simple composite AI score 0-100 from indicators."""
    score = 0
    if ret1d is not None and ret1d > 0:
        score += 20
    if rsi14 is not None and 50 <= rsi14 <= 72:
        score += 20
    if macd is not None and macd_signal is not None and macd > macd_signal:
        score += 20
    if close is not None and sma20 is not None and close > sma20:
        score += 20
    if sma20 is not None and sma50 is not None and sma20 > sma50:
        score += 20
    return score


def build_tags(
    change_pct: float,
    vol_ratio: Optional[float],
    ai_score: int,
    triggers: List[str],
    hot_score: int,
) -> List[str]:
    tags: List[str] = []
    if hot_score >= HOT_THRESHOLD:
        tags.append("HOT")
    if change_pct >= 1.5:
        tags.append("GAIN")
    if vol_ratio is not None and vol_ratio >= 2.0:
        tags.append("VOLUME_SPIKE")
    if ai_score >= 80:
        tags.append("AI")
    if "NEW_HIGH_20D" in triggers:
        tags.append("BREAKOUT")
    return tags


def get_latest_date(conn: sqlite3.Connection) -> Optional[str]:
    row = conn.execute("SELECT MAX(date) FROM ohlcv_daily").fetchone()
    return row[0] if row else None


def get_latest_symbols(conn: sqlite3.Connection, latest_date: str) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT
          o.symbol,
          COALESCE(u.name, o.symbol) AS name,
          COALESCE(u.sector, '') AS sector
        FROM ohlcv_daily o
        LEFT JOIN universe_symbols u ON o.symbol = u.symbol
        WHERE o.date = ?
        ORDER BY o.symbol
        """,
        (latest_date,),
    ).fetchall()
    return [{"symbol": r[0], "name": r[1], "sector": r[2]} for r in rows]


def fetch_symbol_history(
    conn: sqlite3.Connection,
    symbols: List[str],
    latest_date: str,
) -> Dict[str, List[Dict[str, Any]]]:
    if not symbols:
        return {}

    placeholders = ",".join(["?"] * len(symbols))
    params: List[Any] = [latest_date, *symbols]
    sql = f"""
        SELECT
          o.symbol,
          o.date,
          o.open,
          o.high,
          o.low,
          o.close,
          o.volume,
          i.ret1d,
          i.rsi14,
          i.macd,
          i.macd_signal,
          i.sma20,
          i.sma50
        FROM ohlcv_daily o
        LEFT JOIN indicators_daily i
          ON o.symbol = i.symbol AND o.date = i.date
        WHERE o.date >= date(?, '-{LOOKBACK_DAYS} day')
          AND o.symbol IN ({placeholders})
        ORDER BY o.symbol, o.date
    """

    rows = conn.execute(sql, params).fetchall()
    out: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        symbol = str(r[0])
        out.setdefault(symbol, []).append(
            {
                "symbol": symbol,
                "date": r[1],
                "open": float(r[2]) if r[2] is not None else None,
                "high": float(r[3]) if r[3] is not None else None,
                "low": float(r[4]) if r[4] is not None else None,
                "close": float(r[5]) if r[5] is not None else None,
                "volume": int(r[6]) if r[6] is not None else 0,
                "ret1d": float(r[7]) if r[7] is not None else None,
                "rsi14": float(r[8]) if r[8] is not None else None,
                "macd": float(r[9]) if r[9] is not None else None,
                "macd_signal": float(r[10]) if r[10] is not None else None,
                "sma20": float(r[11]) if r[11] is not None else None,
                "sma50": float(r[12]) if r[12] is not None else None,
            }
        )
    return out


def to_change_pct(ret1d: Optional[float], close: Optional[float], prev_close: Optional[float]) -> float:
    if ret1d is not None:
        return round(ret1d * 100.0, 2)
    if close is not None and prev_close is not None and prev_close > 0:
        return round(((close / prev_close) - 1.0) * 100.0, 2)
    return 0.0


def calc_vol_ratio(prev_volumes: List[int], volume_today: int) -> Optional[float]:
    valid = [v for v in prev_volumes if v and v > 0]
    if not valid:
        return None
    avg = sum(valid) / len(valid)
    if avg <= 0:
        return None
    return round(volume_today / avg, 2)


def evaluate_triggers(
    idx: int,
    rows: List[Dict[str, Any]],
    ai_score: int,
    vol_ratio: Optional[float],
) -> List[str]:
    row = rows[idx]
    triggers: List[str] = []

    c0 = row.get("close")
    c1 = rows[idx - 1].get("close") if idx >= 1 else None
    c2 = rows[idx - 2].get("close") if idx >= 2 else None
    if c0 is not None and c1 is not None and c2 is not None and c0 > c1 > c2:
        triggers.append("3D_UP")

    if vol_ratio is not None and vol_ratio >= 2.0:
        triggers.append("VOLUME_2X")

    rsi14 = row.get("rsi14")
    if rsi14 is not None and rsi14 > 70:
        triggers.append("RSI>70")

    if c0 is not None:
        lb_start = max(0, idx - 19)
        highs = [x.get("close") for x in rows[lb_start : idx + 1] if x.get("close") is not None]
        if highs and c0 >= max(highs):
            triggers.append("NEW_HIGH_20D")

    if ai_score >= 90:
        triggers.append("AI_SCORE_90+")

    prev_high = rows[idx - 1].get("high") if idx >= 1 else None
    o0 = row.get("open")
    if o0 is not None and prev_high is not None and prev_high > 0 and o0 >= prev_high * 1.005:
        triggers.append("GAP_UP")

    return triggers


def hot_score_from_triggers(triggers: List[str]) -> int:
    score = sum(TRIGGER_WEIGHTS.get(t, 0) for t in triggers)
    if score < 0:
        return 0
    if score > 100:
        return 100
    return int(score)


def enrich_symbol_latest(
    symbol: str,
    name: str,
    sector: str,
    rows: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    if not rows:
        return None

    streak = 0
    latest_payload: Optional[Dict[str, Any]] = None

    for idx, row in enumerate(rows):
        close = row.get("close")
        if close is None:
            continue

        prev_close = rows[idx - 1].get("close") if idx >= 1 else None
        prev_volumes = [rows[j].get("volume") or 0 for j in range(max(0, idx - 20), idx)]
        vol_ratio = calc_vol_ratio(prev_volumes, row.get("volume") or 0)
        ai_score = calc_ai_score(
            row.get("ret1d"),
            row.get("rsi14"),
            row.get("macd"),
            row.get("macd_signal"),
            close,
            row.get("sma20"),
            row.get("sma50"),
        )
        triggers = evaluate_triggers(idx, rows, ai_score, vol_ratio)
        hot_score = hot_score_from_triggers(triggers)
        is_hot = hot_score >= HOT_THRESHOLD
        streak = streak + 1 if is_hot else 0

        change_pct = to_change_pct(row.get("ret1d"), close, prev_close)
        tags = build_tags(change_pct, vol_ratio, ai_score, triggers, hot_score)

        latest_payload = {
            "symbol": symbol,
            "name": name,
            "sector": sector,
            "price": round(close, 2),
            "change_pct": change_pct,
            "volume": int(row.get("volume") or 0),
            "vol_ratio": vol_ratio,
            "rsi14": round(row.get("rsi14"), 1) if row.get("rsi14") is not None else None,
            "ai_score": ai_score,
            "tags": tags,
            "triggers": triggers,
            "hot_score": hot_score,
            "streak": int(streak),
            "is_hot": is_hot,
            "date": row.get("date"),
        }

    return latest_payload


def build_sections(latest_items: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    ranked = sorted(
        latest_items,
        key=lambda x: (
            int(x.get("hot_score") or 0),
            int(x.get("streak") or 0),
            float(x.get("change_pct") or 0),
            int(x.get("ai_score") or 0),
        ),
        reverse=True,
    )

    leaders = ranked[:LEADERS_LIMIT]
    leader_set = {x["symbol"] for x in leaders}

    trending_candidates = [
        x for x in ranked
        if x["symbol"] not in leader_set
        and (
            int(x.get("streak") or 0) >= 1
            or int(x.get("hot_score") or 0) >= 40
            or len(x.get("triggers", [])) >= 2
        )
    ]
    trending = trending_candidates[:TRENDING_LIMIT]
    return {"leaders": leaders, "trending": trending}


def build_summary(
    latest_date: str,
    latest_items: List[Dict[str, Any]],
    leaders: List[Dict[str, Any]],
    trending: List[Dict[str, Any]],
) -> Dict[str, Any]:
    trigger_count: Dict[str, int] = {k: 0 for k in TRIGGER_WEIGHTS.keys()}
    for item in latest_items:
        for t in item.get("triggers", []):
            trigger_count[t] = trigger_count.get(t, 0) + 1

    total_symbols = len(latest_items)
    hot_symbols = sum(1 for x in latest_items if x.get("is_hot"))
    streak_3plus = sum(1 for x in latest_items if int(x.get("streak") or 0) >= 3)
    avg_hot_score = round(
        (sum(float(x.get("hot_score") or 0) for x in latest_items) / total_symbols) if total_symbols else 0.0,
        2,
    )

    return {
        "data_date": latest_date,
        "total_symbols": total_symbols,
        "hot_symbols": hot_symbols,
        "streak_3plus": streak_3plus,
        "avg_hot_score": avg_hot_score,
        "leaders_count": len(leaders),
        "trending_count": len(trending),
        "trigger_counts": trigger_count,
    }


def main() -> int:
    path = db_path()
    if not os.path.exists(path):
        print(f"[ERROR] DB not found: {path}")
        return 1

    conn = sqlite3.connect(path)
    try:
        latest_date = get_latest_date(conn)
        if not latest_date:
            print("[ERROR] No data in ohlcv_daily")
            return 1

        base_symbols = get_latest_symbols(conn, latest_date)
        symbols = [x["symbol"] for x in base_symbols]
        history_map = fetch_symbol_history(conn, symbols, latest_date)

        latest_items: List[Dict[str, Any]] = []
        for item in base_symbols:
            symbol = item["symbol"]
            enriched = enrich_symbol_latest(
                symbol=symbol,
                name=item["name"],
                sector=item["sector"],
                rows=history_map.get(symbol, []),
            )
            if enriched:
                latest_items.append(enriched)

        sections = build_sections(latest_items)
        leaders = sections["leaders"]
        trending = sections["trending"]
        summary = build_summary(latest_date, latest_items, leaders, trending)

        output = {
            "generated_at": now_iso(),
            "leaders": leaders,
            "trending": trending,
            "summary": summary,
        }

        out = output_path()
        out_backend = backend_output_path()
        write_json(out, output)
        write_json(out_backend, output)

        print("=" * 60)
        print("build_hot_zone.py v2")
        print(
            f"[OK] date={latest_date} symbols={summary['total_symbols']} "
            f"hot={summary['hot_symbols']} streak3+={summary['streak_3plus']}"
        )
        print(f"[OK] leaders={len(leaders)} trending={len(trending)}")
        print(f"[OK] {out}")
        print(f"[OK] {out_backend}")
        print("=" * 60)
        return 0

    except Exception as e:
        print(f"[FATAL] build_hot_zone failed: {type(e).__name__}: {e}")
        print(traceback.format_exc())
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
