import json
import logging
import os
from typing import Optional
import sys
from pathlib import Path
from datetime import datetime

import pandas as pd
import requests


def _root_dir() -> Path:
    return Path(__file__).resolve().parents[3]


def _ensure_dirs(base: Path) -> dict:
    paths = {
        "macro_fred": base / "macro" / "fred",
        "logs": base / "logs",
        "meta": base / "meta",
    }
    for p in paths.values():
        p.mkdir(parents=True, exist_ok=True)
    return paths


def _setup_logger(log_path: Path) -> logging.Logger:
    logger = logging.getLogger("ingest_macro_fred")
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
    return payload.get("series", [])


def _read_env_key(root: Path) -> Optional[str]:
    key = os.getenv("FRED_API_KEY")
    if key:
        return key.strip()
    env_path = root / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("FRED_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def _fetch_series(series_id: str, api_key: str) -> pd.DataFrame:
    url = "https://api.stlouisfed.org/fred/series/observations"
    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
    }
    resp = requests.get(url, params=params, timeout=20)
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}")
    payload = resp.json()
    obs = payload.get("observations", [])
    if not obs:
        raise RuntimeError("No observations returned")
    df = pd.DataFrame(obs)[["date", "value"]]
    df = df.rename(columns={"date": "Date", "value": "Value"})
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce").dt.date
    df["Value"] = pd.to_numeric(df["Value"], errors="coerce")
    df = df.dropna(subset=["Date"]).drop_duplicates(subset=["Date"]).sort_values("Date").reset_index(drop=True)
    return df


def ingest_macro():
    root = _root_dir()
    data_root = root / "marketflow_data"
    paths = _ensure_dirs(data_root)
    logger = _setup_logger(paths["logs"] / "ingest_fred.log")

    api_key = _read_env_key(root)
    if not api_key:
        logger.error("FRED_API_KEY not found in environment or .env")
        return 1

    symbols_path = paths["meta"] / "symbols_fred.json"
    series_list = _load_symbols(symbols_path)
    if not series_list:
        logger.error("No series found in %s", symbols_path)
        return 1

    ok = 0
    failed = 0
    for series_id in series_list:
        try:
            df = _fetch_series(series_id, api_key)
            parquet_path = paths["macro_fred"] / f"{series_id}.parquet"
            df.to_parquet(parquet_path, index=False)
            ok += 1
            logger.info("OK %s rows=%d", series_id, len(df))
        except Exception as exc:
            failed += 1
            logger.exception("FAIL %s error=%s", series_id, exc)
            continue

    logger.info("DONE ok=%d failed=%d", ok, failed)
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(ingest_macro())
