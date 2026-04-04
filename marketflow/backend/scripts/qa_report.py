"""
Generate data QA report for marketflow.db.

Checks:
- universe_symbols
- ohlcv_daily
- indicators_daily
- market_daily

Outputs:
- output/qa/qa_report_YYYY-MM-DD.json
- output/qa/qa_report_YYYY-MM-DD.md

Usage (PowerShell):
  python backend/scripts/qa_report.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import statistics
import sys
import traceback
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Dict, List, Tuple

import pandas as pd


@dataclass
class Issue:
    level: str  # CRITICAL | WARNING | INFO
    message: str
    detail: Dict[str, Any]


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def db_path() -> str:
    return os.path.join(repo_root(), "data", "marketflow.db")


def output_dir() -> str:
    return os.path.join(repo_root(), "output", "qa")


def fetchone(conn: sqlite3.Connection, sql: str, params: Tuple = ()) -> Any:
    return conn.execute(sql, params).fetchone()


def fetchall(conn: sqlite3.Connection, sql: str, params: Tuple = ()) -> List[Tuple]:
    return conn.execute(sql, params).fetchall()


def as_ratio(numer: int, denom: int) -> float:
    if denom == 0:
        return 0.0
    return numer / denom


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = fetchone(
        conn,
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    )
    return row is not None


def check_universe(conn: sqlite3.Connection, issues: List[Issue]) -> Dict[str, Any]:
    total = fetchone(conn, "SELECT COUNT(*) FROM universe_symbols")[0]
    sector_null = fetchone(
        conn,
        """
        SELECT COUNT(*)
        FROM universe_symbols
        WHERE sector IS NULL OR TRIM(sector) = ''
        """,
    )[0]
    sector_null_ratio = as_ratio(sector_null, total)
    is_active_dist = fetchall(
        conn,
        "SELECT COALESCE(is_active, -1) AS is_active, COUNT(*) FROM universe_symbols GROUP BY COALESCE(is_active, -1) ORDER BY is_active",
    )

    if total == 0:
        issues.append(Issue("CRITICAL", "universe_symbols is empty.", {"table": "universe_symbols"}))
    if sector_null_ratio > 0.30:
        issues.append(Issue("WARNING", "High NULL ratio in universe_symbols.sector.", {"ratio": sector_null_ratio}))

    return {
        "total_symbols": total,
        "sector_null_count": sector_null,
        "sector_null_ratio": sector_null_ratio,
        "is_active_distribution": [{"is_active": int(r[0]), "count": int(r[1])} for r in is_active_dist],
    }


def check_ohlcv(conn: sqlite3.Connection, issues: List[Issue]) -> Dict[str, Any]:
    total = fetchone(conn, "SELECT COUNT(*) FROM ohlcv_daily")[0]
    date_min, date_max = fetchone(conn, "SELECT MIN(date), MAX(date) FROM ohlcv_daily")
    close_null_count = fetchone(conn, "SELECT COUNT(*) FROM ohlcv_daily WHERE close IS NULL")[0]
    vol_zero_count = fetchone(conn, "SELECT COUNT(*) FROM ohlcv_daily WHERE volume = 0")[0]

    per_symbol = fetchall(
        conn,
        "SELECT symbol, COUNT(*) AS cnt FROM ohlcv_daily GROUP BY symbol ORDER BY symbol",
    )
    counts = [int(r[1]) for r in per_symbol]
    if counts:
        cnt_min = min(counts)
        cnt_median = float(statistics.median(counts))
        cnt_max = max(counts)
    else:
        cnt_min = cnt_median = cnt_max = 0

    dup_count = fetchone(
        conn,
        """
        SELECT COUNT(*)
        FROM (
          SELECT symbol, date, COUNT(*) AS c
          FROM ohlcv_daily
          GROUP BY symbol, date
          HAVING c > 1
        )
        """,
    )[0]

    extreme = fetchall(
        conn,
        """
        WITH ret AS (
          SELECT
            symbol,
            date,
            close,
            LAG(close) OVER (PARTITION BY symbol ORDER BY date) AS prev_close
          FROM ohlcv_daily
          WHERE close IS NOT NULL
        ),
        r2 AS (
          SELECT
            symbol,
            date,
            close,
            prev_close,
            ((close / prev_close) - 1.0) * 100.0 AS ret1d_pct,
            ABS(((close / prev_close) - 1.0) * 100.0) AS abs_ret
          FROM ret
          WHERE prev_close IS NOT NULL AND prev_close > 0
        )
        SELECT symbol, date, prev_close, close, ret1d_pct, abs_ret
        FROM r2
        WHERE abs_ret > 30.0
        ORDER BY abs_ret DESC
        LIMIT 20
        """,
    )

    close_null_ratio = as_ratio(close_null_count, total)
    vol_zero_ratio = as_ratio(vol_zero_count, total)

    if total == 0:
        issues.append(Issue("CRITICAL", "ohlcv_daily is empty.", {"table": "ohlcv_daily"}))
    if dup_count > 0:
        issues.append(Issue("CRITICAL", "Duplicate (symbol,date) found in ohlcv_daily.", {"duplicate_groups": int(dup_count)}))
    if close_null_ratio > 0.05:
        issues.append(Issue("CRITICAL", "close NULL ratio is too high in ohlcv_daily.", {"ratio": close_null_ratio}))
    elif close_null_ratio > 0.01:
        issues.append(Issue("WARNING", "close NULL ratio is non-trivial in ohlcv_daily.", {"ratio": close_null_ratio}))
    if vol_zero_ratio > 0.30:
        issues.append(Issue("WARNING", "volume=0 ratio is high in ohlcv_daily.", {"ratio": vol_zero_ratio}))
    if extreme:
        issues.append(Issue("INFO", "Extreme |ret1d| > 30% found (split/data error candidates).", {"count": len(extreme)}))

    return {
        "total_rows": int(total),
        "symbol_row_count_stats": {
            "min": int(cnt_min),
            "median": float(cnt_median),
            "max": int(cnt_max),
        },
        "duplicate_symbol_date_groups": int(dup_count),
        "date_range": {"min": date_min, "max": date_max},
        "close_null": {"count": int(close_null_count), "ratio": close_null_ratio},
        "volume_zero": {"count": int(vol_zero_count), "ratio": vol_zero_ratio},
        "extreme_ret1d_gt_30pct_top20": [
            {
                "symbol": r[0],
                "date": r[1],
                "prev_close": r[2],
                "close": r[3],
                "ret1d_pct": r[4],
                "abs_ret1d_pct": r[5],
            }
            for r in extreme
        ],
    }


def check_ticker_history_daily(conn: sqlite3.Connection, issues: List[Issue]) -> Dict[str, Any]:
    total = fetchone(conn, "SELECT COUNT(*) FROM ticker_history_daily")[0]
    date_min, date_max = fetchone(conn, "SELECT MIN(date), MAX(date) FROM ticker_history_daily")
    per_symbol = fetchall(
        conn,
        "SELECT symbol, COUNT(*) AS cnt FROM ticker_history_daily GROUP BY symbol ORDER BY cnt DESC, symbol",
    )
    counts = [int(r[1]) for r in per_symbol]
    if counts:
        cnt_min = min(counts)
        cnt_median = float(statistics.median(counts))
        cnt_max = max(counts)
    else:
        cnt_min = cnt_median = cnt_max = 0

    dup_count = fetchone(
        conn,
        """
        SELECT COUNT(*)
        FROM (
          SELECT symbol, date, COUNT(*) AS c
          FROM ticker_history_daily
          GROUP BY symbol, date
          HAVING c > 1
        )
        """,
    )[0]

    if total == 0:
        issues.append(Issue("CRITICAL", "ticker_history_daily is empty.", {"table": "ticker_history_daily"}))
    if dup_count > 0:
        issues.append(Issue("CRITICAL", "Duplicate (symbol,date) found in ticker_history_daily.", {"duplicate_groups": int(dup_count)}))

    return {
        "total_rows": int(total),
        "symbol_row_count_stats": {
            "min": int(cnt_min),
            "median": float(cnt_median),
            "max": int(cnt_max),
        },
        "duplicate_symbol_date_groups": int(dup_count),
        "date_range": {"min": date_min, "max": date_max},
        "symbols_top20": [
            {"symbol": r[0], "rows": int(r[1])}
            for r in per_symbol[:20]
        ],
    }


def check_indicators(conn: sqlite3.Connection, issues: List[Issue]) -> Dict[str, Any]:
    coverage_rows = fetchall(
        conn,
        """
        WITH o AS (
          SELECT symbol, COUNT(*) AS o_cnt, MAX(date) AS o_last
          FROM ohlcv_daily
          GROUP BY symbol
        ),
        i AS (
          SELECT symbol, COUNT(*) AS i_cnt, MAX(date) AS i_last
          FROM indicators_daily
          GROUP BY symbol
        )
        SELECT
          o.symbol,
          o.o_cnt,
          COALESCE(i.i_cnt, 0) AS i_cnt,
          o.o_last,
          i.i_last,
          CASE WHEN o.o_cnt = 0 THEN 0.0 ELSE (COALESCE(i.i_cnt, 0) * 1.0 / o.o_cnt) END AS coverage
        FROM o
        LEFT JOIN i ON o.symbol = i.symbol
        ORDER BY o.symbol
        """,
    )
    coverage_vals = [float(r[5]) for r in coverage_rows]
    if coverage_vals:
        cov_min = min(coverage_vals)
        cov_med = float(statistics.median(coverage_vals))
        cov_max = max(coverage_vals)
    else:
        cov_min = cov_med = cov_max = 0.0

    total_i = fetchone(conn, "SELECT COUNT(*) FROM indicators_daily")[0]
    sma200_null = fetchone(conn, "SELECT COUNT(*) FROM indicators_daily WHERE sma200 IS NULL")[0]
    rsi14_null = fetchone(conn, "SELECT COUNT(*) FROM indicators_daily WHERE rsi14 IS NULL")[0]
    sma200_null_ratio = as_ratio(sma200_null, total_i)
    rsi14_null_ratio = as_ratio(rsi14_null, total_i)

    coverage_details = []
    stale_rows = []
    low_cov = []
    max_lag_days = 0
    for symbol, o_cnt, i_cnt, o_last, i_last, raw_cov in coverage_rows:
        is_current = bool(o_last and i_last and str(i_last) >= str(o_last))
        lag_days = None
        if o_last and i_last:
            lag_days = int((pd.to_datetime(o_last) - pd.to_datetime(i_last)).days)
            if lag_days < 0:
                lag_days = 0
            max_lag_days = max(max_lag_days, lag_days)
        elif o_last and not i_last:
            lag_days = None
        row = {
            "symbol": symbol,
            "ohlcv_rows": int(o_cnt),
            "indicator_rows": int(i_cnt),
            "coverage": float(raw_cov),
            "ohlcv_last_date": o_last,
            "indicator_last_date": i_last,
            "is_current": is_current,
            "lag_days": lag_days,
        }
        coverage_details.append(row)
        if not is_current:
            stale_rows.append(row)
        if float(raw_cov) < 0.95:
            low_cov.append(row)

    low_cov_top = sorted(low_cov, key=lambda x: x["coverage"])[:20]

    if total_i == 0:
        issues.append(Issue("CRITICAL", "indicators_daily is empty.", {"table": "indicators_daily"}))
    if stale_rows:
        issues.append(
            Issue(
                "CRITICAL",
                "Some symbols have stale indicators coverage.",
                {"count": len(stale_rows), "max_lag_days": int(max_lag_days)},
            )
        )
    elif cov_min < 0.80:
        issues.append(
            Issue(
                "WARNING",
                "Some symbols have low historical indicators coverage but current latest rows.",
                {"min_coverage": cov_min, "max_lag_days": int(max_lag_days)},
            )
        )
    elif cov_min < 0.95:
        issues.append(
            Issue(
                "WARNING",
                "Some symbols have incomplete indicators coverage.",
                {"min_coverage": cov_min, "max_lag_days": int(max_lag_days)},
            )
        )
    if rsi14_null_ratio > 0.10:
        issues.append(Issue("WARNING", "rsi14 NULL ratio is higher than expected.", {"ratio": rsi14_null_ratio}))

    return {
        "total_rows": int(total_i),
        "coverage_stats": {
            "min": cov_min,
            "median": cov_med,
            "max": cov_max,
            "stale_count": len(stale_rows),
            "max_lag_days": int(max_lag_days),
        },
        "low_coverage_symbols_top20": [
            {
                "symbol": r["symbol"],
                "ohlcv_rows": int(r["ohlcv_rows"]),
                "indicator_rows": int(r["indicator_rows"]),
                "coverage": float(r["coverage"]),
                "ohlcv_last_date": r["ohlcv_last_date"],
                "indicator_last_date": r["indicator_last_date"],
                "is_current": bool(r["is_current"]),
                "lag_days": r["lag_days"],
            }
            for r in low_cov_top
        ],
        "sma200_null_ratio": sma200_null_ratio,
        "rsi14_null_ratio": rsi14_null_ratio,
    }


def check_market_daily(conn: sqlite3.Connection, issues: List[Issue]) -> Dict[str, Any]:
    total = fetchone(conn, "SELECT COUNT(*) FROM market_daily")[0]
    date_min, date_max = fetchone(conn, "SELECT MIN(date), MAX(date) FROM market_daily")
    null_stats = {}
    recent_window = 252
    for col in ["vix", "dxy", "us10y"]:
        null_cnt = fetchone(conn, f"SELECT COUNT(*) FROM market_daily WHERE {col} IS NULL")[0]
        first_nonnull, last_nonnull = fetchone(
            conn,
            f"""
            SELECT
              MIN(CASE WHEN {col} IS NOT NULL THEN date END) AS first_nonnull,
              MAX(CASE WHEN {col} IS NOT NULL THEN date END) AS last_nonnull
            FROM market_daily
            """,
        )
        recent_null_cnt = fetchone(
            conn,
            f"""
            SELECT COUNT(*)
            FROM (
              SELECT {col}
              FROM market_daily
              ORDER BY date DESC
              LIMIT {recent_window}
            )
            WHERE {col} IS NULL
            """,
        )[0]
        recent_den = min(recent_window, total)
        null_stats[col] = {
            "count": int(null_cnt),
            "ratio": as_ratio(null_cnt, total),
            "recent_window": recent_window,
            "recent_null_count": int(recent_null_cnt),
            "recent_null_ratio": as_ratio(recent_null_cnt, recent_den),
            "first_nonnull": first_nonnull,
            "last_nonnull": last_nonnull,
        }

    df = pd.read_sql_query(
        """
        SELECT date, spy, qqq, iwm, vix, dxy, us10y, us2y, oil, gold, btc
        FROM market_daily
        ORDER BY date
        """,
        conn,
    )

    spikes: List[Dict[str, Any]] = []
    if not df.empty:
        for col in ["spy", "qqq", "iwm", "vix", "dxy", "us10y", "us2y", "oil", "gold", "btc"]:
            if col not in df.columns:
                continue
            s = pd.to_numeric(df[col], errors="coerce")
            ret = s.pct_change(fill_method=None)
            hit = ret.abs() > 0.30
            for idx in df.index[hit.fillna(False)].tolist():
                spikes.append(
                    {
                        "date": str(df.loc[idx, "date"]),
                        "column": col,
                        "prev_value": None if idx == 0 else (None if pd.isna(s.iloc[idx - 1]) else float(s.iloc[idx - 1])),
                        "value": None if pd.isna(s.iloc[idx]) else float(s.iloc[idx]),
                        "pct_change": None if pd.isna(ret.iloc[idx]) else float(ret.iloc[idx]),
                        "abs_pct_change": None if pd.isna(ret.iloc[idx]) else float(abs(ret.iloc[idx])),
                    }
                )
    spikes = sorted(
        [x for x in spikes if x["abs_pct_change"] is not None],
        key=lambda x: x["abs_pct_change"],
        reverse=True,
    )[:30]

    if total == 0:
        issues.append(Issue("CRITICAL", "market_daily is empty.", {"table": "market_daily"}))
    for col in ["vix", "dxy", "us10y"]:
        recent_ratio = null_stats[col]["recent_null_ratio"]
        if recent_ratio > 0.50:
            issues.append(
                Issue(
                    "CRITICAL",
                    f"{col} NULL ratio is too high in recent market_daily window.",
                    {"recent_null_ratio": recent_ratio, "overall_null_ratio": null_stats[col]["ratio"]},
                )
            )
        elif recent_ratio > 0.20:
            issues.append(
                Issue(
                    "WARNING",
                    f"{col} NULL ratio is high in recent market_daily window.",
                    {"recent_null_ratio": recent_ratio, "overall_null_ratio": null_stats[col]["ratio"]},
                )
            )
    if spikes:
        issues.append(Issue("INFO", "30%+ day-over-day spikes found in market_daily series.", {"count": len(spikes)}))

    return {
        "total_rows": int(total),
        "date_range": {"min": date_min, "max": date_max},
        "null_ratios": null_stats,
        "recent_window_rows": int(min(recent_window, total)),
        "spikes_abs_pct_gt_30_top30": spikes,
    }


def write_outputs(report: Dict[str, Any], issues: List[Issue]) -> Tuple[str, str]:
    os.makedirs(output_dir(), exist_ok=True)
    d = date.today().isoformat()
    json_path = os.path.join(output_dir(), f"qa_report_{d}.json")
    md_path = os.path.join(output_dir(), f"qa_report_{d}.md")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    level_order = {"CRITICAL": 0, "WARNING": 1, "INFO": 2}
    issues_sorted = sorted(issues, key=lambda x: level_order.get(x.level, 99))

    lines: List[str] = []
    lines.append(f"# QA Report ({d})")
    lines.append("")
    lines.append("## Issue Summary")
    for lvl in ["CRITICAL", "WARNING", "INFO"]:
        cnt = len([i for i in issues_sorted if i.level == lvl])
        lines.append(f"- {lvl}: {cnt}")
    lines.append("")
    if issues_sorted:
        lines.append("## Issues")
        for it in issues_sorted:
            lines.append(f"- **[{it.level}]** {it.message} | detail={it.detail}")
        lines.append("")

    lines.append("## A) universe_symbols")
    lines.append(f"- total_symbols: {report['universe_symbols']['total_symbols']}")
    lines.append(f"- sector_null_ratio: {report['universe_symbols']['sector_null_ratio']:.4f}")
    lines.append(f"- is_active_distribution: {report['universe_symbols']['is_active_distribution']}")
    lines.append("")

    lines.append("## B) ohlcv_daily")
    o = report["ohlcv_daily"]
    lines.append(f"- total_rows: {o['total_rows']}")
    lines.append(f"- symbol_row_count_stats: {o['symbol_row_count_stats']}")
    lines.append(f"- duplicate_symbol_date_groups: {o['duplicate_symbol_date_groups']}")
    lines.append(f"- date_range: {o['date_range']}")
    lines.append(f"- close_null: {o['close_null']}")
    lines.append(f"- volume_zero: {o['volume_zero']}")
    lines.append("- extreme_ret1d_gt_30pct_top20:")
    for row in o["extreme_ret1d_gt_30pct_top20"][:20]:
        lines.append(f"  - {row}")
    lines.append("")

    lines.append("## C) ticker_history_daily")
    t = report["ticker_history_daily"]
    lines.append(f"- total_rows: {t['total_rows']}")
    lines.append(f"- symbol_row_count_stats: {t['symbol_row_count_stats']}")
    lines.append(f"- duplicate_symbol_date_groups: {t['duplicate_symbol_date_groups']}")
    lines.append(f"- date_range: {t['date_range']}")
    lines.append("- symbols_top20:")
    for row in t["symbols_top20"][:20]:
        lines.append(f"  - {row}")
    lines.append("")

    lines.append("## D) indicators_daily")
    i = report["indicators_daily"]
    lines.append(f"- total_rows: {i['total_rows']}")
    lines.append(f"- coverage_stats: {i['coverage_stats']}")
    lines.append(f"- sma200_null_ratio: {i['sma200_null_ratio']:.4f}")
    lines.append(f"- rsi14_null_ratio: {i['rsi14_null_ratio']:.4f}")
    lines.append("- low_coverage_symbols_top20:")
    for row in i["low_coverage_symbols_top20"][:20]:
        lines.append(f"  - {row}")
    lines.append("")

    lines.append("## E) market_daily")
    m = report["market_daily"]
    lines.append(f"- total_rows: {m['total_rows']}")
    lines.append(f"- date_range: {m['date_range']}")
    lines.append(f"- null_ratios: {m['null_ratios']}")
    lines.append(f"- recent_window_rows: {m['recent_window_rows']}")
    lines.append("- spikes_abs_pct_gt_30_top30:")
    for row in m["spikes_abs_pct_gt_30_top30"][:30]:
        lines.append(f"  - {row}")
    lines.append("")

    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    return json_path, md_path


def print_console_summary(issues: List[Issue], json_path: str, md_path: str) -> None:
    grouped: Dict[str, List[Issue]] = defaultdict(list)
    for it in issues:
        grouped[it.level].append(it)

    for lvl in ["CRITICAL", "WARNING", "INFO"]:
        print(f"{lvl}: {len(grouped[lvl])}")
        for it in grouped[lvl]:
            print(f" - {it.message} | {it.detail}")
    print(f"[OUTPUT] JSON: {json_path}")
    print(f"[OUTPUT] MD: {md_path}")


def main() -> int:
    path = db_path()
    if not os.path.exists(path):
        print(f"[ERROR] DB not found: {path}")
        print("Run: python backend/scripts/init_db.py")
        return 1

    conn = sqlite3.connect(path)
    issues: List[Issue] = []
    try:
        required_tables = ["universe_symbols", "ohlcv_daily", "ticker_history_daily", "indicators_daily", "market_daily"]
        for t in required_tables:
            if not table_exists(conn, t):
                issues.append(Issue("CRITICAL", f"Missing table: {t}", {"table": t}))

        if any(i.level == "CRITICAL" and "Missing table" in i.message for i in issues):
            report = {
                "generated_at": datetime.now().isoformat(timespec="seconds"),
                "db_path": path,
                "universe_symbols": {},
                "ohlcv_daily": {},
                "ticker_history_daily": {},
                "indicators_daily": {},
                "market_daily": {},
            }
            json_path, md_path = write_outputs(report, issues)
            print_console_summary(issues, json_path, md_path)
            return 1

        report = {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "db_path": path,
            "universe_symbols": check_universe(conn, issues),
            "ohlcv_daily": check_ohlcv(conn, issues),
            "ticker_history_daily": check_ticker_history_daily(conn, issues),
            "indicators_daily": check_indicators(conn, issues),
            "market_daily": check_market_daily(conn, issues),
        }

        json_path, md_path = write_outputs(report, issues)
        print_console_summary(issues, json_path, md_path)
        return 0
    except Exception as e:
        print(f"[FATAL] qa_report failed: {type(e).__name__}: {e}")
        print(traceback.format_exc())
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
