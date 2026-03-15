"""
Build Macro Validation Auto-Guard snapshot (FRED4-first, QQQ/SPY proxy).

Outputs:
  - backend/storage/validation_snapshots/validation_snapshot_YYYYMMDD.json
  - backend/storage/validation_snapshots/validation_probe_YYYYMMDD.json (internal revision probe)
"""
from __future__ import annotations

import argparse
import json
import math
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple


def repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def backend_dir() -> str:
    return os.path.join(repo_root(), "backend")


def config_dir() -> str:
    return os.path.join(backend_dir(), "config")


def storage_dir() -> str:
    return os.path.join(backend_dir(), "storage", "validation_snapshots")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build macro validation Auto-Guard snapshot")
    p.add_argument("--market-proxy", choices=["QQQ", "SPY"], default="QQQ")
    p.add_argument("--snapshot-date", default="", help="Override snapshot date (YYYY-MM-DD)")
    p.add_argument("--guard-policy", default="", help="Path to validation guard policy JSON")
    p.add_argument("--pretty", action="store_true", help="Pretty-print output JSON")
    return p.parse_args()


def load_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: str, data: Dict[str, Any], pretty: bool = True) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=(2 if pretty else None), allow_nan=False)


def sanitize_value(v: Any) -> Any:
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return float(v)
    if isinstance(v, dict):
        return {str(k): sanitize_value(val) for k, val in v.items()}
    if isinstance(v, list):
        return [sanitize_value(x) for x in v]
    return v


def snapshot_file_path(snapshot_dt: str) -> str:
    ymd = snapshot_dt.replace("-", "")
    return os.path.join(storage_dir(), f"validation_snapshot_{ymd}.json")


def probe_file_path(snapshot_dt: str) -> str:
    ymd = snapshot_dt.replace("-", "")
    return os.path.join(storage_dir(), f"validation_probe_{ymd}.json")


def list_snapshot_paths() -> List[str]:
    d = storage_dir()
    if not os.path.isdir(d):
        return []
    names = [
        os.path.join(d, fn)
        for fn in os.listdir(d)
        if fn.startswith("validation_snapshot_") and fn.endswith(".json")
    ]
    return sorted(names)


def list_probe_paths() -> List[str]:
    d = storage_dir()
    if not os.path.isdir(d):
        return []
    names = [
        os.path.join(d, fn)
        for fn in os.listdir(d)
        if fn.startswith("validation_probe_") and fn.endswith(".json")
    ]
    return sorted(names)


def load_latest_prior(paths: List[str], target_path: str) -> Optional[Dict[str, Any]]:
    if not paths:
        return None
    target_name = os.path.basename(target_path)
    candidates = [p for p in paths if os.path.basename(p) <= target_name]
    if not candidates:
        candidates = paths[:]
    try:
        return load_json(candidates[-1])
    except Exception:
        return None


def aggregate_data_asof(runs: Dict[str, Dict[str, Any]]) -> Dict[str, Optional[str]]:
    keys = ["WALCL", "RRP", "EFFR", "VIX", "MARKET_PROXY"]
    out: Dict[str, Optional[str]] = {k: None for k in keys}
    for k in keys:
        vals = []
        for run in runs.values():
            v = ((run or {}).get("data_asof") or {}).get(k)
            if v:
                vals.append(str(v))
        out[k] = max(vals) if vals else None
    return out


def now_local_date_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def metric_projection(metrics: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "lead_time_to_vix25": metrics.get("avg_lead_time_vix"),
        "lead_time_to_dd10": metrics.get("avg_lead_time_dd"),
        "false_alarm_rate": metrics.get("false_alarm_rate"),
        "coverage_vix25": metrics.get("coverage_vix25", metrics.get("coverage")),
        "coverage_dd10": metrics.get("coverage_dd10", metrics.get("coverage")),
        "stability_mps_abschg95": metrics.get("stability_mps_abschg95", metrics.get("stability_95")),
        "avg_mps_conf": metrics.get("avg_mps_conf"),
    }


def add_delta_fields(snapshot_windows: Dict[str, Any], prev_snapshot: Optional[Dict[str, Any]]) -> None:
    baseline_metrics = (((snapshot_windows.get("baseline") or {}).get("metrics")) or {})
    for key in ["crisis_2020", "crisis_2022"]:
        wm = (((snapshot_windows.get(key) or {}).get("metrics")) or {})
        if not wm:
            continue
        for mkey in ["false_alarm_rate", "coverage_vix25", "coverage_dd10", "stability_mps_abschg95"]:
            cur = wm.get(mkey)
            base = baseline_metrics.get(mkey)
            wm[f"{mkey}_delta_vs_baseline"] = (cur - base) if _num(cur) and _num(base) else None

    if not prev_snapshot:
        return
    prev_base = ((((prev_snapshot.get("windows") or {}).get("baseline") or {}).get("metrics")) or {})
    base = (((snapshot_windows.get("baseline") or {}).get("metrics")) or {})
    for mkey in ["false_alarm_rate", "coverage_vix25", "coverage_dd10", "stability_mps_abschg95", "avg_mps_conf"]:
        cur = base.get(mkey)
        prv = prev_base.get(mkey)
        base[f"{mkey}_delta_vs_prev_snapshot"] = (cur - prv) if _num(cur) and _num(prv) else None


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not (isinstance(v, float) and (math.isnan(v) or math.isinf(v)))


