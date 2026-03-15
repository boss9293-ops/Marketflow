"""
validate_cache.py
Validates expected cache files and writes healthcheck.json.
Exit 0 = ok, Exit 1 = critical error.
"""
from __future__ import annotations
import json, os, sys
from datetime import datetime, timezone

if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def _find_root():
    here = os.path.dirname(os.path.abspath(__file__))
    for candidate in [os.path.join(here, '..'), os.path.join(here, '..', '..')]:
        candidate = os.path.realpath(candidate)
        if os.path.exists(os.path.join(candidate, 'data', 'marketflow.db')):
            return candidate
    raise RuntimeError('Cannot locate project root')

ROOT = _find_root()
OUTPUT_DIR = os.path.join(ROOT, 'backend', 'output')
CACHE_DIR = os.path.join(OUTPUT_DIR, 'cache')

CRITICAL_FILES = [
    ('cache/overview.json',       ['latest_date', 'gate_score', 'risk_level']),
    ('cache/market_state.json',   ['phase', 'gate', 'risk', 'trend']),
    ('cache/snapshots_120d.json', ['snapshots']),
]

RECOMMENDED_FILES = [
    ('cache/ml_prediction.json',  []),
    ('overview_home.json',        ['hot_top5']),
    ('daily_report.json',         ['bullets']),
    ('hot_zone.json',             ['leaders']),
    ('sector_rotation.json',      []),
    ('cache/market_tape.json',      ['items']),
    ('cache/health_snapshot.json', ['trend', 'risk', 'breadth_greed']),
    ('cache/action_snapshot.json', ['exposure_guidance', 'portfolio', 'watchlist_moves']),
    ('cache/daily_briefing.json',  ['headline', 'bullets', 'stance']),
]

def check_file(rel_path, required_keys):
    full = os.path.join(OUTPUT_DIR, rel_path.replace('/', os.sep))
    result = {'file': rel_path, 'exists': False, 'schema_ok': True, 'errors': []}
    if not os.path.exists(full):
        result['errors'].append('missing: ' + rel_path)
        return result
    result['exists'] = True
    try:
        with open(full, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for key in required_keys:
            if key not in data:
                result['schema_ok'] = False
                result['errors'].append("missing key '%s' in %s" % (key, rel_path))
    except json.JSONDecodeError as e:
        result['schema_ok'] = False
        result['errors'].append('invalid JSON in %s: %s' % (rel_path, e))
    except Exception as e:
        result['schema_ok'] = False
        result['errors'].append('read error in %s: %s' % (rel_path, e))
    return result

def get_data_date():
    p = os.path.join(CACHE_DIR, 'overview.json')
    try:
        with open(p, 'r', encoding='utf-8') as f:
            d = json.load(f)
        return d.get('latest_date') or d.get('gate_date')
    except Exception:
        return None

def main():
    os.makedirs(CACHE_DIR, exist_ok=True)
    missing_files, schema_errors, warnings = [], [], []

    for rel_path, required_keys in CRITICAL_FILES:
        r = check_file(rel_path, required_keys)
        if not r['exists']:
            missing_files.append(r['file'])
        elif not r['schema_ok']:
            schema_errors.extend(r['errors'])

    for rel_path, required_keys in RECOMMENDED_FILES:
        r = check_file(rel_path, required_keys)
        if not r['exists']:
            warnings.append('optional missing: ' + r['file'])
        elif not r['schema_ok']:
            warnings.extend(['warning: ' + e for e in r['errors']])

    ok = len(missing_files) == 0 and len(schema_errors) == 0
    data_date = get_data_date()

    report = {
        'ok': ok,
        'last_run_at': datetime.now(timezone.utc).isoformat(),
        'data_date': data_date,
        'missing_files': missing_files,
        'schema_errors': schema_errors,
        'warnings': warnings,
        'critical_checked': len(CRITICAL_FILES),
        'recommended_checked': len(RECOMMENDED_FILES),
    }

    out_path = os.path.join(CACHE_DIR, 'healthcheck.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    if ok:
        print('OK  healthcheck passed | data_date=%s' % data_date)
    else:
        print('FAIL  healthcheck FAILED', file=sys.stderr)
        for e in missing_files + schema_errors:
            print('  ERROR: ' + e, file=sys.stderr)
        for w in warnings:
            print('  WARN:  ' + w, file=sys.stderr)

    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())
