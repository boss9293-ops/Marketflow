# -*- coding: utf-8 -*-
"""
VR Leverage Survival System v2
- Layer A: Macro Risk Score (0-100) — same 4-component as risk_v1
- Layer B: Event-Type State Machine (NORMAL / SHOCK / STRUCTURAL / GRINDING)
- Layer C: Pool Allocation Control (0/25/50/75/100%)
- Layer D: Re-Entry Discipline (staged 25→50→75→100%)
- Backtest: B&H TQQQ vs VR Strategy TQQQ (2010+)
"""
import sqlite3, json, os, sys, math
from datetime import datetime
from collections import deque

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_SCRIPTS_DIR)
try:
    from db_utils import resolve_marketflow_db
    DB_MAIN = resolve_marketflow_db(required_tables=('ticker_history_daily',), data_plane='snapshot')
except Exception:
    DB_MAIN = os.path.join(_BACKEND_DIR, 'data', 'marketflow.db')
OUT_DIR = os.path.join(_BACKEND_DIR, 'output')
os.makedirs(OUT_DIR, exist_ok=True)

def sf(v):
    if v is None or (isinstance(v, float) and math.isnan(v)): return None
    return float(v)

def norm_date(d):
    """Normalize M/D/YYYY or M/D/YY to YYYY-MM-DD; pass through YYYY-MM-DD unchanged."""
    if '-' in d and len(d) == 10: return d  # already YYYY-MM-DD
    try:
        parts = d.split('/')
        if len(parts) == 3:
            m, day, yr = int(parts[0]), int(parts[1]), int(parts[2])
            if yr < 100: yr += 2000
            return f'{yr:04d}-{m:02d}-{day:02d}'
    except Exception:
        pass
    return d

# ── Load data ─────────────────────────────────────────────────────────────────
con = sqlite3.connect(DB_MAIN)
cur = con.cursor()
cur.execute("SELECT date, close FROM ticker_history_daily WHERE symbol='QQQ'  AND close IS NOT NULL ORDER BY date")
qqq_rows = cur.fetchall()
cur.execute("SELECT date, close FROM ticker_history_daily WHERE symbol='TQQQ' AND close IS NOT NULL ORDER BY date")
tqqq_rows = cur.fetchall()

# Fallback to ohlcv_daily if ticker_history_daily is empty
if not qqq_rows:
    cur.execute("SELECT date, close FROM ohlcv_daily WHERE symbol='QQQ'  AND close IS NOT NULL ORDER BY date")
    qqq_rows = cur.fetchall()
if not tqqq_rows:
    cur.execute("SELECT date, close FROM ohlcv_daily WHERE symbol='TQQQ' AND close IS NOT NULL ORDER BY date")
    tqqq_rows = cur.fetchall()

con.close()

if not qqq_rows:
    print("[ERROR] No QQQ price data found in DB — cannot build vr_survival.json", flush=True)
    import sys; sys.exit(1)

qqq_prices  = {norm_date(r[0]): r[1] for r in qqq_rows}
tqqq_prices = {norm_date(r[0]): r[1] for r in tqqq_rows}
qqq_dates   = sorted(qqq_prices.keys())
print(f"QQQ: {len(qqq_dates)} rows  TQQQ: {len(tqqq_rows)} rows")

# ── Rolling helpers ───────────────────────────────────────────────────────────
def rmean(buf): return sum(buf)/len(buf) if buf else None
def rstd(buf):
    if len(buf) < 2: return None
    m = rmean(buf)
    return math.sqrt(sum((x-m)**2 for x in buf)/len(buf))
def pct_of(val, buf):
    if not buf or val is None: return 50.0
    return sum(1 for x in buf if x <= val)/len(buf)*100

# ── Layer A: compute base indicators for every QQQ date ──────────────────────
p50 = deque(maxlen=50); p200 = deque(maxlen=200); p20 = deque(maxlen=20)
vol_hist = deque(maxlen=252)
rolling_peak = 0.0

records = []  # one per QQQ date

