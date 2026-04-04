import json
import os
import sys
from pathlib import Path
from datetime import datetime


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]

NEWS_VALIDATION_DIR = BACKEND_DIR / "output" / "validation"
NEWS_CACHE_DIR = BACKEND_DIR / "output" / "cache"
NEWS_AI_DIR = BACKEND_DIR / "output" / "ai"
FUSION_DIR = BACKEND_DIR / "output" / "fusion"
OUTPUT_DIR = BACKEND_DIR / "output" / "light_theme"


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

    if contains_any(lower, ("oil", "crude", "energy")):
        add(["oil", "energy", "inflation"])

    if contains_any(lower, ("rate", "yield", "treasury", "fed", "bond", "bonds", "rates")):
        add(["rates", "macro", "valuation"])

    if contains_any(lower, ("tech", "ai", "nvda", "chip", "chips", "semis", "semi")):
        add(["tech", "growth"])

    if contains_any(lower, ("policy", "tariff", "white house", "sanction", "sanctions")):
        add(["policy"])

    if contains_any(lower, ("cta", "options", "gamma", "flow", "rebalance", "positioning")):
        add(["flow"])

    return tags


def compress_tags(raw_tags):
    raw_set = set(raw_tags)
    compressed = []

    def add(tag):
        if tag in raw_set and tag not in compressed:
            compressed.append(tag)

    if "oil" in raw_set and "rates" in raw_set:
        for tag in ("oil", "rates", "inflation"):
            add(tag)
    elif "tech" in raw_set and "growth" in raw_set and not raw_set.intersection({"oil", "rates", "inflation"}):
        for tag in ("tech", "growth"):
            add(tag)
    elif "oil" in raw_set and "energy" in raw_set:
        for tag in ("oil", "energy"):
            add(tag)
    elif "rates" in raw_set and "tech" in raw_set:
        for tag in ("rates", "tech"):
            add(tag)
    else:
        for tag in ("rates", "inflation", "oil", "tech", "energy", "policy", "flow", "growth", "macro", "valuation"):
            add(tag)

    if not compressed:
        for tag in raw_tags:
            append_unique(compressed, tag)

    return compressed[:3]


def build_theme_title(raw_tags):
    tag_set = set(raw_tags)

    if "oil" in tag_set and "rates" in tag_set:
        return "Inflation & Rate Pressure"
    if "tech" in tag_set and "growth" in tag_set and not tag_set.intersection({"oil", "rates", "inflation"}):
        return "Tech Momentum Continues"
    if "oil" in tag_set and "energy" in tag_set:
        return "Energy Rally Builds"
    if "rates" in tag_set and "tech" in tag_set:
        return "Rates Pressure Hits Tech"
    return "Market Drivers Mixed"


def build_theme_subtitle(fusion_data):
    cross_asset_signal = search_first(fusion_data, ("cross_asset_signal",)) or "mixed"
    short_term_status = search_first(fusion_data, ("short_term_status",)) or "unknown"

    signal_map = {
        "risk_on_but_fragile": "Fragile Risk-On",
        "clean_risk_on": "Clean Risk-On",
        "risk_off": "Risk-Off",
        "risk_on_with_macro_headwind": "Risk-On With Headwinds",
        "mixed": "Mixed Signal",
    }
    status_map = {
        "accelerating_up": "Momentum Expanding",
        "rebound_up": "Rebound Building",
        "weakening": "Momentum Fading",
        "accelerating_down": "Downtrend Deepening",
        "mixed": "Mixed Momentum",
        "unknown": "Limited Visibility",
    }

    parts = []
    signal_part = signal_map.get(str(cross_asset_signal), "Mixed Signal")
    status_part = status_map.get(str(short_term_status), "Limited Visibility")

    if signal_part:
        parts.append(signal_part)
    if status_part:
        parts.append(status_part)

    if parts:
        return " | ".join(parts[:2])

    fusion_summary = search_first(fusion_data, ("fusion_summary",)) or ""
    if fusion_summary:
        return fusion_summary if len(fusion_summary) <= 48 else f"{fusion_summary[:45].rstrip()}..."

    return "Market Drivers Mixed"


def build_light_theme(news_data, fusion_data):
    selected_themes = extract_theme_texts(news_data)
    raw_tags = []

    for theme_text in selected_themes:
        for tag in map_theme_to_tags(theme_text):
            append_unique(raw_tags, tag)

    theme_title = build_theme_title(raw_tags)
    theme_subtitle = build_theme_subtitle(fusion_data)
    theme_tags = compress_tags(raw_tags)

    return {
        "theme_title": theme_title,
        "theme_subtitle": theme_subtitle,
        "theme_tags": theme_tags,
    }


def resolve_output_date(news_data, fusion_data):
    for source in (fusion_data, news_data):
        date_value = search_first(source, ("date", "data_date", "asof", "as_of"))
        if isinstance(date_value, str) and date_value.strip():
            return date_value.strip()
    return datetime.utcnow().strftime("%Y-%m-%d")


def looks_like_news_payload(data):
    if not isinstance(data, dict):
        return False

    if extract_theme_texts(data):
        return True

    return any(
        search_first(data, (key,)) is not None
        for key in ("selected_themes", "top_themes_today", "top_themes", "supporting_highlights", "events")
    )


def looks_like_fusion_payload(data):
    if not isinstance(data, dict):
        return False

    return any(
        search_first(data, (key,)) is not None
        for key in ("cross_asset_signal", "risk_quality", "short_term_status", "fusion_summary")
    )


def find_latest_news_input_path():
    env_path = os.environ.get("LIGHT_THEME_NEWS_INPUT_PATH") or os.environ.get("NEWS_INPUT_PATH")
    if env_path:
        return Path(env_path).expanduser()

    candidate_paths = []
    for root, pattern in (
        (NEWS_VALIDATION_DIR, "04_selected_themes.json"),
        (NEWS_VALIDATION_DIR, "05_daily_briefing.json"),
        (NEWS_VALIDATION_DIR, "99_final_payload.json"),
    ):
        if root.exists():
            candidate_paths.extend(root.rglob(pattern))

    for path in (
        NEWS_CACHE_DIR / "daily_briefing.json",
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


def find_latest_fusion_input_path():
    env_path = os.environ.get("LIGHT_THEME_FUSION_INPUT_PATH") or os.environ.get("FUSION_INPUT_PATH")
    if env_path:
        return Path(env_path).expanduser()

    candidate_paths = []
    if FUSION_DIR.exists():
        candidate_paths.extend(FUSION_DIR.glob("fusion_briefing_*.json"))
        candidate_paths.extend(FUSION_DIR.glob("*.json"))

    candidate_paths = sorted(
        {path for path in candidate_paths if path.exists()},
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )

    for path in candidate_paths:
        try:
            if looks_like_fusion_payload(load_json_file(path)):
                return path
        except Exception:
            continue

    return candidate_paths[0] if candidate_paths else None


def save_light_theme(payload, output_date):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"light_theme_{output_date}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Saved: {display_path(out_path)}")
    return out_path


def main():
    configure_console_encoding()

    news_path = find_latest_news_input_path()
    fusion_path = find_latest_fusion_input_path()

    if news_path is None:
        print("FAIL: no news input file found")
        return
    if fusion_path is None:
        print("FAIL: no fusion input file found")
        return

    news_data = load_json_file(news_path)
    fusion_data = load_json_file(fusion_path)
    payload = build_light_theme(news_data, fusion_data)
    output_date = resolve_output_date(news_data, fusion_data)

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    save_light_theme(payload, output_date)


if __name__ == "__main__":
    main()
