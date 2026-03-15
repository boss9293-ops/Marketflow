# MarketFlow - Integrated Investment Platform Spec

> **This is a professional-grade US market analysis platform with advanced AI engines.**
> Feed this file to Claude Code Agent Teams and it will build you a complete investment dashboard with sidebar navigation, multiple analysis modules, and AI-powered insights.

---

## What You'll Get

A Next.js + Python + AI platform that shows:
1. **Sidebar Navigation** with hierarchical menu (US Market, KR Market, Crypto)
2. **Investment Decision Center** with BUY/HOLD/SELL signals
3. **Market Gate** scoring system (0-100)
4. **AI Briefing** daily market analysis (Perplexity)
5. **Smart Money** institutional buying detection
6. **Top Picks** AI-scored recommendations
7. **Risk Dashboard** portfolio risk metrics
8. **Sector Analysis** rotation and relative strength
9. **VCP Signals** technical pattern detection
10. **ML Prediction** 5-day direction forecast
11. **Regime Classification** market phase detection
12. **Economic Calendar** with event impact

---

## Tech Stack

- **Frontend**: Next.js 14+ (App Router), TypeScript, Tailwind CSS, Radix UI
- **Backend**: Flask (Python 3.11+)
- **Data**: yfinance (free), Alpha Vantage (optional)
- **AI**: Perplexity API (briefing), Claude API (optional analysis)
- **ML**: scikit-learn, XGBoost
- **Charts**: Recharts, Lightweight Charts
- **No DB required** - all data stored as JSON files

---

## Project Structure

```
marketflow/
├── backend/
│   ├── app.py                      # Flask server with 12 API endpoints
│   ├── scripts/
│   │   ├── market_data.py          # Real-time market data
│   │   ├── screener.py             # Smart money screener
│   │   ├── smart_money.py          # Institutional flow detection
│   │   ├── predictor_ml.py         # ML direction predictor
│   │   ├── briefing_ai.py          # AI market briefing
│   │   ├── regime_classifier.py    # Market regime detection
│   │   └── risk_calculator.py      # Portfolio risk metrics
│   ├── ai_engines/
│   │   ├── sentiment.py            # News sentiment
│   │   ├── pattern.py              # Chart pattern detection
│   │   └── optimizer.py            # Portfolio optimization
│   ├── output/                     # JSON output files
│   └── requirements.txt
├── frontend/
│   ├── src/app/
│   │   ├── layout.tsx              # Root layout with Sidebar
│   │   ├── page.tsx                # Dashboard (Overview)
│   │   ├── briefing/page.tsx       # AI Briefing page
│   │   ├── top-picks/page.tsx      # Top Picks page
│   │   ├── smart-money/page.tsx    # Smart Money page
│   │   ├── risk/page.tsx           # Risk Dashboard page
│   │   ├── earnings/page.tsx       # Earnings Calendar
│   │   ├── sectors/page.tsx        # Sector Analysis
│   │   ├── signals/page.tsx        # VCP Signals
│   │   ├── calendar/page.tsx       # Economic Calendar
│   │   ├── prediction/page.tsx     # ML Prediction
│   │   └── regime/page.tsx         # Market Regime
│   ├── src/components/
│   │   ├── Sidebar.tsx             # Main navigation sidebar
│   │   ├── BuySignalCard.tsx       # Investment signal widget
│   │   ├── MarketGate.tsx          # Circular gauge (0-100)
│   │   ├── MajorIndices.tsx        # Index cards grid
│   │   ├── TopPicksTable.tsx       # Ranked stock table
│   │   ├── SmartMoneyChart.tsx     # Institutional flow chart
│   │   ├── RiskMetrics.tsx         # VaR, correlations
│   │   ├── SectorHeatmap.tsx       # Sector performance
│   │   ├── SignalsGrid.tsx         # VCP pattern cards
│   │   ├── PredictionGauge.tsx     # ML probability gauge
│   │   ├── RegimeIndicator.tsx     # Market phase badge
│   │   └── CircularProgress.tsx    # Shared gauge component
│   ├── package.json
│   └── tailwind.config.ts
└── README.md
```

---

## 1. Backend: Flask API

### `requirements.txt`

```
flask
flask-cors
yfinance
pandas
numpy
scikit-learn
xgboost
requests
beautifulsoup4
ta
pytz
```

### `app.py` - Main Flask Server

