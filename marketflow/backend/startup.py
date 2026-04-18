"""Railway startup script: downloads DB, runs builds, starts gunicorn."""
import os, sys, subprocess, threading, urllib.request, datetime, json
from zoneinfo import ZoneInfo

from services.data_contract import live_db_path

PORT = os.environ.get("PORT", "8080")
BASE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(BASE, "scripts")
OUTPUT  = os.path.join(BASE, "output")
LIVE_DB_PATH = str(live_db_path())
DB_PATH = LIVE_DB_PATH
DB_URL  = "https://github.com/boss9293-ops/Marketflow/releases/download/data-v1/marketflow.db"
BUILD_LOG_DIR = os.path.join(OUTPUT, "cache", "build_logs")
ET_ZONE = ZoneInfo("America/New_York")
MARKET_OPEN_MINUTES_ET = 9 * 60 + 30
MARKET_CLOSE_MINUTES_ET = 16 * 60 + 30

os.makedirs(os.path.join(BASE, "data"), exist_ok=True)
os.makedirs(os.path.dirname(LIVE_DB_PATH), exist_ok=True)
os.makedirs(os.path.join(OUTPUT, "cache"), exist_ok=True)
os.makedirs(BUILD_LOG_DIR, exist_ok=True)

# 1. Download DB if missing
db_abs = os.path.abspath(DB_PATH)
if not os.path.exists(db_abs) or os.path.getsize(db_abs) < 100_000_000:
    print(f"[startup] Downloading marketflow.db ...", flush=True)
    try:
        urllib.request.urlretrieve(DB_URL, db_abs)
        print(f"[startup] DB ready: {os.path.getsize(db_abs)//1024//1024}MB", flush=True)
    except Exception as e:
        print(f"[startup] DB download failed: {e}", flush=True)
else:
    print(f"[startup] DB exists: {os.path.getsize(db_abs)//1024//1024}MB", flush=True)


