# -*- coding: utf-8 -*-
"""
Standard Risk Alert System — backend builder
Writes: marketflow/backend/output/risk_alert.json
Run:    python build_risk_alert.py
"""
import os, sys, json, sqlite3
from datetime import datetime, timedelta
import pandas as pd
import numpy as np

from db_utils import resolve_marketflow_db

sys.stdout.reconfigure(encoding='utf-8')

def scalar_at(value) -> float:
    if isinstance(value, pd.Series):
        if value.empty:
            return float('nan')
        return float(value.iloc[0])
    return float(value)

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPTS_DIR  = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR  = os.path.dirname(SCRIPTS_DIR)   # marketflow/backend
DATA_DIR     = os.path.join(BACKEND_DIR, '..', 'data')
OUTPUT_DIR   = os.path.join(BACKEND_DIR, 'output')
os.makedirs(OUTPUT_DIR, exist_ok=True)

MF_DB    = resolve_marketflow_db(
    required_tables=("ohlcv_daily", "ticker_history_daily", "market_daily"),
    prefer_engine=True,
)
CACHE_DB = os.path.join(DATA_DIR, 'cache.db')

# ── Load QQQ from ticker_history_daily (1999+) ───────────────────────────────
print("Loading QQQ from ticker_history_daily...")
con = sqlite3.connect(MF_DB)
qqq_rows = con.execute(
    "SELECT date, close FROM ticker_history_daily WHERE symbol='QQQ' ORDER BY date"
).fetchall()
con.close()

df = pd.DataFrame(qqq_rows, columns=['date', 'close'])
df['date'] = pd.to_datetime(df['date'], errors='coerce', format='mixed')
df = df.dropna().sort_values('date')
df = df.drop_duplicates(subset=['date'], keep='last').set_index('date')
df.columns = ['qqq']
print(f"  QQQ rows: {len(df)} ({df.index[0].date()} → {df.index[-1].date()})")

# ── Load VIX, HY_OAS, SPY from cache.db ──────────────────────────────────────
print("Loading macro series from cache.db...")
ccon = sqlite3.connect(CACHE_DB)
def load_series(sym):
    rows = ccon.execute(
        "SELECT date, value FROM series_data WHERE symbol=? ORDER BY date", (sym,)
    ).fetchall()
    s = pd.DataFrame(rows, columns=['date', sym])
    s['date'] = pd.to_datetime(s['date'], errors='coerce', format='mixed')
    s = s.dropna().drop_duplicates(subset=['date'], keep='last').set_index('date')[sym]
    return s

def load_market_daily_vix():
    con = sqlite3.connect(MF_DB)
    rows = con.execute(
        "SELECT date, vix FROM market_daily WHERE vix IS NOT NULL ORDER BY date"
    ).fetchall()
    con.close()
    s = pd.DataFrame(rows, columns=['date', 'vix'])
    s['date'] = pd.to_datetime(s['date'], errors='coerce', format='mixed')
    s = s.dropna().drop_duplicates(subset=['date'], keep='last').set_index('date')['vix']
    return s

vix_s   = load_series('VIX')
hy_s    = load_series('HY_OAS')
spy_s   = load_series('SPY')
ccon.close()

# Fallback: if cache.db VIX is stale or empty, use market_daily VIX
vix_daily = load_market_daily_vix()
if not vix_daily.empty:
    if vix_s.empty or vix_daily.index[-1] > vix_s.index[-1]:
        vix_s = vix_daily

print(f"  VIX:   {len(vix_s)} rows ({vix_s.index[0].date()} → {vix_s.index[-1].date()})")
print(f"  HY_OAS:{len(hy_s)} rows ({hy_s.index[0].date()} → {hy_s.index[-1].date()})")
print(f"  SPY:   {len(spy_s)} rows ({spy_s.index[0].date()} → {spy_s.index[-1].date()})")

# ── Merge all into main df ────────────────────────────────────────────────────
df = df.join(vix_s.rename('vix'),   how='left')
df = df.join(hy_s.rename('hy_oas'), how='left')
df = df.join(spy_s.rename('spy'),   how='left')

# Forward-fill macro series (weekend gaps) then fill remaining NaN with medians
for col in ['vix', 'hy_oas', 'spy']:
    df[col] = df[col].ffill()