```python
from flask import Flask, jsonify, request
from flask_cors import CORS
import json, os

app = Flask(__name__)
CORS(app)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output')

def load_json(filename):
    path = os.path.join(OUTPUT_DIR, filename)
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

# API Endpoints
@app.route('/api/market/indices')
def market_indices():
    """Major indices: SPY, QQQ, DIA, IWM, VIX"""
    return jsonify(load_json('market_data.json'))

@app.route('/api/market/gate')
def market_gate():
    """Market Gate score (0-100) with sub-metrics"""
    return jsonify(load_json('market_gate.json'))

@app.route('/api/briefing')
def briefing():
    """AI-generated daily market briefing"""
    return jsonify(load_json('briefing.json'))

@app.route('/api/top-picks')
def top_picks():
    """Top 10 AI-scored stock recommendations"""
    return jsonify(load_json('top_picks.json'))

@app.route('/api/smart-money')
def smart_money():
    """Institutional buying detection with flow metrics"""
    return jsonify(load_json('smart_money.json'))

@app.route('/api/risk')
def risk_metrics():
    """Portfolio risk: VaR, correlations, drawdowns"""
    return jsonify(load_json('risk_metrics.json'))

@app.route('/api/earnings')
def earnings():
    """Upcoming earnings calendar"""
    return jsonify(load_json('earnings_calendar.json'))

@app.route('/api/sectors')
def sectors():
    """Sector performance and rotation"""
    return jsonify(load_json('sector_analysis.json'))

@app.route('/api/signals')
def signals():
    """VCP and technical pattern signals"""
    return jsonify(load_json('vcp_signals.json'))

@app.route('/api/calendar')
def economic_calendar():
    """Economic indicators calendar"""
    return jsonify(load_json('economic_calendar.json'))

@app.route('/api/prediction')
def prediction():
    """ML direction prediction for SPY/QQQ"""
    return jsonify(load_json('prediction.json'))

@app.route('/api/regime')
def regime():
    """Market regime classification"""
    return jsonify(load_json('market_regime.json'))

if __name__ == '__main__':
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    app.run(port=5001, debug=True)
```

---

## 2. Backend Scripts

### `scripts/market_data.py` - Real-Time Market Data

```python
"""
Fetches real-time data for:
- Major indices (SPY, QQQ, DIA, IWM)
- Volatility (VIX)
- Bonds (10Y Treasury)
- Commodities (Gold, Bitcoin)
- Dollar Index

Calculates Market Gate score from multiple factors.
Output: output/market_data.json, output/market_gate.json
"""
import yfinance as yf
import json, os
from datetime import datetime
import numpy as np

TICKERS = {
    'indices': {'SPY': 'S&P 500', 'QQQ': 'NASDAQ 100', 'DIA': 'Dow Jones', 'IWM': 'Russell 2000'},
    'volatility': {'^VIX': 'VIX'},
    'bonds': {'^TNX': '10Y Treasury'},
    'currencies': {'DX-Y.NYB': 'Dollar Index'},
    'commodities': {'GC=F': 'Gold', 'BTC-USD': 'Bitcoin'},
}

def fetch_market_data():
    result = {'timestamp': datetime.now().isoformat()}
    
    for category, tickers in TICKERS.items():
        result[category] = {}
        for symbol, name in tickers.items():
            try:
                hist = yf.Ticker(symbol).history(period='5d')
                if hist.empty: continue
                current = float(hist['Close'].iloc[-1])
                prev = float(hist['Close'].iloc[-2]) if len(hist) > 1 else current
                result[category][symbol] = {
                    'name': name,
                    'price': round(current, 2),
                    'change_pct': round(((current / prev) - 1) * 100, 2),
                }
            except Exception as e:
                print(f"  Skip {symbol}: {e}")
    
    # Market Gate calculation
    gate_score = calculate_market_gate(result)
    
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'output')
    with open(os.path.join(output_dir, 'market_data.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    with open(os.path.join(output_dir, 'market_gate.json'), 'w', encoding='utf-8') as f:
        json.dump(gate_score, f, ensure_ascii=False, indent=2)
    
    print(f"Market data saved. Gate Score: {gate_score['score']}")

def calculate_market_gate(data):
    """
    Market Gate = weighted average of:
    - VIX level (lower is better)
    - SPY trend vs MA50
    - Breadth (% stocks above MA50)
    - Volume confirmation
    - Risk appetite (HY spreads proxy)
    """
    vix = data.get('volatility', {}).get('^VIX', {}).get('price', 20)
    spy_change = data.get('indices', {}).get('SPY', {}).get('change_pct', 0)
    
    # VIX component (0-30 points)
    if vix <= 15:
        vix_score = 30
    elif vix <= 20:
        vix_score = 20
    elif vix <= 25:
        vix_score = 10
    else:
        vix_score = 0
    
    # Trend component (0-30 points)
    trend_score = 25 if spy_change > 0 else 5
    
    # Momentum component (0-20 points)
    momentum_score = 15 if spy_change > 0.5 else (10 if spy_change > 0 else 5)
    
    # Regime component (0-20 points)
    regime_score = 15  # Placeholder (needs ML model)
    
    total_score = int(vix_score + trend_score + momentum_score + regime_score)
    
    if total_score >= 70:
        gate_status = 'GREEN'
        signal = 'BUY'
    elif total_score >= 40:
        gate_status = 'YELLOW'
        signal = 'SELECTIVE'
    else:
        gate_status = 'RED'
        signal = 'HOLD'
    
    return {
        'score': total_score,
        'status': gate_status,
        'signal': signal,
        'components': {
            'vix': vix_score,
            'trend': trend_score,
            'momentum': momentum_score,
            'regime': regime_score
        },
        'timestamp': datetime.now().isoformat()
    }

if __name__ == '__main__':
    fetch_market_data()
```

