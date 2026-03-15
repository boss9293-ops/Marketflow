# My Holdings Template v2

Template file: `docs/my_holdings_template_v2.csv`

## Column Type Rules

- `symbol`: ticker string (required), uppercase recommended (example: `AAPL`)
- `shares`: number (required), must be `> 0`
- `avg_cost`: number (required for valuation, defaults to `0` if missing)
- Price/amount columns: decimal number (USD), do not use currency symbols
  - `yesterday_close`, `today_close`, `pnl_today`, `equity`, `cost_basis`, `buy_total`, `cum_pnl_usd`, `high_52w`, `low_52w`, `ma5`, `ma120`, `ma200`
- Percent columns: decimal percent value (not ratio)
  - `change_pct`, `position_pct`, `cum_return_pct`, `mdd_pct`
  - Example: `1.25` means `1.25%`
- `rsi`: number in `0~100` (nullable)
- `volume_k`: volume in thousands (k units), number
- `note`: optional free text

## Compatibility

- v1 CSV (`symbol,qty,avg_cost`) is still supported by importer.
- Missing optional columns are automatically backfilled by backend cache builder.
