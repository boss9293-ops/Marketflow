import sys
from flask import Flask, jsonify, request, Response


from flask_cors import CORS


try:


    from dotenv import load_dotenv as _load_dotenv


    import pathlib as _pathlib


    _load_dotenv(_pathlib.Path(__file__).parent.parent / '.env')


    _load_dotenv(_pathlib.Path(__file__).parent.parent / '.env.local', override=True)


except Exception:


    pass


# Fix: curl_cffi cannot handle non-ASCII paths (Korean dir) -> copy cacert.pem to ASCII path


try:


    import os as _os, shutil as _shutil, certifi as _certifi


    _ascii_cert = 'd:/tmp/cacert.pem'


    if not _os.path.exists(_ascii_cert):


        _shutil.copy2(_certifi.where(), _ascii_cert)


    for _k in ('SSL_CERT_FILE', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE'):


        _os.environ.setdefault(_k, _ascii_cert)


except Exception:


    pass


import csv


import io


import json, os, re, sqlite3, subprocess, sys, threading


sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scripts'))
_BACKEND_DIR = os.path.dirname(__file__)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)


from db_utils import db_connect as _db_connect, resolve_marketflow_db

import tempfile


from datetime import datetime, timedelta


import hashlib


from ai import gpt_client, gemini_client


from services.prompt_manager import PromptManager

try:
    from services.data_contract import (
        artifact_path as contract_artifact_path,
        load_manifest as contract_load_manifest,
        live_db_path as contract_live_db_path,
    )
except Exception:
    contract_artifact_path = None
    contract_load_manifest = None
    contract_live_db_path = None


from api.analyze_srs import srs_bp


from api.analyze_integrated import integrated_bp


from api.analyze_stock import stock_analysis_bp


from api.analyze_financials import financials_bp


from api.analyze_watchlist import watchlist_analysis_bp

from api.analyze_portfolio import portfolio_analysis_bp

from api.strategy_universe import strategy_universe_bp

from api.etf_catalog_api import etf_catalog_bp
from api.vr_ohlcv_api import vr_ohlcv_bp

from api.narrative import narrative_bp

from api.pipeline_metrics import pipeline_metrics_bp


from api.pipeline_intelligence import pipeline_intelligence_bp


from api.pipeline_recovery import pipeline_recovery_bp


from api.pipeline_root_cause import pipeline_root_cause_bp


from api.pipeline_retry_policy import pipeline_retry_policy_bp


from api.pipeline_retry_audit import pipeline_retry_audit_bp


from api.pipeline_healing import pipeline_healing_bp


from api.pipeline_ops_mode import pipeline_ops_mode_bp


from api.pipeline_episode import pipeline_episode_bp


from api.pipeline_predictive import pipeline_predictive_bp


from api.pipeline_runbook import pipeline_runbook_bp


from api.pipeline_digest  import pipeline_digest_bp


# -- In-memory TTL cache (10s) ------------------------------------------


import time as _time


from validation_engine import ValidationEngine


from jobs.scheduler import start_scheduler


from news.context_narrative import build_context_narrative


_CACHE_STORE: dict = {}


_CACHE_TTL = 10  # seconds





def _cache_get(key: str):


    entry = _CACHE_STORE.get(key)


    if entry and (_time.monotonic() - entry["ts"] < _CACHE_TTL):


        return entry["val"]


    return None





def _cache_set(key: str, val):


    _CACHE_STORE[key] = {"ts": _time.monotonic(), "val": val}


    return val





def load_json_cached(filename: str):


    """load_json with 10s TTL cache."""


    hit = _cache_get(filename)


    if hit is not None:


        return hit


    return _cache_set(filename, load_json(filename))





def load_json_or_none_cached(filename: str):


    """load_json_or_none with 10s TTL cache."""


    hit = _cache_get(filename)


    if hit is not None:


        return hit


    result = load_json_or_none(filename)


    if result is not None:


        _cache_set(filename, result)


    return result


# -----------------------------------------------------------------------








app = Flask(__name__)


CORS(app)


app.register_blueprint(srs_bp)


app.register_blueprint(integrated_bp)


app.register_blueprint(stock_analysis_bp)


app.register_blueprint(financials_bp)


app.register_blueprint(watchlist_analysis_bp)

app.register_blueprint(portfolio_analysis_bp)

app.register_blueprint(strategy_universe_bp)

app.register_blueprint(etf_catalog_bp)
app.register_blueprint(vr_ohlcv_bp)

app.register_blueprint(narrative_bp)

app.register_blueprint(pipeline_metrics_bp)


app.register_blueprint(pipeline_intelligence_bp)


app.register_blueprint(pipeline_recovery_bp)


app.register_blueprint(pipeline_root_cause_bp)


app.register_blueprint(pipeline_retry_policy_bp)


app.register_blueprint(pipeline_retry_audit_bp)


app.register_blueprint(pipeline_healing_bp)


app.register_blueprint(pipeline_ops_mode_bp)


app.register_blueprint(pipeline_episode_bp)


app.register_blueprint(pipeline_predictive_bp)


app.register_blueprint(pipeline_runbook_bp)
app.register_blueprint(pipeline_digest_bp)

@app.route('/api/data/<path:filename>')
def serve_data_json(filename):
    data = _read_json_from_candidates(filename)
    if data is not None:
        return jsonify(data)

    if _ensure_data_artifact(filename):
        data = _read_json_from_candidates(filename)
        if data is not None:
            return jsonify(data)

    return jsonify({"error": "not found"}), 404



OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')

VALIDATION_SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), 'storage', 'validation_snapshots')

MACRO_SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), 'storage', 'macro_snapshots')

MACRO_SNAPSHOT_DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'snapshots')





def _resolve_main_db_path() -> str:
    """Prefer the canonical marketflow/data DB, but fall back to the legacy root DB."""
    candidates = []
    if contract_live_db_path is not None:
        try:
            candidates.append(str(contract_live_db_path()))
        except Exception:
            pass

    base_dir = os.path.dirname(__file__)
    candidates.extend([
        os.path.abspath(os.path.join(base_dir, 'data', 'marketflow.db')),
        os.path.abspath(os.path.join(base_dir, '..', 'data', 'marketflow.db')),
        os.path.abspath(os.path.join(base_dir, '..', '..', 'data', 'marketflow.db')),
    ])
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return candidates[0]

DB_PATH = _resolve_main_db_path()

def _download_db_if_missing():
    import urllib.request
    if not os.path.exists(DB_PATH) or os.path.getsize(DB_PATH) < 1000000:
        print("Downloading marketflow.db from GitHub releases...", flush=True)
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        url = "https://github.com/boss9293-ops/Marketflow/releases/download/data-v1/marketflow.db"
        try:
            urllib.request.urlretrieve(url, DB_PATH)
            print("Download complete.", flush=True)
        except Exception as e:
            print(f"Failed to download DB: {e}", flush=True)

_download_db_if_missing()

def _run_builds_if_needed():
    """Run core build scripts in background if output files are missing."""
    if os.environ.get('STARTUP_MANAGES_BUILDS'):
        print('[build] startup.py owns builds ??skipping app.py build thread.', flush=True)
        return
    import threading, subprocess as _sp

    def _build():
        _scripts_dir = os.path.join(os.path.dirname(__file__), 'scripts')
        _out = OUTPUT_DIR
        builds = [
            ('build_risk_v1.py',     os.path.join(_out, 'risk_v1.json')),
            ('build_risk_alert.py',  os.path.join(_out, 'risk_alert.json')),
            ('build_current_90d.py', os.path.join(_out, 'current_90d.json')),
            ('build_soxx_context.py', os.path.join(_out, 'soxx_context.json')),
            ('build_soxx_survival_playback.py', os.path.join(_out, 'soxx_survival_playback.json')),
            ('build_smart_money.py', os.path.join(_out, 'smart_money.json')),
            ('build_market_tape.py', os.path.join(_out, 'market_tape.json')),
            ('build_market_state.py', os.path.join(_out, 'market_state.json')),
            ('build_snapshots_120d.py', os.path.join(_out, 'cache', 'snapshots_120d.json')),
            ('build_health_snapshot.py', os.path.join(_out, 'cache', 'health_snapshot.json')),
            ('build_action_snapshot.py', os.path.join(_out, 'cache', 'action_snapshot.json')),
            ('build_context_news.py', os.path.join(_out, 'cache', 'context_news.json')),
            ('build_daily_briefing_v3.py', os.path.join(_out, 'cache', 'daily_briefing_v3.json')),
            ('build_vr_pattern_dashboard.py', os.path.join(_out, 'vr_pattern_dashboard.json')),
        ]
        for script, output_file in builds:
            if not os.path.exists(output_file):
                print(f'[build] Running {script}...', flush=True)
                try:
                    r = _sp.run(
                        [sys.executable, os.path.join(_scripts_dir, script)],
                        cwd=os.path.dirname(__file__),
                        capture_output=True, timeout=600
                    )
                    if r.returncode == 0:
                        print(f'[build][OK] {script}', flush=True)
                    else:
                        print(f'[build][FAIL] {script}: {r.stderr.decode("utf-8",errors="replace")[-300:]}', flush=True)
                except Exception as e:
                    print(f'[build][ERROR] {script}: {e}', flush=True)
            else:
                print(f'[build][SKIP] {script} (output exists)', flush=True)

    t = threading.Thread(target=_build, daemon=True)
    t.start()

_run_builds_if_needed()


CACHE_DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'cache.db')
MY_HOLDINGS_PATH = os.path.join(OUTPUT_DIR, 'my_holdings.json')
MY_HOLDINGS_SNAPSHOT_PATH = os.path.join(OUTPUT_DIR, 'my_holdings_cache.json')
MY_HOLDINGS_CACHE_PATH = os.path.join(os.path.dirname(__file__), '..', 'output', 'cache', 'my_holdings.json')
HOLDINGS_IMPORT_SCRIPT = os.path.join(os.path.dirname(__file__), 'scripts', 'import_holdings_csv.py')
SA_CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config', 'google_sa.json')








# ???? Watchlist DB helpers ????????????????????????????????????????????????????????????????????????????????????????????????????????????


def _get_db():


    return _db_connect(DB_PATH, row_factory=True)








def _validate_symbol(raw):


    if not raw:


        return None


    s = str(raw).strip().upper()


    if not re.match(r'^[A-Z0-9.\-]{1,10}$', s):


        return None


    return s








def _parse_int(value, default=0):


    try:


        return int(value)


    except Exception:


        return default








def _ensure_watchlist_table():


    try:


        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


        conn = _db_connect(DB_PATH)


        conn.execute('''


            CREATE TABLE IF NOT EXISTS watchlist_symbols (


                id INTEGER PRIMARY KEY AUTOINCREMENT,


                symbol TEXT UNIQUE NOT NULL,


                label TEXT,


                created_at TEXT DEFAULT CURRENT_TIMESTAMP


            )


        ''')


        conn.commit()


        conn.close()


    except Exception:


        pass








_ensure_watchlist_table()








def _validate_symbol_lenient(raw):


    if raw is None:


        return None


    s = str(raw).strip().upper()


    if not s:


        return None


    if not re.match(r'^[A-Z0-9.\-]{1,15}$', s):


        return None


    return s








def _build_my_holdings_cache_script():


    script = os.path.join(os.path.dirname(__file__), 'scripts', 'build_my_holdings_cache.py')


    env = os.environ.copy()


    env['PYTHONIOENCODING'] = 'utf-8'


    env['PYTHONUTF8'] = '1'

    if not env.get('GOOGLE_SERVICE_ACCOUNT_JSON'):
        sa = _get_sa_json()
        if sa:
            env['GOOGLE_SERVICE_ACCOUNT_JSON'] = sa


    return subprocess.run(


        [sys.executable, '-X', 'utf8', script],


        capture_output=True,


        encoding='utf-8',


        errors='replace',


        timeout=120,


        env=env,


    )





def _run_backend_script(script_name: str, extra_args=None, timeout: int = 180):


    extra_args = extra_args or []


    script = os.path.join(os.path.dirname(__file__), 'scripts', script_name)


    env = os.environ.copy()


    env['PYTHONIOENCODING'] = 'utf-8'


    env['PYTHONUTF8'] = '1'


    return subprocess.run(


        [sys.executable, '-X', 'utf8', script, *extra_args],


        capture_output=True,


        encoding='utf-8',


        errors='replace',


        timeout=timeout,


        env=env,


    )


_RISK_V1_OUTPUTS = {
    'risk_v1.json',
    'risk_v1_playback.json',
    'risk_v1_sim.json',
    'mss_history.json',
}
_RISK_V1_REFRESH_LOCK = threading.Lock()


def _risk_v1_outputs_ready() -> bool:
    return all(os.path.exists(os.path.join(OUTPUT_DIR, name)) for name in _RISK_V1_OUTPUTS)


def _ensure_risk_v1_outputs(force: bool = False):
    if not force and _risk_v1_outputs_ready():
        return True

    with _RISK_V1_REFRESH_LOCK:
        if not force and _risk_v1_outputs_ready():
            return True

        result = _run_backend_script('build_risk_v1.py', timeout=1200)
        if result.returncode != 0:
            tail = (result.stdout or result.stderr or '')[-3000:]
            print(f"[risk_v1] rebuild failed: {tail}", flush=True)
            return False
        return _risk_v1_outputs_ready()





_DATA_BUILD_SPECS: dict[str, tuple[str, int]] = {
    'sheet_tabs.json': ('list_sheet_tabs.py', 180),
    'my_holdings_ts.json': ('build_holdings_ts_cache.py', 120),
    'my_holdings_cache.json': ('build_my_holdings_cache_from_ts.py', 120),
    'risk_v1.json': ('build_risk_v1.py', 1200),
    'risk_v1_playback.json': ('build_risk_v1.py', 1200),
    'risk_v1_sim.json': ('build_risk_v1.py', 1200),
    'mss_history.json': ('build_risk_v1.py', 1200),
    'risk_alert.json': ('build_risk_alert.py', 600),
    'risk_alert_playback.json': ('build_risk_alert.py', 600),
    'current_90d.json': ('build_current_90d.py', 600),
    'soxx_context.json': ('build_soxx_context.py', 300),
    'soxx_survival_playback.json': ('build_soxx_survival_playback.py', 600),
    'smart_money.json': ('build_smart_money.py', 300),
    'market_tape.json': ('build_market_tape.py', 300),
    'market_state.json': ('build_market_state.py', 300),
    'overview.json': ('build_overview.py', 300),
    'snapshots_120d.json': ('build_snapshots_120d.py', 600),
    'health_snapshot.json': ('build_health_snapshot.py', 300),
    'action_snapshot.json': ('build_action_snapshot.py', 300),
    'context_news.json': ('build_context_news.py', 180),
    'daily_briefing_v3.json': ('build_daily_briefing_v3.py', 300),
    'vr_pattern_dashboard.json': ('build_vr_pattern_dashboard.py', 180),
    'vr_survival.json': ('build_vr_survival.py', 600),
    'vr_survival_playback.json': ('build_vr_survival.py', 600),
    'condition_study_2018.json': ('build_condition_study.py', 600),
    'macro_layer.json': ('macro_fred4_pipeline.py', 600),
}
_DATA_BUILD_LOCKS: dict[str, threading.Lock] = {}
_DATA_BUILD_LOCKS_GUARD = threading.Lock()
_HOLDINGS_REFRESH_LOCK = threading.Lock()
_HOLDINGS_ARTIFACTS = {
    'sheet_tabs.json',
    'my_holdings_goal.json',
    'my_holdings_tabs.json',
    'my_holdings_ts.json',
    'my_holdings_cache.json',
}


def _data_build_lock(name: str) -> threading.Lock:
    with _DATA_BUILD_LOCKS_GUARD:
        lock = _DATA_BUILD_LOCKS.get(name)
        if lock is None:
            lock = threading.Lock()
            _DATA_BUILD_LOCKS[name] = lock
        return lock


def _holdings_expected_tabs() -> list[str]:
    raw = os.environ.get('GOOGLE_SHEETS_TABS', 'Goal,미국1,미국2,미국3,미국4,미국5,미국6,한국1')
    return [tab.strip() for tab in raw.split(',') if tab.strip()]


def _holdings_artifacts_complete() -> bool:
    sheet_tabs = _read_json_from_candidates('sheet_tabs.json')
    goal_payload = _read_json_from_candidates('my_holdings_goal.json')
    tabs_payload = _read_json_from_candidates('my_holdings_tabs.json')
    ts_payload = _read_json_from_candidates('my_holdings_ts.json')

    if not (
        isinstance(sheet_tabs, dict)
        and isinstance(goal_payload, dict)
        and isinstance(tabs_payload, dict)
        and isinstance(ts_payload, dict)
    ):
        return False
    return True


def _refresh_holdings_from_sheets() -> bool:
    sheet_id = os.environ.get('GOOGLE_SHEETS_ID', '').strip()
    sheet_url = os.environ.get('GOOGLE_SHEETS_URL', '').strip()
    if not sheet_id and not sheet_url:
        return False
    if not _get_sa_json():
        return False

    with _HOLDINGS_REFRESH_LOCK:
        if _holdings_artifacts_complete():
            return True
        try:
            _auto_import_holdings_from_sheets()
        except Exception as exc:
            print(f"[holdings] auto-import failed: {exc}", flush=True)
            return False
        return _holdings_artifacts_complete()


def _ensure_data_artifact(filename: str) -> bool:
    name = os.path.basename(str(filename or '').replace('\\', '/').strip())
    if not name:
        return False

    if _read_json_from_candidates(filename) is not None:
        return True

    if name in _HOLDINGS_ARTIFACTS:
        if _refresh_holdings_from_sheets():
            return _read_json_from_candidates(filename) is not None

    if name == 'risk_v1.json' or name in _RISK_V1_OUTPUTS:
        return _ensure_risk_v1_outputs()

    script_spec = _DATA_BUILD_SPECS.get(name)
    if not script_spec:
        return False

    script_name, timeout = script_spec
    lock = _data_build_lock(name)
    with lock:
        if _read_json_from_candidates(filename) is not None:
            return True
        result = _run_backend_script(script_name, timeout=timeout)
        if result.returncode != 0:
            tail = (result.stdout or result.stderr or '')[-3000:]
            print(f"[data-build] {script_name} failed for {name}: {tail}", flush=True)
            return _read_json_from_candidates(filename) is not None
        return _read_json_from_candidates(filename) is not None