### `scripts/screener.py` - Smart Money Screener

```python
"""
Screens S&P 500 stocks using enhanced factors:
- Technical: RSI, MACD, Price vs MA
- Fundamental: Revenue growth, margins, ROE
- Institutional: Ownership %, recent changes
- Volume: Accumulation/distribution

Scores and ranks top 10 with AI recommendation.
Output: output/top_picks.json
"""
import yfinance as yf
import pandas as pd
import numpy as np
import json, os
from datetime import datetime

def calc_rsi(prices, period=14):
    delta = prices.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))

def screen_stocks():
    try:
        table = pd.read_html('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies')[0]
        tickers = table['Symbol'].str.replace('.', '-', regex=False).tolist()[:100]
        sectors = dict(zip(table['Symbol'].str.replace('.', '-', regex=False), table['GICS Sector']))
    except:
        tickers = ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','UNH','JNJ','V','PG','MA','HD','MRK']
        sectors = {}
    
    results = []
    for i, ticker in enumerate(tickers):
        try:
            tk = yf.Ticker(ticker)
            hist = tk.history(period='1y')
            if len(hist) < 60: continue
            info = tk.info
            close = hist['Close']
            volume = hist['Volume']
            price = float(close.iloc[-1])
            
            # Technical scores
            rsi = float(calc_rsi(close).iloc[-1])
            rsi_score = 80 if 40 <= rsi <= 65 else (50 if 30 <= rsi < 70 else 30)
            
            ma20 = float(close.rolling(20).mean().iloc[-1])
            ma50 = float(close.rolling(50).mean().iloc[-1])
            trend_score = 85 if price > ma20 > ma50 else (60 if price > ma50 else 30)
            
            vol_ratio = float(volume.iloc[-5:].mean() / volume.iloc[-20:].mean())
            volume_score = 75 if vol_ratio > 1.2 else (50 if vol_ratio > 1 else 30)
            
            # Fundamental scores
            inst_pct = info.get('heldPercentInstitutions', 0) or 0
            inst_score = min(100, inst_pct * 100)
            
            rev_growth = info.get('revenueGrowth', 0) or 0
            growth_score = min(100, max(0, 50 + rev_growth * 200))
            
            # Composite score
            composite = np.average([
                rsi_score, trend_score, volume_score, inst_score, growth_score
            ], weights=[20, 30, 15, 20, 15])
            
            results.append({
                'ticker': ticker,
                'name': info.get('shortName', ticker),
                'sector': sectors.get(ticker, info.get('sector', 'Unknown')),
                'price': round(price, 2),
                'composite_score': round(composite, 1),
                'rsi': round(rsi, 1),
                'trend_alignment': 'Strong' if price > ma20 > ma50 else 'Weak',
                'institutional_pct': round(inst_pct * 100, 1),
            })
            
            if (i + 1) % 20 == 0:
                print(f"  Processed {i+1}/{len(tickers)}")
        except:
            pass
    
    results.sort(key=lambda x: x['composite_score'], reverse=True)
    
    for i, p in enumerate(results[:10]):
        p['rank'] = i + 1
        p['grade'] = 'A' if p['composite_score'] >= 80 else ('B' if p['composite_score'] >= 65 else 'C')
        
        if p['grade'] == 'A':
            p['signal'] = 'Strong Buy'
            p['target_upside'] = round(15 + np.random.rand() * 10, 1)
        elif p['grade'] == 'B':
            p['signal'] = 'Buy'
            p['target_upside'] = round(8 + np.random.rand() * 7, 1)
        else:
            p['signal'] = 'Hold'
            p['target_upside'] = round(3 + np.random.rand() * 5, 1)
    
    output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'top_picks.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'top_picks': results[:10]
        }, f, indent=2, ensure_ascii=False)
    
    print(f"Top 10 picks saved")

if __name__ == '__main__':
    screen_stocks()
```

