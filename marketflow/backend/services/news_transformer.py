from __future__ import annotations


def transform_headline(title: str) -> str:
    value = (title or "").split(" - ")[0].strip()

    # Lightweight normalization first.
    value = value.replace("Stocks fall", "\uc8fc\uac00 \ud558\ub77d")
    value = value.replace("Oil prices", "\uc720\uac00")
    value = value.replace("Treasury yields", "\uad6d\ucc44\uae08\ub9ac")
    value = value.replace("Fed", "\uc5f0\uc900")
    value = value.replace("Earnings", "\uc2e4\uc801")
    value = value.replace("guidance", "\uac00\uc774\ub358\uc2a4")
    value = value.replace("revenue", "\ub9e4\ucd9c")
    value = value.replace("forecast", "\uc804\ub9dd")

    lowered = value.lower().strip()
    ascii_only = all(ord(ch) < 128 for ch in value)
    if ascii_only:
        if "fed" in lowered:
            return "\uc5f0\uc900 \uad00\ub828 \ubc1c\uc5b8 \uc774\uc288"
        if "yield" in lowered or "treasury" in lowered or "rate" in lowered:
            return "\uae08\ub9ac\u00b7\uad6d\ucc44\uae08\ub9ac \ubcc0\ub3d9 \uc774\uc288"
        if "oil" in lowered or "crude" in lowered or "energy" in lowered:
            return "\uc720\uac00\u00b7\uc5d0\ub108\uc9c0 \ubcc0\ub3d9 \uc774\uc288"
        if any(k in lowered for k in ["earnings", "guidance", "revenue", "eps", "forecast"]):
            return "\uc2e4\uc801\u00b7\uac00\uc774\ub358\uc2a4 \uc774\uc288"
        if any(k in lowered for k in ["nvidia", "apple", "tesla", "microsoft", "amazon", "google", "meta"]):
            return "\uc8fc\uc694 \ube45\ud14c\ud06c \uc885\ubaa9 \uc774\uc288"
        if "sector" in lowered:
            return "\uc139\ud130 \ub85c\ud14c\uc774\uc158 \uc774\uc288"
        return "\uc2dc\uc7a5 \uc774\ubca4\ud2b8 \uc5c5\ub370\uc774\ud2b8"

    return value

