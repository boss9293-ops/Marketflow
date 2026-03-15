"""
Relative Rotation Graph (RRG) Data Generator
섹터 ETF의 RS-Ratio와 RS-Momentum을 계산합니다.
Output: output/rrg_data.json
"""
import yfinance as yf
import pandas as pd
import numpy as np
import json, os
from datetime import datetime

SECTORS = [
    ('XLK', 'Technology'),
    ('XLV', 'Healthcare'),
    ('XLF', 'Financials'),
    ('XLE', 'Energy'),
    ('XLY', 'Consumer Disc.'),
    ('XLI', 'Industrials'),
    ('XLB', 'Materials'),
    ('XLU', 'Utilities'),
    ('XLRE', 'Real Estate'),
    ('XLC', 'Comm. Services'),
    ('XLP', 'Consumer Stap.'),
]
BENCHMARK = 'SPY'
TRAIL_WEEKS = 5  # 트레일 포인트 수

def calc_rrg():
    symbols = [s for s, _ in SECTORS] + [BENCHMARK]
    raw = yf.download(symbols, period='1y', auto_adjust=True, progress=False)['Close']

    if raw.empty:
        return []

    # 주간 데이터로 리샘플
    weekly = raw.resample('W-FRI').last().dropna(how='all')

    results = []
    for symbol, name in SECTORS:
        if symbol not in weekly.columns or BENCHMARK not in weekly.columns:
            continue

        sector = weekly[symbol].dropna()
        bench = weekly[BENCHMARK].dropna()
        common = sector.index.intersection(bench.index)
        if len(common) < 20:
            continue

        sector = sector[common]
        bench = bench[common]

        # 상대 강도 = 섹터 / 벤치마크
        rs = sector / bench

        # EMA로 RS-Ratio 계산 (JdK 방식 근사)
        fast = rs.ewm(span=10, adjust=False).mean()
        slow = rs.ewm(span=26, adjust=False).mean()
        rs_ratio_raw = (fast / slow) * 100

        # RS-Momentum = RS-Ratio의 변화율
        rs_momentum_raw = rs_ratio_raw / rs_ratio_raw.shift(1) * 100

        rs_ratio_raw = rs_ratio_raw.dropna()
        rs_momentum_raw = rs_momentum_raw.dropna()

        common2 = rs_ratio_raw.index.intersection(rs_momentum_raw.index)
        if len(common2) < TRAIL_WEEKS + 1:
            continue

        rs_ratio_raw = rs_ratio_raw[common2]
        rs_momentum_raw = rs_momentum_raw[common2]

        # 전체 시리즈 기준으로 정규화 (100 중심)
        ratio_mean = rs_ratio_raw.mean()
        ratio_std = rs_ratio_raw.std()
        momentum_mean = rs_momentum_raw.mean()
        momentum_std = rs_momentum_raw.std()

        def normalize(val, mean, std):
            if std == 0:
                return 100.0
            return round(100 + ((val - mean) / std) * 10, 2)

        # 마지막 N주 트레일 포인트
        trail = []
        for i in range(-TRAIL_WEEKS, 0):
            trail.append({
                'x': normalize(rs_ratio_raw.iloc[i], ratio_mean, ratio_std),
                'y': normalize(rs_momentum_raw.iloc[i], momentum_mean, momentum_std),
            })

        current_x = normalize(rs_ratio_raw.iloc[-1], ratio_mean, ratio_std)
        current_y = normalize(rs_momentum_raw.iloc[-1], momentum_mean, momentum_std)

        results.append({
            'symbol': symbol,
            'name': name,
            'rs_ratio': current_x,
            'rs_momentum': current_y,
            'trail': trail,
        })

    return results

def main():
    output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'rrg_data.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    sectors = calc_rrg()

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'sectors': sectors,
        }, f, indent=2, ensure_ascii=False)

    print(f"RRG data saved: {len(sectors)} sectors")

if __name__ == '__main__':
    main()
