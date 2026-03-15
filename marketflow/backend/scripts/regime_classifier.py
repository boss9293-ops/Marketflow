"""
Classifies current market regime.
Output: output/market_regime.json
"""
import yfinance as yf
import pandas as pd
import numpy as np
import json, os
from datetime import datetime

def safe_history(symbol, period='1y'):
    try:
        hist = yf.Ticker(symbol).history(period=period)
        if hist is None or hist.empty:
            return None
        return hist
    except Exception:
        return None

def classify_regime():
    spy = safe_history('SPY', '1y')
    vix = safe_history('^VIX', '1y')

    if spy is None or vix is None:
        print("Warning: yfinance returned no data. Using fallback.")
        regime = {
            'timestamp': datetime.now().isoformat(),
            'trend': 'Unknown', 'risk_appetite': 'Unknown',
            'volatility': 'Unknown', 'cycle': 'Unknown',
            'vix_level': 0, 'strategy': 'Data unavailable - check market hours',
            'confidence': 'Low', 'note': 'Market data unavailable'
        }
        output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'market_regime.json')
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(regime, f, indent=2, ensure_ascii=False)
        print("Market Regime: Unknown (data unavailable)")
        return

    spy_close = spy['Close']
    current_vix = float(vix['Close'].iloc[-1])

    ma50 = float(spy_close.rolling(50).mean().iloc[-1])
    ma200 = float(spy_close.rolling(200).mean().iloc[-1])
    current_price = float(spy_close.iloc[-1])

    if current_price > ma50 > ma200:
        trend = 'Bull'
    elif current_price < ma50 < ma200:
        trend = 'Bear'
    else:
        trend = 'Transition'

    if current_vix < 15:
        vol_regime = 'Low Vol'
        risk_appetite = 'Risk On'
    elif current_vix < 20:
        vol_regime = 'Normal Vol'
        risk_appetite = 'Risk On'
    elif current_vix < 30:
        vol_regime = 'Elevated Vol'
        risk_appetite = 'Risk Off'
    else:
        vol_regime = 'High Vol'
        risk_appetite = 'Risk Off'

    ret_3m = float(((spy_close.iloc[-1] / spy_close.iloc[-63]) - 1) * 100)
    ret_6m = float(((spy_close.iloc[-1] / spy_close.iloc[-126]) - 1) * 100)

    if ret_6m > 10 and ret_3m > 5:
        cycle = 'Late Cycle'
    elif ret_6m > 0:
        cycle = 'Mid Cycle'
    else:
        cycle = 'Early Cycle'

    if trend == 'Bull' and risk_appetite == 'Risk On':
        strategy = 'Aggressive: Growth stocks, Tech, High Beta'
    elif trend == 'Bear' and risk_appetite == 'Risk Off':
        strategy = 'Defensive: Cash, Bonds, Quality Dividend'
    else:
        strategy = 'Balanced: Diversified portfolio, Sector rotation'

    regime = {
        'timestamp': datetime.now().isoformat(),
        'trend': trend,
        'risk_appetite': risk_appetite,
        'volatility': vol_regime,
        'cycle': cycle,
        'vix_level': round(current_vix, 1),
        'strategy': strategy,
        'confidence': 'High' if trend in ['Bull', 'Bear'] else 'Medium'
    }

    output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'market_regime.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(regime, f, indent=2, ensure_ascii=False)

    print(f"Market Regime: {trend} / {risk_appetite} / {cycle}")

if __name__ == '__main__':
    classify_regime()