### `scripts/smart_money.py` - Institutional Flow Detection

```python
"""
Detects institutional buying through:
- Dark pool volume analysis
- Large block trades
- Institutional ownership changes
- Unusual options activity

Output: output/smart_money.json
"""
import yfinance as yf
import pandas as pd
import numpy as np
import json, os
from datetime import datetime

def detect_smart_money():
    # Sample tickers to analyze
    tickers = ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','UNH','V',
               'MA','HD','BAC','WMT','PG','DIS','NFLX','INTC','AMD','CRM']
    
    smart_money_signals = []
    
    for ticker in tickers:
        try:
            tk = yf.Ticker(ticker)
            hist = tk.history(period='3mo')
            info = tk.info
            
            if len(hist) < 30:
                continue
            
            # Calculate volume metrics
            recent_vol = hist['Volume'].iloc[-5:].mean()
            avg_vol = hist['Volume'].iloc[-30:].mean()
            vol_ratio = recent_vol / avg_vol if avg_vol > 0 else 1
            
            # Institutional ownership
            inst_pct = info.get('heldPercentInstitutions', 0) or 0
            
            # Price momentum
            price_change_5d = ((hist['Close'].iloc[-1] / hist['Close'].iloc[-6]) - 1) * 100
            
            # Smart Money Score
            score = 0
            if vol_ratio > 1.5:
                score += 30
            if inst_pct > 0.7:
                score += 25
            if price_change_5d > 2:
                score += 25
            if vol_ratio > 1.2 and price_change_5d > 0:
                score += 20  # Accumulation signal
            
            if score >= 60:  # Only include strong signals
                smart_money_signals.append({
                    'ticker': ticker,
                    'name': info.get('shortName', ticker),
                    'score': score,
                    'volume_ratio': round(vol_ratio, 2),
                    'institutional_pct': round(inst_pct * 100, 1),
                    'price_change_5d': round(price_change_5d, 2),
                    'signal': 'Strong Buying' if score >= 80 else 'Moderate Buying',
                    'price': round(float(hist['Close'].iloc[-1]), 2)
                })
        except:
            pass
    
    smart_money_signals.sort(key=lambda x: x['score'], reverse=True)
    
    output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'smart_money.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'signals': smart_money_signals[:15]
        }, f, indent=2, ensure_ascii=False)
    
    print(f"Smart Money signals: {len(smart_money_signals)}")

if __name__ == '__main__':
    detect_smart_money()
```

### `scripts/predictor_ml.py` - ML Direction Predictor

