"""
build_market_state.py  v1.3
Aggregates 5 System State Bar pills into output/cache/market_state.json.

Pills:
  PHASE  Regime classifier          (market_regime.json)
  GATE   Risk Gate score             (overview.json [v2] -> market_gate.json fallback)
  RISK   Portfolio risk level        (overview.json -> risk_metrics.json fallback)
  TREND  QQQ vs SMA200               (overview.json pre-computed -> DB fallback)
  VR     Stub "OFF"                  (until build_vr_cache.py exists)

Dependency order in run_all.py:
  build_snapshots_120d.py -> build_overview.py -> build_market_state.py
"""
import os
import json
import sqlite3
import datetime
import sys

# Force UTF-8 output on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


# ── Paths ──────────────────────────────────────────────────────────────────────
_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
BASE         = os.path.dirname(_SCRIPTS_DIR)   # backend dir (= /app on Railway)
OUTPUT_DIR   = os.path.join(BASE, 'output')
CACHE_DIR    = os.path.join(BASE, 'output', 'cache')
try:
    from db_utils import resolve_marketflow_db
    DB_PATH = resolve_marketflow_db(data_plane="live")
except Exception:
    DB_PATH = os.path.join(BASE, 'data', 'marketflow.db')


def load_json(filename: str, fallback=None):
    for p in [os.path.join(OUTPUT_DIR, filename), os.path.join(CACHE_DIR, filename)]:
        try:
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            continue
    return fallback or {}


# ── PHASE ──────────────────────────────────────────────────────────────────────
def build_phase(regime: dict, overview: dict) -> dict:
    trend      = regime.get('trend')         or ''
    appetite   = regime.get('risk_appetite') or ''
    confidence = regime.get('confidence')    or ''
    fallback   = (overview.get('market_phase') or '').upper()

    t = trend.upper()
    if   'BULL' in t: value = 'BULL'
    elif 'BEAR' in t: value = 'BEAR'
    elif trend:       value = 'TRANS'
    elif 'BULL' in fallback: value = 'BULL'
    elif 'BEAR' in fallback: value = 'BEAR'
    elif fallback in ('NEUTRAL', 'TRANS'): value = 'TRANS'
    else: value = 'UNKNOWN'

    color = '#22c55e' if value == 'BULL' else '#ef4444' if value == 'BEAR' else '#f59e0b'
    app_s = 'On' if 'ON' in appetite.upper() else 'Off' if 'OFF' in appetite.upper() else appetite or '--'
    return {
        'value':  value, 'label': value, 'color': color,
        'detail': f"Regime: {trend or fallback or '--'} | Appetite: Risk {app_s} | Conf: {confidence or '--'}",
        'source': 'regime_classifier',
    }


# ── GATE ───────────────────────────────────────────────────────────────────────
def build_gate(market_gate: dict, overview: dict) -> dict:
    gate    = overview.get('gate_score') if overview else None
    if gate is None:
        gate = market_gate.get('score')

    avg10d  = overview.get('gate_avg10d')
    delta5d = overview.get('gate_delta5d')
    if delta5d is None and gate is not None and avg10d is not None:
        delta5d = round(float(gate) - float(avg10d), 1)

    gate_s  = f"{float(gate):.1f}"    if gate   is not None else '--'
    avg_s   = f"{float(avg10d):.1f}"  if avg10d is not None else '--'
    delta_s = (f"+{delta5d:.1f}" if delta5d >= 0 else f"{delta5d:.1f}") if delta5d is not None else '--'

    color  = '#22c55e' if (gate or 0) >= 60 else '#f59e0b' if (gate or 0) >= 40 else '#ef4444'
    if gate is None: color = '#6b7280'
    status = overview.get('gate_status') or market_gate.get('status') or market_gate.get('signal') or ''
    detail = f"10d avg {avg_s} | delta5d {delta_s}"
    if status: detail = f"{status} | {detail}"

    return {
        'value': gate, 'label': gate_s, 'avg10d': avg10d, 'delta5d': delta5d,
        'color': color, 'detail': detail,
        'source': 'overview_v2' if overview.get('data_version') == 'overview_v2' else 'market_gate',
    }


# ── RISK ───────────────────────────────────────────────────────────────────────
def build_risk(overview: dict, risk_metrics: dict) -> dict:
    vol        = overview.get('portfolio_volatility') or risk_metrics.get('portfolio_volatility')
    risk_level = (overview.get('risk_level') or '').upper()
    var95_spy  = overview.get('cvar95_port')
    var95_qqq  = overview.get('cvar95_qqq')
    if var95_spy is None:
        vm = risk_metrics.get('var_95') or {}
        var95_spy = vm.get('SPY') if isinstance(vm, dict) else None
        var95_qqq = vm.get('QQQ') if isinstance(vm, dict) else None

    if risk_level not in ('HIGH', 'MEDIUM', 'LOW'):
        risk_level = 'UNKNOWN' if vol is None else \
                     'HIGH' if float(vol) > 25 else \
                     'MEDIUM' if float(vol) > 15 else 'LOW'

    color = {'HIGH': '#ef4444', 'MEDIUM': '#f59e0b', 'LOW': '#22c55e'}.get(risk_level, '#6b7280')
    label = {'HIGH': 'HIGH', 'MEDIUM': 'MED', 'LOW': 'LOW'}.get(risk_level, risk_level)

    vol_s = f"{float(vol):.1f}%"       if vol      is not None else '--'
    spy_s = f"{float(var95_spy):.2f}%" if var95_spy is not None else '--'
    qqq_s = f" | QQQ VaR95 {float(var95_qqq):.2f}%" if var95_qqq is not None else ''

    return {
        'value': risk_level, 'label': label, 'vol_pct': vol, 'var95': var95_spy,
        'color': color, 'detail': f"Port.Vol {vol_s} | SPY VaR95 {spy_s}{qqq_s} | Level {risk_level}",
        'source': 'overview_v2' if overview.get('data_version') == 'overview_v2' else 'risk_calculator',
    }


