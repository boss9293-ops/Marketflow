"""
Update ohlcv_daily from universe_symbols.

Behavior:
1) Read symbols from universe_symbols (is_active=1)
2) Per symbol: check last date in DB; fetch only the delta since then
   (incremental mode).  If no existing data, fetch full --years history.
3) INSERT OR REPLACE into ohlcv_daily with (symbol, date) PK
4) Retry each symbol up to 3x with exponential back-off + jitter on failure.
5) Print per-symbol upsert count, total record count, and error symbols

Usage (PowerShell):
  python backend/scripts/update_ohlcv.py
  python backend/scripts/update_ohlcv.py --limit 20
  python backend/scripts/update_ohlcv.py --full   # force full 2-year re-fetch
"""
from __future__ import annotations

import argparse
import os
import random
import sqlite3
import sys
import time
import traceback
from datetime import datetime, timedelta
from io import StringIO
from typing import Dict, List, Optional, Tuple

import pandas as pd
import requests
import yfinance as yf


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def db_path() -> str:
    return os.path.join(repo_root(), "data", "marketflow.db")


def get_symbols(conn: sqlite3.Connection, limit: int | None = None) -> List[str]:
    sql = "SELECT symbol FROM universe_symbols WHERE is_active = 1 ORDER BY symbol"
    if limit is not None and limit > 0:
        sql += f" LIMIT {int(limit)}"
    rows = conn.execute(sql).fetchall()
    return [r[0] for r in rows]


def get_last_dates_bulk(conn: sqlite3.Connection) -> Dict[str, str]:
    """Return {symbol: last_date_str} for every symbol that has data in ohlcv_daily."""
    rows = conn.execute(
        "SELECT symbol, MAX(date) FROM ohlcv_daily GROUP BY symbol"
    ).fetchall()
    return {r[0]: r[1] for r in rows if r[1]}


def to_yf_symbol(symbol: str) -> str:
    return symbol.replace(".", "-")


def _safe_float(v):
    if pd.isna(v):
        return None
    return float(v)


def _safe_int(v):
    if pd.isna(v):
        return None
    return int(v)


def fetch_yfinance_rows(
    symbol: str,
    start_date: Optional[str] = None,
    years: int = 2,
) -> Tuple[List[Tuple], str]:
    yf_symbol = to_yf_symbol(symbol)
    ticker = yf.Ticker(yf_symbol)
    if start_date:
        hist = ticker.history(start=start_date, interval="1d", auto_adjust=False)
    else:
        hist = ticker.history(period=f"{years}y", interval="1d", auto_adjust=False)

    if hist is None or hist.empty:
        return [], "yfinance"

    hist = hist.reset_index()
    date_col = "Date" if "Date" in hist.columns else hist.columns[0]
    now_iso = datetime.now().isoformat(timespec="seconds")
    rows: List[Tuple] = []

    for _, row in hist.iterrows():
        date_val = pd.to_datetime(row[date_col]).strftime("%Y-%m-%d")
        close_val = _safe_float(row.get("Close"))
        adj_close = _safe_float(row.get("Adj Close")) if "Adj Close" in hist.columns else close_val
        if close_val is None:
            continue
        rows.append((
            symbol, date_val,
            _safe_float(row.get("Open")), _safe_float(row.get("High")),
            _safe_float(row.get("Low")), close_val, adj_close,
            _safe_int(row.get("Volume")), "yfinance", now_iso,
        ))
    return rows, "yfinance"


def fetch_stooq_rows(
    symbol: str,
    start_date: Optional[str] = None,
    years: int = 2,
) -> Tuple[List[Tuple], str]:
    stooq_symbol = symbol.lower().replace(".", "-")
    url = f"https://stooq.com/q/d/l/?s={stooq_symbol}.us&i=d"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    csv_text = r.text.strip()
    if not csv_text or "No data" in csv_text:
        return [], "stooq"

    df = pd.read_csv(StringIO(csv_text))
    if df.empty or "Date" not in df.columns:
        return [], "stooq"

    if start_date:
        min_date = pd.to_datetime(start_date).date()
    else:
        min_date = (datetime.now() - timedelta(days=365 * years + 7)).date()

    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date"])
    df = df[df["Date"].dt.date >= min_date]
    df = df.sort_values("Date")

    now_iso = datetime.now().isoformat(timespec="seconds")
    rows: List[Tuple] = []
    for _, row in df.iterrows():
        close_val = _safe_float(row.get("Close"))
        if close_val is None:
            continue
        rows.append((
            symbol, row["Date"].strftime("%Y-%m-%d"),
            _safe_float(row.get("Open")), _safe_float(row.get("High")),
            _safe_float(row.get("Low")), close_val, close_val,
            _safe_int(row.get("Volume")), "stooq", now_iso,
        ))
    return rows, "stooq"


def fetch_rows(
    symbol: str,
    start_date: Optional[str] = None,
    years: int = 2,
) -> Tuple[List[Tuple], str]:
    errors: List[str] = []
    try:
        rows, source = fetch_yfinance_rows(symbol, start_date=start_date, years=years)
        if rows:
            return rows, source
        errors.append("yfinance: empty")
    except Exception as e:
        errors.append(f"yfinance: {type(e).__name__}: {e}")

    try:
        rows, source = fetch_stooq_rows(symbol, start_date=start_date, years=years)
        if rows:
            return rows, source
        errors.append("stooq: empty")
    except Exception as e:
        errors.append(f"stooq: {type(e).__name__}: {e}")

    raise RuntimeError("; ".join(errors))