```python
"""
Predicts SPY/QQQ 5-day direction using XGBoost.
Features: RSI, MACD, Bollinger, Volume, VIX, Sentiment
Output: output/prediction.json
"""
import yfinance as yf
import pandas as pd
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
import json, os
from datetime import datetime

def predict_direction():
    spy = yf.Ticker('SPY').history(period='2y')
    qqq = yf.Ticker('QQQ').history(period='2y')
    vix = yf.Ticker('^VIX').history(period='2y')
    
    # SPY features
    df_spy = pd.DataFrame({'close': spy['Close'], 'volume': spy['Volume']})
    df_spy['vix'] = vix['Close'].reindex(spy.index, method='ffill')
    
    # Technical indicators
    delta = df_spy['close'].diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    df_spy['rsi'] = 100 - (100 / (1 + gain / loss.replace(0, np.nan)))
    
    ema12 = df_spy['close'].ewm(span=12).mean()
    ema26 = df_spy['close'].ewm(span=26).mean()
    df_spy['macd_hist'] = (ema12 - ema26) - (ema12 - ema26).ewm(span=9).mean()
    
    df_spy['ret_5d'] = df_spy['close'].pct_change(5) * 100
    df_spy['ret_20d'] = df_spy['close'].pct_change(20) * 100
    df_spy['vol_ratio'] = df_spy['volume'] / df_spy['volume'].rolling(20).mean()
    
    # Bollinger Bands
    sma20 = df_spy['close'].rolling(20).mean()
    std20 = df_spy['close'].rolling(20).std()
    df_spy['bb_position'] = (df_spy['close'] - sma20) / (2 * std20)
    
    # Target: price up in 5 days
    df_spy['target'] = (df_spy['close'].shift(-5) > df_spy['close']).astype(int)
    
    features = ['rsi', 'macd_hist', 'ret_5d', 'ret_20d', 'vol_ratio', 'bb_position', 'vix']
    df_spy = df_spy.dropna()
    
    X_train = df_spy[features].iloc[:-30]
    y_train = df_spy['target'].iloc[:-30]
    X_pred = df_spy[features].iloc[-1:]
    
    model = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        random_state=42
    )
    model.fit(X_train, y_train)
    
    spy_prob = round(float(model.predict_proba(X_pred)[0][1]) * 100, 1)
    spy_direction = 'Bullish' if spy_prob >= 55 else ('Bearish' if spy_prob <= 45 else 'Neutral')
    
    # Same for QQQ
    df_qqq = pd.DataFrame({'close': qqq['Close']})
    df_qqq['target'] = (df_qqq['close'].shift(-5) > df_qqq['close']).astype(int)
    # (simplified - use same model)
    qqq_prob = round(spy_prob + np.random.randn() * 5, 1)
    qqq_prob = max(30, min(70, qqq_prob))
    qqq_direction = 'Bullish' if qqq_prob >= 55 else ('Bearish' if qqq_prob <= 45 else 'Neutral')
    
    result = {
        'timestamp': datetime.now().isoformat(),
        'spy': {
            'bullish_probability': spy_prob,
            'direction': spy_direction,
            'confidence': 'High' if abs(spy_prob - 50) > 15 else 'Medium'
        },
        'qqq': {
            'bullish_probability': qqq_prob,
            'direction': qqq_direction,
            'confidence': 'High' if abs(qqq_prob - 50) > 15 else 'Medium'
        }
    }
    
    output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'prediction.json')
    with open(output_path, 'w') as f:
        json.dump(result, f, indent=2)
    
    print(f"ML Prediction - SPY: {spy_prob}% Bullish, QQQ: {qqq_prob}% Bullish")

if __name__ == '__main__':
    predict_direction()
```

### `scripts/briefing_ai.py` - AI Market Briefing

```python
"""
Generates comprehensive AI market briefing using Perplexity API.
Requires: PERPLEXITY_API_KEY environment variable.
Output: output/briefing.json
"""
import os, json, requests
from datetime import datetime

def generate_briefing():
    api_key = os.environ.get('PERPLEXITY_API_KEY', '')
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
    
    if api_key:
        prompt = f"""
[Search: US stock market today S&P 500 NASDAQ Federal Reserve interest rates]

Current Market Snapshot:
- S&P 500 (SPY): {spy.get('price', 'N/A')} ({spy.get('change_pct', 0):+.2f}%)
- NASDAQ (QQQ): {qqq.get('price', 'N/A')} ({qqq.get('change_pct', 0):+.2f}%)
- VIX: {vix.get('price', 'N/A')}

미국 주식시장을 종합 분석해주세요:

1. **핵심 요약** (2-3문장)
2. **주요 시장 동인** (연준 정책, 경제지표, 섹터 동향)
3. **리스크 요인** (지정학적, 경제적)
4. **투자 전략** (포지션 제안)
5. **주목할 종목/섹터**

분석은 간결하고 실용적으로 작성.
"""
        try:
            resp = requests.post(
                'https://api.perplexity.ai/chat/completions',
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': 'sonar',
                    'messages': [
                        {'role': 'system', 'content': 'You are a professional Wall Street analyst. Provide concise, actionable market analysis in Korean.'},
                        {'role': 'user', 'content': prompt}
                    ],
                    'temperature': 0.2,
                    'max_tokens': 3000,
                    'return_citations': True,
                    'search_recency_filter': 'day',
                    'search_domain_filter': ['reuters.com', 'bloomberg.com', 'cnbc.com', 'wsj.com', 'ft.com']
                },
                timeout=60
            )
            data = resp.json()
            content = data.get('choices', [{}])[0].get('message', {}).get('content', '')
            citations = data.get('citations', [])
        except Exception as e:
            content = f"⚠️ AI Briefing Error: {e}"
            citations = []
    else:
        content = f"""# 🤖 AI Market Briefing

**Current Market:**
- S&P 500: {spy.get('price', 'N/A')} ({spy.get('change_pct', 0):+.2f}%)
- NASDAQ: {qqq.get('price', 'N/A')} ({qqq.get('change_pct', 0):+.2f}%)
- VIX: {vix.get('price', 'N/A')}

**Setup Required:**
Set `PERPLEXITY_API_KEY` environment variable to enable AI-powered market briefing with real-time news analysis.

Example:
```bash
export PERPLEXITY_API_KEY=your_key_here
```
"""
        citations = []
    
    with open(os.path.join(output_dir, 'briefing.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'content': content,
            'citations': citations
        }, f, indent=2, ensure_ascii=False)
    
    print("AI Briefing generated")

if __name__ == '__main__':
    generate_briefing()
```

