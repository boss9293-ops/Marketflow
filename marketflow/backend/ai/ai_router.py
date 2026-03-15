from typing import Optional

from .ai_types import AIResult
from .providers import AIProvider
from . import gpt_client, gemini_client


def choose_provider(task: str, preferred: Optional[AIProvider] = None) -> AIProvider:
    if preferred:
        return preferred
    t = (task or "").lower()
    if "fast" in t or "brief" in t or "summary" in t:
        return AIProvider.GEMINI
    return AIProvider.GPT


def generate_text(
    task: str,
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
    max_tokens: int = 800,
    provider: Optional[AIProvider] = None,
) -> AIResult:
    selected = choose_provider(task=task, preferred=provider)
    if selected == AIProvider.GEMINI:
        return gemini_client.generate_text(
            task=task,
            system=system,
            user=user,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    return gpt_client.generate_text(
        task=task,
        system=system,
        user=user,
        temperature=temperature,
        max_tokens=max_tokens,
    )

