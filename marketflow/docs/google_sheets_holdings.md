# Google Sheets Holdings Pull (Optional)

This is an optional connector. It is disabled by default and only runs when all required environment variables are set.

Script:
- `backend/scripts/pull_google_sheet_holdings.py`

Output:
- `backend/output/my_holdings.json`

## Required Env Vars

- `GOOGLE_SHEETS_ID`
- `GOOGLE_SHEETS_RANGE`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

`GOOGLE_SERVICE_ACCOUNT_JSON` can be either:
- Raw JSON string of the service-account key, or
- Path to a local service-account JSON file

## Sheet Format

Header row must include:
- `symbol`
- `shares`
- `avg_cost`

Optional:
- `currency`

Example:

```csv
symbol,shares,avg_cost,currency
AAPL,10,185.50,USD
MSFT,5,410.20,USD
```

## Google Setup

1. Create a Google Cloud service account.
2. Enable Google Sheets API for the project.
3. Generate a JSON key for the service account.
4. Share the target Google Sheet with the service account email (Viewer access is enough).

## Python Dependencies

Install once in backend environment:

```bash
pip install google-auth google-api-python-client
```

## Run

PowerShell example:

```powershell
$env:GOOGLE_SHEETS_ID="your_sheet_id"
$env:GOOGLE_SHEETS_RANGE="Holdings!A:D"
$env:GOOGLE_SERVICE_ACCOUNT_JSON="C:\path\to\service-account.json"
python backend/scripts/pull_google_sheet_holdings.py
```

If env vars are missing, the script exits gracefully with `[SKIP]` and does nothing.

## Output Schema

The generated JSON matches the current holdings raw schema used by `/api/my/holdings`, including:
- `data_version`
- `generated_at`
- `status`
- `source`
- `summary`
- `positions` (`symbol`, `shares`, `avg_cost`, optional `currency`)
- `import_report`
- `rerun_hint`
