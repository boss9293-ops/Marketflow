import os
import sys
from pathlib import Path

from dotenv import load_dotenv


def _bootstrap_path() -> None:
    root = Path(__file__).resolve().parents[2]
    backend_dir = root / "backend"
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))


def _load_env() -> None:
    root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".env")
    load_dotenv(root / "backend" / ".env")


def _print_result(result) -> None:
    text = (result.text or "").replace("\n", " ").strip()
    preview = text[:120]
    print(
        f"provider={result.provider} model={result.model} latency_ms={result.latency_ms} "
        f"text='{preview}'"
    )


def main() -> int:
    _bootstrap_path()
    _load_env()

    from ai import gpt_client, gemini_client

    system = "You are a concise financial analyst."
    user = "Give one short neutral sentence about market risk management."

    failures = []

    try:
        gpt_res = gpt_client.generate_text(
            task="smoke_test_gpt",
            system=system,
            user=user,
            temperature=0.2,
            max_tokens=80,
        )
        if gpt_res.error:
            failures.append(f"GPT error: {gpt_res.error}")
        _print_result(gpt_res)
    except RuntimeError as exc:
        failures.append(f"GPT runtime error: {exc}")

    try:
        gemini_res = gemini_client.generate_text(
            task="smoke_test_gemini",
            system=system,
            user=user,
            temperature=0.2,
            max_tokens=80,
        )
        if gemini_res.error:
            failures.append(f"Gemini error: {gemini_res.error}")
        _print_result(gemini_res)
    except RuntimeError as exc:
        failures.append(f"Gemini runtime error: {exc}")

    if failures:
        print("AI smoke test failed:")
        for item in failures:
            print(f"- {item}")
        return 1

    print("AI smoke test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