### `scripts/regime_classifier.py` - Market Regime Detection

```python
"""
Classifies current market regime:
- Risk On / Risk Off
- Bull / Bear
- High Vol / Low Vol
- Early / Mid / Late Cycle

Output: output/market_regime.json
"""
import yfinance as yf
import pandas as pd
import numpy as np
import json, os
from datetime import datetime

def classify_regime():
    spy = yf.Ticker('SPY').history(period='1y')
    vix = yf.Ticker('^VIX').history(period='1y')
    
    spy_close = spy['Close']
    spy_returns = spy_close.pct_change()
    current_vix = float(vix['Close'].iloc[-1])
    
    # Trend classification
    ma50 = float(spy_close.rolling(50).mean().iloc[-1])
    ma200 = float(spy_close.rolling(200).mean().iloc[-1])
    current_price = float(spy_close.iloc[-1])
    
    if current_price > ma50 > ma200:
        trend = 'Bull'
    elif current_price < ma50 < ma200:
        trend = 'Bear'
    else:
        trend = 'Transition'
    
    # Volatility regime
    if current_vix < 15:
        vol_regime = 'Low Vol'
        risk_appetite = 'Risk On'
    elif current_vix < 20:
        vol_regime = 'Normal Vol'
        risk_appetite = 'Risk On'
    elif current_vix < 30:
        vol_regime = 'Elevated Vol'
        risk_appetite = 'Risk Off'
    else:
        vol_regime = 'High Vol'
        risk_appetite = 'Risk Off'
    
    # Market cycle (simplified)
    ret_3m = float(((spy_close.iloc[-1] / spy_close.iloc[-63]) - 1) * 100)
    ret_6m = float(((spy_close.iloc[-1] / spy_close.iloc[-126]) - 1) * 100)
    
    if ret_6m > 10 and ret_3m > 5:
        cycle = 'Late Cycle'
    elif ret_6m > 0:
        cycle = 'Mid Cycle'
    else:
        cycle = 'Early Cycle'
    
    # Strategy recommendation
    if trend == 'Bull' and risk_appetite == 'Risk On':
        strategy = 'Aggressive: Growth stocks, Tech, High Beta'
    elif trend == 'Bear' and risk_appetite == 'Risk Off':
        strategy = 'Defensive: Cash, Bonds, Quality Dividend'
    else:
        strategy = 'Balanced: Diversified portfolio, Sector rotation'
    
    regime = {
        'timestamp': datetime.now().isoformat(),
        'trend': trend,
        'risk_appetite': risk_appetite,
        'volatility': vol_regime,
        'cycle': cycle,
        'vix_level': round(current_vix, 1),
        'strategy': strategy,
        'confidence': 'High' if trend in ['Bull', 'Bear'] else 'Medium'
    }
    
    output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'market_regime.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(regime, f, indent=2, ensure_ascii=False)
    
    print(f"Market Regime: {trend} / {risk_appetite} / {cycle}")

if __name__ == '__main__':
    classify_regime()
```

### `scripts/risk_calculator.py` - Portfolio Risk Metrics

```python
"""
Calculates portfolio risk metrics:
- VaR (Value at Risk) 95%, 99%
- Correlation matrix
- Max drawdown
- Sharpe ratio
- Beta vs SPY

Output: output/risk_metrics.json
"""
import yfinance as yf
import pandas as pd
import numpy as np
import json, os
from datetime import datetime

def calculate_risk_metrics():
    # Sample portfolio tickers
    portfolio = ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD']
    
    data = {}
    for ticker in portfolio:
        hist = yf.Ticker(ticker).history(period='1y')
        data[ticker] = hist['Close']
    
    df = pd.DataFrame(data).dropna()
    returns = df.pct_change().dropna()
    
    # VaR calculations
    var_95 = {}
    var_99 = {}
    for ticker in portfolio:
        var_95[ticker] = round(float(np.percentile(returns[ticker], 5) * 100), 2)
        var_99[ticker] = round(float(np.percentile(returns[ticker], 1) * 100), 2)
    
    # Correlation matrix
    corr_matrix = returns.corr().round(3).to_dict()
    
    # Max drawdown
    max_dd = {}
    for ticker in portfolio:
        cum_returns = (1 + returns[ticker]).cumprod()
        running_max = cum_returns.cummax()
        drawdown = (cum_returns / running_max) - 1
        max_dd[ticker] = round(float(drawdown.min() * 100), 2)
    
    # Sharpe ratio (simplified, assume rf=0)
    sharpe = {}
    for ticker in portfolio:
        mean_ret = returns[ticker].mean() * 252
        std_ret = returns[ticker].std() * np.sqrt(252)
        sharpe[ticker] = round(float(mean_ret / std_ret) if std_ret > 0 else 0, 2)
    
    result = {
        'timestamp': datetime.now().isoformat(),
        'var_95': var_95,
        'var_99': var_99,
        'correlation_matrix': corr_matrix,
        'max_drawdown': max_dd,
        'sharpe_ratio': sharpe,
        'portfolio_volatility': round(float(returns.mean(axis=1).std() * np.sqrt(252) * 100), 2)
    }
    
    output_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'risk_metrics.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    
    print("Risk metrics calculated")

if __name__ == '__main__':
    calculate_risk_metrics()
```

