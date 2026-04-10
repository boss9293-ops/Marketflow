import os
import sqlite3
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

from db_utils import resolve_marketflow_db

DB = resolve_marketflow_db(required_tables=("ohlcv_daily",), data_plane="snapshot")
SYM = 'TQQQ'
START = '2018-01-01'
OUTDIR = 'marketflow/backend/output'

os.makedirs(OUTDIR, exist_ok=True)

def load_data():
    con = sqlite3.connect(DB)
    df = pd.read_sql(
        "SELECT date, close FROM ohlcv_daily WHERE symbol=? AND date>=? ORDER BY date",
        con,
        params=[SYM, START],
    )
    con.close()
    if df.empty:
        raise SystemExit('No data for symbol')
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df.dropna(subset=['date', 'close']).reset_index(drop=True)
    return df

def compute_features(df):
    df = df.copy()
    df['ret_1d'] = df['close'].pct_change()
    df['ret_2d'] = df['close'] / df['close'].shift(2) - 1
    df['ret_3d'] = df['close'] / df['close'].shift(3) - 1
    df['dd_60d'] = df['close'] / df['close'].rolling(60).max() - 1
    df['ma50'] = df['close'].rolling(50).mean()
    df['ma200'] = df['close'].rolling(200).mean()
    return df

def compute_states(df, stabilization_days=3):
    states = []
    last_low = np.inf
    last_low_idx = -1
    prev_state = 'NORMAL'
    for idx, row in df.iterrows():
        close = row['close']
        if np.isfinite(close) and close < last_low:
            last_low = close
            last_low_idx = idx
        days_since_low = idx - last_low_idx if last_low_idx >= 0 else 0
        ret2 = row['ret_2d']
        ret3 = row['ret_3d']

        state = 'NORMAL'
        if pd.notna(ret3) and ret3 <= -0.20:
            state = 'PANIC_EXTENSION'
        elif (pd.notna(ret2) and ret2 <= -0.12) or (pd.notna(ret3) and ret3 <= -0.15):
            state = 'DEFENSE_MODE'
        elif (pd.notna(ret2) and ret2 <= -0.08) or (pd.notna(ret3) and ret3 <= -0.12):
            state = 'ACCELERATION_WATCH'
        elif (
            prev_state in ['PANIC_EXTENSION', 'DEFENSE_MODE']
            and pd.notna(ret3)
            and ret3 > 0
            and days_since_low >= stabilization_days
        ):
            state = 'STABILIZATION'
        states.append(state)
        prev_state = state

    out = df.copy()
    out['state'] = states
    return out

def future_worst_dd(df, idx, days):
    end = min(idx + days, len(df) - 1)
    window = df['close'].iloc[idx : end + 1]
    if window.isna().all():
        return np.nan
    entry = df['close'].iloc[idx]
    if not np.isfinite(entry) or entry == 0:
        return np.nan
    return window.min() / entry - 1.0

def build_events(df):
    defense_mask = (df['state'] == 'DEFENSE_MODE') & (df['state'].shift(1) != 'DEFENSE_MODE')
    indices = df.index[defense_mask].tolist()
    rows = []
    for idx in indices:
        worst10 = future_worst_dd(df, idx, 10)
        worst20 = future_worst_dd(df, idx, 20)
        worst30 = future_worst_dd(df, idx, 30)
        end = min(idx + 10, len(df) - 1)
        panic_follow = int((df['state'].iloc[idx + 1 : end + 1] == 'PANIC_EXTENSION').any())
        rows.append(
            dict(
                date=df.loc[idx, 'date'].date().isoformat(),
                close=float(df.loc[idx, 'close']),
                ret_2d=float(df.loc[idx, 'ret_2d']) if pd.notna(df.loc[idx, 'ret_2d']) else np.nan,
                ret_3d=float(df.loc[idx, 'ret_3d']) if pd.notna(df.loc[idx, 'ret_3d']) else np.nan,
                dd_60d=float(df.loc[idx, 'dd_60d']) if pd.notna(df.loc[idx, 'dd_60d']) else np.nan,
                worst_dd_10d=worst10,
                worst_dd_20d=worst20,
                worst_dd_30d=worst30,
                panic_follow_10d=panic_follow,
            )
        )
    return pd.DataFrame(rows)

def build_metrics(events):
    n = len(events)
    panic_count = int(events['panic_follow_10d'].sum()) if n else 0
    metrics = {
        'defense_events': n,
        'panic_follow_count': panic_count,
        'panic_follow_rate': (panic_count / n) if n else np.nan,
        'avg_worst_dd_10d': float(events['worst_dd_10d'].mean()) if n else np.nan,
        'avg_worst_dd_20d': float(events['worst_dd_20d'].mean()) if n else np.nan,
        'avg_worst_dd_30d': float(events['worst_dd_30d'].mean()) if n else np.nan,
    }
    return pd.DataFrame(list(metrics.items()), columns=['metric', 'value'])

def plot_episode(df, start, end, outpath, title):
    mask = (df['date'] >= pd.Timestamp(start)) & (df['date'] <= pd.Timestamp(end))
    seg = df.loc[mask].copy()
    if seg.empty:
        return

    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(seg['date'], seg['close'], color='#1f77b4', lw=1.5, label='Close')

    defense_dates = seg.loc[seg['state'] == 'DEFENSE_MODE', 'date']
    panic_dates = seg.loc[seg['state'] == 'PANIC_EXTENSION', 'date']
    if not defense_dates.empty:
        ax.scatter(defense_dates, seg.loc[seg['state'] == 'DEFENSE_MODE', 'close'],
                   color='#d62728', s=14, label='DEFENSE')
    if not panic_dates.empty:
        ax.scatter(panic_dates, seg.loc[seg['state'] == 'PANIC_EXTENSION', 'close'],
                   color='#ff7f0e', s=14, label='PANIC')

    ax.set_title(title)
    ax.grid(True, alpha=0.2)
    ax.legend(loc='best', fontsize=8)
    fig.tight_layout()
    fig.savefig(outpath, dpi=140)
    plt.close(fig)

def main():
    df = load_data()
    df = compute_features(df)
    df = compute_states(df)

    events = build_events(df)
    metrics = build_metrics(events)

    events_path = os.path.join(OUTDIR, 'navigator_events.csv')
    metrics_path = os.path.join(OUTDIR, 'navigator_metrics.csv')
    events.to_csv(events_path, index=False)
    metrics.to_csv(metrics_path, index=False)

    plot_episode(df, '2020-02-01', '2020-05-31', os.path.join(OUTDIR, 'navigator_episode_2020.png'), 'Navigator Episode 2020')
    plot_episode(df, '2022-01-01', '2022-12-31', os.path.join(OUTDIR, 'navigator_episode_2022.png'), 'Navigator Episode 2022')
    plot_episode(df, '2024-01-01', '2024-12-31', os.path.join(OUTDIR, 'navigator_episode_2024.png'), 'Navigator Episode 2024')

    print('[OK] wrote:', events_path)
    print('[OK] wrote:', metrics_path)

if __name__ == '__main__':
    main()
