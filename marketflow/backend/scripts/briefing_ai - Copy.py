"""
Generates AI market briefing using Google Gemini API.
Output: output/briefing.json
"""
import os, json
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

def generate_briefing():
    api_key = os.environ.get('OPENAI_API_KEY', '')
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'output')
    
    # Load market data for context
    market = {}
    market_path = os.path.join(output_dir, 'market_data.json')
    if os.path.exists(market_path):
        with open(market_path, 'r') as f:
            market = json.load(f)
    
    spy = market.get('indices', {}).get('SPY', {})
    qqq = market.get('indices', {}).get('QQQ', {})
    vix = market.get('volatility', {}).get('^VIX', {})
    bonds = market.get('bonds', {}).get('^TNX', {})
    
    spy_price = spy.get('price', 'N/A')
    spy_change = spy.get('change_pct', 0)
    vix_price = vix.get('price', 'N/A')
    bonds_price = bonds.get('price', 'N/A')
    
    if api_key:
        prompt = f"""미국 주식시장 오늘 종합 분석 (한국어):
- 핵심 요약 (3문장)
- 주요 시장 동인 (연준, 경제지표, 섹터)
- 리스크 요인
- 투자 전략
- 주목할 종목/섹터

현재 시장 데이터:
- SPY: {spy_price} ({spy_change:+.2f}%)
- VIX: {vix_price}
- 10Y Treasury: {bonds_price}%

간결하고 실용적으로 작성해주세요."""

        try:
            # Use google.genai with correct API pattern
            from google import genai
            from google.genai import types
            
            # Create client
            client = genai.Client(api_key=api_key)
            
            # Generate content - use models/gemini-flash-latest (confirmed available)
            response = client.models.generate_content(
                model='models/gemini-flash-latest',
                contents=prompt
            )
            
            content = response.text
            
        except Exception as e:
            # If gemini-flash-latest fails, try gemini-2.5-flash
            try:
                from google import genai
                client = genai.Client(api_key=api_key)
                
                response = client.models.generate_content(
                    model='models/gemini-2.5-flash',
                    contents=prompt
                )
                
                content = response.text
                
            except Exception as e2:
                content = f"""# ⚠️ AI Briefing Error

오류가 발생했습니다: {str(e2)}

**현재 시장 데이터:**
- S&P 500 (SPY): {spy_price} ({spy_change:+.2f}%)
- NASDAQ (QQQ): {qqq.get('price', 'N/A')} ({qqq.get('change_pct', 0):+.2f}%)
- VIX: {vix_price}
- 10Y Treasury: {bonds_price}%

Google Gemini API 키를 확인해주세요.
API 키가 올바른지, 그리고 Gemini API가 활성화되어 있는지 확인하세요."""
    else:
        content = f"""# 🤖 AI Market Briefing

**현재 시장 데이터:**
- S&P 500 (SPY): {spy_price} ({spy_change:+.2f}%)
- NASDAQ (QQQ): {qqq.get('price', 'N/A')} ({qqq.get('change_pct', 0):+.2f}%)
- VIX: {vix_price}
- 10Y Treasury: {bonds_price}%

**설정 필요:**
AI 기반 시장 브리핑을 활성화하려면 `GOOGLE_API_KEY` 환경 변수를 설정하세요.

.env 파일에 다음과 같이 추가:
```
GOOGLE_API_KEY=your_api_key_here
```
"""
    
    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(output_dir, 'briefing.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'content': content,
            'model': 'gemini-1.5-flash',
            'api_used': 'Google Gemini' if api_key else 'None'
        }, f, indent=2, ensure_ascii=False)
    
    print("AI Briefing generated (Google Gemini 1.5 Flash)")

if __name__ == '__main__':
    generate_briefing()
