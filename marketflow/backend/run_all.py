"""
MarketFlow - Run All Scripts
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import time
import argparse
from datetime import datetime

import requests


if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


SCRIPTS_DIR = os.path.join(os.path.dirname(__file__), "scripts")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

DEFAULT_TIMEOUT = 600  # 10 minutes default

# Scripts that need a longer timeout (SP500 bulk downloads etc.)
SCRIPT_TIMEOUTS: dict[str, int] = {
    "update_market_daily.py": 600,   # 10 min -- yfinance VIX/rates/FX
    "update_ohlcv.py":       3600,  # 60 min — 500 symbols × yfinance/stooq
    "update_indicators.py":  1800,  # 30 min — 500 symbols × indicator calc
    "build_daily_snapshot.py": 600, # 10 min — heavy join across all symbols
    "screener.py":           600,   # 10 min — scoring across all symbols
    "predictor_ml.py":       600,   # 10 min — ML inference
    "build_snapshots_120d.py": 600, # 10 min — 120-day rolling series
}


SCRIPTS = [
    ("market_data.py", "Market Data + Gate Score"),
    ("build_economic_calendar.py", "Economic Calendar Snapshot"),
    ("build_earnings_calendar.py", "Earnings Calendar (yfinance)"),
    ("kr_market_data.py", "KR Market Data + Signals + AI Skeleton"),
    ("screener.py", "Stock Screener (Top Picks)"),
    ("vcp_detector.py", "VCP Pattern Scanner"),
    ("sector_rotation_stocks.py", "Sector Rotation Picks"),
    ("predictor_ml.py", "ML Direction Predictor"),
    ("regime_classifier.py", "Market Regime Classifier"),
    ("risk_calculator.py", "Portfolio Risk Calculator"),
    ("sector_performance.py", "Sector Performance"),
    ("briefing_ai.py", "AI Market Briefing"),
    ("validate_kr_outputs.py", "KR Output Contract Validation"),
    # DB/cache chain (order-sensitive)
    ("update_market_daily.py", "Update Market Daily (QQQ/SPY/VIX/rates/FX/commodities)"),
    ("update_ohlcv.py", "Update OHLCV Daily"),
    ("update_indicators.py", "Update Indicators Daily"),
    ("build_daily_snapshot.py", "Build Daily Snapshot"),
    ("update_snapshot_alerts.py", "Update Snapshot Alerts"),
    ("build_hot_zone.py", "Build HOT ZONE Cache"),
    ("build_sector_rotation_cache.py", "Build Sector Rotation Cache"),
    ("build_ml_prediction.py", "Build ML Prediction v2 Cache"),
    ("build_smart_money.py", "Build Smart Money v1 Cache"),
    ("build_daily_report.py", "Build Daily Report Cache"),
    ("build_my_holdings_cache.py", "Build My Holdings Cache (optional)"),
    ("build_etf_room.py", "Build ETF Room Cache"),
    ("build_cache_json.py", "Build Dashboard Cache JSON"),
    ("build_snapshots_120d.py", "Build 120-Day Snapshot Series"),
    ("build_overview.py", "Build Overview Summary"),
    ("build_market_state.py", "Build Market State Pills"),
    ("build_market_tape.py", "Build Market Tape Cache"),
    ("build_health_snapshot.py", "Build Health Snapshot Row"),
    ("build_action_snapshot.py", "Build Action Snapshot Row"),
    ("build_daily_briefing.py", "Build Daily Briefing Snapshot"),
    ("build_context_news.py", "Build Context News Cache"),
    ("build_market_health.py", "Build Market Health 4-Score"),
    ("risk_engine.py",       "Compute Risk Engine Metrics"),
    ("collect_macro_cache.py", "Collect Macro Cache (SQLite)"),
    ("build_macro_snapshot.py", "Build Macro Layer v2 Snapshot"),
    ("build_validation_snapshot.py", "Build Macro Validation Auto-Guard Snapshot"),
    ("validate_cache.py",   "Validate Cache & Write healthcheck.json"),
]


def run_script(filename: str, description: str, index: int, total: int) -> tuple[bool, float]:
    script_path = os.path.join(SCRIPTS_DIR, filename)
    timeout = SCRIPT_TIMEOUTS.get(filename, DEFAULT_TIMEOUT)
    print(f"\n[{index}/{total}] {description}")
    print(f"     Running {filename}... (timeout={timeout}s)", flush=True)

    start = time.time()
    try:
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        result = subprocess.run(
            [sys.executable, "-X", "utf8", script_path],
            capture_output=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        elapsed = time.time() - start

        if result.returncode == 0:
            output = result.stdout.strip()
            print(f"     OK ({elapsed:.1f}s) - {output}")
            return True, elapsed

        err = result.stderr.strip().split("\n")[-1] if result.stderr else "Unknown error"
        print(f"     FAIL ({elapsed:.1f}s) - {err}")
        return False, elapsed
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start
        print(f"     TIMEOUT (>{timeout}s)")
        return False, elapsed
    except Exception as e:
        print(f"     ERROR - {e}")
        return False, 0.0


def print_summary(results: list[tuple[str, str, bool, float]]) -> None:
    print("\n" + "=" * 55)
    print(" MarketFlow Data Pipeline - Summary")
    print("=" * 55)

    total_time = 0.0
    success = 0
    for filename, desc, ok, elapsed in results:
        status = "OK" if ok else "FAIL"
        print(f"  [{status:4}] {desc:<30} {elapsed:6.1f}s")
        total_time += elapsed
        if ok:
            success += 1

    print("-" * 55)
    print(f"  Total: {success}/{len(results)} succeeded in {total_time:.1f}s")

    print(f"\n  Output files in {OUTPUT_DIR}/:")
    if os.path.exists(OUTPUT_DIR):
        files = sorted(os.listdir(OUTPUT_DIR))
        for f in files:
            if f.endswith(".json"):
                path = os.path.join(OUTPUT_DIR, f)
                size = os.path.getsize(path)
                print(f"    {f:<30} {size:>8,} bytes")
    print("=" * 55)


def save_pipeline_report(results: list[tuple[str, str, bool, float]]) -> dict:
    report = {
        "timestamp": datetime.now().isoformat(),
        "total": len(results),
        "success": len([r for r in results if r[2]]),
        "failed": len([r for r in results if not r[2]]),
        "items": [
            {
                "filename": filename,
                "description": desc,
                "ok": ok,
                "elapsed_sec": round(elapsed, 2),
            }
            for filename, desc, ok, elapsed in results
        ],
    }
    path = os.path.join(OUTPUT_DIR, "pipeline_report.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"  Report saved: {path}")
    return report


def notify_webhook_if_needed(report: dict) -> None:
    url = os.environ.get("PIPELINE_WEBHOOK_URL", "").strip()
    if not url:
        return

    failed_items = [x for x in report["items"] if not x["ok"]]
    payload = {
        "service": "MarketFlow",
        "event": "pipeline_run",
        "timestamp": report["timestamp"],
        "success": report["success"],
        "failed": report["failed"],
        "failed_items": failed_items,
    }
    try:
        requests.post(url, json=payload, timeout=8)
        print("  Webhook notification sent.")
    except Exception as e:
        print(f"  Webhook notification failed: {e}")


HOLDINGS_SCRIPTS = [
    ("list_sheet_tabs.py", "List Google Sheet Tabs"),
    ("import_holdings_tabs.py", "Import Holdings Tabs from Google Sheets"),
    ("build_holdings_ts_cache.py", "Build Holdings Time-Series Cache"),
    ("build_my_holdings_cache_from_ts.py", "Build Holdings Snapshot Cache (TS)"),
    ("build_cache_json.py", "Build Dashboard Cache JSON"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run MarketFlow pipeline scripts")
    parser.add_argument(
        "--mode",
        default="full",
        choices=["full", "holdings"],
        help="Pipeline mode: 'full' = all scripts, 'holdings' = Google Sheets holdings only",
    )
    parser.add_argument(
        "--sheet_id",
        default="",
        help="(holdings mode) Google Spreadsheet ID",
    )
    parser.add_argument(
        "--tabs",
        default="",
        help="(holdings mode) Comma-separated tab names to import (default: use selectable tabs, include Goal)",
    )
    return parser.parse_args()


def run_holdings_mode(sheet_id: str, tabs: str) -> None:
    """Run only the Google Sheets holdings import + cache build pipeline."""
    print("=" * 55)
    print(" MarketFlow - Holdings Pipeline")
    print(f" Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f" sheet_id={sheet_id or '(from GOOGLE_SHEETS_ID env)'}  tabs={tabs}")
    print("=" * 55)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    extra_env: dict[str, str] = {}
    if sheet_id:
        extra_env["HOLDINGS_SHEET_ID"] = sheet_id

    _sid = sheet_id or os.environ.get("GOOGLE_SHEETS_ID", "")
    import_extra_args: list[str] = []
    list_extra_args: list[str] = []
    if _sid:
        list_extra_args = ["--sheet_id", _sid]
        if tabs:
            import_extra_args = ["--sheet_id", _sid, "--tabs", tabs]

    results: list[tuple[str, str, bool, float]] = []
    total = len(HOLDINGS_SCRIPTS)

    for i, (filename, desc) in enumerate(HOLDINGS_SCRIPTS, 1):
        script_path = os.path.join(SCRIPTS_DIR, filename)
        print(f"\n[{i}/{total}] {desc}")
        print(f"     Running {filename}...", flush=True)
        start = time.time()
        try:
            env = {**os.environ.copy(), "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1", **extra_env}
            cmd = [sys.executable, "-X", "utf8", script_path]
            if filename == "list_sheet_tabs.py" and list_extra_args:
                cmd += list_extra_args
            if filename == "import_holdings_tabs.py":
                # If tabs not provided, try to reuse selectable tabs from sheet_tabs.json
                if not import_extra_args:
                    tabs_json = os.path.join(OUTPUT_DIR, "sheet_tabs.json")
                    auto_tabs = []
                    if os.path.exists(tabs_json):
                        try:
                            with open(tabs_json, "r", encoding="utf-8") as f:
                                tpayload = json.load(f)
                            auto_tabs = tpayload.get("selectable") or []
                            if "Goal" not in auto_tabs and any(t.lower() == "goal" for t in auto_tabs):
                                pass
                            elif "Goal" not in auto_tabs:
                                auto_tabs.insert(0, "Goal")
                        except Exception:
                            auto_tabs = []
                    tabs_str = ",".join(auto_tabs) if auto_tabs else (tabs or "Goal")
                else:
                    tabs_str = tabs
                cmd += ["--sheet_id", _sid, "--tabs", tabs_str]
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=180,
                encoding="utf-8",
                errors="replace",
                env=env,
            )
            elapsed = time.time() - start
            if result.returncode == 0:
                print(f"     OK ({elapsed:.1f}s) - {result.stdout.strip()}")
                results.append((filename, desc, True, elapsed))
            else:
                err = result.stderr.strip().split("\n")[-1] if result.stderr else "Unknown error"
                print(f"     FAIL ({elapsed:.1f}s) - {err}")
                results.append((filename, desc, False, elapsed))
        except subprocess.TimeoutExpired:
            print("     TIMEOUT (>180s)")
            results.append((filename, desc, False, 180.0))
        except Exception as e:
            print(f"     ERROR - {e}")
            results.append((filename, desc, False, 0.0))

    print_summary(results)
    save_pipeline_report(results)


def main() -> None:
    args = parse_args()

    if args.mode == "holdings":
        run_holdings_mode(args.sheet_id, args.tabs)
        return

    print("=" * 55)
    print(" MarketFlow - Data Pipeline")
    print(f" Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 55)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    results: list[tuple[str, str, bool, float]] = []
    total = len(SCRIPTS)

    for i, (filename, desc) in enumerate(SCRIPTS, 1):
        ok, elapsed = run_script(filename, desc, i, total)
        results.append((filename, desc, ok, elapsed))

    print_summary(results)
    report = save_pipeline_report(results)
    notify_webhook_if_needed(report)

    # Exit non-zero if validate_cache.py failed (critical cache files missing)
    failed = [r for r in results if not r[2]]
    if any(r[0] == 'validate_cache.py' for r in failed):
        print('CRITICAL: validate_cache.py FAILED - cache is incomplete.')
        sys.exit(1)


if __name__ == "__main__":
    main()
