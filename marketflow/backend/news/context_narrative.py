from __future__ import annotations

import json
import os
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

try:
    from backend.ai.ai_router import generate_text
    from backend.ai.providers import AIProvider
except Exception:
    from ai.ai_router import generate_text  # type: ignore
    from ai.providers import AIProvider  # type: ignore


def _repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _cache_file() -> str:
    return os.path.join(_repo_root(), "backend", "output", "cache", "context_narrative_cache.json")


def _context_news_file() -> str:
    return os.path.join(_repo_root(), "backend", "output", "cache", "context_news.json")

def _usage_file() -> str:
    return os.path.join(_repo_root(), "backend", "output", "cache", "context_narrative_usage.json")


def _read_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_json(path: str, payload: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "y", "on")


def _flags() -> Dict[str, Any]:
    # Scope freeze defaults
    return {
        "NARRATIVE_MODE": str(os.environ.get("NARRATIVE_MODE", "template")).strip().lower() or "template",
        "ENABLE_PREMIUM_LLM": _env_bool("ENABLE_PREMIUM_LLM", False),
        "ENABLE_PORTFOLIO_NARRATIVE": _env_bool("ENABLE_PORTFOLIO_NARRATIVE", False),
        "ENABLE_PORTFOLIO_PLACEHOLDER": _env_bool("ENABLE_PORTFOLIO_PLACEHOLDER", True),
    }


def _tone_from_sensors(sensor: Dict[str, Any], risk_token: Optional[str] = None, shock_flag: bool = False) -> str:
    lpi = str(((sensor.get("LPI") or {}).get("status") or "NA"))
    rpi = str(((sensor.get("RPI") or {}).get("status") or "NA"))
    vri = str(((sensor.get("VRI") or {}).get("status") or "NA"))
    xconf = str(((sensor.get("XCONF") or {}).get("status") or "Mixed"))

    rt = str(risk_token or "").upper()
    if shock_flag or rt in ("R4",):
        return "T4"
    if rt in ("R3",):
        return "T3"
    if vri == "Expanding" and lpi == "Tight":
        return "T3"
    if rpi == "Restrictive":
        return "T2"
    if xconf == "Stress":
        return "T2"
    if lpi == "NA" or rpi == "NA" or vri == "NA":
        return "T1"
    if len({lpi, rpi, vri}) >= 2:
        return "T1"
    return "T0"


def _tone_name(tone: str) -> str:
    return {
        "T0": "Calm",
        "T1": "Confirm",
        "T2": "Caution",
        "T3": "Defensive",
        "T4": "Shock Watch",
    }.get(tone, "Confirm")


def _tone_short_tags(sensor: Dict[str, Any]) -> List[str]:
    lpi = (sensor.get("LPI") or {}).get("status") or "NA"
    vri = (sensor.get("VRI") or {}).get("status") or "NA"
    return [f"유동성:{lpi}", f"변동성:{vri}"]


def _recent_business_dates(base_date: datetime, n: int = 3) -> List[str]:
    out: List[str] = []
    d = base_date
    while len(out) < n:
        d = d.replace(hour=0, minute=0, second=0, microsecond=0)
        if d.weekday() < 5:
            out.append(d.strftime("%Y-%m-%d"))
        d = d - timedelta(days=1)
    return out


def _load_recent_usage(base_date: datetime) -> Dict[str, Any]:
    usage = _read_json(_usage_file())
    by_date = usage.get("by_date") if isinstance(usage.get("by_date"), dict) else {}
    days = _recent_business_dates(base_date, 3)

    ids_3 = set()
    tags_3 = {}
    ids_last2 = set()
    ids_last1 = set()
    for i, dt in enumerate(days):
        item = by_date.get(dt) if isinstance(by_date.get(dt), dict) else {}
        for bid in item.get("ids", []) or []:
            ids_3.add(str(bid))
            if i < 2:
                ids_last2.add(str(bid))
            if i < 1:
                ids_last1.add(str(bid))
        for tg in item.get("tags", []) or []:
            t = str(tg)
            tags_3[t] = tags_3.get(t, 0) + 1
    return {
        "usage": usage,
        "ids_3": ids_3,
        "ids_last2": ids_last2,
        "ids_last1": ids_last1,
        "tags_3": tags_3,
    }


