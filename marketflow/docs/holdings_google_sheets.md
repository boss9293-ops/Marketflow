# Google Sheets Holdings (Time-Series)

## Setup
- Set env vars (PowerShell):
  ```powershell
  $env:GOOGLE_SHEETS_ID="your_sheet_id"
  $env:GOOGLE_SERVICE_ACCOUNT_JSON="C:\path\to\service-account.json"  # or raw JSON string
  ```
- Optional range override is not needed; ranges are fixed:
  - Goal tab: `D21:H500`
  - Other tabs: `D49:H500`
- Excluded by default: `ReadMe`, `Holidays`, `RSI`, any tab starting with `_`.

## Pipeline (holdings mode)
```powershell
python backend/run_all.py --mode holdings --sheet_id $env:GOOGLE_SHEETS_ID --tabs "Goal,Tab1,Tab2"
```
Steps: list_sheet_tabs -> import_holdings_tabs -> build_holdings_ts_cache -> build_cache_json.

## One-off commands
- List tabs: `python backend/scripts/list_sheet_tabs.py --sheet_id <ID>`
- Import selected tabs: `python backend/scripts/import_holdings_tabs.py --sheet_id <ID> --tabs Goal,Tab1`
- Build merged cache only: `python backend/scripts/build_holdings_ts_cache.py`
- Export TS CSV: `python backend/scripts/export_holdings_ts_csv.py --output backend/output/my_holdings_ts.csv`
- Import TS CSV: `python backend/scripts/import_holdings_ts_csv.py --csv backend/output/my_holdings_ts.csv`

## Outputs
- `backend/output/sheet_tabs.json` (tab metadata, excluded flags)
- `backend/output/my_holdings_goal.json` (Goal tab series)
- `backend/output/my_holdings_tabs.json` (per-tab series for selected tabs)
- `backend/output/my_holdings_ts.json` + `output/cache/my_holdings_ts.json` (merged / active)

## Frontend usage
- `/api/my/holdings/tabs` returns `sheet_tabs.json`
- `/api/my/holdings/ts` returns `my_holdings_ts.json`
- `/api/my/holdings/import-tabs` triggers import + cache build (sheet_url or sheet_id + tabs)
- `/api/my/holdings/ts/export` downloads CSV (cache-only)

## Expected CSV schema (time-series)
`tab,date,total,in,pl,pl_pct,delta`