for i, date in enumerate(qqq_dates):
    p = qqq_prices[date]
    p50.append(p); p200.append(p); p20.append(p)

    ma50  = rmean(p50)  if len(p50)  >= 50  else None
    ma200 = rmean(p200) if len(p200) >= 200 else None

    # Daily return
    daily_ret = (p/qqq_prices[qqq_dates[i-1]] - 1) if i > 0 else 0.0

    # 20d realized vol (annualised)
    if len(p20) >= 20:
        pl = list(p20)
        rets = [(pl[j]-pl[j-1])/pl[j-1] for j in range(1, len(pl))]
        vol20 = rstd(rets) * math.sqrt(252) * 100
    else:
        vol20 = None
    if vol20 is not None: vol_hist.append(vol20)
    vol_pct = pct_of(vol20, list(vol_hist))

    # Rolling drawdown from peak
    if p > rolling_peak: rolling_peak = p
    dd_pct = (p - rolling_peak)/rolling_peak*100 if rolling_peak > 0 else 0.0

    ret_3d = (p/qqq_prices[qqq_dates[i-3]] - 1)*100 if i >= 3 else None
    ret_5d = (p/qqq_prices[qqq_dates[i-5]] - 1)*100 if i >= 5 else None

    # Score components (0-100)
    trend_s = 40 if (ma200 and p < ma200) else 0
    depth_s = min(20, (ma200-p)/ma200*100/30*20) if (ma200 and p < ma200) else 0
    vol_s   = vol_pct/100*20
    dd_s    = min(20, abs(min(0, dd_pct))/30*20)
    score   = min(100, round(trend_s+depth_s+vol_s+dd_s, 1))

    if score < 30:   level = 0
    elif score < 50: level = 1
    elif score < 70: level = 2
    elif score < 85: level = 3
    else:            level = 4

    records.append({
        'date': date, 'price': p, 'ma50': ma50, 'ma200': ma200,
        'vol20': vol20, 'vol_pct': vol_pct, 'dd_pct': dd_pct,
        'ret_3d': ret_3d, 'ret_5d': ret_5d, 'score': score, 'level': level,
        'trend_s': trend_s, 'depth_s': depth_s, 'vol_s': vol_s, 'dd_s': dd_s,
    })

print(f"Base indicators computed: {len(records)} records")

# ── Layer B+C+D: State Machine + Pool ─────────────────────────────────────────
POOL_BY_LEVEL = {0: 0, 1: 25, 2: 50, 3: 75, 4: 100}
STAGE_POOL    = {0: 100, 1: 75, 2: 50, 3: 25, 4: 0}  # shock re-entry stages

state            = 'NORMAL'
shock_cooldown   = 0   # days remaining in hard lock
shock_stage      = 0   # 0=locked, 1-4=staged re-entry (0=none if not in SHOCK)
shock_stage_days = 0
days_above_ma200 = 0
days_below_ma200 = 0

# Track B — Structural state (WO60-B hybrid scoring)
structural_state    = 'NONE'
crash_ep_start      = None   # date when crash episode began
crash_ep_days       = 0
stress_start_date   = None
sustained_improve   = 0      # days of continuous structural improvement
tqqq_peak           = 0.0    # rolling TQQQ ATH for drawdown calc

sm_records = []  # extended records with state machine output

