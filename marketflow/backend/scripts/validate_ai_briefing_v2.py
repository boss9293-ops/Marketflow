"""
Daily Briefing v2 real-data validation runner.

Runs the Tavily + Claude briefing pipeline across multiple dates and saves
intermediate artifacts by date for side-by-side quality review.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_ai_briefing_v2 import (  # noqa: E402
    DEFAULT_VALIDATION_DIR,
    load_env,
    run_pipeline,
    tavily_search,
)


DEFAULT_CASES = [
    {"date": "2026-03-24", "market_type": "up_day"},
    {"date": "2026-03-27", "market_type": "down_day"},
    {"date": "2026-03-30", "market_type": "mixed_rotation_day"},
]


def _log(msg: str) -> None:
    print(f"[validate_ai_briefing_v2] {msg}", flush=True)


def parse_cases(raw: str | None) -> list[dict[str, str]]:
    if not raw:
        return list(DEFAULT_CASES)

    cases: list[dict[str, str]] = []
    chunks = [chunk.strip() for chunk in raw.split(",") if chunk.strip()]
    for chunk in chunks:
        if ":" in chunk:
            date_text, market_type = chunk.split(":", 1)
            cases.append({"date": date_text.strip(), "market_type": market_type.strip() or "unspecified"})
        else:
            cases.append({"date": chunk, "market_type": "unspecified"})
    return cases


def run_health_check(tavily_key: str) -> dict[str, Any]:
    t0 = time.time()
    results = tavily_search(
        api_key=tavily_key,
        query="S&P 500 today news",
        topic="news",
        max_results=1,
    )
    elapsed_ms = int((time.time() - t0) * 1000)
    return {
        "ok": bool(results),
        "elapsed_ms": elapsed_ms,
        "result_count": len(results),
        "sample_title": str((results[0] or {}).get("title") or "") if results else "",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Daily Briefing v2 multi-date validation runner")
    parser.add_argument(
        "--cases",
        default="",
        help="Comma separated `YYYY-MM-DD:label` list. Example: 2026-03-24:up_day,2026-03-27:down_day",
    )
    parser.add_argument(
        "--out-dir",
        default=str(DEFAULT_VALIDATION_DIR),
        help="Validation output base directory",
    )
    parser.add_argument(
        "--allow-cache-reuse",
        action="store_true",
        help="Allow reusing previous ai_briefing_v2.json when ingestion fails",
    )
    args = parser.parse_args(argv)

    env = load_env()
    tavily_key = env.get("TAVILY_API_KEY", "").strip()
    if not tavily_key:
        _log("ERROR: TAVILY_API_KEY is missing")
        return 2

    health = run_health_check(tavily_key)
    _log(f"health_check ok={health['ok']} elapsed_ms={health['elapsed_ms']} results={health['result_count']}")
    if not health["ok"]:
        _log("Tavily health check failed. Abort WO-SA-08 validation run.")
        return 3

    output_base = Path(args.out_dir)
    output_base.mkdir(parents=True, exist_ok=True)
    cases = parse_cases(args.cases)
    if len(cases) < 3:
        _log("ERROR: Provide at least 3 cases for WO-SA-08 validation.")
        return 4

    run_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    summary_rows: list[dict[str, Any]] = []
    _log(f"running {len(cases)} cases")

    for idx, case in enumerate(cases, start=1):
        asof_date = case["date"]
        market_type = case.get("market_type", "unspecified")
        _log(f"[{idx}/{len(cases)}] asof={asof_date} market_type={market_type}")
        t0 = time.time()
        payload = run_pipeline(
            asof_date=asof_date,
            write_main_cache=False,
            validation_output_dir=output_base,
            allow_previous_cache_reuse=bool(args.allow_cache_reuse),
        )
        elapsed_sec = round(time.time() - t0, 2)

        daily = payload.get("daily_briefing") if isinstance(payload.get("daily_briefing"), dict) else {}
        quality = payload.get("quality_gate") if isinstance(payload.get("quality_gate"), dict) else {}
        meta = payload.get("_meta") if isinstance(payload.get("_meta"), dict) else {}
        row = {
            "asof_date": asof_date,
            "market_type": market_type,
            "elapsed_sec": elapsed_sec,
            "provider_requested": meta.get("provider_requested"),
            "provider_used": meta.get("provider_used"),
            "model_used": meta.get("model_used"),
            "retry_count": meta.get("retry_count"),
            "fallback_used": meta.get("fallback_used"),
            "provider": payload.get("provider"),
            "model": payload.get("model"),
            "prompt_version_daily": meta.get("prompt_version_daily"),
            "prompt_version_context": meta.get("prompt_version_context"),
            "themes_count": len(daily.get("top_themes_today") or []),
            "highlights_count": len(daily.get("supporting_highlights") or []),
            "narrative_sentence_count": quality.get("daily_narrative_sentence_count"),
            "today_context_sentence_count": quality.get("today_context_sentence_count"),
            "fallback_reason": meta.get("fallback_reason"),
            "validation_artifacts_dir": meta.get("validation_artifacts_dir"),
        }
        summary_rows.append(row)
        _log(
            f"done asof={asof_date} provider={row['provider_used'] or row['provider']} themes={row['themes_count']} "
            f"context_sentences={row['today_context_sentence_count']}"
        )

    summary_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "run_stamp": run_stamp,
        "health_check": health,
        "cases": cases,
        "results": summary_rows,
        "review_questions": [
            "Are themes dynamic and relevant?",
            "Is Daily Briefing portal-like and readable?",
            "Is Today Context sharp and non-mechanical?",
            "Is role separation preserved?",
        ],
    }

    summary_json_path = output_base / f"validation_summary_{run_stamp}.json"
    with open(summary_json_path, "w", encoding="utf-8") as handle:
        json.dump(summary_payload, handle, ensure_ascii=False, indent=2)

    summary_md_path = output_base / f"validation_summary_{run_stamp}.md"
    md_lines = [
        "# Daily Briefing v2 Validation Summary",
        "",
        f"- generated_at: {summary_payload['generated_at']}",
        f"- health_check_ok: {health['ok']}",
        f"- health_elapsed_ms: {health['elapsed_ms']}",
        "",
        "## Results",
        "",
        "| date | market_type | provider_requested | provider_used | model_used | retry_count | fallback_used | fallback_reason | prompt_daily | prompt_context | themes | narrative_sentences | today_context_sentences | artifacts_dir |",
        "|---|---|---|---|---|---:|---|---|---|---|---:|---:|---:|---|",
    ]
    for row in summary_rows:
        md_lines.append(
            f"| {row['asof_date']} | {row['market_type']} | {row['provider_requested']} | {row['provider_used'] or row['provider']} | "
            f"{row['model_used'] or row['model']} | {row['retry_count']} | {row['fallback_used']} | {row['fallback_reason']} | "
            f"{row['prompt_version_daily']} | {row['prompt_version_context']} | {row['themes_count']} | "
            f"{row['narrative_sentence_count']} | {row['today_context_sentence_count']} | {row['validation_artifacts_dir']} |"
        )
    with open(summary_md_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(md_lines) + "\n")

    _log(f"summary_json={summary_json_path}")
    _log(f"summary_md={summary_md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