def _pick_block(
    *,
    candidates: List[Dict[str, str]],
    slot_key: str,
    date_key: str,
    tone: str,
    recent: Dict[str, Any],
) -> Dict[str, str]:
    if not candidates:
        return {"id": f"{slot_key}_fallback", "semanticTag": slot_key, "text": ""}

    def score(c: Dict[str, str], banned_ids: set) -> Optional[int]:
        cid = str(c.get("id", ""))
        if cid in banned_ids:
            return None
        tag = str(c.get("semanticTag", slot_key))
        # semanticTag repeated in last 3 days gets penalty
        penalty = int(recent["tags_3"].get(tag, 0)) * 3
        raw = int(hashlib.sha1(f"{date_key}:{tone}:{slot_key}:{cid}".encode("utf-8")).hexdigest()[:8], 16) % 100
        return raw - penalty

    for banned in (recent["ids_3"], recent["ids_last2"], recent["ids_last1"], set()):
        scored = []
        for c in candidates:
            s = score(c, banned)
            if s is not None:
                scored.append((s, c))
        if scored:
            scored.sort(key=lambda x: x[0], reverse=True)
            return scored[0][1]

    return candidates[0]


def _save_usage(
    *,
    base_date: datetime,
    selected_blocks: List[Dict[str, str]],
    recent_payload: Dict[str, Any],
) -> None:
    usage = recent_payload.get("usage") if isinstance(recent_payload.get("usage"), dict) else {}
    by_date = usage.get("by_date") if isinstance(usage.get("by_date"), dict) else {}
    today = base_date.strftime("%Y-%m-%d")
    by_date[today] = {
        "ids": [str(b.get("id", "")) for b in selected_blocks],
        "tags": [str(b.get("semanticTag", "")) for b in selected_blocks],
    }
    # keep only recent 3 business days
    keep = set(_recent_business_dates(base_date, 3))
    by_date = {k: v for k, v in by_date.items() if k in keep}
    _write_json(_usage_file(), {"updated_at": datetime.now(timezone.utc).isoformat(), "by_date": by_date})


