import os
import sys
import io
from dotenv import load_dotenv

# Windows console encoding fix
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Load .env
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

api_key = os.environ.get('OPENAI_API_KEY')
if not api_key:
    print("❌ Error: OPENAI_API_KEY not found")
    sys.exit(1)

print(f"🔑 checking models for key: ...{api_key[-4:]}")

try:
    from openai import OpenAI
except ImportError:
    print("❌ Error: openai package not installed")
    sys.exit(1)

client = OpenAI(api_key=api_key)

try:
    models = client.models.list()
    model_ids = sorted([m.id for m in models])
    
    print(f"✅ Found {len(model_ids)} models. Top relevant:")
    
    relevant = []
    for m in model_ids:
        if "gpt" in m or "codex" in m or "o1-" in m:
            relevant.append(m)
            
    for m in relevant:
        print(f" - {m}")
        
except Exception as e:
    print(f"❌ API Error: {e}")
