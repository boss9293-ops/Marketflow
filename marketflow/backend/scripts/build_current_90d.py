"""
build_current_90d.py
--------------------
현재 시점 기준 90 거래일 playback 데이터 생성.
  - ticker_history_daily에서 QQQ / TQQQ 읽어 MA50/MA200/DD 계산
  - risk_v1.json / vr_survival.json history에서 score/level/state/pool_pct 읽어 merge
  - VR: TQQQ 일별 수익률 × exposure_pct 로 bh_10k / vr_10k 시뮬레이션
  - 출력: backend/output/current_90d.json
"""
import sqlite3, json, os
from datetime import datetime

def norm_date(d):
    d = str(d).strip()
    if '/' in d:
        p = d.split('/')
        return f"{int(p[2]):04d}-{int(p[0]):02d}-{int(p[1]):02d}"
    return d

# ─── paths ───────────────────────────────────────────────────────────────────
_HERE   = os.path.dirname(os.path.abspath(__file__))
_BACK   = os.path.dirname(_HERE)
DB      = os.path.abspath(os.path.join(_BACK, 'data', 'marketflow.db'))
OUT_DIR = os.path.join(_BACK, 'output')

# ─── 1. QQQ + TQQQ price data (ALL — MA200 needs full history) ───────────────
con = sqlite3.connect(DB)
cur = con.cursor()

# Fetch ALL rows — DB has mixed date formats (YYYY-MM-DD and M/D/YYYY)
# Use ALL data for MA computation, display only last 90 days
cur.execute("SELECT date, close FROM ticker_history_daily WHERE symbol='QQQ'")
qqq_raw_all = sorted([(norm_date(r[0]), float(r[1])) for r in cur.fetchall()])

cur.execute("SELECT date, close FROM ticker_history_daily WHERE symbol='TQQQ'")
tqqq_raw_all = sorted([(norm_date(r[0]), float(r[1])) for r in cur.fetchall()])

con.close()

# Use ALL common dates (TQQQ goes back to 2010, ensures MA200 always available)
qqq_map  = {d: c for d, c in qqq_raw_all}
tqqq_map = {d: c for d, c in tqqq_raw_all}

# Use ALL QQQ dates (QQQ has full history); TQQQ is optional per date
all_dates = sorted(qqq_map.keys())
qqq_cl    = [qqq_map[d]          for d in all_dates]
tqqq_cl   = [tqqq_map.get(d)     for d in all_dates]  # None where TQQQ missing
n         = len(all_dates)

# ─── 2. Pre-compute MA50, MA200, rolling peak DD ─────────────────────────────
ma50_arr  = [None] * n
ma200_arr = [None] * n
qqq_dd    = [0.0]  * n
tqqq_dd   = [0.0]  * n

qqq_peak  = 0.0
tqqq_peak = 0.0

for i in range(n):
    if i >= 49:
        ma50_arr[i]  = sum(qqq_cl[i-49:i+1]) / 50
    if i >= 199:
        ma200_arr[i] = sum(qqq_cl[i-199:i+1]) / 200

    qqq_peak  = max(qqq_peak,  qqq_cl[i])
    qqq_dd[i]  = round((qqq_cl[i]  / qqq_peak  - 1) * 100, 2)
    if tqqq_cl[i] is not None:
        tqqq_peak  = max(tqqq_peak, tqqq_cl[i])
        tqqq_dd[i] = round((tqqq_cl[i] / tqqq_peak - 1) * 100, 2)
    else:
        tqqq_dd[i] = None

# 3. Display window: last 90 trading days
WIN = 90
disp_start = max(0, n - WIN)
disp_idx = list(range(disp_start, n))
base_qqq = qqq_cl[disp_start]  # normalize base

# ─── 4. Read history from JSON outputs ───────────────────────────────────────
def load_json(fname):
    p = os.path.join(OUT_DIR, fname)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None

rv1_data = load_json('risk_v1.json')
vr_data  = load_json('vr_survival.json')

