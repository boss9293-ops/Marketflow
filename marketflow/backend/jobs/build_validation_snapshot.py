from __future__ import annotations

import os
import subprocess
import sys
from typing import Optional


def _backend_dir() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def build_validation_snapshot(market_proxy: str = "QQQ") -> bool:
    """
    APScheduler job wrapper for backend/scripts/build_validation_snapshot.py.
    Returns True on success.
    """
    backend_dir = _backend_dir()
    script = os.path.join(backend_dir, "scripts", "build_validation_snapshot.py")
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    market_proxy = (market_proxy or "QQQ").upper()
    if market_proxy not in ("QQQ", "SPY"):
        market_proxy = "QQQ"

    proc = subprocess.run(
        [sys.executable, "-X", "utf8", script, "--market-proxy", market_proxy],
        cwd=backend_dir,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=600,
        env=env,
    )
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip()
        print(f"[ValidationGuardScheduler] build_validation_snapshot failed rc={proc.returncode}: {msg}")
        return False
    out = (proc.stdout or "").strip()
    if out:
        print(f"[ValidationGuardScheduler] {out}")
    return True