for rec in records:
    p      = rec['price']
    ma50   = rec['ma50']
    ma200  = rec['ma200']
    vol_pct= rec['vol_pct']
    ret_3d = rec['ret_3d']
    ret_5d = rec['ret_5d']
    level  = rec['level']

    # Update MA200 day counters
    if ma200 is not None:
        if p > ma200: days_above_ma200 += 1; days_below_ma200 = 0
        else:         days_below_ma200 += 1; days_above_ma200 = 0
    else:
        days_below_ma200 = 0; days_above_ma200 = 0

    # ── Shock trigger (highest priority) ────────────────────────────────────
    shock_trigger = False
    if ret_5d is not None and ret_5d <= -8:
        shock_trigger = True
    if ret_3d is not None and ret_3d <= -5 and vol_pct >= 80:
        shock_trigger = True

    if shock_trigger:
        state            = 'SHOCK'
        shock_cooldown   = 5
        shock_stage      = 0
        shock_stage_days = 0
        pool_pct         = 100.0

    elif state == 'SHOCK':
        if shock_cooldown > 0:
            shock_cooldown -= 1
            pool_pct = 100.0
        else:
            shock_stage_days += 1
            # Progress through staged re-entry
            if shock_stage == 0:
                # Gate: price above MA50 AND vol < 75%
                if ma50 is not None and p > ma50 and vol_pct < 75:
                    shock_stage = 1; shock_stage_days = 1
                pool_pct = 100.0
            elif shock_stage == 1:
                pool_pct = 75.0   # exposure 25%
                if shock_stage_days >= 5 and vol_pct < 60:
                    shock_stage = 2; shock_stage_days = 0
            elif shock_stage == 2:
                pool_pct = 50.0   # exposure 50%
                if shock_stage_days >= 5 and vol_pct < 50:
                    shock_stage = 3; shock_stage_days = 0
            elif shock_stage == 3:
                pool_pct = 25.0   # exposure 75%
                if shock_stage_days >= 5 and ma200 is not None and p > ma200:
                    shock_stage = 4; state = 'NORMAL'
                    pool_pct = float(POOL_BY_LEVEL[level])
            elif shock_stage == 4:
                state = 'NORMAL'
                pool_pct = float(POOL_BY_LEVEL[level])

    elif state == 'STRUCTURAL':
        pool_pct = 75.0   # exposure cap 25%
        # Release: above MA200 ≥10 days AND vol < 60%
        if days_above_ma200 >= 10 and vol_pct < 60:
            state = 'NORMAL'
            pool_pct = float(POOL_BY_LEVEL[level])

    elif state == 'GRINDING':
        pool_pct = 50.0   # exposure cap 50%
        # Release: above MA200 ≥5 days
        if days_above_ma200 >= 5:
            state = 'NORMAL'
            pool_pct = float(POOL_BY_LEVEL[level])

    else:  # NORMAL
        # Check if structural conditions met
        if days_below_ma200 >= 10 and rec['dd_pct'] <= -15:
            state = 'STRUCTURAL'; pool_pct = 75.0
        # Check grinding
        elif days_below_ma200 >= 40 and 25 < vol_pct < 70:
            state = 'GRINDING'; pool_pct = 50.0
        else:
            pool_pct = float(POOL_BY_LEVEL[level])

    exposure_pct = 100.0 - pool_pct

    # Explanatory line
    if state == 'SHOCK' and shock_cooldown > 0:
        explain = f"Shock lock active. Hard exit — {shock_cooldown} trading day cooldown remaining. No re-entry until conditions clear."
    elif state == 'SHOCK' and shock_stage < 4:
        explain = f"Shock re-entry stage {shock_stage}/3. Staged exposure restoration: {int(exposure_pct)}% deployed. Waiting for vol normalization."
    elif state == 'STRUCTURAL':
        explain = f"Structural lock active. Exposure capped at 25% until MA200 recovery stabilizes ({days_above_ma200}/10 days above MA200, vol {vol_pct:.0f}th pct)."
    elif state == 'GRINDING':
        explain = f"Grinding environment detected. Exposure capped at 50%. {days_below_ma200} days below MA200 — patience required."
    elif level >= 2:
        explain = f"Elevated risk environment. Score {rec['score']:.0f} — pool increased to {int(pool_pct)}% as a precautionary measure."
    elif level == 1:
        explain = f"Caution zone. Score {rec['score']:.0f} — partial pool ({int(pool_pct)}%) maintained. Environment suggests monitoring."
    else:
        explain = f"Normal environment. Score {rec['score']:.0f} — full deployment. Historical pattern indicates low structural risk."

    # ── Track B: Structural State (WO60-B logic) ──────────────────────────
    tqqq_price = tqqq_prices.get(rec['date'])
    if tqqq_price and tqqq_price > tqqq_peak:
        tqqq_peak = tqqq_price
    tqqq_dd_live = (tqqq_price / tqqq_peak - 1) * 100 if (tqqq_price and tqqq_peak > 0) else 0.0

    # Episode: active when event state is not NORMAL
    is_crash_episode = (state != 'NORMAL')
    if is_crash_episode and crash_ep_start is None:
        crash_ep_start = rec['date']; crash_ep_days = 0
    elif not is_crash_episode and crash_ep_start is not None:
        crash_ep_start = None; crash_ep_days = 0
        structural_state = 'NONE'; stress_start_date = None; sustained_improve = 0

    # Macro flags (VR score 0-100, higher=worse)
    vr_s = rec['score']; vr_lvl = rec['level']
    liquidity_tight    = vr_s >= 30
    credit_stress      = vr_s >= 50
    financial_tight    = vr_s >= 70
    growth_scare       = vr_lvl >= 3
    policy_pressure    = (ma50 is not None) and (p < ma50)
    macro_s = sum([liquidity_tight, credit_stress, financial_tight, growth_scare, policy_pressure])

    # Internal flags
    breadth_weak    = (ma200 is not None) and (p < ma200)
    rebound_fail    = crash_ep_days > 30
    trend_broken    = (ma200 is not None) and (p < ma200 * 0.97)
    vol_persistent  = tqqq_dd_live < -15
    leverage_weak   = tqqq_dd_live < -30
    internal_s = sum([breadth_weak, rebound_fail, trend_broken, vol_persistent, leverage_weak])

    # dd10 approximation from ret_5d * 2 (available in records)
    dd10_approx = (rec.get('ret_5d') or 0) / 50.0  # rough proxy (ret_5d is %, divide by 50 -> ratio)

    # Persistence score
    pers_s = sum([
        crash_ep_start is not None,
        crash_ep_days > 20,
        crash_ep_days > 40,
        crash_ep_days > 60,
        dd10_approx < -0.08,
    ])

    # AI assessment (rule-based)
    total_s = macro_s + internal_s + pers_s
    if total_s >= 12 or (macro_s >= 4 and internal_s >= 4):
        ai_assess = 'structural_crash_candidate'
    elif total_s >= 8 or (macro_s >= 3 and internal_s >= 3):
        ai_assess = 'structural_deterioration'
    elif total_s >= 5 or pers_s >= 3:
        ai_assess = 'persistent_stress'
    else:
        ai_assess = 'temporary_shock'

    prev_structural = structural_state
    if is_crash_episode:
        crash_ep_days += 1
        if structural_state == 'NONE':
            if pers_s >= 3 and (macro_s >= 2 or internal_s >= 3 or ai_assess == 'persistent_stress'):
                structural_state = 'STRUCTURAL_WATCH'; sustained_improve = 0
        elif structural_state == 'STRUCTURAL_WATCH':
            if pers_s >= 3 and ((macro_s >= 3 and internal_s >= 3) or (ai_assess == 'structural_deterioration' and macro_s >= 3)):
                structural_state = 'STRUCTURAL_STRESS'; stress_start_date = rec['date']; sustained_improve = 0
        elif structural_state == 'STRUCTURAL_STRESS':
            ath_dd_approx = rec.get('dd_pct', 0) / 100.0
            severe = ath_dd_approx < -0.30 or tqqq_dd_live < -30
            if severe and pers_s >= 4 and ((macro_s >= 4 and internal_s >= 3) or (ai_assess == 'structural_crash_candidate' and macro_s >= 4)):
                structural_state = 'STRUCTURAL_CRASH'; sustained_improve = 0

    # Downgrade (15-day sustained improvement window)
    improving = (macro_s <= 1 and internal_s <= 2 and not is_crash_episode and
                 ai_assess in ('temporary_shock', 'persistent_stress'))
    if improving and structural_state != 'NONE':
        sustained_improve += 1
        if sustained_improve >= 15:
            if   structural_state == 'STRUCTURAL_CRASH':  structural_state = 'STRUCTURAL_STRESS'
            elif structural_state == 'STRUCTURAL_STRESS': structural_state = 'STRUCTURAL_WATCH'
            elif structural_state == 'STRUCTURAL_WATCH':  structural_state = 'NONE'
            sustained_improve = 0
    elif not improving and not is_crash_episode:
        sustained_improve = 0

    sm_rec = {**rec,
        'state': state, 'pool_pct': pool_pct, 'exposure_pct': exposure_pct,
        'shock_stage': shock_stage, 'shock_cooldown': shock_cooldown,
        'days_above_ma200': days_above_ma200, 'days_below_ma200': days_below_ma200,
        'explain': explain,
        'structural_state': structural_state,
        'macro_score': macro_s,
        'internal_score': internal_s,
        'persistence_score': pers_s,
        'ai_assessment': ai_assess,
    }
    sm_records.append(sm_rec)