VIX_MED  = float(df['vix'].median())   if df['vix'].notna().any()   else 18.0
HY_MED   = float(df['hy_oas'].median()) if df['hy_oas'].notna().any() else 3.5
SPY_MED  = float(df['spy'].median())   if df['spy'].notna().any()   else 400.0

df['vix']    = df['vix'].fillna(VIX_MED)
df['hy_oas'] = df['hy_oas'].fillna(HY_MED)
df['spy']    = df['spy'].fillna(SPY_MED)

# ── 9-Indicator Macro Score ───────────────────────────────────────────────────
print("Computing 9-indicator score...")

# 1. QQQ vs MA200 (max 15)
df['ma200'] = df['qqq'].rolling(200, min_periods=50).mean()
df['s1'] = np.where(df['qqq'] < df['ma200'], 15.0, 0.0)
df['s1'] = df['s1'].fillna(0.0)

# 2. QQQ vs MA50 (max 10)
df['ma50'] = df['qqq'].rolling(50, min_periods=20).mean()
df['s2'] = np.where(df['qqq'] < df['ma50'], 10.0, 0.0)
df['s2'] = df['s2'].fillna(0.0)

# 3. 20d momentum — QQQ 20-day return (max 15)
df['ret20'] = df['qqq'].pct_change(20)
df['s3'] = np.select(
    [df['ret20'] < -0.10, df['ret20'] < -0.05, df['ret20'] < -0.02, df['ret20'] >= -0.02],
    [15.0, 10.0, 5.0, 0.0], default=0.0
)
df['s3'] = df['s3'].fillna(0.0)

# 4. 52-week drawdown (max 15)
df['roll_max'] = df['qqq'].rolling(252, min_periods=60).max()
df['dd52'] = (df['qqq'] - df['roll_max']) / df['roll_max']  # negative
df['s4'] = np.select(
    [df['dd52'] < -0.25, df['dd52'] < -0.15, df['dd52'] < -0.08, df['dd52'] < -0.04],
    [15.0, 10.0, 5.0, 2.0], default=0.0
)
df['s4'] = df['s4'].fillna(0.0)

# 5. VIX level (max 20)
df['s5'] = np.select(
    [df['vix'] > 45, df['vix'] > 35, df['vix'] > 28, df['vix'] > 22, df['vix'] > 18],
    [20.0, 16.0, 11.0, 6.0, 2.0], default=0.0
)

# 6. HY_OAS level (max 10)
df['s6'] = np.select(
    [df['hy_oas'] > 6.0, df['hy_oas'] > 5.0, df['hy_oas'] > 4.0, df['hy_oas'] > 3.5],
    [10.0, 7.0, 4.0, 1.0], default=0.0
)

# 7. SPY/QQQ breadth divergence — SPY underperform QQQ by > x% over 20d (max 10)
# When SPY lags QQQ significantly, small-cap breadth is narrow (risk indicator)
df['spy_ret20'] = df['spy'].pct_change(20)
df['qqq_ret20'] = df['qqq'].pct_change(20)
df['breadth_gap'] = df['spy_ret20'] - df['qqq_ret20']  # negative = SPY underperforming
df['s7'] = np.select(
    [df['breadth_gap'] < -0.08, df['breadth_gap'] < -0.04, df['breadth_gap'] < -0.02],
    [10.0, 5.0, 2.0], default=0.0
)
df['s7'] = df['s7'].fillna(0.0)

# 8. 5-day ROC (max 5)
df['ret5'] = df['qqq'].pct_change(5)
df['s8'] = np.select(
    [df['ret5'] < -0.07, df['ret5'] < -0.04, df['ret5'] < -0.02],
    [5.0, 3.0, 1.0], default=0.0
)
df['s8'] = df['s8'].fillna(0.0)

# 9. 20-day annualized vol (max 5)
df['vol20'] = df['qqq'].pct_change().rolling(20).std() * np.sqrt(252)
df['s9'] = np.select(
    [df['vol20'] > 0.40, df['vol20'] > 0.28, df['vol20'] > 0.18],
    [5.0, 3.0, 1.0], default=0.0
)
df['s9'] = df['s9'].fillna(0.0)

# Total score
df['score'] = (df['s1'] + df['s2'] + df['s3'] + df['s4'] +
               df['s5'] + df['s6'] + df['s7'] + df['s8'] + df['s9'])
df['score'] = df['score'].clip(0, 100).round(1)

