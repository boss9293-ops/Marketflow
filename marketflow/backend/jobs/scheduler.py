from __future__ import annotations

from typing import Any

_scheduler = None


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from jobs.build_validation_snapshot import build_validation_snapshot
        from config.validation_guard_policy import load_guard_policy
    except Exception as e:
        print(f"[Scheduler] Auto-Guard scheduler disabled: {e}")
        return None

    try:
        policy = load_guard_policy()
        run_time = str(((policy.get("schedule") or {}).get("daily_run_time_local")) or "18:30")
        hour, minute = map(int, run_time.split(":"))
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
    scheduler.start()
    print(f"[Scheduler] Validation Guard scheduled daily at {hour:02d}:{minute:02d}")
    _scheduler = scheduler
    return scheduler

