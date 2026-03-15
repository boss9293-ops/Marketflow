"""
Build condition-based study stats for Validation (Playback).

Output:
  backend/output/condition_study_2018.json
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

def sys_path_bootstrap() -> None:
    import sys
    root = repo_root()
    backend_dir = os.path.join(root, "backend")
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    if root not in sys.path:
        sys.path.insert(0, root)


def output_path() -> str:
    return os.path.join(repo_root(), "backend", "output", "condition_study_2018.json")


def data_path(name: str) -> str:
    return os.path.join(repo_root(), "data", name)


def load_price_csv(path: str) -> Optional[pd.Series]:
    if not os.path.exists(path):
        return None
    df = pd.read_csv(path)
    if "date" not in df.columns or "close" not in df.columns:
        return None
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")
    return df.set_index("date")["close"].astype(float)


def compute_ret5(series: pd.Series) -> pd.Series:
    return (series / series.shift(4) - 1.0) * 100.0


def pct10(values: np.ndarray) -> Optional[float]:
    if values.size == 0:
        return None
    return float(np.percentile(values, 10))


def summarize_bucket(arr5: np.ndarray, arr10: np.ndarray) -> Dict[str, Optional[float]]:
    if arr5.size == 0:
        return {"avg5d": None, "p10_5d": None, "worst_5d": None, "worst_10d": None}
    worst10 = float(np.min(arr10)) if arr10.size > 0 else None
    return {
        "avg5d": float(np.mean(arr5)),
        "p10_5d": pct10(arr5),
        "worst_5d": float(np.min(arr5)),
        "worst_10d": worst10,
    }


def main() -> int:
    sys_path_bootstrap()
    from validation_engine import ValidationEngine

    start_date = "2018-01-01"
    end_date = datetime.today().strftime("%Y-%m-%d")

    engine = ValidationEngine()
    bundle = engine._fetch_data_bundle(start_date, end_date, market_proxy="QQQ")  # noqa: SLF001
    df_raw = bundle["df"]
    df = engine.compute_macro_series(df_raw, start_date, market_proxy="QQQ")

    qqq_csv = load_price_csv(data_path("qqq_history.csv"))
    tqqq_csv = load_price_csv(data_path("tqqq_history.csv"))

    base = pd.DataFrame(index=df.index)
    base["MPS"] = df["MPS"]
    base["VIX"] = df["VIX"]
    base["QQQ"] = (qqq_csv.reindex(base.index) if qqq_csv is not None else df.get("QQQ"))

    tqqq_source = "synthetic_3x_qqq"
    if tqqq_csv is not None:
        base["TQQQ"] = tqqq_csv.reindex(base.index)
        tqqq_source = "tqqq_history_csv"
    elif "TQQQ" in df.columns:
        base["TQQQ"] = df["TQQQ"]
        tqqq_source = "tqqq_db"
    else:
        daily_ret = base["QQQ"].pct_change().fillna(0.0)
        base["TQQQ"] = (1.0 + 3.0 * daily_ret).cumprod() * 100.0

    base = base.dropna(subset=["MPS", "VIX", "QQQ", "TQQQ"])

    base["ret5_qqq"] = compute_ret5(base["QQQ"])
    base["ret5_tqqq"] = compute_ret5(base["TQQQ"])
    base["ret10_qqq"] = (base["QQQ"] / base["QQQ"].shift(9) - 1.0) * 100.0
    base["ret10_tqqq"] = (base["TQQQ"] / base["TQQQ"].shift(9) - 1.0) * 100.0
    base = base.dropna(subset=["ret5_qqq", "ret5_tqqq"])

    def bucket(mps: float, vix: float) -> str:
        if mps >= 85 or vix >= 35:
            return "High Pressure"
        if mps >= 70 or vix >= 25:
            return "Pressure"
        if (50 <= mps < 70) or (20 <= vix < 25):
            return "Watch"
        if mps < 50 and vix < 20:
            return "Calm"
        return "Other"

    buckets: Dict[str, Dict[str, Any]] = {}
    for name in ["Calm", "Watch", "Pressure", "High Pressure"]:
        buckets[name] = {
            "days": 0,
            "qqq": {"avg5d": None, "p10_5d": None, "worst_5d": None, "worst_10d": None},
            "tqqq": {"avg5d": None, "p10_5d": None, "worst_5d": None, "worst_10d": None},
        }

    any_vals_qqq = []
    any_vals_tqqq = []
    any_vals_qqq10 = []
    any_vals_tqqq10 = []

    for _, row in base.iterrows():
        mps = float(row["MPS"])
        vix = float(row["VIX"])
        b = bucket(mps, vix)
        if b in buckets:
            buckets[b].setdefault("_qqq", []).append(float(row["ret5_qqq"]))
            buckets[b].setdefault("_tqqq", []).append(float(row["ret5_tqqq"]))
            buckets[b].setdefault("_qqq10", []).append(float(row["ret10_qqq"]))
            buckets[b].setdefault("_tqqq10", []).append(float(row["ret10_tqqq"]))
        any_vals_qqq.append(float(row["ret5_qqq"]))
        any_vals_tqqq.append(float(row["ret5_tqqq"]))
        any_vals_qqq10.append(float(row["ret10_qqq"]))
        any_vals_tqqq10.append(float(row["ret10_tqqq"]))

    for name, payload in buckets.items():
        qqq_vals = np.array(payload.pop("_qqq", []), dtype=float)
        tqqq_vals = np.array(payload.pop("_tqqq", []), dtype=float)
        qqq_vals10 = np.array(payload.pop("_qqq10", []), dtype=float)
        tqqq_vals10 = np.array(payload.pop("_tqqq10", []), dtype=float)
        payload["days"] = int(qqq_vals.size)
        payload["qqq"] = summarize_bucket(qqq_vals, qqq_vals10)
        payload["tqqq"] = summarize_bucket(tqqq_vals, tqqq_vals10)

    buckets["Any"] = {
        "days": int(len(any_vals_qqq)),
        "qqq": summarize_bucket(np.array(any_vals_qqq, dtype=float), np.array(any_vals_qqq10, dtype=float)),
        "tqqq": summarize_bucket(np.array(any_vals_tqqq, dtype=float), np.array(any_vals_tqqq10, dtype=float)),
    }

    out = {
        "generated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "range": {"start": start_date, "end": end_date},
        "thresholds": {
            "mps_elevated": 70,
            "mps_high": 85,
            "vix_elevated": 25,
            "vix_high": 35,
        },
        "tqqq_source": tqqq_source,
        "buckets": buckets,
    }

    os.makedirs(os.path.dirname(output_path()), exist_ok=True)
    with open(output_path(), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"[OK] condition study saved: {output_path()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