print(f"State machine complete. Final state: {sm_records[-1]['state']}, pool: {sm_records[-1]['pool_pct']}%")

# ── Backtest: B&H TQQQ vs VR Strategy (TQQQ era) ─────────────────────────────
rec_map         = {r['date']: r for r in sm_records}
tqqq_dates_sorted = sorted(tqqq_prices.keys())

bh_val     = 100.0
strat_val  = 100.0
prev_tqqq  = None

backtest_curve = []

for date in tqqq_dates_sorted:
    tp  = tqqq_prices[date]
    rec = rec_map.get(date)

    if prev_tqqq is not None and rec is not None:
        tret = (tp - prev_tqqq) / prev_tqqq
        bh_val   *= (1 + tret)
        strat_val *= (1 + tret * rec['exposure_pct'] / 100)

    prev_tqqq = tp

    backtest_curve.append({
        'date':     date,
        'bh':       round(bh_val, 2),
        'strat':    round(strat_val, 2),
        'pool_pct': rec['pool_pct'] if rec else 0,
        'state':    rec['state']    if rec else 'NORMAL',
    })

print(f"Backtest curve: {len(backtest_curve)} points")

# ── Stats helper ──────────────────────────────────────────────────────────────
def compute_stats(key, curve):
    vals   = [p[key] for p in curve]
    n_yr   = len(curve) / 252
    total  = (vals[-1]/vals[0] - 1)*100
    ann    = ((vals[-1]/vals[0])**(1/n_yr) - 1)*100
    peak   = vals[0]; mdd = 0.0
    ul_sum = 0.0
    for v in vals:
        if v > peak: peak = v
        dd = (v-peak)/peak*100
        if dd < mdd: mdd = dd
        ul_sum += dd**2
    ulcer   = math.sqrt(ul_sum / len(vals))
    calmar  = ann / abs(mdd) if mdd != 0 else None
    return {'total_return': round(total,1), 'ann_return': round(ann,2),
            'max_drawdown': round(mdd,2), 'calmar': round(calmar,2) if calmar else None,
            'ulcer_index': round(ulcer,2)}