def _build_block_library(sensor: Dict[str, Any], tone: str, structure_label: str) -> Dict[str, List[Dict[str, str]]]:
    lpi = (sensor.get("LPI") or {}).get("status") or "NA"
    rpi = (sensor.get("RPI") or {}).get("status") or "NA"
    vri = (sensor.get("VRI") or {}).get("status") or "NA"
    xconf = (sensor.get("XCONF") or {}).get("status") or "Mixed"
    ghedge = (sensor.get("GHEDGE") or {}).get("status") or "Mixed"

    return {
        "opening": [
            {"id": f"opening_{tone}_1", "semanticTag": "opening", "text": "오늘 시장은 조용하지만 완전히 안심할 단계는 아닙니다."},
            {"id": f"opening_{tone}_2", "semanticTag": "opening", "text": "지금 시장은 숨을 고르며 다음 방향을 확인하는 모습입니다."},
            {"id": f"opening_{tone}_3", "semanticTag": "opening", "text": "표면은 잔잔하지만 내부는 아직 확인 단계에 머물러 있습니다."},
        ],
        "lpi": [
            {"id": f"lpi_{lpi}_1", "semanticTag": "lpi", "text": f"지금 시중에 도는 돈의 흐름은 {lpi} 상태입니다."},
            {"id": f"lpi_{lpi}_2", "semanticTag": "lpi", "text": f"유동성은 현재 {lpi} 구간으로, 시장을 밀어주는 힘의 강도가 달라진 상태입니다."},
        ],
        "rpi": [
            {"id": f"rpi_{rpi}_1", "semanticTag": "rpi", "text": "금리는 자금의 비용입니다."},
            {"id": f"rpi_{rpi}_2", "semanticTag": "rpi", "text": f"지금 금리는 {rpi} 상태라 성장주나 레버리지에 부담 정도가 달라질 수 있습니다."},
            {"id": f"rpi_{rpi}_3", "semanticTag": "rpi", "text": f"이 말은 금리 환경이 {rpi} 쪽으로 기울어 자산 반응 속도에 차이를 만든다는 뜻입니다."},
        ],
        "vri": [
            {"id": f"vri_{vri}_1", "semanticTag": "vri", "text": "변동성은 시장의 긴장도입니다."},
            {"id": f"vri_{vri}_2", "semanticTag": "vri", "text": f"지금은 {vri} 단계라 움직임의 속도 관리가 중요해졌습니다."},
        ],
        "cross": [
            {"id": f"xconf_{xconf}_1", "semanticTag": "xconf", "text": "비트코인은 위험을 먼저 반영하는 자산입니다."},
            {"id": f"xconf_{xconf}_2", "semanticTag": "xconf", "text": f"지금은 유동성과 {xconf} 관계를 보이고 있어 확인 강도를 점검해야 합니다."},
            {"id": f"ghedge_{ghedge}_1", "semanticTag": "ghedge", "text": f"금은 현재 {ghedge} 흐름으로 나타나 방어 수요의 결을 보여줍니다."},
        ],
        "structure": [
            {"id": f"struct_{structure_label}_1", "semanticTag": "structure", "text": f"정리하면 시장 구조는 {structure_label} 단계이며, 확산이 받쳐주는지 확인이 필요합니다."},
            {"id": f"struct_{structure_label}_2", "semanticTag": "structure", "text": f"시장 구조 신호는 {structure_label} 수준으로, 추세와 확산의 일치 여부가 핵심입니다."},
        ],
    }


def _posture_line(tone: str) -> str:
    if tone == "T0":
        return "그래서 오늘은 크게 조정할 필요는 없어 보입니다."
    if tone == "T1":
        return "그래서 오늘은 조금 더 확인하는 자세가 좋겠습니다."
    if tone == "T2":
        return "그래서 오늘은 속도를 줄이고 노출을 점검하는 구간입니다."
    if tone == "T3":
        return "그래서 오늘은 방어를 우선으로 두는 편이 안전합니다."
    return "그래서 오늘은 노출을 재점검하고 긴장감을 유지해야 하는 구간입니다."


def _news_quality_from_articles(articles: List[Dict[str, Any]]) -> str:
    now = datetime.now(timezone.utc)
    fresh = 0
    for a in articles:
        ts = str(a.get("published_at") or "")
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            hours = (now - dt).total_seconds() / 3600.0
            if hours <= 24:
                fresh += 1
        except Exception:
            continue
    if fresh >= 4:
        return "Fresh"
    if fresh >= 1:
        return "Partial"
    return "Stale"


