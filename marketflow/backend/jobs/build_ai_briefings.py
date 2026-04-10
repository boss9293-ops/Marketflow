from __future__ import annotations

import os
import subprocess
import sys


def _backend_dir() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _run_backend_script(script_name: str, extra_args: list[str] | None = None, timeout: int = 900) -> subprocess.CompletedProcess[str]:
    backend_dir = _backend_dir()
    script = os.path.join(backend_dir, "scripts", script_name)
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return subprocess.run(
        [sys.executable, "-X", "utf8", script, *(extra_args or [])],
        cwd=backend_dir,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        env=env,
    )


def build_ai_briefings(run_label: str = "manual", refresh_inputs: bool = False) -> bool:
    success = True

    if refresh_inputs:
        refresh_steps = [
            ("build_context_news.py", ["--region", "us", "--limit", "5", "--slot", run_label], 180),
            ("build_daily_briefing.py", [], 300),
            ("build_daily_briefing_v3.py", ["--force", "--slot", run_label], 300),
        ]

        for script_name, extra_args, timeout in refresh_steps:
            proc = _run_backend_script(script_name, extra_args=extra_args, timeout=timeout)
            if proc.returncode != 0:
                msg = (proc.stderr or proc.stdout or "").strip()
                print(f"[AIBriefingsScheduler] {script_name} failed rc={proc.returncode}: {msg}")
                success = False
                continue

            out = (proc.stdout or "").strip()
            if out:
                print(f"[AIBriefingsScheduler] {out}")

    proc = _run_backend_script("build_ai_briefings.py", extra_args=["--slot", run_label], timeout=900)
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip()
        print(f"[AIBriefingsScheduler] build_ai_briefings failed rc={proc.returncode}: {msg}")
        return False
    out = (proc.stdout or "").strip()
    if out:
        print(f"[AIBriefingsScheduler] {out}")
    return success
