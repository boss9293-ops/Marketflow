"""
Sector Rotation Stock Picker
경기 국면에 따라 강한 섹터 순환매 종목 발굴

Phase Cycle:
  Early Recovery → Technology, Consumer Discretionary
  Expansion      → Industrials, Materials, Energy
  Peak           → Financials, Real Estate
  Slowdown       → Healthcare, Consumer Staples, Utilities

Output: output/rotation_picks.json
"""
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime
import json, os

# ─── 섹터 정의 ─────────────────────────────────────────────────────
SECTORS = {
    'XLK':  ('Technology',              'early_recovery'),
    'XLY':  ('Consumer Discretionary',  'early_recovery'),
    'XLC':  ('Communication Services',  'early_recovery'),
    'XLI':  ('Industrials',             'expansion'),
    'XLB':  ('Materials',               'expansion'),
    'XLE':  ('Energy',                  'expansion'),
    'XLF':  ('Financials',              'peak'),
    'XLRE': ('Real Estate',             'peak'),
    'XLV':  ('Healthcare',              'slowdown'),
    'XLP':  ('Consumer Staples',        'slowdown'),
    'XLU':  ('Utilities',               'slowdown'),
}

SECTOR_STOCKS = {
    'XLK':  ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'CSCO', 'ADBE', 'CRM', 'INTC', 'AMD', 'QCOM'],
    'XLY':  ['AMZN', 'TSLA', 'HD', 'NKE', 'MCD', 'SBUX', 'TGT', 'LOW', 'TJX', 'BKNG'],
    'XLI':  ['CAT', 'RTX', 'UNP', 'HON', 'BA', 'UPS', 'DE', 'LMT', 'GE', 'MMM'],
    'XLB':  ['LIN', 'APD', 'SHW', 'ECL', 'FCX', 'NEM', 'DD', 'DOW', 'NUE', 'VMC'],
    'XLE':  ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PSX', 'MPC', 'VLO', 'OXY', 'HAL'],
    'XLF':  ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'BLK', 'AXP', 'SPGI', 'USB'],
    'XLRE': ['PLD', 'AMT', 'CCI', 'EQIX', 'PSA', 'SPG', 'O', 'DLR', 'VICI', 'AVB'],
    'XLV':  ['UNH', 'JNJ', 'LLY', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'PFE', 'BMY'],
    'XLP':  ['PG', 'KO', 'PEP', 'COST', 'WMT', 'PM', 'MO', 'MDLZ', 'CL', 'KMB'],
    'XLU':  ['NEE', 'DUK', 'SO', 'D', 'AEP', 'SRE', 'EXC', 'XEL', 'ED', 'ES'],
    'XLC':  ['META', 'GOOGL', 'NFLX', 'DIS', 'CMCSA', 'T', 'VZ', 'TMUS', 'CHTR', 'EA'],
}

PHASE_LABELS = {
    'early_recovery': '경기 초기 회복',
    'expansion':      '경기 확장',
    'peak':           '경기 정점',
    'slowdown':       '경기 둔화',
}

PHASE_COLOR = {
    'early_recovery': '#22c55e',
    'expansion':      '#00D9FF',
    'peak':           '#f59e0b',
    'slowdown':       '#ef4444',
}


# ─── 국면 식별 ─────────────────────────────────────────────────────
def identify_rotation_phase():
    """섹터 ETF 퍼포먼스로 현재 경기 국면 식별."""
    performance = {}

    for symbol, (name, phase) in SECTORS.items():
        try:
            hist = yf.Ticker(symbol).history(period='3mo')
            if len(hist) < 20:
                continue
            close = hist['Close']
            ret_3m = float((close.iloc[-1] / close.iloc[0] - 1) * 100)

            # 모멘텀: 최근 1개월 평균 / 이전 2개월 평균
            if len(close) >= 60:
                recent_mean = float(close.iloc[-20:].mean())
                prior_mean  = float(close.iloc[-60:-20].mean())
                momentum = (recent_mean / prior_mean - 1) * 100 if prior_mean > 0 else 0.0
            else:
                momentum = 0.0

            # 상대 강도 vs SPY
            spy_hist = yf.Ticker('SPY').history(period='3mo')
            spy_ret = float((spy_hist['Close'].iloc[-1] / spy_hist['Close'].iloc[0] - 1) * 100) if len(spy_hist) > 0 else 0.0
            rel_strength = ret_3m - spy_ret

            score = ret_3m * 0.5 + momentum * 0.3 + rel_strength * 0.2

            performance[symbol] = {
                'name': name,
                'phase': phase,
                'return_3m': round(ret_3m, 2),
                'momentum': round(momentum, 2),
                'rel_strength': round(rel_strength, 2),
                'score': round(score, 2),
            }
        except Exception:
            continue

    if not performance:
        return 'early_recovery', [], performance

    # 상위 3 섹터
    top3 = sorted(performance.items(), key=lambda x: x[1]['score'], reverse=True)[:3]
    phases = [s[1]['phase'] for s in top3]
    current_phase = max(set(phases), key=phases.count)
    leading_sectors = [s[0] for s in top3]

    return current_phase, leading_sectors, performance