bh_stats   = compute_stats('bh',    backtest_curve)
st_stats   = compute_stats('strat', backtest_curve)
days_in_pool = sum(1 for p in backtest_curve if (p['pool_pct'] or 0) > 0)
shock_days   = sum(1 for p in backtest_curve if p.get('state') == 'SHOCK')
struct_days  = sum(1 for p in backtest_curve if p.get('state') == 'STRUCTURAL')
grind_days   = sum(1 for p in backtest_curve if p.get('state') == 'GRINDING')
total_days   = len(backtest_curve)

backtest = {
    'start_date': tqqq_dates_sorted[0],
    'end_date':   tqqq_dates_sorted[-1],
    'years':      round(total_days/252, 1),
    'bh':         bh_stats,
    'strategy':   st_stats,
    'days_in_pool':  days_in_pool,
    'cash_pct':      round(days_in_pool/total_days*100, 1),
    'shock_days':    shock_days,
    'structural_days': struct_days,
    'grinding_days': grind_days,
    'total_days':    total_days,
    'sell_rule':  'Pool increases at trigger: Shock→100%, Structural→75%, Grinding→50%',
    'buy_rule':   'Staged re-entry 25%→50%→75%→100% after shock cooldown and conditions clear',
}

print(f"B&H TQQQ: CAGR {bh_stats['ann_return']:.1f}%, MaxDD {bh_stats['max_drawdown']:.1f}%, Ulcer {bh_stats['ulcer_index']:.1f}")
print(f"VR Strat: CAGR {st_stats['ann_return']:.1f}%, MaxDD {st_stats['max_drawdown']:.1f}%, Ulcer {st_stats['ulcer_index']:.1f}")

# ── Event detection (from sm_records, score >= 50) ────────────────────────────
MERGE_DAYS = 60
events     = []
in_event   = False
ev_si      = None

for i, r in enumerate(sm_records):
    if not in_event and r['level'] >= 2:
        in_event = True; ev_si = i
    elif in_event and r['level'] <= 0:
        ev_recs  = sm_records[ev_si:i+1]
        pk       = max(ev_recs, key=lambda x: x['score'])
        events.append({'si': ev_si, 'ei': i, 'start': sm_records[ev_si]['date'],
                       'end': r['date'], 'peak_score': round(pk['score'],1),
                       'peak_level': pk['level'], 'peak_state': pk['state'],
                       'duration_days': i-ev_si+1})
        in_event = False

if in_event:
    i = len(sm_records)-1
    ev_recs = sm_records[ev_si:]
    pk = max(ev_recs, key=lambda x: x['score'])
    events.append({'si': ev_si, 'ei': i, 'start': sm_records[ev_si]['date'],
                   'end': sm_records[i]['date'], 'peak_score': round(pk['score'],1),
                   'peak_level': pk['level'], 'peak_state': pk['state'],
                   'duration_days': i-ev_si+1, 'ongoing': True})

