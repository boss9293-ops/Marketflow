# MarketFlow - Integrated Investment Platform

> Professional US Market Analysis Platform with AI-powered insights

## Quick Start

### 1. Backend Setup
```bash
cd backend
pip install -r requirements.txt

# Generate data files (run these first!)
python scripts/market_data.py
python scripts/screener.py
python scripts/smart_money.py
python scripts/predictor_ml.py
python scripts/regime_classifier.py
python scripts/risk_calculator.py

# Optional: AI Briefing (requires Perplexity API key)
# export PERPLEXITY_API_KEY=your_key_here
# python scripts/briefing_ai.py

# Start Flask API server (port 5001)
python app.py
```

### 2. Frontend Setup (new terminal)
```bash
cd frontend
npm install
npm run dev   # opens http://localhost:3000
```

---

## Features

| Page | Route | Description |
|------|-------|-------------|
| Dashboard | `/` | Overview with BuySignal, MarketGate, Indices |
| AI Briefing | `/briefing` | Perplexity AI 기반 시장 분석 |
| Top Picks | `/top-picks` | AI 복합 점수 상위 10개 종목 |
| Smart Money | `/smart-money` | 기관 자금 흐름 감지 |
| Risk Dashboard | `/risk` | VaR, 드로다운, 샤프 비율 |
| Earnings | `/earnings` | 실적 발표 캘린더 |
| Sectors | `/sectors` | 섹터 히트맵 & 로테이션 |
| VCP Signals | `/signals` | 기술적 패턴 신호 |
| Economic Calendar | `/calendar` | 주요 경제 지표 |
| ML Prediction | `/prediction` | 5일 SPY/QQQ 방향 예측 |
| Market Regime | `/regime` | Bull/Bear/Transition 분류 |

---

## API Endpoints

Flask server: `http://localhost:5001`

| Endpoint | Description |
|----------|-------------|
| `GET /api/market/indices` | Major indices (SPY, QQQ, DIA, IWM, VIX...) |
| `GET /api/market/gate` | Market Gate score 0-100 |
| `GET /api/briefing` | AI market briefing |
| `GET /api/top-picks` | Top 10 stock picks |
| `GET /api/smart-money` | Institutional flow signals |
| `GET /api/risk` | Portfolio risk metrics |
| `GET /api/earnings` | Earnings calendar |
| `GET /api/sectors` | Sector performance |
| `GET /api/signals` | VCP pattern signals |
| `GET /api/calendar` | Economic calendar |
| `GET /api/prediction` | ML direction prediction |
| `GET /api/regime` | Market regime classification |

---

## Project Structure

