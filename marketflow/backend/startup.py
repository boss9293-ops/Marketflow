"""Railway startup script — downloads DB, runs builds, starts gunicorn."""
import os, sys, subprocess, threading, urllib.request

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
    ("build_risk_v1.py",      "risk_v1.json"),
    ("build_current_90d.py",  "current_90d.json"),
    ("build_smart_money.py",  "smart_money.json"),
    ("build_market_tape.py",  "market_tape.json"),
    ("build_market_state.py", "market_state.json"),
    # build_risk_alert.py needs cache.db — skip until uploaded to releases
]

def run_builds():
    for script, outfile in BUILDS:
        out_path = os.path.join(OUTPUT, outfile)
        if os.path.exists(out_path):
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