# Level
def score_to_level(s):
    if s >= 85: return 4
    if s >= 70: return 3
    if s >= 50: return 2
    if s >= 30: return 1
    return 0

df['level'] = df['score'].apply(score_to_level)

print(f"  Score range: {df['score'].min():.1f} – {df['score'].max():.1f}")
print(f"  Level dist:\n{df['level'].value_counts().sort_index()}")

# ── Event Detection ───────────────────────────────────────────────────────────
print("Detecting events...")

LEVEL_TRIGGER = 2   # score >= 50
LEVEL_CLEAR   = 0   # score <= 29
MERGE_DAYS    = 60  # merge events within 60 calendar days

# Find trigger periods (level >= 2)
trigger_mask = df['level'] >= LEVEL_TRIGGER
events_raw = []
in_event = False
ev_start = None
for dt, triggered in trigger_mask.items():
    if triggered and not in_event:
        in_event = True
        ev_start = dt
    elif not triggered and in_event:
        events_raw.append((ev_start, dt - timedelta(days=1)))
        in_event = False
if in_event:
    events_raw.append((ev_start, df.index[-1]))

# Merge events within MERGE_DAYS
events_merged = []
for start, end in events_raw:
    if events_merged and (start - events_merged[-1][1]).days <= MERGE_DAYS:
        events_merged[-1] = (events_merged[-1][0], end)
    else:
        events_merged.append((start, end))

print(f"  Raw trigger periods: {len(events_raw)}, After merging: {len(events_merged)}")

# Build event list with metadata
KNOWN_NAMES = {
    # (year, month): name
    (2000,  3): "Dot-Com Bust (2000)",
    (2001,  9): "9/11 Shock (2001)",
    (2002,  7): "Dot-Com Trough (2002)",
    (2007, 10): "GFC Start (2007)",
    (2008,  9): "GFC Lehman (2008)",
    (2009,  3): "GFC Trough (2009)",
    (2010,  5): "Flash Crash (2010)",
    (2011,  8): "Debt Ceiling (2011)",
    (2015,  8): "China Shock (2015)",
    (2018, 10): "Rate Scare (2018)",
    (2018, 12): "Q4 Selloff (2018)",
    (2020,  2): "COVID Crash (2020)",
    (2022,  1): "Rate Hike Fear (2022)",
    (2022,  9): "Peak Rate Scare (2022)",
    (2023,  3): "Banking Stress (2023)",
    (2024,  8): "Carry Unwind (2024)",
    (2025,  8): "Tariff Shock (2025)",
}

event_records = []
for i, (start, end) in enumerate(events_merged):
    # Clip to df range
    start_clip = max(start, df.index[0])
    end_clip   = min(end,   df.index[-1])
    ev_df = df.loc[start_clip:end_clip]
    if ev_df.empty:
        continue

    peak_score = float(ev_df['score'].max())
    peak_level = int(ev_df['level'].max())
    qqq_at_start = scalar_at(df.loc[start_clip, 'qqq'])
    qqq_trough   = float(ev_df['qqq'].min())
    max_drawdown = (qqq_trough - qqq_at_start) / qqq_at_start

    # Outcome: QQQ return 1M, 3M, 6M from event start
    def fwd_ret(days):
        tgt = start_clip + timedelta(days=days)
        future = df.loc[df.index >= tgt, 'qqq']
        if future.empty: return None
        return round((float(future.iloc[0]) - qqq_at_start) / qqq_at_start * 100, 2)

    # Name lookup
    name_key = (start_clip.year, start_clip.month)
    # Try current and next/prev months
    name = None
    for k, v in KNOWN_NAMES.items():
        if abs(k[0]*12 + k[1] - (start_clip.year*12 + start_clip.month)) <= 2:
            name = v
            break
    if not name:
        name = f"Risk Event {start_clip.strftime('%Y-%m')}"

    # ── Per-event playback: 25 trading days before → 40 trading days after event end
    def _sf(v, d=2):
        return None if pd.isna(v) else round(float(v), d)
    all_dates = df.index.tolist()
    start_idx = all_dates.index(start_clip) if start_clip in all_dates else 0
    end_idx   = all_dates.index(end_clip)   if end_clip   in all_dates else len(all_dates)-1
    pre_idx   = max(0, start_idx - 85)   # ~4 months before event start
    post_idx  = min(len(all_dates) - 1, end_idx + 60)  # 3 months after event end
    window_df = df.iloc[pre_idx : post_idx + 1][['qqq', 'ma200', 'ma50', 'score', 'level']].copy()
    window_df = window_df.reset_index()

    # Normalize QQQ to 100 at event start (different events become comparable)
    qqq_base = scalar_at(df.loc[start_clip, 'qqq'])
    playback = []
    for _, wr in window_df.iterrows():
        d = wr['date']
        in_ev = (d >= start_clip) and (d <= end_clip)
        q = _sf(wr['qqq'])
        m2 = _sf(wr['ma200'])
        m5 = _sf(wr['ma50'])
        playback.append({
            "date":    d.strftime('%Y-%m-%d') if hasattr(d, 'strftime') else str(d),
            "qqq_n":   round(q  / qqq_base * 100, 2) if q  else None,
            "ma200_n": round(m2 / qqq_base * 100, 2) if m2 else None,
            "ma50_n":  round(m5 / qqq_base * 100, 2) if m5 else None,
            "score":   _sf(wr['score'], 1),
            "level":   int(wr['level']),
            "in_ev":   in_ev,
        })

    event_records.append({
        "id": i + 1,
        "name": name,
        "start": start_clip.strftime('%Y-%m-%d'),
        "end":   end_clip.strftime('%Y-%m-%d'),
        "duration_days": (end_clip - start_clip).days + 1,
        "peak_score": round(peak_score, 1),
        "peak_level": peak_level,
        "qqq_drawdown_pct": round(max_drawdown * 100, 2),
        "fwd_ret_1m": fwd_ret(21),
        "fwd_ret_3m": fwd_ret(63),
        "fwd_ret_6m": fwd_ret(126),
        "playback": playback,
    })

