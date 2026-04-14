from __future__ import annotations

import os
import sqlite3
from datetime import datetime


RISK_SYMBOLS: dict[str, tuple[str, str]] = {
    "QQQ": ("Nasdaq 100", "ETF"),
    "SPY": ("S&P 500", "ETF"),
    "DIA": ("Dow Jones", "ETF"),
    "HYG": ("iShares iBoxx HY Corp Bond ETF", "Fixed Income"),
    "LQD": ("iShares iBoxx IG Corp Bond ETF", "Fixed Income"),
    "BKLN": ("Invesco Senior Loan ETF", "Fixed Income"),
    "SRLN": ("SPDR Blackstone Senior Loan ETF", "Fixed Income"),
    "BX": ("Blackstone", "Financial"),
    "KKR": ("KKR", "Financial"),
    "APO": ("Apollo Global Management", "Financial"),
    "ARES": ("Ares Management", "Financial"),
    "ARCC": ("Ares Capital", "Financial"),
    "OBDC": ("Blue Owl Capital", "Financial"),
    "BXSL": ("Blackstone Secured Lending", "Financial"),
    "XLF": ("Financials", "ETF"),
    "XLU": ("Utilities", "ETF"),
    "KRE": ("Regional Banks", "ETF"),
    "IWM": ("Russell 2000", "ETF"),
    "TLT": ("20+ Year Treasury Bond ETF", "Fixed Income"),
    "GLD": ("SPDR Gold Shares", "Commodity"),
    "JPY=X": ("USDJPY", "FX"),
}


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def db_path() -> str:
    try:
        from db_utils import resolve_marketflow_db
        return resolve_marketflow_db(required_tables=("ohlcv_daily",), data_plane="live")
    except Exception:
        return os.path.join(repo_root(), "data", "marketflow.db")


def main() -> int:
    path = db_path()
    if not os.path.exists(path):
        print(f"[ERROR] DB not found: {path}")
        return 1

    now = datetime.now().isoformat(timespec="seconds")
    added: list[str] = []
    already: list[str] = []

    con = sqlite3.connect(path)
    try:
        for symbol, (name, sector) in RISK_SYMBOLS.items():
            row = con.execute(
                "SELECT 1 FROM universe_symbols WHERE symbol=?",
                (symbol,),
            ).fetchone()
            if row:
                already.append(symbol)
                continue
            con.execute(
                """
                INSERT INTO universe_symbols
                  (symbol, name, sector, industry, exchange, market_cap, is_active, is_top100, last_updated)
                VALUES (?, ?, ?, ?, ?, NULL, 1, 0, ?)
                """,
                (
                    symbol,
                    name,
                    sector,
                    "Exchange Traded Fund" if sector in {"ETF", "Fixed Income", "Commodity"} else sector,
                    "NYSE/NASDAQ" if "=" not in symbol else "FX",
                    now,
                ),
            )
            added.append(symbol)
        con.commit()
    finally:
        con.close()

    print(
        f"[INFO] ensure_risk_universe: added={len(added)} already={len(already)}"
        + (f" -> {', '.join(added)}" if added else "")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
