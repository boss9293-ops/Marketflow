from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
MARKETFLOW_DIR = BACKEND_DIR.parent

for path in (MARKETFLOW_DIR, BACKEND_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))


from backend.scripts.build_fusion_layer import (  # noqa: E402
    build_fusion_payload,
    build_theme_tags,
    load_latest_news_payload,
    load_latest_structured_briefing,
    normalize_selected_themes,
    save_fusion_payload,
)


OUTPUT_DIR = BACKEND_DIR / "output" / "fusion"
REPORT_PATH = OUTPUT_DIR / "test_fusion_from_sources.json"


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def build_report() -> Dict[str, Any]:
    market_info = load_latest_structured_briefing()
    news_info = load_latest_news_payload()

    if not market_info["loaded"] or market_info["payload"] is None:
        return {
            "input": {
                "structured_briefing_loaded": False,
                "news_payload_loaded": bool(news_info["loaded"]),
                "selected_themes": [],
                "theme_valid_count": 0,
                "confidence_score": 0.0,
                "market_regime": None,
                "cross_asset_signal": None,
                "short_term_status": None,
            },
            "output": {},
            "file": {
                "script": str(Path(__file__).resolve()),
                "saved": [str(REPORT_PATH)],
            },
            "assessment": "FAIL",
        }

    news_data = news_info["payload"]
    selected_themes = normalize_selected_themes(news_data)
    theme_tags = build_theme_tags(selected_themes)
    payload = build_fusion_payload(
        news_data,
        market_info["payload"],
        market_loaded=market_info["loaded"],
        news_loaded=news_info["loaded"],
        market_source_meta=market_info["source_meta"],
        news_source_meta=news_info["source_meta"],
    )

    fusion_state = payload.get("fusion_state") if isinstance(payload.get("fusion_state"), dict) else {}
    news_overlay = payload.get("news_overlay") if isinstance(payload.get("news_overlay"), dict) else {}
    source_meta = payload.get("source_meta") if isinstance(payload.get("source_meta"), dict) else {}

    fusion_summary = payload.get("fusion_summary")
    fusion_drivers = payload.get("fusion_drivers") if isinstance(payload.get("fusion_drivers"), list) else []
    fusion_interpretation = payload.get("fusion_interpretation")
    fusion_confidence = payload.get("fusion_confidence")
    mode = source_meta.get("mode")
    source_meta_ok = bool(source_meta.get("structured_briefing_loaded")) and bool(source_meta.get("news_payload_loaded")) and bool(mode)

    saved_paths = [str(save_fusion_payload(payload)), str(REPORT_PATH)]
    write_json(REPORT_PATH, {
        "timestamp": payload.get("date"),
        "input": {
            "structured_briefing_loaded": bool(market_info["loaded"]),
            "news_payload_loaded": bool(news_info["loaded"]),
            "selected_themes": selected_themes,
            "theme_valid_count": news_overlay.get("theme_valid_count", 0),
            "confidence_score": news_overlay.get("confidence_score", 0.0),
            "market_regime": fusion_state.get("market_regime"),
            "cross_asset_signal": fusion_state.get("cross_asset_signal"),
            "short_term_status": fusion_state.get("short_term_status"),
        },
        "output": {
            "fusion_summary": fusion_summary,
            "fusion_drivers": fusion_drivers,
            "fusion_interpretation": fusion_interpretation,
            "fusion_confidence": fusion_confidence,
            "theme_tags": theme_tags,
            "mode": mode,
            "source_meta": source_meta,
        },
        "file": {
            "script": str(Path(__file__).resolve()),
            "saved": saved_paths,
        },
        "assessment": "PASS" if source_meta_ok and news_info["loaded"] and news_overlay.get("confidence_score", 0.0) > 0 else "PARTIAL",
    },)

    return {
        "timestamp": payload.get("date"),
        "input": {
            "structured_briefing_loaded": bool(market_info["loaded"]),
            "news_payload_loaded": bool(news_info["loaded"]),
            "selected_themes": selected_themes,
            "theme_valid_count": news_overlay.get("theme_valid_count", 0),
            "confidence_score": news_overlay.get("confidence_score", 0.0),
            "market_regime": fusion_state.get("market_regime"),
            "cross_asset_signal": fusion_state.get("cross_asset_signal"),
            "short_term_status": fusion_state.get("short_term_status"),
        },
        "output": {
            "fusion_summary": fusion_summary,
            "fusion_drivers": fusion_drivers,
            "fusion_interpretation": fusion_interpretation,
            "fusion_confidence": fusion_confidence,
            "theme_tags": theme_tags,
            "mode": mode,
            "source_meta": source_meta,
        },
        "file": {
            "script": str(Path(__file__).resolve()),
            "saved": saved_paths,
        },
        "assessment": "PASS" if source_meta_ok and news_info["loaded"] and news_overlay.get("confidence_score", 0.0) > 0 else "PARTIAL",
    }


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    report = build_report()
    write_json(REPORT_PATH, report)

    print("1. Input")
    print(f"- structured briefing loaded: {report['input']['structured_briefing_loaded']}")
    print(f"- news payload loaded: {report['input']['news_payload_loaded']}")
    print(f"- selected themes: {report['input']['selected_themes']}")
    print(f"- theme_valid_count: {report['input']['theme_valid_count']}")
    print(f"- confidence_score: {report['input']['confidence_score']}")
    print(f"- market_regime: {report['input']['market_regime']}")
    print(f"- cross_asset_signal: {report['input']['cross_asset_signal']}")
    print(f"- short_term_status: {report['input']['short_term_status']}")
    print()
    print("2. Output")
    print(f"- fusion_summary: {report['output']['fusion_summary']}")
    print(f"- fusion_drivers: {report['output']['fusion_drivers']}")
    print(f"- fusion_interpretation: {report['output']['fusion_interpretation']}")
    print(f"- fusion_confidence: {report['output']['fusion_confidence']}")
    print(f"- theme_tags: {report['output']['theme_tags']}")
    print(f"- mode: {report['output']['mode']}")
    print(f"- source_meta: {report['output']['source_meta']}")
    print()
    print("3. File")
    print(f"- Script: {report['file']['script']}")
    print("- Saved:")
    for saved in report["file"]["saved"]:
        print(f"  - {saved}")
    print()
    print("4. Assessment")
    print(f"- {report['assessment']}")
    return 0 if report["assessment"] != "FAIL" else 2


if __name__ == "__main__":
    raise SystemExit(main())
