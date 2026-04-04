from __future__ import annotations

from functools import lru_cache
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional, Tuple

from db_utils import canonical_symbol, daily_data_root


@lru_cache(maxsize=8)
def build_spooq_index(root: str) -> dict[str, Path]:
    base = Path(root)
    index: dict[str, Path] = {}
    if not base.exists():
        return index

    for path in sorted(base.rglob("*.txt")):
        if not path.is_file():
            continue
        symbol = canonical_symbol(path.stem)
        if symbol not in index:
            index[symbol] = path
    return index


def find_spooq_file(symbol: str, source_dir: str | Path | None = None) -> Path | None:
    root = Path(source_dir).expanduser().resolve() if source_dir else daily_data_root()
    index = build_spooq_index(str(root))
    return index.get(canonical_symbol(symbol))


def parse_spooq_line(line: str) -> Optional[Tuple[str, str, float | None, float | None, float | None, float | None, float | None, int | None]]:
    parts = line.strip().split(",")
    if len(parts) < 9:
        return None

    try:
        symbol = canonical_symbol(parts[0])
        date = parts[2].strip()
        if len(date) != 8 or not date.isdigit():
            return None
        date_formatted = f"{date[:4]}-{date[4:6]}-{date[6:8]}"

        def parse_float(value: str | None) -> float | None:
            if value is None:
                return None
            value = value.strip()
            if not value:
                return None
            try:
                return float(value)
            except ValueError:
                return None

        def parse_int(value: str | None) -> int | None:
            parsed = parse_float(value)
            if parsed is None:
                return None
            return int(round(parsed))

        open_price = parse_float(parts[4])
        high = parse_float(parts[5])
        low = parse_float(parts[6])
        close = parse_float(parts[7])
        volume = parse_int(parts[8])
        if close is None:
            return None

        # adj_close is set to close: Spooq data has no split/dividend adjustment.
        return (
            symbol,
            date_formatted,
            open_price,
            high,
            low,
            close,
            close,   # adj_close = close (no adjustment available from Spooq)
            volume,
        )
    except Exception:
        return None


def load_spooq_rows(
    file_path: Path,
    *,
    symbol_override: str | None = None,
    start_date: str | None = None,
    source_label: str = "spooq",
) -> tuple[list[tuple], int]:
    rows: list[tuple] = []
    bad_rows = 0
    symbol_key = canonical_symbol(symbol_override or file_path.stem)
    now_iso = datetime.now().isoformat(timespec="seconds")

    with file_path.open("r", encoding="utf-8", errors="ignore") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("<"):
                continue
            parsed = parse_spooq_line(line)
            if parsed is None:
                bad_rows += 1
                continue
            row_symbol, date, open_price, high, low, close, adj_close, volume = parsed
            if start_date and date < start_date:
                continue
            rows.append(
                (
                    symbol_key,
                    date,
                    open_price,
                    high,
                    low,
                    close,
                    adj_close,
                    volume,
                    source_label,
                    now_iso,
                )
            )

    return rows, bad_rows


def load_spooq_rows_for_symbol(
    symbol: str,
    *,
    source_dir: str | Path | None = None,
    start_date: str | None = None,
    source_label: str = "spooq",
) -> tuple[list[tuple], int, Path | None]:
    file_path = find_spooq_file(symbol, source_dir=source_dir)
    if file_path is None:
        return [], 0, None
    rows, bad_rows = load_spooq_rows(
        file_path,
        symbol_override=symbol,
        start_date=start_date,
        source_label=source_label,
    )
    return rows, bad_rows, file_path
