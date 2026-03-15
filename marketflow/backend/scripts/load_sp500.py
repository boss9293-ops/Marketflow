"""
Load S&P 500 universe from Wikipedia into SQLite universe_symbols table.

Usage (PowerShell):
  python backend/scripts/load_sp500.py
"""
from __future__ import annotations

import logging
import os
import sqlite3
import sys
import traceback
from datetime import datetime
from typing import Dict, List

import requests
from bs4 import BeautifulSoup


WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"


def configure_logger() -> logging.Logger:
    logger = logging.getLogger("load_sp500")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
        logger.addHandler(handler)
    return logger


def fetch_sp500_from_wikipedia(logger: logging.Logger) -> List[Dict[str, str]]:
    logger.info("Fetching S&P 500 constituents from Wikipedia...")
    headers = {
        "User-Agent": "MarketFlow/1.0 (+https://localhost)"
    }
    resp = requests.get(WIKI_URL, headers=headers, timeout=30)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.find("table", {"id": "constituents"})
    if table is None:
        table = soup.find("table", class_="wikitable sortable")
    if table is None:
        raise RuntimeError("Could not find constituents table on Wikipedia page.")

    rows: List[Dict[str, str]] = []
    body = table.find("tbody")
    if body is None:
        raise RuntimeError("Constituents table body not found.")

    for tr in body.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 5:
            continue

        symbol = tds[0].get_text(strip=True).upper()
        name = tds[1].get_text(strip=True)
        sector = tds[3].get_text(strip=True)
        industry = tds[4].get_text(strip=True)

        if not symbol:
            continue

        rows.append(
            {
                "symbol": symbol,
                "name": name,
                "sector": sector,
                "industry": industry,
                "exchange": "NYSE/NASDAQ",
            }
        )

    if not rows:
        raise RuntimeError("Parsed 0 symbols from Wikipedia constituents table.")

    logger.info("Parsed %d symbols from Wikipedia.", len(rows))
    return rows


def upsert_universe(rows: List[Dict[str, str]], db_path: str, logger: logging.Logger) -> None:
    logger.info("Connecting DB: %s", db_path)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA foreign_keys = ON;")
        table_exists = conn.execute(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table' AND name = 'universe_symbols'
            """
        ).fetchone()
        if not table_exists:
            raise RuntimeError(
                "Table 'universe_symbols' does not exist. "
                "Run: python backend/scripts/init_db.py"
            )

        now = datetime.now().isoformat(timespec="seconds")
        sql = """
        INSERT OR REPLACE INTO universe_symbols (
            symbol,
            name,
            sector,
            industry,
            exchange,
            market_cap,
            is_active,
            is_top100,
            last_updated
        ) VALUES (
            :symbol,
            :name,
            :sector,
            :industry,
            :exchange,
            NULL,
            1,
            0,
            :last_updated
        )
        """

        params = []
        for row in rows:
            payload = dict(row)
            payload["last_updated"] = now
            params.append(payload)

        conn.executemany(sql, params)
        conn.commit()

        total_count = conn.execute("SELECT COUNT(*) FROM universe_symbols").fetchone()[0]
        logger.info("Inserted/Updated rows: %d", len(rows))
        logger.info("SELECT COUNT(*) FROM universe_symbols = %d", total_count)
    finally:
        conn.close()


def main() -> int:
    logger = configure_logger()
    try:
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        db_path = os.path.join(repo_root, "data", "marketflow.db")
        rows = fetch_sp500_from_wikipedia(logger)
        upsert_universe(rows, db_path, logger)
        logger.info("Done.")
        return 0
    except Exception as exc:
        logger.error("Failed to load S&P 500 universe: %s", exc)
        logger.error("Detailed traceback:\n%s", traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