def _env_value(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def _pull_turso_db_if_configured() -> bool:
    turso_url = _env_value("TURSO_DATABASE_URL", "LIBSQL_URL", "TURSO_URL")
    auth_token = _env_value("TURSO_AUTH_TOKEN", "LIBSQL_AUTH_TOKEN", "TURSO_TOKEN")
    if not turso_url or not auth_token:
        print("[startup][TURSO] Pull skipped (missing Turso env vars).", flush=True)
        return False

    try:
        import libsql
    except Exception as exc:
        print(f"[startup][TURSO] Pull skipped (libsql unavailable): {exc}", flush=True)
        return False

    if not os.environ.get("SSL_CERT_FILE"):
        try:
            import certifi

            os.environ["SSL_CERT_FILE"] = certifi.where()
        except Exception:
            pass

    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    print("[startup][TURSO] Pulling latest DB snapshot into live DB...", flush=True)
    start_time = datetime.datetime.now().timestamp()
    try:
        conn = libsql.connect(DB_PATH, sync_url=turso_url, auth_token=auth_token)
        try:
            if hasattr(conn, "sync"):
                conn.sync()
            else:
                print("[startup][TURSO] libsql connection has no sync(); using local DB as-is.", flush=True)
        finally:
            try:
                conn.close()
            except Exception:
                pass

        duration = datetime.datetime.now().timestamp() - start_time
        db_size_mb = os.path.getsize(DB_PATH) // 1024 // 1024 if os.path.exists(DB_PATH) else 0
        print(f"[startup][TURSO] Live DB refreshed from Turso in {duration:.1f}s ({db_size_mb}MB).", flush=True)
        return True
    except Exception as exc:
        duration = datetime.datetime.now().timestamp() - start_time
        print(f"[startup][TURSO][FAIL] Pull failed after {duration:.1f}s: {exc}", flush=True)
        return False


def _clear_risk_outputs() -> None:
    for rel_path in [
        "risk_v1.json",
        "risk_v1_playback.json",
        "risk_v1_sim.json",
        "mss_history.json",
        "current_90d.json",
        "soxx_context.json",
        "soxx_survival_playback.json",
        "vr_survival.json",
    ]:
        target = os.path.join(OUTPUT, rel_path)
        try:
            if os.path.exists(target):
                os.remove(target)
                print(f"[startup][TURSO] Cleared stale artifact: {rel_path}", flush=True)
        except Exception as exc:
            print(f"[startup][TURSO] Failed to clear {rel_path}: {exc}", flush=True)


if _pull_turso_db_if_configured():
    _clear_risk_outputs()


def _auto_import_holdings_from_sheets() -> bool:
    sheet_id = _env_value("GOOGLE_SHEETS_ID", "").strip()
    sheet_url = _env_value("GOOGLE_SHEETS_URL", "").strip()
    if not sheet_id and not sheet_url:
        print("[startup][SHEETS] Google Sheets source not configured; skipping holdings import.", flush=True)
        return True

    sa_json = _env_value("GOOGLE_SERVICE_ACCOUNT_JSON", "")
    if not sa_json:
        print("[startup][SHEETS] GOOGLE_SERVICE_ACCOUNT_JSON missing; skipping holdings import.", flush=True)
        return True

    tabs = os.environ.get("GOOGLE_SHEETS_TABS", "Goal,미국1,미국2,미국3,미국4,미국5,미국6,한국1")
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env["GOOGLE_SERVICE_ACCOUNT_JSON"] = sa_json

    print("[startup][SHEETS] Importing holdings tabs before news/brief builds...", flush=True)
    try:
        if sheet_url:
            import_args = ["--sheet_url", sheet_url]
        else:
            import_args = ["--sheet_id", sheet_id]
        import_args += ["--tabs", tabs]

        steps = [
            ("import_holdings_tabs.py", import_args, 300),
            ("build_holdings_ts_cache.py", [], 120),
            ("build_my_holdings_cache_from_ts.py", [], 120),
        ]
        for script_name, extra_args, timeout in steps:
            proc = subprocess.run(
                [sys.executable, "-X", "utf8", os.path.join(SCRIPTS, script_name), *extra_args],
                cwd=BASE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                env=env,
            )
            output = (proc.stdout or "").strip()
            if proc.returncode != 0:
                print(f"[startup][SHEETS][FAIL] {script_name} rc={proc.returncode}: {output[-3000:]}", flush=True)
                return False
            if output:
                print(f"[startup][SHEETS][OK] {script_name}: {output[-3000:]}", flush=True)
        return True
    except Exception as exc:
        print(f"[startup][SHEETS][FAIL] {exc}", flush=True)
        return False


# 2. Build scripts
# (script, output_json_or_None)  None means startup.py writes a stamp file
BUILDS = [
    # Data updates first -- refresh ohlcv before market_daily reads from it
    ("update_ohlcv.py",          "cache/update_ohlcv_stamp.json"),
    ("update_market_daily.py",   "cache/update_market_daily_stamp.json"),
    ("build_daily_snapshot.py",  "cache/daily_snapshot_stamp.json"),
    ("update_snapshot_trends.py", "cache/update_snapshot_trends_stamp.json"),
    ("update_snapshot_alerts.py", "cache/update_snapshot_alerts_stamp.json"),
    # cache.db macro series (PUT_CALL / HY_OAS / IG_OAS / FSI)
    ("build_cache_series.py",    "cache/cache_series.json"),
    # Build outputs
    ("build_risk_v1.py",         "risk_v1.json"),
    ("build_vr_survival.py",     "vr_survival.json"),
    ("build_current_90d.py",     "current_90d.json"),
    ("build_soxx_context.py",    "soxx_context.json"),
    ("build_soxx_survival_playback.py", "soxx_survival_playback.json"),
    ("build_smart_money.py",     "smart_money.json"),
    ("build_market_tape.py",     "market_tape.json"),
    ("build_overview.py",        "cache/overview.json"),
    ("build_snapshots_120d.py",  "cache/snapshots_120d.json"),
    ("build_market_state.py",    "cache/market_state.json"),
    ("build_health_snapshot.py", "cache/health_snapshot.json"),
    ("build_action_snapshot.py", "cache/action_snapshot.json"),
    ("build_context_news.py",    "cache/context_news.json"),
    ("build_account_ticker_briefs.py", "cache/ticker_brief_index.json"),
    ("build_daily_briefing_v3.py", "cache/daily_briefing_v3.json"),
    ("build_vr_pattern_dashboard.py", "vr_pattern_dashboard.json"),
    ("build_ai_briefings.py",    "briefing.json"),
    ("build_data_manifest.py",   "cache/data_manifest.json"),
]

# Extra CLI args for specific scripts
EXTRA_ARGS = {
    "update_market_daily.py": ["--days", "30"],   # incremental: last 30 days only
    "update_ohlcv.py":        ["--years", "1"],   # incremental: last 1 year
    "build_daily_snapshot.py": [],
    "update_snapshot_trends.py": ["--days", "120"],
    "update_snapshot_alerts.py": ["--days", "120"],
}

# Scripts that must be re-run every day (date-sensitive outputs)
DAILY_BUILDS = {
    "update_market_daily.py",
    "update_ohlcv.py",
    "build_daily_snapshot.py",
    "update_snapshot_trends.py",
    "update_snapshot_alerts.py",
    "build_cache_series.py",
    "build_risk_v1.py",
    "build_current_90d.py",
    "build_soxx_context.py",
    "build_soxx_survival_playback.py",
    "build_vr_survival.py",
    "build_smart_money.py",
    "build_market_tape.py",
    "build_overview.py",
    "build_snapshots_120d.py",
    "build_market_state.py",
    "build_health_snapshot.py",
    "build_action_snapshot.py",
    "build_context_news.py",
    "build_account_ticker_briefs.py",
    "build_daily_briefing_v3.py",
    "build_vr_pattern_dashboard.py",
    "build_ai_briefings.py",
    "build_data_manifest.py",
}


def _is_today(out_path: str) -> bool:
    """Return True if file exists AND was generated for today's date."""
    if not os.path.exists(out_path):
        return False
    try:
        with open(out_path, encoding="utf-8") as f:
            obj = json.load(f)
        ts = obj.get("generated_at") or ""
        if ts:
            gen = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
            today = datetime.datetime.now(datetime.timezone.utc).date()
            if gen.date() >= today:
                return True
        for key in ["data_date", "date", "as_of"]:
            val = str(obj.get(key) or "")
            if val[:10] == str(datetime.date.today()):
                return True
    except Exception:
        pass
    return False


def _write_stamp(out_path: str) -> None:
    """Write a today-stamp JSON so _is_today() will skip this script tomorrow."""
    try:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({
                "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
                "data_date": str(datetime.date.today()),
            }, f)
    except Exception:
        pass


def _load_json(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _sync_turso_if_configured() -> None:
    sync_script = os.path.join(SCRIPTS, "sync_marketflow_to_turso.py")
    if not os.path.exists(sync_script):
        print("[startup][TURSO] Sync script not found; skipping.", flush=True)
        return

    turso_url = _env_value("TURSO_DATABASE_URL", "LIBSQL_URL", "TURSO_URL")
    auth_token = _env_value("TURSO_AUTH_TOKEN", "LIBSQL_AUTH_TOKEN", "TURSO_TOKEN")
    if not turso_url or not auth_token:
        print("[startup][TURSO] Sync skipped (missing Turso env vars).", flush=True)
        return

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    print("[startup][TURSO] Syncing local DB to Turso...", flush=True)
    start_time = datetime.datetime.now().timestamp()
    try:
        proc = subprocess.run(
            [sys.executable, "-X", "utf8", sync_script],
            cwd=BASE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            encoding="utf-8",
            errors="replace",
            timeout=14400,
            env=env,
        )
        duration = datetime.datetime.now().timestamp() - start_time
        output = (proc.stdout or "").strip()
        if proc.returncode == 0:
            if output:
                print(f"[startup][TURSO][OK] {output[-4000:]}", flush=True)
        else:
            message = output[-4000:] if output else f"exit code {proc.returncode}"
            print(f"[startup][TURSO][FAIL] {message}", flush=True)
        print(f"[startup][TURSO] completed in {duration:.1f}s", flush=True)
    except Exception as exc:
        print(f"[startup][TURSO][FAIL] {exc}", flush=True)


def _current_et_date_slot() -> tuple[str, str]:
    now = datetime.datetime.now(ET_ZONE)
    date_key = now.strftime("%Y-%m-%d")
    minutes = now.hour * 60 + now.minute
    if minutes < MARKET_OPEN_MINUTES_ET:
        slot = "preopen"
    elif minutes < MARKET_CLOSE_MINUTES_ET:
        slot = "morning"
    else:
        slot = "close"
    return date_key, slot


def _is_context_news_fresh(out_path: str) -> bool:
    payload = _load_json(out_path)
    if not isinstance(payload, dict):
        return False
    current_date, current_slot = _current_et_date_slot()
    return (
        str(payload.get("date") or "")[:10] == current_date
        and str(payload.get("slot") or "").strip().lower() == current_slot
    )


def _is_daily_briefing_v3_fresh(out_path: str) -> bool:
    """Keep daily_briefing_v3 aligned with the latest market_state date."""
    market_state_path = os.path.join(OUTPUT, "cache", "market_state.json")
    market_state = _load_json(market_state_path)
    target_date = str((market_state or {}).get("data_date") or "")[:10]
    if not target_date:
        return _is_today(out_path)

    payload = _load_json(out_path)
    if not isinstance(payload, dict):
        return False
    _, current_slot = _current_et_date_slot()
    return str(payload.get("data_date") or "")[:10] == target_date and str(payload.get("slot") or "").strip().lower() == current_slot


def _is_ai_briefings_fresh(out_path: str) -> bool:
    payload = _load_json(out_path)
    if not isinstance(payload, dict):
        return False
    current_date, current_slot = _current_et_date_slot()
    return (
        str(payload.get("asof_day") or "")[:10] == current_date
        and str(payload.get("slot") or "").strip().lower() == current_slot
    )


def run_builds():
    had_failure = False
    failed_scripts: list[str] = []

    if not _auto_import_holdings_from_sheets():
        had_failure = True
        failed_scripts.append("auto_import_holdings_from_sheets")

    def _write_build_log(script_name: str, payload: dict) -> None:
        try:
            path = os.path.join(BUILD_LOG_DIR, f"{script_name.replace('.py', '')}.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
        except Exception:
            pass

    for script, outfile in BUILDS:
        out_path = os.path.join(OUTPUT, outfile) if outfile else None
        if script in DAILY_BUILDS:
            if script == "build_context_news.py" and out_path and _is_context_news_fresh(out_path):
                print(f"[build][SKIP-market-slot] {script}", flush=True)
                continue
            if script == "build_daily_briefing_v3.py" and out_path and _is_daily_briefing_v3_fresh(out_path):
                print(f"[build][SKIP-market-date] {script}", flush=True)
                continue
            if script == "build_ai_briefings.py" and out_path and _is_ai_briefings_fresh(out_path):
                print(f"[build][SKIP-market-slot] {script}", flush=True)
                continue
            if out_path and _is_today(out_path):
                print(f"[build][SKIP-today] {script}", flush=True)
                continue
        elif out_path and os.path.exists(out_path):
            print(f"[build][SKIP] {script}", flush=True)
            continue

        extra = EXTRA_ARGS.get(script, [])
        print(f"[build] Running {script} {' '.join(extra)}...", flush=True)
        try:
            r = subprocess.run(
                [sys.executable, os.path.join(SCRIPTS, script)] + extra,
                cwd=BASE, timeout=600,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT
            )
            full_output = r.stdout.decode("utf-8", errors="replace")
            tail = full_output[-4000:]
            status = "OK" if r.returncode == 0 else "FAIL"
            print(f"[build][{status}] {script}\n{tail}", flush=True)
            _write_build_log(script, {
                "script": script,
                "args": extra,
                "status": status,
                "returncode": r.returncode,
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                "output_head": full_output[:2000],
                "output_tail": full_output[-12000:],
            })
            if r.returncode != 0:
                had_failure = True
                failed_scripts.append(script)
            # For update scripts (no self-written output), write stamp on success
            if r.returncode == 0 and out_path and script in EXTRA_ARGS:
                _write_stamp(out_path)
        except Exception as e:
            print(f"[build][ERROR] {script}: {e}", flush=True)
            had_failure = True
            failed_scripts.append(script)
            _write_build_log(script, {
                "script": script,
                "args": extra,
                "status": "ERROR",
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                "error": str(e),
            })

    if had_failure:
        failed_list = ", ".join(failed_scripts[:10]) if failed_scripts else "unknown"
        if len(failed_scripts) > 10:
            failed_list += f" (+{len(failed_scripts) - 10} more)"
        print(f"[startup][TURSO] Sync skipped because one or more startup builds failed: {failed_list}", flush=True)
    else:
        _sync_turso_if_configured()

build_thread = threading.Thread(target=run_builds, daemon=True)
build_thread.start()

os.environ["STARTUP_MANAGES_BUILDS"] = "1"

# 3. Start gunicorn
print(f"[startup] Starting gunicorn on port {PORT}", flush=True)
proc = subprocess.Popen([
    "gunicorn",
    "--bind", f"0.0.0.0:{PORT}",
    "--workers", "1",
    "--threads", "8",
    "--timeout", "300",
    "app:app"
])
sys.exit(proc.wait())