```
marketflow/
├── backend/
│   ├── app.py                    # Flask server (12 endpoints)
│   ├── requirements.txt
│   ├── scripts/
│   │   ├── market_data.py        # Real-time market data + Market Gate
│   │   ├── screener.py           # S&P 500 smart screener → top_picks.json
│   │   ├── smart_money.py        # Institutional flow detection
│   │   ├── predictor_ml.py       # GradientBoosting 5-day prediction
│   │   ├── briefing_ai.py        # Perplexity AI briefing
│   │   ├── regime_classifier.py  # Bull/Bear/Transition classifier
│   │   └── risk_calculator.py    # VaR, Sharpe, drawdown
│   ├── ai_engines/
│   │   ├── sentiment.py
│   │   ├── pattern.py
│   │   └── optimizer.py
│   └── output/                   # JSON data files (auto-generated)
└── frontend/
    ├── src/app/                  # 11 page routes (App Router)
    │   ├── page.tsx              # Dashboard
    │   ├── briefing/
    │   ├── top-picks/
    │   ├── smart-money/
    │   ├── risk/
    │   ├── earnings/
    │   ├── sectors/
    │   ├── signals/
    │   ├── calendar/
    │   ├── prediction/
    │   └── regime/
    ├── src/components/           # 13 UI components
    │   ├── Sidebar.tsx
    │   ├── BuySignalCard.tsx
    │   ├── MarketGate.tsx
    │   ├── MajorIndices.tsx
    │   ├── TopPicksTable.tsx
    │   ├── SmartMoneyChart.tsx
    │   ├── RiskMetrics.tsx
    │   ├── SectorHeatmap.tsx
    │   ├── SignalsGrid.tsx
    │   ├── PredictionGauge.tsx
    │   ├── RegimeIndicator.tsx
    │   ├── CircularProgress.tsx
    │   └── BriefingView.tsx
    ├── package.json
    └── tailwind.config.ts
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Charts | Recharts |
| Backend | Flask (Python 3.11+), Flask-CORS |
| Data | yfinance (free, no API key) |
| AI | Perplexity API (optional) |
| ML | scikit-learn GradientBoosting |
| Storage | JSON files (no DB needed) |

---

## Design System

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#0a0a0a` | Page background |
| Sidebar | `#1a1a1a` | Navigation sidebar |
| Card | `#1c1c1e` | Content cards |
| Accent | `#00D9FF` | Highlights, active links |
| Positive | `#22c55e` | Green signals |
| Negative | `#ef4444` | Red alerts |
| Warning | `#f97316` | Orange caution |
| Analytics | `#3b82f6` | Blue ML/analytics |

---

## Market Gate Score

| Score | Status | Signal |
|-------|--------|--------|
| 70-100 | GREEN | BUY — Aggressive positioning |
| 40-69 | YELLOW | SELECTIVE — Quality stocks only |
| 0-39 | RED | HOLD — Increase cash |

Components: VIX level (30pt) + Trend (25pt) + Momentum (15pt) + Regime (15pt) + Volume (15pt)

---

## Notes

- Run Python scripts **before** starting Flask to generate JSON files in `backend/output/`
- Frontend shows "Loading..." until data files exist — run scripts first
- `PERPLEXITY_API_KEY` optional — briefing page shows setup instructions without it
- Re-run scripts daily to refresh market data
- For educational purposes only. Not investment advice.

---

## Windows Scheduler (Daily Pipeline)

Register a daily task for the daily pipeline runner:

```powershell
cd backend\scripts
powershell -ExecutionPolicy Bypass -File .\manage_scheduler.ps1 -Action install -Time 08:30
```

Check status:

```powershell
cd backend\scripts
powershell -ExecutionPolicy Bypass -File .\manage_scheduler.ps1 -Action status
```

Remove task:

```powershell
cd backend\scripts
powershell -ExecutionPolicy Bypass -File .\manage_scheduler.ps1 -Action remove
```

Notes:
- Default task name: `MarketFlowPipelineDaily`
- Log file: `backend/output/pipeline_task.log`
- The task now runs `run_pipeline_scheduled.py`, so it also syncs to Turso when the env vars are present.
- To use a specific Python path:
  `-PythonExe "C:\Path\To\python.exe"`

---

## Railway + Turso Daily Sync

Production runs the same pipeline on Railway and then pushes the refreshed local SQLite DB into Turso.

Flow:
1. Railway starts `backend/startup.py` and builds the local outputs.
2. The Flask scheduler keeps the briefing jobs running at ET market checkpoints.
3. A daily pipeline job runs `backend/run_pipeline_scheduled.py` after the close.
4. If `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set, the pipeline auto-syncs the live DB at `data/marketflow.db` to Turso with verification.

Recommended Railway environment variables:
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- Optional schedule override: `MARKETFLOW_DAILY_PIPELINE_TIME_ET` (default `17:15`)

Manual run:

```bash
cd marketflow/backend
python -X utf8 run_pipeline_scheduled.py
```

If the Turso env vars are missing, the sync step is skipped safely, so local development still works.

To disable the server-side scheduler in a non-production environment, set:

```bash
MARKETFLOW_DISABLE_SCHEDULER=1
```
