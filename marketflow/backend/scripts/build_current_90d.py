"""
Build current_90d.json playback.

This script merges the latest risk_v1 / vr_survival history with the most
recent 90 trading days of price data so the VR playback screens can render a
compact timeline without hitting the database at request time.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
BACKEND_DIR_STR = str(BACKEND_DIR)
if BACKEND_DIR_STR not in sys.path:
    sys.path.insert(0, BACKEND_DIR_STR)

try:
    from db_utils import resolve_marketflow_db
    from services.data_contract import artifact_path, output_root
except Exception:
    def resolve_marketflow_db(*_args, **_kwargs):
        return str((BACKEND_DIR.parent / 'data' / 'marketflow.db').resolve())

    def artifact_path(relative_path: str):
        rel = str(relative_path).replace('\\', '/').strip('/')
        return (BACKEND_DIR / 'output' / rel).resolve()

    def output_root():
        return (BACKEND_DIR / 'output').resolve()


def norm_date(value: str) -> str:
    value = str(value).strip()
    if '/' in value:
        parts = value.split('/')
        return f"{int(parts[2]):04d}-{int(parts[0]):02d}-{int(parts[1]):02d}"
    return value


def load_json(fname: str):
    path = artifact_path(fname)
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as f:
        return json.load(f)


DB = resolve_marketflow_db(required_tables=('ticker_history_daily',), data_plane='snapshot')
OUT_DIR = str(output_root())
os.makedirs(OUT_DIR, exist_ok=True)


# 1. QQQ + TQQQ price data
con = sqlite3.connect(DB)
cur = con.cursor()

cur.execute("SELECT date, close FROM ticker_history_daily WHERE symbol='QQQ'")
qqq_raw_all = sorted([(norm_date(row[0]), float(row[1])) for row in cur.fetchall()])

cur.execute("SELECT date, close FROM ticker_history_daily WHERE symbol='TQQQ'")
tqqq_raw_all = sorted([(norm_date(row[0]), float(row[1])) for row in cur.fetchall()])

con.close()

qqq_map = {d: c for d, c in qqq_raw_all}
tqqq_map = {d: c for d, c in tqqq_raw_all}

all_dates = sorted(qqq_map.keys())
qqq_cl = [qqq_map[d] for d in all_dates]
tqqq_cl = [tqqq_map.get(d) for d in all_dates]
n = len(all_dates)


# 2. Pre-compute rolling indicators
ma50_arr = [None] * n
ma200_arr = [None] * n
qqq_dd = [0.0] * n
tqqq_dd = [0.0] * n

qqq_peak = 0.0
tqqq_peak = 0.0

for i in range(n):
    if i >= 49:
        ma50_arr[i] = sum(qqq_cl[i - 49 : i + 1]) / 50
    if i >= 199:
        ma200_arr[i] = sum(qqq_cl[i - 199 : i + 1]) / 200

    qqq_peak = max(qqq_peak, qqq_cl[i])
    qqq_dd[i] = round((qqq_cl[i] / qqq_peak - 1) * 100, 2)
    if tqqq_cl[i] is not None:
        tqqq_peak = max(tqqq_peak, tqqq_cl[i])
        tqqq_dd[i] = round((tqqq_cl[i] / tqqq_peak - 1) * 100, 2)
    else:
        tqqq_dd[i] = None


# 3. Last 90 trading days
WIN = 90
disp_start = max(0, n - WIN)
disp_idx = list(range(disp_start, n))
base_qqq = qqq_cl[disp_start]


# 4. Read latest history from JSON artifacts
rv1_data = load_json('risk_v1.json')
vr_data = load_json('vr_survival.json')

rv1_hist = {item['date']: item for item in (rv1_data.get('history', []) if rv1_data else [])}
vr_hist = {item['date']: item for item in (vr_data.get('history', []) if vr_data else [])}


# 5. Build risk_v1 playback
rv1_pb = []
for i in disp_idx:
    d = all_dates[i]
    q = qqq_cl[i]
    m5 = ma50_arr[i]
    m200 = ma200_arr[i]

    qqq_n = round(q / base_qqq * 100, 2)
    ma50_n = round(m5 / base_qqq * 100, 2) if m5 else None
    ma200_n = round(m200 / base_qqq * 100, 2) if m200 else None

    h = rv1_hist.get(d, {})
    rv1_pb.append(
        {
            'd': d,
            'qqq_n': qqq_n,
            'ma50_n': ma50_n,
            'ma200_n': ma200_n,
            'dd': qqq_dd[i],
            'tqqq_dd': tqqq_dd[i],
            'score': h.get('score'),
            'level': h.get('level', 0),
            'event_type': h.get('event_type', 'Normal'),
            'in_ev': False,
        }
    )


# 6. Build vr_survival playback
vr_pb = []
bh_val = 10_000.0
vr_val = 10_000.0
prev_tc = next((tqqq_cl[i] for i in disp_idx if tqqq_cl[i] is not None), None)

for pos, i in enumerate(disp_idx):
    d = all_dates[i]
    qc = qqq_cl[i]
    tc = tqqq_cl[i]
    m5 = ma50_arr[i]
    m200 = ma200_arr[i]

    qqq_n = round(qc / base_qqq * 100, 2)
    ma50_n = round(m5 / base_qqq * 100, 2) if m5 else None
    ma200_n = round(m200 / base_qqq * 100, 2) if m200 else None

    h = vr_hist.get(d, {})
    exposure_pct = h.get('exposure_pct', 100.0)
    pool_pct = h.get('pool_pct', 0.0)
    score = h.get('score')
    level = h.get('level', 0)
    state = h.get('state', 'NORMAL')

    if pos > 0 and tc is not None and prev_tc is not None:
        tqqq_ret = (tc / prev_tc) - 1.0
        bh_val = bh_val * (1.0 + tqqq_ret)
        vr_val = vr_val * (1.0 + (exposure_pct / 100.0) * tqqq_ret)
    if tc is not None:
        prev_tc = tc

    vr_pb.append(
        {
            'd': d,
            'qqq_n': qqq_n,
            'ma50_n': ma50_n,
            'ma200_n': ma200_n,
            'dd_pct': qqq_dd[i],
            'score': score,
            'level': level,
            'state': state,
            'pool_pct': pool_pct,
            'exposure_pct': exposure_pct,
            'bh_10k': round(bh_val),
            'vr_10k': round(vr_val),
            'in_ev': False,
        }
    )


# 7. Write output
output = {
    'generated': datetime.now().strftime('%Y-%m-%d %H:%M'),
    'window_start': all_dates[disp_start],
    'window_end': all_dates[-1],
    'trading_days': len(disp_idx),
    'risk_v1': {'playback': rv1_pb},
    'vr_survival': {'playback': vr_pb},
}

out_path = artifact_path('current_90d.json')
os.makedirs(str(out_path.parent), exist_ok=True)
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False)

print(f'Window : {output["window_start"]} -> {output["window_end"]} ({len(disp_idx)} days)')
print(f'Written: {out_path}')
print(f'rv1_pb : {len(rv1_pb)} rows')
print(f'vr_pb  : {len(vr_pb)} rows')
last = vr_pb[-1]
print(f'VR last: bh={last["bh_10k"]:,}  vr={last["vr_10k"]:,}  state={last["state"]}  pool={last["pool_pct"]}%')