# Merge
merged = []
for ev in sorted(events, key=lambda e: e['start']):
    if merged and (datetime.strptime(ev['start'],'%Y-%m-%d') -
                   datetime.strptime(merged[-1]['end'],'%Y-%m-%d')).days <= MERGE_DAYS:
        p = merged[-1]
        p['end'] = ev['end']; p['ei'] = ev['ei']
        p['peak_score'] = max(p['peak_score'], ev['peak_score'])
        p['peak_level'] = max(p['peak_level'], ev['peak_level'])
        p['duration_days'] = p['ei'] - p['si'] + 1
        if ev.get('ongoing'): p['ongoing'] = True
    else:
        merged.append(dict(ev))
events = merged

# Enrich events
EVENT_NAMES = {
    ('2010-04','2010-10'): 'Flash Crash / Mid-2010 Correction',
    ('2011-07','2011-10'): 'US Debt Ceiling / Euro Crisis',
    ('2015-08','2016-02'): 'China Devaluation / Oil Crash',
    ('2018-02','2018-04'): 'Volmageddon / Rate Shock',
    ('2018-10','2019-01'): 'Q4 2018 Rate Crash',
    ('2020-02','2020-04'): 'COVID-19 Crash',
    ('2021-11','2022-01'): 'Omicron / Tapering',
    ('2022-01','2022-10'): '2022 Rate Hike Bear Market',
    ('2023-01','2023-04'): 'SVB Banking Crisis',
    ('2025-01','2025-12'): 'Market Stress 2025',
}
def auto_name(ev):
    ms = ev['start'][:7]; me = ev['end'][:7]
    for (ks,ke), nm in EVENT_NAMES.items():
        if ms >= ks and me <= ke: return nm
    return f"{ev['start'][:7]} Risk Event"

for idx, ev in enumerate(events):
    ev['id']   = idx + 1
    ev['name'] = auto_name(ev)
    # QQQ DD during event
    ep = [sm_records[j]['price'] for j in range(ev['si'], ev['ei']+1)]
    ev['qqq_dd_pct'] = round((min(ep)-ep[0])/ep[0]*100, 2)
    # Capital preservation: VR strategy vs B&H at event end
    fwd_returns = {}
    for fd, fk in [(21,'fwd_1m'),(63,'fwd_3m'),(126,'fwd_6m')]:
        fi = ev['ei'] + fd
        if fi < len(sm_records):
            ep0 = sm_records[ev['ei']]['price']
            fv  = sm_records[fi]['price']
            fwd_returns[fk] = round((fv/ep0-1)*100, 2)
        else:
            fwd_returns[fk] = None
    ev.update(fwd_returns)

print(f"Events detected: {len(events)}")

# ── Per-event playback (separate lazy file) ───────────────────────────────────
PRE = 63; POST = 63
playback_events = []

