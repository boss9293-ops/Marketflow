"""
Generate KR market JSON files consumed by KR API endpoints.
Outputs (in backend/output):
- kr_market_gate.json
- kr_signals.json
- kr_ai_analysis.json
- kr_ai_summary.json
- kr_performance.json
- kr_cumulative_return.json
- kr_stock_charts.json
- kr_ai_history/kr_ai_analysis_<date>.json
"""
import json
import os
from datetime import datetime

import yfinance as yf
from kr_strategy import calculate_kr_performance, generate_kr_signals_and_assets


SECTORS = [
    ('005930.KS', '005930', 'Samsung Electronics'),
    ('000660.KS', '000660', 'SK Hynix'),
    ('035420.KS', '035420', 'Naver'),
    ('035720.KS', '035720', 'Kakao'),
    ('051910.KS', '051910', 'LG Chem'),
    ('207940.KS', '207940', 'Samsung Biologics'),
    ('068270.KS', '068270', 'Celltrion'),
    ('105560.KS', '105560', 'KB Financial'),
    ('055550.KS', '055550', 'Shinhan Financial'),
    ('005380.KS', '005380', 'Hyundai Motor'),
    ('012330.KS', '012330', 'Hyundai Mobis'),
    ('006400.KS', '006400', 'Samsung SDI'),
]


def _safe_history(symbol: str, period: str = '6mo'):
    try:
        return yf.Ticker(symbol).history(period=period)
    except Exception:
        return None


def _safe_pct(curr: float, prev: float):
    if prev == 0:
        return 0.0
    return ((curr / prev) - 1) * 100


def generate_kr_market_data():
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'output')
    os.makedirs(output_dir, exist_ok=True)

    now = datetime.now()
    today = now.strftime('%Y-%m-%d')

    # Market gate inputs
    kospi_hist = _safe_history('^KS11', period='1mo')
    kosdaq_hist = _safe_history('^KQ11', period='1mo')

    kospi_change = 0.0
    kosdaq_change = 0.0
    usdkrw = 0.0
    if kospi_hist is not None and not kospi_hist.empty and len(kospi_hist) >= 2:
        kospi_change = _safe_pct(float(kospi_hist['Close'].iloc[-1]), float(kospi_hist['Close'].iloc[-2]))
    if kosdaq_hist is not None and not kosdaq_hist.empty and len(kosdaq_hist) >= 2:
        kosdaq_change = _safe_pct(float(kosdaq_hist['Close'].iloc[-1]), float(kosdaq_hist['Close'].iloc[-2]))

    krw_hist = _safe_history('KRW=X', period='5d')
    if krw_hist is not None and not krw_hist.empty:
        usdkrw = float(krw_hist['Close'].iloc[-1])

    benchmark_curve = []
    kosdaq_benchmark_curve = []
    if kospi_hist is not None and not kospi_hist.empty:
        kospi_close = kospi_hist['Close'].tail(60)
        if len(kospi_close) > 1:
            base = float(kospi_close.iloc[0])
            if base > 0:
                for idx, px in kospi_close.items():
                    benchmark_curve.append({
                        'date': idx.strftime('%Y-%m-%d'),
                        'equity': round((float(px) / base) * 100, 2),
                    })
    if kosdaq_hist is not None and not kosdaq_hist.empty:
        kosdaq_close = kosdaq_hist['Close'].tail(60)
        if len(kosdaq_close) > 1:
            base = float(kosdaq_close.iloc[0])
            if base > 0:
                for idx, px in kosdaq_close.items():
                    kosdaq_benchmark_curve.append({
                        'date': idx.strftime('%Y-%m-%d'),
                        'equity': round((float(px) / base) * 100, 2),
                    })

    gate_score = max(0, min(100, int(50 + (kospi_change * 8) + (kosdaq_change * 8))))
    if gate_score >= 70:
        status = 'GREEN'
        recommendation = 'Risk-on environment. Favor stronger KR leaders.'
    elif gate_score >= 40:
        status = 'YELLOW'
        recommendation = 'Mixed market. Be selective with position sizing.'
    else:
        status = 'RED'
        recommendation = 'Defensive setup. Prioritize risk control.'

    kr_market_gate = {
        'status': status,
        'gate_score': gate_score,
        'recommendation': recommendation,
        'kospi': {'change_pct': round(kospi_change, 2)},
        'kosdaq': {'change_pct': round(kosdaq_change, 2)},
        'usd_krw': round(usdkrw, 2),
        'generated_at': now.isoformat(),
    }

    strategy_output = generate_kr_signals_and_assets(SECTORS, today, now.isoformat())
    top20 = strategy_output['top20']
    top10 = strategy_output['top10']
    chart_payload = strategy_output['chart_payload']
    ai_summary_map = strategy_output['ai_summary_map']
    portfolio_date_values = strategy_output['portfolio_date_values']

    kr_signals = {
        'signals': top20,
        'count': len(top20),
        'generated_at': now.isoformat(),
    }

    kr_ai_analysis = {
        'signal_date': today,
        'signals': top10,
        'summary': f"KR 상위 시그널이 생성되었습니다. 총 {len(top10)}개 종목이 선별되었습니다.",
        'summary_ko': f"KR 상위 시그널이 생성되었습니다. 총 {len(top10)}개 종목이 선별되었습니다.",
        'summary_en': f"Top KR signals generated from momentum filter. {len(top10)} names selected.",
        'generated_at': now.isoformat(),
    }

    kr_performance, kr_cumulative_return = calculate_kr_performance(
        top20=top20,
        portfolio_date_values=portfolio_date_values,
        benchmark_curve=benchmark_curve,
        kosdaq_benchmark_curve=kosdaq_benchmark_curve,
        generated_at=now.isoformat(),
    )

    # Write output files
    write_targets = {
        'kr_market_gate.json': kr_market_gate,
        'kr_signals.json': kr_signals,
        'kr_ai_analysis.json': kr_ai_analysis,
        'kr_ai_summary.json': ai_summary_map,
        'kr_performance.json': kr_performance,
        'kr_cumulative_return.json': kr_cumulative_return,
        'kr_stock_charts.json': chart_payload,
    }
    for filename, payload in write_targets.items():
        with open(os.path.join(output_dir, filename), 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

    history_dir = os.path.join(output_dir, 'kr_ai_history')
    os.makedirs(history_dir, exist_ok=True)
    with open(os.path.join(history_dir, f'kr_ai_analysis_{today}.json'), 'w', encoding='utf-8') as f:
        json.dump(kr_ai_analysis, f, ensure_ascii=False, indent=2)

    print(f"KR market data saved: signals={len(top20)}, ai={len(top10)}")


if __name__ == '__main__':
    generate_kr_market_data()
