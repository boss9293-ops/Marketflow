"""
STEP 2: Fill indicators_daily from ohlcv_daily.

Optimizations vs v1:
  - Incremental mode (default): skip symbols already up-to-date, load only
    warmup window (200 rows) + new rows instead of full history.
  - itertuples() instead of iterrows() for row-building.
  - verify_coverage_by_symbol uses cheap COUNT queries instead of ROW_NUMBER window functions.

Usage (PowerShell):
  python backend/scripts/update_indicators.py
  python backend/scripts/update_indicators.py --limit 20
  python backend/scripts/update_indicators.py --symbols AAPL MSFT NVDA
  python backend/scripts/update_indicators.py --symbols AAPL MSFT --rebuild
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import time
import traceback
from datetime import datetime
from typing import List, Tuple

import pandas as pd
from ta.momentum import RSIIndicator
from ta.trend import EMAIndicator, MACD, SMAIndicator
from ta.volatility import AverageTrueRange


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def db_path() -> str:
    return os.path.join(repo_root(), "data", "marketflow.db")


def log_path() -> str:
    return os.path.join(repo_root(), "backend", "logs", "update_indicators.log")


def ensure_dirs() -> None:
    os.makedirs(os.path.dirname(log_path()), exist_ok=True)


def get_symbols(
    conn: sqlite3.Connection,
    limit: int | None = None,
    symbols: List[str] | None = None,
) -> List[str]:
    params: List[str] = []
    if symbols:
        placeholders = ",".join("?" for _ in symbols)
        sql = f"SELECT DISTINCT symbol FROM ohlcv_daily WHERE symbol IN ({placeholders}) ORDER BY symbol"
        params.extend(symbols)
    else:
        sql = "SELECT DISTINCT symbol FROM ohlcv_daily ORDER BY symbol"

    if limit is not None and limit > 0:
        sql += f" LIMIT {int(limit)}"

    rows = conn.execute(sql, params).fetchall()
    return [r[0] for r in rows]


def validate_required_tables(conn: sqlite3.Connection) -> None:
    required = {"ohlcv_daily", "indicators_daily"}
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ohlcv_daily','indicators_daily')"
    ).fetchall()
    existing = {r[0] for r in rows}
    missing = required - existing
    if missing:
        raise RuntimeError(f"Missing tables: {sorted(missing)}. Run: python backend/scripts/init_db.py")


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy().sort_values("date").reset_index(drop=True)
    out["calc_close"] = out["adj_close"].where(out["adj_close"].notna(), out["close"])

    out["sma20"]  = SMAIndicator(close=out["calc_close"], window=20,  fillna=False).sma_indicator()
    out["sma50"]  = SMAIndicator(close=out["calc_close"], window=50,  fillna=False).sma_indicator()
    out["sma200"] = SMAIndicator(close=out["calc_close"], window=200, fillna=False).sma_indicator()
    out["ema8"]   = EMAIndicator(close=out["calc_close"], window=8,   fillna=False).ema_indicator()
    out["ema21"]  = EMAIndicator(close=out["calc_close"], window=21,  fillna=False).ema_indicator()
    out["rsi14"]  = RSIIndicator(close=out["calc_close"], window=14,  fillna=False).rsi()

    macd_obj = MACD(close=out["calc_close"], window_slow=26, window_fast=12, window_sign=9, fillna=False)
    out["macd"]        = macd_obj.macd()
    out["macd_signal"] = macd_obj.macd_signal()

    atr_obj = AverageTrueRange(
        high=out["high"], low=out["low"], close=out["calc_close"], window=14, fillna=False
    )
    out["atr14"] = atr_obj.average_true_range()

    ret = out["calc_close"].pct_change(1)
    out["ret1d"] = ret
    out["ret5d"] = out["calc_close"].pct_change(5)
    out["vol20"] = ret.rolling(20).std()
    return out


# ── Incremental upsert ───────────────────────────────────────────────────────
def upsert_symbol(conn: sqlite3.Connection, symbol: str) -> int:
    """
    Incremental: skip if already up-to-date, otherwise load warmup window +
    new rows, compute indicators, insert only the new dates.
    Returns number of rows written (0 = skipped or no data).
    """
    # Find latest indicator date for this symbol
    row = conn.execute(
        "SELECT MAX(date) FROM indicators_daily WHERE symbol = ?", (symbol,)
    ).fetchone()
    max_ind_date: str | None = row[0] if row and row[0] else None

    if max_ind_date is not None:
        # Check whether any new OHLCV rows exist after the last indicator date
        new_count = conn.execute(
            "SELECT COUNT(*) FROM ohlcv_daily WHERE symbol = ? AND date > ?",
            (symbol, max_ind_date),
        ).fetchone()[0]
        if new_count == 0:
            return 0  # Already up-to-date — skip entirely

        # Load warmup window (200 rows before cutoff) + all new rows
        warmup_row = conn.execute(
            """
            SELECT date FROM ohlcv_daily
            WHERE symbol = ? AND date <= ?
            ORDER BY date DESC
            LIMIT 1 OFFSET 199
            """,
            (symbol, max_ind_date),
        ).fetchone()
        load_from = warmup_row[0] if warmup_row else None

        if load_from:
            df = pd.read_sql_query(
                """SELECT symbol, date, high, low, close, adj_close
                   FROM ohlcv_daily
                   WHERE symbol = ? AND date >= ?
                   ORDER BY date""",
                conn,
                params=(symbol, load_from),
            )
        else:
            df = pd.read_sql_query(
                """SELECT symbol, date, high, low, close, adj_close
                   FROM ohlcv_daily WHERE symbol = ? ORDER BY date""",
                conn,
                params=(symbol,),
            )
    else:
        # No existing indicators — full load (new symbol or post-rebuild)
        df = pd.read_sql_query(
            """SELECT symbol, date, high, low, close, adj_close
               FROM ohlcv_daily WHERE symbol = ? ORDER BY date""",
            conn,
            params=(symbol,),
        )

    if df.empty:
        return 0

    for col in ["high", "low", "close", "adj_close"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["effective_close"] = df["adj_close"].where(df["adj_close"].notna(), df["close"])
    df = df.dropna(subset=["high", "low", "effective_close"]).drop(columns=["effective_close"])
    if df.empty:
        return 0

    ind_df = compute_indicators(df)

    # In incremental mode keep only dates strictly after the last known indicator
    if max_ind_date is not None:
        ind_df = ind_df[ind_df["date"].astype(str) > max_ind_date]
    if ind_df.empty:
        return 0

    now_iso = datetime.now().isoformat(timespec="seconds")
    sql = """
    INSERT OR REPLACE INTO indicators_daily (
      symbol, date,
      sma20, sma50, sma200,
      ema8, ema21,
      rsi14,
      macd, macd_signal,
      atr14, vol20,
      ret1d, ret5d,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    # itertuples is ~50x faster than iterrows for row-building
    def _f(v) -> float | None:
        return None if pd.isna(v) else float(v)

    rows: List[Tuple] = [
        (
            symbol, str(r.date),
            _f(r.sma20), _f(r.sma50), _f(r.sma200),
            _f(r.ema8), _f(r.ema21),
            _f(r.rsi14),
            _f(r.macd), _f(r.macd_signal),
            _f(r.atr14), _f(r.vol20),
            _f(r.ret1d), _f(r.ret5d),
            now_iso,
        )
        for r in ind_df.itertuples(index=False)
    ]

    conn.executemany(sql, rows)
    conn.commit()
    return len(rows)


def delete_symbol_indicators(conn: sqlite3.Connection, symbol: str) -> int:
    cur = conn.execute("DELETE FROM indicators_daily WHERE symbol = ?", (symbol,))
    conn.commit()
    return int(cur.rowcount if cur.rowcount is not None else 0)


# ── Coverage check (cheap COUNT queries, no window functions) ────────────────
def verify_coverage_by_symbol(
    conn: sqlite3.Connection,
    symbols: List[str],
    log_write,
    threshold: float = 0.95,
    warmup_rows: int = 200,
) -> List[Tuple[str, int, int, float]]:
    failed: List[Tuple[str, int, int, float]] = []
    log_write("------------------------------------------------------------")
    log_write(f"[CHECK] Coverage validation (threshold>={threshold:.2f}, warmup_rows={warmup_rows})")

    for symbol in symbols:
        total_ohlcv = conn.execute(
            "SELECT COUNT(*) FROM ohlcv_daily WHERE symbol = ? AND (adj_close IS NOT NULL OR close IS NOT NULL)",
            (symbol,),
        ).fetchone()[0]
        base_cnt = max(0, total_ohlcv - warmup_rows)

        ind_cnt = conn.execute(
            "SELECT COUNT(*) FROM indicators_daily WHERE symbol = ?",
            (symbol,),
        ).fetchone()[0]

        if base_cnt == 0:
            coverage = 1.0
        else:
            ind_effective = max(0, ind_cnt - warmup_rows)
            coverage = min(1.0, ind_effective / base_cnt)

        log_write(
            f"[CHECK] {symbol}: ohlcv={total_ohlcv} indicators={ind_cnt} coverage={coverage:.4f}"
        )
        # Check if indicators are current (latest date matches OHLCV latest date)
        latest_ind_date = conn.execute(
            "SELECT MAX(date) FROM indicators_daily WHERE symbol = ?", (symbol,)
        ).fetchone()[0] or ''
        latest_ohlcv_date = conn.execute(
            "SELECT MAX(date) FROM ohlcv_daily WHERE symbol = ? AND (adj_close IS NOT NULL OR close IS NOT NULL)",
            (symbol,)
        ).fetchone()[0] or ''
        is_current = (latest_ind_date >= latest_ohlcv_date) if latest_ohlcv_date else True
        if coverage < threshold and not is_current:
            failed.append((symbol, int(base_cnt), int(ind_cnt), float(coverage)))
        elif coverage < threshold and is_current:
            log_write(f"[WARN] {symbol}: low historical coverage ({coverage:.1%}) but indicators are current ({latest_ind_date}) — run --rebuild to backfill")

    if failed:
        log_write("[ERROR] Coverage below threshold:")
        for sym, base_cnt, ind_cnt, cov in failed:
            log_write(f" - {sym}: base={base_cnt}, indicators={ind_cnt}, coverage={cov:.4f}")
    else:
        log_write("[OK] Coverage check passed for all processed symbols.")

    return failed


def run_verification_queries(conn: sqlite3.Connection, log_write) -> None:
    total = conn.execute("SELECT COUNT(*) FROM indicators_daily").fetchone()[0]
    log_write(f"[VERIFY-a] SELECT COUNT(*) FROM indicators_daily; => {total}")

    top5 = conn.execute(
        """
        SELECT symbol, COUNT(*) AS cnt
        FROM indicators_daily
        GROUP BY symbol
        ORDER BY cnt DESC, symbol ASC
        LIMIT 5
        """
    ).fetchall()
    log_write("[VERIFY-b] Top 5 symbols by indicator row count:")
    for sym, cnt in top5:
        log_write(f"  - {sym}: {cnt}")

    latest = conn.execute(
        """
        SELECT date, sma20, sma50, sma200, rsi14, macd
        FROM indicators_daily
        WHERE symbol='AAPL'
        ORDER BY date DESC
        LIMIT 5
        """
    ).fetchall()
    log_write("[VERIFY-c] AAPL latest 5 rows:")
    for row in latest:
        log_write(f"  - {row}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit",   type=int,   default=None, help="limit symbols for test run")
    parser.add_argument("--symbols", nargs="+",  default=None, help="specific symbols only")
    parser.add_argument("--rebuild", action="store_true",      help="delete + full reinsert per symbol")
    parser.add_argument("--sleep",   type=float, default=0.0,  help="sleep seconds between symbols")
    args = parser.parse_args()

    ensure_dirs()
    lf = open(log_path(), "w", encoding="utf-8")

    def log_write(msg: str) -> None:
        print(msg)
        lf.write(msg + "\n")
        lf.flush()

    path = db_path()
    if not os.path.exists(path):
        log_write(f"[ERROR] DB not found: {path}")
        log_write("Run: python backend/scripts/init_db.py")
        lf.close()
        return 1

    conn = sqlite3.connect(path)
    error_symbols: List[Tuple[str, str]] = []
    total_upserted = 0
    total_skipped  = 0

    try:
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")   # faster concurrent writes
        conn.execute("PRAGMA synchronous = NORMAL;") # safe + faster than FULL
        validate_required_tables(conn)

        input_symbols = None
        if args.symbols:
            input_symbols = sorted({s.strip().upper() for s in args.symbols if s and s.strip()})

        symbols = get_symbols(conn, args.limit, input_symbols)
        log_write("============================================================")
        log_write("STEP 2 - update_indicators.py (incremental)")
        log_write(f"Started: {datetime.now().isoformat(timespec='seconds')}")
        log_write(f"[INFO] Symbols to process: {len(symbols)}")
        if args.rebuild:
            log_write("[INFO] Rebuild mode: ON (DELETE + full INSERT per symbol)")
        else:
            log_write("[INFO] Rebuild mode: OFF (incremental — skip up-to-date symbols)")

        if not symbols:
            log_write("[WARN] No symbols found in ohlcv_daily.")
            return 0

        for i, symbol in enumerate(symbols, start=1):
            try:
                if args.rebuild:
                    deleted = delete_symbol_indicators(conn, symbol)
                    log_write(f"[INFO] [{i}/{len(symbols)}] {symbol}: deleted {deleted} old rows")

                cnt = upsert_symbol(conn, symbol)
                if cnt == 0:
                    total_skipped += 1
                    # Only log skips in batches (every 50) to keep output clean
                    if i % 50 == 0:
                        log_write(f"[INFO] [{i}/{len(symbols)}] ... {total_skipped} skipped so far (up-to-date)")
                else:
                    total_upserted += cnt
                    log_write(f"[INFO] [{i}/{len(symbols)}] {symbol}: +{cnt} rows")
            except Exception as e:
                msg = f"{type(e).__name__}: {e}"
                error_symbols.append((symbol, msg))
                log_write(f"[ERROR] [{i}/{len(symbols)}] {symbol}: {msg}")
            if args.sleep > 0:
                time.sleep(args.sleep)

        total_records = conn.execute("SELECT COUNT(*) FROM indicators_daily").fetchone()[0]
        log_write("------------------------------------------------------------")
        log_write(f"[INFO] Symbols processed: {len(symbols)} "
                  f"(updated={len(symbols) - total_skipped - len(error_symbols)}, "
                  f"skipped={total_skipped}, errors={len(error_symbols)})")
        log_write(f"[INFO] Rows inserted this run: {total_upserted}")
        log_write(f"[INFO] Total rows in indicators_daily: {total_records}")

        if error_symbols:
            log_write("[WARN] Failed symbols:")
            for s, err in error_symbols:
                log_write(f" - {s}: {err}")
        else:
            log_write("[INFO] Failed symbols: none")

        coverage_failures = verify_coverage_by_symbol(conn, symbols, log_write, threshold=0.95, warmup_rows=200)

        log_write("------------------------------------------------------------")
        run_verification_queries(conn, log_write)
        log_write("============================================================")

        if coverage_failures:
            log_write("[FAIL] Completed with coverage failures.")
            return 1

        log_write("[OK] Completed without fatal errors.")
        return 0

    except Exception as e:
        log_write(f"[FATAL] update_indicators failed: {type(e).__name__}: {e}")
        log_write(traceback.format_exc())
        return 1
    finally:
        conn.close()
        lf.close()


if __name__ == "__main__":
    raise SystemExit(main())
