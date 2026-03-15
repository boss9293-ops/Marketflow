"""Test script to list available Gemini models"""
import os
from dotenv import load_dotenv

# Load .env
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

api_key = os.environ.get('GOOGLE_API_KEY', '')

if api_key:
    from google import genai
    
    client = genai.Client(api_key=api_key)
    
    print("Available models:")
    try:
        models = client.models.list()
        for model in models:
            print(f"  - {model.name}")
    except Exception as e:
        print(f"Error listing models: {e}")
else:
    print("No API key found")
