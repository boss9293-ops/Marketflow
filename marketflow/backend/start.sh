#!/bin/bash

mkdir -p /app/output/cache

# Background: run build scripts if output files are missing
(
    echo "[bg] Checking output files..."

    # Wait for DB to be ready (app.py downloads it on startup)
    sleep 10

    if [ ! -f "/app/output/risk_v1.json" ]; then
        echo "[bg] Building risk_v1..."
        python scripts/build_risk_v1.py && echo "[bg][OK] risk_v1" || echo "[bg][FAIL] risk_v1"
    else
        echo "[bg] risk_v1.json exists, skipping"
    fi

    if [ ! -f "/app/output/risk_alert.json" ]; then
        echo "[bg] Building risk_alert..."
        python scripts/build_risk_alert.py && echo "[bg][OK] risk_alert" || echo "[bg][FAIL] risk_alert"
    else
        echo "[bg] risk_alert.json exists, skipping"
    fi

    if [ ! -f "/app/output/current_90d.json" ]; then
        echo "[bg] Building current_90d..."
        python scripts/build_current_90d.py && echo "[bg][OK] current_90d" || echo "[bg][FAIL] current_90d"
    else
        echo "[bg] current_90d.json exists, skipping"
    fi

    if [ ! -f "/app/output/cache/snapshots_120d.json" ]; then
        echo "[bg] Building snapshots_120d..."
        python scripts/build_snapshots_120d.py && echo "[bg][OK] snapshots_120d" || echo "[bg][FAIL] snapshots_120d"
    else
        echo "[bg] snapshots_120d.json exists, skipping"
    fi

    python scripts/build_smart_money.py   && echo "[bg][OK] smart_money"  || echo "[bg][FAIL] smart_money"
    python scripts/build_market_tape.py   && echo "[bg][OK] market_tape"  || echo "[bg][FAIL] market_tape"
    python scripts/build_market_state.py  && echo "[bg][OK] market_state" || echo "[bg][FAIL] market_state"

    if [ ! -f "/app/output/cache/health_snapshot.json" ]; then
        echo "[bg] Building health_snapshot..."
        python scripts/build_health_snapshot.py && echo "[bg][OK] health_snapshot" || echo "[bg][FAIL] health_snapshot"
    else
        echo "[bg] health_snapshot.json exists, skipping"
    fi

    if [ ! -f "/app/output/cache/action_snapshot.json" ]; then
        echo "[bg] Building action_snapshot..."
        python scripts/build_action_snapshot.py && echo "[bg][OK] action_snapshot" || echo "[bg][FAIL] action_snapshot"
    else
        echo "[bg] action_snapshot.json exists, skipping"
    fi

    if [ ! -f "/app/output/cache/context_news.json" ]; then
        echo "[bg] Building context_news..."
        python scripts/build_context_news.py && echo "[bg][OK] context_news" || echo "[bg][FAIL] context_news"
    else
        echo "[bg] context_news.json exists, skipping"
    fi

    if [ ! -f "/app/output/cache/daily_briefing.json" ]; then
        echo "[bg] Building daily_briefing..."
        python scripts/build_daily_briefing.py && echo "[bg][OK] daily_briefing" || echo "[bg][FAIL] daily_briefing"
    else
        echo "[bg] daily_briefing.json exists, skipping"
    fi

    if [ ! -f "/app/output/cache/daily_briefing_v3.json" ]; then
        echo "[bg] Building daily_briefing_v3..."
        python scripts/build_daily_briefing_v3.py && echo "[bg][OK] daily_briefing_v3" || echo "[bg][FAIL] daily_briefing_v3"
    else
        echo "[bg] daily_briefing_v3.json exists, skipping"
    fi

    if [ ! -f "/app/output/vr_pattern_dashboard.json" ]; then
        echo "[bg] Building vr_pattern_dashboard..."
        python scripts/build_vr_pattern_dashboard.py && echo "[bg][OK] vr_pattern_dashboard" || echo "[bg][FAIL] vr_pattern_dashboard"
    else
        echo "[bg] vr_pattern_dashboard.json exists, skipping"
    fi

    python scripts/build_data_manifest.py && echo "[bg][OK] data_manifest" || echo "[bg][FAIL] data_manifest"

    echo "[bg] All builds done"
) &

echo "[startup] Starting gunicorn on port ${PORT:-8080}..."
exec gunicorn --bind :${PORT:-8080} --workers 1 --threads 8 --timeout 300 app:app
