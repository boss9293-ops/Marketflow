"""
build_overview.py  v1.1
Builds enriched overview.json into output/cache/overview.json.

Smart fallback strategy (handles NULL gate_score in latest daily_snapshots rows):
  1. latest_date    always the most recent date in daily_snapshots
  2. gate_score     latest NON-NULL gate_score row (backfill)
  3. gate_avg10d    latest gate_score_10d_avg (always populated)
  4. gate_delta5d   gate_delta_5d from gate row; or computed inline
  5. risk_level     latest NON-NULL, or derived from portfolio_volatility
  6. market_phase   latest NON-NULL
  7. trend_state    QQQ close vs SMA200 (DB query)
  8. cvar95_port    from risk_metrics.json (SPY VaR95)

Output is backwards-compatible with OverviewCache type in page.tsx.
Overwrites output/cache/overview.json after build_cache_json.py.
"""
import os
import json
import sqlite3
import datetime
import sys


def _find_root():
    """Find project root that has marketflow.db (handles Korean path encoding)."""
    _cand = os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
    if os.path.exists(os.path.join(_cand, 'data', 'marketflow.db')):
        return _cand
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
BASE       = _find_root()
BACKEND    = os.path.join(BASE, 'backend')
OUTPUT_DIR = os.path.join(BACKEND, 'output')
CACHE_DIR  = os.path.join(BACKEND, 'output', 'cache')
DB_PATH    = os.path.join(BASE, 'data', 'marketflow.db')


def load_json(filename: str):
    for p in [os.path.join(OUTPUT_DIR, filename), os.path.join(CACHE_DIR, filename)]:
        try:
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            continue
    return {}


def qone(cur, sql, params=()):
    cur.execute(sql, params)
    row = cur.fetchone()
    if row is None:
        return {}
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, row))


# ── DB queries ─────────────────────────────────────────────────────────────────
def get_latest_gate_row(cur):
    return qone(cur, """
        SELECT date, market_phase, gate_score, risk_level, risk_trend,
               gate_score_10d_avg, gate_score_30d_avg, gate_delta_5d,
               phase_shift_flag, total_stocks, vcp_count, rotation_count
        FROM daily_snapshots
        WHERE gate_score IS NOT NULL
        ORDER BY date DESC LIMIT 1
    """)

def get_latest_avg_row(cur):
    """Latest row where gate_score_10d_avg IS NOT NULL (more recent than gate row)."""
    return qone(cur, """
        SELECT date, gate_score_10d_avg, gate_score_30d_avg, gate_delta_5d,
               risk_trend, phase_shift_flag, total_stocks, risk_level
        FROM daily_snapshots
        WHERE gate_score_10d_avg IS NOT NULL
        ORDER BY date DESC LIMIT 1
    """)

def get_latest_date(cur):
    r = qone(cur, "SELECT MAX(date) AS d FROM daily_snapshots")
    return r.get('d')

def get_latest_risk_row(cur):
    return qone(cur, """
        SELECT date, risk_level, risk_trend
        FROM daily_snapshots WHERE risk_level IS NOT NULL
        ORDER BY date DESC LIMIT 1
    """)

def get_qqq_trend(cur):
    row = qone(cur, """
        SELECT o.close, i.sma200, o.date
        FROM ohlcv_daily o
        JOIN indicators_daily i ON o.symbol = i.symbol AND o.date = i.date
        WHERE o.symbol = 'QQQ'
          AND o.close IS NOT NULL AND i.sma200 IS NOT NULL
        ORDER BY o.date DESC LIMIT 1
    """)
    if not row:
        return None
    close  = float(row['close'])
    sma200 = float(row['sma200'])
    pct    = round((close - sma200) / sma200 * 100, 2)
    return {
        'trend_state':     'ABOVE' if close >= sma200 else 'BELOW',
        'qqq_close':       round(close, 2),
        'qqq_sma200':      round(sma200, 2),
        'pct_from_sma200': pct,
        'qqq_data_date':   row['date'],
    }

def get_active_alerts_today(cur, today: str) -> int:
    try:
        r = qone(cur, """
            SELECT COUNT(*) AS cnt FROM signals
            WHERE signal_type = 'SNAPSHOT_ALERT' AND date = ?
        """, (today,))
        return int(r.get('cnt') or 0)
    except Exception:
        return 0