def _get_sa_json() -> str:


    """Return Google SA JSON from env var or stored config file."""


    v = os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON', '').strip()


    if v:


        return v


    if os.path.exists(SA_CONFIG_PATH):


        try:


            with open(SA_CONFIG_PATH, 'r', encoding='utf-8') as f:


                return f.read().strip()


        except Exception:


            pass


    return ''








def _run_sheets_script(script_name: str, extra_args=None, timeout: int = 180):


    """Like _run_backend_script but injects GOOGLE_SERVICE_ACCOUNT_JSON from config if missing."""


    extra_args = extra_args or []


    script = os.path.join(os.path.dirname(__file__), 'scripts', script_name)


    env = os.environ.copy()


    env['PYTHONIOENCODING'] = 'utf-8'


    env['PYTHONUTF8'] = '1'


    if not env.get('GOOGLE_SERVICE_ACCOUNT_JSON'):


        sa = _get_sa_json()


        if sa:


            env['GOOGLE_SERVICE_ACCOUNT_JSON'] = sa


    return subprocess.run(


        [sys.executable, '-X', 'utf8', script, *extra_args],


        capture_output=True,


        encoding='utf-8',


        errors='replace',


        timeout=timeout,


        env=env,


    )








def now_iso():


    return datetime.now().isoformat()





_DATA_MANIFEST_CACHE: dict | None = None
_DATA_MANIFEST_LOCK = threading.Lock()


def _dedupe_candidate_paths(candidates: list[str]) -> list[str]:
    seen = set()
    deduped: list[str] = []
    for candidate in candidates:
        candidate = os.path.abspath(candidate)
        if candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


def _load_data_manifest() -> dict:
    global _DATA_MANIFEST_CACHE
    if _DATA_MANIFEST_CACHE is not None:
        return _DATA_MANIFEST_CACHE

    with _DATA_MANIFEST_LOCK:
        if _DATA_MANIFEST_CACHE is not None:
            return _DATA_MANIFEST_CACHE

        manifest: dict = {}
        if contract_load_manifest is not None:
            try:
                loaded = contract_load_manifest()
                if isinstance(loaded, dict):
                    manifest = loaded
            except Exception:
                manifest = {}

        _DATA_MANIFEST_CACHE = manifest
        return _DATA_MANIFEST_CACHE


def _manifest_relative_candidates(filename: str) -> list[str]:
    rel = str(filename or '').strip().replace('\\', '/').lstrip('/').strip()
    if not rel:
        return []

    manifest = _load_data_manifest()
    artifacts = manifest.get('artifacts') if isinstance(manifest.get('artifacts'), dict) else {}
    if not artifacts:
        return [rel]

    base = os.path.basename(rel)
    candidates: list[str] = []
    for key, artifact in artifacts.items():
        key_rel = str(key or '').replace('\\', '/').strip('/').strip()
        if not key_rel:
            continue
        key_base = os.path.basename(key_rel)
        if key_rel == rel or key_base == base or key_rel == base:
            relative_path = key_rel
            if isinstance(artifact, dict):
                artifact_rel = str(artifact.get('relative_path') or '').replace('\\', '/').strip('/').strip()
                if artifact_rel:
                    relative_path = artifact_rel
            candidates.append(relative_path)

    if rel not in candidates:
        candidates.append(rel)

    return list(dict.fromkeys(candidates))


def _legacy_json_candidate_paths(rel: str) -> list[str]:
    rel = str(rel or '').strip().replace('\\', os.sep).lstrip('/\\')
    if not rel:
        return []

    base = os.path.basename(rel)
    base_dir = os.path.dirname(__file__)
    legacy_cache_dir = os.path.abspath(os.path.join(base_dir, 'output', 'cache', 'legacy'))
    candidates = [
        os.path.abspath(os.path.join(base_dir, '..', 'data', 'snapshots', rel)),
        os.path.abspath(os.path.join(base_dir, 'output', rel)),
    ]

    if base == rel:
        candidates.append(os.path.abspath(os.path.join(base_dir, 'output', 'cache', base)))
        candidates.append(os.path.join(legacy_cache_dir, base))
    else:
        candidates.append(os.path.abspath(os.path.join(base_dir, 'output', base)))
        candidates.append(os.path.abspath(os.path.join(base_dir, 'output', 'cache', base)))
        candidates.append(os.path.join(legacy_cache_dir, base))

    return candidates


def _json_candidate_paths(filename: str) -> list[str]:


    rel = str(filename or '').strip().replace('\\', os.sep).lstrip('/\\')


    if not rel:


        return []


    candidates = []
    for rel_path in _manifest_relative_candidates(rel):
        if contract_artifact_path is not None:
            try:
                candidates.append(str(contract_artifact_path(rel_path)))
            except Exception:
                pass
        candidates.extend(_legacy_json_candidate_paths(rel_path))

    if contract_artifact_path is not None:
        try:
            candidates.append(str(contract_artifact_path(rel)))
        except Exception:
            pass

    candidates.extend(_legacy_json_candidate_paths(rel))
    return _dedupe_candidate_paths(candidates)




def _read_json_from_candidates(filename: str):


    for candidate in _json_candidate_paths(filename):


        if not os.path.exists(candidate):


            continue


        try:


            with open(candidate, 'r', encoding='utf-8') as f:


                return json.load(f)


        except Exception:


            continue


    return None




def load_json(filename):
    data = _read_json_from_candidates(filename)
    return data if data is not None else {}





def load_json_or_none(filename):
    data = _read_json_from_candidates(filename)
    if data is not None:
        return data

    if _ensure_data_artifact(filename):
        return _read_json_from_candidates(filename)

    return None








# ???? Navigator AI helpers ????????????????????????????????????????????????????????????????????????????????????????????????


PROMPT_DIR = os.path.join(os.path.dirname(__file__), '..', 'prompts')


AI_CACHE_PATH = os.path.join(OUTPUT_DIR, 'navigator_ai_cache.json')


_AI_RATE_STORE: dict = {}


_AI_DAILY_LIMIT = int(os.environ.get('NAV_AI_DAILY_LIMIT', '10'))


AI_PROMPT_VERSION = "v2-long"








def _ai_today_key():


    return datetime.now().strftime('%Y-%m-%d')








def _ai_rate_key(ip: str, provider: str):


    return f"{_ai_today_key()}|{ip}|{provider}"








def _ai_rate_allow(ip: str, provider: str) -> bool:


    key = _ai_rate_key(ip, provider)


    count = _AI_RATE_STORE.get(key, 0)


    if count >= _AI_DAILY_LIMIT:


        return False


    _AI_RATE_STORE[key] = count + 1


    return True








def _load_prompt(name: str) -> str:


    path = os.path.join(PROMPT_DIR, name)


    if os.path.exists(path):


        with open(path, 'r', encoding='utf-8') as f:


            return f.read()


    return ""








def _render_prompt(template: str, context_pack: dict) -> str:


    payload = json.dumps(context_pack or {}, ensure_ascii=False, indent=2)


    return template.replace('{{context_json}}', payload)








def _ai_cache_load() -> dict:


    if os.path.exists(AI_CACHE_PATH):


        try:


            with open(AI_CACHE_PATH, 'r', encoding='utf-8') as f:


                return json.load(f)


        except Exception:


            return {}


    return {}








def _ai_cache_save(data: dict):


    os.makedirs(os.path.dirname(AI_CACHE_PATH), exist_ok=True)


    with open(AI_CACHE_PATH, 'w', encoding='utf-8') as f:


        json.dump(data, f, ensure_ascii=False, indent=2)








def _ai_cache_latest_for_lang(provider: str, lang: str):


    cache = _ai_cache_load()


    latest = None


    latest_ts = None


    for key, entry in cache.items():


        try:


            if not key.endswith(f'|{lang}'):


                continue


            data = (entry or {}).get(provider)


            if not data:


                continue


            ts = data.get('asof')


            if ts and (latest_ts is None or ts > latest_ts):


                latest_ts = ts


                latest = data


        except Exception:


            continue


    return latest








def _ai_cache_key(context_pack: dict) -> str:


    base = {


        'date': context_pack.get('date') or _ai_today_key(),


        'asset': context_pack.get('asset') or 'TQQQ',


        'profile': context_pack.get('profile') or 'default',


        'timeframe': context_pack.get('timeframe') or '1D',


        'range': context_pack.get('range') or '1Y',


        'mode': context_pack.get('mode') or 'engine',


        'state': context_pack.get('state') or 'UNKNOWN',


        'lang': context_pack.get('lang') or 'ko',


        'pv': AI_PROMPT_VERSION,


    }


    return '|'.join([str(base[k]) for k in ['date', 'asset', 'profile', 'timeframe', 'range', 'mode', 'state', 'lang', 'pv']])








def _parse_ai_lines(text: str) -> dict:


    out = {'weather': None, 'evidence': None, 'action': None, 'psychology': None}


    if not text:


        return out


    current = None

    buffer = {
        'weather': [],
        'evidence': [],
        'action': [],
        'psychology': [],
    }

    label_map = {
        'weather': 'weather',
        'evidence': 'evidence',
        'action': 'action',
        'psychology': 'psychology',
    }

    def _strip_label_prefix(line: str) -> str:
        cleaned = line.strip()
        cleaned = re.sub(r'^\*{1,3}\s*', '', cleaned)
        cleaned = re.sub(r'^(weather|evidence|action|psychology)\s*[:\-]\s*', '', cleaned, flags=re.IGNORECASE)
        return cleaned.strip()

    def _detect_label(line: str):
        cleaned = _strip_label_prefix(line)
        m = re.match(r'^(weather|evidence|action|psychology)\s*[:\-]?\s*(.*)$', cleaned, flags=re.IGNORECASE)
        if not m:
            return None, cleaned
        label = label_map.get(m.group(1).lower())
        content = m.group(2).strip()
        return label, content

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue

        label, content = _detect_label(line)
        if not content:
            continue

        if label:
            current = label
            buffer[current].append(content)
        elif current:
            buffer[current].append(content)

    for key in buffer:
        if buffer[key]:
            out[key] = "\n".join(buffer[key]).strip()

    if not any(out.values()):
        out['weather'] = text.strip()

    return out

def load_context_news_cache():


    return load_json_or_none_cached('cache/context_news.json')





def load_validation_snapshot_latest():


    d = VALIDATION_SNAPSHOT_DIR


    if not os.path.isdir(d):


        return None


    files = sorted(


        fn for fn in os.listdir(d)


        if fn.startswith('validation_snapshot_') and fn.endswith('.json')


    )


    if not files:


        return None


    path = os.path.join(d, files[-1])


    try:


        with open(path, 'r', encoding='utf-8') as f:


            data = json.load(f)


        if isinstance(data, dict):


            data['_meta'] = {


                'source_file': files[-1],


                'source_path': path,


            }


        return data


    except Exception:


        return None





def load_macro_snapshot_latest():


    # v1.0 preferred path


    latest_path = os.path.join(MACRO_SNAPSHOT_DATA_DIR, 'macro_snapshot_latest.json')


    if os.path.exists(latest_path):


        try:


            with open(latest_path, 'r', encoding='utf-8') as f:


                data = json.load(f)


            if isinstance(data, dict):


                data['_meta'] = {'source_file': os.path.basename(latest_path), 'source_path': latest_path}


            return data


        except Exception:


            pass





    # legacy fallback path


    d = MACRO_SNAPSHOT_DIR


    if os.path.isdir(d):


        files = sorted(


            fn for fn in os.listdir(d)


            if fn.endswith('.json') and re.match(r'^\d{4}-\d{2}-\d{2}\.json$', fn)


        )


        for fn in reversed(files):


            path = os.path.join(d, fn)


            try:


                with open(path, 'r', encoding='utf-8') as f:


                    data = json.load(f)


                if isinstance(data, dict):


                    data['_meta'] = {'source_file': fn, 'source_path': path}


                return data


            except Exception:


                continue


    return None





def _safe_float(v):


    try:


        f = float(v)


    except Exception:


        return None


    if f != f:


        return None


    return f





def _safe_int(v, default):


    try:


        return int(v)


    except Exception:


        return default





def _macro_snapshot_files():


    paths = []


    # v1.0 data snapshots


    d_new = MACRO_SNAPSHOT_DATA_DIR


    if os.path.isdir(d_new):


        files_new = sorted(


            fn for fn in os.listdir(d_new)


            if fn.endswith('.json') and re.match(r'^macro_snapshot_\d{8}_\d{4}\.json$', fn)


        )


        paths.extend([os.path.join(d_new, fn) for fn in files_new])


    # legacy snapshots


    d_old = MACRO_SNAPSHOT_DIR


    if os.path.isdir(d_old):


        files_old = sorted(


            fn for fn in os.listdir(d_old)


            if fn.endswith('.json') and re.match(r'^\d{4}-\d{2}-\d{2}\.json$', fn)


        )


        paths.extend([os.path.join(d_old, fn) for fn in files_old])


    return sorted(paths)





def _validation_status_by_date():


    out = {}


    d = VALIDATION_SNAPSHOT_DIR


    if not os.path.isdir(d):


        return out


    files = sorted(


        fn for fn in os.listdir(d)


        if fn.startswith('validation_snapshot_') and fn.endswith('.json')


    )


    for fn in files:


        path = os.path.join(d, fn)


        try:


            with open(path, 'r', encoding='utf-8') as f:


                snap = json.load(f)


            payload = build_validation_guard_badge_payload(snap)


            dt = str(payload.get('snapshot_date') or '')


            if dt:


                out[dt] = {


                    'status': payload.get('status', 'Watch'),


                    'revision_detected': bool(payload.get('revision_detected', False)),


                }


        except Exception:


            continue


    return out





def _macro_summary_row(snapshot, val_map):


    c = snapshot.get('computed') or {}


    series = snapshot.get('series') or {}


    date_key = str(snapshot.get('snapshot_date') or '')


    val_info = val_map.get(date_key, {})


    revision_detected = bool(val_info.get('revision_detected', False)) or any(


        bool((series.get(k) or {}).get('revision_risk_flag', False)) for k in series.keys()


    )


    return {


        'snapshot_date': date_key,


        'mps': _safe_float((c.get('MPS') or {}).get('value')),


        'lpi': _safe_float((c.get('LPI') or {}).get('value')),


        'rpi': _safe_float((c.get('RPI') or {}).get('value')),


        'vri': _safe_float((c.get('VRI') or {}).get('value')),


        'csi_value': _safe_float((c.get('CSI') or {}).get('value')),


        'csi_state': (c.get('CSI') or {}).get('state') or (c.get('CSI') or {}).get('status') or 'NA',


        'put_call_value': _safe_float((c.get('PUT_CALL') or {}).get('score') if (c.get('PUT_CALL') or {}).get('score') is not None else (c.get('PUT_CALL') or {}).get('value')),


        'put_call_state': (c.get('PUT_CALL') or {}).get('state') or (c.get('PUT_CALL') or {}).get('status') or 'NA',


        'xconf': (c.get('XCONF') or {}).get('status') or 'NA',


        'ghedge': (c.get('GHEDGE') or {}).get('status') or 'NA',


        'quality_overall': c.get('quality_overall') or (c.get('MPS') or {}).get('quality') or 'NA',


        'validation_status': val_info.get('status', 'Watch'),


        'revision_detected': revision_detected,


        'series': series,


    }





def _with_drift_metrics(rows):


    if not rows:


        return []


    asc = sorted(rows, key=lambda r: r.get('snapshot_date', ''))


    for i, row in enumerate(asc):


        prev = asc[i - 1] if i > 0 else None


        mps_delta_1d = None


        max_abs_component_delta = None


        if prev:


            cur_mps = _safe_float(row.get('mps'))


            prev_mps = _safe_float(prev.get('mps'))


            if cur_mps is not None and prev_mps is not None:


                mps_delta_1d = cur_mps - prev_mps


            deltas = []


            for k in ('lpi', 'rpi', 'vri'):


                cv = _safe_float(row.get(k))


                pv = _safe_float(prev.get(k))


                if cv is not None and pv is not None:


                    deltas.append(abs(cv - pv))


            if deltas:


                max_abs_component_delta = max(deltas)


        drift_flag = bool(


            (mps_delta_1d is not None and abs(mps_delta_1d) > 10.0) or


            (max_abs_component_delta is not None and max_abs_component_delta > 12.0)


        )


        row['mps_delta_1d'] = mps_delta_1d


        row['max_abs_component_delta'] = max_abs_component_delta


        row['drift_flag'] = drift_flag


    return sorted(asc, key=lambda r: r.get('snapshot_date', ''), reverse=True)





def _safe_series_latest(series_obj, symbol):


    try:


        return _safe_float(((series_obj or {}).get(symbol) or {}).get('latest', {}).get('value'))


    except Exception:


        return None





def _enrich_rows_from_cache(rows):


    """


    Fill missing per-snapshot series.latest.value using cache.db series_data.


    This keeps old snapshot formats usable in history charts.


    """


    if not rows or not os.path.exists(CACHE_DB_PATH):


        return rows


    symbols = ['BTC', 'QQQ', 'M2SL', 'GLD', 'VIX']


    by_date = {}


    for r in rows:


        d = str(r.get('snapshot_date') or '')


        if d:


            by_date[d] = r


    dates = sorted(by_date.keys())


    if not dates:


        return rows


    try:


        conn = _db_connect(CACHE_DB_PATH, row_factory=True)


        for sym in symbols:


            cur = conn.execute(


                """


                SELECT date, value


                FROM series_data


                WHERE symbol=?


                ORDER BY date ASC


                """,


                (sym,),


            )


            vals = [(str(rr['date']), _safe_float(rr['value'])) for rr in cur.fetchall()]


            if not vals:


                continue


            j = 0


            last_v = None


            last_d = None


            for d in dates:


                while j < len(vals) and vals[j][0] <= d:


                    last_d, last_v = vals[j]


                    j += 1


                if last_v is None:


                    continue


                row = by_date.get(d)


                if row is None:


                    continue


                series = row.get('series') or {}


                cur_latest = _safe_series_latest(series, sym)


                if cur_latest is None:


                    if sym not in series or not isinstance(series.get(sym), dict):


                        series[sym] = {}


                    series[sym]['latest'] = {'value': last_v, 'date': last_d}


                    row['series'] = series


    except Exception:


        return rows


    finally:


        try:


            conn.close()


        except Exception:


            pass


    return rows