def build_regression_checks(
    snapshot_windows: Dict[str, Any],
    thresholds: Dict[str, Any],
    revision_detected: bool,
) -> Dict[str, Any]:
    checks: List[Dict[str, Any]] = []
    failed: List[str] = []
    baseline = (((snapshot_windows.get("baseline") or {}).get("metrics")) or {})

    fa_max_delta = float(thresholds.get("false_alarm_rate_max_delta", 0.05))
    cov_min_delta = float(thresholds.get("coverage_min_delta", -0.07))
    stab_max_delta = float(thresholds.get("stability_mps_abschg95_max_delta", 9999))
    conf_min = float(thresholds.get("avg_confidence_min", 0))

    for win_key in ["baseline", "crisis_2020", "crisis_2022"]:
        m = (((snapshot_windows.get(win_key) or {}).get("metrics")) or {})
        conf_val = m.get("avg_mps_conf")
        passed = _num(conf_val) and float(conf_val) >= conf_min
        name = f"{win_key}.avg_mps_conf_min"
        checks.append({"name": name, "pass": bool(passed), "value": conf_val, "threshold": conf_min})
        if not passed:
            failed.append(name)

    for win_key in ["crisis_2020", "crisis_2022"]:
        m = (((snapshot_windows.get(win_key) or {}).get("metrics")) or {})
        if not m:
            continue

        def add_check(name_suffix: str, value: Any, threshold: float, pass_fn) -> None:
            name = f"{win_key}.{name_suffix}"
            ok = _num(value) and pass_fn(float(value), threshold)
            checks.append({"name": name, "pass": bool(ok), "value": value, "threshold": threshold})
            if not ok:
                failed.append(name)

        fa_delta = _delta(m.get("false_alarm_rate"), baseline.get("false_alarm_rate"))
        add_check("false_alarm_rate_delta", fa_delta, fa_max_delta, lambda v, t: v <= t)

        cov_vix_delta = _delta(m.get("coverage_vix25"), baseline.get("coverage_vix25"))
        add_check("coverage_vix25_delta", cov_vix_delta, cov_min_delta, lambda v, t: v >= t)

        cov_dd_delta = _delta(m.get("coverage_dd10"), baseline.get("coverage_dd10"))
        add_check("coverage_dd10_delta", cov_dd_delta, cov_min_delta, lambda v, t: v >= t)

        stab_delta_abs = _abs_delta(m.get("stability_mps_abschg95"), baseline.get("stability_mps_abschg95"))
        add_check(
            "stability_mps_abschg95_abs_delta",
            stab_delta_abs,
            stab_max_delta,
            lambda v, t: v <= t,
        )

    status = "OK" if (not failed and not revision_detected) else "Watch"
    return {
        "status": status,
        "failed_checks": failed,
        "checks": checks,
    }


def _delta(a: Any, b: Any) -> Optional[float]:
    if not _num(a) or not _num(b):
        return None
    return float(a) - float(b)


def _abs_delta(a: Any, b: Any) -> Optional[float]:
    d = _delta(a, b)
    return abs(d) if d is not None else None


