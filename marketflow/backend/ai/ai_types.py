from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class AIResult:
    provider: str
    model: str
    text: str
    usage: Optional[Dict[str, Any]] = None
    latency_ms: int = 0
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None
    cached: bool = False


@dataclass
class AIRequest:
    task: str
    system: str
    user: str
    temperature: float = 0.3
    max_tokens: int = 800
    metadata: Dict[str, Any] = field(default_factory=dict)

