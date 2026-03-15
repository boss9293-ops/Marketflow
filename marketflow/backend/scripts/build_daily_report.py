"""
build_daily_report.py — AI Daily Report v1.1 (Rule-Based, Cache-Only)

Inputs (all from backend/output/):
  market_data.json      → indices / bonds / currencies / volatility / commodities
  market_gate.json      → gate score / status / signal
  hot_zone.json         → leaders / trending (v2, legacy keys still supported)
  sector_rotation.json  → phase / leading / lagging / sector_perf
  risk_metrics.json     → var_95 / max_drawdown / portfolio_volatility
  market_regime.json    → trend / risk_appetite / volatility / strategy
  smart_money.json      → signals (recent institutional activity)
  vcp_signals.json      → VCP pattern alerts
  top_picks.json        → screener top stocks

Output:
  output/daily_report.json

v1.1 changes:
  - _calc_tone(): bearish requires ≥2 confirming conditions
  - _apply_alert_budget(): priority sort, dedup by type, max ALERT_BUDGET=3
  - _risk_level_from_gate(): Gate-only risk_level (regime adds context only)
  - 7-bullet Korean briefing (bullets ①-⑦ + action_hint)
  - tone_reason_codes array, raw_signals
  - alerts_hidden_count, raw_alert_count
  - _simulate_tone_distribution() validation helper
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


# ── paths ─────────────────────────────────────────────────────────────────────
def _output_dir() -> str:
    return os.path.join(os.path.dirname(__file__), '..', 'output')


def _load(filename: str) -> Optional[Dict[str, Any]]:
    path = os.path.join(_output_dir(), filename)
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _load_cache(filename: str) -> Optional[Dict[str, Any]]:
    """Load cache JSON from repo-level output/cache with fallback paths."""
    candidates = [
        os.path.join(os.path.dirname(__file__), '..', '..', 'output', 'cache', filename),
        os.path.join(_output_dir(), 'cache', filename),
    ]
    for path in candidates:
        full_path = os.path.abspath(path)
        if not os.path.exists(full_path):
            continue
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict):
                return data
        except Exception:
            continue
    return None


def _write(filename: str, data: Any) -> str:
    path = os.path.join(_output_dir(), filename)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return path


# ── helpers ───────────────────────────────────────────────────────────────────
def _fmt_pct(v: Optional[float], sign: bool = True) -> str:
    if v is None:
        return 'N/A'
    prefix = '+' if (sign and v > 0) else ''
    return f"{prefix}{v:.2f}%"


def _sign_word(v: Optional[float], up='상승', dn='하락', flat='보합') -> str:
    if v is None:
        return flat
    if v > 0.05:
        return up
    if v < -0.05:
        return dn
    return flat


ETF_NAMES = {
    'XLK': 'Technology', 'XLV': 'Healthcare', 'XLF': 'Financials',
    'XLE': 'Energy', 'XLY': 'Consumer Discret.', 'XLP': 'Consumer Staples',
    'XLI': 'Industrials', 'XLB': 'Materials', 'XLRE': 'Real Estate',
    'XLU': 'Utilities', 'XLC': 'Communication',
}

# ── v1.1: alert budget ─────────────────────────────────────────────────────────
ALERT_BUDGET = 3
_ALERT_PRIORITY: Dict[str, int] = {
    'STRUCTURAL': 0,
    'EVENT': 1,
    'VCP': 2,
    'SMART_MONEY': 3,
}


def _apply_alert_budget(raw_alerts: List[Dict]) -> Tuple[List[Dict], int]:
    """Sort by priority, dedup by type, limit to ALERT_BUDGET.
    Returns (visible_alerts, hidden_count).
    """
    sorted_alerts = sorted(raw_alerts, key=lambda a: _ALERT_PRIORITY.get(a.get('type', ''), 99))
    seen_types: set = set()
    visible: List[Dict] = []
    for a in sorted_alerts:
        a_type = a.get('type', '')
        if a_type not in seen_types:
            visible.append(a)
            seen_types.add(a_type)
        if len(visible) >= ALERT_BUDGET:
            break
    hidden_count = len(raw_alerts) - len(visible)
    return visible, max(0, hidden_count)


# ── v1.1: tone calculation (conservative bearish) ─────────────────────────────
def _calc_tone(
    spy_chg: Optional[float],
    qqq_chg: Optional[float],
    vix: Optional[float],
    gate_score: Optional[float],
    gate_status: str,
    raw_signals: List[str],
    regime_risk_appetite: str,
) -> Tuple[str, List[str]]:
    """bearish requires ≥2 confirming conditions from the bearish list.
    Single Risk Off alone → neutral.
    Returns (tone, tone_reason_codes).
    """
    avg_move = ((spy_chg or 0) + (qqq_chg or 0)) / 2 if (spy_chg is not None and qqq_chg is not None) else None

    bearish_conditions: List[str] = []
    bullish_conditions: List[str] = []

    # Index movement
    if avg_move is not None:
        if avg_move <= -0.8:
            bearish_conditions.append('INDEX_DOWN')
        elif avg_move >= 0.8:
            bullish_conditions.append('INDEX_UP')

    # Gate
    if gate_score is not None:
        if gate_score < 40:
            bearish_conditions.append('GATE_RED')
        elif gate_score >= 65:
            bullish_conditions.append('GATE_GREEN')

    # VIX
    if vix is not None:
        if vix >= 30:
            bearish_conditions.append('VIX_FEAR')
        elif vix >= 25:
            bearish_conditions.append('VIX_HIGH')
        elif vix < 15:
            bullish_conditions.append('VIX_LOW')

    # Regime risk appetite
    if 'Risk Off' in regime_risk_appetite:
        bearish_conditions.append('REGIME_RISK_OFF')
    elif 'Risk On' in regime_risk_appetite:
        bullish_conditions.append('REGIME_RISK_ON')

    # Decide tone — bearish requires ≥2 conditions
    if len(bearish_conditions) >= 2:
        return 'bearish', bearish_conditions
    if bullish_conditions and len(bearish_conditions) == 0:
        return 'bullish', bullish_conditions
    # Mixed or single bearish signal → neutral
    return 'neutral', bearish_conditions + bullish_conditions


# ── v1.1: risk level from gate only ───────────────────────────────────────────
def _risk_level_from_gate(gate_score: Optional[float]) -> str:
    """Gate score is sole determinant of risk_level.
    Regime adds context lines but cannot force risk_level high.
    """
    if gate_score is None:
        return 'medium'
    if gate_score < 40:
        return 'high'
    if gate_score >= 60:
        return 'low'
    return 'medium'


# ══ A) market_summary ═════════════════════════════════════════════════════════
def build_market_summary(
    md: Optional[Dict],
    gate: Optional[Dict],
    regime: Optional[Dict],
) -> Dict[str, Any]:
    raw_data: Dict[str, Any] = {}
    raw_signals: List[str] = []

    spy_chg = qqq_chg = vix = None
    tnx_p = tnx_c = None
    dxy_p = dxy_c = None
    gold_p = oil_p = None
    iwm_chg = None

    if md:
        idx = md.get('indices', {})
        spy = idx.get('SPY', {})
        qqq = idx.get('QQQ', {})
        iwm = idx.get('IWM', {})
        spy_chg = spy.get('change_pct')
        qqq_chg = qqq.get('change_pct')
        iwm_chg = iwm.get('change_pct')
        raw_data['spy_chg'] = spy_chg
        raw_data['qqq_chg'] = qqq_chg
        raw_data['spy_price'] = spy.get('price')
        raw_data['qqq_price'] = qqq.get('price')
        raw_data['iwm_price'] = iwm.get('price')
        raw_data['iwm_chg'] = iwm_chg

        bonds = md.get('bonds', {})
        tnx = bonds.get('^TNX', {})
        tnx_p = tnx.get('price')
        tnx_c = tnx.get('change_pct')
        raw_data['tnx_price'] = tnx_p

        currencies = md.get('currencies', {})
        dxy = currencies.get('DX-Y.NYB', {})
        dxy_p = dxy.get('price')
        dxy_c = dxy.get('change_pct')
        raw_data['dxy_price'] = dxy_p

        vix_d = md.get('volatility', {}).get('^VIX', {})
        vix = vix_d.get('price')
        raw_data['vix'] = vix

        comm = md.get('commodities', {})
        gold_p = comm.get('GC=F', {}).get('price')
        oil_p  = comm.get('CL=F', {}).get('price')
        raw_data['gold_price'] = gold_p
        raw_data['oil_price'] = oil_p

        if tnx_p and tnx_p > 4.5:
            raw_signals.append('HIGH_RATE')
        if vix:
            if vix >= 30:
                raw_signals.append('FEAR')
            elif vix >= 20:
                raw_signals.append('CAUTION')

    gate_score = None
    gate_status = 'YELLOW'
    gate_signal = ''
    if gate:
        gate_score = gate.get('score')
        gate_status = gate.get('status', 'YELLOW')
        gate_signal = gate.get('signal', '')
        if gate_score is not None:
            if gate_score < 40:
                raw_signals.append('GATE_RED')
            elif gate_score < 60:
                raw_signals.append('GATE_YELLOW')
            else:
                raw_signals.append('GATE_GREEN')
        raw_data['gate_score'] = gate_score
        raw_data['gate_status'] = gate_status

    regime_risk_appetite = ''
    regime_label = ''
    strategy = ''
    if regime:
        trend = regime.get('trend', '')
        regime_risk_appetite = regime.get('risk_appetite', '')
        vol_label = regime.get('volatility', '')
        strategy = regime.get('strategy', '')
        regime_label = f"{trend} / {regime_risk_appetite} / {vol_label}"
        if 'Risk Off' in regime_risk_appetite:
            raw_signals.append('REGIME_RISK_OFF')
        elif 'Risk On' in regime_risk_appetite:
            raw_signals.append('REGIME_RISK_ON')

    # v1.1: tone calculation with ≥2 bearish rule
    overall_tone, tone_reason_codes = _calc_tone(
        spy_chg, qqq_chg, vix, gate_score, gate_status, raw_signals, regime_risk_appetite
    )

    tone_map = {'bullish': '강세', 'bearish': '약세', 'neutral': '혼조'}

    # ── v1.1: 7-bullet Korean briefing ①-⑦ ──────────────────────────────────
    bullets: List[str] = []

    # ① 주요 지수
    if raw_data.get('spy_price') or raw_data.get('qqq_price'):
        parts = []
        if raw_data.get('spy_price'):
            parts.append(f"S&P500 {_fmt_pct(spy_chg)}")
        if raw_data.get('qqq_price'):
            parts.append(f"Nasdaq100 {_fmt_pct(qqq_chg)}")
        if raw_data.get('iwm_price'):
            parts.append(f"Russell2000 {_fmt_pct(iwm_chg)}")
        bullets.append('① 지수: ' + ', '.join(parts))
    else:
        bullets.append('① 지수: 데이터 없음')

    # ② 금리
    if tnx_p:
        tnx_dir = _sign_word(tnx_c, '상승', '하락', '보합')
        tnx_warn = ' ⚠ 고금리 부담' if tnx_p > 4.5 else ''
        bullets.append(f'② 금리: 미국 10Y {tnx_p:.2f}% ({tnx_dir} {_fmt_pct(tnx_c)}){tnx_warn}')
    else:
        bullets.append('② 금리: 데이터 없음')

    # ③ 심리 (달러 + VIX)
    if dxy_p and vix:
        dxy_dir = _sign_word(dxy_c, '강세', '약세', '보합')
        if vix >= 30:
            vix_label = '공포 구간 ⚠'
        elif vix >= 20:
            vix_label = '경계 구간'
        else:
            vix_label = '안정 구간'
        bullets.append(f'③ 심리: 달러(DXY) {dxy_p:.1f} {dxy_dir} / VIX {vix:.1f} {vix_label}')
    elif vix:
        vix_label = '공포 구간 ⚠' if vix >= 30 else ('경계 구간' if vix >= 20 else '안정 구간')
        bullets.append(f'③ 심리: VIX {vix:.1f} {vix_label}')
    else:
        bullets.append('③ 심리: 데이터 없음')

    # ④ 원자재
    if gold_p and oil_p:
        bullets.append(f'④ 원자재: 금 ${gold_p:,.0f} / WTI원유 ${oil_p:.1f}')
    elif gold_p:
        bullets.append(f'④ 원자재: 금 ${gold_p:,.0f}')
    else:
        bullets.append('④ 원자재: 데이터 없음')

    # ⑤ 게이트
    if gate_score is not None:
        status_map = {'GREEN': '투자 적극', 'YELLOW': '선별 투자', 'RED': '방어 대응'}
        gate_label = status_map.get(gate_status, gate_status)
        gate_emoji = '🟢' if gate_status == 'GREEN' else ('🔴' if gate_status == 'RED' else '🟡')
        bullets.append(f'⑤ 게이트: Score {gate_score}/100 {gate_emoji} {gate_label}')
    else:
        bullets.append('⑤ 게이트: 데이터 없음')

    # ⑥ 국면
    if regime_label:
        bullets.append(f'⑥ 국면: {regime_label}')
    else:
        bullets.append('⑥ 국면: 데이터 없음')

    # ⑦ 전략 + action hint
    action_hint = _derive_action_hint(overall_tone, gate_score, gate_status, regime_risk_appetite, strategy, raw_signals)
    bullets.append(f'⑦ 전략: {action_hint}')

    # legacy lines (kept for backward compatibility)
    lines: List[str] = []
    if raw_data.get('spy_price'):
        idx_parts = []
        if raw_data.get('spy_price'):
            idx_parts.append(f"S&P 500 {_fmt_pct(spy_chg)}")
        if raw_data.get('qqq_price'):
            idx_parts.append(f"Nasdaq 100 {_fmt_pct(qqq_chg)}")
        if raw_data.get('iwm_price'):
            idx_parts.append(f"Russell 2000 {_fmt_pct(iwm_chg)}")
        if idx_parts:
            lines.append('주요 지수: ' + ', '.join(idx_parts))
    if tnx_p:
        lines.append(f"미국 10Y 국채금리 {tnx_p:.2f}% ({_sign_word(tnx_c, '상승', '하락', '보합')} {_fmt_pct(tnx_c)})")
    if dxy_p:
        lines.append(f"달러인덱스(DXY) {dxy_p:.2f} — 달러 {_sign_word(dxy_c, '강세', '약세', '보합')}")
    if vix:
        vix_lbl2 = '공포 구간' if vix >= 30 else ('경계 구간' if vix >= 20 else '안정 구간')
        lines.append(f"VIX {vix:.1f} — 시장 변동성 {vix_lbl2}")
    if gold_p and oil_p:
        lines.append(f"금 ${gold_p:,.0f}, WTI원유 ${oil_p:.1f}")
    if gate_score is not None:
        status_map2 = {'GREEN': '투자 적극', 'YELLOW': '선별 투자', 'RED': '방어적 대응'}
        lines.append(f"Market Gate Score {gate_score}/100 ({status_map2.get(gate_status, gate_status)}) — {gate_signal}")
    if regime_label and strategy:
        lines.append(f"시장 국면: {regime_label}. 전략: {strategy}")

    return {
        'lines': lines,
        'bullets': bullets,
        'action_hint': action_hint,
        'overall_tone': overall_tone,
        'overall_tone_label': tone_map.get(overall_tone, overall_tone),
        'tone_reason_codes': tone_reason_codes,
        'gate_score': gate_score,
        'gate_signal': gate_signal,
        'regime_label': regime_label,
        'signals': raw_signals,
        'raw_signals': raw_signals,
    }


def _derive_action_hint(
    tone: str,
    gate_score: Optional[float],
    gate_status: str,
    regime_risk_appetite: str,
    strategy: str,
    raw_signals: List[str],
) -> str:
    """Concise Korean action hint based on tone + gate + regime."""
    if strategy:
        return strategy
    if tone == 'bearish':
        return '현금 비중 확대 / 포지션 축소 권장'
    if tone == 'bullish':
        if gate_status == 'GREEN':
            return '적극 매수 탐색 / 상승 추세 추종'
        return '선별 매수 / 고AI점수 종목 중심'
    # neutral
    if gate_score is not None and gate_score >= 60:
        return '선별 접근 / 고확신 셋업만 진입'
    if 'GATE_RED' in raw_signals or (gate_score is not None and gate_score < 40):
        return '현금 유지 / 추가 하락 대비'
    return '관망 또는 소규모 포지션 / 시장 방향 확인 후 진입'


# ══ B) hot_stocks_brief ═══════════════════════════════════════════════════════
def _stock_comment(stock: Dict) -> str:
    """1줄 룰 기반 코멘트 생성"""
    parts = []
    chg = stock.get('change_pct') or stock.get('change_1d')
    vol = stock.get('vol_ratio')
    score = stock.get('ai_score')
    rsi = stock.get('rsi') or stock.get('rsi14')
    tags = stock.get('tags', [])

    if chg is not None and chg >= 3:
        parts.append(f"급등 +{chg:.1f}%")
    elif chg is not None and chg >= 1.5:
        parts.append(f"상승 +{chg:.1f}%")
    elif chg is not None and chg <= -3:
        parts.append(f"급락 {chg:.1f}%")

    if vol is not None and vol >= 3:
        parts.append(f"거래량 {vol:.1f}x ↑↑")
    elif vol is not None and vol >= 1.5:
        parts.append(f"거래량 {vol:.1f}x ↑")

    if score is not None and score >= 80:
        parts.append(f"AI Score {score:.0f}+")
    elif score is not None and score >= 60:
        parts.append(f"AI Score {score:.0f}")

    if rsi is not None:
        if rsi >= 70:
            parts.append(f"RSI 과매수({rsi:.0f})")
        elif rsi <= 30:
            parts.append(f"RSI 과매도({rsi:.0f})")
        elif 50 <= rsi < 65:
            parts.append(f"RS 강세({rsi:.0f})")

    if 'ETF' in tags:
        parts.append("ETF Leader")
    if 'HOT' in tags:
        parts.append("HOT")

    return ' · '.join(parts) if parts else '주목 종목'


def build_hot_stocks_brief(hz: Optional[Dict]) -> List[Dict]:
    """hot_zone 상위 10개 → 1줄 코멘트"""
    if not hz:
        return []

    pool: Dict[str, Dict] = {}
    for key in ('leaders', 'trending', 'gainers', 'ai_picks', 'volume_spike', 'etf_leaders'):
        for s in hz.get(key, []):
            sym = s.get('symbol') or s.get('ticker', '')
            if sym and sym not in pool:
                pool[sym] = s

    stocks = sorted(pool.values(),
                    key=lambda x: (-(x.get('hot_score') or 0),
                                   -(x.get('ai_score') or 0),
                                   -(x.get('change_pct') or x.get('change_1d') or 0)))
    top10 = stocks[:10]

    result = []
    for s in top10:
        sym = s.get('symbol') or s.get('ticker', '')
        result.append({
            'symbol': sym,
            'price': s.get('price'),
            'change_pct': s.get('change_pct') or s.get('change_1d'),
            'vol_ratio': s.get('vol_ratio'),
            'ai_score': s.get('ai_score'),
            'rsi': s.get('rsi') or s.get('rsi14'),
            'tags': s.get('tags', []),
            'comment': _stock_comment(s),
        })
    return result


# ══ C) sector_brief ═══════════════════════════════════════════════════════════
_PHASE_INTERP = {
    'early_recovery': '경기 회복 초기 — 소재/에너지/금융 강세 예상',
    'expansion':      '경기 확장 국면 — 기술/산업재/임의소비재 강세 예상',
    'peak':           '경기 정점 국면 — 에너지/소재 유지, 성장주 경계',
    'slowdown':       '경기 둔화 국면 — 경기방어(필수소비/유틸/헬스케어) 선호',
    'unknown':        '국면 미확정 — 분산 대응 권장',
}


def build_sector_brief(sr: Optional[Dict]) -> Dict[str, Any]:
    if not sr:
        return {'phase': 'unknown', 'lines': [], 'leaders': [], 'laggers': []}

    phase = sr.get('phase', 'unknown')
    phase_label = sr.get('phase_label', phase)
    phase_color = sr.get('phase_color', '#6b7280')
    leading = sr.get('leading_sectors', [])
    lagging = sr.get('lagging_sectors', [])
    sp = sr.get('sector_perf', [])

    sp_map = {s['symbol']: s for s in sp}

    def _enrich(sym: str) -> Dict:
        s = sp_map.get(sym, {})
        return {
            'symbol': sym,
            'name': ETF_NAMES.get(sym, sym),
            'change_1d': s.get('change_1d'),
            'change_3m': s.get('change_3m'),
        }

    leaders = [_enrich(s) for s in leading]
    laggers = [_enrich(s) for s in lagging]
    interp = _PHASE_INTERP.get(phase, _PHASE_INTERP['unknown'])

    lines = [f"현재 경기 국면: {phase_label} — {interp}"]
    if leaders:
        l_names = ', '.join(ETF_NAMES.get(s, s) for s in leading)
        lines.append(f"리더 섹터: {l_names}")
    if laggers:
        lg_names = ', '.join(ETF_NAMES.get(s, s) for s in lagging)
        lines.append(f"약세 섹터: {lg_names}")

    cov = sr.get('coverage', {})
    cov_pct = sr.get('coverage_ratio')
    if cov_pct is not None:
        lines.append(f"DB 커버리지 {cov_pct:.0f}% ({cov.get('ohlcv_symbols', 0)}/{cov.get('total_universe', 0)} 종목)")

    return {
        'phase': phase,
        'phase_label': phase_label,
        'phase_color': phase_color,
        'interp': interp,
        'leaders': leaders,
        'laggers': laggers,
        'lines': lines,
    }


# ══ D) risk_brief ═════════════════════════════════════════════════════════════
def build_risk_brief(
    gate: Optional[Dict],
    risk: Optional[Dict],
    regime: Optional[Dict],
    sm: Optional[Dict],
    vcp: Optional[Dict],
) -> Dict[str, Any]:

    lines: List[str] = []
    raw_alerts: List[Dict] = []

    # v1.1: Gate-only risk_level
    gate_score = None
    gate_status = 'YELLOW'
    if gate:
        gate_score = gate.get('score')
        gate_status = gate.get('status', 'YELLOW')
        if gate_score is not None:
            if gate_score < 40:
                lines.append(f"Gate Score {gate_score} — 매우 방어적 대응 필요")
            elif gate_score < 60:
                lines.append(f"Gate Score {gate_score} — 선별 투자, 리스크 관리")
            else:
                lines.append(f"Gate Score {gate_score} — 적극 투자 신호")

        comp = gate.get('components', {})
        low_comps = [k for k, v in comp.items() if isinstance(v, (int, float)) and v < 10]
        if low_comps:
            lines.append(f"약한 구성 요소: {', '.join(low_comps)}")

    risk_level = _risk_level_from_gate(gate_score)

    # VaR / DrawDown
    if risk:
        spy_var = (risk.get('var_95') or {}).get('SPY')
        spy_dd  = (risk.get('max_drawdown') or {}).get('SPY')
        if spy_var is not None:
            lines.append(f"SPY VaR(95%) {spy_var:.2f}% / 최대낙폭 {spy_dd:.2f}%")

    # Regime — adds context lines only, does NOT affect risk_level
    if regime:
        risk_app = regime.get('risk_appetite', '')
        vol_lbl  = regime.get('volatility', '')
        if 'Risk Off' in risk_app:
            lines.append("시장 국면 Risk Off — 방어적 포지션 권장")
        elif 'Elevated' in vol_lbl:
            lines.append(f"변동성 확대 ({vol_lbl}) — 포지션 축소 고려")

    # Smart Money alerts
    if sm:
        sigs = sm.get('signals', [])
        for s in sigs[:5]:
            ticker = s.get('ticker', '')
            sig    = s.get('signal', '')
            score  = s.get('score')
            vr     = s.get('volume_ratio')
            if sig and 'Buying' in sig:
                vr_txt = f", Vol {vr:.1f}x" if vr else ''
                raw_alerts.append({
                    'type': 'SMART_MONEY',
                    'symbol': ticker,
                    'message': f"기관 {sig} (Score {score}{vr_txt})",
                })

    # VCP signals
    if vcp:
        vsigs = vcp.get('signals', [])
        for s in vsigs[:3]:
            ticker = s.get('ticker', '')
            pattern = s.get('pattern', 'VCP')
            grade = s.get('grade', '')
            dist = s.get('distance_to_pivot_pct')
            dist_txt = f", 피벗까지 {dist:.1f}%" if dist else ''
            raw_alerts.append({
                'type': 'VCP',
                'symbol': ticker,
                'message': f"{pattern} 패턴 {grade}등급{dist_txt}",
            })

    # v1.1: apply alert budget (priority, dedup, max 3)
    visible_alerts, hidden_count = _apply_alert_budget(raw_alerts)

    risk_label_map = {
        'low': '낮음 (투자 적합)',
        'medium': '보통 (선별 접근)',
        'high': '높음 (방어 대응)',
    }

    return {
        'risk_level': risk_level,
        'risk_label': risk_label_map.get(risk_level, risk_level),
        'gate_score': gate_score,
        'lines': lines,
        'alerts': visible_alerts,
        'alerts_hidden_count': hidden_count,
        'raw_alert_count': len(raw_alerts),
    }


# ── v1.1: tone distribution validation ────────────────────────────────────────
def _simulate_tone_distribution(n_days: int = 120) -> Dict[str, Any]:
    """Snapshot-only validation — reads current data and projects single-day result.
    (Full 120-day historical simulation requires time-series data.)
    """
    md     = _load('market_data.json')
    gate   = _load('market_gate.json')
    regime = _load('market_regime.json')

    ms = build_market_summary(md, gate, regime)
    tone = ms['overall_tone']
    reason = ms['tone_reason_codes']

    result = {
        'snapshot_tone': tone,
        'tone_reason_codes': reason,
        'note': (
            f"Snapshot only (1 day). "
            f"For full {n_days}-day distribution, historical OHLCV replay required."
        ),
    }
    return result


# ══ main ═════════════════════════════════════════════════════════════════════
def _ko_tone(tone: Optional[str]) -> str:
    tone_map = {
        'bullish': '완만한 강세',
        'bearish': '약세',
        'neutral': '중립',
    }
    return tone_map.get(str(tone or '').lower(), '중립')


def _to_num(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _pick_action_hint(
    tone: Optional[str],
    gate_score: Optional[float],
    risk_trend: Optional[str],
    risk_level: Optional[str],
) -> str:
    lvl = str(risk_level or '').upper()
    trend = str(risk_trend or '')
    if (gate_score is not None and gate_score < 50) or trend == 'Deteriorating' or lvl == 'HIGH':
        return '방어'
    if str(tone or '').lower() == 'bullish' and (gate_score is not None and gate_score >= 65) and trend == 'Improving':
        return '분할'
    if str(tone or '').lower() == 'bearish':
        return '관망'
    return '선별'


def generate_market_narrative(data: Dict[str, Any]) -> str:
    md = data.get('market_data') or {}
    ms = data.get('market_summary') or {}
    overview = data.get('overview') or {}

    idx = md.get('indices', {}) if isinstance(md, dict) else {}
    bonds = md.get('bonds', {}) if isinstance(md, dict) else {}
    currencies = md.get('currencies', {}) if isinstance(md, dict) else {}
    vol = md.get('volatility', {}) if isinstance(md, dict) else {}

    spy_chg = _to_num((idx.get('SPY') or {}).get('change_pct'))
    qqq_chg = _to_num((idx.get('QQQ') or {}).get('change_pct'))
    vix = _to_num((vol.get('^VIX') or {}).get('price'))
    us10y = _to_num((bonds.get('^TNX') or {}).get('price'))
    dxy = _to_num((currencies.get('DX-Y.NYB') or {}).get('price'))

    tone = ms.get('overall_tone')
    gate_score = _to_num(ms.get('gate_score') if ms.get('gate_score') is not None else overview.get('gate_score'))
    risk_trend = overview.get('risk_trend')
    risk_level = overview.get('risk_level')

    sentence_1_parts: List[str] = []
    if spy_chg is not None:
        sentence_1_parts.append(f"S&P500 {spy_chg:+.2f}%")
    if qqq_chg is not None:
        sentence_1_parts.append(f"나스닥100 {qqq_chg:+.2f}%")
    if sentence_1_parts:
        line1 = f"미국 주식은 {', '.join(sentence_1_parts)} 흐름으로 {_ko_tone(tone)} 톤을 보였습니다."
    else:
        line1 = f"미국 주식은 현재 {_ko_tone(tone)} 톤으로 해석됩니다."

    macro_parts: List[str] = []
    if vix is not None:
        macro_parts.append(f"VIX {vix:.1f}")
    if us10y is not None:
        macro_parts.append(f"미국 10년물 {us10y:.2f}%")
    if dxy is not None:
        macro_parts.append(f"달러지수 {dxy:.2f}")
    if macro_parts:
        line2 = "변동성과 금리/달러 지표는 " + ", ".join(macro_parts) + " 수준입니다."
    else:
        line2 = "변동성·금리·달러 데이터 일부가 비어 있어 보수적으로 해석할 필요가 있습니다."

    hint = _pick_action_hint(tone, gate_score, risk_trend, risk_level)
    gate_text = f"{gate_score:.0f}" if gate_score is not None else "N/A"
    trend_text = risk_trend or "Stable"
    line3 = f"Gate 점수 {gate_text}, 위험 추세 {trend_text} 기준 행동 힌트는 '{hint}'입니다."
    return " ".join([line1, line2, line3])


def generate_sector_narrative(data: Dict[str, Any]) -> str:
    sr = data.get('sector_rotation') or {}
    sb = data.get('sector_brief') or {}

    phase_label = sr.get('phase_label') or sb.get('phase_label') or sr.get('phase') or sb.get('phase') or 'Unknown'
    leading = sr.get('leading_sectors') or [x.get('symbol') for x in (sb.get('leaders') or []) if isinstance(x, dict)]
    lagging = sr.get('lagging_sectors') or [x.get('symbol') for x in (sb.get('laggers') or []) if isinstance(x, dict)]
    perf = sr.get('sector_perf') if isinstance(sr, dict) else None

    top_sector_names: List[str] = []
    if isinstance(perf, list) and perf:
        ranked = sorted(
            [x for x in perf if isinstance(x, dict)],
            key=lambda x: _to_num(x.get('change_1d')) if _to_num(x.get('change_1d')) is not None else -9999,
            reverse=True,
        )
        for item in ranked[:2]:
            top_sector_names.append(item.get('name') or item.get('symbol') or '')
        top_sector_names = [x for x in top_sector_names if x]

    lead_text = ", ".join(leading[:3]) if leading else "데이터 부족"
    lag_text = ", ".join(lagging[:3]) if lagging else "데이터 부족"
    line1 = f"섹터 로테이션 국면은 '{phase_label}'로 집계되며, 상대 강세는 {lead_text}, 약세는 {lag_text}로 나타났습니다."

    if top_sector_names:
        line2 = f"당일 기준 상단 섹터는 {', '.join(top_sector_names)}이며, 추세 지속 여부를 거래대금과 함께 확인하는 구간입니다."
    else:
        line2 = "상위 섹터 데이터가 충분하지 않아, 현재는 주도 섹터 확인을 우선하는 구간입니다."

    phase_key = str(sr.get('phase') or sb.get('phase') or '').lower()
    if phase_key in {'slowdown', 'peak'}:
        hint = '방어'
    elif phase_key in {'expansion', 'early_recovery'}:
        hint = '선별'
    else:
        hint = '관망'
    line3 = f"행동 힌트는 '{hint}'이며, 주도 섹터 내에서도 실적/수급이 확인된 종목 위주로 접근하는 편이 안전합니다."
    return " ".join([line1, line2, line3])


def generate_risk_narrative(data: Dict[str, Any]) -> str:
    rb = data.get('risk_brief') or {}
    overview = data.get('overview') or {}
    alerts_recent = data.get('alerts_recent') or {}

    risk_level = overview.get('risk_level') or rb.get('risk_level') or 'MEDIUM'
    gate_score = _to_num(overview.get('gate_score') if overview.get('gate_score') is not None else rb.get('gate_score'))
    gate_10d = _to_num(overview.get('gate_score_10d_avg'))
    gate_delta_5d = _to_num(overview.get('gate_delta_5d'))
    risk_trend = overview.get('risk_trend') or 'Stable'

    line1_parts = [f"리스크 레벨은 {risk_level}"]
    if gate_score is not None:
        line1_parts.append(f"Gate {gate_score:.0f}")
    line1 = ", ".join(line1_parts) + "로 확인됩니다."

    trend_parts: List[str] = []
    if gate_10d is not None:
        trend_parts.append(f"10일 평균 {gate_10d:.1f}")
    if gate_delta_5d is not None:
        trend_parts.append(f"5일 변화 {gate_delta_5d:+.1f}")
    if trend_parts:
        line2 = f"중기 추세는 {', '.join(trend_parts)}이며 risk_trend는 {risk_trend}입니다."
    else:
        line2 = f"중기 추세 데이터 일부가 비어 있어 risk_trend({risk_trend}) 중심으로 판단해야 합니다."

    alerts = alerts_recent.get('alerts') if isinstance(alerts_recent, dict) else []
    alerts = alerts[:3] if isinstance(alerts, list) else []
    if alerts:
        sev = [str(a.get('severity_label', 'LOW')) for a in alerts if isinstance(a, dict)]
        high_count = sum(1 for s in sev if s == 'HIGH')
        line3 = f"최근 SNAPSHOT_ALERT {len(alerts)}건 중 HIGH {high_count}건이어서 행동 힌트는 '방어'입니다."
    else:
        hint = _pick_action_hint(None, gate_score, risk_trend, risk_level)
        line3 = f"최근 SNAPSHOT_ALERT가 없어도 행동 힌트는 '{hint}'으로, 포지션 크기를 단계적으로 조절하는 편이 적절합니다."
    return " ".join([line1, line2, line3])


def main() -> int:
    md     = _load('market_data.json')
    gate   = _load('market_gate.json')
    hz     = _load('hot_zone.json')
    sr     = _load('sector_rotation.json')
    risk   = _load('risk_metrics.json')
    regime = _load('market_regime.json')
    sm     = _load('smart_money.json')
    vcp    = _load('vcp_signals.json')
    overview = _load_cache('overview.json') or {}
    snapshots_120d = _load_cache('snapshots_120d.json') or {}
    alerts_recent = _load_cache('alerts_recent.json') or {}

    latest_snapshot: Dict[str, Any] = {}
    snapshots = snapshots_120d.get('snapshots', []) if isinstance(snapshots_120d, dict) else []
    if isinstance(snapshots, list) and snapshots:
        last_row = snapshots[-1]
        if isinstance(last_row, dict):
            latest_snapshot = last_row

    market_summary  = build_market_summary(md, gate, regime)
    hot_brief       = build_hot_stocks_brief(hz)
    sector_brief    = build_sector_brief(sr)
    risk_brief_data = build_risk_brief(gate, risk, regime, sm, vcp)
    narratives = {
        'market': generate_market_narrative({
            'market_data': md,
            'market_summary': market_summary,
            'overview': overview,
        }),
        'sector': generate_sector_narrative({
            'sector_rotation': sr,
            'sector_brief': sector_brief,
        }),
        'risk': generate_risk_narrative({
            'risk_brief': risk_brief_data,
            'overview': {
                **overview,
                'gate_score_10d_avg': overview.get('gate_score_10d_avg', latest_snapshot.get('gate_score_10d_avg')),
                'gate_delta_5d': overview.get('gate_delta_5d', latest_snapshot.get('gate_delta_5d')),
            },
            'alerts_recent': alerts_recent,
        }),
    }

    # missing inputs check
    missing_inputs: List[str] = []
    missing_details: List[Dict[str, str]] = []
    if not hz:
        missing_inputs.append('hot_zone.json')
        missing_details.append({
            'file': 'hot_zone.json',
            'affects': 'HOT 주목 종목',
            'fix': 'python backend/scripts/build_hot_zone.py',
        })
    if not sr:
        missing_inputs.append('sector_rotation.json')
        missing_details.append({
            'file': 'sector_rotation.json',
            'affects': '섹터 브리프',
            'fix': 'python backend/scripts/build_sector_rotation_cache.py',
        })

    coverage_sources: Dict[str, bool] = {
        'market_data':     md is not None,
        'market_gate':     gate is not None,
        'hot_zone':        hz is not None,
        'sector_rotation': sr is not None,
        'risk_metrics':    risk is not None,
        'market_regime':   regime is not None,
        'smart_money':     sm is not None,
        'vcp_signals':     vcp is not None,
    }
    available = sum(1 for v in coverage_sources.values() if v)
    total_src  = len(coverage_sources)

    generated_at = datetime.now().isoformat(timespec='seconds')

    output = {
        'generated_at':     generated_at,
        'data_coverage': {
            'sources':         coverage_sources,
            'available':       available,
            'total':           total_src,
            'pct':             round(available / total_src * 100, 1),
            'missing_inputs':  missing_inputs,
            'missing_details': missing_details,
            'rerun_hint':      'python backend/run_all.py' if missing_inputs else None,
        },
        'market_summary':   market_summary,
        'hot_stocks_brief': hot_brief,
        'sector_brief':     sector_brief,
        'risk_brief':       risk_brief_data,
        'narratives':       narratives,
    }

    out_path = _write('daily_report.json', output)

    tone_sim = _simulate_tone_distribution()

    print('=' * 60)
    print('build_daily_report.py  v1.1')
    print(f'[OK] market_summary tone={market_summary["overall_tone"]}  reason_codes={market_summary["tone_reason_codes"]}')
    print(f'[OK] bullets={len(market_summary["bullets"])}  action_hint={market_summary["action_hint"]!r}')
    print(f'[OK] hot_stocks_brief={len(hot_brief)} stocks')
    print(f'[OK] sector_brief phase={sector_brief["phase"]}')
    print(f'[OK] risk_brief level={risk_brief_data["risk_level"]}  '
          f'alerts={len(risk_brief_data["alerts"])}/{risk_brief_data["raw_alert_count"]}  '
          f'hidden={risk_brief_data["alerts_hidden_count"]}')
    print(f'[OK] narratives fields={list(narratives.keys())}')
    print(f'[OK] data_coverage={available}/{total_src}  missing={missing_inputs}')
    print(f'[SIM] tone_snapshot={tone_sim["snapshot_tone"]}')
    print(f'[OK] {out_path}')
    print('=' * 60)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
