"""
OpenAI GPT-4o-mini를 사용한 AI 시장 브리핑
Output: output/briefing.json
"""
import os
import sys
import io
import json
from datetime import datetime
from dotenv import load_dotenv

# Windows 한글 깨짐 방지
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

def generate_briefing():
    """Generate AI market briefing using OpenAI GPT-4o-mini"""
    
    api_key = os.environ.get('OPENAI_API_KEY', '')
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'output')
    
    # Load market data for context
    market = {}
    market_path = os.path.join(output_dir, 'market_data.json')
    if os.path.exists(market_path):
        with open(market_path, 'r', encoding='utf-8') as f:
            market = json.load(f)
    
    spy = market.get('indices', {}).get('SPY', {})
    qqq = market.get('indices', {}).get('QQQ', {})
    vix = market.get('volatility', {}).get('^VIX', {})
    bonds = market.get('bonds', {}).get('^TNX', {})
    
    spy_price = spy.get('price', 'N/A')
    spy_change = spy.get('change_pct', 0)
    qqq_price = qqq.get('price', 'N/A')
    qqq_change = qqq.get('change_pct', 0)
    vix_price = vix.get('price', 'N/A')
    bonds_price = bonds.get('price', 'N/A')
    
    if api_key:
        try:
            from openai import OpenAI
            
            client = OpenAI(api_key=api_key)
            
            prompt = f"""미국 주식시장 종합 분석 (한국어):

현재 시장 데이터:
- S&P 500 (SPY): {spy_price} ({spy_change:+.2f}%)
- NASDAQ 100 (QQQ): {qqq_price} ({qqq_change:+.2f}%)
- VIX: {vix_price}
- 10년물 국채: {bonds_price}%

다음 형식으로 마크다운 작성:

#  AI 시황 브리핑

## 1. 핵심 요약 (3문장)
오늘 시장의 주요 흐름을 간결하게 요약

## 2. 주요 시장 동인
- **연준 정책**: 금리 정책과 향후 전망
- **경제 지표**: 최근 발표 지표 분석
- **섹터 동향**: 강세/약세 섹터

## 3. 리스크 요인
- 지정학적 리스크
- 경제적 리스크
- 기술적 리스크

## 4. 투자 전략
- 포지션 제안 (공격적/균형/방어적)
- 주목 섹터
- 리스크 관리

## 5. 주목할 종목
상위 3개 종목과 투자 포인트
"""
            
            response = client.chat.completions.create(
                model="gpt-5.2",
                messages=[
                    {
                        "role": "system",
                        "content": "당신은 월스트리트 전문 애널리스트입니다. 간결하고 실용적인 투자 분석을 한국어로 제공합니다."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,
                max_completion_tokens=2500
            )
            
            content = response.choices[0].message.content
            
            # Extract summary
            lines = [line.strip() for line in content.split('\n') if line.strip()]
            summary_lines = []
            in_summary = False
            
            for line in lines:
                if '핵심 요약' in line or '요약' in line:
                    in_summary = True
                    continue
                if in_summary:
                    if line.startswith('#'):
                        break
                    if line and not line.startswith('-'):
                        summary_lines.append(line.strip('- ').strip())
                    if len(summary_lines) >= 3:
                        break
            
            summary = ' '.join(summary_lines[:3]) if summary_lines else "AI 시장 분석 완료"
            
            print(f"OpenAI Briefing generated: {len(content)} characters")
            
        except ImportError:
            content = """#  AI 시황 브리핑

** OpenAI 패키지 설치 필요**

다음 명령어를 실행하세요:
```bash
pip install openai --break-system-packages
```

설치 후 다시 실행하세요.
"""
            summary = "OpenAI 패키지 미설치"
            print(" OpenAI package not installed")
            print("   Run: pip install openai --break-system-packages")
            
        except Exception as e:
            content = f"""#  AI 시황 브리핑

** OpenAI API 오류**

오류: {str(e)}

**현재 시장:**
- S&P 500: {spy_price} ({spy_change:+.2f}%)
- NASDAQ: {qqq_price} ({qqq_change:+.2f}%)
- VIX: {vix_price}
- 10년물: {bonds_price}%

**해결 방법:**
1. `.env`에 `OPENAI_API_KEY` 확인
2. API 키 유효성 확인
3. OpenAI 크레딧 확인
"""
            summary = f"API 오류: {str(e)}"
            print(f" OpenAI API error: {e}")
            
    else:
        content = f"""#  AI 시황 브리핑

**현재 시장:**
- S&P 500: {spy_price} ({spy_change:+.2f}%)
- NASDAQ: {qqq_price} ({qqq_change:+.2f}%)
- VIX: {vix_price}
- 10년물: {bonds_price}%

---

** OpenAI API 키 설정 필요**

`.env` 파일에 추가:
```env
OPENAI_API_KEY=sk-proj-your-key-here
```

설정 후:
```bash
python scripts/briefing_ai.py
```
"""
        summary = "API 키 미설정"
        print("  OPENAI_API_KEY not found in .env")
    
    # Save to JSON
    os.makedirs(output_dir, exist_ok=True)
    
    result = {
        'timestamp': datetime.now().isoformat(),
        'content': content,
        'summary': summary,
        'model': 'gpt-5.2',
        'api_used': 'OpenAI' if api_key else 'None'
    }
    
    output_path = os.path.join(output_dir, 'briefing.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f" Briefing saved to: {output_path}")
    print(f" API: OpenAI GPT-5.2")

if __name__ == '__main__':
    print("=" * 60)
    print("OpenAI Market Briefing Generator")
    print("=" * 60)
    generate_briefing()
    print("=" * 60)
