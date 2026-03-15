"""
STEP 1: Fill ohlcv_daily with fixed 20 sample tickers (2 years, 1d).

Usage (PowerShell):
  python backend/scripts/update_ohlcv_sample.py
"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import traceback
from datetime import datetime
from typing import List, Tuple

import yfinance as yf


SAMPLE_TICKERS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "V", "MA",
    "HD", "UNH", "XOM", "PG", "BAC", "WMT", "JNJ", "MRK", "IWM", "QQQ",
]


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def db_file() -> str:
    return os.path.join(repo_root(), "data", "marketflow.db")


def log_file() -> str:
    return os.path.join(repo_root(), "backend", "logs", "update_ohlcv_sample.log")


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


def ensure_db_exists(log_write) -> bool:
    path = db_file()
    if os.path.exists(path):
        return True

    log_write(f"[WARN] DB not found: {path}")
    log_write("[INFO] Trying to initialize DB via backend/scripts/init_db.py ...")
    init_script = os.path.join(repo_root(), "backend", "scripts", "init_db.py")
    if not os.path.exists(init_script):
        log_write("[ERROR] init_db.py not found. Please run DB initialization first.")
        return False

    result = subprocess.run(
        [sys.executable, init_script],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        log_write("[ERROR] init_db.py failed.")
        if result.stdout.strip():
            log_write(result.stdout.strip())
        if result.stderr.strip():
            log_write(result.stderr.strip())
        return False

    log_write("[OK] init_db.py completed.")
    return os.path.exists(path)


def fetch_rows(symbol: str) -> List[Tuple]:
    yf_symbol = symbol.replace(".", "-")
    hist = yf.Ticker(yf_symbol).history(period="2y", interval="1d", auto_adjust=False)
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
                "yfinance",
                now_iso,
            )
        )
    return rows


def validate_schema(conn: sqlite3.Connection) -> None:
    required = {"universe_symbols", "ohlcv_daily"}
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('universe_symbols','ohlcv_daily')"
    ).fetchall()
    existing = {r[0] for r in rows}
    missing = required - existing
    if missing:
        raise RuntimeError(
            f"Missing required tables: {sorted(missing)}. Run python backend/scripts/init_db.py first."
        )


def ensure_universe_contains_samples(conn: sqlite3.Connection, log_write) -> None:
    placeholders = ",".join(["?"] * len(SAMPLE_TICKERS))
    rows = conn.execute(
        f"SELECT symbol FROM universe_symbols WHERE symbol IN ({placeholders})",
        SAMPLE_TICKERS,
    ).fetchall()
    existing = {r[0] for r in rows}
    missing = [s for s in SAMPLE_TICKERS if s not in existing]
    if not missing:
        return

    now_iso = datetime.now().isoformat(timespec="seconds")
    sql = """
    INSERT OR REPLACE INTO universe_symbols (
        symbol, name, sector, industry, exchange, market_cap, is_active, is_top100, last_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    payload = []
    for sym in missing:
        payload.append(
            (
                sym,
                sym,
                "ETF" if sym in {"IWM", "QQQ"} else "UNKNOWN",
                "UNKNOWN",
                "NYSE/NASDAQ",
                None,
                1,
                0,
                now_iso,
            )
        )
    conn.executemany(sql, payload)
    conn.commit()
    log_write(f"[INFO] Added missing symbols to universe_symbols: {', '.join(missing)}")


def run_verification_queries(conn: sqlite3.Connection, log_write) -> None:
    total = conn.execute("SELECT COUNT(*) FROM ohlcv_daily").fetchone()[0]
    log_write(f"[VERIFY-a] SELECT COUNT(*) FROM ohlcv_daily; => {total}")

    top5 = conn.execute(
        """
        SELECT symbol, COUNT(*) AS cnt
        FROM ohlcv_daily
        GROUP BY symbol
        ORDER BY cnt DESC, symbol ASC
        LIMIT 5
        """
    ).fetchall()
    log_write("[VERIFY-b] SELECT symbol, COUNT(*) cnt ... LIMIT 5;")
    for sym, cnt in top5:
        log_write(f"  - {sym}: {cnt}")

    minmax = conn.execute(
        "SELECT MIN(date), MAX(date) FROM ohlcv_daily WHERE symbol='AAPL'"
    ).fetchone()
    log_write(
        "[VERIFY-c] SELECT MIN(date), MAX(date) FROM ohlcv_daily WHERE symbol='AAPL'; "
        f"=> {minmax[0]} ~ {minmax[1]}"
    )


def main() -> int:
    os.makedirs(os.path.dirname(log_file()), exist_ok=True)
    lf = open(log_file(), "w", encoding="utf-8")

    def log_write(msg: str) -> None:
        print(msg)
        lf.write(msg + "\n")
        lf.flush()

    try:
        log_write("============================================================")
        log_write("STEP 1 - update_ohlcv_sample.py")
        log_write(f"Started: {datetime.now().isoformat(timespec='seconds')}")
        log_write("============================================================")

        if not ensure_db_exists(log_write):
            log_write("[FATAL] DB file could not be prepared.")
            return 1

        conn = sqlite3.connect(db_file())
        try:
            conn.execute("PRAGMA foreign_keys = ON;")
            validate_schema(conn)
            ensure_universe_contains_samples(conn, log_write)

            sql = """
            INSERT OR REPLACE INTO ohlcv_daily (
                symbol, date, open, high, low, close, adj_close, volume, source, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """

            total_insert = 0
            failed: List[Tuple[str, str]] = []

            for i, symbol in enumerate(SAMPLE_TICKERS, start=1):
                try:
                    rows = fetch_rows(symbol)
                    if not rows:
                        failed.append((symbol, "No data returned from yfinance"))
                        log_write(f"[ERROR] [{i}/{len(SAMPLE_TICKERS)}] {symbol}: no data")
                        continue
                    conn.executemany(sql, rows)
                    conn.commit()
                    total_insert += len(rows)
                    log_write(f"[INFO] [{i}/{len(SAMPLE_TICKERS)}] {symbol}: {len(rows)} rows")
                except Exception as e:
                    failed.append((symbol, f"{type(e).__name__}: {e}"))
                    log_write(f"[ERROR] [{i}/{len(SAMPLE_TICKERS)}] {symbol}: {type(e).__name__}: {e}")

            log_write("------------------------------------------------------------")
            log_write(f"[INFO] Total insert/upsert rows this run: {total_insert}")
            if failed:
                log_write("[WARN] Failed symbols:")
                for sym, reason in failed:
                    log_write(f" - {sym}: {reason}")
            else:
                log_write("[INFO] Failed symbols: none")

            log_write("------------------------------------------------------------")
            run_verification_queries(conn, log_write)
            log_write("============================================================")
            log_write("[OK] Completed without fatal errors.")
            return 0
        finally:
            conn.close()
    except Exception as e:
        log_write(f"[FATAL] {type(e).__name__}: {e}")
        log_write(traceback.format_exc())
        return 1
    finally:
        lf.close()


if __name__ == "__main__":
    raise SystemExit(main())
