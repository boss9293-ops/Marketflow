import json
import logging
import sys
from pathlib import Path
from datetime import datetime
from io import StringIO

import pandas as pd
import requests


def _root_dir() -> Path:
    return Path(__file__).resolve().parents[3]


def _ensure_dirs(base: Path) -> dict:
    paths = {
        "prices_daily": base / "prices" / "daily",
        "prices_raw": base / "prices" / "raw_csv",
        "logs": base / "logs",
        "meta": base / "meta",
    }
    for p in paths.values():
        p.mkdir(parents=True, exist_ok=True)
    return paths


def _setup_logger(log_path: Path) -> logging.Logger:
    logger = logging.getLogger("ingest_prices_stooq")
    logger.setLevel(logging.INFO)
    handler = logging.FileHandler(log_path, encoding="utf-8")
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
    handler.setFormatter(formatter)
    if not logger.handlers:
        logger.addHandler(handler)
    return logger


def _load_symbols(meta_path: Path) -> list:
    if not meta_path.exists():
        return []
    with meta_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    return payload.get("symbols", [])


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    expected = ["Date", "Open", "High", "Low", "Close", "Volume"]
    cols = {c: c.strip().title() for c in df.columns}
    df = df.rename(columns=cols)
    for col in expected:
        if col not in df.columns:
            df[col] = None
    df = df[expected]
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce").dt.date
    df = df.dropna(subset=["Date"])
    df = df.drop_duplicates(subset=["Date"]).sort_values("Date").reset_index(drop=True)
    return df


def ingest_prices():
    root = _root_dir()
    data_root = root / "marketflow_data"
    paths = _ensure_dirs(data_root)
    logger = _setup_logger(paths["logs"] / "ingest_prices.log")

    symbols_path = paths["meta"] / "symbols_prices.json"
    symbols = _load_symbols(symbols_path)
    if not symbols:
        logger.error("No symbols found in %s", symbols_path)
        return 1

    ok = 0
    failed = 0
    for symbol in symbols:
        url = f"https://stooq.com/q/d/l/?s={symbol}&i=d"
        try:
            resp = requests.get(url, timeout=20)
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}")
            if not resp.text or "Date" not in resp.text:
                raise RuntimeError("Empty or invalid CSV response")

            df = pd.read_csv(StringIO(resp.text))
            df = _normalize_columns(df)
            if df.empty:
                raise RuntimeError("CSV parsed but no rows")

            csv_path = paths["prices_raw"] / f"{symbol}.csv"
            parquet_path = paths["prices_daily"] / f"{symbol}.parquet"
            df.to_csv(csv_path, index=False)
            df.to_parquet(parquet_path, index=False)
            ok += 1
            logger.info("OK %s rows=%d", symbol, len(df))
        except Exception as exc:
            failed += 1
            logger.exception("FAIL %s url=%s error=%s", symbol, url, exc)
            continue

    logger.info("DONE ok=%d failed=%d", ok, failed)
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(ingest_prices())
