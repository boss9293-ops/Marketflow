"""
Initialize SQLite database from repo-level schema.sql.

Creates:
- data/marketflow.db (live)

Loads:
- db/schema.sql
"""
import os
import sqlite3
import sys


def main():
    script_dir = os.path.dirname(__file__)
    repo_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    schema_path = os.path.join(repo_root, "db", "schema.sql")
    data_dir = os.path.join(repo_root, "data")
    db_path = os.path.join(data_dir, "marketflow.db")

    if not os.path.exists(schema_path):
        print(f"[ERROR] schema file not found: {schema_path}")
        return 1

    os.makedirs(data_dir, exist_ok=True)

    with open(schema_path, "r", encoding="utf-8") as f:
        schema_sql = f.read()

    from db_utils import db_connect
    conn = db_connect(db_path)
    try:
        conn.executescript(schema_sql)
        conn.commit()

        rows = conn.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name NOT LIKE 'sqlite_%'
            ORDER BY name;
            """
        ).fetchall()
        tables = [r[0] for r in rows]

        print(f"[OK] DB initialized: {db_path}")
        print("[OK] Tables:")
        for t in tables:
            print(f" - {t}")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
