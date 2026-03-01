"""
STEP 3: Fill market_daily (macro/index/volatility/rates/FX/commodities/crypto).

Default period: 5 years (change via --years)
Data source: yfinance (with symbol fallback)
Partial-success design: failed series do not stop entire run.

Usage (PowerShell):
  python backend/scripts/update_market_daily.py
  python backend/scripts/update_market_daily.py --years 3
"""
from __future__ import annotations

import argparse
import contextlib
import os
import sqlite3
import traceback
from datetime import datetime
from io import StringIO
from typing import Dict, List, Optional, Tuple

import pandas as pd
import yfinance as yf


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def db_path() -> str:
    return os.path.join(repo_root(), "data", "marketflow.db")


def log_path() -> str:
    return os.path.join(repo_root(), "backend", "logs", "update_market_daily.log")


def ensure_dirs() -> None:
    os.makedirs(os.path.dirname(log_path()), exist_ok=True)


def fetch_close_series(symbol: str, years: int) -> pd.Series:
    hist = yf.Ticker(symbol).history(period=f"{years}y", interval="1d", auto_adjust=False)
    if hist is None or hist.empty:
        return pd.Series(dtype="float64")
    s = hist["Close"].copy()
    s.index = pd.to_datetime(s.index).tz_localize(None)
    return s


def fetch_with_fallback(symbols: List[str], years: int) -> Tuple[pd.Series, Optional[str]]:
    for sym in symbols:
        try:
            # yfinance missing symbol warnings are noisy; suppress stderr during fallback.
            with contextlib.redirect_stderr(StringIO()):
                s = fetch_close_series(sym, years=years)
            if not s.empty:
                return s, sym
        except Exception:
            continue
    return pd.Series(dtype="float64"), None


def to_float_or_none(v):
    if pd.isna(v):
        return None
    return float(v)


def fetch_from_ohlcv(db: str, symbol: str) -> pd.Series:
    """Read close-price series for *symbol* directly from the local ohlcv_daily table.
    Returns an empty Series on any error."""
    try:
        conn = sqlite3.connect(db)
        df = pd.read_sql_query(
            "SELECT date, close FROM ohlcv_daily WHERE symbol=? AND close IS NOT NULL ORDER BY date ASC",
            conn,
            params=(symbol,),
        )
        conn.close()
        if df.empty:
            return pd.Series(dtype="float64")
        df["date"] = pd.to_datetime(df["date"]).dt.tz_localize(None)
        return df.set_index("date")["close"]
    except Exception:
        return pd.Series(dtype="float64")


def validate_required_table(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='market_daily'"
    ).fetchone()
    if not row:
        raise RuntimeError("Table 'market_daily' not found. Run: python backend/scripts/init_db.py")