def load_macro_snapshots(limit=30):


    # allow up to ~3 years for history charting use-cases


    limit = max(1, min(1095, _safe_int(limit, 30)))


    files = _macro_snapshot_files()


    if not files:


        return []


    val_map = _validation_status_by_date()


    rows = []


    for path in files:


        try:


            with open(path, 'r', encoding='utf-8') as f:


                snap = json.load(f)


            rows.append(_macro_summary_row(snap, val_map))


        except Exception:


            continue


    rows = _enrich_rows_from_cache(rows)


    rows = _with_drift_metrics(rows)


    return rows[:limit]





def _calc_probe_revision_entries(limit=50):


    d = VALIDATION_SNAPSHOT_DIR


    if not os.path.isdir(d):


        return []


    probe_files = sorted(


        fn for fn in os.listdir(d)


        if fn.startswith('validation_probe_') and fn.endswith('.json')


    )


    if len(probe_files) < 2:


        return []





    series_name_map = {


        'WALCL': 'WALCL',


        'RRP': 'RRPONTSYD',


        'EFFR': 'EFFR',


        'VIX': 'VIXCLS',


        'M2': 'M2SL',


        'DFII10': 'DFII10',


        'DGS10': 'DGS10',


        'CPI': 'CPIAUCSL',


    }





    def _load_probe(path):


        try:


            with open(path, 'r', encoding='utf-8') as f:


                d0 = json.load(f)


            payload = (d0.get('payload') or {})


            fred_probe = ((payload.get('fred_probe') or {}) if isinstance(payload, dict) else {})


            eps = _safe_float(((d0.get('revision_detection') or {}).get('change_epsilon'))) or 1e-6


            return fred_probe, eps


        except Exception:


            return {}, 1e-6





    entries = []


    for prev_fn, cur_fn in zip(probe_files[:-1], probe_files[1:]):


        prev_path = os.path.join(d, prev_fn)


        cur_path = os.path.join(d, cur_fn)


        prev_probe, eps = _load_probe(prev_path)


        cur_probe, _ = _load_probe(cur_path)


        if not cur_probe:


            continue


        digest = hashlib.sha1(cur_fn.encode('utf-8')).hexdigest()[:6]


        cur_mtime = datetime.fromtimestamp(os.path.getmtime(cur_path)).isoformat() + f'Z-{digest}'





        for raw_series, cur_values in cur_probe.items():


            if not isinstance(cur_values, dict):


                continue


            prev_values = prev_probe.get(raw_series) or {}


            if not isinstance(prev_values, dict):


                prev_values = {}


            common_dates = sorted(set(prev_values.keys()).intersection(cur_values.keys()))


            if not common_dates:


                continue


            changed = []


            deltas = []


            for dt in common_dates:


                pv = _safe_float(prev_values.get(dt))


                cv = _safe_float(cur_values.get(dt))


                if pv is None or cv is None:


                    continue


                delta = cv - pv


                if abs(delta) > eps:


                    changed.append(dt)


                    deltas.append(abs(delta))


            if not changed:


                continue


            last_common = common_dates[-1]


            last_value_changed = last_common in changed


            changed_cnt = len(changed)


            max_delta = max(deltas) if deltas else 0.0


            if last_value_changed or changed_cnt > 10:


                severity = 'High'


            elif changed_cnt >= 3:


                severity = 'Medium'


            else:


                severity = 'Low'


            summary = f"changed_days={changed_cnt}, max_abs_delta={max_delta:.6g}, last_value_changed={str(last_value_changed).lower()}"


            entries.append({


                'detected_at': cur_mtime,


                'series_id': series_name_map.get(raw_series, raw_series),


                'affected_dates': changed[-5:],


                'change_summary': summary,


                'severity': severity,


            })





    entries.sort(key=lambda x: x.get('detected_at', ''), reverse=True)


    cleaned = []


    for item in entries[:max(1, min(500, _safe_int(limit, 50)))]:


        detected_at = str(item.get('detected_at', ''))


        cleaned.append({


            'detected_at': detected_at.split('Z-')[0] + 'Z' if 'Z-' in detected_at else detected_at,


            'series_id': item.get('series_id'),


            'affected_dates': item.get('affected_dates') or [],


            'change_summary': item.get('change_summary'),


            'severity': item.get('severity'),


        })


    return cleaned





def build_validation_guard_badge_payload(snapshot):


    snapshot = snapshot or {}


    regression = snapshot.get('regression') or {}


    status = str(regression.get('status', 'Watch'))


    revision_detected = bool(snapshot.get('revision_detected', False))


    failed_checks = regression.get('failed_checks') or []


    data_asof = snapshot.get('data_asof') or {}


    return {


        'status': 'OK' if status == 'OK' and not revision_detected else 'Watch',


        'snapshot_date': snapshot.get('snapshot_date'),


        'policy_version': snapshot.get('policy_version'),


        'guard_policy_version': snapshot.get('guard_policy_version'),


        'revision_detected': revision_detected,


        'failed_checks_count': len(failed_checks),


        'failed_checks': failed_checks[:5],


        'detail_path': '/api/macro/validation/guard/latest',


        'data_asof': {


            'WALCL': data_asof.get('WALCL'),


            'RRP': data_asof.get('RRP'),


            'EFFR': data_asof.get('EFFR'),


            'VIX': data_asof.get('VIX'),


            'MARKET_PROXY': data_asof.get('MARKET_PROXY'),


        },


        'ui_note': 'OK/Watch only. See Validation tab for details.',


    }





def normalize_kr_signal(item):


    item = item or {}


    return {


        'ticker': str(item.get('ticker', '')),


        'name': str(item.get('name', '')),


        'market': str(item.get('market', '')),


        'signal_date': str(item.get('signal_date', '')),


        'score': float(item.get('score', 0) or 0),


        'final_score': float(item.get('final_score', item.get('score', 0)) or 0),


        'contraction_ratio': float(item.get('contraction_ratio', 0) or 0),


        'vcp_ratio': float(item.get('vcp_ratio', item.get('contraction_ratio', 0)) or 0),


        'volume': int(item.get('volume', 0) or 0),


        'flow_score': float(item.get('flow_score', 0) or 0),


        'buy_point': float(item.get('buy_point', 0) or 0),


        'entry_price': float(item.get('entry_price', 0) or 0),


        'current_price': float(item.get('current_price', 0) or 0),


        'return_pct': float(item.get('return_pct', 0) or 0),


        'action_openai': str(item.get('action_openai', 'WATCH')),


        'action_gemini': str(item.get('action_gemini', 'WATCH')),


        'status': str(item.get('status', 'OPEN')),


    }





def normalize_kr_signals_payload(data):


    data = data or {}


    signals = [normalize_kr_signal(s) for s in data.get('signals', [])]


    return {


        'signals': signals,


        'count': int(data.get('count', len(signals)) or 0),


        'message': str(data.get('message', '')),


        'generated_at': str(data.get('generated_at', now_iso())),


        'wired': bool(data.get('wired', True)),


    }





def normalize_kr_market_gate_payload(data):


    data = data or {}


    return {


        'status': str(data.get('status', 'UNKNOWN')),


        'gate_score': int(data.get('gate_score', 0) or 0),


        'recommendation': str(data.get('recommendation', '')),


        'kospi': {'change_pct': float((data.get('kospi') or {}).get('change_pct', 0) or 0)},


        'kosdaq': {'change_pct': float((data.get('kosdaq') or {}).get('change_pct', 0) or 0)},


        'usd_krw': float(data.get('usd_krw', 0) or 0),


        'generated_at': str(data.get('generated_at', now_iso())),


        'wired': bool(data.get('wired', True)),


    }





def normalize_kr_ai_analysis_payload(data):


    data = data or {}


    signals = [normalize_kr_signal(s) for s in data.get('signals', [])]


    return {


        'signal_date': str(data.get('signal_date', '')),


        'signals': signals,


        'summary': str(data.get('summary', '')),


        'summary_ko': str(data.get('summary_ko', data.get('summary', ''))),


        'summary_en': str(data.get('summary_en', data.get('summary', ''))),


        'generated_at': str(data.get('generated_at', now_iso())),


        'wired': bool(data.get('wired', True)),


    }





def normalize_kr_ai_summary_payload(item, ticker=''):


    item = item or {}


    providers = item.get('providers', {}) if isinstance(item.get('providers', {}), dict) else {}


    return {


        'ticker': str(item.get('ticker', ticker)),


        'name': str(item.get('name', '')),


        'summary': str(item.get('summary', '')),


        'summary_ko': str(item.get('summary_ko', item.get('summary', ''))),


        'summary_en': str(item.get('summary_en', item.get('summary', ''))),


        'providers': {


            'openai': {


                'model': str(((providers.get('openai') or {}).get('model', 'gpt-5.1'))),


                'rating': str(((providers.get('openai') or {}).get('rating', 'WATCH'))),


                'confidence': int(((providers.get('openai') or {}).get('confidence', 0)) or 0),


                'summary': str(((providers.get('openai') or {}).get('summary', 'No OpenAI analysis.'))),


                'summary_ko': str(((providers.get('openai') or {}).get('summary_ko', (providers.get('openai') or {}).get('summary', 'No OpenAI analysis.')))),


                'summary_en': str(((providers.get('openai') or {}).get('summary_en', (providers.get('openai') or {}).get('summary', 'No OpenAI analysis.')))),


                'source': str(((providers.get('openai') or {}).get('source', 'fallback'))),


            },


            'gemini': {


                'model': str(((providers.get('gemini') or {}).get('model', 'gemini-1.5-flash'))),


                'rating': str(((providers.get('gemini') or {}).get('rating', 'WATCH'))),


                'confidence': int(((providers.get('gemini') or {}).get('confidence', 0)) or 0),


                'summary': str(((providers.get('gemini') or {}).get('summary', 'No Gemini analysis.'))),


                'summary_ko': str(((providers.get('gemini') or {}).get('summary_ko', (providers.get('gemini') or {}).get('summary', 'No Gemini analysis.')))),


                'summary_en': str(((providers.get('gemini') or {}).get('summary_en', (providers.get('gemini') or {}).get('summary', 'No Gemini analysis.')))),


                'source': str(((providers.get('gemini') or {}).get('source', 'fallback'))),


            },


        },


        'generated_at': str(item.get('generated_at', now_iso())),


        'wired': bool(item.get('wired', True)),


    }





def normalize_kr_performance_payload(data):


    data = data or {}


    return {


        'win_rate': float(data.get('win_rate', 0) or 0),


        'avg_return': float(data.get('avg_return', 0) or 0),


        'total_positions': int(data.get('total_positions', 0) or 0),


        'generated_at': str(data.get('generated_at', now_iso())),


        'wired': bool(data.get('wired', True)),


    }





def normalize_curve_points(points):


    normalized = []


    for p in points or []:


        normalized.append({


            'date': str((p or {}).get('date', '')),


            'equity': float((p or {}).get('equity', 0) or 0),


        })


    return normalized





def normalize_kr_cumulative_return_payload(data):


    data = data or {}


    positions = []


    for p in data.get('positions', []) or []:


        positions.append({


            'ticker': str((p or {}).get('ticker', '')),


            'return_pct': float((p or {}).get('return_pct', 0) or 0),


        })


    return {


        'cumulative_return': float(data.get('cumulative_return', 0) or 0),


        'win_rate': float(data.get('win_rate', 0) or 0),


        'winners': int(data.get('winners', 0) or 0),


        'losers': int(data.get('losers', 0) or 0),


        'total_positions': int(data.get('total_positions', 0) or 0),


        'positions': positions,


        'equity_curve': normalize_curve_points(data.get('equity_curve', [])),


        'benchmark_curve': normalize_curve_points(data.get('benchmark_curve', [])),


        'kosdaq_benchmark_curve': normalize_curve_points(data.get('kosdaq_benchmark_curve', [])),


        'generated_at': str(data.get('generated_at', now_iso())),


        'wired': bool(data.get('wired', True)),


    }





def normalize_kr_chart_candle(candle):


    candle = candle or {}


    return {


        'date': str(candle.get('date', '')),


        'open': float(candle.get('open', 0) or 0),


        'high': float(candle.get('high', 0) or 0),


        'low': float(candle.get('low', 0) or 0),


        'close': float(candle.get('close', 0) or 0),


        'volume': int(candle.get('volume', 0) or 0),


    }





@app.route('/api/market/indices')


def market_indices():


    return jsonify(load_json('market_data.json'))





@app.route('/api/market/gate')


def market_gate():


    return jsonify(load_json('market_gate.json'))





@app.route('/api/market/state')


def market_state():


    data = load_json_or_none('cache/market_state.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'market_state.json not found',


        'rerun_hint': 'python backend/scripts/build_market_state.py',


    }), 404





@app.route('/api/market/overview')


def market_overview():


    data = load_json_or_none('cache/overview.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'overview.json not found',


        'rerun_hint': 'python backend/scripts/build_overview.py',


    }), 404





@app.route('/api/market/snapshots')


def market_snapshots():


    data = load_json_or_none('cache/snapshots_120d.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'snapshots_120d.json not found',


        'rerun_hint': 'python backend/scripts/build_snapshots_120d.py',


    }), 404











@app.route('/api/market/tape')


def market_tape():


    data = load_json_or_none_cached('cache/market_tape.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'market_tape.json not found',


        'rerun_hint': 'python backend/scripts/build_market_tape.py',


    }), 404





@app.route('/api/healthcheck')


def healthcheck():


    data = load_json_or_none_cached('cache/healthcheck.json')


    if data:


        return jsonify(data), (200 if data.get('ok') else 503)


    # healthcheck.json not yet generated ??return minimal live check


    cache_dir = os.path.join(OUTPUT_DIR, 'cache')


    critical = ['cache/overview.json', 'cache/market_state.json', 'cache/snapshots_120d.json']


    missing = [f for f in critical if not os.path.exists(os.path.join(OUTPUT_DIR, f.replace('/', os.sep)))]


    ok = len(missing) == 0


    return jsonify({


        'ok': ok,


        'last_run_at': None,


        'data_date': None,


        'missing_files': missing,


        'schema_errors': [],


        'warnings': ['healthcheck.json not generated ??run validate_cache.py'],


    }), (200 if ok else 503)





@app.route('/api/briefing')


def briefing():


    return jsonify(load_json('briefing.json'))





@app.route('/api/briefing/today')


def briefing_today():


    data = load_json_or_none_cached('cache/daily_briefing_v3.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'daily_briefing_v3.json not generated yet.',


        'rerun_hint': 'python backend/scripts/build_daily_briefing_v3.py',


    }), 404





@app.route('/api/top-picks')


def top_picks():


    return jsonify(load_json('top_picks.json'))





@app.route('/api/smart-money')


def smart_money():


    data = load_json_or_none('smart_money.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'smart_money.json not found',


        'rerun_hint': 'python backend/scripts/build_smart_money.py',


    }), 404





@app.route('/api/risk')


def risk_metrics():


    return jsonify(load_json('risk_metrics.json'))





@app.route('/api/earnings')


def earnings():


    data = load_json_or_none('earnings_calendar.json')


    if data:


        return jsonify(data)


    return jsonify({


        'earnings': [],


        'error': 'earnings_calendar.json not found',


        'rerun_hint': 'python backend/scripts/build_earnings_calendar.py',


        'generated_at': None,


    })





@app.route('/api/sectors')


def sectors():


    return jsonify(load_json('sector_analysis.json'))





@app.route('/api/signals')


def signals():


    return jsonify(load_json('vcp_signals.json'))





@app.route('/api/calendar')


def economic_calendar():


    data = load_json_or_none('economic_calendar.json')


    if data:


        return jsonify(data)


    return jsonify({


        'events': [],


        'error': 'economic_calendar.json not found',


        'rerun_hint': 'python backend/scripts/build_economic_calendar.py',


        'generated_at': None,


    })





@app.route('/api/prediction')


def prediction():


    return jsonify(load_json('prediction.json'))





@app.route('/api/regime')


def regime():


    return jsonify(load_json('market_regime.json'))





@app.route('/api/rrg')


def rrg():


    return jsonify(load_json('rrg_data.json'))





@app.route('/api/rrg/custom')


def rrg_custom():


    try:


        from rrg_calculator import (


            calculate_rrg, load_weekly,


            calculate_rrg_daily, load_daily,


        )


    except ImportError as e:


        return jsonify({'error': f'Import error: {e}'}), 500





    symbols_raw = request.args.get('symbols', '').strip()


    benchmark   = request.args.get('benchmark', 'SPY').strip().upper() or 'SPY'


    period      = request.args.get('period', 'daily').strip().lower()


    if period not in ('daily', 'weekly'):


        period = 'daily'





    try:


        period_val = max(5, min(52, int(request.args.get('weeks', '14' if period == 'daily' else '10'))))


    except (ValueError, TypeError):


        period_val = 14 if period == 'daily' else 10





    if not symbols_raw:


        return jsonify({'error': 'No symbols provided'}), 400





    symbols = [s.strip().upper() for s in symbols_raw.split(',') if s.strip()][:10]





    if period == 'daily':


        bench_close = load_daily(benchmark)


    else:


        bench_close = load_weekly(benchmark)





    if bench_close is None or len(bench_close) < 15:


        return jsonify({'error': f'Cannot load benchmark data for {benchmark}'}), 400





    tail_n = 90 if period == 'daily' else 52


    bench_prices = [round(float(v), 2) for v in bench_close.tail(tail_n).tolist()]


    bench_dates  = [str(d.date()) for d in bench_close.tail(tail_n).index.tolist()]





    results, failed = [], []


    for sym in symbols:


        if period == 'daily':


            data = calculate_rrg_daily(sym, bench_close, days=period_val)


        else:


            data = calculate_rrg(sym, bench_close, weeks=period_val)


        if data:


            results.append({'symbol': sym, 'name': sym, **data})


        else:


            failed.append(sym)





    return jsonify({


        'timestamp':        datetime.now().isoformat(),


        'benchmark':        benchmark,


        'benchmark_price':  round(float(bench_close.iloc[-1]), 2),


        'benchmark_prices': bench_prices,


        'benchmark_dates':  bench_dates,


        'sectors':          results,


        'failed':           failed,


        'period':           period,


    })