def derive_risk_level(vol) -> str:
    if vol is None:
        return 'UNKNOWN'
    v = float(vol)
    return 'HIGH' if v > 25 else 'MEDIUM' if v > 15 else 'LOW'


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    print("[build_overview] Connecting to DB...")
    print(f"  BASE:      {BASE}")
    print(f"  DB_PATH:   {DB_PATH}")

    try:
        conn = sqlite3.connect(DB_PATH)
        cur  = conn.cursor()
    except Exception as e:
        print(f"  [ERROR] DB connect failed: {e}")
        sys.exit(1)

    latest_date   = get_latest_date(cur)
    gate_row      = get_latest_gate_row(cur)
    avg_row       = get_latest_avg_row(cur)
    risk_row      = get_latest_risk_row(cur)
    qqq_trend     = get_qqq_trend(cur)
    active_alerts = get_active_alerts_today(cur, latest_date or '')
    conn.close()

    print(f"  latest_date: {latest_date}")
    print(f"  gate_row:    date={gate_row.get('date')} gate={gate_row.get('gate_score')} phase={gate_row.get('market_phase')}")
    print(f"  avg_row:     date={avg_row.get('date')} avg10d={avg_row.get('gate_score_10d_avg')}")
    print(f"  risk_row:    date={risk_row.get('date')} risk_level={risk_row.get('risk_level')}")
    print(f"  qqq_trend:   {qqq_trend}")

    # Load risk_metrics.json
    rm          = load_json('risk_metrics.json')
    port_vol    = rm.get('portfolio_volatility')
    var95_map   = rm.get('var_95') or {}
    cvar95_spy  = var95_map.get('SPY') if isinstance(var95_map, dict) else None
    cvar95_qqq  = var95_map.get('QQQ') if isinstance(var95_map, dict) else None

    # Load market_gate.json for gate fallback
    mg          = load_json('market_gate.json')
    gate_fallback = mg.get('score')
    gate_status   = mg.get('status') or mg.get('signal') or ''

    # Assemble with smart fallbacks
    gate_score   = gate_row.get('gate_score') or gate_fallback
    gate_avg10d  = avg_row.get('gate_score_10d_avg')
    gate_delta5d = gate_row.get('gate_delta_5d')
    gate_date    = gate_row.get('date')

    # Compute delta inline if missing
    if gate_delta5d is None and gate_score is not None and gate_avg10d is not None:
        gate_delta5d = round(float(gate_score) - float(gate_avg10d), 1)

    market_phase = gate_row.get('market_phase')
    risk_level   = (risk_row.get('risk_level') or '').upper() or derive_risk_level(port_vol)
    risk_trend   = (gate_row.get('risk_trend')
                    or avg_row.get('risk_trend')
                    or risk_row.get('risk_trend'))
    total_stocks = avg_row.get('total_stocks') or gate_row.get('total_stocks') or 0
    vcp_count       = gate_row.get('vcp_count') or 0
    rotation_count  = gate_row.get('rotation_count') or 0
    phase_shift_flag = gate_row.get('phase_shift_flag') or avg_row.get('phase_shift_flag') or 0

    result = {
        'generated_at':   datetime.datetime.now().isoformat(timespec='seconds'),
        'data_version':   'overview_v2',
        # Backwards-compatible fields (OverviewCache)
        'latest_date':    latest_date,
        'market_phase':   market_phase,
        'gate_score':     gate_score,
        'risk_trend':     risk_trend,
        'risk_level':     risk_level,
        'total_stocks':   int(total_stocks or 0),
        'vcp_count':      int(vcp_count or 0),
        'rotation_count': int(rotation_count or 0),
        'active_snapshot_alerts_today': active_alerts,
        # Enriched fields (used by build_market_state.py)
        'gate_date':      gate_date,
        'gate_avg10d':    gate_avg10d,
        'gate_avg30d':    avg_row.get('gate_score_30d_avg'),
        'gate_delta5d':   gate_delta5d,
        'gate_status':    gate_status,
        'phase_shift_flag': int(phase_shift_flag or 0),
        # Risk enrichment
        'portfolio_volatility': port_vol,
        'cvar95_port':    cvar95_spy,
        'cvar95_qqq':     cvar95_qqq,
        # QQQ trend (pre-computed for build_market_state.py)
        'trend_state':      qqq_trend.get('trend_state')     if qqq_trend else None,
        'qqq_close':        qqq_trend.get('qqq_close')       if qqq_trend else None,
        'qqq_sma200':       qqq_trend.get('qqq_sma200')      if qqq_trend else None,
        'pct_from_sma200':  qqq_trend.get('pct_from_sma200') if qqq_trend else None,
        'qqq_data_date':    qqq_trend.get('qqq_data_date')   if qqq_trend else None,
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    out_path = os.path.join(CACHE_DIR, 'overview.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[build_overview] DONE -> {out_path}")
    print(f"  latest_date:  {result['latest_date']}")
    print(f"  market_phase: {result['market_phase']}  (from {gate_date})")
    print(f"  gate_score:   {result['gate_score']}  avg10d={result['gate_avg10d']}  delta5d={result['gate_delta5d']}")
    print(f"  risk_level:   {result['risk_level']}  risk_trend={result['risk_trend']}")
    print(f"  trend_state:  {result['trend_state']}  QQQ={result['qqq_close']}  SMA200={result['qqq_sma200']}  ({result['pct_from_sma200']}%)")
    print(f"  port_vol:     {result['portfolio_volatility']}%  cvar95_spy={result['cvar95_port']}")


if __name__ == '__main__':
    main()
