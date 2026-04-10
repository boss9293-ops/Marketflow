from __future__ import annotations

import os
from typing import Any
from zoneinfo import ZoneInfo

_scheduler = None


def _parse_hhmm(value: str, fallback: str) -> tuple[int, int]:
    raw = (value or fallback).strip()
    try:
        hour_str, minute_str = raw.split(":", 1)
        hour = max(0, min(23, int(hour_str)))
        minute = max(0, min(59, int(minute_str)))
        return hour, minute
    except Exception:
        hour_str, minute_str = fallback.split(":", 1)
        return int(hour_str), int(minute_str)


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        from jobs.build_ai_briefings import build_ai_briefings
        from jobs.run_daily_pipeline import run_daily_pipeline
        from jobs.build_validation_snapshot import build_validation_snapshot
        from config.validation_guard_policy import load_guard_policy
    except Exception as e:
        print(f"[Scheduler] Auto-Guard scheduler disabled: {e}")
        return None

    try:
        policy = load_guard_policy()
        run_time = str(((policy.get("schedule") or {}).get("daily_run_time_local")) or "18:30")
        hour, minute = _parse_hhmm(run_time, "18:30")
    except Exception as e:
        print(f"[Scheduler] Invalid validation guard schedule config, using 18:30: {e}")
        hour, minute = 18, 30

    scheduler = BackgroundScheduler()
    scheduler.add_job(
        build_validation_snapshot,
        "cron",
        hour=hour,
        minute=minute,
        kwargs={"market_proxy": "QQQ"},
        id="validation_guard_daily",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    try:
        et_zone = ZoneInfo("America/New_York")
        morning_hour, morning_minute = _parse_hhmm(os.getenv("AI_BRIEF_MORNING_TIME_ET", "09:35"), "09:35")
        close_hour, close_minute = _parse_hhmm(os.getenv("AI_BRIEF_CLOSE_TIME_ET", "16:35"), "16:35")
        pipeline_hour, pipeline_minute = _parse_hhmm(os.getenv("MARKETFLOW_DAILY_PIPELINE_TIME_ET", "17:15"), "17:15")
        scheduler.add_job(
            build_ai_briefings,
            trigger=CronTrigger(hour=morning_hour, minute=morning_minute, timezone=et_zone),
            kwargs={"run_label": "morning", "refresh_inputs": True},
            id="ai_brief_morning",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        scheduler.add_job(
            build_ai_briefings,
            trigger=CronTrigger(hour=close_hour, minute=close_minute, timezone=et_zone),
            kwargs={"run_label": "close", "refresh_inputs": True},
            id="ai_brief_close",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        turso_url = os.getenv("TURSO_DATABASE_URL", "").strip() or os.getenv("LIBSQL_URL", "").strip() or os.getenv("TURSO_URL", "").strip()
        turso_token = os.getenv("TURSO_AUTH_TOKEN", "").strip() or os.getenv("LIBSQL_AUTH_TOKEN", "").strip() or os.getenv("TURSO_TOKEN", "").strip()
        if turso_url and turso_token:
            scheduler.add_job(
                run_daily_pipeline,
                trigger=CronTrigger(hour=pipeline_hour, minute=pipeline_minute, timezone=et_zone),
                id="marketflow_daily_pipeline",
                replace_existing=True,
                max_instances=1,
                coalesce=True,
            )
            print(
                f"[Scheduler] Daily pipeline + Turso sync scheduled daily at {pipeline_hour:02d}:{pipeline_minute:02d} ET"
            )
        else:
            print("[Scheduler] Turso env vars missing; daily pipeline + sync job disabled.")
        print(
            f"[Scheduler] AI briefings scheduled daily at {morning_hour:02d}:{morning_minute:02d} ET "
            f"and {close_hour:02d}:{close_minute:02d} ET"
        )
    except Exception as e:
        print(f"[Scheduler] AI briefing scheduler disabled: {e}")

    scheduler.start()
    print(f"[Scheduler] Validation Guard scheduled daily at {hour:02d}:{minute:02d}")
    _scheduler = scheduler
    return scheduler