@app.route('/api/macro/summary')


def macro_summary():


    data = load_json_or_none_cached('cache/macro_summary.json')


    if data:


        return jsonify(data)


    # Best-effort scaffold generation (FRED4-first contract)


    try:


        _run_backend_script('macro_fred4_pipeline.py', extra_args=[], timeout=60)


    except Exception:


        pass


    data = load_json_or_none_cached('cache/macro_summary.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'macro_summary.json not generated yet.',


        'rerun_hint': 'python backend/scripts/macro_fred4_pipeline.py',


    }), 404





@app.route('/api/macro/detail')


def macro_detail():


    data = load_json_or_none_cached('cache/macro_detail.json')


    if data:


        return jsonify(data)


    try:


        _run_backend_script('macro_fred4_pipeline.py', extra_args=[], timeout=60)


    except Exception:


        pass


    data = load_json_or_none_cached('cache/macro_detail.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'macro_detail.json not generated yet.',


        'rerun_hint': 'python backend/scripts/macro_fred4_pipeline.py',


    }), 404





@app.route('/api/macro/v2/latest')


def macro_v2_latest():


    data = load_macro_snapshot_latest()


    if data:


        return jsonify(data)


    try:


        _run_backend_script('build_macro_snapshot.py', extra_args=[], timeout=240)


    except Exception:


        pass


    data = load_macro_snapshot_latest()


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'macro v2 snapshot not generated yet.',


        'rerun_hint': 'python backend/scripts/collect_macro_cache.py && python backend/scripts/build_macro_snapshot.py',


        'storage_path': 'data/snapshots/',


    }), 404





@app.route('/api/context/news')


def context_news():


    region = str(request.args.get('region', 'us')).lower()


    limit = request.args.get('limit', '5')


    try:


        limit_int = max(1, min(5, int(limit)))


    except Exception:


        limit_int = 5





    data = load_context_news_cache()


    if data:


        return jsonify(data)





    try:


        _run_backend_script(


            'build_context_news.py',


            extra_args=['--region', region, '--limit', str(limit_int)],


            timeout=180,


        )


    except Exception:


        pass


    data = load_context_news_cache()


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'context_news.json not generated yet.',


        'rerun_hint': f'python backend/scripts/build_context_news.py --region {region} --limit {limit_int}',


        'storage_path': 'backend/output/cache/context_news.json',


    }), 404





@app.route('/api/context/narrative')


def context_narrative():


    region = str(request.args.get('region', 'us')).lower()


    risk_token = request.args.get('risk_token')


    shock_flag = str(request.args.get('shock_flag', 'false')).lower() in ('1', 'true', 'yes', 'y')


    premium = str(request.args.get('premium', 'false')).lower() in ('1', 'true', 'yes', 'y')


    force = str(request.args.get('force', 'false')).lower() in ('1', 'true', 'yes', 'y')


    try:


        _run_backend_script(


            'build_context_news.py',


            extra_args=['--region', region, '--limit', '5'],


            timeout=180,


        )


    except Exception:


        pass


    try:


        payload = build_context_narrative(


            region=region,


            risk_token=risk_token,


            shock_flag=shock_flag,


            premium=premium,


            force=force,


        )


        return jsonify(payload)


    except Exception as e:


        return jsonify({'error': str(e)}), 500





@app.route('/api/macro/snapshots')


def macro_snapshots():


    limit = request.args.get('limit', 30)


    rows = load_macro_snapshots(limit)


    payload = []


    for r in rows:


        payload.append({


            'snapshot_date': r.get('snapshot_date'),


            'mps': r.get('mps'),


            'lpi': r.get('lpi'),


            'rpi': r.get('rpi'),


            'vri': r.get('vri'),


            'csi': {


                'value': r.get('csi_value'),


                'state': r.get('csi_state') or 'NA',


            },


            'put_call': {


                'value': r.get('put_call_value'),


                'state': r.get('put_call_state') or 'NA',


            },


            'xconf': r.get('xconf'),


            'ghedge': r.get('ghedge'),


            'quality_overall': r.get('quality_overall'),


            'validation_status': r.get('validation_status'),


            'revision_detected': bool(r.get('revision_detected', False)),


            'mps_delta_1d': r.get('mps_delta_1d'),


            'max_abs_component_delta': r.get('max_abs_component_delta'),


            'drift_flag': bool(r.get('drift_flag', False)),


            'series': r.get('series') or {},


        })


    return jsonify(payload)





@app.route('/api/macro/snapshots/latest')


def macro_snapshots_latest():


    data = load_macro_snapshot_latest()


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'latest snapshot not found',


        'storage_path': 'data/snapshots/macro_snapshot_latest.json',


    }), 404





@app.route('/api/macro/terminal_series')


def macro_terminal_series():


    """


    Chart-ready aligned time series (weekly):


    - PRICE: BTC close (fallback QQQ) weekly last


    - M2Raw: M2SL weekly carry-forward from raw monthly prints (step/ffill only)


    - M2Nowcast: always null (reserved)


    - M2YoYRaw: monthly YoY mapped to weekly buckets


    - No interpolation policy for M2


    """


    years = _safe_int(request.args.get('years', 3), 3)


    years = max(1, min(10, years))


    scope = str(request.args.get('scope', 'US')).upper()


    if scope not in ('US', 'GLOBAL'):


        scope = 'US'





    # GLOBAL currently supports pluggable symbol aliases. If unavailable in cache.db,


    # API gracefully falls back to US M2SL and reports fallback metadata.


    m2_candidates = ('M2SL',)


    if scope == 'GLOBAL':


        m2_candidates = ('GLOBAL_M2', 'M2_GLOBAL', 'GM2', 'M2SL')





    symbols = ('BTC', 'QQQ', *m2_candidates)





    if not os.path.exists(CACHE_DB_PATH):


        return jsonify({'rows': [], 'error': 'cache.db not found'}), 404





    try:


        conn = _db_connect(CACHE_DB_PATH, row_factory=True)


        all_rows = {}


        for sym in symbols:


            cur = conn.execute(


                """


                SELECT date, value


                FROM series_data


                WHERE symbol=?


                ORDER BY date ASC


                """,


                (sym,),


            )


            pts = []


            for rr in cur.fetchall():


                d = str(rr['date'])


                v = _safe_float(rr['value'])


                if not d or v is None:


                    continue


                pts.append((d, v))


            all_rows[sym] = pts


    except Exception as e:


        return jsonify({'rows': [], 'error': str(e)}), 500


    finally:


        try:


            conn.close()


        except Exception:


            pass





    btc_rows = all_rows.get('BTC') or []


    qqq_rows = all_rows.get('QQQ') or []


    m2_symbol_used = None


    m2_rows = []


    for sym in m2_candidates:


        rows = all_rows.get(sym) or []


        if rows:


            m2_rows = rows


            m2_symbol_used = sym


            break


    if m2_symbol_used is None:


        m2_symbol_used = m2_candidates[0]


    if not btc_rows and not qqq_rows:


        return jsonify({'rows': [], 'error': 'BTC/QQQ series missing'}), 404





    def _parse_date(s):


        try:


            return datetime.strptime(s[:10], '%Y-%m-%d')


        except Exception:


            return None





    def _to_week_sunday(dt_obj):


        # Monday=0..Sunday=6; Sunday=6


        delta = 6 - dt_obj.weekday()


        return dt_obj + timedelta(days=delta)





    # Build daily price rows then bucket to weekly(last in week)


    price_daily = {}


    for d, v in btc_rows:


        price_daily[d] = {'BTC': v, 'QQQ': None}


    for d, v in qqq_rows:


        row = price_daily.get(d) or {'BTC': None, 'QQQ': None}


        row['QQQ'] = v


        price_daily[d] = row





    weekly = {}


    for d in sorted(price_daily.keys()):


        dt_obj = _parse_date(d)


        if dt_obj is None:


            continue


        wk = _to_week_sunday(dt_obj).strftime('%Y-%m-%d')


        row = price_daily[d]


        btc = row.get('BTC')


        qqq = row.get('QQQ')


        price = btc if btc is not None else qqq


        if price is None:


            continue


        weekly[wk] = {'date': wk, 'BTC': btc, 'QQQ': qqq, 'PRICE': price}





    weekly_dates = sorted(weekly.keys())


    if not weekly_dates:


        return jsonify({'rows': [], 'error': 'weekly price rows missing'}), 404





    # Limit by years from latest weekly date


    try:


        end_dt = _parse_date(weekly_dates[-1])


        start_dt = end_dt.replace(year=end_dt.year - years)


        weekly_dates = [d for d in weekly_dates if (_parse_date(d) and _parse_date(d) >= start_dt)]


    except Exception:


        pass





    # M2 monthly points


    m2_monthly = []


    for d, v in m2_rows:


        dt_obj = _parse_date(d)


        if dt_obj is None:


            continue


        m2_monthly.append((dt_obj, v))


    m2_monthly.sort(key=lambda x: x[0])





    # Raw monthly YoY points (mapped by print month -> week bucket)


    m2_yoy_monthly = []


    for i in range(12, len(m2_monthly)):


        cur_dt, cur_v = m2_monthly[i]


        prev_v = m2_monthly[i - 12][1]


        if prev_v in (None, 0):


            continue


        yoy = ((cur_v - prev_v) / prev_v) * 100.0


        m2_yoy_monthly.append((cur_dt, yoy))





    out = []


    i_m2 = 0


    i_yoy = 0


    last_m2 = None


    last_yoy = None


    for d in weekly_dates:


        d_dt = _parse_date(d)


        if d_dt is not None:


            while i_m2 < len(m2_monthly) and m2_monthly[i_m2][0] <= d_dt:


                last_m2 = m2_monthly[i_m2][1]


                i_m2 += 1


            while i_yoy < len(m2_yoy_monthly) and m2_yoy_monthly[i_yoy][0] <= d_dt:


                last_yoy = m2_yoy_monthly[i_yoy][1]


                i_yoy += 1


        row = dict(weekly[d])


        m2_raw = last_m2


        row['M2Raw'] = m2_raw


        row['M2Nowcast'] = None


        # compatibility aliases: raw step+ffill only


        row['M2'] = m2_raw


        row['M2YoYRaw'] = last_yoy


        row['M2YoYNowcast'] = None


        row['M2YoY'] = row['M2YoYRaw']


        out.append(row)





    return jsonify({


        'rows': out,


        'meta': {


            'years': years,


            'freq': 'W-SUN',


            'source': 'cache.db',


            'm2_mode': 'raw_step_ffill_only',


            'scope': scope,


            'm2_symbol_used': m2_symbol_used,


            'm2_fallback_to_us': (scope == 'GLOBAL' and m2_symbol_used == 'M2SL'),


        }


    })





@app.route('/api/macro/revisions')


def macro_revisions():


    limit = request.args.get('limit', 50)


    entries = _calc_probe_revision_entries(limit)


    return jsonify(entries)





# --- Macro Validation Endpoints ---


_validation_engine = None





def get_validation_engine():


    global _validation_engine


    if _validation_engine is None:


        _validation_engine = ValidationEngine()


    return _validation_engine





@app.route('/api/macro/validation/summary')


def macro_validation_summary():


    window = request.args.get('window', '2020')


    try:


        engine = get_validation_engine()


        res = engine.run_validation(window)


        # Summary excludes the full timeseries to keep payload small


        summary = {k: v for k, v in res.items() if k != "timeseries"}


        return jsonify(summary)


    except Exception as e:


        return jsonify({'error': str(e)}), 500





@app.route('/api/macro/validation/timeseries')


def macro_validation_timeseries():


    window = request.args.get('window', '2020')


    try:


        engine = get_validation_engine()


        res = engine.run_validation(window)


        return jsonify(res["timeseries"])


    except Exception as e:


        return jsonify({'error': str(e)}), 500





@app.route('/api/macro/validation/events')


def macro_validation_events():


    window = request.args.get('window', '2020')


    try:


        engine = get_validation_engine()


        res = engine.run_validation(window)


        return jsonify(res["events"])


    except Exception as e:


        return jsonify({'error': str(e)}), 500





@app.route('/api/macro/validation/guard/latest')


def macro_validation_guard_latest():


    market_proxy = str(request.args.get('market_proxy', 'QQQ')).upper()


    if market_proxy not in ('QQQ', 'SPY'):


        return jsonify({'error': 'market_proxy must be QQQ or SPY'}), 400





    data = load_validation_snapshot_latest()


    if data:


        return jsonify(data)





    try:


        _run_backend_script(


            'build_validation_snapshot.py',


            extra_args=['--market-proxy', market_proxy],


            timeout=300,


        )


    except Exception:


        pass





    data = load_validation_snapshot_latest()


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'validation snapshot not generated yet.',


        'rerun_hint': f'python backend/scripts/build_validation_snapshot.py --market-proxy {market_proxy}',


        'storage_path': 'backend/storage/validation_snapshots/',


    }), 404





@app.route('/api/macro/validation/guard/badge')


def macro_validation_guard_badge():


    market_proxy = str(request.args.get('market_proxy', 'QQQ')).upper()


    if market_proxy not in ('QQQ', 'SPY'):


        return jsonify({'error': 'market_proxy must be QQQ or SPY'}), 400





    data = load_validation_snapshot_latest()


    if data:


        return jsonify(build_validation_guard_badge_payload(data))





    try:


        _run_backend_script(


            'build_validation_snapshot.py',


            extra_args=['--market-proxy', market_proxy],


            timeout=300,


        )


    except Exception:


        pass





    data = load_validation_snapshot_latest()


    if data:


        return jsonify(build_validation_guard_badge_payload(data))


    return jsonify({


        'status': 'Watch',


        'error': 'validation snapshot not generated yet.',


        'detail_path': '/api/macro/validation/guard/latest',


        'rerun_hint': f'python backend/scripts/build_validation_snapshot.py --market-proxy {market_proxy}',


    }), 404





@app.route('/api/macro/validation/status')


def macro_validation_status_alias():


    # Backward-compatible alias for lightweight badge consumers.


    return macro_validation_guard_badge()





@app.route('/api/health/snapshot')


def health_snapshot():


    data = load_json_or_none_cached('cache/health_snapshot.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'health_snapshot.json not generated yet.',


        'rerun_hint': 'python backend/scripts/build_health_snapshot.py',


    }), 404





@app.route('/api/action/snapshot')


def action_snapshot():


    data = load_json_or_none_cached('cache/action_snapshot.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'action_snapshot.json not generated yet.',


        'rerun_hint': 'python backend/scripts/build_action_snapshot.py',


    }), 404





@app.route('/api/sector-performance')


def sector_performance():


    data = load_json('sector_performance.json')


    if data:


        return jsonify(data)


    return jsonify({'error': 'Sector performance data not found'}), 404





@app.route('/api/risk-alert')


def risk_alert():


    data = load_json_or_none('risk_alert.json')


    if data:


        return jsonify(data)


    return jsonify({'error': 'risk_alert.json not found ??run build_risk_alert.py'}), 404





@app.route('/api/risk-alert-playback')


def risk_alert_playback():


    data = load_json_or_none('risk_alert_playback.json')


    if data:


        return jsonify(data)


    return jsonify({'error': 'risk_alert_playback.json not found ??run build_risk_alert.py'}), 404




@app.route('/api/risk-v1')

def risk_v1():

    data = load_json_or_none('risk_v1.json')

    if data is None and _ensure_risk_v1_outputs():
        data = load_json_or_none('risk_v1.json')

    if data:
        return jsonify(data)

    return jsonify({'error': 'risk_v1.json not found ??run build_risk_v1.py'}), 404


@app.route('/api/risk-v1-playback')

def risk_v1_playback():

    data = load_json_or_none('risk_v1_playback.json')

    if data is None and _ensure_risk_v1_outputs():
        data = load_json_or_none('risk_v1_playback.json')

    if data:
        return jsonify(data)

    return jsonify({'error': 'risk_v1_playback.json not found ??run build_risk_v1.py'}), 404


@app.route('/api/playback-events/<slug>')
def get_playback_event(slug):
    # Search multiple candidate paths (local dev vs Railway container layout)
    candidate_dirs = [
        os.path.join(_BACKEND_DIR, 'content', 'playback-events'),      # Railway: /app/content/
        os.path.join(_BACKEND_DIR, '..', 'content', 'playback-events'), # local: marketflow/content/
    ]
    for content_dir in candidate_dirs:
        file_path = os.path.join(content_dir, f"{slug}.md")
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8-sig') as f:
                content = f.read()
            return Response(content, mimetype='text/markdown')
    return Response(f"Markdown for {slug} not found.", status=404, mimetype='text/plain')



@app.route('/api/risk-v1-sim')

def risk_v1_sim():

    data = load_json_or_none('risk_v1_sim.json')

    if data is None and _ensure_risk_v1_outputs():
        data = load_json_or_none('risk_v1_sim.json')

    if data:
        return jsonify(data)

    return jsonify({'error': 'risk_v1_sim.json not found ??run build_risk_v1.py'}), 404


@app.route('/api/risk-v1/refresh', methods=['POST'])

def refresh_risk_v1():
    t0 = _time.time()
    try:
        risk_ok = _ensure_risk_v1_outputs(force=True)
        current_90d = _run_backend_script('build_current_90d.py', timeout=600)
        elapsed = round(_time.time() - t0, 1)

        if not risk_ok:
            return jsonify({
                'ok': False,
                'elapsed': elapsed,
                'error': 'build_risk_v1 failed',
                'current_90d_ok': current_90d.returncode == 0,
            }), 500

        return jsonify({
            'ok': True,
            'elapsed': elapsed,
            'risk_v1_ok': True,
            'current_90d_ok': current_90d.returncode == 0,
            'risk_v1_ready': _risk_v1_outputs_ready(),
            'current_90d_stdout_tail': (current_90d.stdout or '')[-2000:],
        })
    except Exception as exc:
        return jsonify({'ok': False, 'error': str(exc)}), 500







