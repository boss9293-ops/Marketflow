"""
RRG (Relative Rotation Graph) Data Generator
주간 데이터 기반 JdK RS-Ratio & RS-Momentum 계산
Output: output/rrg_data.json
"""
import yfinance as yf
import pandas as pd
import numpy as np
import json
import os
from datetime import datetime

SECTORS = {
    'XLK':  'Technology',
    'XLV':  'Healthcare',
    'XLF':  'Financials',
    'XLE':  'Energy',
    'XLY':  'Consumer Discretionary',
    'XLP':  'Consumer Staples',
    'XLI':  'Industrials',
    'XLB':  'Materials',
    'XLRE': 'Real Estate',
    'XLU':  'Utilities',
    'XLC':  'Communication Services',
}
BENCHMARK = 'SPY'
WEEKS = 10        # RS-Ratio SMA 기간
TRAIL_POINTS = 52 # 저장할 최대 트레일 포인트 수 (프론트에서 슬라이더로 제어)


def calculate_rrg(symbol, bench_close, weeks=WEEKS):
    try:
        stock = yf.download(symbol, period='1y', interval='1wk',
                            auto_adjust=True, progress=False)
        if stock.empty:
            return None

        # MultiIndex 처리
        close = stock['Close']
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]
        close = close.dropna()

        # 공통 인덱스 맞추기
        common = close.index.intersection(bench_close.index)
        if len(common) < weeks + 3:
            return None
        close = close[common]
        bench = bench_close[common]

        # Relative Strength
        rs = close / bench

        # RS-Ratio: rs / rs의 rolling SMA * 100
        rs_sma = rs.rolling(window=weeks).mean()
        rs_ratio = (rs / rs_sma) * 100

        # RS-Momentum: ratio의 1주 ROC + 100 (표준 JdK 근사)
        rs_momentum = rs_ratio.pct_change(1) * 100 + 100

        rs_ratio = rs_ratio.dropna()
        rs_momentum = rs_momentum.dropna()
        common2 = rs_ratio.index.intersection(rs_momentum.index)
        if len(common2) < weeks:
            return None

        rs_ratio = rs_ratio[common2]
        rs_momentum = rs_momentum[common2]

        # Trail: 최근 TRAIL_POINTS 포인트 (현재 제외)
        trail = []
        for i in range(-TRAIL_POINTS - 1, -1):
            if abs(i) > len(rs_ratio):
                continue
            trail.append({
                'ratio':    round(float(rs_ratio.iloc[i]), 4),
                'momentum': round(float(rs_momentum.iloc[i]), 4),
            })

        current = {
            'ratio':    round(float(rs_ratio.iloc[-1]), 4),
            'momentum': round(float(rs_momentum.iloc[-1]), 4),
        }

        price_change = float(
            ((close.iloc[-1] / close.iloc[-TRAIL_POINTS]) - 1) * 100
        )

        return {
            'current':  current,
            'trail':    trail,
            'price':    round(float(close.iloc[-1]), 2),
            'change':   round(price_change, 2),
        }

    except Exception as e:
        print(f"  Error {symbol}: {e}")
        return None


def generate_rrg_data():
    print("Downloading benchmark (SPY)...")
    bench_raw = yf.download(BENCHMARK, period='1y', interval='1wk',
                            auto_adjust=True, progress=False)
    if bench_raw.empty:
        print("Failed to download SPY")
        return

    bench_close = bench_raw['Close']
    if isinstance(bench_close, pd.DataFrame):
        bench_close = bench_close.iloc[:, 0]
    bench_close = bench_close.dropna()

    rrg_data = {
        'timestamp': datetime.now().isoformat(),
        'benchmark': BENCHMARK,
        'sectors': [],
    }

    for symbol, name in SECTORS.items():
        print(f"  Processing {symbol}...")
        data = calculate_rrg(symbol, bench_close)
        if data:
            rrg_data['sectors'].append({
                'symbol': symbol,
                'name':   name,
                **data,
            })
        else:
            print(f"  Skipped {symbol} (insufficient data)")

    output_dir = os.path.join(os.path.dirname(__file__), '..', 'output')
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, 'rrg_data.json')

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(rrg_data, f, indent=2, ensure_ascii=False)

    print(f"RRG data saved: {len(rrg_data['sectors'])} sectors → {output_path}")


if __name__ == '__main__':
    generate_rrg_data()
