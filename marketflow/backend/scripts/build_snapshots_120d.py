"""
build_snapshots_120d.py  v1.1
Builds enriched 120-day snapshot time-series into output/cache/snapshots_120d.json.

Source tables:
  daily_snapshots        gate_score, risk_level, risk_trend, market_phase, etc.
  ohlcv_daily(QQQ)       close price per day
  indicators_daily(QQQ)  sma200, vol20, ret5d

Extra computed fields per row:
  qqq_close, qqq_sma200, trend_state ('ABOVE'/'BELOW'), qqq_ret5d, qqq_vol20
  drawdown  QQQ close vs rolling 120d max (negative %)

Overwrites output/cache/snapshots_120d.json after build_cache_json.py.
"""
import os
import json
import sqlite3
import datetime
import sys


def _find_root():
    """Find project root that has marketflow.db (handles Korean path encoding)."""
    # 1. Try __file__ based path first
    _cand = os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
    if os.path.exists(os.path.join(_cand, 'data', 'marketflow.db')):
        return _cand
    # 2. Search dev directory for the project that actually has the DB
    _dev = r'd:\Youtube_pro\000-Code_develop'
    try:
        for _item in os.listdir(_dev):
            _full = os.path.join(_dev, _item, 'us_market_complete', 'marketflow')
            if os.path.exists(os.path.join(_full, 'data', 'marketflow.db')):
                return _full
    except Exception:
        pass
    return _cand


# ── Paths ──────────────────────────────────────────────────────────────────────
BASE      = _find_root()
BACKEND   = os.path.join(BASE, 'backend')
CACHE_DIR = os.path.join(BACKEND, 'output', 'cache')
DB_PATH   = os.path.join(BASE, 'data', 'marketflow.db')

LIMIT = 120

QUERY = """
WITH snap AS (
    SELECT * FROM daily_snapshots ORDER BY date DESC LIMIT ?
)
SELECT
    s.date,
    s.total_stocks,
    s.vcp_count,
    s.rotation_count,
    s.market_phase,
    s.gate_score,
    s.risk_level,
    s.risk_trend,
    s.gate_score_10d_avg,
    s.gate_score_30d_avg,
    s.gate_delta_5d,
    s.phase_shift_flag,
    o.close       AS qqq_close,
    i.sma200      AS qqq_sma200,
    i.vol20       AS qqq_vol20,
    i.ret5d       AS qqq_ret5d
FROM snap s
LEFT JOIN ohlcv_daily     o ON o.symbol = 'QQQ' AND o.date = s.date
LEFT JOIN indicators_daily i ON i.symbol = 'QQQ' AND i.date = s.date
ORDER BY s.date ASC
"""


def main():
    print("[build_snapshots_120d] Connecting to DB...")
    print(f"  BASE:     {BASE}")
    print(f"  DB_PATH:  {DB_PATH}")

    try:
        from db_utils import db_connect
        conn = db_connect(DB_PATH, row_factory=True)
        cur = conn.cursor()
        cur.execute(QUERY, (LIMIT,))
        rows = cur.fetchall()
        conn.close()
    except Exception as e:
        print(f"  [ERROR] DB query failed: {e}")
        sys.exit(1)

    print(f"  Fetched {len(rows)} rows")

    # Build snapshots + compute rolling drawdown on QQQ
    closes = [row['qqq_close'] for row in rows]
    max_so_far = None
    drawdowns = []
    for c in closes:
        if c is not None:
            max_so_far = c if max_so_far is None else max(max_so_far, c)
            dd = round((c - max_so_far) / max_so_far * 100, 3) if max_so_far else 0.0
        else:
            dd = None
        drawdowns.append(dd)

    snapshots = []
    for i, row in enumerate(rows):
        snap = {
            'date':               row['date'],
            'total_stocks':       row['total_stocks'],
            'vcp_count':          row['vcp_count'],
            'rotation_count':     row['rotation_count'],
            'market_phase':       row['market_phase'],
            'gate_score':         row['gate_score'],
            'risk_level':         row['risk_level'],
            'risk_trend':         row['risk_trend'],
            'gate_score_10d_avg': row['gate_score_10d_avg'],
            'gate_score_30d_avg': row['gate_score_30d_avg'],
            'gate_delta_5d':      row['gate_delta_5d'],
            'phase_shift_flag':   row['phase_shift_flag'],
            # Enriched
            'qqq_close':   round(float(row['qqq_close']),  4) if row['qqq_close']  is not None else None,
            'qqq_sma200':  round(float(row['qqq_sma200']), 4) if row['qqq_sma200'] is not None else None,
            'qqq_vol20':   round(float(row['qqq_vol20']),  6) if row['qqq_vol20']  is not None else None,
            'qqq_ret5d':   round(float(row['qqq_ret5d']),  6) if row['qqq_ret5d']  is not None else None,
            'trend_state': (
                'ABOVE' if (row['qqq_close'] is not None and row['qqq_sma200'] is not None
                            and float(row['qqq_close']) >= float(row['qqq_sma200']))
                else 'BELOW' if (row['qqq_close'] is not None and row['qqq_sma200'] is not None)
                else None
            ),
            'drawdown': drawdowns[i],
        }
        snapshots.append(snap)

    result = {
        'generated_at': datetime.datetime.now().isoformat(timespec='seconds'),
        'count':        len(snapshots),
        'snapshots':    snapshots,
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    out_path = os.path.join(CACHE_DIR, 'snapshots_120d.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    non_null_gate  = [s for s in snapshots if s['gate_score'] is not None]
    non_null_trend = [s for s in snapshots if s['trend_state'] is not None]
    print(f"[build_snapshots_120d] DONE -> {out_path}")
    print(f"  total: {len(snapshots)}  with_gate: {len(non_null_gate)}  with_trend: {len(non_null_trend)}")
    if snapshots:
        latest = snapshots[-1]
        print(f"  latest: {latest['date']} | gate={latest['gate_score']} | "
              f"risk={latest['risk_level']} | trend={latest['trend_state']} | dd={latest['drawdown']}%")


if __name__ == '__main__':
    main()