def _daily_briefing_primary_line(payload):

    if not isinstance(payload, dict):
        return ""

    for key in ('one_line_ko', 'hook_ko', 'one_line', 'hook'):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    sections = payload.get('sections') if isinstance(payload.get('sections'), list) else []
    for section in sections:
        if not isinstance(section, dict):
            continue
        for keys in (('structural_ko', 'implication_ko'), ('structural', 'implication')):
            text = ' '.join(
                part.strip()
                for part in (section.get(keys[0]), section.get(keys[1]))
                if isinstance(part, str) and part.strip()
            ).strip()
            if text:
                return text

    headline = payload.get('headline')
    if isinstance(headline, dict):
        for key in ('ko', 'en'):
            value = headline.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    elif isinstance(headline, str) and headline.strip():
        return headline.strip()

    return ""


def _daily_briefing_summary_text(payload):

    if not isinstance(payload, dict):
        return ""

    lines = []

    primary = _daily_briefing_primary_line(payload)
    if primary:
        lines.append(primary)

    sections = payload.get('sections') if isinstance(payload.get('sections'), list) else []
    for section in sections:
        if not isinstance(section, dict):
            continue
        text = ' '.join(
            part.strip()
            for part in (
                section.get('structural_ko'),
                section.get('implication_ko'),
                section.get('structural'),
                section.get('implication'),
            )
            if isinstance(part, str) and part.strip()
        ).strip()
        if text and text not in lines:
            lines.append(text)
        if len(lines) >= 3:
            break

    if not lines:
        paragraphs = payload.get('paragraphs')
        if isinstance(paragraphs, dict):
            for key in ('ko', 'en'):
                items = paragraphs.get(key)
                if isinstance(items, list):
                    for item in items:
                        text = item.get('text') if isinstance(item, dict) else item
                        if isinstance(text, str) and text.strip():
                            lines.append(text.strip())
                    if lines:
                        break

    if not lines:
        bullets = payload.get('bullets')
        if isinstance(bullets, dict):
            for key in ('ko', 'en'):
                items = bullets.get(key)
                if isinstance(items, list):
                    for item in items:
                        text = item.get('text') if isinstance(item, dict) else item
                        if isinstance(text, str) and text.strip():
                            lines.append(text.strip())
                    if lines:
                        break

    if not lines:
        risk_check = payload.get('risk_check') if isinstance(payload.get('risk_check'), dict) else {}
        risk_message = risk_check.get('message') if isinstance(risk_check, dict) else ''
        if isinstance(risk_message, str) and risk_message.strip():
            lines.append(risk_message.strip())

    return ' '.join(lines[:3]).strip()


@app.route('/api/briefing-cards')


def briefing_cards():


    def _build_card(page_name, json_path, fallback_path=None):


        meta = PromptManager.get_auto_prompt_meta(page_name)


        text = ""


        success = False


        


        data = load_json_or_none(json_path)
        text = _daily_briefing_summary_text(data)
        success = bool(text)

        if not success and fallback_path:
            fb_data = load_json_or_none(fallback_path)
            text = _daily_briefing_summary_text(fb_data)
            success = bool(text)





        if not success or meta.get('fallback_used'):


            meta['fallback_used'] = True


            if not text:


                text = "?熬곣뫗??AI ??곗뒧?????⑥щ턄??? ?釉띾쐞???? 嶺뚮쪇沅?쭛???鍮?? ??ル∥六??????곕뻣 ??類ｌ┣??怨삵룖?筌뤾쑴??"


                success = False





        return {


            "success": success,


            "text": text.strip(),


            "prompt_version": meta.get("version", "v1.0.0"),


            "prompt_key": meta.get("key", page_name),


            "prompt_source": meta.get("source", "registry"),


            "fallback_used": meta.get("fallback_used", False),


            "message": "" if success else "Failed to load normal briefing data"


        }





    return jsonify({


        "macro_brief": _build_card("macro_brief", "ai/macro/latest.json"),


        "risk_brief": _build_card("risk_brief", "ai/std_risk/latest.json"),


        "market_structure_brief": _build_card("market_structure_brief", "ai/integrated/latest.json", "cache/daily_briefing_v3.json")


    })





@app.route('/api/today-context')


def today_context():


    meta = PromptManager.get_auto_prompt_meta("today_context")


    text = ""


    success = False





    data = load_json_or_none('cache/daily_briefing_v3.json')


    if isinstance(data, dict):


        text = _daily_briefing_primary_line(data)


        success = bool(text)





    if not success or meta.get('fallback_used'):


        meta['fallback_used'] = True


        if not text:


            text = "???노츓 ??戮곗궋?????堉????쳜????덈콦???釉띾쐞???? 嶺뚮쪇沅?쭛???鍮?? ??ル∥六?????類ｌ┣??怨삵룖?筌뤾쑴??"


            success = False





    return jsonify({


        "success": success,


        "text": text,


        "prompt_version": meta.get("version", "v1.0.0"),


        "prompt_key": meta.get("key", "today_context"),


        "prompt_source": meta.get("source", "registry"),


        "fallback_used": meta.get("fallback_used", False),


        "message": "" if success else "Failed to load today context"


    })





@app.route('/api/smart-analyzer')


def smart_analyzer_view():


    # Try live output first, fall back to first scenario from sample file


    live = load_json_or_none('smart_analyzer_latest.json')


    if live:


        return jsonify(live)


    sample = load_json_or_none('smart_analyzer_sample.json')


    if sample and isinstance(sample.get('scenarios'), list) and sample['scenarios']:


        output = sample['scenarios'][0].get('output', {})


        return jsonify(output)


    return jsonify({'error': 'smart_analyzer_latest.json not found - run build_smart_analyzer.py'}), 404





@app.route('/api/vr-survival')


def vr_survival():


    data = load_json_or_none('vr_survival.json')


    if data:


        return jsonify(data)


    return jsonify({'error': 'vr_survival.json not found ??run build_vr_survival.py'}), 404





@app.route('/api/vr-survival-playback')


def vr_survival_playback():


    data = load_json_or_none('vr_survival_playback.json')


    if data:


        return jsonify(data)


    return jsonify({'error': 'vr_survival_playback.json not found ??run build_vr_survival.py'}), 404





@app.route('/api/soxx-survival-playback')


def soxx_survival_playback():


    data = load_json_or_none('soxx_survival_playback.json')


    if data is None and _ensure_data_artifact('soxx_survival_playback.json'):
        data = load_json_or_none('soxx_survival_playback.json')


    if data:


        return jsonify(data)


    return jsonify({'error': 'soxx_survival_playback.json not found - run build_soxx_survival_playback.py'}), 404




@app.route('/api/current-90d')


def current_90d():


    data = load_json_or_none('current_90d.json')


    if data:


        return jsonify(data)


    return jsonify({'error': 'current_90d.json not found - run build_current_90d.py'}), 404


@app.route('/api/soxx-context')


def soxx_context():


    data = load_json_or_none('soxx_context.json')


    if data:


        return jsonify(data)


    return jsonify({'error': 'soxx_context.json not found - run build_soxx_context.py'}), 404





@app.route('/api/mss-history')


def mss_history_route():


    data = load_json_or_none('mss_history.json')


    if data:


        return jsonify(data)


    return jsonify({'error': 'mss_history.json not found ??run build_risk_v1.py'}), 404





@app.route('/api/sector-rotation')


def sector_rotation_cache():


    data = load_json_or_none('sector_rotation.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'Sector rotation cache not generated yet.',


        'sector_perf': [], 'leading_sectors': [], 'lagging_sectors': [],


        'rotation_picks_top': [], 'phase': 'unknown'


    }), 404








@app.route('/api/daily-report')


def daily_report():


    data = load_json_or_none('daily_report.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'Daily report not generated yet.',


        'generated_at': None,


        'market_summary': {'lines': [], 'overall_tone': 'neutral', 'overall_tone_label': 'neutral', 'gate_score': None, 'signals': []},


        'hot_stocks_brief': [],


        'sector_brief': {'phase': 'unknown', 'lines': [], 'leaders': [], 'laggers': []},


        'risk_brief': {'risk_level': 'medium', 'risk_label': 'medium', 'gate_score': None, 'lines': [], 'alerts': []},


        'data_coverage': {'available': 0, 'total': 8, 'pct': 0},


    }), 404





@app.route('/api/hot-zone')


def hot_zone():


    data = load_json_or_none('hot_zone.json')


    if data:


        return jsonify(data)


    return jsonify({


        'error': 'Hot zone not generated yet.',


        'leaders': [],


        'trending': [],


        'summary': {


            'data_date': None,


            'total_symbols': 0,


            'hot_symbols': 0,


            'streak_3plus': 0,


            'avg_hot_score': 0,


            'leaders_count': 0,


            'trending_count': 0,


            'trigger_counts': {},


        },


    }), 404





@app.route('/api/rotation-picks')


def rotation_picks():


    data = load_json_or_none('rotation_picks.json')


    if data:


        return jsonify(data)


    return jsonify({'error': 'Rotation picks not generated yet.', 'top10': [], 'phase': 'unknown'}), 404





# ------------------------------


# KR Market wiring endpoints


# ------------------------------


@app.route('/api/kr/signals')


def kr_signals():


    data = load_json_or_none('kr_signals.json')


    if data:


        return jsonify(normalize_kr_signals_payload(data))


    return jsonify(normalize_kr_signals_payload({


        'signals': [],


        'count': 0,


        'message': 'KR signals not generated yet.',


        'generated_at': now_iso(),


        'wired': True,


    }))





@app.route('/api/kr/market-gate')


def kr_market_gate():


    data = load_json_or_none('kr_market_gate.json')


    if data:


        return jsonify(normalize_kr_market_gate_payload(data))


    return jsonify(normalize_kr_market_gate_payload({


        'status': 'UNKNOWN',


        'gate_score': 0,


        'recommendation': 'Prepare KR market pipeline first.',


        'generated_at': now_iso(),


        'wired': True,


    }))





@app.route('/api/kr/ai-analysis')


def kr_ai_analysis():


    data = load_json_or_none('kr_ai_analysis.json')


    if data:


        return jsonify(normalize_kr_ai_analysis_payload(data))


    return jsonify(normalize_kr_ai_analysis_payload({


        'signals': [],


        'summary': 'KR AI analysis is not available yet.',


        'generated_at': now_iso(),


        'wired': True,


    }))





@app.route('/api/kr/ai-summary/<ticker>')


def kr_ai_summary(ticker):


    data = load_json_or_none('kr_ai_summary.json') or {}


    item = data.get(ticker)


    if item:


        return jsonify(normalize_kr_ai_summary_payload(item, ticker))


    return jsonify(normalize_kr_ai_summary_payload({


        'ticker': ticker,


        'summary': 'No KR AI summary found for this ticker.',


        'wired': True,


    }, ticker)), 404





@app.route('/api/kr/performance')


def kr_performance():


    data = load_json_or_none('kr_performance.json')


    if data:


        return jsonify(normalize_kr_performance_payload(data))


    return jsonify(normalize_kr_performance_payload({


        'win_rate': 0,


        'avg_return': 0,


        'total_positions': 0,


        'generated_at': now_iso(),


        'wired': True,


    }))





@app.route('/api/kr/cumulative-return')


def kr_cumulative_return():


    data = load_json_or_none('kr_cumulative_return.json')


    if data:


        return jsonify(normalize_kr_cumulative_return_payload(data))


    return jsonify(normalize_kr_cumulative_return_payload({


        'cumulative_return': 0,


        'win_rate': 0,


        'winners': 0,


        'losers': 0,


        'total_positions': 0,


        'positions': [],


        'equity_curve': [],


        'benchmark_curve': [],


        'kosdaq_benchmark_curve': [],


        'generated_at': now_iso(),


        'wired': True,


    }))





@app.route('/api/kr/ai-history-dates')


def kr_ai_history_dates():


    history_dir = os.path.join(OUTPUT_DIR, 'kr_ai_history')


    if not os.path.exists(history_dir):


        return jsonify({'dates': [], 'count': 0, 'wired': True})





    dates = []


    for filename in os.listdir(history_dir):


        if filename.startswith('kr_ai_analysis_') and filename.endswith('.json'):


            dates.append(filename.replace('kr_ai_analysis_', '').replace('.json', ''))


    dates.sort(reverse=True)


    return jsonify({'dates': dates, 'count': len(dates), 'wired': True})





@app.route('/api/kr/ai-history/<date>')


def kr_ai_history(date):


    history_path = os.path.join(OUTPUT_DIR, 'kr_ai_history', f'kr_ai_analysis_{date}.json')


    if not os.path.exists(history_path):


        return jsonify({'error': f'No KR AI history for {date}', 'wired': True}), 404


    with open(history_path, 'r', encoding='utf-8') as f:


        return jsonify(normalize_kr_ai_analysis_payload(json.load(f)))





@app.route('/api/kr/stock-chart/<ticker>')


def kr_stock_chart(ticker):


    charts = load_json_or_none('kr_stock_charts.json') or {}


    candles = charts.get(ticker, [])


    return jsonify({


        'ticker': ticker,


        'candles': [normalize_kr_chart_candle(c) for c in candles],


        'generated_at': now_iso(),


        'wired': True,


    })





# ???? Watchlist endpoints ??????????????????????????????????????????????????????????????????????????????????????????????????????????????


@app.route('/api/watchlist')


def watchlist_list():


    conn = _get_db()


    try:


        rows = conn.execute(


            'SELECT symbol, label, created_at FROM watchlist_symbols ORDER BY created_at DESC'


        ).fetchall()


    finally:


        conn.close()


    return jsonify({'symbols': [dict(r) for r in rows]})








@app.route('/api/watchlist/symbols')


def watchlist_symbols():


    q = str(request.args.get('q', '') or '').strip().upper()


    try:


        limit = int(request.args.get('limit', 40))


    except Exception:


        limit = 40


    limit = max(1, min(limit, 200))





    conn = _get_db()


    try:


        like_q = f'%{q}%'


        exact_q = f'{q}%'


        rows = conn.execute(


            '''


            SELECT


              u.symbol,


              COALESCE(u.name, u.symbol) AS name,


              COALESCE(u.sector, '') AS sector,


              d.last_date,


              CASE WHEN w.symbol IS NULL THEN 0 ELSE 1 END AS in_watchlist


            FROM universe_symbols u


            INNER JOIN (


              SELECT symbol, MAX(date) AS last_date


              FROM ohlcv_daily


              GROUP BY symbol


            ) d ON d.symbol = u.symbol


            LEFT JOIN watchlist_symbols w ON w.symbol = u.symbol


            WHERE COALESCE(u.is_active, 1) = 1


              AND (


                ? = ''


                OR UPPER(u.symbol) LIKE ?


                OR UPPER(COALESCE(u.name, '')) LIKE ?


              )


            ORDER BY


              CASE WHEN UPPER(u.symbol) LIKE ? THEN 0 ELSE 1 END,


              COALESCE(u.is_top100, 0) DESC,


              d.last_date DESC,


              u.symbol ASC


            LIMIT ?


            ''',


            (q, like_q, like_q, exact_q, limit),


        ).fetchall()


    finally:


        conn.close()





    return jsonify({


        'query': q,


        'count': len(rows),


        'symbols': [dict(r) for r in rows],


    })








@app.route('/api/watchlist/add', methods=['POST'])


def watchlist_add():


    data = request.get_json(silent=True) or {}


    symbol = _validate_symbol(data.get('symbol', ''))


    if not symbol:


        return jsonify({'error': 'Invalid symbol. Use A-Z0-9.- only, length 1-10.'}), 400


    label = str(data.get('label', '') or '').strip()[:50] or None


    conn = _get_db()


    try:


        conn.execute(


            'INSERT OR IGNORE INTO watchlist_symbols (symbol, label) VALUES (?, ?)',


            (symbol, label)


        )


        conn.commit()


    finally:


        conn.close()


    return jsonify({'symbol': symbol, 'label': label, 'added': True})








@app.route('/api/watchlist/remove', methods=['POST'])


def watchlist_remove():


    data = request.get_json(silent=True) or {}


    symbol = _validate_symbol(data.get('symbol', ''))


    if not symbol:


        return jsonify({'error': 'Invalid symbol.'}), 400


    conn = _get_db()


    try:


        conn.execute('DELETE FROM watchlist_symbols WHERE symbol = ?', (symbol,))


        conn.commit()


    finally:


        conn.close()


    return jsonify({'symbol': symbol, 'removed': True})








@app.route('/api/watchlist/quote')


def watchlist_quote():


    symbol = _validate_symbol(request.args.get('symbol', ''))


    if not symbol:


        return jsonify({'error': 'Invalid symbol.'}), 400


    conn = _get_db()


    try:


        rows = conn.execute(


            'SELECT date, open, high, low, close, volume FROM ohlcv_daily'


            ' WHERE symbol = ? ORDER BY date DESC LIMIT 2',


            (symbol,)


        ).fetchall()


        ind = conn.execute(


            'SELECT sma20, sma50, sma200, rsi14 FROM indicators_daily'


            ' WHERE symbol = ? ORDER BY date DESC LIMIT 1',


            (symbol,)


        ).fetchone()


        uni = conn.execute(


            'SELECT name FROM universe_symbols WHERE symbol = ?', (symbol,)


        ).fetchone()


    finally:


        conn.close()





    if not rows:


        return jsonify({


            'error': f'No price data for {symbol}.',


            'rerun_hint': 'python backend/scripts/update_ohlcv.py',


        }), 404





    latest = dict(rows[0])


    prev = dict(rows[1]) if len(rows) > 1 else None


    close = float(latest.get('close') or 0)


    prev_close = float((prev or {}).get('close') or close)


    change_pct = round((close - prev_close) / prev_close * 100, 2) if prev_close else 0.0





    return jsonify({


        'symbol': symbol,


        'name': uni['name'] if uni else symbol,


        'date': latest.get('date'),


        'close': round(close, 2),


        'change_pct': change_pct,


        'open': round(float(latest.get('open') or 0), 2),


        'high': round(float(latest.get('high') or 0), 2),


        'low': round(float(latest.get('low') or 0), 2),


        'volume': int(latest.get('volume') or 0),


        'sma20': round(float(ind['sma20']), 2) if ind and ind['sma20'] else None,


        'sma50': round(float(ind['sma50']), 2) if ind and ind['sma50'] else None,


        'sma200': round(float(ind['sma200']), 2) if ind and ind['sma200'] else None,


        'rsi14': round(float(ind['rsi14']), 1) if ind and ind['rsi14'] else None,


    })








@app.route('/api/watchlist/ohlcv')