def run_verification_queries(conn: sqlite3.Connection, log_write) -> None:
    a = conn.execute("SELECT COUNT(*) FROM market_daily").fetchone()[0]
    log_write(f"[VERIFY-a] SELECT COUNT(*) FROM market_daily; => {a}")

    b = conn.execute("SELECT MIN(date), MAX(date) FROM market_daily").fetchone()
    log_write(f"[VERIFY-b] SELECT MIN(date), MAX(date) FROM market_daily; => {b[0]} ~ {b[1]}")

    c = conn.execute("SELECT * FROM market_daily ORDER BY date DESC LIMIT 5").fetchall()
    log_write("[VERIFY-c] SELECT * FROM market_daily ORDER BY date DESC LIMIT 5;")
    for row in c:
        log_write(f"  - {row}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=int, default=5, help="history years (default: 5)")
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

    # Equity columns (spy/qqq/iwm) now sourced from local ohlcv_daily.
    # Non-equity (vix/dxy/rates/commodities/btc) still via yfinance.

    try:
        log_write("============================================================")
        log_write("STEP 3 - update_market_daily.py")
        log_write(f"Started: {datetime.now().isoformat(timespec='seconds')}")
        log_write(f"[INFO] years={args.years}")

        series_map: Dict[str, pd.Series] = {}
        meta: Dict[str, Tuple[Optional[str], int]] = {}
        failed: List[Tuple[str, str]] = []

        # --- Equity columns: read from local ohlcv_daily (maintained by update_ohlcv.py) ---
        db_equities: Dict[str, str] = {"spy": "SPY", "qqq": "QQQ", "iwm": "IWM"}
        for col, sym in db_equities.items():
            s = fetch_from_ohlcv(path, sym)
            series_map[col] = s
            meta[col] = (f"ohlcv_daily:{sym}", len(s))
            if s.empty:
                failed.append((col, f"ohlcv_daily has no rows for {sym}"))
            else:
                log_write(f"[INFO] {col.upper():<6} source=ohlcv_daily:{sym} rows={len(s)} last={s.index[-1].strftime('%Y-%m-%d')}")

        # --- Non-equity columns: yfinance (VIX, rates, FX, commodities) ---
        yf_targets: Dict[str, List[str]] = {
            "vix":   ["^VIX"],
            "dxy":   ["DX-Y.NYB", "DXY", "^DXY"],
            "us10y": ["^TNX"],
            "us2y":  ["^IRX", "^FVX", "^TYX", "2YY=F"],
            "gold":  ["GLD", "GC=F"],
            "oil":   ["CL=F", "BZ=F"],
            "btc":   ["BTC-USD"],
        }
        for col, candidates in yf_targets.items():
            s, used = fetch_with_fallback(candidates, args.years)
            series_map[col] = s
            meta[col] = (used, len(s))
            if used is None or s.empty:
                failed.append((col, f"yfinance failed candidates={candidates}"))

        # Abort only if ALL series are empty (equity + non-equity)
        if all(s.empty for s in series_map.values()):
            log_write("[ERROR] No data fetched for any target series.")
            return 1

        # Build union-by-date dataframe
        df = pd.concat(series_map, axis=1, join="outer").sort_index()
        df.index = pd.to_datetime(df.index).tz_localize(None).strftime("%Y-%m-%d")
        df = df.reset_index()
        first_col = df.columns[0]
        if first_col != "date":
            df = df.rename(columns={first_col: "date"})

        # per-series summary for non-equity (equity already logged above)
        for col in yf_targets:
            src, fetched = meta[col]
            upsertable = int(df[col].notna().sum()) if col in df.columns else 0
            log_write(f"[INFO] {col.upper():<6} source={src} fetched={fetched} upserted={upsertable}")

        now_iso = datetime.now().isoformat(timespec="seconds")

        conn = sqlite3.connect(path)
        try:
            conn.execute("PRAGMA foreign_keys = ON;")
            validate_required_table(conn)

            sql = """
            INSERT INTO market_daily (
                date, spy, qqq, iwm, vix, dxy, us10y, us2y, oil, gold, btc, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                spy = COALESCE(excluded.spy, market_daily.spy),
                qqq = COALESCE(excluded.qqq, market_daily.qqq),
                iwm = COALESCE(excluded.iwm, market_daily.iwm),
                vix = COALESCE(excluded.vix, market_daily.vix),
                dxy = COALESCE(excluded.dxy, market_daily.dxy),
                us10y = COALESCE(excluded.us10y, market_daily.us10y),
                us2y = COALESCE(excluded.us2y, market_daily.us2y),
                oil = COALESCE(excluded.oil, market_daily.oil),
                gold = COALESCE(excluded.gold, market_daily.gold),
                btc = COALESCE(excluded.btc, market_daily.btc),
                updated_at = excluded.updated_at
            """

            rows = []
            for _, r in df.iterrows():
                rows.append(
                    (
                        str(r["date"]),
                        to_float_or_none(r.get("spy")),
                        to_float_or_none(r.get("qqq")),
                        to_float_or_none(r.get("iwm")),
                        to_float_or_none(r.get("vix")),
                        to_float_or_none(r.get("dxy")),
                        to_float_or_none(r.get("us10y")),
                        to_float_or_none(r.get("us2y")),
                        to_float_or_none(r.get("oil")),
                        to_float_or_none(r.get("gold")),
                        to_float_or_none(r.get("btc")),
                        now_iso,
                    )
                )

            conn.executemany(sql, rows)
            conn.commit()

            log_write(f"[INFO] Upsert rows this run: {len(rows)}")

            if failed:
                log_write("[WARN] Failed series:")
                for k, reason in failed:
                    log_write(f" - {k}: {reason}")
            else:
                log_write("[INFO] Failed series: none")

            log_write("------------------------------------------------------------")
            run_verification_queries(conn, log_write)
            log_write("============================================================")
            log_write("[OK] Completed without fatal errors.")
        finally:
            conn.close()

        return 0
    except Exception as e:
        log_write(f"[FATAL] update_market_daily failed: {type(e).__name__}: {e}")
        log_write(traceback.format_exc())
        return 1
    finally:
        lf.close()


if __name__ == "__main__":
    raise SystemExit(main())
