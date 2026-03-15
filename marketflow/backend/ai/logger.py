import logging
import re
from typing import Optional


_LOGGER_NAME = "marketflow.ai"


def get_ai_logger() -> logging.Logger:
    logger = logging.getLogger(_LOGGER_NAME)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(message)s"))
    logger.addHandler(handler)
    logger.propagate = False
    return logger


def sanitize_error(error: Optional[str]) -> str:
    if not error:
        return ""
    text = str(error)
    text = re.sub(r"(key=)[^&\s]+", r"\1***", text)
    text = re.sub(r"(Bearer\s+)[A-Za-z0-9._\-]+", r"\1***", text)
    return text


def log_call(provider: str, model: str, task: str, latency_ms: int, ok: bool, error: Optional[str] = None) -> None:
    logger = get_ai_logger()
    status = "ok" if ok else "err"
    if ok:
        logger.info("provider=%s model=%s task=%s latency_ms=%s status=%s", provider, model, task, latency_ms, status)
    else:
        short_err = sanitize_error(error).splitlines()[0][:160]
        logger.warning(
            "provider=%s model=%s task=%s latency_ms=%s status=%s error=%s",
            provider,
            model,
            task,
            latency_ms,
            status,
            short_err,
        )