def _build_template_narrative(context_news: Dict[str, Any], tone: str) -> Dict[str, Any]:
    sensor = context_news.get("sensor_snapshot") or {}
    lpi = (sensor.get("LPI") or {}).get("status") or "NA"
    rpi = (sensor.get("RPI") or {}).get("status") or "NA"
    vri = (sensor.get("VRI") or {}).get("status") or "NA"
    xconf = (sensor.get("XCONF") or {}).get("status") or "Mixed"
    ghedge = (sensor.get("GHEDGE") or {}).get("status") or "Mixed"

    articles = context_news.get("articles") or []
    news_quality = _news_quality_from_articles(articles)
    top_titles = [
        {
            "title": str(a.get("title") or ""),
            "publisher": str(a.get("publisher") or "Unknown"),
            "published_at": str(a.get("published_at") or ""),
            "url": str(a.get("url") or ""),
        }
        for a in articles[:2]
    ]

    tone_name = _tone_name(tone)
    headline = f"오늘의 시장 톤: {tone_name}"
    tone_tags = _tone_short_tags(sensor)
    structure_label = "중립"
    # lightweight structure proxy for now (no portfolio coupling)
    mps = (sensor.get("MPS") or {}).get("value")
    try:
        mpsv = float(mps)
        if mpsv >= 70:
            structure_label = "약"
        elif mpsv <= 35:
            structure_label = "강"
    except Exception:
        structure_label = "중립"

    now = datetime.now(timezone.utc)
    date_key = now.strftime("%Y-%m-%d")
    recent = _load_recent_usage(now)
    library = _build_block_library(sensor, tone, structure_label)
    selected_blocks = [
        _pick_block(candidates=library["opening"], slot_key="opening", date_key=date_key, tone=tone, recent=recent),
        _pick_block(candidates=library["lpi"], slot_key="lpi", date_key=date_key, tone=tone, recent=recent),
        _pick_block(candidates=library["rpi"], slot_key="rpi", date_key=date_key, tone=tone, recent=recent),
        _pick_block(candidates=library["vri"], slot_key="vri", date_key=date_key, tone=tone, recent=recent),
        _pick_block(candidates=library["cross"], slot_key="cross", date_key=date_key, tone=tone, recent=recent),
        _pick_block(candidates=library["structure"], slot_key="structure", date_key=date_key, tone=tone, recent=recent),
    ]
    _save_usage(base_date=now, selected_blocks=selected_blocks, recent_payload=recent)

    snapshot_lines = [
        f"유동성:{lpi} · 금리:{rpi}",
        f"변동성:{vri} · 확인:{xconf}",
        f"헤지:{ghedge}",
    ]
    blocks = [b.get("text", "") for b in selected_blocks if b.get("text")]
    blocks.append(_posture_line(tone))
    if top_titles:
        blocks.append("오늘 뉴스 흐름은 센서 해석의 배경 근거로만 연결합니다.")

    target_len = {"T0": 8, "T1": 9, "T2": 10, "T3": 11, "T4": 12}.get(tone, 9)
    if len(blocks) < target_len:
        blocks = blocks + [
            "이 말은 시장을 한 방향으로 단정하기보다 확인하면서 접근해야 한다는 뜻입니다.",
            "쉽게 말해 오늘은 속도와 균형을 같이 관리하는 날입니다.",
            "결론은 센서가 먼저이고 뉴스는 배경입니다.",
        ]
    blocks = blocks[:target_len]

    return {
        "tone": tone,
        "tone_name": tone_name,
        "tone_short_tags": tone_tags,
        "mode": "template",
        "headline": headline,
        "snapshot_lines": snapshot_lines,
        "blocks": blocks,
        "news_quotes": top_titles,
        "news_quality": news_quality,
        "sources": [
            f"Yahoo Finance ({i['publisher']}, {i['published_at'][:16].replace('T', ' ')})"
            for i in top_titles
        ],
    }


def _provider_from_env() -> Optional[AIProvider]:
    provider = str(os.environ.get("LLM_PROVIDER", "openai")).strip().lower()
    if provider == "openai":
        return AIProvider.GPT
    if provider == "gemini":
        return AIProvider.GEMINI
    if provider == "claude":
        return None
    return AIProvider.GPT


def _llm_enabled() -> bool:
    fl = _flags()
    return fl["NARRATIVE_MODE"] == "llm" and bool(fl["ENABLE_PREMIUM_LLM"])


