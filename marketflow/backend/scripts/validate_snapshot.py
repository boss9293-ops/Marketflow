import json
import logging
import sys
from pathlib import Path
from datetime import datetime, date

import pandas as pd
from pandas.tseries.offsets import BDay


def _root_dir() -> Path:
    return Path(__file__).resolve().parents[3]


def _ensure_dirs(base: Path) -> dict:
    paths = {
        "prices_daily": base / "prices" / "daily",
        "macro_fred": base / "macro" / "fred",
        "logs": base / "logs",
        "meta": base / "meta",
    }
    for p in paths.values():
        p.mkdir(parents=True, exist_ok=True)
    return paths


def _setup_logger(log_path: Path) -> logging.Logger:
    logger = logging.getLogger("validate_snapshot")
    logger.setLevel(logging.INFO)
    handler = logging.FileHandler(log_path, encoding="utf-8")
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
    handler.setFormatter(formatter)
    if not logger.handlers:
        logger.addHandler(handler)
    return logger


def _load_symbols(meta_path: Path, key: str) -> list:
    if not meta_path.exists():
        return []
    with meta_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    return payload.get(key, [])


def _last_business_day(today: date) -> date:
    ts = pd.Timestamp(today)
    if ts.weekday() >= 5:
        ts = ts - BDay(1)
    return ts.date()


def _validate_file(path: Path, last_bday: date, logger: logging.Logger) -> tuple[str, dict]:
    symbol = path.stem
    result = {"status": "ok", "last_date": None, "warnings": []}
    if not path.exists():
        result["status"] = "fail"
        result["warnings"].append("missing file")
        return symbol, result

    try:
        df = pd.read_parquet(path)
    except Exception as exc:
        result["status"] = "fail"
        result["warnings"].append(f"read error: {exc}")
        return symbol, result

    if "Date" not in df.columns:
        result["status"] = "fail"
        result["warnings"].append("missing Date column")
        return symbol, result

    df["Date"] = pd.to_datetime(df["Date"], errors="coerce").dt.date
    df = df.dropna(subset=["Date"])
    if df.empty:
        result["status"] = "fail"
        result["warnings"].append("no valid dates")
        return symbol, result

    is_sorted = df["Date"].is_monotonic_increasing
    if not is_sorted:
        result["warnings"].append("dates not sorted")
        result["status"] = "warn"

    if df["Date"].duplicated().any():
        result["warnings"].append("duplicate dates")
        result["status"] = "warn"

    last_date = df["Date"].iloc[-1]
    result["last_date"] = str(last_date)

    if last_date < (pd.Timestamp(last_bday) - BDay(5)).date():
        result["warnings"].append("stale last_date (>5 business days)")
        result["status"] = "warn"

    non_date_cols = [c for c in df.columns if c != "Date"]
    if non_date_cols:
        total = df[non_date_cols].size
        nan_count = df[non_date_cols].isna().sum().sum()
        if total > 0 and (nan_count / total) >= 0.01:
            result["warnings"].append("nan ratio >= 1%")
            result["status"] = "warn"

    return symbol, result


def validate_snapshot():
    root = _root_dir()
    data_root = root / "marketflow_data"
    paths = _ensure_dirs(data_root)
    logger = _setup_logger(paths["logs"] / "validate.log")

    prices_meta = paths["meta"] / "symbols_prices.json"
    macro_meta = paths["meta"] / "symbols_fred.json"
    price_symbols = _load_symbols(prices_meta, "symbols")
    macro_symbols = _load_symbols(macro_meta, "series")

    last_bday = _last_business_day(date.today())
    results = {}
    ok = warn = fail = 0

    for symbol in price_symbols:
        path = paths["prices_daily"] / f"{symbol}.parquet"
        sym, res = _validate_file(path, last_bday, logger)
        results[sym] = res
        if res["status"] == "ok":
            ok += 1
        elif res["status"] == "warn":
            warn += 1
        else:
            fail += 1
        if res["warnings"]:
            logger.warning("%s %s", sym, "; ".join(res["warnings"]))

    for series_id in macro_symbols:
        path = paths["macro_fred"] / f"{series_id}.parquet"
        sym, res = _validate_file(path, last_bday, logger)
        results[sym] = res
        if res["status"] == "ok":
            ok += 1
        elif res["status"] == "warn":
            warn += 1
        else:
            fail += 1
        if res["warnings"]:
            logger.warning("%s %s", sym, "; ".join(res["warnings"]))

    summary = {
        "run_time": datetime.utcnow().isoformat() + "Z",
        "ok_count": ok,
        "warn_count": warn,
        "fail_count": fail,
        "per_symbol": results,
    }

    last_run_path = paths["meta"] / "last_run.json"
    last_run_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    logger.info("SUMMARY ok=%d warn=%d fail=%d", ok, warn, fail)
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    sys.exit(validate_snapshot())
