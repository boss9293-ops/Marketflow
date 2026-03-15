"""
Fetches real-time data for:
- Major indices (SPY, QQQ, DIA, IWM)
- Volatility (VIX)
- Bonds (3M, 5Y, 10Y Treasuries)
- Currencies (DXY, EUR/USD, USD/JPY, USD/KRW)
- Commodities (Gold, Crude Oil, Bitcoin)

Calculates Market Gate score from multiple factors.
Output: output/market_data.json, output/market_gate.json
"""
import yfinance as yf
import json, os
from datetime import datetime
import numpy as np

TICKERS = {
    'indices': {'SPY': 'S&P 500', 'QQQ': 'NASDAQ 100', 'DIA': 'Dow Jones', 'IWM': 'Russell 2000'},
    'volatility': {'^VIX': 'VIX'},
    'bonds': {'^IRX': '3M T-Bill', '^FVX': '5Y Treasury', '^TNX': '10Y Treasury'},
    'currencies': {
        'DX-Y.NYB': 'Dollar Index',
        'EURUSD=X': 'EUR/USD',
        'USDJPY=X': 'USD/JPY',
        'KRW=X': 'USD/KRW',
    },
    'commodities': {'GC=F': 'Gold', 'CL=F': 'Crude Oil', 'BTC-USD': 'Bitcoin'},
}

def fetch_market_data():
    result = {'timestamp': datetime.now().isoformat()}

    for category, tickers in TICKERS.items():
        result[category] = {}
        for symbol, name in tickers.items():
            try:
                hist = yf.Ticker(symbol).history(period='5d')
                if hist is None or hist.empty: continue
                current = float(hist['Close'].iloc[-1])
                prev = float(hist['Close'].iloc[-2]) if len(hist) > 1 else current
                result[category][symbol] = {
                    'name': name,
                    'price': round(current, 2),
                    'change_pct': round(((current / prev) - 1) * 100, 2),
                }
            except Exception as e:
                print(f"  Skip {symbol}: {e}")

    gate_score = calculate_market_gate(result)

    output_dir = os.path.join(os.path.dirname(__file__), '..', 'output')
    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(output_dir, 'market_data.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, 'market_gate.json'), 'w', encoding='utf-8') as f:
        json.dump(gate_score, f, ensure_ascii=False, indent=2)

    print(f"Market data saved. Gate Score: {gate_score['score']}")

def calculate_market_gate(data):
    vix = data.get('volatility', {}).get('^VIX', {}).get('price', 20)
    spy_change = data.get('indices', {}).get('SPY', {}).get('change_pct', 0)

    if vix <= 15:
        vix_score = 30
    elif vix <= 20:
        vix_score = 20
    elif vix <= 25:
        vix_score = 10
    else:
        vix_score = 0

    trend_score = 25 if spy_change > 0 else 5
    momentum_score = 15 if spy_change > 0.5 else (10 if spy_change > 0 else 5)
    regime_score = 15

    total_score = int(vix_score + trend_score + momentum_score + regime_score)

    if total_score >= 70:
        gate_status = 'GREEN'
        signal = 'BUY'
    elif total_score >= 40:
        gate_status = 'YELLOW'
        signal = 'SELECTIVE'
    else:
        gate_status = 'RED'
        signal = 'HOLD'

    return {
        'score': total_score,
        'status': gate_status,
        'signal': signal,
        'components': {
            'vix': vix_score,
            'trend': trend_score,
            'momentum': momentum_score,
            'regime': regime_score
        },
        'timestamp': datetime.now().isoformat()
    }

if __name__ == '__main__':
    fetch_market_data()