for ev in events:
    si  = ev['si']; ei = ev['ei']
    pre = max(0, si-PRE); post = min(len(sm_records)-1, ei+POST)
    base_q = sm_records[pre]['price']
    base_t = tqqq_prices.get(sm_records[pre]['date'])

    # Simulate $10k from pre-event start
    init_eq_bh   = 10000.0
    init_eq_vr   = 10000.0
    prev_q = None; prev_t = None

    pts = []
    for j in range(pre, post+1):
        r2  = sm_records[j]
        q   = r2['price']
        t   = tqqq_prices.get(r2['date'])
        in_ev = r2['date'] >= ev['start'] and r2['date'] <= ev['end']

        # Normalized to 100 at pre-event start
        qqq_n   = round(q/base_q*100, 2)
        ma50_n  = round(r2['ma50']/base_q*100, 2) if r2['ma50'] else None
        ma200_n = round(r2['ma200']/base_q*100, 2) if r2['ma200'] else None

        # $10k simulation (running)
        if prev_q is not None:
            q_ret = (q-prev_q)/prev_q
            init_eq_bh *= (1 + q_ret)
            vr_exp = r2['exposure_pct']/100
            init_eq_vr *= (1 + q_ret * vr_exp)

        pts.append({
            'd': r2['date'],
            'qqq_n': qqq_n, 'ma50_n': ma50_n, 'ma200_n': ma200_n,
            'score': r2['score'], 'level': r2['level'],
            'state': r2['state'],
            'pool_pct': r2['pool_pct'], 'exposure_pct': r2['exposure_pct'],
            'bh_10k': round(init_eq_bh),
            'vr_10k': round(init_eq_vr),
            'in_ev': in_ev,
            'dd_pct': round(r2['dd_pct'], 2),
        })
        prev_q = q; prev_t = t

    # Detect shock/structural markers
    risk_on = None; risk_off = None; shock_dates = []; struct_dates = []
    prev_lv = None
    for pt in pts:
        if prev_lv is not None and prev_lv < 2 and pt['level'] >= 2 and risk_on is None:
            risk_on = pt['d']
        if prev_lv is not None and prev_lv >= 2 and pt['level'] < 2 and risk_on and risk_off is None:
            risk_off = pt['d']
        if pt['state'] == 'SHOCK':
            shock_dates.append(pt['d'])
        if pt['state'] == 'STRUCTURAL':
            struct_dates.append(pt['d'])
        prev_lv = pt['level']

    # Capital preserved stats
    bh_vals = [p['bh_10k'] for p in pts]
    vr_vals = [p['vr_10k'] for p in pts]
    min_bh  = min(bh_vals); min_vr = min(vr_vals)
    fin_bh  = bh_vals[-1];  fin_vr = vr_vals[-1]

    playback_events.append({
        'id': ev['id'], 'name': ev['name'],
        'start': ev['start'], 'end': ev['end'],
        'risk_on': risk_on, 'risk_off': risk_off,
        'shock_dates': shock_dates[:5],    # first 5 shock days
        'struct_dates': struct_dates[:5],
        'stats': {
            'bh_trough': round(min_bh), 'vr_trough': round(min_vr),
            'bh_final':  round(fin_bh), 'vr_final':  round(fin_vr),
            'capital_saved_pct': round((min_vr-min_bh)/10000*100, 1),
        },
        'playback': pts,
    })

print(f"Playback events: {len(playback_events)}")

# ── Current state ──────────────────────────────────────────────────────────────
cur_rec = sm_records[-1]
level_labels = {0:'Normal',1:'Caution',2:'Warning',3:'High Risk',4:'Crisis'}
is_active = cur_rec['state'] != 'NORMAL' or cur_rec['level'] >= 2

current = {
    'date':          cur_rec['date'],
    'score':         cur_rec['score'],
    'level':         cur_rec['level'],
    'level_label':   level_labels.get(cur_rec['level'], '?'),
    'state':         cur_rec['state'],
    'pool_pct':      cur_rec['pool_pct'],
    'exposure_pct':  cur_rec['exposure_pct'],
    'structural_state': cur_rec.get('structural_state', 'NONE'),
    'macro_score':   cur_rec.get('macro_score', 0),
    'internal_score': cur_rec.get('internal_score', 0),
    'persistence_score': cur_rec.get('persistence_score', 0),
    'survival_active': is_active,
    'explain':       cur_rec['explain'],
    'shock_stage':   cur_rec['shock_stage'],
    'shock_cooldown':cur_rec['shock_cooldown'],
    'days_above_ma200': cur_rec['days_above_ma200'],
    'days_below_ma200': cur_rec['days_below_ma200'],
    'price':         cur_rec['price'],
    'ma50':          cur_rec['ma50'],
    'ma200':         cur_rec['ma200'],
    'dd_pct':        cur_rec['dd_pct'],
    'vol_pct':       cur_rec['vol_pct'],
    'components': {
        'trend': cur_rec['trend_s'], 'depth': cur_rec['depth_s'],
        'vol':   cur_rec['vol_s'],   'dd':    cur_rec['dd_s'],
    },
}

# ── History 90d ───────────────────────────────────────────────────────────────
history = [{
    'date': r['date'], 'score': r['score'], 'level': r['level'],
    'state': r['state'], 'pool_pct': r['pool_pct'], 'exposure_pct': r['exposure_pct'],
    'structural_state': r.get('structural_state', 'NONE'),
} for r in sm_records[-90:]]

