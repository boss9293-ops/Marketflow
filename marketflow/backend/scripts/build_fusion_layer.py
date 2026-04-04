import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]

STRUCTURED_DIR = BACKEND_DIR / "output" / "structured_briefing"
NEWS_VALIDATION_DIR = BACKEND_DIR / "output" / "validation"
NEWS_CACHE_DIR = BACKEND_DIR / "output" / "cache"
NEWS_AI_DIR = BACKEND_DIR / "output" / "ai"
OUTPUT_DIR = BACKEND_DIR / "output" / "fusion"


def configure_console_encoding():
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8")


def display_path(path):
    try:
        return path.relative_to(PROJECT_ROOT)
    except ValueError:
        return path


def load_json_file(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def to_float(value, default=0.0):
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def to_int(value, default=0):
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def to_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y"}:
            return True
        if normalized in {"false", "0", "no", "n"}:
            return False
    return bool(value)


def append_unique(items, value):
    if value and value not in items:
        items.append(value)


def contains_any(text, keywords):
    lower = text.lower()
    return any(keyword in lower for keyword in keywords)


def search_first(data, keys):
    if isinstance(data, dict):
        for key in keys:
            if key in data and data[key] is not None:
                return data[key]
        for value in data.values():
            found = search_first(value, keys)
            if found is not None:
                return found
    elif isinstance(data, list):
        for item in data:
            found = search_first(item, keys)
            if found is not None:
                return found
    return None


def normalize_theme_item(item):
    if isinstance(item, str):
        text = item.strip()
        return text if text else None
    if isinstance(item, dict):
        preferred_keys = (
            "text",
            "theme_text",
            "title",
            "name",
            "label",
            "topic",
            "summary",
            "description",
            "id",
        )
        for key in preferred_keys:
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        nested_theme = item.get("theme")
        if isinstance(nested_theme, str) and nested_theme.strip():
            return nested_theme.strip()
        if isinstance(nested_theme, dict):
            nested_text = normalize_theme_item(nested_theme)
            if nested_text:
                return nested_text

        for value in item.values():
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def extract_theme_texts(news_data):
    for key in ("selected_themes", "top_themes_today", "top_themes", "supporting_highlights", "events"):
        container = search_first(news_data, (key,))
        if container is None:
            continue

        if isinstance(container, str):
            text = container.strip()
            return [text] if text else []

        if isinstance(container, list):
            texts = []
            for item in container:
                text = normalize_theme_item(item)
                if text:
                    append_unique(texts, text)
            if texts:
                return texts

        if isinstance(container, dict):
            text = normalize_theme_item(container)
            if text:
                return [text]

    return []


def map_theme_to_tags(theme_text):
    lower = theme_text.lower()
    tags = []

    def add(values):
        for value in values:
            append_unique(tags, value)

    if contains_any(lower, ("oil", "crude", "energy", "유가", "원유", "에너지")):
        add(["oil", "energy", "inflation_pressure"])

    if contains_any(lower, ("rate", "yield", "treasury", "fed", "bond", "bonds", "rates", "금리", "국채", "채권", "수익률", "연준")):
        add(["rates", "valuation_pressure", "macro_pressure"])

    if contains_any(lower, ("tech", "semis", "semi", "ai", "chip", "nvda", "테크", "반도체", "칩", "엔비디아", "AI")):
        add(["tech", "growth"])
        negative_hints = (
            "pressure",
            "hit",
            "hits",
            "headwind",
            "drag",
            "under pressure",
            "weak",
            "slump",
            "sell",
            "down",
            "hurt",
            "risk",
            "concern",
        )
        positive_hints = (
            "strength",
            "lift",
            "lifts",
            "tailwind",
            "surge",
            "rally",
            "support",
            "rebound",
            "momentum",
            "up",
            "beat",
            "beats",
        )
        if contains_any(lower, negative_hints):
            add(["tech_headwind"])
        else:
            add(["tech_tailwind"])
        if contains_any(lower, positive_hints) and "tech_tailwind" not in tags and "tech_headwind" not in tags:
            add(["tech_tailwind"])

    if contains_any(lower, ("tariff", "sanction", "sanctions", "white house", "policy", "관세", "제재", "백악관", "정책", "중동", "전쟁", "지정학")):
        add(["policy_risk"])

    if contains_any(lower, ("cta", "options", "gamma", "rebalance", "positioning", "옵션", "감마", "리밸런싱", "포지셔닝", "포지션")):
        add(["flow"])

    return tags


def build_news_theme_records(news_data):
    theme_texts = normalize_selected_themes(news_data)
    if not theme_texts:
        theme_texts = extract_theme_texts(news_data)
    records = []
    all_tags = []

    for theme_text in theme_texts:
        tags = map_theme_to_tags(theme_text)
        records.append({"text": theme_text, "tags": tags})
        for tag in tags:
            append_unique(all_tags, tag)

    return records, all_tags


def extract_news_metrics(news_data):
    theme_valid_count = to_int(search_first(news_data, ("theme_valid_count",)), default=0)
    confidence_score = to_float(search_first(news_data, ("confidence_score",)), default=0.0)
    data_confident = search_first(news_data, ("data_confident",))

    if theme_valid_count == 0:
        theme_texts = extract_theme_texts(news_data)
        theme_valid_count = len(theme_texts)

    if data_confident is None:
        data_confident = confidence_score >= 0.6

    return theme_valid_count, round(confidence_score, 2), to_bool(data_confident)


def normalize_selected_themes(news_data):
    themes = search_first(news_data, ("selected_themes",))
    if themes is None:
        themes = search_first(news_data, ("top_themes_today", "top_themes", "supporting_highlights", "events"))

    if themes is None:
        return []

    if isinstance(themes, str):
        text = themes.strip()
        return [text] if text else []

    if isinstance(themes, list):
        normalized = []
        for item in themes:
            text = normalize_theme_item(item)
            if text:
                append_unique(normalized, text)
        return normalized

    if isinstance(themes, dict):
        text = normalize_theme_item(themes)
        return [text] if text else []

    text = normalize_theme_item(themes)
    return [text] if text else []


def build_theme_tags(theme_texts):
    tags = []
    for theme_text in theme_texts:
        for tag in map_theme_to_tags(theme_text):
            append_unique(tags, tag)
    return tags


def _parse_iso_utc(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _candidate_market_paths():
    candidates = []
    env_path = os.environ.get("MARKET_INPUT_PATH")
    if env_path:
        candidates.append(Path(env_path).expanduser())

    if STRUCTURED_DIR.exists():
        candidates.append(STRUCTURED_DIR / "structured_briefing_latest.json")
        candidates.extend(sorted(STRUCTURED_DIR.glob("structured_briefing_*.json"), key=lambda path: path.stat().st_mtime, reverse=True))

    candidates.extend([
        BACKEND_DIR / "output" / "briefing.json",
        NEWS_CACHE_DIR / "daily_briefing.json",
    ])

    seen = set()
    deduped = []
    for path in candidates:
        try:
            resolved = path.resolve()
        except Exception:
            resolved = path
        key = str(resolved).casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(path)
    return deduped


def load_latest_structured_briefing():
    for path in _candidate_market_paths():
        if not path.exists():
            continue
        try:
            payload = load_json_file(path)
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        if not any(key in payload for key in ("market_regime", "briefing_sections", "historical_context", "one_line_takeaway", "summary_statement")):
            continue
        source_meta = payload.get("data_source_meta") if isinstance(payload.get("data_source_meta"), dict) else {}
        return {
            "loaded": True,
            "path": path,
            "payload": payload,
            "source_meta": {**source_meta, "path": str(path)},
        }

    return {
        "loaded": False,
        "path": None,
        "payload": None,
        "source_meta": {},
    }


def _candidate_news_paths():
    env_path = os.environ.get("NEWS_INPUT_PATH")
    if env_path:
        return [Path(env_path).expanduser()]
    return [path for path in [find_latest_news_input_path()] if path is not None]


def _extract_news_source_meta(news_data, path, loaded):
    meta = news_data.get("_meta") if isinstance(news_data, dict) and isinstance(news_data.get("_meta"), dict) else {}
    quality_gate = news_data.get("quality_gate") if isinstance(news_data, dict) and isinstance(news_data.get("quality_gate"), dict) else {}
    quality_flags = search_first(news_data, ("quality_flags",))
    if not isinstance(quality_flags, dict):
        quality_flags = {}

    return {
        "loaded": loaded,
        "path": str(path) if path else None,
        "provider": news_data.get("provider") if isinstance(news_data, dict) else None,
        "model": news_data.get("model") if isinstance(news_data, dict) else None,
        "generated_at": news_data.get("generated_at") if isinstance(news_data, dict) else None,
        "data_date": news_data.get("data_date") if isinstance(news_data, dict) else None,
        "theme_valid_count": to_int(search_first(news_data, ("theme_valid_count",)), default=0),
        "confidence_score": to_float(search_first(news_data, ("confidence_score",)), default=0.0),
        "data_confident": to_bool(search_first(news_data, ("data_confident",)), default=False),
        "quality_gate": quality_gate,
        "quality_flags": quality_flags,
        "_meta": meta,
    }


def load_latest_news_payload():
    candidates = _candidate_news_paths()
    for path in candidates:
        if path is None or not Path(path).exists():
            continue
        try:
            payload = load_json_file(Path(path))
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        return {
            "loaded": True,
            "path": Path(path),
            "payload": payload,
            "source_meta": _extract_news_source_meta(payload, Path(path), True),
        }

    payload = {
        "selected_themes": [],
        "theme_valid_count": 0,
        "confidence_score": 0.0,
        "quality_flags": {
            "data_confident": False,
        },
    }
    return {
        "loaded": False,
        "path": None,
        "payload": payload,
        "source_meta": _extract_news_source_meta(payload, None, False),
    }


def find_latest_market_input_path():
    for path in _candidate_market_paths():
        if not path.exists():
            continue
        try:
            payload = load_json_file(path)
        except Exception:
            continue
        if isinstance(payload, dict) and any(
            key in payload for key in ("market_regime", "briefing_sections", "historical_context", "one_line_takeaway", "summary_statement")
        ):
            return path
    return None


def looks_like_news_payload(data):
    if not isinstance(data, dict):
        return False

    if extract_theme_texts(data):
        return True

    return any(
        search_first(data, (key,)) is not None
        for key in ("theme_valid_count", "confidence_score", "data_confident", "quality_gate", "quality_flags")
    )


def find_latest_news_input_path():
    env_path = os.environ.get("NEWS_INPUT_PATH")
    if env_path:
        return Path(env_path).expanduser()

    candidate_paths = []
    for root, pattern in (
        (NEWS_VALIDATION_DIR, "99_final_payload.json"),
        (NEWS_VALIDATION_DIR, "05_daily_briefing.json"),
        (NEWS_VALIDATION_DIR, "07_quality_gate.json"),
    ):
        if root.exists():
            candidate_paths.extend(root.rglob(pattern))

    for path in (
        NEWS_CACHE_DIR / "daily_briefing.json",
        NEWS_CACHE_DIR / "ai_briefing_v2.json",
        NEWS_CACHE_DIR / "context_news.json",
        NEWS_AI_DIR / "integrated" / "latest.json",
        BACKEND_DIR / "output" / "briefing.json",
    ):
        if path.exists():
            candidate_paths.append(path)

    candidate_paths = sorted(
        {path for path in candidate_paths if path.exists()},
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )

    for path in candidate_paths:
        try:
            if looks_like_news_payload(load_json_file(path)):
                return path
        except Exception:
            continue

    return candidate_paths[0] if candidate_paths else None


def get_market_context(market_data):
    historical = market_data.get("historical_context") if isinstance(market_data.get("historical_context"), dict) else {}

    return {
        "market_regime": market_data.get("market_regime") or "unknown",
        "cross_asset_signal": market_data.get("cross_asset_signal") or "mixed",
        "risk_quality": market_data.get("risk_quality") or "neutral",
        "short_term_status": historical.get("short_term_status") or "unknown",
        "historical_view": historical.get("historical_view")
        or "최근 누적 흐름 데이터가 충분하지 않아 단기 추세 맥락은 제한적으로만 판단할 수 있다.",
        "interpretation": market_data.get("interpretation") or "",
        "risk_note": market_data.get("risk_note") or "",
        "one_line_takeaway": market_data.get("one_line_takeaway") or "",
        "key_drivers": market_data.get("key_drivers") if isinstance(market_data.get("key_drivers"), list) else [],
        "summary": (
            market_data.get("briefing_sections", {}).get("summary")
            if isinstance(market_data.get("briefing_sections"), dict)
            else ""
        )
        or market_data.get("summary_statement")
        or "",
        "cross_asset_view": (
            market_data.get("briefing_sections", {}).get("cross_asset_view")
            if isinstance(market_data.get("briefing_sections"), dict)
            else ""
        )
        or "",
    }


def determine_fusion_bias(market, theme_tags):
    tag_set = set(theme_tags)
    has_macro_pressure = any(tag in tag_set for tag in ("rates", "inflation_pressure", "macro_pressure"))
    has_policy_risk = "policy_risk" in tag_set
    has_tech_headwind = "tech_headwind" in tag_set

    if market["cross_asset_signal"] == "risk_on_but_fragile" and has_macro_pressure:
        return "fragile_risk_on_confirmed"

    if market["market_regime"] == "risk_on" and market["short_term_status"] == "accelerating_up" and not (
        has_macro_pressure or has_policy_risk
    ):
        return "clean_risk_on_confirmation"

    if market["market_regime"] == "risk_off" and (has_macro_pressure or has_policy_risk):
        return "risk_off_confirmed"

    if market["market_regime"] == "risk_on" and has_tech_headwind and "rates" in tag_set:
        return "risk_on_with_macro_headwind"

    return "mixed"


def determine_market_only_bias(market):
    market_regime = market.get("market_regime", "unknown")
    cross_asset_signal = market.get("cross_asset_signal", "mixed")
    short_term_status = market.get("short_term_status", "unknown")
    risk_quality = market.get("risk_quality", "neutral")

    if market_regime == "risk_off":
        return "risk_off_confirmed"

    if market_regime == "risk_on" and cross_asset_signal == "risk_on_but_fragile":
        return "fragile_risk_on_confirmed"

    if market_regime == "risk_on" and short_term_status in {"accelerating_up", "rebound_up"}:
        if cross_asset_signal == "clean_risk_on" or risk_quality == "clean":
            return "clean_risk_on_confirmation"
        if cross_asset_signal == "risk_on_with_macro_headwind" or risk_quality == "fragile":
            return "risk_on_with_macro_headwind"

    return "mixed"


def build_theme_driver(theme_text, theme_tags, market):
    lower = theme_text.lower()

    if contains_any(lower, ("oil", "crude", "energy")):
        return f"{theme_text} 테마는 원자재 및 인플레이션 압력이 여전히 존재함을 시사한다."

    if contains_any(lower, ("rate", "yield", "treasury", "fed", "bond", "bonds", "rates")):
        if "tech_headwind" in theme_tags:
            return f"{theme_text} 테마는 금리 상승이 성장주 밸류에이션 부담으로 작용하고 있음을 보여준다."
        return f"{theme_text} 테마는 할인율 부담이 높아지고 있음을 시사한다."

    if contains_any(lower, ("tech", "semis", "semi", "ai", "chip", "nvda")):
        if "tech_headwind" in theme_tags:
            return f"{theme_text} 테마는 기술주에 대한 역풍이 이어지고 있음을 보여준다."
        return f"{theme_text} 테마는 기술주 모멘텀이 이어지고 있음을 시사한다."

    if contains_any(lower, ("tariff", "sanction", "sanctions", "white house", "policy")):
        return f"{theme_text} 테마는 정책 불확실성이 시장 변동성을 키우고 있음을 시사한다."

    if contains_any(lower, ("cta", "options", "gamma", "rebalance", "positioning")):
        return f"{theme_text} 테마는 포지셔닝과 플로우 변수가 단기 변동성을 키우고 있음을 시사한다."

    return f"{theme_text} 테마는 시장 관심의 초점이 되고 있다."


def build_market_driver(market):
    historical_view = market.get("historical_view")
    if historical_view:
        return historical_view

    one_line_takeaway = market.get("one_line_takeaway")
    if one_line_takeaway:
        return one_line_takeaway

    short_term_status = market.get("short_term_status", "unknown")
    fallback_map = {
        "accelerating_up": "기술주 강세가 최근 며칠간 누적으로도 이어지며 단기 모멘텀이 확장되고 있다.",
        "rebound_up": "당일 반등은 확인되지만 최근 흐름 전체로 보면 되돌림 성격도 함께 남아 있다.",
        "mixed": "최근 누적 흐름과 당일 움직임이 완전히 정렬되지는 않았다.",
        "weakening": "최근 누적 강세가 둔화되며 단기 모멘텀의 질이 약해지고 있다.",
        "accelerating_down": "최근 며칠간 누적 하락이 이어지며 단기 하방 압력이 커지고 있다.",
        "unknown": "최근 누적 흐름은 충분치 않아 단기 추세를 제한적으로만 볼 수 있다.",
    }
    return fallback_map.get(short_term_status, fallback_map["unknown"])


def build_risk_driver(market):
    note = market.get("risk_note") or market.get("interpretation") or "거시 변수의 급격한 악화 신호는 제한적이다."
    us10y = market.get("us10y_level")
    oil = market.get("oil_level")

    if us10y is not None and oil is not None and us10y >= 4.3 and oil >= 95:
        return "유가와 금리가 동시에 높은 수준을 유지하며 매크로 부담이 상단을 제한하고 있다."
    if us10y is not None and us10y >= 4.3:
        return "미 10년물 금리 상승이 성장주 밸류에이션 부담을 키우고 있다."
    if oil is not None and oil >= 95:
        return "유가 고착화가 인플레이션 재가속 우려를 키우고 있다."
    return note


def build_fusion_summary(bias, market):
    if bias == "fragile_risk_on_confirmed":
        return "기술주 중심 상승 흐름은 최근 며칠간 누적으로도 이어지고 있지만, 금리와 유가 관련 뉴스 테마가 동시에 존재해 구조적으로는 불안정한 risk-on 환경에 가깝다."
    if bias == "clean_risk_on_confirmation":
        return "기술주 중심 상승과 단기 추세 확장이 함께 확인되며, 뉴스 테마 측면에서도 뚜렷한 거시 역풍은 제한적인 우호적 risk-on 흐름으로 해석된다."
    if bias == "risk_off_confirmed":
        return "시장 약세와 뉴스 기반 거시 압력이 같은 방향으로 정렬되며 위험회피 흐름이 강화되는 구조다."
    if bias == "risk_on_with_macro_headwind":
        return "가격 흐름은 risk-on을 가리키지만, 금리와 기술주 관련 역풍 테마가 병존해 상승의 질은 완전히 편안하지 않다."
    return "시장 가격 흐름과 뉴스 테마 사이에 일부 엇갈림이 있어 단일 방향으로 단정하기보다 혼합 신호로 해석하는 것이 적절하다."


def build_fusion_interpretation(bias, market):
    if bias == "fragile_risk_on_confirmed":
        return "시장 흐름은 risk_on이지만 뉴스 기반 매크로 압력까지 함께 고려하면 clean 상승이 아닌 fragile risk_on으로 해석하는 것이 적절하다."
    if bias == "clean_risk_on_confirmation":
        return "시장 흐름과 뉴스 테마가 함께 risk_on을 지지하며, 거시 부담도 제한적인 우호적 환경으로 해석된다."
    if bias == "risk_off_confirmed":
        return "시장 약세와 거시 압력이 같은 방향으로 정렬되며 위험회피 흐름이 강화되는 구조로 해석된다."
    if bias == "risk_on_with_macro_headwind":
        return "가격 흐름은 risk_on을 가리키지만 금리와 기술주 관련 역풍이 병존해 상승의 질은 완전히 편안하지 않다."
    return "시장 가격 흐름과 뉴스 테마가 완전히 정렬되지 않아 혼합 신호로 해석하는 것이 적절하다."


def build_fusion_drivers(market, news_theme_records, bias):
    drivers = [build_market_driver(market)]

    if news_theme_records:
        drivers.append(build_theme_driver(news_theme_records[0]["text"], news_theme_records[0]["tags"], market))
    else:
        drivers.append(build_risk_driver(market))

    if len(news_theme_records) >= 2:
        drivers.append(build_theme_driver(news_theme_records[1]["text"], news_theme_records[1]["tags"], market))
    else:
        drivers.append(build_risk_driver(market))

    return drivers[:3]


def build_news_overlay(news_data, news_theme_records):
    theme_valid_count, confidence_score, data_confident = extract_news_metrics(news_data)
    selected_themes = [record["text"] for record in news_theme_records]
    if not selected_themes:
        selected_themes = normalize_selected_themes(news_data)
    theme_tags = build_theme_tags(selected_themes)
    quality_flags = search_first(news_data, ("quality_flags",))
    if not isinstance(quality_flags, dict):
        quality_flags = {}

    return {
        "selected_themes": selected_themes,
        "theme_tags": theme_tags,
        "theme_valid_count": theme_valid_count,
        "confidence_score": confidence_score,
        "data_confident": data_confident,
        "quality_flags": quality_flags,
    }


def compute_fusion_confidence(news_overlay, bias):
    confidence = to_float(news_overlay.get("confidence_score"), default=0.0)

    if confidence <= 0.0 and not news_overlay.get("selected_themes"):
        return confidence

    if to_int(news_overlay.get("theme_valid_count"), default=0) >= 4:
        confidence += 0.05
    if to_bool(news_overlay.get("data_confident"), default=False):
        confidence += 0.05
    if bias in {"fragile_risk_on_confirmed", "clean_risk_on_confirmation", "risk_off_confirmed"}:
        confidence += 0.05

    confidence = min(confidence, 0.9)
    return round(confidence, 2)


def is_market_source_stale(market_source_meta, max_age_minutes=60):
    fetched_at = market_source_meta.get("fetched_at") if isinstance(market_source_meta, dict) else None
    parsed = _parse_iso_utc(fetched_at)
    if parsed is None:
        return True
    age_minutes = (datetime.now(timezone.utc) - parsed).total_seconds() / 60.0
    return age_minutes > float(max_age_minutes)


def build_theme_driver(theme_text, theme_tags, market):
    tag_set = set(theme_tags or [])
    if {"oil", "energy", "inflation_pressure"} & tag_set:
        return f"{theme_text} 테마는 원자재와 인플레이션 압력이 여전히 살아 있음을 시사한다."
    if {"rates", "macro_pressure", "valuation_pressure"} & tag_set:
        if "tech_headwind" in tag_set:
            return f"{theme_text} 테마는 금리 상승이 기술주 밸류에이션에 부담을 주고 있음을 보여준다."
        return f"{theme_text} 테마는 금리와 거시 부담이 시장 방향을 좌우하고 있음을 시사한다."
    if {"tech", "growth", "tech_headwind", "tech_tailwind"} & tag_set:
        if "tech_headwind" in tag_set:
            return f"{theme_text} 테마는 기술주에 부담이 남아 있음을 보여준다."
        return f"{theme_text} 테마는 성장주 모멘텀이 유지되고 있음을 시사한다."
    if "policy_risk" in tag_set:
        return f"{theme_text} 테마는 정책 변수와 지정학 리스크가 여전히 시장에 영향을 주고 있음을 보여준다."
    if "flow" in tag_set:
        return f"{theme_text} 테마는 수급과 포지셔닝 변화가 아직 시장 변동성을 키울 수 있음을 시사한다."

    lower = theme_text.lower()
    if contains_any(lower, ("oil", "crude", "energy", "유가", "원유", "에너지")):
        return f"{theme_text} 테마는 원자재와 인플레이션 압력이 여전히 살아 있음을 시사한다."
    if contains_any(lower, ("rate", "yield", "treasury", "fed", "bond", "bonds", "rates", "금리", "국채", "채권", "수익률", "연준")):
        return f"{theme_text} 테마는 금리와 거시 부담이 시장 방향을 좌우하고 있음을 시사한다."
    if contains_any(lower, ("tech", "semis", "semi", "ai", "chip", "nvda", "테크", "반도체", "칩", "엔비디아", "AI")):
        return f"{theme_text} 테마는 성장주 모멘텀이 유지되고 있음을 시사한다."
    if contains_any(lower, ("tariff", "sanction", "sanctions", "white house", "policy", "관세", "제재", "백악관", "정책", "중동", "전쟁", "지정학")):
        return f"{theme_text} 테마는 정책 변수와 지정학 리스크가 여전히 시장에 영향을 주고 있음을 보여준다."
    if contains_any(lower, ("cta", "options", "gamma", "rebalance", "positioning", "옵션", "감마", "리밸런싱", "포지셔닝", "포지션")):
        return f"{theme_text} 테마는 수급과 포지셔닝 변화가 아직 시장 변동성을 키울 수 있음을 시사한다."

    return f"{theme_text} 테마는 시장 관심의 초점이 되고 있다."


def build_fusion_payload(
    news_data,
    market_data,
    *,
    market_loaded=True,
    news_loaded=True,
    market_source_meta=None,
    news_source_meta=None,
):
    market = get_market_context(market_data)
    theme_records, _ = build_news_theme_records(news_data)
    news_overlay = build_news_overlay(news_data, theme_records)
    bias = determine_fusion_bias(market, news_overlay["theme_tags"])

    market_source_meta = market_source_meta if isinstance(market_source_meta, dict) else {}
    market_source_meta = {
        **market_source_meta,
        "loaded": bool(market_loaded),
    }
    news_source_meta = news_source_meta if isinstance(news_source_meta, dict) else {}
    news_source_meta = {
        **news_source_meta,
        "loaded": bool(news_loaded),
    }

    market_only_mode = (not news_loaded) or to_float(news_overlay.get("confidence_score"), default=0.0) <= 0.0
    if market_only_mode:
        bias = determine_market_only_bias(market)

    fusion_summary = build_fusion_summary(bias, market)
    fusion_drivers = build_fusion_drivers(market, theme_records if not market_only_mode else [], bias)
    fusion_interpretation = build_fusion_interpretation(bias, market)

    fusion_confidence = compute_fusion_confidence(news_overlay, bias)
    if market_only_mode and to_float(news_overlay.get("confidence_score"), default=0.0) <= 0.0:
        fusion_confidence = 0.3 if is_market_source_stale(market_source_meta) else 0.4
    elif fusion_confidence == 0.0:
        fusion_confidence = 0.4 if not is_market_source_stale(market_source_meta) else 0.3

    market_date = (
        market_data.get("date")
        or market_data.get("data_date")
        or news_data.get("data_date")
        or news_data.get("date")
        or "unknown"
    )

    return {
        "date": market_date,
        "fusion_summary": fusion_summary,
        "fusion_drivers": fusion_drivers,
        "fusion_interpretation": fusion_interpretation,
        "fusion_confidence": fusion_confidence,
        "fusion_state": {
            "market_regime": market["market_regime"],
            "cross_asset_signal": market["cross_asset_signal"],
            "risk_quality": market["risk_quality"],
            "short_term_status": market["short_term_status"],
        },
        "news_overlay": news_overlay,
        "source_meta": {
            "structured_briefing_loaded": bool(market_loaded),
            "news_payload_loaded": bool(news_loaded),
            "market_source_meta": market_source_meta,
            "news_source_meta": news_source_meta,
            "mode": "market_only_fallback" if market_only_mode else "market_plus_news",
        },
    }


def save_fusion_payload(payload):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"fusion_briefing_{payload['date']}.json"
    latest_path = OUTPUT_DIR / "fusion_briefing_latest.json"
    for path in (out_path, latest_path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Saved: {display_path(out_path)}")
    print(f"Saved: {display_path(latest_path)}")
    return out_path


def main():
    configure_console_encoding()

    market_info = load_latest_structured_briefing()
    news_info = load_latest_news_payload()

    if not market_info["loaded"] or market_info["payload"] is None:
        print("FAIL: no structured briefing input file found")
        return

    payload = build_fusion_payload(
        news_info["payload"],
        market_info["payload"],
        market_loaded=market_info["loaded"],
        news_loaded=news_info["loaded"],
        market_source_meta=market_info["source_meta"],
        news_source_meta=news_info["source_meta"],
    )

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    save_fusion_payload(payload)


if __name__ == "__main__":
    main()
