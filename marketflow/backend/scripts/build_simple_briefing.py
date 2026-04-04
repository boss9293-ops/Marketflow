import json
import os
from pathlib import Path


INPUT_DIR = Path("marketflow/backend/output/market_data_test")
OUTPUT_DIR = Path("marketflow/backend/output/simple_briefing")
REQUIRED_FIELDS = ("sp500_pct", "nasdaq_pct", "xlk_pct", "nvda_pct", "us10y", "oil")


def find_latest_input_path():
    files = sorted(INPUT_DIR.glob("market_data_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def load_market_data(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def classify_regime(data):
    qqq = data.get("nasdaq_pct")
    xlk = data.get("xlk_pct")
    nvda = data.get("nvda_pct")

    if qqq is None or xlk is None or nvda is None:
        return None

    if qqq > 0 and xlk > 0 and nvda > 0:
        return "risk_on"
    if qqq < 0 and xlk < 0 and nvda < 0:
        return "risk_off"
    return "mixed"


def fmt_pct(value):
    return f"{float(value):.2f}%"


def fmt_price(value):
    return f"{float(value):.2f}"


def build_briefing(data):
    if not data.get("date"):
        return None

    if any(data.get(field) is None for field in REQUIRED_FIELDS):
        return None

    regime = classify_regime(data)
    if regime is None:
        return None

    if regime == "risk_on":
        summary = "미국 증시는 기술주 중심 강세를 보였다."
        context = "Nasdaq과 XLK, NVDA가 모두 상승하며 기술주 중심 위험선호가 강화된 하루였다."
    elif regime == "risk_off":
        summary = "미국 증시는 기술주 중심 약세를 보였다."
        context = "Nasdaq과 XLK, NVDA가 모두 약세를 보이며 기술주 중심 위험회피가 강화된 하루였다."
    else:
        summary = "미국 증시는 혼조 흐름을 보였다."
        context = "지수와 기술주 흐름이 엇갈리며 방향성이 혼재된 하루였다."

    return {
        "date": data["date"],
        "summary_statement": summary,
        "indices": [
            f"S&P 500: {fmt_pct(data['sp500_pct'])}",
            f"Nasdaq: {fmt_pct(data['nasdaq_pct'])}",
        ],
        "macro": [
            f"US10Y: {fmt_pct(data['us10y'])}",
            f"WTI: {fmt_price(data['oil'])}",
        ],
        "movers": [
            f"XLK: {fmt_pct(data['xlk_pct'])}",
            f"NVDA: {fmt_pct(data['nvda_pct'])}",
        ],
        "market_regime": regime,
        "today_context": context,
    }


def save_briefing(briefing):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    out_path = OUTPUT_DIR / f"simple_briefing_{briefing['date']}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(briefing, f, ensure_ascii=False, indent=2)

    print(f"Saved: {out_path}")
    return out_path


def main():
    input_path = find_latest_input_path()
    if input_path is None:
        print("FAIL: no market data input file found")
        return

    data = load_market_data(input_path)
    briefing = build_briefing(data)
    if briefing is None:
        print("FAIL: insufficient input data")
        return

    print(json.dumps(briefing, ensure_ascii=False, indent=2))
    save_briefing(briefing)


if __name__ == "__main__":
    main()