def watchlist_ohlcv():


    symbol = _validate_symbol(request.args.get('symbol', ''))


    if not symbol:


        return jsonify({'error': 'Invalid symbol.'}), 400


    days = min(int(request.args.get('days', 90)), 365)


    conn = _get_db()


    try:


        rows = conn.execute(


            '''SELECT o.date, o.open, o.high, o.low, o.close, o.volume,


                      i.sma20, i.sma50, i.sma200


               FROM ohlcv_daily o


               LEFT JOIN indicators_daily i


                 ON o.symbol = i.symbol AND o.date = i.date


               WHERE o.symbol = ?


               ORDER BY o.date DESC


               LIMIT ?''',


            (symbol, days)


        ).fetchall()


        uni = conn.execute(


            'SELECT name FROM universe_symbols WHERE symbol = ?', (symbol,)


        ).fetchone()


    finally:


        conn.close()





    if not rows:


        return jsonify({


            'error': f'No OHLCV data for {symbol}.',


            'rerun_hint': 'python backend/scripts/update_ohlcv.py',


            'candles': [],


        }), 404





    candles = [dict(r) for r in reversed(rows)]


    return jsonify({


        'symbol': symbol,


        'name': uni['name'] if uni else symbol,


        'candles': candles,


    })








@app.route('/api/chart')


def chart_data():


    return _chart_data_payload(request.args.get('symbol', ''), request.args.get('days', 252))








@app.route('/api/chart/<symbol>')


def chart_data_by_symbol(symbol):


    return _chart_data_payload(symbol, request.args.get('days', 252))








def _chart_data_payload(raw_symbol, raw_days):


    symbol = _validate_symbol(raw_symbol)


    if not symbol:


        return jsonify({'error': 'Invalid symbol.'}), 400





    days = _parse_int(raw_days, 252)


    days = max(1, min(days, 2000))





    conn = _get_db()


    try:


        rows = conn.execute(


            '''SELECT date, open, high, low, close, volume


               FROM ohlcv_daily


               WHERE symbol = ?


               ORDER BY date DESC


               LIMIT ?''',


            (symbol, days),


        ).fetchall()


    finally:


        conn.close()





    if not rows:


        return jsonify({


            'error': f'No OHLCV data for {symbol}.',


            'symbol': symbol,


            'candles': [],


            'rerun_hint': 'python backend/scripts/update_ohlcv.py',


        }), 404





    candles = []


    for row in reversed(rows):


        candles.append({


            'date': str(row['date']),


            'open': float(row['open'] or 0),


            'high': float(row['high'] or 0),


            'low': float(row['low'] or 0),


            'close': float(row['close'] or 0),


            'volume': int(row['volume'] or 0),


        })





    return jsonify({


        'symbol': symbol,


        'days': days,


        'count': len(candles),


        'candles': candles,


        'verify_sql': 'SELECT date, open, high, low, close, volume FROM ohlcv_daily WHERE symbol=? ORDER BY date DESC LIMIT ?',


    })








@app.route('/api/ticker-summary')


def ticker_summary():


    symbol = _validate_symbol(request.args.get('symbol', ''))


    if not symbol:


        return jsonify({'error': 'Invalid symbol.'}), 400





    conn = _get_db()


    try:


        prices = conn.execute(


            '''SELECT date, open, high, low, close, adj_close, volume


               FROM ohlcv_daily


               WHERE symbol = ?


               ORDER BY date DESC


               LIMIT 2''',


            (symbol,),


        ).fetchall()





        ind = conn.execute(


            '''SELECT date, sma20, sma50, sma200, ema8, ema21, rsi14, macd, macd_signal, atr14, vol20, ret1d, ret5d


               FROM indicators_daily


               WHERE symbol = ?


               ORDER BY date DESC


               LIMIT 1''',


            (symbol,),


        ).fetchone()





        uni = conn.execute(


            'SELECT name, sector, industry, exchange FROM universe_symbols WHERE symbol = ?',


            (symbol,),


        ).fetchone()





        sig_rows = conn.execute(


            '''SELECT date, signal_type, score, status, payload_json, created_at


               FROM signals


               WHERE symbol = ?


               ORDER BY date DESC, id DESC


               LIMIT 20''',


            (symbol,),


        ).fetchall()


    finally:


        conn.close()





    if not prices:


        return jsonify({


            'error': f'No ticker data for {symbol}.',


            'symbol': symbol,


            'rerun_hint': 'python backend/scripts/update_ohlcv.py',


        }), 404





    latest = dict(prices[0])


    prev = dict(prices[1]) if len(prices) > 1 else None


    latest_close = float(latest.get('close') or 0)


    prev_close = float((prev or {}).get('close') or latest_close)


    change_pct = ((latest_close - prev_close) / prev_close * 100) if prev_close else 0.0





    signal_items = []


    for row in sig_rows:


        item = dict(row)


        payload = item.get('payload_json')


        if isinstance(payload, str) and payload:


            try:


                item['payload'] = json.loads(payload)


            except Exception:


                item['payload'] = None


        else:


            item['payload'] = None


        signal_items.append(item)





    tone = 'neutral'

    if change_pct >= 1.5:

        tone = 'strong_bullish'

    elif change_pct <= -1.5:

        tone = 'strong_bearish'


    ai_brief_v1 = (


        f"{symbol}??癲ル슔?됭짆??癲꾧퀗???????れ삀?? {change_pct:+.2f}% ??癲ル슣????ル쵐異?{tone} ????????낇돲?? "


        f"癲ル슔?됭짆????れ삀??쎈뭄?????レ챺繹??{len(signal_items)}癲꾧퀗????ル쵐異? 癲ル슣????? ???レ챺繹먮뛽琉??쎛 ??좊즵?? ?袁⑸젻泳?떑????⑥??癲ル슢?꾤땟??????됰슣維?????????????ル깼???筌뤾퍓???"


    )





    return jsonify({


        'symbol': symbol,


        'name': (uni['name'] if uni else symbol),


        'sector': (uni['sector'] if uni else None),


        'industry': (uni['industry'] if uni else None),


        'exchange': (uni['exchange'] if uni else None),


        'date': latest.get('date'),


        'close': round(latest_close, 4),


        'change_pct': round(change_pct, 4),


        'open': latest.get('open'),


        'high': latest.get('high'),


        'low': latest.get('low'),


        'volume': latest.get('volume'),


        'indicators': {


            'date': (ind['date'] if ind else None),


            'sma20': (ind['sma20'] if ind else None),


            'sma50': (ind['sma50'] if ind else None),


            'sma200': (ind['sma200'] if ind else None),


            'ema8': (ind['ema8'] if ind else None),


            'ema21': (ind['ema21'] if ind else None),


            'rsi14': (ind['rsi14'] if ind else None),


            'macd': (ind['macd'] if ind else None),


            'macd_signal': (ind['macd_signal'] if ind else None),


            'atr14': (ind['atr14'] if ind else None),


            'vol20': (ind['vol20'] if ind else None),


            'ret1d': (ind['ret1d'] if ind else None),


            'ret5d': (ind['ret5d'] if ind else None),


        },


        'signals': signal_items,


        'ai_brief_v1': ai_brief_v1,


        'verify_sql': {


            'price': 'SELECT date, open, high, low, close FROM ohlcv_daily WHERE symbol=? ORDER BY date DESC LIMIT 2',


            'indicators': 'SELECT sma20, sma50, sma200, rsi14, macd FROM indicators_daily WHERE symbol=? ORDER BY date DESC LIMIT 1',


        },


    })








@app.route('/api/my-holdings/cache')


def my_holdings_cache():
    payload = load_json_or_none('my_holdings_cache.json')
    if payload is not None:
        return jsonify(payload)

    return jsonify({
        'status': 'missing_input',
        'error': 'my_holdings cache not found',
        'rerun_hint': 'python backend/scripts/build_my_holdings_cache.py',
    }), 404








@app.route('/api/my-holdings/raw')


def my_holdings_raw():


    if os.path.exists(MY_HOLDINGS_PATH):


        with open(MY_HOLDINGS_PATH, 'r', encoding='utf-8') as f:


            return jsonify(json.load(f))


    return jsonify({


        'error': 'my_holdings raw file not found',


        'rerun_hint': 'Upload CSV on /my page or create backend/output/my_holdings.json',


    }), 404








@app.route('/api/my-holdings/template-csv')


def my_holdings_template_csv():


    content = (


        "symbol,name,qty,avg_cost\n"


        "AAPL,Apple Inc,10,185.50\n"


        "MSFT,Microsoft Corp,5,410.20\n"


        "NVDA,NVIDIA Corp,3,725.00\n"


    )


    return Response(


        content,


        mimetype='text/csv',


        headers={'Content-Disposition': 'attachment; filename=my_holdings_template.csv'},


    )








@app.route('/api/my-holdings/import-csv', methods=['POST'])


def my_holdings_import_csv():


    file = request.files.get('file')


    if not file:


        return jsonify({'error': 'CSV file is required. field=file'}), 400





    try:


        cash = float(request.form.get('cash', '0') or 0)


    except Exception:


        cash = 0.0





    try:


        decoded = file.read().decode('utf-8-sig')


    except Exception as e:


        return jsonify({'error': f'Failed to read CSV: {e}'}), 400





    reader = csv.DictReader(io.StringIO(decoded))


    if not reader.fieldnames:


        return jsonify({'error': 'CSV header missing. expected symbol,name,qty,avg_cost'}), 400





    positions = []


    rejected = []


    for i, row in enumerate(reader, start=2):


        symbol = _validate_symbol_lenient(row.get('symbol'))


        if not symbol:


            rejected.append({'line': i, 'reason': 'invalid symbol'})


            continue


        try:


            qty = float(row.get('qty', 0) or 0)


            avg_cost = float(row.get('avg_cost', 0) or 0)


        except Exception:


            rejected.append({'line': i, 'symbol': symbol, 'reason': 'invalid qty/avg_cost'})


            continue


        if qty <= 0:


            rejected.append({'line': i, 'symbol': symbol, 'reason': 'qty must be > 0'})


            continue


        positions.append({


            'symbol': symbol,


            'name': str(row.get('name', symbol) or symbol).strip() or symbol,


            'qty': qty,


            'avg_cost': avg_cost,


        })





    payload = {


        'data_version': 'my_holdings_raw_v1',


        'generated_at': now_iso(),


        'source': 'csv_upload',


        'cash': cash,


        'positions': positions,


    }


    os.makedirs(OUTPUT_DIR, exist_ok=True)


    with open(MY_HOLDINGS_PATH, 'w', encoding='utf-8') as f:


        json.dump(payload, f, ensure_ascii=False, indent=2)





    cache_result = _build_my_holdings_cache_script()


    cache_ok = cache_result.returncode == 0


    return jsonify({


        'ok': True,


        'positions': len(positions),


        'rejected': rejected,


        'raw_path': MY_HOLDINGS_PATH,


        'cache_built': cache_ok,


        'cache_stdout': (cache_result.stdout or '').strip().splitlines()[-3:],


        'cache_stderr': (cache_result.stderr or '').strip().splitlines()[-3:],


        'rerun_hint': 'python backend/scripts/build_my_holdings_cache.py',


    })








@app.route('/api/my-holdings/export')


def my_holdings_export():


    fmt = str(request.args.get('format', 'json')).strip().lower()


    if not os.path.exists(MY_HOLDINGS_PATH):


        return jsonify({


            'error': 'No my_holdings.json to export',


            'rerun_hint': 'Import CSV first on /my page',


        }), 404





    with open(MY_HOLDINGS_PATH, 'r', encoding='utf-8') as f:


        payload = json.load(f)





    if fmt == 'json':


        text = json.dumps(payload, ensure_ascii=False, indent=2)


        return Response(


            text,


            mimetype='application/json',


            headers={'Content-Disposition': 'attachment; filename=my_holdings.json'},


        )





    if fmt == 'csv':


        output = io.StringIO()


        writer = csv.DictWriter(output, fieldnames=['symbol', 'name', 'qty', 'avg_cost'])


        writer.writeheader()


        for p in payload.get('positions', []) or []:


            writer.writerow({


                'symbol': p.get('symbol', ''),


                'name': p.get('name', ''),


                'qty': p.get('qty', ''),


                'avg_cost': p.get('avg_cost', ''),


            })


        return Response(


            output.getvalue(),


            mimetype='text/csv',


            headers={'Content-Disposition': 'attachment; filename=my_holdings.csv'},


        )





    return jsonify({'error': 'format must be json or csv'}), 400








@app.route('/api/my/holdings')


def my_holdings_v2():

    payload = load_json_or_none('my_holdings_cache.json')
    if payload is not None:
        return jsonify(payload)

    payload = load_json_or_none('my_holdings.json')
    if payload is not None:
        return jsonify(payload)

    ts_payload = load_json_or_none('my_holdings_ts.json')
    if isinstance(ts_payload, dict):
        payload = _holdings_payload_from_ts(ts_payload)
        if payload:
            return jsonify(payload)


    return jsonify({


        'error': 'my_holdings.json not found',


        'positions': [],


        'rerun_hint': 'POST /api/my/import-csv with multipart file field "file" or run python backend/scripts/import_holdings_csv.py --csv docs/my_holdings_template_v2.csv',


    }), 404








@app.route('/api/my/holdings/tabs')


def my_holdings_tabs_meta():

    payload = load_json_or_none('sheet_tabs.json')
    if payload is None:
        ts_payload = load_json_or_none('my_holdings_ts.json')
        if isinstance(ts_payload, dict):
            payload = _sheet_tabs_payload_from_ts(ts_payload)
    if payload is None:
        tabs_payload = load_json_or_none('my_holdings_tabs.json')
        if isinstance(tabs_payload, dict):
            payload = _sheet_tabs_payload_from_ts({
                'sheet_id': tabs_payload.get('sheet_id'),
                'tabs': tabs_payload.get('tabs') or [],
                'active_tabs': tabs_payload.get('selected_tabs') or [],
                'generated_at': tabs_payload.get('generated_at'),
            })
    if payload is not None:
        return jsonify(payload)

    return jsonify({
        'error': 'sheet_tabs.json not found',
        'rerun_hint': 'python backend/scripts/list_sheet_tabs.py --sheet_id <ID>',
    }), 404








@app.route('/api/my/holdings/ts')


def my_holdings_ts():

    payload = load_json_or_none('my_holdings_ts.json')
    if payload is not None:
        return jsonify(payload)

    tabs_payload = load_json_or_none('my_holdings_tabs.json')
    goal_payload = load_json_or_none('my_holdings_goal.json')
    if isinstance(tabs_payload, dict):
        payload = _holdings_ts_payload_from_raw(tabs_payload, goal_payload if isinstance(goal_payload, dict) else None)
        if payload:
            return jsonify(payload)

    return jsonify({
        'error': 'my_holdings_ts.json not found',
        'rerun_hint': 'python backend/scripts/build_holdings_ts_cache.py',
    }), 404








def _parse_tabs_from_request(data: dict) -> str:
    tabs_field = data.get('tabs') if isinstance(data, dict) else None
    if isinstance(tabs_field, list):
        return ",".join([str(t).strip() for t in tabs_field if str(t).strip()])
    if isinstance(tabs_field, str):
        return ",".join([t.strip() for t in tabs_field.split(',') if t.strip()])
    return ""


def _sheet_tabs_payload_from_ts(ts_payload: dict) -> dict:
    goal = ts_payload.get('goal') if isinstance(ts_payload, dict) else {}
    tabs_payload = ts_payload.get('tabs') if isinstance(ts_payload, dict) else []
    active_tabs = ts_payload.get('active_tabs') if isinstance(ts_payload, dict) else []

    tabs = []
    sheet_id = ts_payload.get('sheet_id') if isinstance(ts_payload, dict) else None
    generated_at = ts_payload.get('generated_at') if isinstance(ts_payload, dict) else None

    if isinstance(goal, dict) and (goal.get('history') or goal.get('positions')):
        tabs.append({
            'title': 'Goal',
            'name': 'Goal',
            'kind': 'goal',
            'excluded': False,
        })

    if isinstance(tabs_payload, list):
        for tab in tabs_payload:
            if not isinstance(tab, dict):
                continue
            name = str(tab.get('name') or tab.get('title') or '').strip()
            if not name:
                continue
            tabs.append({
                'title': name,
                'name': name,
                'kind': str(tab.get('type') or 'normal'),
                'excluded': False,
            })

    selectable = [t['title'] for t in tabs if not t.get('excluded')]
    return {
        'sheet_id': sheet_id,
        'tabs': tabs,
        'selectable': selectable,
        'excluded_default': [],
        'excluded_rules': ['derived from my_holdings_ts.json'],
        'source': 'derived_from_holdings_ts',
        'error': None,
        'generated_at': generated_at or now_iso(),
        'rerun_hint': 'python backend/scripts/list_sheet_tabs.py --sheet_id <ID>',
        'import_hint': 'python backend/scripts/import_holdings_tabs.py --sheet_id <ID> --tabs Goal,<tab1>,<tab2>',
        'active_tabs': active_tabs if isinstance(active_tabs, list) else [],
    }


def _holdings_payload_from_ts(ts_payload: dict) -> dict:
    if not isinstance(ts_payload, dict):
        return {}

    goal = ts_payload.get('goal') if isinstance(ts_payload.get('goal'), dict) else {}
    tabs_payload = ts_payload.get('tabs') if isinstance(ts_payload.get('tabs'), list) else []

    positions_by_tab = {}
    positions_columns_by_tab = {}
    positions = []
    selected_tabs = []
    last_dates = []

    def _append_rows(tab_name: str, rows):
        if not tab_name or not isinstance(rows, list):
            return
        positions_by_tab[tab_name] = rows
        positions.extend([dict(row, _tab=tab_name) for row in rows if isinstance(row, dict)])
        selected_tabs.append(tab_name)

    def _append_columns(tab_name: str, cols):
        if not tab_name or not isinstance(cols, list):
            return
        positions_columns_by_tab[tab_name] = [str(col) for col in cols if str(col).strip()]

    def _last_date_from_history(history):
        if not isinstance(history, list):
            return None
        for row in reversed(history):
            if isinstance(row, dict) and row.get('date'):
                return str(row.get('date'))
        return None

    _append_rows('Goal', goal.get('positions') or [])
    _append_columns('Goal', goal.get('positions_columns') or [])
    goal_date = _last_date_from_history(goal.get('history'))
    if goal_date:
        last_dates.append(goal_date)

    for tab in tabs_payload:
        if not isinstance(tab, dict):
            continue
        name = str(tab.get('name') or tab.get('title') or '').strip()
        if not name:
            continue
        _append_rows(name, tab.get('positions') or [])
        _append_columns(name, tab.get('positions_columns') or [])
        tab_date = _last_date_from_history(tab.get('history'))
        if tab_date:
            last_dates.append(tab_date)

    active_tabs = ts_payload.get('active_tabs') if isinstance(ts_payload.get('active_tabs'), list) else selected_tabs
    if not active_tabs:
        active_tabs = selected_tabs

    return {
        'data_version': ts_payload.get('data_version') or 'derived_from_ts',
        'generated_at': ts_payload.get('generated_at') or now_iso(),
        'status': ts_payload.get('status') or 'ok',
        'as_of_date': max(last_dates) if last_dates else None,
        'summary': {},
        'positions': positions,
        'positions_by_tab': positions_by_tab,
        'positions_columns_by_tab': positions_columns_by_tab,
        'selected_tabs': active_tabs,
        'errors': [],
        'rerun_hint': ts_payload.get('rerun_hint'),
    }


