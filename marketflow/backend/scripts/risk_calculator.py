"""
Calculates portfolio risk metrics.
Output: output/risk_metrics.json
Data: ohlcv_daily DB (primary) → yfinance (fallback)
"""
import pandas as pd
import numpy as np
import json, os, sqlite3
from datetime import datetime, timedelta

from db_utils import resolve_marketflow_db


PORTFOLIO = ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD']


def get_ohlcv_db() -> str:
    return resolve_marketflow_db(required_tables=("ohlcv_daily",), data_plane="live")


def load_close_from_db(symbol: str, lookback_days: int = 400) -> pd.Series | None:
    db = get_ohlcv_db()
    if not db:
        return None
    cutoff = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
    try:
        conn = sqlite3.connect(db)
        df = pd.read_sql_query(
            "SELECT date, close FROM ohlcv_daily WHERE symbol=? AND date>=? ORDER BY date",
            conn, params=(symbol, cutoff))
        conn.close()
        if df.empty or len(df) < 50:
            return None
        df['date'] = pd.to_datetime(df['date'])
        return df.set_index('date')['close']
    except Exception as e:
        print(f"  DB load error {symbol}: {e}")
        return None


def calculate_risk_metrics():
    data = {}
    for ticker in PORTFOLIO:
        series = load_close_from_db(ticker)
        if series is not None:
            data[ticker] = series
            print(f"  {ticker}: {len(series)} rows from DB ({series.index[-1].date()})")
        else:
            # fallback yfinance
            try:
                import yfinance as yf
                hist = yf.Ticker(ticker).history(period='1y')
                if hist is not None and not hist.empty:
                    data[ticker] = hist['Close']
                    print(f"  {ticker}: {len(hist)} rows from yfinance")
                else:
                    print(f"Warning: No data for {ticker}")
            except Exception:
                print(f"Warning: No data for {ticker}")

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
    available = [t for t in PORTFOLIO if t in returns.columns]

    var_95, var_99, max_dd, sharpe = {}, {}, {}, {}
    for ticker in available:
        var_95[ticker]  = round(float(np.percentile(returns[ticker], 5) * 100), 2)
        var_99[ticker]  = round(float(np.percentile(returns[ticker], 1) * 100), 2)
        cum = (1 + returns[ticker]).cumprod()
        dd  = (cum / cum.cummax()) - 1
        max_dd[ticker]  = round(float(dd.min() * 100), 2)
        mu  = returns[ticker].mean() * 252
        sig = returns[ticker].std() * np.sqrt(252)
        sharpe[ticker]  = round(float(mu / sig) if sig > 0 else 0, 2)

    corr_matrix = returns[available].corr().round(3).to_dict()

    result = {
        'timestamp': datetime.now().isoformat(),
        'var_95': var_95,
        'var_99': var_99,
        'correlation_matrix': corr_matrix,
        'max_drawdown': max_dd,
        'sharpe_ratio': sharpe,
        'portfolio_volatility': round(float(returns[available].mean(axis=1).std() * np.sqrt(252) * 100), 2)
    }

    output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'risk_metrics.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Risk metrics calculated: VaR95={list(var_95.values())[:3]} Sharpe={list(sharpe.values())[:3]}")

if __name__ == '__main__':
    calculate_risk_metrics()