def build_current_probe(engine, snapshot_dt: str, market_proxy: str, lookback_days: int) -> Tuple[Dict[str, Any], Dict[str, Optional[str]]]:
    # Fetch recent data up to snapshot date to capture latest source as-of + FRED revision probe window.
    end_dt = snapshot_dt
    start_dt = (datetime.strptime(snapshot_dt, "%Y-%m-%d").date() - timedelta(days=max(lookback_days + 10, 90))).strftime("%Y-%m-%d")
    bundle = engine._fetch_data_bundle(start_dt, end_dt, market_proxy=market_proxy)  # noqa: SLF001 - internal helper reuse
    cutoff = (datetime.strptime(snapshot_dt, "%Y-%m-%d").date() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    fred_probe_full = bundle.get("fred_probe") or {}
    fred_probe = {
        series: {d: v for d, v in (vals or {}).items() if d >= cutoff}
        for series, vals in fred_probe_full.items()
    }
    probe_doc = {
        "snapshot_date": snapshot_dt,
        "market_proxy": market_proxy,
        "lookback_days": lookback_days,
        "fred_probe": fred_probe,
    }
    return probe_doc, (bundle.get("data_asof") or {})


def detect_revisions(
    current_probe: Dict[str, Any],
    prev_probe: Optional[Dict[str, Any]],
    epsilon: float,
) -> Tuple[bool, List[str]]:
    if not prev_probe:
        return False, []
    notes: List[str] = []
    cur_series_map = current_probe.get("fred_probe") or {}
    prev_series_map = prev_probe.get("fred_probe") or {}

    for series in ["WALCL", "RRP", "EFFR"]:
        cur_vals = cur_series_map.get(series) or {}
        prev_vals = prev_series_map.get(series) or {}
        overlap_dates = sorted(set(cur_vals.keys()) & set(prev_vals.keys()))
        changes = 0
        first_note = None
        for d in overlap_dates:
            cv = cur_vals.get(d)
            pv = prev_vals.get(d)
            if _num(cv) and _num(pv):
                diff = abs(float(cv) - float(pv))
                if diff > epsilon:
                    changes += 1
                    if first_note is None:
                        first_note = f"{series} {d}: prev={pv} cur={cv} (Δ={diff:.6g})"
        added_old_dates = sorted([d for d in cur_vals.keys() if d not in prev_vals])
        removed_old_dates = sorted([d for d in prev_vals.keys() if d not in cur_vals])
        if changes:
            notes.append(f"[REVISION] {series}: {changes} changed observations in probe window; {first_note}")
        if added_old_dates:
            notes.append(f"[REVISION] {series}: {len(added_old_dates)} observations added in probe window (e.g. {added_old_dates[0]})")
        if removed_old_dates:
            notes.append(f"[REVISION] {series}: {len(removed_old_dates)} observations removed in probe window (e.g. {removed_old_dates[0]})")
    return (len(notes) > 0), notes


def main() -> int:
    args = parse_args()
    sys_path_bootstrap()

    from validation_engine import ValidationEngine  # pylint: disable=import-outside-toplevel

    gp_path = args.guard_policy or os.path.join(config_dir(), "validation_guard_policy_v1.json")
    guard_policy = load_json(gp_path)
    engine = ValidationEngine()

    snapshot_dt = args.snapshot_date.strip() or now_local_date_str()
    windows_cfg = guard_policy.get("windows") or {}

    runs: Dict[str, Dict[str, Any]] = {}
    snapshot_windows: Dict[str, Any] = {}
    for key in ["baseline", "crisis_2020", "crisis_2022"]:
        cfg = windows_cfg.get(key) or {}
        start = str(cfg.get("start"))
        end = str(cfg.get("end"))
        res = engine.run_validation_window(
            window_key=key,
            start_date=start,
            end_date=end,
            market_proxy=args.market_proxy,
            include_timeseries=False,
        )
        runs[key] = res
        snapshot_windows[key] = {
            "start": start,
            "end": end,
            "metrics": metric_projection(res.get("metrics") or {}),
        }

    snap_path = snapshot_file_path(snapshot_dt)
    prev_snapshot = load_latest_prior(list_snapshot_paths(), snap_path)

    rev_cfg = guard_policy.get("revision_detection") or {}
    lookback_days = int(rev_cfg.get("lookback_days", 60))
    epsilon = float(rev_cfg.get("change_epsilon", 1e-6))
    current_probe, probe_data_asof = build_current_probe(engine, snapshot_dt, args.market_proxy, lookback_days)
    prev_probe = load_latest_prior(list_probe_paths(), probe_file_path(snapshot_dt))
    revision_detected, revision_notes = detect_revisions(current_probe, prev_probe, epsilon)

    data_asof = aggregate_data_asof(runs)
    # Prefer current-source freshness probe values if available.
    for k, v in (probe_data_asof or {}).items():
        if v:
            data_asof[k] = v

    add_delta_fields(snapshot_windows, prev_snapshot)
    regression = build_regression_checks(snapshot_windows, guard_policy.get("thresholds") or {}, revision_detected)

    snapshot = {
        "snapshot_date": snapshot_dt,
        "policy_version": engine.policy.get("version", "macro_policy_v1"),
        "guard_policy_version": guard_policy.get("version", "validation_guard_policy_v1"),
        "data_asof": data_asof,
        "revision_detected": bool(revision_detected),
        "revision_notes": revision_notes,
        "windows": snapshot_windows,
        "regression": regression,
    }
    snapshot = sanitize_value(snapshot)

    probe_doc = sanitize_value(
        {
            "snapshot_date": snapshot_dt,
            "guard_policy_version": guard_policy.get("version", "validation_guard_policy_v1"),
            "revision_detection": {
                "lookback_days": lookback_days,
                "change_epsilon": epsilon,
            },
            "data_asof": probe_data_asof,
            "payload": current_probe,
        }
    )

    write_json(snap_path, snapshot, pretty=True)
    write_json(probe_file_path(snapshot_dt), probe_doc, pretty=False)

    print(f"[OK] validation snapshot saved: {snap_path}")
    print(f"      status={snapshot['regression']['status']} revision_detected={snapshot['revision_detected']}")
    return 0


def sys_path_bootstrap() -> None:
    import sys
    bdir = backend_dir()
    if bdir not in sys.path:
        sys.path.insert(0, bdir)
    root = repo_root()
    if root not in sys.path:
        sys.path.insert(0, root)


if __name__ == "__main__":
    raise SystemExit(main())