def _holdings_ts_payload_from_raw(tabs_payload: dict, goal_payload: dict | None = None) -> dict:
    if not isinstance(tabs_payload, dict):
        return {}

    goal = goal_payload if isinstance(goal_payload, dict) else {}
    tabs = tabs_payload.get('tabs') if isinstance(tabs_payload.get('tabs'), list) else []
    active_tabs = tabs_payload.get('selected_tabs') if isinstance(tabs_payload.get('selected_tabs'), list) else []
    if not active_tabs:
        active_tabs = tabs_payload.get('active_tabs') if isinstance(tabs_payload.get('active_tabs'), list) else []

    if goal and (goal.get('history') or goal.get('positions')):
        if 'Goal' not in active_tabs:
            active_tabs = ['Goal', *active_tabs]
    if not active_tabs:
        active_tabs = ['Goal'] if goal else []

    return {
        'data_version': tabs_payload.get('data_version') or goal.get('data_version') or 'derived_from_raw',
        'status': tabs_payload.get('status') or goal.get('status') or ('error' if tabs_payload.get('errors') else 'ok'),
        'sheet_id': tabs_payload.get('sheet_id') or goal.get('sheet_id'),
        'generated_at': tabs_payload.get('generated_at') or goal.get('generated_at') or now_iso(),
        'rerun_hint': tabs_payload.get('rerun_hint') or goal.get('rerun_hint'),
        'active_tabs': active_tabs,
        'tabs': tabs,
        'goal': goal if goal else {'positions': [], 'history': []},
    }








@app.route('/api/my/holdings/list-tabs', methods=['POST'])


def my_holdings_list_tabs():


    data = request.get_json(silent=True) or {}


    sheet_url = (data.get('sheet_url') or request.form.get('sheet_url') or '').strip()


    sheet_id = (data.get('sheet_id') or request.form.get('sheet_id') or '').strip()


    if not sheet_url and not sheet_id:


        return jsonify({'error': 'sheet_url or sheet_id is required'}), 400


    extra = ['--sheet_url', sheet_url] if sheet_url else ['--sheet_id', sheet_id]


    result = _run_sheets_script('list_sheet_tabs.py', extra_args=extra)


    payload = load_json_or_none('sheet_tabs.json') or {}


    err_msg = payload.get('error')


    if not err_msg and result.returncode != 0:


        err_msg = (result.stderr or result.stdout or '').strip()[-500:]


    return jsonify({


        'ok': result.returncode == 0,


        'stdout': (result.stdout or '').strip()[-500:],


        'stderr': (result.stderr or '').strip()[-500:],


        'error': err_msg,


        'tabs': payload,


    }), (200 if result.returncode == 0 else 400)








@app.route('/api/my/holdings/import-tabs', methods=['POST'])


def my_holdings_import_tabs():


    data = request.get_json(silent=True) or {}


    sheet_url = (data.get('sheet_url') or request.form.get('sheet_url') or '').strip()


    sheet_id = (data.get('sheet_id') or request.form.get('sheet_id') or '').strip()


    tabs = _parse_tabs_from_request(data or {}) or (request.form.get('tabs') or '')


    if not sheet_url and not sheet_id:


        return jsonify({'error': 'sheet_url or sheet_id is required'}), 400


    if not tabs:


        # try default selectable tabs


        tdata = load_json_or_none('sheet_tabs.json') or {}
        selectable = tdata.get('selectable') or []
        if selectable:
            tabs = ",".join(selectable)


        if not tabs:


            tabs = "Goal"





    import_args = ['--sheet_url', sheet_url] if sheet_url else ['--sheet_id', sheet_id]


    import_args += ['--tabs', tabs]


    result_import = _run_sheets_script('import_holdings_tabs.py', extra_args=import_args, timeout=240)


    result_ts = _run_backend_script('build_holdings_ts_cache.py', extra_args=[], timeout=120)


    result_snapshot = _run_backend_script('build_my_holdings_cache_from_ts.py', extra_args=[], timeout=120)





    ts_payload = load_json_or_none('my_holdings_ts.json')
    if ts_payload is None:
        tabs_raw = load_json_or_none('my_holdings_tabs.json')
        goal_raw = load_json_or_none('my_holdings_goal.json')
        if isinstance(tabs_raw, dict):
            ts_payload = _holdings_ts_payload_from_raw(tabs_raw, goal_raw if isinstance(goal_raw, dict) else None)
        else:
            ts_payload = {}


    sheet_tabs_payload = load_json_or_none('sheet_tabs.json')
    if sheet_tabs_payload is None and isinstance(ts_payload, dict):
        sheet_tabs_payload = _sheet_tabs_payload_from_ts(ts_payload)


    holdings_payload = load_json_or_none('my_holdings_cache.json')
    if holdings_payload is None:
        holdings_payload = load_json_or_none('my_holdings.json')
    if holdings_payload is None and isinstance(ts_payload, dict):
        holdings_payload = _holdings_payload_from_ts(ts_payload)





    err_msg = None


    if result_import.returncode != 0:


        err_msg = (result_import.stderr or result_import.stdout or '').strip()[-500:]


    elif result_ts.returncode != 0:


        err_msg = (result_ts.stderr or result_ts.stdout or '').strip()[-500:]


    elif result_snapshot.returncode != 0:


        err_msg = (result_snapshot.stderr or result_snapshot.stdout or '').strip()[-500:]





    return jsonify({


        'ok': result_import.returncode == 0 and result_ts.returncode == 0 and result_snapshot.returncode == 0,


        'stdout_import': (result_import.stdout or '').strip()[-500:],


        'stderr_import': (result_import.stderr or '').strip()[-500:],


        'stdout_ts': (result_ts.stdout or '').strip()[-500:],


        'stderr_ts': (result_ts.stderr or '').strip()[-500:],


        'stdout_snapshot': (result_snapshot.stdout or '').strip()[-500:],


        'stderr_snapshot': (result_snapshot.stderr or '').strip()[-500:],


        'error': err_msg,


        'tabs': tabs,


        'ts': ts_payload,


        'sheet_tabs': sheet_tabs_payload,


        'holdings': holdings_payload,


    }), (200 if result_import.returncode == 0 else 400)








@app.route('/api/my/holdings/ts/export')


def my_holdings_ts_export():


    fmt = str(request.args.get('format', 'csv')).strip().lower()


    if fmt != 'csv':


        return jsonify({'error': 'Only csv supported'}), 400


    # run exporter to a temp path


    tmp_path = os.path.join(OUTPUT_DIR, 'tmp', 'my_holdings_ts.csv')


    os.makedirs(os.path.dirname(tmp_path), exist_ok=True)


    result = _run_backend_script('export_holdings_ts_csv.py', extra_args=['--output', tmp_path])


    if not os.path.exists(tmp_path):


        return jsonify({'error': 'export failed', 'stderr': (result.stderr or '').strip()[-500:]}), 500


    with open(tmp_path, 'r', encoding='utf-8') as f:


        content = f.read()


    return Response(


        content,


        mimetype='text/csv',


        headers={'Content-Disposition': 'attachment; filename=my_holdings_ts.csv'},


    )








@app.route('/api/my/import-csv', methods=['POST'])


def my_import_csv_v2():


    uploaded = request.files.get('file') or request.files.get('csv')


    if not uploaded:


        return jsonify({


            'error': 'CSV file is required (multipart field: file).',


            'rerun_hint': 'POST /api/my/import-csv with multipart form-data: file=@docs/my_holdings_template_v2.csv',


        }), 400





    tmp_path = None


    try:


        os.makedirs(os.path.join(OUTPUT_DIR, 'tmp'), exist_ok=True)


        with tempfile.NamedTemporaryFile(


            mode='wb',


            suffix='.csv',


            prefix='holdings_upload_',


            dir=os.path.join(OUTPUT_DIR, 'tmp'),


            delete=False,


        ) as tmp:


            uploaded.save(tmp)


            tmp_path = tmp.name





        result = subprocess.run(


            [sys.executable, HOLDINGS_IMPORT_SCRIPT, '--csv', tmp_path, '--output', MY_HOLDINGS_PATH],


            capture_output=True,


            encoding='utf-8',


            errors='replace',


            timeout=120,


        )





        if result.returncode != 0:


            return jsonify({


                'error': 'CSV import failed.',


                'detail': (result.stderr or result.stdout or '').strip()[-1000:],


                'rerun_hint': 'python backend/scripts/import_holdings_csv.py --csv docs/my_holdings_template_v2.csv',


            }), 400





        enrich_result = _build_my_holdings_cache_script()


        enrich_ok = enrich_result.returncode == 0





        if not os.path.exists(MY_HOLDINGS_PATH):


            return jsonify({


                'error': 'Importer succeeded but output file missing.',


                'rerun_hint': 'python backend/scripts/import_holdings_csv.py --csv docs/my_holdings_template_v2.csv',


            }), 500





        with open(MY_HOLDINGS_PATH, 'r', encoding='utf-8') as f:


            payload = json.load(f)





        return jsonify({


            'ok': True,


            'positions': len(payload.get('positions') or []),


            'status': payload.get('status', 'ok'),


            'import_report': payload.get('import_report') or {},


            'enriched': enrich_ok,


            'enrich_stdout': (enrich_result.stdout or '').strip().splitlines()[-3:],


            'enrich_stderr': (enrich_result.stderr or '').strip().splitlines()[-3:],


            'rerun_hint': payload.get('rerun_hint') or 'python backend/scripts/import_holdings_csv.py --csv docs/my_holdings_template_v2.csv',


            'my_holdings': payload,


        })


    finally:


        if tmp_path and os.path.exists(tmp_path):


            try:


                os.remove(tmp_path)


            except Exception:


                pass








@app.route('/api/my/export')


def my_export_v2():


    fmt = str(request.args.get('format', 'json')).strip().lower()


    if not os.path.exists(MY_HOLDINGS_PATH):


        return jsonify({


            'error': 'No my_holdings.json to export.',


            'rerun_hint': 'POST /api/my/import-csv first.',


        }), 404





    with open(MY_HOLDINGS_PATH, 'r', encoding='utf-8') as f:


        payload = json.load(f)





    if fmt == 'json':


        text = json.dumps(payload, ensure_ascii=False, indent=2)


        return Response(


            text,


            mimetype='application/json',


            headers={'Content-Disposition': 'attachment; filename=my_holdings.json'},


        )





    if fmt == 'csv':


        output = io.StringIO()


        fieldnames = [


            'symbol', 'yesterday_close', 'today_close', 'change_pct', 'pnl_today',


            'avg_cost', 'equity', 'cost_basis', 'buy_total',


            'rsi', 'position_pct', 'shares',


            'cum_return_pct', 'cum_pnl_usd', 'mdd_pct',


            'volume_k', 'high_52w', 'low_52w',


            'ma5', 'ma120', 'ma200',


            'note',


        ]


        writer = csv.DictWriter(output, fieldnames=fieldnames)


        writer.writeheader()


        for p in payload.get('positions', []) or []:


            writer.writerow({


                'symbol': p.get('symbol', ''),


                'yesterday_close': p.get('yesterday_close', ''),


                'today_close': p.get('today_close', ''),


                'change_pct': p.get('change_pct', ''),


                'pnl_today': p.get('pnl_today', ''),


                'avg_cost': p.get('avg_cost', ''),


                'equity': p.get('equity', ''),


                'cost_basis': p.get('cost_basis', ''),


                'buy_total': p.get('buy_total', ''),


                'rsi': p.get('rsi', ''),


                'position_pct': p.get('position_pct', ''),


                'shares': p.get('shares', p.get('qty', '')),


                'cum_return_pct': p.get('cum_return_pct', ''),


                'cum_pnl_usd': p.get('cum_pnl_usd', ''),


                'mdd_pct': p.get('mdd_pct', ''),


                'volume_k': p.get('volume_k', ''),


                'high_52w': p.get('high_52w', ''),


                'low_52w': p.get('low_52w', ''),


                'ma5': p.get('ma5', ''),


                'ma120': p.get('ma120', ''),


                'ma200': p.get('ma200', ''),


                'note': p.get('note', ''),


            })


        return Response(


            output.getvalue(),


            mimetype='text/csv',


            headers={'Content-Disposition': 'attachment; filename=my_holdings.csv'},


        )





    return jsonify({'error': 'format must be json or csv'}), 400








@app.route('/api/my/template-csv')


def my_template_csv_v2():


    docs_path = os.path.join(os.path.dirname(__file__), '..', 'docs', 'my_holdings_template_v2.csv')


    if os.path.exists(docs_path):


        with open(docs_path, 'r', encoding='utf-8') as f:


            content = f.read()


    else:


        content = (


            'symbol,yesterday_close,today_close,change_pct,pnl_today,avg_cost,equity,cost_basis,buy_total,rsi,position_pct,shares,cum_return_pct,cum_pnl_usd,mdd_pct,volume_k,high_52w,low_52w,ma5,ma120,ma200,note\n'


            'AAPL,188.20,189.85,0.8768,16.50,185.50,1898.50,1855.00,1855.00,62.10,31.2200,10,2.3450,43.50,,58120,199.62,164.08,188.10,182.45,176.22,core\n'


            'MSFT,411.80,409.25,-0.6197,-12.75,410.20,2046.25,2051.00,2051.00,54.80,33.6200,5,-0.2316,-4.75,,33440,468.35,344.79,412.30,401.12,388.94,watch\n'


            'NVDA,721.50,734.10,1.7464,37.80,725.00,2202.30,2175.00,2175.00,68.40,35.1600,3,1.2552,27.30,,90210,802.67,389.00,728.20,689.44,640.18,momentum\n'


        )


    return Response(


        content,


        mimetype='text/csv',


        headers={'Content-Disposition': 'attachment; filename=my_holdings_template.csv'},


    )








@app.route('/api/my/holdings/credentials', methods=['GET'])


def my_holdings_credentials_status():


    from_env = bool(os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON', '').strip())


    from_file = os.path.exists(SA_CONFIG_PATH)


    configured = from_env or from_file


    source = 'env' if from_env else ('file' if from_file else 'none')


    return jsonify({'configured': configured, 'source': source})








@app.route('/api/my/holdings/credentials', methods=['POST'])


def my_holdings_credentials_save():


    data = request.get_json(silent=True) or {}


    sa_json_str = (data.get('service_account_json') or '').strip()


    if not sa_json_str:


        return jsonify({'error': 'service_account_json is required'}), 400


    try:


        parsed = json.loads(sa_json_str)


        if not isinstance(parsed, dict):


            return jsonify({'error': 'Must be a JSON object'}), 400


        if parsed.get('type') != 'service_account':


            return jsonify({'error': 'Not a service account JSON ("type" must be "service_account")'}), 400


    except Exception as e:


        return jsonify({'error': f'Invalid JSON: {e}'}), 400


    os.makedirs(os.path.dirname(SA_CONFIG_PATH), exist_ok=True)


    with open(SA_CONFIG_PATH, 'w', encoding='utf-8') as f:


        json.dump(parsed, f, ensure_ascii=False, indent=2)


    return jsonify({'ok': True, 'message': 'Credentials saved.'})








@app.route('/api/my/holdings/credentials', methods=['DELETE'])


def my_holdings_credentials_delete():


    if os.path.exists(SA_CONFIG_PATH):


        os.remove(SA_CONFIG_PATH)


    return jsonify({'ok': True, 'message': 'Credentials removed.'})


@app.route('/api/my/holdings/sa-email')
def my_holdings_sa_email():
    """SA 이메일 주소만 노출 (구독자가 시트 공유 시 사용)."""
    sa_raw = _get_sa_json()
    if not sa_raw:
        return jsonify({'email': None, 'configured': False})
    try:
        data = json.loads(sa_raw)
        email = data.get('client_email', '')
        return jsonify({'email': email or None, 'configured': bool(email)})
    except Exception:
        return jsonify({'email': None, 'configured': False})












@app.route('/api/backtests/symbols', methods=['GET'])


def backtest_symbols():

    """List available symbols for backtest. Optional ?q= search, ?min_days= filter."""

    q        = (request.args.get('q') or '').strip().upper()

    min_days = int(request.args.get('min_days', 200))

    try:

        backtest_db = resolve_marketflow_db(required_tables=("ohlcv_daily",), data_plane="snapshot")

        con = _db_connect(backtest_db)

        rows = con.execute("""

            SELECT o.symbol,

                   COALESCE(u.name, o.symbol) AS name,

                   COALESCE(u.sector, '') AS sector,

                   COUNT(*) AS days,


                   MIN(o.date) AS date_from,


                   MAX(o.date) AS date_to


            FROM ohlcv_daily o


            LEFT JOIN universe_symbols u ON u.symbol = o.symbol


            GROUP BY o.symbol


            HAVING days >= ?


            ORDER BY days DESC


        """, (min_days,)).fetchall()


        con.close()


        result = [


            {'symbol': r[0], 'name': r[1], 'sector': r[2],


             'days': r[3], 'date_from': r[4], 'date_to': r[5]}


            for r in rows


            if (not q) or q in r[0].upper() or q in (r[1] or '').upper()


        ]


        return jsonify(result)


    except Exception as e:


        return jsonify({'error': str(e)}), 500








# ???? Strategy Simulation: TQQQ DCA Backtest ????????????????????????????????????????????????????????????????


BT_DIR_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'backtests')


