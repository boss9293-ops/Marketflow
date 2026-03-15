"""
Fill sample OHLCV data for a fixed 20-symbol set.

Requirements covered:
1) Select only requested symbols from universe_symbols
2) Fetch recent 2 years daily data from yfinance
3) INSERT OR REPLACE into ohlcv_daily
4) Print per-symbol row count / total insert / error symbols
5) Print SELECT COUNT(*) FROM ohlcv_daily at the end

Usage (PowerShell):
  python backend/scripts/fill_sample_ohlcv.py
"""
from __future__ import annotations

import os
import sqlite3
import sys
import traceback
from datetime import datetime
from typing import List, Tuple

import yfinance as yf


TARGET_SYMBOLS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL",
    "META", "TSLA", "JPM", "V", "MA",
    "HD", "UNH", "XOM", "PG", "BAC",
    "WMT", "JNJ", "MRK", "IWM", "QQQ",
]


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def db_path() -> str:
    return os.path.join(repo_root(), "data", "marketflow.db")


def to_yf_symbol(symbol: str) -> str:
    return symbol.replace(".", "-")


def safe_float(v):
    try:
        if v != v:  # NaN
            return None
        return float(v)
    except Exception:
        return None


def safe_int(v):
    try:
        if v != v:  # NaN
            return None
        return int(v)
    except Exception:
        return None


def fetch_rows(symbol: str) -> List[Tuple]:
    hist = yf.Ticker(to_yf_symbol(symbol)).history(period="2y", interval="1d", auto_adjust=False)
    if hist is None or hist.empty:
        return []

    now_iso = datetime.now().isoformat(timespec="seconds")
    rows: List[Tuple] = []
    for idx, row in hist.iterrows():
        close_v = safe_float(row.get("Close"))
        if close_v is None:
            continue
        adj_close = safe_float(row.get("Adj Close")) if "Adj Close" in hist.columns else close_v
        rows.append(
            (
                symbol,
                idx.strftime("%Y-%m-%d"),
                safe_float(row.get("Open")),
                safe_float(row.get("High")),
                safe_float(row.get("Low")),
                close_v,
                adj_close,
                safe_int(row.get("Volume")),
                "yfinance-sample",
                now_iso,
            )
        )
    return rows


def main() -> int:
    path = db_path()
    if not os.path.exists(path):
        print(f"[ERROR] DB not found: {path}")
        print("Run: python backend/scripts/init_db.py")
        return 1

    conn = sqlite3.connect(path)
    total_insert = 0
    errors: List[Tuple[str, str]] = []
    try:
        conn.execute("PRAGMA foreign_keys = ON;")

        placeholders = ",".join(["?"] * len(TARGET_SYMBOLS))
        found_rows = conn.execute(
            f"SELECT symbol FROM universe_symbols WHERE symbol IN ({placeholders})",
            TARGET_SYMBOLS,
        ).fetchall()
        found_set = {r[0] for r in found_rows}
        selected = [s for s in TARGET_SYMBOLS if s in found_set]
        missing = [s for s in TARGET_SYMBOLS if s not in found_set]

        print(f"[INFO] Requested symbols: {len(TARGET_SYMBOLS)}")
        print(f"[INFO] Found in universe_symbols: {len(selected)}")
        if missing:
            for s in missing:
                errors.append((s, "Not found in universe_symbols"))

        sql = """
        INSERT OR REPLACE INTO ohlcv_daily (
            symbol, date, open, high, low, close, adj_close, volume, source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        for i, symbol in enumerate(selected, start=1):
            try:
                rows = fetch_rows(symbol)
                if not rows:
                    errors.append((symbol, "No data from yfinance"))
                    print(f"[ERROR] [{i}/{len(selected)}] {symbol}: no data")
                    continue
                conn.executemany(sql, rows)
                conn.commit()
                total_insert += len(rows)
                print(f"[INFO] [{i}/{len(selected)}] {symbol}: {len(rows)} rows")
            except Exception as e:
                errors.append((symbol, f"{type(e).__name__}: {e}"))
                print(f"[ERROR] [{i}/{len(selected)}] {symbol}: {type(e).__name__}: {e}")

        total_count = conn.execute("SELECT COUNT(*) FROM ohlcv_daily").fetchone()[0]
        print(f"[INFO] Total insert/upsert rows this run: {total_insert}")
        print(f"[INFO] SELECT COUNT(*) FROM ohlcv_daily = {total_count}")

        if errors:
            print("[WARN] Error symbols:")
            for sym, msg in errors:
                print(f" - {sym}: {msg}")
        else:
            print("[INFO] No symbol errors.")
        return 0
    except Exception as e:
        print(f"[FATAL] fill_sample_ohlcv failed: {type(e).__name__}: {e}")
        print(traceback.format_exc())
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
