"""
CLI Validator for RICE Prompts.
Loads cache data, builds contexts, generates prompts, and calls AI models.
"""

import os
import sys
import json
import time
from typing import Dict, Any

# Add backend root to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from ai.rice_templates import build_rice_A_dashboard, build_rice_B_risk
from ai.context_builders import build_context_for_A, build_context_for_B

# Import clients as functions
try:
    from ai.gemini_client import generate_text as gemini_generate
    from ai.gpt_client import generate_text as gpt_generate
except ImportError:
    print("Warning: Could not import AI clients. Ensure backend/ai/gemini_client.py exists.")
    gemini_generate = None
    gpt_generate = None

CACHE_DIR = os.path.join(os.path.dirname(__file__), '..', 'output', 'cache')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'output')

def load_json(filename: str) -> Dict[str, Any]:
    path = os.path.join(CACHE_DIR, filename)
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    print(f"Warning: {filename} not found in {CACHE_DIR}")
    return {}

def main():
    print("=== RICE Prompt Preview Validator ===")
    
    # 1. Load Data
    overview = load_json('overview.json')
    hot_zone = load_json('hot_zone.json')
    sector_rotation = load_json('sector_rotation.json')
    ml_prediction = load_json('ml_prediction.json')
    alerts = load_json('alerts_recent.json')

    # 2. Build Contexts
    ctx_a = build_context_for_A(overview, hot_zone, sector_rotation, alerts)
    ctx_b = build_context_for_B(overview, ml_prediction, hot_zone)

    print("\n--- Context A (Dashboard) Summary ---")
    print(json.dumps(ctx_a, indent=2, ensure_ascii=False))

    print("\n--- Context B (Risk) Summary ---")
    print(json.dumps(ctx_b, indent=2, ensure_ascii=False))

    # 3. Build Prompts
    pack_a = build_rice_A_dashboard(ctx_a)
    pack_b = build_rice_B_risk(ctx_b)

    print("\n--- Prompt A Preview (First 400 chars) ---")
    print(f"System: {pack_a.system_prompt[:100]}...")
    print(f"User: {pack_a.user_prompt[:400]}...")

    print("\n--- Prompt B Preview (First 400 chars) ---")
    print(f"System: {pack_b.system_prompt[:100]}...")
    print(f"User: {pack_b.user_prompt[:400]}...")

    # 4. Call AI Models
    # A: Gemini
    if gemini_generate:
        print("\n>>> Calling Gemini for Task A (Dashboard)...")
        start = time.time()
        try:
            res_a = gemini_generate(
                task="rice_preview_A",
                system=pack_a.system_prompt,
                user=pack_a.user_prompt,
                temperature=0.3,
                max_tokens=800
            )
            
            print(f"Gemini Response ({time.time() - start:.2f}s):")
            # AIResult object has .text
            text_a = res_a.text if res_a and res_a.text else "No response text."
            print(text_a[:200] + "...")
            
            with open(os.path.join(OUTPUT_DIR, 'ai_preview_A.json'), 'w', encoding='utf-8') as f:
                json.dump({'prompt': pack_a.__dict__, 'response': text_a}, f, ensure_ascii=False, indent=2)
                
        except Exception as e:
            print(f"Gemini Call Failed: {e}")
    else:
        print("Skipping Gemini call (Client not found)")

    # B: GPT
    if gpt_generate:
        print("\n>>> Calling GPT for Task B (Risk)...")
        start = time.time()
        try:
            res_b = gpt_generate(
                task="rice_preview_B",
                system=pack_b.system_prompt,
                user=pack_b.user_prompt,
                temperature=0.3,
                max_tokens=800
            )
            
            print(f"GPT Response ({time.time() - start:.2f}s):")
            text_b = res_b.text if res_b and res_b.text else "No response text."
            print(text_b[:200] + "...")

            with open(os.path.join(OUTPUT_DIR, 'ai_preview_B.json'), 'w', encoding='utf-8') as f:
                json.dump({'prompt': pack_b.__dict__, 'response': text_b}, f, ensure_ascii=False, indent=2)

        except Exception as e:
            print(f"GPT Call Failed: {e}")
    else:
        print("Skipping GPT call (Client not found)")

if __name__ == "__main__":
    main()
