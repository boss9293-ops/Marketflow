# KR API Contract (Stabilized)

All KR endpoints return fixed field shapes, even when data is missing.

## `GET /api/kr/signals`
- `signals`: `Array<{ ticker, name, signal_date, score, final_score, entry_price, current_price, return_pct, status }>`
- `count`: `number`
- `message`: `string`
- `generated_at`: `string` (ISO datetime)
- `wired`: `boolean`

## `GET /api/kr/market-gate`
- `status`: `string`
- `gate_score`: `number`
- `recommendation`: `string`
- `kospi`: `{ change_pct: number }`
- `kosdaq`: `{ change_pct: number }`
- `usd_krw`: `number`
- `generated_at`: `string`
- `wired`: `boolean`

## `GET /api/kr/ai-analysis`
- `signal_date`: `string`
- `signals`: same signal item schema as `/api/kr/signals`
- `summary`: `string`
- `generated_at`: `string`
- `wired`: `boolean`

## `GET /api/kr/ai-summary/<ticker>`
- `ticker`: `string`
- `name`: `string`
- `summary`: `string`
- `generated_at`: `string`
- `wired`: `boolean`

## `GET /api/kr/performance`
- `win_rate`: `number`
- `avg_return`: `number`
- `total_positions`: `number`
- `generated_at`: `string`
- `wired`: `boolean`

## `GET /api/kr/cumulative-return`
- `cumulative_return`: `number`
- `win_rate`: `number`
- `winners`: `number`
- `losers`: `number`
- `total_positions`: `number`
- `positions`: `Array<{ ticker: string, return_pct: number }>`
- `equity_curve`: `Array<{ date: string, equity: number }>`
- `benchmark_curve`: `Array<{ date: string, equity: number }>` (KOSPI)
- `kosdaq_benchmark_curve`: `Array<{ date: string, equity: number }>` (KOSDAQ)
- `generated_at`: `string`
- `wired`: `boolean`

## `GET /api/kr/ai-history-dates`
- `dates`: `string[]`
- `count`: `number`
- `wired`: `boolean`

## `GET /api/kr/ai-history/<date>`
- Same schema as `/api/kr/ai-analysis`

## `GET /api/kr/stock-chart/<ticker>`
- `ticker`: `string`
- `candles`: `Array<{ date, open, high, low, close, volume }>`
- `generated_at`: `string`
- `wired`: `boolean`
