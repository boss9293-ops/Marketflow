from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any


def normalize_date_str(raw: Any) -> str | None:
    if raw is None:
        return None

    text = str(raw).strip()
    if not text:
        return None

    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]

    for fmt in ("%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass

    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except Exception:
        return text[:10] if len(text) >= 10 else text


def normalize_daily_snapshot_dates(conn: sqlite3.Connection) -> int:
    try:
        columns = [row[1] for row in conn.execute("PRAGMA table_info(daily_snapshots)").fetchall()]
    except Exception:
        return 0

    if not columns or "date" not in columns:
        return 0

    quoted_columns = ", ".join(f'"{column}"' for column in columns)
    rows = conn.execute(f"SELECT rowid, {quoted_columns} FROM daily_snapshots").fetchall()
    if not rows:
        return 0

    changed = 0
    for row in rows:
        rowid = row[0]
        record = dict(zip(columns, row[1:]))
        raw_date = record.get("date")
        normalized = normalize_date_str(raw_date)
        if not normalized or normalized == raw_date:
            continue

        target = conn.execute(
            f"SELECT rowid, {quoted_columns} FROM daily_snapshots WHERE date = ?",
            (normalized,),
        ).fetchone()

        if target:
            target_rowid = target[0]
            target_record = dict(zip(columns, target[1:]))
            merged: dict[str, Any] = {}
            for column in columns:
                if column == "date":
                    continue
                source_value = record.get(column)
                target_value = target_record.get(column)
                if target_value in (None, "") and source_value not in (None, ""):
                    merged[column] = source_value

            if merged:
                set_clause = ", ".join(f'"{column}" = ?' for column in merged)
                params = list(merged.values()) + [target_rowid]
                conn.execute(
                    f"UPDATE daily_snapshots SET {set_clause} WHERE rowid = ?",
                    params,
                )
                changed += 1

            conn.execute("DELETE FROM daily_snapshots WHERE rowid = ?", (rowid,))
            changed += 1
        else:
            conn.execute(
                "UPDATE daily_snapshots SET date = ? WHERE rowid = ?",
                (normalized, rowid),
            )
            changed += 1

    if changed:
        conn.commit()
    return changed
