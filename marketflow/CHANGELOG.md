# Changelog

## 2026-02-18
- Added Flask endpoints:
  - `GET /api/chart?symbol=...&days=...`
  - `GET /api/ticker-summary?symbol=...`
- Switched frontend watchlist persistence to localStorage (`marketflow_watchlist_v1`) with no-login flow.
- Added watchlist unknown-symbol support (accept symbol even if universe lookup fails).
- Updated watchlist sidebar item behavior:
  - click symbol -> route to `/ticker/[symbol]`
  - remove via `x` action
- Added ticker detail page: `frontend/src/app/ticker/[symbol]/page.tsx`
  - price summary
  - candlestick chart (1M/3M/6M/1Y)
  - SMA20/50/200 overlays
  - symbol signals list
  - AI brief v1 text block
- Kept existing cache-first pages intact; no breaking changes intended.