TQQQ_DCA_SCRIPT = os.path.join(os.path.dirname(__file__), 'scripts', 'build_tqqq_dca.py')








@app.route('/api/backtests/tqqq-dca', methods=['GET'])


def tqqq_dca_summary():


    """Return pre-computed summary. If missing, run backtest with defaults."""


    fpath = os.path.join(BT_DIR_PATH, 'tqqq_dca_summary.json')


    if os.path.exists(fpath):


        with open(fpath, encoding='utf-8') as f:


            return jsonify(json.load(f))


    return jsonify({'error': 'No data yet. Run build_tqqq_dca.py first.'}), 404








@app.route('/api/backtests/tqqq-dca-curve', methods=['GET'])


def tqqq_dca_curve():


    """Return equity_curve + dd_curve + signals."""


    fpath = os.path.join(BT_DIR_PATH, 'tqqq_dca_curve.json')


    if os.path.exists(fpath):


        with open(fpath, encoding='utf-8') as f:


            return jsonify(json.load(f))


    return jsonify({'error': 'No data yet.'}), 404








@app.route('/api/backtests/tqqq-dca/run', methods=['POST'])


def tqqq_dca_run():


    """Run backtest dynamically with custom params (POST JSON body)."""


    try:


        params = request.get_json(silent=True) or {}


        import importlib.util, sys as _sys


        spec = importlib.util.spec_from_file_location('build_tqqq_dca', TQQQ_DCA_SCRIPT)


        mod  = importlib.util.module_from_spec(spec)


        spec.loader.exec_module(mod)


        result = mod.run_backtest(params)


        if 'error' in result:


            return jsonify(result), 400


        return jsonify(result)


    except Exception as e:


        return jsonify({'error': str(e)}), 500








# ???? Navigator AI endpoints ????????????????????????????????????????????????????????????????????????????????????????????


def _handle_navigator_ai(provider: str):


    payload = request.get_json(silent=True) or {}


    context_pack = payload.get('context_pack') or {}


    cache_key = _ai_cache_key(context_pack)


    cache = _ai_cache_load()


    cached_entry = (cache.get(cache_key) or {}).get(provider)


    if cached_entry:


        cached_entry['cached'] = True


        return jsonify(cached_entry)





    ip = request.remote_addr or 'unknown'


    if not _ai_rate_allow(ip, provider):


        return jsonify({'error': 'rate_limit', 'message': 'AI daily limit reached.'}), 429





    prompt_name = 'navigator_ai_gpt.md' if provider == 'gpt' else 'navigator_ai_gemini.md'


    template = _load_prompt(prompt_name)


    if not template:


        return jsonify({'error': 'prompt_missing', 'message': 'Prompt template missing.'}), 500





    user_prompt = _render_prompt(template, context_pack)


    system_prompt = "You are a calm institutional research narrator. Follow the template strictly."





    if provider == 'gpt':


        result = gpt_client.generate_text(task='navigator_ai_gpt', system=system_prompt, user=user_prompt, temperature=0.2, max_tokens=480)


    else:


        result = gemini_client.generate_text(task='navigator_ai_gemini', system=system_prompt, user=user_prompt, temperature=0.2, max_tokens=600)





    parsed = _parse_ai_lines(result.text)


    fallback = {


        'weather': f"?熬곣뫗??嶺뚮ㅄ維獄??{context_pack.get('state','').replace('_',' ')}???낅퉵??" if (context_pack.get('lang') or 'ko') == 'ko' else f"Current mode is {context_pack.get('state','').replace('_',' ')}.",


        'evidence': context_pack.get('evidence_line'),


        'action': context_pack.get('action_line'),


        'psychology': context_pack.get('psychology_line'),


    }


    filled = False


    for key in ['weather', 'evidence', 'action', 'psychology']:


        if not parsed.get(key) and fallback.get(key):


            parsed[key] = fallback.get(key)


            filled = True


    response = {


        'weather': parsed.get('weather'),


        'evidence': parsed.get('evidence'),


        'action': parsed.get('action'),


        'psychology': parsed.get('psychology'),


        'model': result.model,


        'asof': now_iso(),


        'filled': filled,


    }





    if result.error:


        response['error'] = result.error


        return jsonify(response)





    if not filled:


        cache.setdefault(cache_key, {})[provider] = response


        _ai_cache_save(cache)


    return jsonify(response)








@app.route('/api/crash/navigator/ai/gpt', methods=['POST'])


def navigator_ai_gpt():


    return _handle_navigator_ai('gpt')








@app.route('/api/crash/navigator/ai/gemini', methods=['POST'])


def navigator_ai_gemini():


    return _handle_navigator_ai('gemini')








@app.route('/api/crash/navigator/ai/cache', methods=['POST'])


def navigator_ai_cache():


    payload = request.get_json(silent=True) or {}


    provider = (payload.get('provider') or 'gpt').strip().lower()


    context_pack = payload.get('context_pack') or {}


    cache_key = _ai_cache_key(context_pack)


    cache = _ai_cache_load()


    entry = (cache.get(cache_key) or {}).get(provider)


    if entry:


        entry = dict(entry)


        entry['cached'] = True


        return jsonify(entry)


    lang = context_pack.get('lang') or 'ko'


    latest = _ai_cache_latest_for_lang(provider, lang)


    if latest:


        latest = dict(latest)


        latest['cached'] = True


        latest['fallback_latest'] = True


        return jsonify(latest)


    return jsonify({'cached': False})











@app.route('/api/refresh-prices', methods=['POST'])


def refresh_prices():


    """On-demand OHLCV price refresh ??runs update_ohlcv.py with parallel workers."""


    t0 = _time.time()


    try:


        result = _run_backend_script('update_ohlcv.py', extra_args=['--workers=8'], timeout=300)


        elapsed = round(_time.time() - t0, 1)


        upserted = 0


        for line in (result.stdout or '').splitlines():


            if 'Total upsert rows this run:' in line:


                try:


                    upserted = int(line.split(':')[-1].strip())


                except ValueError:


                    pass


        ok = result.returncode == 0


        return jsonify({


            'ok': ok,


            'upserted': upserted,


            'elapsed': elapsed,


            'error': result.stderr.strip() if not ok else None,


        })


    except subprocess.TimeoutExpired:


        elapsed = round(_time.time() - t0, 1)


        return jsonify({'ok': False, 'upserted': 0, 'elapsed': elapsed, 'error': 'timeout'}), 504


    except Exception as e:


        elapsed = round(_time.time() - t0, 1)


        return jsonify({'ok': False, 'upserted': 0, 'elapsed': elapsed, 'error': str(e)}), 500














@app.route('/api/briefing/v2/generate', methods=['POST'])


def briefing_v2_generate():


    import time as _time


    import subprocess, sys


    t0 = _time.time()


    timeout_sec = 300

    script = os.path.join(os.path.dirname(__file__), 'scripts', 'build_ai_briefing_v2.py')


    env = os.environ.copy()


    env['PYTHONIOENCODING'] = 'utf-8'


    env['PYTHONUTF8'] = '1'


    try:


        result = subprocess.run(


            [sys.executable, '-X', 'utf8', script],


            capture_output=True, timeout=timeout_sec, env=env,


            cwd=os.path.dirname(__file__),


        )


        elapsed = round(_time.time() - t0, 1)


        ok = result.returncode == 0


        if not ok:


            err = result.stderr.decode('utf-8', errors='replace').strip()[-400:]


            return jsonify({'ok': False, 'elapsed': elapsed, 'error': err}), 500





        out_path = os.path.join(OUTPUT_DIR, 'cache', 'legacy', 'ai_briefing_v2.json')


        if os.path.exists(out_path):


            with open(out_path, encoding='utf-8') as f:


                data = json.load(f)


        else:


            data = {}


        return jsonify({'ok': True, 'elapsed': elapsed, 'data': data})


    except subprocess.TimeoutExpired:


        return jsonify({'ok': False, 'elapsed': timeout_sec, 'error': 'timeout'}), 504


    except Exception as e:


        return jsonify({'ok': False, 'elapsed': 0, 'error': str(e)}), 500











@app.route('/api/briefing/v3', methods=['GET'])


def briefing_v3_read():


    out_path = os.path.join(OUTPUT_DIR, 'cache', 'daily_briefing_v3.json')


    if not os.path.exists(out_path):


        return jsonify({


            'error': 'daily_briefing_v3.json not generated yet.',


            'rerun_hint': 'python backend/scripts/build_daily_briefing_v3.py',


        }), 404


    with open(out_path, encoding='utf-8') as f:


        return jsonify(json.load(f))








@app.route('/api/briefing/v3/generate', methods=['POST'])


def briefing_v3_generate():


    import time as _time


    import subprocess, sys


    t0 = _time.time()


    timeout_sec = 300

    # Refresh the news cache first so the briefing sees today's headlines.
    try:
        _run_backend_script('build_context_news.py', extra_args=['--region', 'us', '--limit', '5'], timeout=180)
    except Exception:
        pass

    script = os.path.join(os.path.dirname(__file__), 'scripts', 'build_daily_briefing_v3.py')


    req_body = request.json if request.is_json else {}
    force  = req_body.get('force', False)
    lang   = req_body.get('lang', 'ko')  # default: Korean-only generation


    args   = [sys.executable, '-X', 'utf8', script]


    if force:


        args.append('--force')

    args.append(f'--lang={lang}')


    env = os.environ.copy()


    env['PYTHONIOENCODING'] = 'utf-8'


    env['PYTHONUTF8'] = '1'


    try:


        result = subprocess.run(


            args, capture_output=True, timeout=timeout_sec, env=env,


            cwd=os.path.dirname(__file__),


        )


        elapsed = round(_time.time() - t0, 1)


        ok = result.returncode == 0


        if not ok:


            err = result.stderr.decode('utf-8', errors='replace').strip()[-400:]


            return jsonify({'ok': False, 'elapsed': elapsed, 'error': err}), 500


        out_path = os.path.join(OUTPUT_DIR, 'cache', 'daily_briefing_v3.json')


        if os.path.exists(out_path):


            with open(out_path, encoding='utf-8') as f:


                data = json.load(f)


        else:


            data = {}


        return jsonify({'ok': True, 'elapsed': elapsed, 'data': data})


    except subprocess.TimeoutExpired:


        return jsonify({'ok': False, 'elapsed': timeout_sec, 'error': 'timeout'}), 504


    except Exception as e:


        return jsonify({'ok': False, 'elapsed': 0, 'error': str(e)}), 500








@app.route('/api/briefing/v2/tavily-health', methods=['GET'])


def briefing_v2_tavily_health():


    import time as _time


    import requests


    from requests.exceptions import ConnectionError as RequestsConnectionError, Timeout as RequestsTimeout





    t0 = _time.time()


    api_key = (


        os.environ.get('TAVILY_API_KEY', '').strip()


        or os.environ.get('TAVILY_KEY', '').strip()


    )


    timeout_sec = 12


    query = (request.args.get('query') or 'S&P 500 today news').strip()


    topic = (request.args.get('topic') or 'news').strip().lower()


    if topic not in {'news', 'finance'}:


        topic = 'news'





    if not api_key:


        return jsonify({


            'ok': False,


            'status': 'missing_key',


            'message': 'TAVILY_API_KEY is not configured.',


            'elapsed_ms': int((_time.time() - t0) * 1000),


        }), 200





    payload = {


        'api_key': api_key,


        'query': query,


        'topic': topic,


        'search_depth': 'basic',


        'max_results': 1,


        'include_answer': False,


        'include_raw_content': False,


    }





    try:


        resp = requests.post(


            'https://api.tavily.com/search',


            json=payload,


            timeout=timeout_sec,


        )


        elapsed_ms = int((_time.time() - t0) * 1000)





        if resp.status_code in (401, 403):


            return jsonify({


                'ok': False,


                'status': 'auth_failed',


                'http_status': resp.status_code,


                'message': 'Tavily authentication failed. Check API key or plan permission.',


                'elapsed_ms': elapsed_ms,


            }), 200





        if resp.status_code >= 400:


            body_preview = (resp.text or '').strip().replace('\n', ' ')[:220]


            return jsonify({


                'ok': False,


                'status': 'http_error',


                'http_status': resp.status_code,


                'message': body_preview or 'Tavily HTTP error',


                'elapsed_ms': elapsed_ms,


            }), 200





        data = resp.json()


        results = data.get('results') if isinstance(data, dict) else []


        first = results[0] if isinstance(results, list) and results else {}





        return jsonify({


            'ok': True,


            'status': 'ok',


            'message': 'Tavily request succeeded.',


            'elapsed_ms': elapsed_ms,


            'query': query,


            'topic': topic,


            'result_count': len(results) if isinstance(results, list) else 0,


            'sample': {


                'title': (first.get('title') or '') if isinstance(first, dict) else '',


                'url': (first.get('url') or '') if isinstance(first, dict) else '',


                'source': (first.get('source') or '') if isinstance(first, dict) else '',


            },


        }), 200





    except RequestsTimeout:


        return jsonify({


            'ok': False,


            'status': 'timeout',


            'message': f'Tavily request timed out ({timeout_sec}s).',


            'elapsed_ms': int((_time.time() - t0) * 1000),


        }), 200


    except RequestsConnectionError as e:


        return jsonify({


            'ok': False,


            'status': 'network_error',


            'message': f'Network connection failed: {str(e)}',


            'elapsed_ms': int((_time.time() - t0) * 1000),


        }), 200


    except Exception as e:


        return jsonify({


            'ok': False,


            'status': 'unknown_error',


            'message': str(e),


            'elapsed_ms': int((_time.time() - t0) * 1000),


        }), 200


@app.route('/api/ticker-brief', methods=['GET'])
def get_ticker_brief():
    symbol = request.args.get('symbol', '').upper().strip()
    if not symbol:
        return jsonify({'error': 'symbol required'}), 400
    
    import glob as _glob
    # 파일 경로를 안전하게 조인
    cache_dir = os.path.join(os.path.dirname(__file__), 'output', 'cache', 'ticker_briefs', symbol)
    pattern = os.path.join(cache_dir, '*.json')
    files = sorted(_glob.glob(pattern), reverse=True)[:4]
    
    briefs = []
    for fp in files:
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                briefs.append(json.load(f))
        except Exception:
            pass
    return jsonify({'symbol': symbol, 'briefs': briefs})

# 이 함수는 정의만 해둡니다.
def _maybe_start_scheduler_on_import() -> None:
    if os.environ.get("MARKETFLOW_DISABLE_SCHEDULER") == "1":
        return
    # 메인 실행 파일이 아닐 때(예: gunicorn 등 외부에 의해 호출될 때) 스케줄러 시작
    if __name__ != "__main__":
        start_scheduler()
        _start_auto_import_thread()

# ⚠️ 기존에 에러를 유발하던 'def _maybe_start_scheduler_on_import()' 호출 줄은 삭제했습니다.


def _auto_import_holdings_from_sheets() -> None:
    """
    앱 시작 시 GOOGLE_SHEETS_ID 환경변수가 있으면 자동으로 Google Sheet import 실행.
    Railway 재배포 후 JSON 파일이 초기화되어도 자동 복구됨.
    GOOGLE_SHEETS_TABS env var로 임포트 탭 지정 (기본: sheet1~sheet8).
    """
    sheet_id = os.environ.get("GOOGLE_SHEETS_ID", "").strip()
    if not sheet_id:
        return

    sa_json = _get_sa_json()
    if not sa_json:
        print("[auto-import] GOOGLE_SERVICE_ACCOUNT_JSON not set, skipping.")
        return

    # 캐시가 이미 최신이면 (6시간 이내) 스킵
    cache_path = MY_HOLDINGS_SNAPSHOT_PATH
    if _holdings_artifacts_complete() and os.path.exists(cache_path):
        import time
        age_hours = (time.time() - os.path.getmtime(cache_path)) / 3600
        if age_hours < 6:
            print(f"[auto-import] Cache is fresh ({age_hours:.1f}h old), skipping.")
            return

    tabs = os.environ.get("GOOGLE_SHEETS_TABS", "Goal,미국1,미국2,미국3,미국4,미국5,미국6,한국1")
    print(f"[auto-import] Starting Google Sheets import: sheet_id={sheet_id}, tabs={tabs}")

    try:
        scripts_dir = os.path.join(os.path.dirname(__file__), "scripts")
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        env["GOOGLE_SERVICE_ACCOUNT_JSON"] = sa_json

        r1 = subprocess.run(
            [sys.executable, "-X", "utf8",
             os.path.join(scripts_dir, "import_holdings_tabs.py"),
             "--sheet_id", sheet_id, "--tabs", tabs],
            capture_output=True, text=True, env=env, timeout=300,
        )
        if r1.returncode != 0:
            print(f"[auto-import] import_holdings_tabs failed: {r1.stderr[-300:]}")
            return

        r2 = subprocess.run(
            [sys.executable, "-X", "utf8", os.path.join(scripts_dir, "build_holdings_ts_cache.py")],
            capture_output=True, text=True, env=env, timeout=120,
        )
        r3 = subprocess.run(
            [sys.executable, "-X", "utf8", os.path.join(scripts_dir, "build_my_holdings_cache_from_ts.py")],
            capture_output=True, text=True, env=env, timeout=120,
        )
        print(f"[auto-import] Done. ts={r2.returncode} snapshot={r3.returncode}")
    except Exception as e:
        print(f"[auto-import] Error: {e}")


def _start_auto_import_thread() -> None:
    """gunicorn/Railway 환경에서 백그라운드 스레드로 자동 import 실행."""
    if os.environ.get("GOOGLE_SHEETS_ID", "").strip():
        import threading
        t = threading.Thread(target=_auto_import_holdings_from_sheets, daemon=True, name="auto-import-holdings")
        t.start()


if __name__ == '__main__':
    # 출력 디렉토리 생성
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    debug_mode = True
    
    # Flask 디버그 모드 시 리로더에 의해 두 번 실행되는 것을 방지
    should_start_scheduler = (os.environ.get('WERKZEUG_RUN_MAIN') == 'true') or (not debug_mode)

    if should_start_scheduler:
        start_scheduler()

    # 포트 및 호스트 설정
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=debug_mode)

