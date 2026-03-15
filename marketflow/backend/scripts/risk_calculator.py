"""
Calculates portfolio risk metrics.
Output: output/risk_metrics.json
"""
import yfinance as yf
import pandas as pd
import numpy as np
import json, os
from datetime import datetime

def calculate_risk_metrics():
    portfolio = ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD']

    data = {}
    for ticker in portfolio:
        try:
            hist = yf.Ticker(ticker).history(period='1y')
        except Exception:
            hist = None
        if hist is None or hist.empty:
            print(f"Warning: No data for {ticker}")
            continue
        data[ticker] = hist['Close']

    if len(data) < 2:
        print("Warning: Insufficient data. Using fallback.")
        result = {
            'timestamp': datetime.now().isoformat(),
            'var_95': {}, 'var_99': {}, 'correlation_matrix': {},
            'max_drawdown': {}, 'sharpe_ratio': {}, 'portfolio_volatility': 0,
            'note': 'Market data unavailable'
        }
        output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'risk_metrics.json')
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print("Risk metrics: fallback (data unavailable)")
        return

    df = pd.DataFrame(data).dropna()
    returns = df.pct_change().dropna()

    var_95 = {}
    var_99 = {}
    for ticker in portfolio:
        var_95[ticker] = round(float(np.percentile(returns[ticker], 5) * 100), 2)
        var_99[ticker] = round(float(np.percentile(returns[ticker], 1) * 100), 2)

    corr_matrix = returns.corr().round(3).to_dict()

    max_dd = {}
    for ticker in portfolio:
        cum_returns = (1 + returns[ticker]).cumprod()
        running_max = cum_returns.cummax()
        drawdown = (cum_returns / running_max) - 1
        max_dd[ticker] = round(float(drawdown.min() * 100), 2)

    sharpe = {}
    for ticker in portfolio:
        mean_ret = returns[ticker].mean() * 252
        std_ret = returns[ticker].std() * np.sqrt(252)
        sharpe[ticker] = round(float(mean_ret / std_ret) if std_ret > 0 else 0, 2)

    result = {
        'timestamp': datetime.now().isoformat(),
        'var_95': var_95,
        'var_99': var_99,
        'correlation_matrix': corr_matrix,
        'max_drawdown': max_dd,
        'sharpe_ratio': sharpe,
        'portfolio_volatility': round(float(returns.mean(axis=1).std() * np.sqrt(252) * 100), 2)
    }

    output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'risk_metrics.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print("Risk metrics calculated")

if __name__ == '__main__':
    calculate_risk_metrics()
