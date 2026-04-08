"""
Build Smart Money v1 from local DB proxies (no external flow feed).

Inputs:
  - data/marketflow.db
  - universe_symbols, ohlcv_daily, indicators_daily

Outputs:
  - output/smart_money.json
  - backend/output/smart_money.json
  - signals table rows (signal_type='SMART_MONEY', top N only)

Usage:
  python backend/scripts/build_smart_money.py
  python backend/scripts/build_smart_money.py --date 2026-02-16
  python backend/scripts/build_smart_money.py --rebuild
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import traceback
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from smart_flow_ssot import apply_smart_flow, build_risk_context


DATA_VERSION = "smart_money_v1"
TOP_SIGNAL_N = 50
TOP_JSON_N = 20
WATCH_JSON_N = 30
LOOKBACK_DAYS = 420
RET_3M_BARS = 63


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def db_path() -> str:
    try:
        from db_utils import resolve_marketflow_db
        return resolve_marketflow_db(required_tables=("ohlcv_daily",))
    except Exception:
        return os.path.join(repo_root(), "data", "marketflow.db")


def output_path() -> str:
    return os.path.join(repo_root(), "output", "smart_money.json")


def backend_output_path() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "output", "smart_money.json"))

def output_cache_path() -> str:
    return os.path.join(repo_root(), "output", "cache", "smart_money.json")


def backend_output_cache_path() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "output", "cache", "smart_money.json"))


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def write_json(path: str, data: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def score_linear(value: Optional[float], lo: float, hi: float) -> float:
    if value is None:
        return 50.0
    if hi <= lo:
        return 50.0
    return clamp(((value - lo) / (hi - lo)) * 100.0, 0.0, 100.0)


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def latest_ohlcv_date(conn: sqlite3.Connection) -> Optional[str]:
    row = conn.execute("SELECT MAX(date) FROM ohlcv_daily").fetchone()
    return row[0] if row else None


def resolve_target_date(conn: sqlite3.Connection, requested_date: Optional[str]) -> Optional[str]:
    if requested_date:
        row = conn.execute(
            "SELECT MAX(date) FROM ohlcv_daily WHERE date <= ?",
            (requested_date,),
        ).fetchone()
        return row[0] if row and row[0] else None
    return latest_ohlcv_date(conn)


def load_universe_for_date(conn: sqlite3.Connection, target_date: str) -> List[Dict[str, Any]]:
    # Use the most recent date <= target_date per symbol (not exact match).
    # This way, symbols that haven't been updated today (e.g. update_ohlcv timed out
    # or only partial symbols updated) are still included using their last known data.
    rows = conn.execute(
        """
        SELECT
          u.symbol,
          COALESCE(u.name, u.symbol) AS name,
          COALESCE(u.sector, 'Unknown') AS sector
        FROM universe_symbols u
        WHERE COALESCE(u.is_active, 1) = 1
          AND EXISTS (
            SELECT 1 FROM ohlcv_daily o
            WHERE o.symbol = u.symbol AND o.date <= ? AND o.close IS NOT NULL
          )
        ORDER BY u.symbol
        """,
        (target_date,),
    ).fetchall()

    if rows:
        return [{"symbol": r[0], "name": r[1], "sector": r[2]} for r in rows]

    # Fallback: ohlcv_daily without universe filter
    rows = conn.execute(
        """
        SELECT
          o.symbol,
          COALESCE(u.name, o.symbol) AS name,
          COALESCE(u.sector, 'Unknown') AS sector
        FROM (
          SELECT DISTINCT symbol FROM ohlcv_daily WHERE date <= ? AND close IS NOT NULL
        ) o
        LEFT JOIN universe_symbols u ON u.symbol = o.symbol
        ORDER BY o.symbol
        """,
        (target_date,),
    ).fetchall()
    return [{"symbol": r[0], "name": r[1], "sector": r[2]} for r in rows]


def choose_benchmark(sector: str) -> str:
    text = (sector or "").lower()
    tech_keywords = ("tech", "information", "communication", "internet", "software", "semiconductor")
    return "QQQ" if any(k in text for k in tech_keywords) else "SPY"


def load_history_map(conn: sqlite3.Connection, symbols: List[str], target_date: str) -> Dict[str, List[Dict[str, Any]]]:
    if not symbols:
        return {}

    placeholders = ",".join("?" for _ in symbols)
    params: List[Any] = [target_date, target_date, *symbols]
    rows = conn.execute(
        f"""
        SELECT
          o.symbol,
          o.date,
          o.close,
          o.adj_close,
          o.volume,
          i.sma50,
          i.sma200,
          i.rsi14,
          i.atr14,
          i.vol20
        FROM ohlcv_daily o
        LEFT JOIN indicators_daily i
          ON i.symbol = o.symbol
         AND i.date = o.date
        WHERE o.date <= ?
          AND o.date >= date(?, '-{LOOKBACK_DAYS} day')
          AND o.symbol IN ({placeholders})
        ORDER BY o.symbol, o.date
        """,
        params,
    ).fetchall()

    out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        close = float(r[2]) if r[2] is not None else None
        adj_close = float(r[3]) if r[3] is not None else None
        px = adj_close if adj_close is not None else close
        out[str(r[0])].append(
            {
                "date": str(r[1]),
                "price": px,
                "volume": int(r[4] or 0),
                "sma50": float(r[5]) if r[5] is not None else None,
                "sma200": float(r[6]) if r[6] is not None else None,
                "rsi14": float(r[7]) if r[7] is not None else None,
                "atr14": float(r[8]) if r[8] is not None else None,
                "vol20": float(r[9]) if r[9] is not None else None,
            }
        )
    return dict(out)


def find_target_idx(rows: List[Dict[str, Any]], target_date: str) -> Optional[int]:
    if not rows:
        return None
    for i in range(len(rows) - 1, -1, -1):
        if rows[i]["date"] <= target_date:
            return i
    return None


def calc_ret_3m(rows: List[Dict[str, Any]], idx: int) -> Optional[float]:
    if idx is None or idx < RET_3M_BARS:
        return None
    now_px = rows[idx].get("price")
    prev_px = rows[idx - RET_3M_BARS].get("price")
    if now_px is None or prev_px is None or prev_px <= 0:
        return None
    return (now_px / prev_px) - 1.0


def calc_vol_ratio(rows: List[Dict[str, Any]], idx: int) -> Optional[float]:
    if idx is None:
        return None
    volume_today = int(rows[idx].get("volume") or 0)
    if volume_today <= 0:
        return None
    start = max(0, idx - 20)
    prev = [int(rows[i].get("volume") or 0) for i in range(start, idx)]
    prev = [v for v in prev if v > 0]
    if len(prev) < 5:
        return None
    avg = sum(prev) / len(prev)
    if avg <= 0:
        return None
    return volume_today / avg


def calc_sma50_slope(rows: List[Dict[str, Any]], idx: int) -> Optional[float]:
    if idx is None or idx < 5:
        return None
    cur = rows[idx].get("sma50")
    old = rows[idx - 5].get("sma50")
    if cur is None or old is None:
        return None
    return cur - old


def build_tags(
    vol_ratio: Optional[float],
    rs_3m: Optional[float],
    price: Optional[float],
    sma50: Optional[float],
    sma200: Optional[float],
    rsi: Optional[float],
    slope50: Optional[float],
    penalty: float,
) -> List[str]:
    tags: List[str] = []
    if vol_ratio is not None and vol_ratio >= 2.0:
        tags.append("VOLUME_SURGE")
    if rs_3m is not None and rs_3m >= 0.05:
        tags.append("RS_LEADER")
    if price is not None and sma50 is not None and price > sma50:
        tags.append("ABOVE_SMA50")
    if price is not None and sma200 is not None and price > sma200:
        tags.append("ABOVE_SMA200")
    if slope50 is not None and slope50 > 0:
        tags.append("SMA50_UP")
    if rsi is not None and 45 <= rsi <= 70:
        tags.append("RSI_HEALTHY")
    if rsi is not None and rsi >= 75:
        tags.append("RSI_OVERHEAT")
    if penalty >= 15:
        tags.append("VOLATILE")
    return tags


def compute_symbol_item(
    base: Dict[str, Any],
    rows: List[Dict[str, Any]],
    target_date: str,
    bench_ret_3m: Dict[str, Optional[float]],
) -> Optional[Dict[str, Any]]:
    idx = find_target_idx(rows, target_date)
    if idx is None:
        return None

    row = rows[idx]
    price = row.get("price")
    if price is None or price <= 0:
        return None

    ret_3m = calc_ret_3m(rows, idx)
    vol_ratio = calc_vol_ratio(rows, idx)
    sma50 = row.get("sma50")
    sma200 = row.get("sma200")
    rsi = row.get("rsi14")
    atr14 = row.get("atr14")
    vol20 = row.get("vol20")
    slope50 = calc_sma50_slope(rows, idx)

    benchmark = choose_benchmark(base.get("sector", ""))
    bench_ret = bench_ret_3m.get(benchmark)
    rs_3m = None
    if ret_3m is not None and bench_ret is not None:
        rs_3m = ret_3m - bench_ret

    vol_ratio_capped = clamp(float(vol_ratio), 0.0, 4.0) if vol_ratio is not None else None
    vol_score = score_linear(vol_ratio_capped, 1.0, 3.0)
    rs_score = score_linear(rs_3m, -0.15, 0.15)

    trend_score = 0.0
    if sma50 is not None and price > sma50:
        trend_score += 30
    if sma200 is not None and price > sma200:
        trend_score += 30
    if slope50 is not None and slope50 > 0:
        trend_score += 20
    if rsi is not None and 45 <= rsi <= 70:
        trend_score += 20
    elif rsi is not None and (rsi >= 75 or rsi <= 30):
        trend_score += 5
    trend_score = clamp(trend_score, 0.0, 100.0)

    atr_pct = (atr14 / price) if (atr14 is not None and price and price > 0) else None
    penalty = 0.0
    if atr_pct is not None:
        if atr_pct > 0.08:
            penalty += 18
        elif atr_pct > 0.06:
            penalty += 12
        elif atr_pct > 0.04:
            penalty += 6
    if vol20 is not None:
        if vol20 > 0.05:
            penalty += 15
        elif vol20 > 0.04:
            penalty += 10
        elif vol20 > 0.03:
            penalty += 5

    score = clamp((0.30 * vol_score) + (0.35 * rs_score) + (0.35 * trend_score) - penalty, 0.0, 100.0)
    tags = build_tags(vol_ratio, rs_3m, price, sma50, sma200, rsi, slope50, penalty)

    return {
        "symbol": base["symbol"],
        "name": base["name"],
        "sector": base.get("sector") or "Unknown",
        "price": round(float(price), 2),
        "vol_ratio": round(float(vol_ratio), 2) if vol_ratio is not None else None,
        "rs_3m": round(float(rs_3m), 4) if rs_3m is not None else None,
        "ret_3m": round(float(ret_3m), 4) if ret_3m is not None else None,
        "sma50": round(float(sma50), 2) if sma50 is not None else None,
        "sma200": round(float(sma200), 2) if sma200 is not None else None,
        "rsi": round(float(rsi), 1) if rsi is not None else None,
        "score": round(float(score), 2),
        "tags": tags,
        "benchmark": benchmark,
    }


def sector_summary(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    bucket: Dict[str, List[float]] = defaultdict(list)
    for it in items:
        score = float(it.get("sm_final") or it.get("score") or 0.0)
        bucket[it.get("sector") or "Unknown"].append(score)

    rows: List[Dict[str, Any]] = []
    for sector, scores in bucket.items():
        if not scores:
            continue
        rows.append(
            {
                "sector": sector,
                "count": len(scores),
                "avg_score": round(sum(scores) / len(scores), 2),
            }
        )

    ranked = sorted(rows, key=lambda x: (x["avg_score"], x["count"]), reverse=True)
    bottom = sorted(rows, key=lambda x: (x["avg_score"], -x["count"]))[:3]
    return {
        "top": ranked[:3],
        "bottom": bottom,
        "all": ranked,
    }


def upsert_smart_money_signals(
    conn: sqlite3.Connection,
    target_date: str,
    items_top_n: List[Dict[str, Any]],
    coverage: Dict[str, Any],
    rebuild: bool,
) -> Tuple[int, int, int]:
    if rebuild:
        conn.execute(
            "DELETE FROM signals WHERE date = ? AND signal_type = 'SMART_MONEY'",
            (target_date,),
        )

    existing_rows = conn.execute(
        """
        SELECT id, symbol
        FROM signals
        WHERE date = ?
          AND signal_type = 'SMART_MONEY'
          AND symbol IS NOT NULL
        """,
        (target_date,),
    ).fetchall()
    existing_by_symbol = {str(r[1]): int(r[0]) for r in existing_rows}

    inserted = 0
    updated = 0
    keep_symbols: List[str] = []

    for item in items_top_n:
        symbol = str(item["symbol"])
        keep_symbols.append(symbol)
        payload = {
            "type": "SMART_MONEY",
            "item": item,
            "meta": {
                "coverage": coverage,
                "data_version": DATA_VERSION,
            },
            "generated_at": now_iso(),
        }
        payload_json = json.dumps(payload, ensure_ascii=False)
        score = float(item.get("sm_final") or item.get("score") or 0.0)
        if symbol in existing_by_symbol:
            conn.execute(
                """
                UPDATE signals
                SET score = ?, status = 'active', payload_json = ?
                WHERE id = ?
                """,
                (score, payload_json, existing_by_symbol[symbol]),
            )
            updated += 1
        else:
            conn.execute(
                """
                INSERT INTO signals (
                  date, symbol, signal_type, score, status, payload_json, created_at
                ) VALUES (?, ?, 'SMART_MONEY', ?, 'active', ?, ?)
                """,
                (target_date, symbol, score, payload_json, now_iso()),
            )
            inserted += 1

    deleted = 0
    if keep_symbols:
        placeholders = ",".join("?" for _ in keep_symbols)
        params: List[Any] = [target_date, *keep_symbols]
        cur = conn.execute(
            f"""
            DELETE FROM signals
            WHERE date = ?
              AND signal_type = 'SMART_MONEY'
              AND symbol IS NOT NULL
              AND symbol NOT IN ({placeholders})
            """,
            params,
        )
        deleted = int(cur.rowcount or 0)
    else:
        cur = conn.execute(
            """
            DELETE FROM signals
            WHERE date = ?
              AND signal_type = 'SMART_MONEY'
              AND symbol IS NOT NULL
            """,
            (target_date,),
        )
        deleted = int(cur.rowcount or 0)
    return inserted, updated, deleted


def to_legacy_signals(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    legacy: List[Dict[str, Any]] = []
    for item in items:
        score = float(item.get("sm_final") or item.get("score") or 0.0)
        legacy.append(
            {
                "ticker": item.get("symbol"),
                "name": item.get("name"),
                "score": score,
                "volume_ratio": item.get("vol_ratio"),
                "signal": "Strong Buying" if score >= 75 else "Moderate Buying",
                "price": item.get("price"),
            }
        )
    return legacy


def read_json_or_none(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", type=str, default=None, help="target date (YYYY-MM-DD), default latest")
    parser.add_argument("--rebuild", action="store_true", help="delete SMART_MONEY rows for date before insert")
    parser.add_argument("--top-n", type=int, default=TOP_SIGNAL_N, help="max SMART_MONEY rows stored in signals table")
    args = parser.parse_args()

    top_n = max(1, int(args.top_n))
    path = db_path()
    if not os.path.exists(path):
        print(f"[ERROR] DB not found: {path}")
        print("Run: python backend/scripts/init_db.py")
        return 1

    from db_utils import db_connect
    conn = db_connect(path)
    try:
        required = ["universe_symbols", "ohlcv_daily", "indicators_daily", "signals"]
        missing = [t for t in required if not table_exists(conn, t)]
        if missing:
            print(f"[ERROR] Missing tables: {', '.join(missing)}")
            return 1

        target_date = resolve_target_date(conn, args.date)
        if not target_date:
            print("[ERROR] Could not resolve target date from ohlcv_daily.")
            return 1

        universe = load_universe_for_date(conn, target_date)
        if not universe:
            print(f"[ERROR] No eligible symbols on date={target_date}")
            return 1

        symbols = [u["symbol"] for u in universe]
        with_bench = list(dict.fromkeys([*symbols, "SPY", "QQQ"]))
        hist_map = load_history_map(conn, with_bench, target_date)

        # Benchmark 3M returns from same date anchor.
        bench_ret_3m: Dict[str, Optional[float]] = {}
        for bench in ("SPY", "QQQ"):
            rows = hist_map.get(bench, [])
            idx = find_target_idx(rows, target_date)
            bench_ret_3m[bench] = calc_ret_3m(rows, idx) if idx is not None else None

        scored: List[Dict[str, Any]] = []
        for base in universe:
            rows = hist_map.get(base["symbol"], [])
            item = compute_symbol_item(base, rows, target_date, bench_ret_3m)
            if item is not None:
                scored.append(item)

        prev_data = read_json_or_none(output_path()) or read_json_or_none(backend_output_path()) or {}
        prev_leaders = None
        if isinstance(prev_data, dict):
            prev_flow = prev_data.get("smart_flow") or {}
            prev_leaders = prev_flow.get("leaders80_count")
            if prev_leaders is None:
                prev_items = (prev_data.get("top") or []) + (prev_data.get("watch") or [])
                prev_leaders = sum(1 for it in prev_items if float(it.get("score") or 0.0) >= 80)

        context = build_risk_context()
        adjusted, excluded, flow_summary = apply_smart_flow(scored, context, prev_leaders)

        adjusted = sorted(
            adjusted,
            key=lambda x: (
                float(x.get("sm_final") or x.get("score") or 0.0),
                float(x.get("score") or 0.0),
                float(x.get("vol_ratio") or 0.0),
                float(x.get("rs_3m") or -99.0),
            ),
            reverse=True,
        )

        for i, item in enumerate(adjusted, start=1):
            item["rank"] = i

        top = adjusted[:TOP_JSON_N]
        watch = adjusted[TOP_JSON_N:TOP_JSON_N + WATCH_JSON_N]
        top_n_items = adjusted[:top_n]

        universe_total_row = conn.execute(
            "SELECT COUNT(*) FROM universe_symbols WHERE COALESCE(is_active,1)=1"
        ).fetchone()
        universe_total = int(universe_total_row[0] if universe_total_row else len(universe))
        coverage = {
            "date": target_date,
            "universe_total": universe_total,
            "eligible_with_ohlcv": len(universe),
            "scored": len(scored),
            "coverage_ratio": round((len(scored) / len(universe)) * 100.0, 1) if universe else 0.0,
            "benchmark_ret_3m": {
                "SPY": round(float(bench_ret_3m["SPY"]), 4) if bench_ret_3m.get("SPY") is not None else None,
                "QQQ": round(float(bench_ret_3m["QQQ"]), 4) if bench_ret_3m.get("QQQ") is not None else None,
            },
        }
        sectors = sector_summary(adjusted)

        inserted, updated, deleted = upsert_smart_money_signals(
            conn=conn,
            target_date=target_date,
            items_top_n=top_n_items,
            coverage=coverage,
            rebuild=args.rebuild,
        )
        conn.commit()

        output = {
            "date": target_date,
            "top": top,
            "watch": watch,
            "sectors": sectors,
            "coverage": coverage,
            "smart_flow": flow_summary,
            "excluded": excluded,
            # backward compatibility for daily_report v1 parser
            "signals": to_legacy_signals(top_n_items),
            "data_version": DATA_VERSION,
            "generated_at": now_iso(),
            "rerun_hint": "python backend/scripts/build_smart_money.py",
        }

        out = output_path()
        out_backend = backend_output_path()
        out_cache = output_cache_path()
        out_backend_cache = backend_output_cache_path()
        write_json(out, output)
        write_json(out_backend, output)
        write_json(out_cache, output)
        write_json(out_backend_cache, output)

        top_preview = [x.get("symbol") for x in top[:5]]
        print("=" * 64)
        print("build_smart_money.py v1")
        print(
            f"[OK] date={target_date} scored={len(scored)}/{len(universe)} "
            f"coverage={coverage['coverage_ratio']}% adjusted={len(adjusted)}"
        )
        print(
            f"[OK] signals SMART_MONEY topN={len(top_n_items)} "
            f"(inserted={inserted}, updated={updated}, deleted={deleted})"
        )
        print(f"[OK] top5={top_preview}")
        print(f"[OK] {out}")
        print(f"[OK] {out_backend}")
        print(f"[OK] {out_cache}")
        print(f"[OK] {out_backend_cache}")
        print("[VERIFY_SQL] SELECT COUNT(*) FROM signals WHERE signal_type='SMART_MONEY';")
        print("[VERIFY_SQL] SELECT date, symbol, score FROM signals WHERE signal_type='SMART_MONEY' ORDER BY date DESC, score DESC LIMIT 10;")
        print("[SAMPLE_JSON]")
        print(json.dumps({"date": output["date"], "top": output["top"][:2], "coverage": output["coverage"]}, ensure_ascii=False, indent=2)[:1400])
        print("=" * 64)
        return 0
    except Exception as e:
        conn.rollback()
        print(f"[FATAL] build_smart_money failed: {type(e).__name__}: {e}")
        print(traceback.format_exc())
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
