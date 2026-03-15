import os
import sqlite3
import pandas as pd
import numpy as np

DB = 'marketflow/data/marketflow.db'
SYM = 'TQQQ'
START = '2018-01-01'
OUTDIR = 'marketflow/backend/output'
OUTCSV = os.path.join(OUTDIR, 'navigator_tradeoff_matrix.csv')

os.makedirs(OUTDIR, exist_ok=True)

WATCH_RET2 = [-0.06, -0.07, -0.08, -0.09]
WATCH_RET3 = [-0.10, -0.11, -0.12, -0.13]
DEF_RET2 = [-0.10, -0.11, -0.12, -0.13]
DEF_RET3 = [-0.13, -0.14, -0.15, -0.16]
PANIC_RET3 = [-0.18, -0.19, -0.20, -0.21]

BASELINE = (-0.08, -0.12, -0.12, -0.15, -0.20)

STABILIZATION_DAYS = 3

con = sqlite3.connect(DB)
raw = pd.read_sql(
    "SELECT date, close FROM ohlcv_daily WHERE symbol=? AND date>=? ORDER BY date",
    con,
    params=[SYM, START],
)
con.close()

if raw.empty:
    raise SystemExit('No data in DB')

raw['date'] = pd.to_datetime(raw['date'], errors='coerce')
raw = raw.dropna(subset=['date', 'close']).reset_index(drop=True)

# Features
raw['ret_1d'] = raw['close'].pct_change()
raw['ret_2d'] = raw['close'] / raw['close'].shift(2) - 1
raw['ret_3d'] = raw['close'] / raw['close'].shift(3) - 1

close = raw['close'].to_numpy(dtype=float)
ret2 = raw['ret_2d'].to_numpy(dtype=float)
ret3 = raw['ret_3d'].to_numpy(dtype=float)

n = len(raw)

# Precompute future metrics
close_series = pd.Series(close)
future_min_30 = close_series[::-1].rolling(31, min_periods=1).min()[::-1].to_numpy(dtype=float)
future_close_10 = close_series.shift(-10).to_numpy(dtype=float)


def compute_states_arrays(w2, w3, d2, d3, p3):
    states = np.empty(n, dtype='U18')
    last_low = np.inf
    last_low_idx = -1
    prev_state = 'NORMAL'

    for i in range(n):
        c = close[i]
        if np.isfinite(c) and c < last_low:
            last_low = c
            last_low_idx = i
        days_since_low = i - last_low_idx if last_low_idx >= 0 else 0

        r2 = ret2[i]
        r3 = ret3[i]

        state = 'NORMAL'
        if np.isfinite(r3) and r3 <= p3:
            state = 'PANIC_EXTENSION'
        elif (np.isfinite(r2) and r2 <= d2) or (np.isfinite(r3) and r3 <= d3):
            state = 'DEFENSE_MODE'
        elif (np.isfinite(r2) and r2 <= w2) or (np.isfinite(r3) and r3 <= w3):
            state = 'ACCELERATION_WATCH'
        elif (
            prev_state in ('PANIC_EXTENSION', 'DEFENSE_MODE')
            and np.isfinite(r3)
            and r3 > 0
            and days_since_low >= STABILIZATION_DAYS
        ):
            state = 'STABILIZATION'

        states[i] = state
        prev_state = state

    return states


def compute_metrics(states):
    if n == 0:
        return dict(defense_events=0, tail30_rate=np.nan, false_defense_rate=np.nan, flips_per_100d=np.nan)

    # defense events: transitions into DEFENSE_MODE
    prev = np.roll(states, 1)
    prev[0] = 'NONE'
    defense_idx = np.where((states == 'DEFENSE_MODE') & (prev != 'DEFENSE_MODE'))[0]

    if defense_idx.size == 0:
        flips = int(np.sum(states[1:] != states[:-1]))
        flips_per_100d = flips / n * 100.0
        return dict(defense_events=0, tail30_rate=np.nan, false_defense_rate=np.nan, flips_per_100d=flips_per_100d)

    entry_close = close[defense_idx]
    worst30 = future_min_30[defense_idx] / entry_close - 1.0
    ret10 = future_close_10[defense_idx] / entry_close - 1.0

    tail30_rate = np.mean(worst30 <= -0.30)
    false_defense_rate = np.mean(ret10 >= 0.08)

    flips = int(np.sum(states[1:] != states[:-1]))
    flips_per_100d = flips / n * 100.0

    return dict(
        defense_events=int(defense_idx.size),
        tail30_rate=float(tail30_rate),
        false_defense_rate=float(false_defense_rate),
        flips_per_100d=float(flips_per_100d),
    )


def baseline_tail_rate():
    states = compute_states_arrays(*BASELINE)
    m = compute_metrics(states)
    return m['tail30_rate']


base_tail = baseline_tail_rate()

rows = []
param_id = 0

for w2 in WATCH_RET2:
    for w3 in WATCH_RET3:
        for d2 in DEF_RET2:
            for d3 in DEF_RET3:
                for p3 in PANIC_RET3:
                    param_id += 1
                    states = compute_states_arrays(w2, w3, d2, d3, p3)
                    m = compute_metrics(states)

                    saved_tail = np.nan
                    if np.isfinite(m['tail30_rate']) and np.isfinite(base_tail):
                        saved_tail = base_tail - m['tail30_rate']

                    rows.append(
                        {
                            'param_set_id': param_id,
                            'watch_ret2': w2,
                            'watch_ret3': w3,
                            'def_ret2': d2,
                            'def_ret3': d3,
                            'panic_ret3': p3,
                            'defense_events': m['defense_events'],
                            'tail30_rate': m['tail30_rate'],
                            'saved_tail_risk': saved_tail,
                            'false_defense_rate': m['false_defense_rate'],
                            'flips_per_100d': m['flips_per_100d'],
                        }
                    )

result = pd.DataFrame(rows)

# Ranking

def normalize(series, higher_better=True):
    s = series.copy()
    if higher_better:
        s = s.fillna(s.min())
    else:
        s = s.fillna(s.max())
    minv = s.min()
    maxv = s.max()
    if maxv - minv == 0:
        return pd.Series(0.0, index=s.index)
    if higher_better:
        return (s - minv) / (maxv - minv)
    return (maxv - s) / (maxv - minv)

result['score_saved_tail'] = normalize(result['saved_tail_risk'], higher_better=True)
result['score_false_def'] = normalize(result['false_defense_rate'], higher_better=False)
result['score_stability'] = normalize(result['flips_per_100d'], higher_better=False)

result['composite_score'] = (
    0.5 * result['score_saved_tail'] +
    0.3 * result['score_false_def'] +
    0.2 * result['score_stability']
)

result = result.sort_values(['composite_score'], ascending=False).reset_index(drop=True)
result.to_csv(OUTCSV, index=False)

# Print top 5
print('[OK] wrote:', OUTCSV)
print('\nTop 5 configs:')
print(result.head(5)[[
    'param_set_id','watch_ret2','watch_ret3','def_ret2','def_ret3','panic_ret3',
    'saved_tail_risk','false_defense_rate','flips_per_100d','composite_score'
]].to_string(index=False))

print('\nNOTE: Fast crash cannot be fully prevented; this grid only trades off early defense vs false alarms.')
