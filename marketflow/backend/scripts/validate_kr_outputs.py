"""
Validate KR output JSON schema (smoke-level contract checks).
Fails with non-zero exit code if required keys are missing.
"""
import json
import os
import sys


OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'output')


def load(filename):
    path = os.path.join(OUTPUT_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing output file: {filename}")
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def require_keys(obj, keys, ctx):
    for key in keys:
        if key not in obj:
            raise KeyError(f"Missing key '{key}' in {ctx}")


def validate():
    gate = load('kr_market_gate.json')
    require_keys(gate, ['status', 'gate_score', 'recommendation', 'kospi', 'kosdaq', 'usd_krw', 'generated_at'], 'kr_market_gate.json')

    signals = load('kr_signals.json')
    require_keys(signals, ['signals', 'count', 'generated_at'], 'kr_signals.json')
    if not isinstance(signals['signals'], list):
        raise TypeError("kr_signals.json 'signals' must be a list")

    ai_analysis = load('kr_ai_analysis.json')
    require_keys(ai_analysis, ['signal_date', 'signals', 'summary', 'generated_at'], 'kr_ai_analysis.json')

    ai_summary = load('kr_ai_summary.json')
    if not isinstance(ai_summary, dict):
        raise TypeError("kr_ai_summary.json must be an object map")

    perf = load('kr_performance.json')
    require_keys(perf, ['win_rate', 'avg_return', 'total_positions', 'generated_at'], 'kr_performance.json')

    cum = load('kr_cumulative_return.json')
    require_keys(
        cum,
        [
            'cumulative_return',
            'win_rate',
            'winners',
            'losers',
            'total_positions',
            'positions',
            'equity_curve',
            'benchmark_curve',
            'kosdaq_benchmark_curve',
            'generated_at',
        ],
        'kr_cumulative_return.json',
    )

    charts = load('kr_stock_charts.json')
    if not isinstance(charts, dict):
        raise TypeError("kr_stock_charts.json must be an object map")

    print("KR output validation passed.")


if __name__ == '__main__':
    try:
        validate()
    except Exception as e:
        print(f"KR output validation failed: {e}")
        sys.exit(1)
