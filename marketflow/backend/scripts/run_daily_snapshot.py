import logging
import subprocess
import sys
from pathlib import Path
from datetime import datetime


def _root_dir() -> Path:
    return Path(__file__).resolve().parents[3]


def _ensure_dirs(base: Path) -> dict:
    paths = {
        "logs": base / "logs",
    }
    for p in paths.values():
        p.mkdir(parents=True, exist_ok=True)
    return paths


def _setup_logger(log_path: Path) -> logging.Logger:
    logger = logging.getLogger("run_daily_snapshot")
    logger.setLevel(logging.INFO)
    handler = logging.FileHandler(log_path, encoding="utf-8")
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
    handler.setFormatter(formatter)
    if not logger.handlers:
        logger.addHandler(handler)
    return logger


def _run_step(script: Path, logger: logging.Logger) -> int:
    try:
        logger.info("RUN %s", script.name)
        result = subprocess.run([sys.executable, str(script)], check=False)
        if result.returncode != 0:
            logger.error("FAIL %s rc=%s", script.name, result.returncode)
        else:
            logger.info("OK %s", script.name)
        return result.returncode
    except Exception as exc:
        logger.exception("ERROR %s %s", script.name, exc)
        return 1


def run_daily_snapshot():
    root = _root_dir()
    data_root = root / "marketflow_data"
    paths = _ensure_dirs(data_root)
    logger = _setup_logger(paths["logs"] / "run_daily_snapshot.log")
    logger.info("START %s", datetime.utcnow().isoformat() + "Z")

    scripts_dir = Path(__file__).resolve().parent
    steps = [
        scripts_dir / "ingest_prices_stooq.py",
        scripts_dir / "ingest_macro_fred.py",
        scripts_dir / "validate_snapshot.py",
    ]

    failures = 0
    for script in steps:
        if not script.exists():
            logger.error("MISSING %s", script)
            failures += 1
            continue
        rc = _run_step(script, logger)
        if rc != 0:
            failures += 1

    logger.info("END failures=%d", failures)
    return 0 if failures == 0 else 2


if __name__ == "__main__":
    sys.exit(run_daily_snapshot())