print(f"  Events detected: {len(event_records)}")

# ── Backtest ──────────────────────────────────────────────────────────────────
print("Running backtest...")

SELL_LEVEL  = 2    # level >= 2 → exit QQQ
ENTRY_LEVEL = 0    # level == 0 → re-enter QQQ

bt = df[['qqq', 'score', 'level']].copy()
bt['in_market'] = True  # start in market

# Simple state machine
position = True  # True = in market
in_market_col = []
for _, row in bt.iterrows():
    if position and row['level'] >= SELL_LEVEL:
        position = False
    elif not position and row['level'] <= ENTRY_LEVEL:
        position = True
    in_market_col.append(position)

bt['in_market'] = in_market_col
bt['qqq_ret']   = bt['qqq'].pct_change().fillna(0)
bt['strat_ret'] = np.where(bt['in_market'], bt['qqq_ret'], 0.0)

# Cumulative returns
bt['bh_cum']    = (1 + bt['qqq_ret']).cumprod()
bt['strat_cum'] = (1 + bt['strat_ret']).cumprod()

bh_total   = float(bt['bh_cum'].iloc[-1])
strat_total = float(bt['strat_cum'].iloc[-1])

# Max drawdowns
def max_dd(cum_series):
    roll_max = cum_series.cummax()
    dd = (cum_series - roll_max) / roll_max
    return float(dd.min())

bh_mdd    = max_dd(bt['bh_cum'])
strat_mdd = max_dd(bt['strat_cum'])

# Annualized return
n_years = (bt.index[-1] - bt.index[0]).days / 365.25
bh_ann    = float(bh_total ** (1/n_years) - 1)
strat_ann = float(strat_total ** (1/n_years) - 1)

# Days avoided (in cash during risk events)
days_in_cash   = int((~bt['in_market']).sum())
days_total     = len(bt)

print(f"  Backtest: {bt.index[0].date()} → {bt.index[-1].date()} ({n_years:.1f}y)")
print(f"  B&H total={bh_total:.2f}x ({bh_ann*100:.1f}%/yr), MDD={bh_mdd*100:.1f}%")
print(f"  Strategy total={strat_total:.2f}x ({strat_ann*100:.1f}%/yr), MDD={strat_mdd*100:.1f}%")
print(f"  Days in cash: {days_in_cash}/{days_total} ({days_in_cash/days_total*100:.1f}%)")

# ── Current state ─────────────────────────────────────────────────────────────
latest = df.iloc[-1]
latest_date = df.index[-1].strftime('%Y-%m-%d')
current_score = float(latest['score'])
current_level = int(latest['level'])

