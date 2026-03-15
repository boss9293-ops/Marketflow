# My Holdings JSON Schema (MVP)

## Raw input file
Path: `backend/output/my_holdings.json`

```json
{
  "data_version": "my_holdings_raw_v1",
  "generated_at": "2026-02-18T12:34:56",
  "source": "csv_upload",
  "cash": 10000,
  "positions": [
    {
      "symbol": "AAPL",
      "name": "Apple Inc",
      "qty": 10,
      "avg_cost": 185.5
    }
  ]
}
```

## Cache output file
Path: `output/cache/my_holdings.json`

```json
{
  "generated_at": "2026-02-18T12:35:10",
  "data_version": "my_holdings_cache_v1",
  "status": "ok",
  "source": "csv_upload",
  "as_of_date": "2026-02-14",
  "coverage": {
    "positions": 3,
    "priced_positions": 3,
    "priced_ratio": 100.0
  },
  "summary": {
    "total_equity": 25432.2,
    "cash": 10000,
    "total_cost": 24120.0,
    "total_pnl": 1312.2,
    "total_pnl_pct": 5.44,
    "mdd_pct": -8.31,
    "position_count": 3
  },
  "positions": [],
  "weights": [],
  "charts": {
    "weights_donut": [],
    "equity_vs_cost": [],
    "history": []
  },
  "rerun_hint": "python backend/scripts/build_my_holdings_cache.py"
}
```

## Setup notes
- Import CSV in `/my` page (recommended), or write `backend/output/my_holdings.json` manually.
- Build cache:
  - `python backend/scripts/build_my_holdings_cache.py`
- Optional Google Sheets pull (disabled unless env configured):
  - `python backend/scripts/pull_google_sheet_holdings.py`
  - env: `GOOGLE_SHEETS_ID`, `GOOGLE_SHEETS_RANGE`