# ─── 순환매 종목 발굴 ──────────────────────────────────────────────
def find_rotation_stocks(sector_etf: str, min_score: int = 70):
    """특정 섹터 내 순환매 조건 충족 종목 스캔."""
    stocks = SECTOR_STOCKS.get(sector_etf, [])
    rotation_picks = []

    # 섹터 ETF 3개월 수익률
    try:
        etf_hist = yf.Ticker(sector_etf).history(period='6mo')
        etf_close = etf_hist['Close']
        sector_return_3m = float((etf_close.iloc[-1] / etf_close.iloc[-60] - 1) * 100) if len(etf_close) >= 60 else 0.0
    except Exception:
        sector_return_3m = 0.0

    for symbol in stocks:
        try:
            hist = yf.Ticker(symbol).history(period='6mo')
            if len(hist) < 60:
                continue

            close  = hist['Close']
            volume = hist['Volume']
            high   = hist['High']

            current_price = float(close.iloc[-1])

            # 1. 상대 강도 (vs 섹터 ETF, 3개월)
            stock_return_3m = float((close.iloc[-1] / close.iloc[-60] - 1) * 100)
            relative_strength = stock_return_3m - sector_return_3m

            # 2. 이동평균
            sma20 = close.rolling(20).mean()
            sma50 = close.rolling(50).mean()
            above_sma20 = current_price > float(sma20.iloc[-1])
            above_sma50 = current_price > float(sma50.iloc[-1])
            sma_cross   = float(sma20.iloc[-1]) > float(sma50.iloc[-1])

            # 3. 거래량 (최근 10일 vs 60일 평균)
            avg_vol_60  = float(volume.iloc[-60:].mean())
            recent_vol  = float(volume.iloc[-10:].mean())
            volume_ratio = round(recent_vol / avg_vol_60, 2) if avg_vol_60 > 0 else 1.0

            # 4. 변동성 수축 (최근 20일 < 이전 40일)
            recent_vol_std = float(close.iloc[-20:].std())
            prior_vol_std  = float(close.iloc[-60:-20].std())
            vol_contraction = recent_vol_std < prior_vol_std

            # 5. 피벗 근처 (최근 30일 고점 대비 거리)
            recent_high = float(high.iloc[-30:].max())
            distance_to_pivot = ((recent_high - current_price) / current_price) * 100
            near_pivot = distance_to_pivot < 5.0

            # 6. RSI
            delta = close.diff()
            gain = delta.clip(lower=0).rolling(14).mean()
            loss = (-delta.clip(upper=0)).rolling(14).mean()
            rs = gain / loss.replace(0, np.nan)
            rsi = float(100 - 100 / (1 + rs.iloc[-1]))

            # ── 점수 계산 ──────────────────────────────────────
            score = 0
            if relative_strength > 0:   score += 25
            if above_sma20:             score += 15
            if above_sma50:             score += 10
            if sma_cross:               score += 15
            if volume_ratio > 1.2:      score += 15
            if vol_contraction:         score += 10
            if near_pivot:              score += 10

            signal = ('Strong Buy' if score >= 85
                      else 'Buy' if score >= 70
                      else 'Watch')

            if score >= min_score:
                rotation_picks.append({
                    'symbol': symbol,
                    'score': score,
                    'signal': signal,
                    'relative_strength': round(relative_strength, 2),
                    'stock_return_3m': round(stock_return_3m, 2),
                    'sector_return_3m': round(sector_return_3m, 2),
                    'volume_ratio': volume_ratio,
                    'current_price': round(current_price, 2),
                    'pivot': round(recent_high, 2),
                    'distance_to_pivot': round(distance_to_pivot, 2),
                    'rsi': round(rsi, 1),
                    'above_sma20': above_sma20,
                    'above_sma50': above_sma50,
                    'sma_cross': sma_cross,
                    'vol_contraction': vol_contraction,
                })

        except Exception:
            continue

    rotation_picks.sort(key=lambda x: x['score'], reverse=True)
    return rotation_picks


# ─── 메인 ──────────────────────────────────────────────────────────
def generate_rotation_picks():
    print("Sector Rotation Stock Picker running...")

    # 1. 현재 경기 국면
    phase, leading_sectors, all_performance = identify_rotation_phase()
    print(f"  Phase: {phase.upper()} | Leaders: {', '.join(leading_sectors)}")

    # 2. 선도 섹터에서 종목 발굴
    rotation_picks = {}
    for sector in leading_sectors:
        sector_name = all_performance.get(sector, {}).get('name', sector)
        stocks = find_rotation_stocks(sector, min_score=70)
        rotation_picks[sector] = {
            'name': sector_name,
            'performance': all_performance.get(sector, {}),
            'stocks': stocks,
        }
        print(f"  {sector} ({sector_name}): {len(stocks)} picks")

    # 3. Top 10 통합 (전 섹터)
    all_stocks = []
    for sd in rotation_picks.values():
        for st in sd['stocks']:
            if not any(x['symbol'] == st['symbol'] for x in all_stocks):
                all_stocks.append(st)
    all_stocks.sort(key=lambda x: x['score'], reverse=True)
    top10 = all_stocks[:10]

    result = {
        'timestamp': datetime.now().isoformat(),
        'phase': phase,
        'phase_label': PHASE_LABELS.get(phase, phase),
        'phase_color': PHASE_COLOR.get(phase, '#6b7280'),
        'leading_sectors': leading_sectors,
        'sector_performance': all_performance,
        'rotation_picks': rotation_picks,
        'top10': top10,
        'total_picks': len(all_stocks),
    }

    out_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'rotation_picks.json')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"  Done: {len(all_stocks)} rotation stocks | Phase={phase} | Top={top10[0]['symbol'] if top10 else 'N/A'}")


if __name__ == '__main__':
    generate_rotation_picks()