def fetch_rows_with_retry(
    symbol: str,
    start_date: Optional[str],
    years: int,
    max_retries: int = 3,
) -> Tuple[List[Tuple], str]:
    """Fetch with exponential back-off + jitter on failure."""
    last_err: Exception = RuntimeError("unknown")
    for attempt in range(max_retries):
        try:
            return fetch_rows(symbol, start_date=start_date, years=years)
        except RuntimeError as e:
            last_err = e
            if attempt < max_retries - 1:
                wait = (2 ** attempt) + random.uniform(0.2, 1.2)
                time.sleep(wait)
    raise last_err


def upsert_rows(conn: sqlite3.Connection, rows: List[Tuple]) -> int:
    sql = """
    INSERT OR REPLACE INTO ohlcv_daily (
        symbol, date, open, high, low, close, adj_close, volume, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    conn.executemany(sql, rows)
    conn.commit()
    return len(rows)


def validate_required_tables(conn: sqlite3.Connection) -> None:
    required = {"universe_symbols", "ohlcv_daily"}
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('universe_symbols','ohlcv_daily')"
    ).fetchall()
    existing = {r[0] for r in rows}
    missing = required - existing
    if missing:
        raise RuntimeError(
            f"Missing tables: {sorted(missing)}. Run: python backend/scripts/init_db.py"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit",  type=int,   default=None,  help="limit symbols for test run")
    parser.add_argument("--years",  type=int,   default=2,     help="history years for full fetch (default: 2)")
    parser.add_argument("--sleep",  type=float, default=0.15,  help="base sleep seconds between symbols (default: 0.15)")
    parser.add_argument("--full",   action="store_true",       help="force full re-fetch ignoring DB last date")
    parser.add_argument("--retry",  type=int,   default=3,     help="max retry attempts per symbol (default: 3)")
    args = parser.parse_args()

    path = db_path()
    if not os.path.exists(path):
        print(f"[ERROR] DB not found: {path}")
        print("Run: python backend/scripts/init_db.py")
        return 1

    from db_utils import db_connect
    conn = db_connect(path)
    error_symbols: List[Tuple[str, str]] = []
    total_upserted = 0

    try:
        validate_required_tables(conn)
        symbols = get_symbols(conn, args.limit)
        print(f"[INFO] Symbols to update: {len(symbols)}")

        if not symbols:
            print("[WARN] No active symbols in universe_symbols.")
            return 0

        # --- Incremental mode: load last-known dates from DB ---
        if args.full:
            last_dates: Dict[str, str] = {}
            print("[INFO] Mode: full re-fetch (--full flag)")
        else:
            last_dates = get_last_dates_bulk(conn)
            incremental_count = sum(1 for s in symbols if s in last_dates)
            print(f"[INFO] Mode: incremental ({incremental_count}/{len(symbols)} symbols have existing data)")

        today = datetime.now().strftime("%Y-%m-%d")

        for i, symbol in enumerate(symbols, start=1):
            try:
                last_date = last_dates.get(symbol) if not args.full else None
                if last_date and last_date >= today:
                    # Already up-to-date
                    print(f"[SKIP] [{i}/{len(symbols)}] {symbol}: already current ({last_date})")
                    continue

                # start_date = day after last known date
                if last_date:
                    start_date: Optional[str] = (
                        pd.to_datetime(last_date) + timedelta(days=1)
                    ).strftime("%Y-%m-%d")
                else:
                    start_date = None  # full history

                rows, source = fetch_rows_with_retry(
                    symbol, start_date=start_date, years=args.years, max_retries=args.retry
                )
                if not rows:
                    print(f"[SKIP] [{i}/{len(symbols)}] {symbol}: 0 new rows ({source})")
                    continue

                cnt = upsert_rows(conn, rows)
                total_upserted += cnt
                mode_tag = f"delta from {start_date}" if start_date else f"full {args.years}y"
                print(f"[INFO] [{i}/{len(symbols)}] {symbol}: {cnt} rows ({source}, {mode_tag})")

            except Exception as e:
                msg = f"{type(e).__name__}: {e}"
                error_symbols.append((symbol, msg))
                print(f"[ERROR] [{i}/{len(symbols)}] {symbol}: {msg}")

            # Sleep with jitter to reduce rate-limit hits
            if args.sleep > 0:
                time.sleep(args.sleep + random.uniform(0, args.sleep * 0.5))

        total_records = conn.execute("SELECT COUNT(*) FROM ohlcv_daily").fetchone()[0]
        print(f"[INFO] Total upsert rows this run: {total_upserted}")
        print(f"[INFO] Total records in ohlcv_daily: {total_records}")

        if error_symbols:
            print(f"[WARN] Error symbols ({len(error_symbols)}):")
            for s, err in error_symbols:
                print(f" - {s}: {err}")
        else:
            print("[INFO] No symbol errors.")

        return 0
    except Exception as e:
        print(f"[FATAL] update_ohlcv failed: {type(e).__name__}: {e}")
        print(traceback.format_exc())
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