level_labels = {0: 'Normal', 1: 'Caution', 2: 'Risk', 3: 'High Risk', 4: 'Extreme'}
level_colors = {0: '#22c55e', 1: '#f59e0b', 2: '#f97316', 3: '#ef4444', 4: '#7c3aed'}
level_actions = {
    0: 'Maintain full exposure',
    1: 'Monitor — reduce aggressive positions',
    2: 'Reduce exposure to 70%',
    3: 'Reduce exposure to 40%',
    4: 'Move to cash — max defensive',
}

# Score trend (7-day)
score_7d_ago = float(df['score'].iloc[-8]) if len(df) >= 8 else current_score
score_trend = 'Rising' if current_score > score_7d_ago + 3 else ('Falling' if current_score < score_7d_ago - 3 else 'Stable')

# ── Recent history (90 days) ──────────────────────────────────────────────────
recent_90 = df.tail(90)[['qqq', 'score', 'level', 'ma200', 'ma50', 'vix', 'hy_oas']].copy()
recent_90 = recent_90.reset_index()
recent_90['date'] = recent_90['date'].dt.strftime('%Y-%m-%d')

def safe_float(v, decimals=2):
    if pd.isna(v): return None
    return round(float(v), decimals)

history = []
for _, row in recent_90.iterrows():
    history.append({
        "date":    row['date'],
        "qqq":     safe_float(row['qqq']),
        "ma200":   safe_float(row['ma200']),
        "ma50":    safe_float(row['ma50']),
        "score":   safe_float(row['score'], 1),
        "level":   int(row['level']),
        "vix":     safe_float(row['vix']),
        "hy_oas":  safe_float(row['hy_oas']),
    })

# ── Indicator breakdown (current) ────────────────────────────────────────────
indicator_detail = [
    {"id": 1, "name": "QQQ vs MA200", "max": 15, "score": safe_float(latest['s1'], 1),
     "value": safe_float(latest['qqq']), "threshold": safe_float(latest['ma200']),
     "desc": "Price below 200-day MA signals long-term trend breakdown"},
    {"id": 2, "name": "QQQ vs MA50",  "max": 10, "score": safe_float(latest['s2'], 1),
     "value": safe_float(latest['qqq']), "threshold": safe_float(latest['ma50']),
     "desc": "Price below 50-day MA signals medium-term weakness"},
    {"id": 3, "name": "20d Momentum", "max": 15, "score": safe_float(latest['s3'], 1),
     "value": safe_float(latest['ret20'] * 100, 2) if not pd.isna(latest['ret20']) else None,
     "unit": "%", "desc": "20-day return — sustained selling pressure"},
    {"id": 4, "name": "52w Drawdown", "max": 15, "score": safe_float(latest['s4'], 1),
     "value": safe_float(latest['dd52'] * 100, 2) if not pd.isna(latest['dd52']) else None,
     "unit": "%", "desc": "Distance from 52-week high"},
    {"id": 5, "name": "VIX Level",   "max": 20, "score": safe_float(latest['s5'], 1),
     "value": safe_float(latest['vix']),
     "desc": "Fear gauge — elevated VIX = risk-off sentiment"},
    {"id": 6, "name": "HY Spread",   "max": 10, "score": safe_float(latest['s6'], 1),
     "value": safe_float(latest['hy_oas']),
     "unit": "%", "desc": "High-yield credit spread — widening = credit stress"},
    {"id": 7, "name": "SPY/QQQ Breadth", "max": 10, "score": safe_float(latest['s7'], 1),
     "value": safe_float(latest['breadth_gap'] * 100, 2) if not pd.isna(latest['breadth_gap']) else None,
     "unit": "%", "desc": "SPY 20d return minus QQQ 20d return — divergence = narrow market"},
    {"id": 8, "name": "5d ROC",      "max": 5,  "score": safe_float(latest['s8'], 1),
     "value": safe_float(latest['ret5'] * 100, 2) if not pd.isna(latest['ret5']) else None,
     "unit": "%", "desc": "5-day rate of change — acute selling velocity"},
    {"id": 9, "name": "20d Vol",     "max": 5,  "score": safe_float(latest['s9'], 1),
     "value": safe_float(latest['vol20'] * 100, 2) if not pd.isna(latest['vol20']) else None,
     "unit": "%", "desc": "20-day annualized volatility — regime instability"},
]