# ── Pool logic reference ───────────────────────────────────────────────────────
pool_logic = {
    'level_pools': [
        {'level': 0, 'label': 'Normal',    'pool': 0,   'exposure': 100, 'color': '#22c55e'},
        {'level': 1, 'label': 'Caution',   'pool': 25,  'exposure': 75,  'color': '#f59e0b'},
        {'level': 2, 'label': 'Warning',   'pool': 50,  'exposure': 50,  'color': '#f97316'},
        {'level': 3, 'label': 'High Risk', 'pool': 75,  'exposure': 25,  'color': '#ef4444'},
        {'level': 4, 'label': 'Crisis',    'pool': 100, 'exposure': 0,   'color': '#7c3aed'},
    ],
    'state_overrides': [
        {'state': 'SHOCK',      'pool': 100, 'desc': 'Full exit. Hard lock 5 trading days.'},
        {'state': 'STRUCTURAL', 'pool': 75,  'desc': 'Exposure cap 25%. Held until MA200 recovery.'},
        {'state': 'GRINDING',   'pool': 50,  'desc': 'Exposure cap 50%. Held until above MA200 ≥5 days.'},
    ],
    'reentry_stages': [
        {'stage': 1, 'pool': 75,  'exposure': 25,  'condition': 'Price > MA50 AND vol < 75th pct'},
        {'stage': 2, 'pool': 50,  'exposure': 50,  'condition': 'Vol < 60th pct (after 5 days at stage 1)'},
        {'stage': 3, 'pool': 25,  'exposure': 75,  'condition': 'Vol < 50th pct (after 5 days at stage 2)'},
        {'stage': 4, 'pool': 0,   'exposure': 100, 'condition': 'Price > MA200 (after 5 days at stage 3)'},
    ],
    'shock_trigger': {
        'condition_a': '5d return ≤ -8%',
        'condition_b': '3d return ≤ -5% AND vol percentile ≥ 80%',
        'cooldown': '5 trading days hard lock (no re-entry)',
    },
}

# ── Philosophy ─────────────────────────────────────────────────────────────────
philosophy = {
    'must_not': [
        'Predict bottom',
        'Chase rebounds',
        'Overtrade in grinding bear',
        'Use certainty language ("will", "guaranteed")',
        'Give financial advice',
    ],
    'must': [
        'Reduce exposure when risk accelerates',
        'Avoid full reinvestment during structural damage',
        'Protect against leverage decay (TQQQ volatility drag)',
        'Maintain pool discipline across all modes',
        'Apply staged re-entry — no aggressive reinstatement',
    ],
    'tone_examples': [
        '"Environment suggests elevated downside risk."',
        '"Historical pattern indicates structural deterioration."',
        '"Structural lock active. Exposure capped at 25% until MA200 recovery stabilizes."',
        '"Shock cooldown: 5 days hard lock. Re-entry requires price above MA50 and vol normalization."',
    ],
    'primary_goal': 'ACCOUNT SURVIVAL — capital preservation first, returns second.',
    'disclaimer': (
        'VR Survival System is a risk management framework — NOT financial advice. '
        'TQQQ is a 3x leveraged ETF with significant volatility decay risk. '
        'Past backtest performance does not guarantee future results. '
        'This system describes risk environment conditions to guide exposure decisions.'
    ),
}

# ── Clean events for main JSON ─────────────────────────────────────────────────
clean_events = [{k: v for k, v in ev.items() if k not in ('si','ei')} for ev in events]

# ── Write vr_survival.json ─────────────────────────────────────────────────────
main_out = {
    'run_id':        datetime.now().strftime('%Y%m%d_%H%M%S'),
    'current':       current,
    'history':       history,
    'events':        clean_events,
    'backtest':      backtest,
    'backtest_curve': backtest_curve,
    'pool_logic':    pool_logic,
    'philosophy':    philosophy,
}
p1 = os.path.join(OUT_DIR, 'vr_survival.json')
with open(p1, 'w', encoding='utf-8') as f:
    json.dump(main_out, f, ensure_ascii=False, separators=(',',':'))
print(f"Written {p1} ({os.path.getsize(p1)//1024} KB)")

# ── Write vr_survival_playback.json ───────────────────────────────────────────
p2 = os.path.join(OUT_DIR, 'vr_survival_playback.json')
with open(p2, 'w', encoding='utf-8') as f:
    json.dump({'run_id': main_out['run_id'], 'events': playback_events}, f,
              ensure_ascii=False, separators=(',',':'))
print(f"Written {p2} ({os.path.getsize(p2)//1024} KB)")
print("\nDone.")
