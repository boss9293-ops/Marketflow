"""
rename_daily_data.py
Renames *.us.txt files in the Daily_data folder to *.txt.
Removes the '.us' exchange suffix from Spooq filenames so that
file lookup no longer depends on canonical_symbol() stripping it.

Usage:
    python rename_daily_data.py [--dry-run]
"""
import argparse
import sys
sys.path.insert(0, 'marketflow/backend/scripts')

from pathlib import Path
from db_utils import daily_data_root


def rename_all(root: Path, dry_run: bool) -> None:
    targets = list(root.rglob("*.us.txt"))
    if not targets:
        print("No *.us.txt files found.")
        return

    renamed = 0
    skipped = 0
    for src in sorted(targets):
        # smh.us.txt  ->  smh.txt
        new_name = src.name[:-len(".us.txt")] + ".txt"
        dst = src.parent / new_name
        if dst.exists():
            print(f"  SKIP (target exists): {src.name} -> {new_name}")
            skipped += 1
            continue
        if dry_run:
            print(f"  DRY  {src.relative_to(root)}  ->  {new_name}")
        else:
            src.rename(dst)
            print(f"  OK   {src.relative_to(root)}  ->  {new_name}")
        renamed += 1

    label = "would rename" if dry_run else "renamed"
    print(f"\n{label}: {renamed}  skipped: {skipped}  total scanned: {len(targets)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rename *.us.txt -> *.txt in Daily_data")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be renamed without making changes")
    parser.add_argument("--root", default=None, help="Override Daily_data path")
    args = parser.parse_args()

    root = Path(args.root) if args.root else Path(daily_data_root())
    print(f"Daily_data root: {root}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}\n")
    rename_all(root, dry_run=args.dry_run)