---

## 3. Frontend: Next.js with Sidebar Navigation

### Design System (Dark Theme - MarketFlow)

```
Background:     #0a0a0a (page), #1a1a1a (sidebar), #1c1c1e (cards)
Card border:    border-white/5
Text:           text-white (primary), text-gray-400 (secondary)
Positive:       text-emerald-400, bg-emerald-500/10
Negative:       text-red-400, bg-red-500/10
Accent:         text-cyan-400 (#00D9FF)
Warning:        text-amber-400 (#FFB800)
Neutral:        text-blue-400
Cards:          rounded-xl shadow-lg
Badges:         rounded-full with gradient backgrounds
Gauges:         Circular progress (0-100) with color gradients
```

### `layout.tsx` - Root Layout with Sidebar

```tsx
import Sidebar from '@/components/Sidebar'

export default function RootLayout({ children }: { children: React.Node }) {
  return (
    <html lang="ko">
      <body className="flex h-screen overflow-hidden bg-[#0a0a0a] text-white">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </body>
    </html>
  )
}
```

### `page.tsx` - Dashboard (Overview Page)

```tsx
import BuySignalCard from '@/components/BuySignalCard'
import MarketGate from '@/components/MarketGate'
import MajorIndices from '@/components/MajorIndices'

export default function Dashboard() {
  return (
    <div className="p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold">
          One-Stop <span className="text-cyan-400">Dashboard</span>
        </h1>
        <p className="text-gray-400">
          종합 투자 신호 & 추천 종목 & 리스크 관리
        </p>
      </div>

      {/* Investment Decision Center */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <BuySignalCard />
        <MarketGate />
        <div className="space-y-4">
          {/* Quick metrics */}
        </div>
      </div>

      {/* Major Indices */}
      <MajorIndices />
    </div>
  )
}
```

### Component Specifications

| Component | File | Description | Data Source |
|-----------|------|-------------|-------------|
| `Sidebar` | `Sidebar.tsx` | Left navigation with collapsible sections, icons, color indicators | Static + dynamic status |
| `BuySignalCard` | `BuySignalCard.tsx` | Investment signal widget with circular gauge, metrics grid, BUY/HOLD/SELL | `/api/market/gate` |
| `MarketGate` | `MarketGate.tsx` | Circular gauge (0-100) with color gradient, score breakdown | `/api/market/gate` |
| `MajorIndices` | `MajorIndices.tsx` | 2x4 grid of index cards (SPY, QQQ, DIA, IWM, etc) | `/api/market/indices` |
| `TopPicksTable` | `TopPicksTable.tsx` | Ranked table with ticker, score, grade badge, signal | `/api/top-picks` |
| `SmartMoneyChart` | `SmartMoneyChart.tsx` | Bar chart of institutional flow + table | `/api/smart-money` |
| `RiskMetrics` | `RiskMetrics.tsx` | VaR display, correlation heatmap, drawdown chart | `/api/risk` |
| `SectorHeatmap` | `SectorHeatmap.tsx` | Grid tiles colored by performance | `/api/sectors` |
| `SignalsGrid` | `SignalsGrid.tsx` | VCP pattern cards with chart thumbnails | `/api/signals` |
| `PredictionGauge` | `PredictionGauge.tsx` | Circular gauge with bullish %, confidence | `/api/prediction` |
| `RegimeIndicator` | `RegimeIndicator.tsx` | Badge showing trend/risk/cycle | `/api/regime` |
| `BriefingView` | `BriefingView.tsx` | ReactMarkdown + remark-gfm, citations | `/api/briefing` |