# ── TREND ──────────────────────────────────────────────────────────────────────
def build_trend(overview: dict) -> dict:
    # Use pre-computed value from build_overview.py if available
    ts = overview.get('trend_state')
    if ts in ('ABOVE', 'BELOW'):
        close  = overview.get('qqq_close')
        sma200 = overview.get('qqq_sma200')
        pct    = overview.get('pct_from_sma200')
        date_s = overview.get('qqq_data_date') or overview.get('latest_date')
        above  = ts == 'ABOVE'
        color  = '#22c55e' if above else '#ef4444'
        label  = 'SMA200+' if above else 'SMA200-'
        sign   = '+' if (pct or 0) >= 0 else ''
        cmp    = '>' if above else '<'
        return {
            'value': ts, 'label': label,
            'qqq_close': close, 'qqq_sma200': sma200, 'pct_from_sma200': pct, 'data_date': date_s,
            'color': color, 'detail': f"QQQ {close} {cmp} SMA200 {sma200} ({sign}{pct}%) [{date_s}]",
            'source': 'overview_v2',
        }

    # Fallback: direct DB query
    print("  [TREND] Falling back to DB query...")
    try:
        conn = sqlite3.connect(DB_PATH)
        cur  = conn.cursor()
        cur.execute("""
            SELECT o.close, i.sma200, o.date
            FROM ohlcv_daily o
            JOIN indicators_daily i ON o.symbol = i.symbol AND o.date = i.date
            WHERE o.symbol = 'QQQ' AND o.close IS NOT NULL AND i.sma200 IS NOT NULL
            ORDER BY o.date DESC LIMIT 1
        """)
        row = cur.fetchone()
        conn.close()
    except Exception as e:
        print(f"  [TREND] DB error: {e}")
        row = None

    if row is None:
        return {'value': 'UNKNOWN', 'label': 'SMA200?', 'color': '#6b7280',
                'detail': 'QQQ SMA200 data not available', 'source': 'ohlcv_db'}

    close, sma200, date_s = float(row[0]), float(row[1]), row[2]
    pct   = round((close - sma200) / sma200 * 100, 2)
    above = close >= sma200
    color = '#22c55e' if above else '#ef4444'
    sign  = '+' if pct >= 0 else ''
    cmp   = '>' if above else '<'
    return {
        'value': 'ABOVE' if above else 'BELOW', 'label': 'SMA200+' if above else 'SMA200-',
        'qqq_close': round(close, 2), 'qqq_sma200': round(sma200, 2),
        'pct_from_sma200': pct, 'data_date': date_s, 'color': color,
        'detail': f"QQQ {close:.2f} {cmp} SMA200 {sma200:.2f} ({sign}{pct}%) [{date_s}]",
        'source': 'ohlcv_db',
    }


# ── VR ─────────────────────────────────────────────────────────────────────────
def build_vr() -> dict:
    return {
        'value': 'OFF', 'label': 'VR OFF', 'color': '#6b7280',
        'detail': 'Stub. Run build_vr_cache.py for live VR energy data.',
        'source': 'stub',
    }


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    print("[build_market_state v1.3] Starting...")
    print(f"  BASE:       {BASE}")
    print(f"  OUTPUT_DIR: {OUTPUT_DIR}")

    regime       = load_json('market_regime.json')
    market_gate  = load_json('market_gate.json')
    risk_metrics = load_json('risk_metrics.json')
    overview     = load_json('cache/overview.json')

    ver = overview.get('data_version', 'n/a')
    print(f"  overview ver:  {ver}")
    print(f"  regime trend:  {regime.get('trend')}  appetite: {regime.get('risk_appetite')}")
    print(f"  gate_score:    {overview.get('gate_score')}  avg10d={overview.get('gate_avg10d')}  delta5d={overview.get('gate_delta5d')}")
    print(f"  risk_level:    {overview.get('risk_level')}  vol={overview.get('portfolio_volatility')}")
    print(f"  trend_state:   {overview.get('trend_state')}  QQQ={overview.get('qqq_close')}  SMA200={overview.get('qqq_sma200')}")

    phase = build_phase(regime, overview)
    gate  = build_gate(market_gate, overview)
    risk  = build_risk(overview, risk_metrics)
    trend = build_trend(overview)
    vr    = build_vr()

    data_date = (overview.get('latest_date')
                 or overview.get('gate_date')
                 or trend.get('data_date'))

    result = {
        'generated_at': datetime.datetime.now().isoformat(timespec='seconds'),
        'data_date':    data_date,
        'cache_policy': 'daily_close',
        'phase': phase, 'gate': gate, 'risk': risk, 'trend': trend, 'vr': vr,
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    out_path = os.path.join(CACHE_DIR, 'market_state.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[build_market_state] DONE -> {out_path}")
    print(f"  PHASE : {phase['label']:8}  {phase['detail']}")
    print(f"  GATE  : {gate['label']:8}  {gate['detail']}")
    print(f"  RISK  : {risk['label']:8}  {risk['detail']}")
    print(f"  TREND : {trend['label']:8}  {trend['detail']}")
    print(f"  VR    : {vr['label']:8}  {vr['detail']}")


if __name__ == '__main__':
    main()
