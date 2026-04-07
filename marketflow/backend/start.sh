#!/bin/bash

DB_URL="https://github.com/boss9293-ops/Marketflow/releases/download/data-v1/marketflow.db"
DB_PATH="/app/data/marketflow.db"

mkdir -p /app/data /app/output/cache

# Background: DB download + build scripts
(
    # Download DB if missing or too small
    if [ ! -f "$DB_PATH" ] || [ $(stat -c%s "$DB_PATH" 2>/dev/null || echo 0) -lt 104857600 ]; then
        echo "[bg] Downloading marketflow.db (~613MB)..."
        curl -L --retry 3 --retry-delay 5 -o "$DB_PATH" "$DB_URL"
        echo "[bg] DB downloaded: $(du -sh $DB_PATH | cut -f1)"
    else
        echo "[bg] DB exists: $(du -sh $DB_PATH | cut -f1)"
    fi

    SENTINEL="/app/output/.built"
    if [ ! -f "$SENTINEL" ]; then
        echo "[bg] Building core JSON outputs..."
        python scripts/build_risk_v1.py      && echo "[bg][OK] risk_v1"      || echo "[bg][FAIL] risk_v1"
        python scripts/build_risk_alert.py   && echo "[bg][OK] risk_alert"   || echo "[bg][FAIL] risk_alert"
        python scripts/build_current_90d.py  && echo "[bg][OK] current_90d"  || echo "[bg][FAIL] current_90d"
        python scripts/build_smart_money.py  && echo "[bg][OK] smart_money"  || echo "[bg][FAIL] smart_money"
        python scripts/build_market_tape.py  && echo "[bg][OK] market_tape"  || echo "[bg][FAIL] market_tape"
        python scripts/build_market_state.py && echo "[bg][OK] market_state" || echo "[bg][FAIL] market_state"
        python scripts/build_daily_briefing_v3.py && echo "[bg][OK] briefing_v3" || echo "[bg][FAIL] briefing_v3"
        touch "$SENTINEL"
        echo "[bg] Build complete"
    else
        echo "[bg] Outputs exist, skipping build"
    fi
) &

# Start gunicorn immediately (Railway health check passes right away)
echo "[startup] Starting gunicorn on port ${PORT:-8080}..."
exec gunicorn --bind :${PORT:-8080} --workers 1 --threads 8 --timeout 300 app:app