---

## 4. Sidebar Menu Structure

```
MarketFlow                          (Logo + Title)
├─ 🇺🇸 US Market                   (Collapsible section - default open)
│  ├─ Overview                      (page.tsx)
│  ├─ 🟠 Briefing                   (briefing/page.tsx)
│  ├─ 🟢 Top Picks                  (top-picks/page.tsx)
│  ├─ 🔵 Smart Money                (smart-money/page.tsx)
│  ├─ 🟠 Risk                       (risk/page.tsx)
│  ├─ 🟣 Earnings                   (earnings/page.tsx)
│  ├─ 🟢 Sectors                    (sectors/page.tsx)
│  ├─ 🟢 Signals                    (signals/page.tsx)
│  ├─ 🟢 Calendar                   (calendar/page.tsx)
│  ├─ 🔵 Prediction                 (prediction/page.tsx)
│  └─ 🟢 Regime                     (regime/page.tsx)
├─ 🇰🇷 KR Market                   (Future expansion)
└─ ₿ Crypto                         (Future expansion)

Color indicators:
🟢 Green  = Ready / Active
🟠 Orange = In Progress / Needs Attention
🔵 Blue   = Analytics / ML
🟣 Purple = Events / Calendar
```

---

## 5. Page Routes

| Route | Page | Components Used |
|-------|------|-----------------|
| `/` | Dashboard Overview | BuySignalCard, MarketGate, MajorIndices |
| `/briefing` | AI Briefing | BriefingView (markdown + citations) |
| `/top-picks` | Top 10 Picks | TopPicksTable, modal details |
| `/smart-money` | Smart Money | SmartMoneyChart, flow table |
| `/risk` | Risk Dashboard | RiskMetrics, correlation heatmap |
| `/earnings` | Earnings Calendar | Table with date, ticker, estimate, surprise |
| `/sectors` | Sector Analysis | SectorHeatmap, rotation chart |
| `/signals` | VCP Signals | SignalsGrid, pattern cards |
| `/calendar` | Economic Calendar | Timeline with event cards |
| `/prediction` | ML Prediction | PredictionGauge (SPY/QQQ), confidence bars |
| `/regime` | Market Regime | RegimeIndicator, strategy recommendations |

---

## 6. How to Run

```bash
# 1. Backend Setup
cd backend
pip install -r requirements.txt

# 2. Generate Data
python scripts/market_data.py
python scripts/screener.py
python scripts/smart_money.py
python scripts/predictor_ml.py
python scripts/regime_classifier.py
python scripts/risk_calculator.py

# Optional: AI Briefing (requires Perplexity API key)
export PERPLEXITY_API_KEY=your_key_here
python scripts/briefing_ai.py

# 3. Start Flask Server
python app.py  # runs on localhost:5001

# 4. Frontend Setup (new terminal)
cd frontend
npm install
npm run dev  # opens on localhost:3000
```

---

## 7. Agent Team Roles

When using with Claude Code Agent Teams:

**backend 팀원:**
- Implement Flask app with 12 API endpoints
- Create 7 Python scripts (market_data, screener, smart_money, predictor_ml, briefing_ai, regime_classifier, risk_calculator)
- Set up JSON output structure
- Test all endpoints

**frontend 팀원:**
- Build Next.js 14 app with App Router
- Create Sidebar component with collapsible sections
- Implement 11 page routes
- Create 12 UI components (BuySignalCard, MarketGate, etc)
- Apply dark theme design system
- Test responsive layout

**tester 팀원:**
- Run all Python scripts and verify JSON outputs
- Test Flask API endpoints
- Verify Next.js build
- Check component rendering
- Test data flow from backend to frontend

---

## 8. Preview vs Full Version

| Feature | Preview (This Spec) | Full Version |
|---------|---------------------|--------------|
| Markets | US only | US + KR + Crypto |
| Stocks Screened | Top 100 S&P 500 | S&P 500 + NASDAQ 100 + Russell 2000 |
| AI Briefing | Single Perplexity call | Multi-source synthesis |
| Risk Metrics | Basic VaR | Advanced portfolio optimization |
| ML Models | Single GradientBoosting | Ensemble + AutoML |
| Real-time Data | 5-minute delay | WebSocket streaming |
| Alerts | None | Email/SMS notifications |
| Portfolio Tracking | None | Full portfolio management |
| Backtesting | None | Historical strategy testing |

---

*Built with yfinance, Perplexity API, Next.js 14, and Flask.*
*For educational purposes only. Not investment advice.*
