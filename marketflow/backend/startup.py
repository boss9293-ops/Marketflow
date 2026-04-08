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

# ── 2. Build scripts in background (thread survives because we use Popen) ─
BUILDS = [
    ("build_risk_v1.py",         "risk_v1.json"),
    ("build_vr_survival.py",     "vr_survival.json"),
    ("build_current_90d.py",     "current_90d.json"),
    ("build_smart_money.py",     "smart_money.json"),
    ("build_market_tape.py",     "market_tape.json"),
    ("build_overview.py",        "cache/overview.json"),       # must run before market_state
    ("build_snapshots_120d.py",  "cache/snapshots_120d.json"), # dashboard
    ("build_market_state.py",      "market_state.json"),
    ("build_health_snapshot.py",   "cache/health_snapshot.json"),  # dashboard
    ("build_action_snapshot.py",   "cache/action_snapshot.json"),  # dashboard
    ("build_daily_briefing.py",    "cache/daily_briefing.json"),   # dashboard (rule-based, fast)
    ("build_daily_briefing_v3.py", "cache/daily_briefing_v3.json"), # briefing page (LLM KO)
    # build_risk_alert.py needs cache.db — skip until uploaded to releases
]

# Files that must be regenerated daily even if they exist (date-sensitive outputs)
DAILY_BUILDS = {
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
        date_fields = ["data_date", "date", "as_of"]
        for key in date_fields:
            val = str(obj.get(key) or "")
            if val[:10] == str(datetime.date.today()):
                return True
    except Exception:
        pass
    return False


def run_builds():
    for script, outfile in BUILDS:
        out_path = os.path.join(OUTPUT, outfile)
        if script in DAILY_BUILDS:
            if _is_today(out_path):
                print(f"[build][SKIP-today] {script}", flush=True)
                continue
        elif os.path.exists(out_path):
            print(f"[build][SKIP] {script}", flush=True)
            continue
        print(f"[build] Running {script}...", flush=True)
        try:
            r = subprocess.run(
                [sys.executable, os.path.join(SCRIPTS, script)],
                cwd=BASE, timeout=600,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT
            )
            tail = r.stdout.decode("utf-8", errors="replace")[-300:]
            status = "OK" if r.returncode == 0 else "FAIL"
            print(f"[build][{status}] {script}\n{tail}", flush=True)
        except Exception as e:
            print(f"[build][ERROR] {script}: {e}", flush=True)

build_thread = threading.Thread(target=run_builds, daemon=True)
build_thread.start()

# Tell app.py not to run its own build thread (startup.py owns builds)
os.environ['STARTUP_MANAGES_BUILDS'] = '1'

# ── 3. Start gunicorn (Popen keeps this process alive so build_thread runs) ─
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
