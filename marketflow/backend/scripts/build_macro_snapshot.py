from __future__ import annotations

import importlib.util
import os
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKEND = os.path.join(ROOT, "backend")
for p in (ROOT, BACKEND):
    if p not in sys.path:
        sys.path.insert(0, p)

if __name__ == "__main__":
    # Use root-level cache-only builder to avoid heavy deps in runtime.
    script_path = os.path.join(ROOT, "build_macro_snapshot.py")
    spec = importlib.util.spec_from_file_location("marketflow_root_build_macro_snapshot", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load snapshot builder: {script_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.main()
    print(os.path.join(ROOT, "data", "snapshots", "macro_snapshot_latest.json"))