def _build_llm_narrative(template_payload: Dict[str, Any], region: str) -> Dict[str, Any]:
    provider = _provider_from_env()
    if provider is None:
        raise RuntimeError("LLM_PROVIDER=claude is not configured in backend providers.")

    prompt = {
        "headline": template_payload.get("headline"),
        "snapshot_lines": template_payload.get("snapshot_lines"),
        "blocks": template_payload.get("blocks"),
        "sources": template_payload.get("sources"),
    }
    system = (
        "You write institutional Korean market context briefs. "
        "No predictions, no buy/sell, no price targets. "
        "Use calm analytical tone."
    )
    user = (
        "아래 템플릿을 더 읽기 좋게 8~12문장으로 정리하세요. "
        "반드시 센서 근거를 유지하고 행동 가이드는 포트 관리 표현만 사용하세요.\n\n"
        + json.dumps(prompt, ensure_ascii=False)
    )
    res = generate_text(
        task="context_brief",
        system=system,
        user=user,
        temperature=0.2,
        max_tokens=900,
        provider=provider,
    )
    if res.error:
        raise RuntimeError(res.error)
    text = (res.text or "").strip()
    lines = [ln.strip(" -") for ln in text.splitlines() if ln.strip()]
    if not lines:
        raise RuntimeError("Empty LLM response")
    return {
        **template_payload,
        "mode": "premium_ai",
        "llm_provider": res.provider,
        "llm_model": res.model,
        "llm_text": text,
        "llm_lines": lines[:12],
    }


def _cache_key(date_str: str, region: str, tone: str) -> str:
    return f"{date_str}:{region}:{tone}"


def build_context_narrative(
    *,
    region: str = "us",
    risk_token: Optional[str] = None,
    shock_flag: bool = False,
    premium: bool = False,
    force: bool = False,
) -> Dict[str, Any]:
    fl = _flags()
    now = datetime.now(timezone.utc)
    date_key = now.strftime("%Y-%m-%d")
    context_news = _read_json(_context_news_file())
    sensors = context_news.get("sensor_snapshot") or {}
    tone = _tone_from_sensors(sensors, risk_token=risk_token, shock_flag=shock_flag)
    cache_key = _cache_key(date_key, region, tone)
    cache = _read_json(_cache_file())
    cached = (cache.get("items") or {}).get(cache_key) if isinstance(cache.get("items"), dict) else None
    if isinstance(cached, dict) and not force:
        cached_mode = str(cached.get("mode", "template"))
        wants_llm = _llm_enabled() and (premium or tone in ("T3", "T4"))
        if not wants_llm or cached_mode in ("premium_ai", "template_fallback"):
            return {**cached, "cache_hit": True}

    template_payload = _build_template_narrative(context_news, tone)
    should_try_llm = _llm_enabled() and (
        force or tone in ("T3", "T4") or premium
    )

    out = template_payload
    llm_error = None
    if should_try_llm:
        try:
            out = _build_llm_narrative(template_payload, region)
        except Exception as e:
            llm_error = str(e)
            out = {**template_payload, "mode": "template_fallback"}

    payload = {
        **out,
        "date": date_key,
        "region": region,
        "news_status": context_news.get("news_status"),
        "validation_status": context_news.get("validation_status", "Watch"),
        "validation_snapshot_date": context_news.get("validation_snapshot_date"),
        "snapshot_date": (sensors.get("snapshot_date")),
        "last_generated": now.isoformat(),
        "cache_key": cache_key,
        "cache_ttl_hours": 24,
        "cache_hit": False,
        "llm_error": llm_error,
        "feature_flags": fl,
        "portfolio_placeholder_enabled": bool(fl["ENABLE_PORTFOLIO_PLACEHOLDER"]),
        "portfolio_narrative_enabled": bool(fl["ENABLE_PORTFOLIO_NARRATIVE"]),
        "portfolio_placeholder_message": "현재는 시장 센서 기반 브리핑만 제공합니다. 포트폴리오 연동은 다음 릴리즈에서 활성화됩니다.",
    }

    items = cache.get("items") if isinstance(cache.get("items"), dict) else {}
    items[cache_key] = payload
    # TTL by date: drop non-today entries
    items = {k: v for k, v in items.items() if str(v.get("date")) == date_key}
    _write_json(_cache_file(), {"updated_at": now.isoformat(), "items": items})
    _write_json(os.path.join(_repo_root(), "backend", "output", "cache", "context_narrative.json"), payload)
    return payload