rv1_hist = {h['date']: h for h in (rv1_data.get('history', []) if rv1_data else [])}
vr_hist  = {h['date']: h for h in (vr_data.get('history',  []) if vr_data  else [])}

# ─── 5. Build risk_v1 playback ───────────────────────────────────────────────
rv1_pb = []
for i in disp_idx:
    d = all_dates[i]
    q  = qqq_cl[i]
    m5  = ma50_arr[i]
    m200 = ma200_arr[i]

    qqq_n   = round(q        / base_qqq * 100, 2)
    ma50_n  = round(m5       / base_qqq * 100, 2) if m5   else None
    ma200_n = round(m200     / base_qqq * 100, 2) if m200 else None

    h = rv1_hist.get(d, {})
    rv1_pb.append({
        'd':         d,
        'qqq_n':     qqq_n,
        'ma50_n':    ma50_n,
        'ma200_n':   ma200_n,
        'dd':        qqq_dd[i],
        'tqqq_dd':   tqqq_dd[i],
        'score':     h.get('score'),
        'level':     h.get('level', 0),
        'event_type':h.get('event_type', 'Normal'),
        'in_ev':     False,
    })

# ─── 6. Build vr_survival playback (with bh_10k / vr_10k simulation) ─────────
vr_pb   = []
bh_val  = 10_000.0
vr_val  = 10_000.0
# Find first available TQQQ price in display window
prev_tc = next((tqqq_cl[i] for i in disp_idx if tqqq_cl[i] is not None), None)

for pos, i in enumerate(disp_idx):
    d   = all_dates[i]
    qc  = qqq_cl[i]
    tc  = tqqq_cl[i]
    m5  = ma50_arr[i]
    m200 = ma200_arr[i]

    qqq_n   = round(qc        / base_qqq * 100, 2)
    ma50_n  = round(m5        / base_qqq * 100, 2) if m5   else None
    ma200_n = round(m200      / base_qqq * 100, 2) if m200 else None

    h            = vr_hist.get(d, {})
    exposure_pct = h.get('exposure_pct', 100.0)
    pool_pct     = h.get('pool_pct',     0.0)
    score        = h.get('score')
    level        = h.get('level', 0)
    state        = h.get('state', 'NORMAL')

    if pos > 0 and tc is not None and prev_tc is not None:
        tqqq_ret = (tc / prev_tc) - 1.0
        bh_val   = bh_val * (1.0 + tqqq_ret)
        vr_val   = vr_val * (1.0 + (exposure_pct / 100.0) * tqqq_ret)
    if tc is not None:
        prev_tc = tc

    vr_pb.append({
        'd':            d,
        'qqq_n':        qqq_n,
        'ma50_n':       ma50_n,
        'ma200_n':      ma200_n,
        'dd_pct':       qqq_dd[i],
        'score':        score,
        'level':        level,
        'state':        state,
        'pool_pct':     pool_pct,
        'exposure_pct': exposure_pct,
        'bh_10k':       round(bh_val),
        'vr_10k':       round(vr_val),
        'in_ev':        False,
    })

# ─── 7. Write output ─────────────────────────────────────────────────────────
output = {
    'generated':    datetime.now().strftime('%Y-%m-%d %H:%M'),
    'window_start': all_dates[disp_start],
    'window_end':   all_dates[-1],
    'trading_days': len(disp_idx),
    'risk_v1':      {'playback': rv1_pb},
    'vr_survival':  {'playback': vr_pb},
}

out_path = os.path.join(OUT_DIR, 'current_90d.json')
json.dump(output, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)

print(f'Window : {output["window_start"]} → {output["window_end"]} ({len(disp_idx)} days)')
print(f'Written: {out_path}')
print(f'rv1_pb : {len(rv1_pb)} rows')
print(f'vr_pb  : {len(vr_pb)} rows')
# Quick sanity check
last = vr_pb[-1]
print(f'VR last: bh={last["bh_10k"]:,}  vr={last["vr_10k"]:,}  state={last["state"]}  pool={last["pool_pct"]}%')
