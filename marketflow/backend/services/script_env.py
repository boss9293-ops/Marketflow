from __future__ import annotations

import os
from typing import Mapping

from .data_contract import backend_dir


def build_script_env(
    base_env: Mapping[str, str] | None = None,
    *,
    include_google_sa: bool = False,
    google_sa_json: str | None = None,
) -> dict[str, str]:
    env = dict(os.environ if base_env is None else base_env)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    backend_path = str(backend_dir())
    pythonpath = env.get("PYTHONPATH", "").strip()
    env["PYTHONPATH"] = backend_path if not pythonpath else backend_path + os.pathsep + pythonpath

    if include_google_sa and not env.get("GOOGLE_SERVICE_ACCOUNT_JSON") and google_sa_json:
        env["GOOGLE_SERVICE_ACCOUNT_JSON"] = google_sa_json

    return env
