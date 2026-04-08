"""Railway startup script — downloads DB, runs builds, starts gunicorn."""
import os, sys, subprocess, threading, urllib.request, datetime, json

PORT = os.environ.get("PORT", "8080")
BASE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(BASE, "scripts")
OUTPUT  = os.path.join(BASE, "output")
DB_PATH = os.path.join(BASE, "data", "marketflow.db")
DB_URL  = "https://github.com/boss9293-ops/Marketflow/releases/download/data-v1/marketflow.db"

os.makedirs(os.path.join(BASE, "data"), exist_ok=True)
os.makedirs(os.path.join(OUTPUT, "cache"), exist_ok=True)

# ── 1. Download DB if missing ──────────────────────────────────────────────
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

# ── 2. Build scripts ────────────────────────────────────────────────────────
# (script, output_json_or_None)  — None means startup.py writes a stamp file
BUILDS = [
    # Data updates first — write fresh market data into DB before builds read it
    ("update_market_daily.py",   "cache/update_market_daily_stamp.json"),
    ("update_ohlcv.py",          "cache/update_ohlcv_stamp.json"),
    ("build_daily_snapshot.py",  "cache/daily_snapshot_stamp.json"),
    ("update_snapshot_trends.py", "cache/update_snapshot_trends_stamp.json"),
    ("update_snapshot_alerts.py", "cache/update_snapshot_alerts_stamp.json"),
    # cache.db macro series (PUT_CALL / HY_OAS / IG_OAS / FSI)
    ("build_cache_series.py",    "cache/cache_series.json"),
    # Build outputs
    ("build_risk_v1.py",         "risk_v1.json"),
    ("build_vr_survival.py",     "vr_survival.json"),
    ("build_current_90d.py",     "current_90d.json"),
    ("build_smart_money.py",     "smart_money.json"),
    ("build_market_tape.py",     "market_tape.json"),
    ("build_overview.py",        "cache/overview.json"),
    ("build_snapshots_120d.py",  "cache/snapshots_120d.json"),
    ("build_market_state.py",    "cache/market_state.json"),
    ("build_health_snapshot.py", "cache/health_snapshot.json"),
    ("build_action_snapshot.py", "cache/action_snapshot.json"),
    ("build_daily_briefing.py",  "cache/daily_briefing.json"),
    ("build_daily_briefing_v3.py", "cache/daily_briefing_v3.json"),
    ("build_ai_briefings.py",    "briefing.json"),
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
    "build_vr_survival.py",
    "build_smart_money.py",
    "build_market_tape.py",
    "build_overview.py",
    "build_snapshots_120d.py",
    "build_market_state.py",
    "build_health_snapshot.py",
    "build_action_snapshot.py",
    "build_daily_briefing.py",
    "build_daily_briefing_v3.py",
    "build_ai_briefings.py",
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
    return str(payload.get("data_date") or "")[:10] == target_date


def run_builds():
    for script, outfile in BUILDS:
        out_path = os.path.join(OUTPUT, outfile) if outfile else None
        if script in DAILY_BUILDS:
            if script == "build_daily_briefing_v3.py" and out_path and _is_daily_briefing_v3_fresh(out_path):
                print(f"[build][SKIP-market-date] {script}", flush=True)
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
            tail = r.stdout.decode("utf-8", errors="replace")[-400:]
            status = "OK" if r.returncode == 0 else "FAIL"
            print(f"[build][{status}] {script}\n{tail}", flush=True)
            # For update scripts (no self-written output), write stamp on success
            if r.returncode == 0 and out_path and script in EXTRA_ARGS:
                _write_stamp(out_path)
        except Exception as e:
            print(f"[build][ERROR] {script}: {e}", flush=True)

build_thread = threading.Thread(target=run_builds, daemon=True)
build_thread.start()

os.environ["STARTUP_MANAGES_BUILDS"] = "1"

# ── 3. Start gunicorn ──────────────────────────────────────────────────────
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
