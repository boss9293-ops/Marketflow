import json
import os
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
MARKETFLOW_DIR = BACKEND_DIR.parent

for _path in (MARKETFLOW_DIR, BACKEND_DIR):
    _path_str = str(_path)
    if _path_str not in sys.path:
        sys.path.insert(0, _path_str)

try:
    from backend.services.market_snapshot_reader import get_market_snapshot_for_briefing
except Exception:  # pragma: no cover
    get_market_snapshot_for_briefing = None


INPUT_DIR = Path("marketflow/backend/output/market_data_test")
OUTPUT_DIR = Path("marketflow/backend/output/structured_briefing")
REQUIRED_FIELDS = ("sp500_pct", "nasdaq_pct", "xlk_pct", "nvda_pct", "us10y", "oil")
HISTORICAL_FIELDS = (
    "nasdaq_3d_cum_pct",
    "nasdaq_5d_cum_pct",
    "xlk_3d_cum_pct",
    "nvda_3d_cum_pct",
    "nasdaq_streak_up_days",
    "xlk_streak_up_days",
    "nvda_streak_up_days",
)


def find_latest_input_path():
    files = sorted(INPUT_DIR.glob("market_data_*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    return files[0] if files else None


def get_input_path():
    env_path = os.environ.get("MARKET_DATA_INPUT_PATH")
    if env_path:
        return Path(env_path)
    return find_latest_input_path()


def load_market_data(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def determine_market_regime(data):
    nasdaq_pct = data.get("nasdaq_pct")
    xlk_pct = data.get("xlk_pct")
    nvda_pct = data.get("nvda_pct")

    if nasdaq_pct is None or xlk_pct is None or nvda_pct is None:
        return None

    if nasdaq_pct > 0 and xlk_pct > 0 and nvda_pct > 0:
        return "risk_on"
    if nasdaq_pct < 0 and xlk_pct < 0 and nvda_pct < 0:
        return "risk_off"
    return "neutral"


HIGH_US10Y_THRESHOLD = 4.3
HIGH_OIL_THRESHOLD = 95
LOW_US10Y_THRESHOLD = 4.0
LOW_OIL_THRESHOLD = 90


def build_headline(regime):
    if regime == "risk_on":
        return "기술주 주도 랠리 - 리스크 온 강화"
    if regime == "risk_off":
        return "기술주 중심 조정 - 리스크 오프 강화"
    return "혼조 장세 - 방향성 탐색 구간"


def build_summary_statement(regime):
    if regime == "risk_on":
        return "미국 증시는 기술주 중심 강세를 보였다."
    if regime == "risk_off":
        return "미국 증시는 기술주 중심 조정을 보였다."
    return "미국 증시는 혼조 흐름을 보였다."


def build_today_context(regime):
    if regime == "risk_on":
        return "Nasdaq, XLK, NVDA가 모두 상승하며 기술주 중심 위험선호가 강화된 하루였다."
    if regime == "risk_off":
        return "Nasdaq, XLK, NVDA가 모두 하락하며 기술주 중심 위험회피가 강화된 하루였다."
    return "기술주 내부에서도 방향이 엇갈리며 뚜렷한 추세 확인은 제한됐다."


def format_signed_pct(value):
    return f"{float(value):+.2f}%"


def format_driver_move(name, value, tail):
    direction = "상승" if value > 0 else "하락" if value < 0 else "보합"
    if tail:
        return f"{name} {format_signed_pct(value)} {direction} - {tail}"
    return f"{name} {format_signed_pct(value)} {direction}"


def build_key_drivers(data):
    nasdaq_pct = data["nasdaq_pct"]
    xlk_pct = data["xlk_pct"]
    nvda_pct = data["nvda_pct"]

    return [
        format_driver_move("Nasdaq", nasdaq_pct, ""),
        format_driver_move("XLK", xlk_pct, "기술 섹터 강세" if xlk_pct > 0 else "기술 섹터 약세" if xlk_pct < 0 else "기술 섹터 보합"),
        format_driver_move("NVDA", nvda_pct, "AI 모멘텀 지속" if nvda_pct > 0 else "AI 모멘텀 둔화" if nvda_pct < 0 else "AI 모멘텀 중립"),
    ]


def build_market_levels(data):
    return {
        "sp500_level": None,
        "nasdaq_level": None,
        "us10y_level": data["us10y"],
        "oil_level": data["oil"],
    }


def determine_cross_asset_signal(market_regime, us10y, oil):
    if market_regime == "risk_on" and (us10y >= HIGH_US10Y_THRESHOLD or oil >= HIGH_OIL_THRESHOLD):
        return "risk_on_but_fragile"
    if market_regime == "risk_on" and (us10y < LOW_US10Y_THRESHOLD and oil < LOW_OIL_THRESHOLD):
        return "clean_risk_on"
    if market_regime == "risk_off":
        return "risk_off"
    return "mixed"


def determine_risk_quality(market_regime, us10y, oil):
    oil_high = oil >= HIGH_OIL_THRESHOLD
    us10y_high = us10y >= HIGH_US10Y_THRESHOLD
    oil_low = oil < LOW_OIL_THRESHOLD
    us10y_low = us10y < LOW_US10Y_THRESHOLD

    if market_regime == "risk_on" and oil_low and us10y_low:
        return "clean"
    if market_regime == "risk_on" and (oil_high or us10y_high):
        return "fragile"
    if market_regime == "risk_off" and oil_high and us10y_high:
        return "stressed"
    return "neutral"


def build_today_context_v2(cross_asset_signal, us10y, oil):
    if cross_asset_signal == "risk_on_but_fragile":
        return (
            f"Nasdaq, XLK, NVDA가 모두 상승하며 기술주 중심 위험선호가 강화된 하루였다. "
            f"금리 {us10y:.2f}%, 유가 ${oil:.2f} 수준이 유지되며 부담도 함께 남아 있다."
        )
    if cross_asset_signal == "clean_risk_on":
        return (
            f"Nasdaq, XLK, NVDA가 모두 상승하며 기술주 중심 위험선호가 강화된 하루였다. "
            f"금리 {us10y:.2f}%, 유가 ${oil:.2f} 수준이 비교적 우호적으로 유지됐다."
        )
    if cross_asset_signal == "risk_off":
        return (
            f"Nasdaq, XLK, NVDA가 모두 하락하며 기술주 중심 위험회피가 강화된 하루였다. "
            f"금리 {us10y:.2f}%, 유가 ${oil:.2f} 수준이 하방 압력을 더했다."
        )
    return (
        f"기술주 내부에서도 방향이 엇갈렸고 금리 {us10y:.2f}%, 유가 ${oil:.2f} 수준도 "
        f"혼재된 신호를 보였다."
    )


def build_interpretation_v2(cross_asset_signal):
    if cross_asset_signal == "risk_on_but_fragile":
        return "기술주 중심 위험선호 흐름이 유지되고 있지만 금리와 유가 부담으로 구조적으로는 불안정한 상태다."
    if cross_asset_signal == "clean_risk_on":
        return "기술주 중심 위험선호가 강화되며 거시 변수 부담도 제한적인 우호적 환경이다."
    if cross_asset_signal == "risk_off":
        return "위험회피 흐름이 강화되며 거시 변수 부담이 시장 하방 압력을 키우는 구조다."
    return "시장 내부 신호가 엇갈리며 뚜렷한 방향성이 형성되지 않은 상태다."


def build_risk_note_v2(us10y, oil):
    if oil >= HIGH_OIL_THRESHOLD and us10y >= HIGH_US10Y_THRESHOLD:
        return "유가와 금리가 동시에 높은 수준을 유지하며 인플레이션 및 밸류에이션 부담이 동시에 작용할 가능성은 점검이 필요하다."
    if oil >= HIGH_OIL_THRESHOLD:
        return "유가 상승이 지속될 경우 인플레이션 압력이 재확대될 가능성은 점검이 필요하다."
    if us10y >= HIGH_US10Y_THRESHOLD:
        return "금리 상승이 지속될 경우 성장주 밸류에이션 부담이 재부각될 수 있다."
    return "거시 변수의 급격한 악화 신호는 제한적이다."


def build_one_line_takeaway_v2(market_regime, cross_asset_signal, risk_quality, short_term_status):
    if short_term_status == "accelerating_up":
        if cross_asset_signal == "risk_on_but_fragile" or risk_quality == "fragile":
            return "기술주 중심 랠리가 최근 며칠간 누적으로도 이어지고 있지만 금리와 유가 부담으로 질적으로는 불안정한 risk-on 흐름이다."
        return "기술주 중심 랠리가 최근 며칠간 누적으로도 이어지며 거시 부담도 제한적인 우호적 장세다."
    if short_term_status == "rebound_up":
        return "기술주 반등은 확인되지만 최근 흐름 전체로 보면 추세 재가속보다는 되돌림 성격도 함께 점검할 필요가 있다."
    if short_term_status == "accelerating_down":
        return "기술주 하락이 최근 며칠간 누적으로도 이어지며 하방 압력이 강화된 국면이다."
    if short_term_status == "weakening":
        return "기술주 강세가 이어지고 있어도 최근 누적 흐름은 약해지고 있어 모멘텀의 질이 둔화된 상태다."
    if short_term_status == "mixed":
        return "기술주와 거시 신호가 엇갈리며 방향성 확인이 필요한 혼조 국면이다."
    if cross_asset_signal == "risk_on_but_fragile" or (market_regime == "risk_on" and risk_quality == "fragile"):
        return "기술주 랠리가 이어졌지만 금리와 유가 부담으로 질적으로는 불안정한 risk-on 흐름이다."
    if cross_asset_signal == "clean_risk_on" or (market_regime == "risk_on" and risk_quality == "clean"):
        return "기술주 중심 risk-on이 이어지며 거시 부담도 제한적인 우호적 장세다."
    if cross_asset_signal == "risk_off":
        return "기술주 약세와 거시 부담이 겹치며 하방 압력이 우세한 risk-off 국면이다."
    return "기술주와 거시 신호가 엇갈리며 방향성 확인이 필요한 혼조 국면이다."


def build_briefing_summary(summary_statement, market_regime, risk_quality):
    if market_regime == "risk_on" and risk_quality == "fragile":
        return f"{summary_statement} 금리와 유가 부담이 동시에 남아 있어 구조적으로는 완전히 편안한 상승은 아니었다."
    if market_regime == "risk_on" and risk_quality == "clean":
        return f"{summary_statement} 금리와 유가 부담도 제한적이어서 비교적 우호적인 상승 흐름이었다."
    if market_regime == "risk_off":
        return f"{summary_statement} 거시 부담이 하방 압력을 더했다."
    return f"{summary_statement} 금리와 유가 신호도 엇갈려 방향성을 단정하기 어려웠다."


def build_cross_asset_view(market_regime, cross_asset_signal, risk_quality, interpretation):
    if cross_asset_signal == "risk_on_but_fragile":
        return "시장 신호는 risk_on으로 분류되지만, 금리와 유가가 모두 높은 수준이어서 clean risk-on보다는 fragile risk-on에 가깝다."
    if cross_asset_signal == "clean_risk_on":
        return "시장 신호는 clean risk-on에 가깝고, 기술주 강세와 거시 부담 완화가 함께 확인된다."
    if cross_asset_signal == "risk_off":
        return "시장 신호는 risk_off로 분류되며 기술주 약세와 거시 부담이 동시에 작용한다."
    return "시장 신호가 엇갈리며 방향성이 아직 정리되지 않았다."


def determine_short_term_status(data):
    nasdaq_pct = data.get("nasdaq_pct")
    nasdaq_3d = data.get("nasdaq_3d_cum_pct")
    nasdaq_5d = data.get("nasdaq_5d_cum_pct")
    xlk_3d = data.get("xlk_3d_cum_pct")
    nvda_3d = data.get("nvda_3d_cum_pct")
    nasdaq_streak = data.get("nasdaq_streak_up_days")

    required = (nasdaq_pct, nasdaq_3d, xlk_3d, nvda_3d)
    if any(value is None for value in required):
        return "unknown"

    if nasdaq_pct < 0 and nasdaq_3d < 0 and xlk_3d < 0 and nvda_3d < 0:
        return "accelerating_down"

    if nasdaq_pct > 0 and nasdaq_3d > 0 and xlk_3d > 0 and nvda_3d > 0 and nasdaq_streak is not None and nasdaq_streak >= 2:
        return "accelerating_up"

    if nasdaq_pct > 0 and nasdaq_3d > 0 and (nasdaq_5d is not None and nasdaq_5d < 0):
        return "weakening"

    if nasdaq_pct > 0 and nasdaq_3d > 0 and (xlk_3d <= 0 or nvda_3d <= 0):
        return "mixed"

    if nasdaq_pct < 0 and nasdaq_3d < 0 and (xlk_3d >= 0 or nvda_3d >= 0):
        return "mixed"

    if nasdaq_pct > 0 and nasdaq_3d > 0:
        return "rebound_up"

    if nasdaq_3d < 0 or xlk_3d < 0 or nvda_3d < 0 or (nasdaq_5d is not None and nasdaq_5d < 0):
        return "weakening"

    return "mixed"


def build_historical_view(short_term_status):
    if short_term_status == "accelerating_up":
        return "기술주 강세가 하루 반등에 그치지 않고 최근 며칠간 누적으로도 확장되며 단기 추세가 강화되는 모습이다."
    if short_term_status == "rebound_up":
        return "당일 반등은 확인되지만 최근 흐름 전체로 보면 추세 재가속보다는 되돌림 성격도 함께 점검할 필요가 있다."
    if short_term_status == "mixed":
        return "당일 강세와 최근 누적 흐름 사이에 엇갈림이 있어 단기 추세가 완전히 정렬됐다고 보기는 어렵다."
    if short_term_status == "weakening":
        return "당일 움직임과 별개로 최근 누적 흐름은 약해지고 있어 단기 모멘텀의 질은 다소 둔화된 상태다."
    if short_term_status == "accelerating_down":
        return "최근 며칠간 누적 하락이 이어지며 단기 하방 압력이 강화되는 구조다."
    return "최근 누적 흐름 데이터가 충분하지 않아 단기 추세 맥락은 제한적으로만 판단할 수 있다."


def build_historical_context(data, short_term_status):
    return {
        "short_term_status": short_term_status,
        "nasdaq_3d_cum_pct": data.get("nasdaq_3d_cum_pct"),
        "nasdaq_5d_cum_pct": data.get("nasdaq_5d_cum_pct"),
        "xlk_3d_cum_pct": data.get("xlk_3d_cum_pct"),
        "nvda_3d_cum_pct": data.get("nvda_3d_cum_pct"),
        "nasdaq_streak_up_days": data.get("nasdaq_streak_up_days"),
        "xlk_streak_up_days": data.get("xlk_streak_up_days"),
        "nvda_streak_up_days": data.get("nvda_streak_up_days"),
        "historical_view": build_historical_view(short_term_status),
    }


def build_check_points_v2(data, market_regime, short_term_status):
    check_points = []

    trend_point = {
        "accelerating_up": "기술주 강세가 3일 이상 연속 확산되는지 여부",
        "rebound_up": "기술주 반등이 최근 누적 흐름으로 이어지는지 여부",
        "mixed": "단기 방향성이 다시 정렬되는지 여부",
        "weakening": "최근 누적 강세 둔화가 지속되는지 여부",
        "accelerating_down": "최근 누적 하락이 이어지는지 여부",
        "unknown": "최근 단기 추세가 추가로 확인되는지 여부",
    }.get(short_term_status, "최근 단기 추세가 추가로 확인되는지 여부")
    check_points.append(trend_point)

    if data["us10y"] >= HIGH_US10Y_THRESHOLD:
        check_points.append("미 10년물 금리가 4.3% 이상에서 추가 상승하는지 여부")
    if data["oil"] >= HIGH_OIL_THRESHOLD:
        check_points.append("유가가 95달러 이상에서 고착되는지 여부")

    if market_regime == "risk_on":
        check_points.append("기술주 강세가 지수 전반으로 확산되는지 여부")
    elif market_regime == "risk_off":
        check_points.append("하방 압력이 지수 전반으로 이어지는지 여부")
    else:
        check_points.append("시장 방향성이 추가로 확인되는지 여부")

    fallback_points = {
        "risk_on": [
            "기술주 리더십이 유지되는지 여부",
            "상승 흐름이 다른 섹터로 넓어지는지 여부",
        ],
        "risk_off": [
            "방어적 매수세가 유입되는지 여부",
            "추가 하락 압력이 이어지는지 여부",
        ],
        "mixed": [
            "다음 거래일에 방향성이 정리되는지 여부",
            "기술주 강약이 다시 명확해지는지 여부",
        ],
    }

    for point in fallback_points.get(market_regime, fallback_points["mixed"]):
        if len(check_points) >= 3:
            break
        if point not in check_points:
            check_points.append(point)

    while len(check_points) < 3:
        fallback = "추세 지속 여부" if market_regime == "risk_on" else "변동성 확대 여부" if market_regime == "risk_off" else "방향성 확인 여부"
        if fallback not in check_points:
            check_points.append(fallback)
        else:
            check_points.append(f"추가 관찰 포인트 {len(check_points) + 1}")

    return check_points[:3]


def build_briefing_sections(
    data,
    headline,
    summary_statement,
    key_drivers,
    cross_asset_signal,
    risk_quality,
    interpretation,
    risk_note,
    market_regime,
    historical_view,
    short_term_status,
):
    return {
        "headline": headline,
        "summary": build_briefing_summary(summary_statement, market_regime, risk_quality),
        "drivers": list(key_drivers),
        "cross_asset_view": build_cross_asset_view(market_regime, cross_asset_signal, risk_quality, interpretation),
        "historical_view": historical_view,
        "risk_note": risk_note,
        "check_points": build_check_points_v2(data, market_regime, short_term_status),
    }


def build_market_snapshot(data):
    return {
        "sp500_pct": data["sp500_pct"],
        "nasdaq_pct": data["nasdaq_pct"],
        "xlk_pct": data["xlk_pct"],
        "nvda_pct": data["nvda_pct"],
        "us10y": data["us10y"],
        "oil": data["oil"],
    }


def _coerce_float(value, default=0.0):
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _pick_record(snapshot_group, symbol):
    if not isinstance(snapshot_group, dict):
        return None
    record = snapshot_group.get(symbol)
    return record if isinstance(record, dict) else None


def _snapshot_date(meta):
    if not isinstance(meta, dict):
        return datetime.utcnow().strftime("%Y-%m-%d")
    for key in ("as_of", "fetched_at"):
        value = meta.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:10]
    return datetime.utcnow().strftime("%Y-%m-%d")


def _snapshot_number(record, key, default=0.0):
    if not isinstance(record, dict):
        return default
    return _coerce_float(record.get(key), default=default)


def _build_snapshot_input(snapshot):
    indices = snapshot.get("indices") if isinstance(snapshot.get("indices"), dict) else {}
    macro = snapshot.get("macro") if isinstance(snapshot.get("macro"), dict) else {}
    etfs = snapshot.get("etfs") if isinstance(snapshot.get("etfs"), dict) else {}
    mega_caps = snapshot.get("mega_caps") if isinstance(snapshot.get("mega_caps"), dict) else {}
    meta = snapshot.get("meta") if isinstance(snapshot.get("meta"), dict) else {}

    spx = _pick_record(indices, "SPX")
    ndx = _pick_record(indices, "NDX") or _pick_record(indices, "IXIC")
    vix = _pick_record(indices, "VIX")
    us10y = _pick_record(macro, "US10Y")
    wti = _pick_record(macro, "WTI")
    gold = _pick_record(macro, "GOLD")
    smh = _pick_record(etfs, "SMH")
    qqq = _pick_record(etfs, "QQQ")
    tech_proxy = smh or qqq
    nvda = _pick_record(mega_caps, "NVDA")

    tech_proxy_symbol = "SMH" if smh else "QQQ" if qqq else None

    return {
        "date": _snapshot_date(meta),
        "sp500_pct": _snapshot_number(spx, "change_pct"),
        "nasdaq_pct": _snapshot_number(ndx, "change_pct"),
        "xlk_pct": _snapshot_number(tech_proxy, "change_pct"),
        "tech_proxy_pct": _snapshot_number(tech_proxy, "change_pct"),
        "tech_proxy_symbol": tech_proxy_symbol,
        "nvda_pct": _snapshot_number(nvda, "change_pct"),
        "us10y": _snapshot_number(us10y, "price"),
        "oil": _snapshot_number(wti, "price"),
        "sp500_level": _snapshot_number(spx, "price"),
        "nasdaq_level": _snapshot_number(ndx, "price"),
        "us10y_level": _snapshot_number(us10y, "price"),
        "oil_level": _snapshot_number(wti, "price"),
        "gold_level": _snapshot_number(gold, "price"),
        "vix_level": _snapshot_number(vix, "price"),
        "nasdaq_3d_cum_pct": None,
        "nasdaq_5d_cum_pct": None,
        "xlk_3d_cum_pct": None,
        "nvda_3d_cum_pct": None,
        "nasdaq_streak_up_days": None,
        "xlk_streak_up_days": None,
        "nvda_streak_up_days": None,
    }


def _enrich_structured_briefing(briefing, snapshot, snapshot_input):
    if briefing is None:
        return None

    data_source_meta = snapshot.get("meta") if isinstance(snapshot.get("meta"), dict) else {}
    historical_context = briefing.get("historical_context") if isinstance(briefing.get("historical_context"), dict) else {}
    short_term_status = historical_context.get("short_term_status") or "unknown"

    briefing["market_levels"] = {
        "sp500_level": snapshot_input.get("sp500_level"),
        "nasdaq_level": snapshot_input.get("nasdaq_level"),
        "us10y_level": snapshot_input.get("us10y_level"),
        "oil_level": snapshot_input.get("oil_level"),
        "gold_level": snapshot_input.get("gold_level"),
        "vix_level": snapshot_input.get("vix_level"),
    }

    briefing["market_snapshot"] = {
        "sp500_pct": snapshot_input.get("sp500_pct"),
        "nasdaq_pct": snapshot_input.get("nasdaq_pct"),
        "xlk_pct": snapshot_input.get("xlk_pct"),
        "tech_proxy_pct": snapshot_input.get("tech_proxy_pct"),
        "tech_proxy_symbol": snapshot_input.get("tech_proxy_symbol"),
        "nvda_pct": snapshot_input.get("nvda_pct"),
        "us10y": snapshot_input.get("us10y"),
        "oil": snapshot_input.get("oil"),
        "sp500_level": snapshot_input.get("sp500_level"),
        "nasdaq_level": snapshot_input.get("nasdaq_level"),
        "us10y_level": snapshot_input.get("us10y_level"),
        "oil_level": snapshot_input.get("oil_level"),
        "gold_level": snapshot_input.get("gold_level"),
        "vix_level": snapshot_input.get("vix_level"),
    }

    briefing["data_source_meta"] = {
        "snapshot_source": data_source_meta.get("source") or "cache",
        "as_of": data_source_meta.get("as_of"),
        "fetched_at": data_source_meta.get("fetched_at"),
        "tech_proxy_symbol": snapshot_input.get("tech_proxy_symbol"),
        "historical_context_mode": "fallback_unknown" if short_term_status == "unknown" else "snapshot_derived",
    }

    return briefing


def build_structured_briefing_from_snapshot(use_cache=True):
    if get_market_snapshot_for_briefing is None:
        return None

    snapshot = get_market_snapshot_for_briefing(use_cache=use_cache)
    if not isinstance(snapshot, dict):
        return None

    snapshot_input = _build_snapshot_input(snapshot)
    briefing = build_structured_briefing(snapshot_input)
    return _enrich_structured_briefing(briefing, snapshot, snapshot_input)


def build_structured_briefing(data):
    if not data.get("date"):
        return None

    if any(data.get(field) is None for field in REQUIRED_FIELDS):
        return None

    regime = determine_market_regime(data)
    if regime is None:
        return None

    cross_asset_signal = determine_cross_asset_signal(regime, data["us10y"], data["oil"])
    risk_quality = determine_risk_quality(regime, data["us10y"], data["oil"])
    short_term_status = determine_short_term_status(data)
    headline = build_headline(regime)
    summary_statement = build_summary_statement(regime)
    today_context = build_today_context_v2(cross_asset_signal, data["us10y"], data["oil"])
    key_drivers = build_key_drivers(data)
    interpretation = build_interpretation_v2(cross_asset_signal)
    risk_note = build_risk_note_v2(data["us10y"], data["oil"])
    historical_context = build_historical_context(data, short_term_status)
    one_line_takeaway = build_one_line_takeaway_v2(regime, cross_asset_signal, risk_quality, short_term_status)
    briefing_sections = build_briefing_sections(
        data=data,
        headline=headline,
        summary_statement=summary_statement,
        key_drivers=key_drivers,
        cross_asset_signal=cross_asset_signal,
        risk_quality=risk_quality,
        interpretation=interpretation,
        risk_note=risk_note,
        market_regime=regime,
        historical_view=historical_context["historical_view"],
        short_term_status=short_term_status,
    )

    return {
        "date": data["date"],
        "market_regime": regime,
        "cross_asset_signal": cross_asset_signal,
        "risk_quality": risk_quality,
        "historical_context": historical_context,
        "headline": headline,
        "one_line_takeaway": one_line_takeaway,
        "summary_statement": summary_statement,
        "today_context": today_context,
        "interpretation": interpretation,
        "risk_note": risk_note,
        "briefing_sections": briefing_sections,
        "key_drivers": key_drivers,
        "market_levels": build_market_levels(data),
        "market_snapshot": build_market_snapshot(data),
    }


def save_structured_briefing(briefing):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    out_path = OUTPUT_DIR / f"structured_briefing_{briefing['date']}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(briefing, f, ensure_ascii=False, indent=2)

    print(f"Saved: {out_path}")
    return out_path


# Snapshot-safe overrides.
# The legacy functions above remain available for file-based fallback paths,
# but these versions are the ones used at runtime by the main briefing flow.
def _optional_float(value):
    return _coerce_float(value, default=None)


def _snapshot_number(record, key, default=None):
    if not isinstance(record, dict):
        return default
    return _coerce_float(record.get(key), default=default)


def determine_market_regime(data):
    nasdaq_pct = _optional_float(data.get("nasdaq_pct"))
    xlk_pct = _optional_float(data.get("xlk_pct"))
    nvda_pct = _optional_float(data.get("nvda_pct"))

    signed_values = [value for value in (nasdaq_pct, xlk_pct, nvda_pct) if value is not None]
    if not signed_values:
        return "neutral"

    signs = [1 if value > 0 else -1 if value < 0 else 0 for value in signed_values]
    signs = [sign for sign in signs if sign != 0]
    if not signs:
        return "neutral"
    if all(sign > 0 for sign in signs):
        return "risk_on"
    if all(sign < 0 for sign in signs):
        return "risk_off"
    return "neutral"


def format_signed_pct(value):
    numeric_value = _optional_float(value)
    if numeric_value is None:
        return "n/a"
    return f"{numeric_value:+.2f}%"


def format_driver_move(name, value, tail):
    numeric_value = _optional_float(value)
    if numeric_value is None:
        return f"{name} n/a"

    direction = "?곸듅" if numeric_value > 0 else "?섎씫" if numeric_value < 0 else "蹂댄빀"
    if tail:
        return f"{name} {format_signed_pct(numeric_value)} {direction} - {tail}"
    return f"{name} {format_signed_pct(numeric_value)} {direction}"


def build_key_drivers(data):
    nasdaq_pct = data.get("nasdaq_pct")
    xlk_pct = data.get("xlk_pct")
    nvda_pct = data.get("nvda_pct")

    xlk_value = _optional_float(xlk_pct)
    nvda_value = _optional_float(nvda_pct)

    return [
        format_driver_move("Nasdaq", nasdaq_pct, ""),
        format_driver_move(
            "XLK",
            xlk_pct,
            "湲곗닠 ?뱁꽣 媛뺤꽭"
            if xlk_value is not None and xlk_value > 0
            else "湲곗닠 ?뱁꽣 ?쎌꽭"
            if xlk_value is not None and xlk_value < 0
            else "湲곗닠 ?뱁꽣 蹂댄빀",
        ),
        format_driver_move(
            "NVDA",
            nvda_pct,
            "AI 紐⑤찘? 吏??"
            if nvda_value is not None and nvda_value > 0
            else "AI 紐⑤찘? ?뷀솕"
            if nvda_value is not None and nvda_value < 0
            else "AI 紐⑤찘? 以묐┰",
        ),
    ]


def build_market_levels(data):
    return {
        "sp500_level": data.get("sp500_level"),
        "nasdaq_level": data.get("nasdaq_level"),
        "us10y_level": data.get("us10y_level", data.get("us10y")),
        "oil_level": data.get("oil_level", data.get("oil")),
    }


def determine_cross_asset_signal(market_regime, us10y, oil):
    us10y_value = _optional_float(us10y)
    oil_value = _optional_float(oil)

    if market_regime == "risk_off":
        return "risk_off"
    if us10y_value is None or oil_value is None:
        return "mixed"
    if market_regime == "risk_on" and (us10y_value >= HIGH_US10Y_THRESHOLD or oil_value >= HIGH_OIL_THRESHOLD):
        return "risk_on_but_fragile"
    if market_regime == "risk_on" and (us10y_value < LOW_US10Y_THRESHOLD and oil_value < LOW_OIL_THRESHOLD):
        return "clean_risk_on"
    return "mixed"


def determine_risk_quality(market_regime, us10y, oil):
    us10y_value = _optional_float(us10y)
    oil_value = _optional_float(oil)

    if us10y_value is None or oil_value is None:
        return "neutral"

    oil_high = oil_value >= HIGH_OIL_THRESHOLD
    us10y_high = us10y_value >= HIGH_US10Y_THRESHOLD
    oil_low = oil_value < LOW_OIL_THRESHOLD
    us10y_low = us10y_value < LOW_US10Y_THRESHOLD

    if market_regime == "risk_on" and oil_low and us10y_low:
        return "clean"
    if market_regime == "risk_on" and (oil_high or us10y_high):
        return "fragile"
    if market_regime == "risk_off" and oil_high and us10y_high:
        return "stressed"
    return "neutral"


def build_today_context_v2(cross_asset_signal, us10y, oil):
    us10y_value = _optional_float(us10y)
    oil_value = _optional_float(oil)
    macro_detail = ""
    if us10y_value is not None and oil_value is not None:
        macro_detail = f" 금리 {us10y_value:.2f}%, 유가 ${oil_value:.2f} 수준이며"

    if cross_asset_signal == "risk_on_but_fragile":
        return f"Nasdaq, XLK, NVDA가 모두 상승했지만 risk-on 신호가 강해졌습니다.{macro_detail} 유동성 부담이 동시에 남아 있어 구조적으로는 완전히 편안한 구간은 아닙니다."
    if cross_asset_signal == "clean_risk_on":
        return f"Nasdaq, XLK, NVDA가 모두 상승했지만 risk-on 신호가 강해졌습니다.{macro_detail} 상대적으로 우호적인 위험선호 흐름이 유지되고 있습니다."
    if cross_asset_signal == "risk_off":
        return f"Nasdaq, XLK, NVDA가 모두 약세이며 risk-off 압력이 강화됐습니다.{macro_detail} 방어 성격이 강화된 구간입니다."
    return f"금리와 유가 신호가 엇갈리고 있습니다.{macro_detail} direction remains mixed and needs confirmation."


def build_interpretation_v2(cross_asset_signal):
    if cross_asset_signal == "risk_on_but_fragile":
        return "Risk-on 신호는 강하지만 금리와 유가가 동시에 부담을 주는 상태입니다."
    if cross_asset_signal == "clean_risk_on":
        return "Risk-on 신호가 강화되며 시장 구조는 비교적 우호적입니다."
    if cross_asset_signal == "risk_off":
        return "위험회피 압력이 강화되며 방어 성격이 우세합니다."
    return "시장 방향성이 엇갈리며 추세는 아직 단정하기 어렵습니다."


def build_risk_note_v2(us10y, oil):
    us10y_value = _optional_float(us10y)
    oil_value = _optional_float(oil)

    if us10y_value is None or oil_value is None:
        return "금리와 유가 데이터가 일부 비어 있어 거시 부담 수준은 제한적으로만 판단됩니다."
    if oil_value >= HIGH_OIL_THRESHOLD and us10y_value >= HIGH_US10Y_THRESHOLD:
        return "유가와 금리가 동시에 높은 구간으로, 밸류에이션 부담과 유동성 압력이 함께 작용할 수 있습니다."
    if oil_value >= HIGH_OIL_THRESHOLD:
        return "유가가 높은 구간으로, 인플레이션 재압력과 마진 부담을 함께 점검해야 합니다."
    if us10y_value >= HIGH_US10Y_THRESHOLD:
        return "금리가 높은 구간으로, 성장주와 장기 듀레이션 자산에 부담이 될 수 있습니다."
    return "거시 부담의 강도는 제한적이며, 추가 악화 여부를 계속 확인할 필요가 있습니다."


def build_one_line_takeaway_v2(market_regime, cross_asset_signal, risk_quality, short_term_status):
    if short_term_status == "accelerating_up":
        if cross_asset_signal == "risk_on_but_fragile" or risk_quality == "fragile":
            return "Risk-on 흐름은 강하지만 금리와 유가 부담이 남아 있어 단기적으로는 방어적인 관찰이 필요합니다."
        return "Risk-on 흐름이 강화되며 시장은 비교적 우호적인 상승 구간에 있습니다."
    if short_term_status == "rebound_up":
        return "최근 약세 이후 반등이 확인되지만 추세 지속성은 추가 확인이 필요합니다."
    if short_term_status == "accelerating_down":
        return "단기 하락 모멘텀이 강화되며 방어적 대응이 우선되는 구간입니다."
    if short_term_status == "weakening":
        return "상승 탄력이 약해지고 있어 추세의 지속성에 주의가 필요합니다."
    if short_term_status == "mixed":
        return "시장 내부 신호가 엇갈려 방향성 확인이 필요한 구간입니다."
    if cross_asset_signal == "risk_on_but_fragile" or (market_regime == "risk_on" and risk_quality == "fragile"):
        return "Risk-on은 유지되지만 구조적으로는 편안하지 않은 상태입니다."
    if cross_asset_signal == "clean_risk_on" or (market_regime == "risk_on" and risk_quality == "clean"):
        return "Risk-on 우위가 유지되며, 위험선호가 비교적 깔끔하게 이어지고 있습니다."
    if cross_asset_signal == "risk_off":
        return "위험회피가 우세한 환경으로, 방어적 접근이 우선입니다."
    return "시장과 거시 신호가 엇갈리며 방향성은 아직 완전히 정리되지 않았습니다."


def build_check_points_v2(data, market_regime, short_term_status):
    check_points = []
    us10y_value = _optional_float(data.get("us10y"))
    oil_value = _optional_float(data.get("oil"))

    trend_point = {
        "accelerating_up": "단기 상승 모멘텀이 3일 이상 이어지는지 확인",
        "rebound_up": "최근 반등이 추세 전환으로 이어지는지 확인",
        "mixed": "내부 신호가 다시 정렬되는지 확인",
        "weakening": "상승 탄력이 더 약해지는지 확인",
        "accelerating_down": "단기 하락 모멘텀이 더 강화되는지 확인",
        "unknown": "단기 추세 신호가 추가로 확인되는지 확인",
    }.get(short_term_status, "단기 추세 신호가 추가로 확인되는지 확인")
    check_points.append(trend_point)

    if us10y_value is not None and us10y_value >= HIGH_US10Y_THRESHOLD:
        check_points.append("미국 10년물 금리가 4.3% 이상에서 추가로 높아지는지 확인")
    if oil_value is not None and oil_value >= HIGH_OIL_THRESHOLD:
        check_points.append("유가가 95달러 이상에서 고착되는지 확인")

    if market_regime == "risk_on":
        check_points.append("risk-on 우위가 지수 전반으로 확산되는지 확인")
    elif market_regime == "risk_off":
        check_points.append("risk-off 압력이 방어주까지 확산되는지 확인")
    else:
        check_points.append("시장 방향성이 다시 정리되는지 확인")

    fallback_points = {
        "risk_on": [
            "대형주 리더십이 유지되는지 확인",
            "상승 업종의 확산이 이어지는지 확인",
        ],
        "risk_off": [
            "방어주 수급이 유지되는지 확인",
            "추가 하락 압력이 줄어드는지 확인",
        ],
        "mixed": [
            "다음 장에서 방향성이 정리되는지 확인",
            "기술주와 거시 신호가 다시 맞아떨어지는지 확인",
        ],
    }

    for point in fallback_points.get(market_regime, fallback_points["mixed"]):
        if len(check_points) >= 3:
            break
        if point not in check_points:
            check_points.append(point)

    while len(check_points) < 3:
        fallback = "추세 지속 여부" if market_regime == "risk_on" else "변동성 확대 여부" if market_regime == "risk_off" else "방향성 확인 여부"
        if fallback not in check_points:
            check_points.append(fallback)
        else:
            check_points.append(f"추가 관찰 포인트 {len(check_points) + 1}")

    return check_points[:3]


def build_market_snapshot(data):
    return {
        "sp500_pct": data.get("sp500_pct"),
        "nasdaq_pct": data.get("nasdaq_pct"),
        "xlk_pct": data.get("xlk_pct"),
        "tech_proxy_pct": data.get("tech_proxy_pct"),
        "tech_proxy_symbol": data.get("tech_proxy_symbol"),
        "nvda_pct": data.get("nvda_pct"),
        "us10y": data.get("us10y"),
        "oil": data.get("oil"),
    }


def build_structured_briefing(data):
    if not data.get("date"):
        return None

    regime = determine_market_regime(data) or "neutral"
    cross_asset_signal = determine_cross_asset_signal(regime, data.get("us10y"), data.get("oil"))
    risk_quality = determine_risk_quality(regime, data.get("us10y"), data.get("oil"))
    short_term_status = determine_short_term_status(data)
    headline = build_headline(regime)
    summary_statement = build_summary_statement(regime)
    today_context = build_today_context_v2(cross_asset_signal, data.get("us10y"), data.get("oil"))
    key_drivers = build_key_drivers(data)
    interpretation = build_interpretation_v2(cross_asset_signal)
    risk_note = build_risk_note_v2(data.get("us10y"), data.get("oil"))
    historical_context = build_historical_context(data, short_term_status)
    one_line_takeaway = build_one_line_takeaway_v2(regime, cross_asset_signal, risk_quality, short_term_status)
    briefing_sections = build_briefing_sections(
        data=data,
        headline=headline,
        summary_statement=summary_statement,
        key_drivers=key_drivers,
        cross_asset_signal=cross_asset_signal,
        risk_quality=risk_quality,
        interpretation=interpretation,
        risk_note=risk_note,
        market_regime=regime,
        historical_view=historical_context["historical_view"],
        short_term_status=short_term_status,
    )

    return {
        "date": data["date"],
        "market_regime": regime,
        "cross_asset_signal": cross_asset_signal,
        "risk_quality": risk_quality,
        "historical_context": historical_context,
        "headline": headline,
        "one_line_takeaway": one_line_takeaway,
        "summary_statement": summary_statement,
        "today_context": today_context,
        "interpretation": interpretation,
        "risk_note": risk_note,
        "briefing_sections": briefing_sections,
        "key_drivers": key_drivers,
        "market_levels": build_market_levels(data),
        "market_snapshot": build_market_snapshot(data),
    }


def main():
    briefing = build_structured_briefing_from_snapshot(use_cache=True)
    if briefing is None:
        input_path = get_input_path()
        if input_path is None:
            print("FAIL: no market data input file found")
            return

        data = load_market_data(input_path)
        briefing = build_structured_briefing(data)
        if briefing is None:
            print("FAIL: insufficient input data")
            return

    print(json.dumps(briefing, ensure_ascii=False, indent=2))
    save_structured_briefing(briefing)


if __name__ == "__main__":
    main()
