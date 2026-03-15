from __future__ import annotations

import json
import os
from typing import Any, Dict


def _backend_dir() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def default_guard_policy_path() -> str:
    return os.path.join(_backend_dir(), "config", "validation_guard_policy_v1.json")


def load_guard_policy(path: str | None = None) -> Dict[str, Any]:
    p = path or default_guard_policy_path()
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

