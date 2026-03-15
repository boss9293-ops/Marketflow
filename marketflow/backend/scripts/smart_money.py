"""
Detects institutional buying through volume analysis.
Output: output/smart_money.json
"""
import yfinance as yf
import pandas as pd
import numpy as np
import json, os
from datetime import datetime

def detect_smart_money():
    tickers = ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','UNH','V',
               'MA','HD','BAC','WMT','PG','DIS','NFLX','INTC','AMD','CRM']

    smart_money_signals = []

    for ticker in tickers:
        try:
            tk = yf.Ticker(ticker)
            hist = tk.history(period='3mo')
            info = tk.info

            if len(hist) < 30:
                continue

            recent_vol = hist['Volume'].iloc[-5:].mean()
            avg_vol = hist['Volume'].iloc[-30:].mean()
            vol_ratio = recent_vol / avg_vol if avg_vol > 0 else 1

            inst_pct = info.get('heldPercentInstitutions', 0) or 0
            price_change_5d = ((hist['Close'].iloc[-1] / hist['Close'].iloc[-6]) - 1) * 100

            score = 0
            if vol_ratio > 1.5:
                score += 30
            if inst_pct > 0.7:
                score += 25
            if price_change_5d > 2:
                score += 25
            if vol_ratio > 1.2 and price_change_5d > 0:
                score += 20

            if score >= 25:
                smart_money_signals.append({
                    'ticker': ticker,
                    'name': info.get('shortName', ticker),
                    'score': score,
                    'volume_ratio': round(vol_ratio, 2),
                    'institutional_pct': round(inst_pct * 100, 1),
                    'price_change_5d': round(price_change_5d, 2),
                    'signal': 'Strong Buying' if score >= 80 else 'Moderate Buying',
                    'price': round(float(hist['Close'].iloc[-1]), 2)
                })
        except:
            pass

    smart_money_signals.sort(key=lambda x: x['score'], reverse=True)

    output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'smart_money.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'signals': smart_money_signals[:15]
        }, f, indent=2, ensure_ascii=False)

    print(f"Smart Money signals: {len(smart_money_signals)}")

if __name__ == '__main__':
    detect_smart_money()
