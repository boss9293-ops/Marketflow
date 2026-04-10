from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR_STR = str(BACKEND_DIR)
if BACKEND_DIR_STR not in sys.path:
    sys.path.insert(0, BACKEND_DIR_STR)

from services.data_contract import (
    DEFAULT_ARTIFACT_KEYS,
    build_manifest,
    manifest_path,
    write_manifest,
)


def _unique(seq: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in seq:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Build MarketFlow data manifest.")
    parser.add_argument(
        "--snapshot-name",
        default="playback",
        help="Snapshot DB name used in the manifest (default: playback).",
    )
    parser.add_argument(
        "--output",
        default=str(manifest_path()),
        help="Output manifest path (default: backend/output/cache/data_manifest.json).",
    )
    parser.add_argument(
        "--artifact",
        action="append",
        default=[],
        help="Extra artifact key to include in the manifest (repeatable).",
    )
    args = parser.parse_args()

    artifact_keys = _unique([*DEFAULT_ARTIFACT_KEYS, *args.artifact])
    manifest = build_manifest(artifact_keys=artifact_keys, snapshot_name=args.snapshot_name)
    out_path = write_manifest(manifest, path=Path(args.output))

    dbs = manifest.get("databases", {}) if isinstance(manifest, dict) else {}
    artifacts = manifest.get("artifacts", {}) if isinstance(manifest, dict) else {}
    live_db = dbs.get("live", {}) if isinstance(dbs, dict) else {}
    print(
        f"[OK] {out_path} | mode={manifest.get('data_mode')} | "
        f"live_tables={live_db.get('table_count', 0)} | artifacts={len(artifacts)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
