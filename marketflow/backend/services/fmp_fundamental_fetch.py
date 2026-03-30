from __future__ import annotations

import json
import math
import os
import re
import sqlite3
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

import requests

DEFAULT_PILOT_TICKERS: Sequence[str] = ("AAPL", "MSFT", "NVDA")
DEFAULT_BASE_URL = "https://financialmodelingprep.com/stable"
API_KEY_ENV_VARS: Sequence[str] = ("FMP_API_KEY", "NEXT_PUBLIC_FMP_API_KEY")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def resolve_db_path(db_path: Optional[str] = None) -> str:
    if db_path:
        return str(Path(db_path).expanduser().resolve())
    env_path = os.getenv("FMP_CONSENSUS_DB_PATH", "").strip()
    if env_path:
        return str(Path(env_path).expanduser().resolve())
    return str((_repo_root() / "data" / "marketflow.db").resolve())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _db_connect(db_path: Optional[str] = None) -> sqlite3.Connection:
    path = resolve_db_path(db_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fmp_consensus_snapshot (
            ticker TEXT PRIMARY KEY,
            source TEXT NOT NULL DEFAULT 'fmp',
            captured_at TEXT NOT NULL,
            source_asof TEXT,
            eps_estimate_fy1 REAL,
            eps_estimate_fy2 REAL,
            target_mean REAL,
            target_high REAL,
            target_low REAL,
            analyst_count INTEGER,
            target_analyst_count INTEGER,
            raw_estimates_json TEXT,
            raw_price_target_json TEXT,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    _ensure_column(conn, "fmp_consensus_snapshot", "eps_ladder_json", "TEXT")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_fmp_consensus_snapshot_updated_at ON fmp_consensus_snapshot(updated_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_fmp_consensus_snapshot_captured_at ON fmp_consensus_snapshot(captured_at)"
    )
    conn.commit()


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _normalize_ticker(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if ":" in raw:
        raw = raw.split(":")[-1]
    if not re.match(r"^[A-Z0-9.\-]{1,15}$", raw):
        raise ValueError(f"Invalid ticker: {value!r}")
    return raw


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip().replace(",", "").replace("$", "").replace("%", "")
            if not value:
                return None
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return None
        return number
    except Exception:
        return None


def _safe_int(value: Any) -> Optional[int]:
    try:
        if value is None:
            return None
        return int(float(str(value).strip().replace(",", "")))
    except Exception:
        return None


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _first_non_empty(values: Iterable[Any]) -> Optional[Any]:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def _as_list(payload: Any) -> List[Dict[str, Any]]:
    if payload is None:
        return []
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in ("data", "results", "historical", "estimates", "priceTargets"):
            nested = payload.get(key)
            if isinstance(nested, list):
                return [row for row in nested if isinstance(row, dict)]
        return [payload]
    return []


def _first_dict(payload: Any) -> Dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, list):
        for row in payload:
            if isinstance(row, dict):
                return row
    return {}


def _extract_year(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        year = int(value)
        return year if 1900 <= year <= 3000 else None
    text = str(value).strip()
    if not text:
        return None
    if len(text) >= 4:
        match = re.search(r"(19|20)\d{2}", text)
        if match:
            return int(match.group(0))
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt.year
    except Exception:
        return None


def _pick_float(source: Dict[str, Any], keys: Sequence[str]) -> Optional[float]:
    for key in keys:
        value = _safe_float(source.get(key))
        if value is not None:
            return value
    return None


def _pick_int(source: Dict[str, Any], keys: Sequence[str]) -> Optional[int]:
    for key in keys:
        value = _safe_int(source.get(key))
        if value is not None:
            return value
    return None


def _parse_estimate_rows(payload: Any) -> List[Dict[str, Any]]:
    rows = []
    for index, raw in enumerate(_as_list(payload)):
        year = _extract_year(
            _first_non_empty(
                [
                    raw.get("date"),
                    raw.get("calendarYear"),
                    raw.get("fiscalYear"),
                    raw.get("year"),
                    raw.get("period"),
                ]
            )
        )
        eps = _pick_float(
            raw,
            (
                "estimatedEpsAvg",
                "epsAvg",
                "estimatedEps",
                "epsEstimate",
                "epsEstimated",
                "consensusEps",
                "eps",
            ),
        )
        analysts = _pick_int(
            raw,
            (
                "numberAnalystsEstimatedEpsAvg",
                "numberAnalysts",
                "analystCount",
                "numAnalysts",
                "numAnalystsEps",
                "analysts",
            ),
        )
        eps_low = _pick_float(
            raw,
            (
                "estimatedEpsLow",
                "epsLow",
                "epsEstimateLow",
                "epslLow",
            ),
        )
        eps_high = _pick_float(
            raw,
            (
                "estimatedEpsHigh",
                "epsHigh",
                "epsEstimateHigh",
                "epshHigh",
            ),
        )
        rows.append(
            {
                "index": index,
                "year": year,
                "eps": eps,
                "eps_low": eps_low,
                "eps_high": eps_high,
                "analyst_count": analysts,
                "raw": raw,
            }
        )
    return rows


def _choose_forward_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not rows:
        return []
    current_year = datetime.now(timezone.utc).year
    forward_rows = [row for row in rows if row["year"] is None or row["year"] >= current_year]
    usable = forward_rows if forward_rows else rows
    usable = [row for row in usable if row.get("eps") is not None]
    usable.sort(
        key=lambda row: (
            row["year"] is None,
            row["year"] if row["year"] is not None else 9999,
            row["index"],
        )
    )
    return usable


def _normalize_estimates(payload: Any) -> Dict[str, Any]:
    rows = _parse_estimate_rows(payload)
    usable = _choose_forward_rows(rows)
    fy1 = usable[0]["eps"] if len(usable) >= 1 else None
    fy2 = usable[1]["eps"] if len(usable) >= 2 else None
    analyst_count = None
    source_asof = None
    for row in usable:
        if analyst_count is None:
            analyst_count = row.get("analyst_count")
        if source_asof is None and row.get("year") is not None:
            raw = row.get("raw") if isinstance(row.get("raw"), dict) else {}
            source_asof = _first_non_empty(
                [
                    raw.get("date"),
                    raw.get("updatedDate"),
                    raw.get("lastUpdated"),
                    raw.get("calendarYear"),
                    raw.get("fiscalYear"),
                    row.get("year"),
                ]
            )
    if source_asof is None:
        for row in rows:
            raw = row.get("raw") if isinstance(row.get("raw"), dict) else {}
            source_asof = _first_non_empty(
                [
                    raw.get("date"),
                    raw.get("updatedDate"),
                    raw.get("lastUpdated"),
                    raw.get("calendarYear"),
                    raw.get("fiscalYear"),
                    row.get("year"),
                ]
            )
            if source_asof is not None:
                break
    return {
        "eps_estimate_fy1": fy1,
        "eps_estimate_fy2": fy2,
        "analyst_count": analyst_count,
        "source_asof": source_asof,
        "rows": rows,
        "eps_ladder": _normalize_eps_ladder(rows),
        "raw": _as_list(payload),
    }


def _normalize_eps_ladder(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    current_year = datetime.now(timezone.utc).year
    ordered = [
        row
        for row in rows
        if isinstance(row, dict) and row.get("year") is not None and row.get("eps") is not None
    ]
    ordered.sort(key=lambda row: (int(row["year"]), int(row.get("index") or 0)))

    ladder: List[Dict[str, Any]] = []
    previous_eps: Optional[float] = None
    for row in ordered:
        year = _safe_int(row.get("year"))
        eps = _safe_float(row.get("eps"))
        if year is None or eps is None or eps <= 0:
            continue

        kind = "actual" if year < current_year else "estimate"
        label = f"{year} Actual" if kind == "actual" else f"{year} Estimated"
        detail = "actual" if kind == "actual" else "using the consensus earnings estimate"
        growth_pct = None
        if previous_eps is not None and previous_eps > 0:
            growth_pct = (eps - previous_eps) / previous_eps

        eps_low_raw  = _safe_float(row.get("eps_low"))
        eps_high_raw = _safe_float(row.get("eps_high"))
        ladder.append(
            {
                "year": year,
                "label": label,
                "detail": detail,
                "kind": kind,
                "eps": round(float(eps), 4),
                "eps_low":  None if eps_low_raw  is None else round(float(eps_low_raw),  4),
                "eps_high": None if eps_high_raw is None else round(float(eps_high_raw), 4),
                "analyst_count": _safe_int(row.get("analyst_count")),
                "growth_pct": None if growth_pct is None else round(float(growth_pct), 4),
                "raw_date": _first_non_empty(
                    [
                        row.get("raw", {}).get("date") if isinstance(row.get("raw"), dict) else None,
                        row.get("raw", {}).get("calendarYear") if isinstance(row.get("raw"), dict) else None,
                        row.get("raw", {}).get("fiscalYear") if isinstance(row.get("raw"), dict) else None,
                        row.get("raw", {}).get("year") if isinstance(row.get("raw"), dict) else None,
                    ]
                ),
            }
        )
        previous_eps = float(eps)

    return ladder


def _normalize_price_target(payload: Any) -> Dict[str, Any]:
    raw = _first_dict(payload)
    target_mean = _pick_float(
        raw,
        (
            "targetMean",
            "target_mean",
            "meanTarget",
            "consensusTarget",
            "consensusPriceTarget",
            "targetPriceMean",
            "targetConsensus",
            "targetMedian",
        ),
    )
    target_high = _pick_float(
        raw,
        (
            "targetHigh",
            "target_high",
            "highTarget",
            "priceTargetHigh",
        ),
    )
    target_low = _pick_float(
        raw,
        (
            "targetLow",
            "target_low",
            "lowTarget",
            "priceTargetLow",
        ),
    )
    analyst_count = _pick_int(
        raw,
        (
            "numberAnalysts",
            "analystCount",
            "numAnalysts",
            "totalAnalysts",
        ),
    )
    source_asof = _first_non_empty(
        [
            raw.get("updatedDate"),
            raw.get("lastUpdated"),
            raw.get("date"),
            raw.get("publishedDate"),
            raw.get("asOf"),
        ]
    )
    if source_asof is not None:
        source_asof = str(source_asof)
    return {
        "target_mean": target_mean,
        "target_high": target_high,
        "target_low": target_low,
        "analyst_count": analyst_count,
        "source_asof": source_asof,
        "raw": raw,
    }


def _resolve_api_key(api_key: Optional[str] = None) -> str:
    if api_key:
        return api_key.strip().strip("'\"")
    for env_name in API_KEY_ENV_VARS:
        value = os.getenv(env_name, "").strip().strip("'\"")
        if value:
            return value
    return ""


def _base_url() -> str:
    value = os.getenv("FMP_BASE_URL", DEFAULT_BASE_URL).strip()
    value = value.rstrip("/")
    if "/api/v3" in value:
        value = value.replace("/api/v3", "/stable")
    if not value.endswith("/stable"):
        value = f"{value}/stable"
    return value


def _fetch_json(url: str, params: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    response = requests.get(url, params=params, timeout=timeout)
    status_code = response.status_code
    try:
        payload = response.json()
    except Exception:
        payload = None
    return {"status": status_code, "payload": payload, "ok": response.ok, "url": response.url}


def fetch_fmp_consensus_snapshot(
    ticker: str,
    *,
    api_key: Optional[str] = None,
    timeout: float = 12.0,
    base_url: Optional[str] = None,
) -> Dict[str, Any]:
    symbol = _normalize_ticker(ticker)
    key = _resolve_api_key(api_key)
    if not key:
        raise ValueError("FMP API key is required. Set FMP_API_KEY or NEXT_PUBLIC_FMP_API_KEY.")

    resolved_base = (base_url or _base_url()).rstrip("/")
    endpoints = {
        "analyst_estimates": (f"{resolved_base}/analyst-estimates", {"symbol": symbol, "period": "annual"}),
        "price_target": (f"{resolved_base}/price-target-consensus", {"symbol": symbol}),
    }

    results: Dict[str, Dict[str, Any]] = {}
    errors: List[str] = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures: Dict[str, Future] = {
            name: pool.submit(_fetch_json, url, {**params, "apikey": key}, timeout) for name, (url, params) in endpoints.items()
        }
        for name, future in futures.items():
            try:
                results[name] = future.result(timeout=timeout + 2.0)
            except FutureTimeoutError:
                results[name] = {"status": 504, "payload": None, "ok": False, "url": endpoints[name][0]}
                errors.append(f"{name}: request timed out")
            except Exception as exc:
                results[name] = {"status": None, "payload": None, "ok": False, "url": endpoints[name][0]}
                errors.append(f"{name}: {exc}")

    estimate_payload = results.get("analyst_estimates", {}).get("payload")
    target_payload = results.get("price_target", {}).get("payload")

    normalized_estimates = _normalize_estimates(estimate_payload)
    normalized_target = _normalize_price_target(target_payload)

    source_asof = _first_non_empty(
        [
            normalized_target.get("source_asof"),
            normalized_estimates.get("source_asof"),
            _first_non_empty([row.get("date") for row in normalized_estimates.get("rows", []) if isinstance(row, dict)]),
        ]
    )
    if source_asof is not None:
        source_asof = str(source_asof)

    snapshot: Dict[str, Any] = {
        "ticker": symbol,
        "source": "fmp",
        "captured_at": _now_iso(),
        "source_asof": source_asof,
        "eps_estimate_fy1": normalized_estimates.get("eps_estimate_fy1"),
        "eps_estimate_fy2": normalized_estimates.get("eps_estimate_fy2"),
        "eps_ladder": normalized_estimates.get("eps_ladder") or [],
        "target_mean": normalized_target.get("target_mean"),
        "target_high": normalized_target.get("target_high"),
        "target_low": normalized_target.get("target_low"),
        "analyst_count": normalized_estimates.get("analyst_count"),
        "target_analyst_count": normalized_target.get("analyst_count"),
        "analyst_estimates_raw": normalized_estimates.get("raw", []),
        "price_target_raw": normalized_target.get("raw", {}),
        "endpoints": results,
        "errors": errors,
        "warnings": [],
    }

    if snapshot["eps_estimate_fy1"] is None and snapshot["eps_estimate_fy2"] is None:
        snapshot["warnings"].append("No analyst EPS estimates were returned.")
    if not snapshot.get("eps_ladder"):
        snapshot["warnings"].append("Annual EPS ladder was not returned.")
    if snapshot["target_mean"] is None and snapshot["target_high"] is None and snapshot["target_low"] is None:
        snapshot["warnings"].append("No price target consensus values were returned.")
    if snapshot["analyst_count"] is None and snapshot["target_analyst_count"] is None:
        snapshot["warnings"].append("Analyst coverage count was not returned.")

    snapshot["payload_json"] = _json_dumps(snapshot)
    return snapshot


def save_fmp_consensus_snapshot(snapshot: Dict[str, Any], *, db_path: Optional[str] = None) -> Dict[str, Any]:
    symbol = _normalize_ticker(snapshot.get("ticker"))
    conn = _db_connect(db_path)
    try:
        ensure_schema(conn)
        now = _now_iso()
        conn.execute(
            """
            INSERT INTO fmp_consensus_snapshot (
                ticker,
                source,
                captured_at,
                source_asof,
                eps_estimate_fy1,
                eps_estimate_fy2,
                eps_ladder_json,
                target_mean,
                target_high,
                target_low,
                analyst_count,
                target_analyst_count,
                raw_estimates_json,
                raw_price_target_json,
                payload_json,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ticker) DO UPDATE SET
                source=excluded.source,
                captured_at=excluded.captured_at,
                source_asof=excluded.source_asof,
                eps_estimate_fy1=excluded.eps_estimate_fy1,
                eps_estimate_fy2=excluded.eps_estimate_fy2,
                eps_ladder_json=excluded.eps_ladder_json,
                target_mean=excluded.target_mean,
                target_high=excluded.target_high,
                target_low=excluded.target_low,
                analyst_count=excluded.analyst_count,
                target_analyst_count=excluded.target_analyst_count,
                raw_estimates_json=excluded.raw_estimates_json,
                raw_price_target_json=excluded.raw_price_target_json,
                payload_json=excluded.payload_json,
                updated_at=excluded.updated_at
            """,
            (
                symbol,
                str(snapshot.get("source") or "fmp"),
                str(snapshot.get("captured_at") or now),
                snapshot.get("source_asof"),
                snapshot.get("eps_estimate_fy1"),
                snapshot.get("eps_estimate_fy2"),
                _json_dumps(snapshot.get("eps_ladder") or []),
                snapshot.get("target_mean"),
                snapshot.get("target_high"),
                snapshot.get("target_low"),
                snapshot.get("analyst_count"),
                snapshot.get("target_analyst_count"),
                _json_dumps(snapshot.get("analyst_estimates_raw") or []),
                _json_dumps(snapshot.get("price_target_raw") or {}),
                snapshot.get("payload_json") or _json_dumps(snapshot),
                now,
                now,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return snapshot


def fetch_and_store_fmp_consensus(
    ticker: str,
    *,
    api_key: Optional[str] = None,
    timeout: float = 12.0,
    base_url: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    snapshot = fetch_fmp_consensus_snapshot(
        ticker,
        api_key=api_key,
        timeout=timeout,
        base_url=base_url,
    )
    if not _snapshot_has_usable_data(snapshot):
        errors = snapshot.get("errors") or []
        warnings = snapshot.get("warnings") or []
        details = "; ".join(str(item) for item in (errors or warnings) if item)
        raise RuntimeError(details or f"No usable consensus data returned for {ticker}")
    return save_fmp_consensus_snapshot(snapshot, db_path=db_path)


def _snapshot_has_usable_data(snapshot: Dict[str, Any]) -> bool:
    return any(
        snapshot.get(key) is not None
        for key in (
            "eps_estimate_fy1",
            "eps_estimate_fy2",
            "target_mean",
            "target_high",
            "target_low",
            "analyst_count",
            "target_analyst_count",
        )
    ) or bool(snapshot.get("eps_ladder"))


def _row_to_snapshot(row: sqlite3.Row) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    try:
        payload = json.loads(row["payload_json"]) if row["payload_json"] else {}
    except Exception:
        payload = {}
    raw_estimates: Any = []
    raw_price_target: Any = {}
    try:
        raw_estimates = json.loads(row["raw_estimates_json"]) if row["raw_estimates_json"] else []
    except Exception:
        raw_estimates = []
    try:
        raw_price_target = json.loads(row["raw_price_target_json"]) if row["raw_price_target_json"] else {}
    except Exception:
        raw_price_target = {}
    eps_ladder: Any = []
    if "eps_ladder_json" in row.keys():
        try:
            eps_ladder = json.loads(row["eps_ladder_json"]) if row["eps_ladder_json"] else []
        except Exception:
            eps_ladder = []
    if not eps_ladder:
        payload_ladder = payload.get("eps_ladder") if isinstance(payload, dict) else None
        if isinstance(payload_ladder, list):
            eps_ladder = payload_ladder
    if not eps_ladder and raw_estimates:
        eps_ladder = _normalize_eps_ladder(_parse_estimate_rows(raw_estimates))
    payload.update(
        {
            "ticker": row["ticker"],
            "source": row["source"],
            "captured_at": row["captured_at"],
            "source_asof": row["source_asof"],
            "eps_estimate_fy1": row["eps_estimate_fy1"],
            "eps_estimate_fy2": row["eps_estimate_fy2"],
            "eps_ladder": eps_ladder,
            "target_mean": row["target_mean"],
            "target_high": row["target_high"],
            "target_low": row["target_low"],
            "analyst_count": row["analyst_count"],
            "target_analyst_count": row["target_analyst_count"],
            "raw_estimates_json": row["raw_estimates_json"],
            "raw_price_target_json": row["raw_price_target_json"],
            "analyst_estimates_raw": raw_estimates,
            "price_target_raw": raw_price_target,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
    )
    return payload


def get_latest_fmp_consensus(
    ticker: Optional[str] = None,
    *,
    db_path: Optional[str] = None,
) -> Any:
    conn = _db_connect(db_path)
    try:
        ensure_schema(conn)
        if ticker:
            symbol = _normalize_ticker(ticker)
            row = conn.execute(
                """
                SELECT *
                FROM fmp_consensus_snapshot
                WHERE ticker = ?
                LIMIT 1
                """,
                (symbol,),
            ).fetchone()
            if not row:
                return None
            return _row_to_snapshot(row)

        rows = conn.execute(
            """
            SELECT *
            FROM fmp_consensus_snapshot
            ORDER BY ticker ASC
            """
        ).fetchall()
        return [_row_to_snapshot(row) for row in rows]
    finally:
        conn.close()


def fetch_and_store_many(
    tickers: Iterable[str],
    *,
    api_key: Optional[str] = None,
    timeout: float = 12.0,
    base_url: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    snapshots: List[Dict[str, Any]] = []
    for ticker in tickers:
        snapshots.append(
            fetch_and_store_fmp_consensus(
                ticker,
                api_key=api_key,
                timeout=timeout,
                base_url=base_url,
                db_path=db_path,
            )
        )
    return snapshots