# ── Build final JSON ──────────────────────────────────────────────────────────
run_date = datetime.utcnow().strftime('%Y%m%d')
output = {
    "run_id": f"standard_v1.0_{run_date}",
    "generated": datetime.utcnow().isoformat() + 'Z',
    "current": {
        "date":        latest_date,
        "score":       round(current_score, 1),
        "level":       current_level,
        "level_label": level_labels[current_level],
        "level_color": level_colors[current_level],
        "action":      level_actions[current_level],
        "score_trend": score_trend,
        "score_7d_ago": round(score_7d_ago, 1),
    },
    "indicators": indicator_detail,
    "history":    history,
    "events":     [{k: v for k, v in ev.items() if k != 'playback'} for ev in event_records],
    "backtest": {
        "start_date":   bt.index[0].strftime('%Y-%m-%d'),
        "end_date":     bt.index[-1].strftime('%Y-%m-%d'),
        "years":        round(n_years, 1),
        "sell_rule":    f"Score >= 50 (Level 2+)",
        "buy_rule":     f"Score <= 29 (Level 0)",
        "bh": {
            "total_return": round((bh_total - 1) * 100, 1),
            "ann_return":   round(bh_ann * 100, 2),
            "max_drawdown": round(bh_mdd * 100, 2),
        },
        "strategy": {
            "total_return": round((strat_total - 1) * 100, 1),
            "ann_return":   round(strat_ann * 100, 2),
            "max_drawdown": round(strat_mdd * 100, 2),
        },
        "days_in_cash":      days_in_cash,
        "days_total":        days_total,
        "cash_pct":          round(days_in_cash / days_total * 100, 1),
        "events_avoided":    len(event_records),
    },
    "methodology": {
        "indicators": [
            {"id": i+1, "name": ind["name"], "max": ind["max"], "desc": ind["desc"]}
            for i, ind in enumerate(indicator_detail)
        ],
        "levels": [
            {"level": 0, "label": "Normal",    "range": "0–29",   "color": "#22c55e", "action": level_actions[0]},
            {"level": 1, "label": "Caution",   "range": "30–49",  "color": "#f59e0b", "action": level_actions[1]},
            {"level": 2, "label": "Risk",      "range": "50–69",  "color": "#f97316", "action": level_actions[2]},
            {"level": 3, "label": "High Risk", "range": "70–84",  "color": "#ef4444", "action": level_actions[3]},
            {"level": 4, "label": "Extreme",   "range": "85–100", "color": "#7c3aed", "action": level_actions[4]},
        ],
        "event_detection": "Score crosses Level 2 (≥50); merge events within 60 calendar days",
        "backtest_logic":  "Sell QQQ when score ≥ 50; re-enter when score ≤ 29; hold cash between",
        "data_sources":    ["ticker_history_daily (QQQ 1999+)", "cache.db VIX (2022+)", "cache.db HY_OAS (2022+)", "cache.db SPY (2017+)"],
    },
}

# ── Backtest curve (full time series, every trading day) ──────────────────────
print("Building backtest curve...")
bt_curve = []
for dt, row in bt.iterrows():
    bt_curve.append({
        "date":     dt.strftime('%Y-%m-%d'),
        "bh":       round(float(row['bh_cum']) * 100, 2),     # 100 = start
        "strat":    round(float(row['strat_cum']) * 100, 2),
        "in_mkt":   bool(row['in_market']),
    })
output["backtest_curve"] = bt_curve
print(f"  Curve points: {len(bt_curve)}")

# Write main JSON (no playback — small, for server-side props)
out_path = os.path.join(OUTPUT_DIR, 'risk_alert.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False)

# Write playback JSON (per-event windowed history — large, fetched client-side)
playback_output = {
    "run_id": output["run_id"],
    "events": [{"id": ev["id"], "name": ev["name"], "start": ev["start"], "end": ev["end"],
                 "playback": ev.get("playback", [])} for ev in event_records],
}
pb_path = os.path.join(OUTPUT_DIR, 'risk_alert_playback.json')
with open(pb_path, 'w', encoding='utf-8') as f:
    json.dump(playback_output, f, ensure_ascii=False)

print(f"\nWritten: {out_path} ({os.path.getsize(out_path):,} bytes)")
print(f"Written: {pb_path} ({os.path.getsize(pb_path):,} bytes)")
print(f"Current score: {current_score:.1f} → Level {current_level} ({level_labels[current_level]})")
print(f"Events: {len(event_records)}")
print("Done.")
