"""
VCP (Volatility Contraction Pattern) Detector - Full PART6 Implementation
Mark Minervini's Super Performance Strategy

TIERED GRADE SYSTEM:
  Grade A: Strict  - close > EMA50 > EMA200, EMA200 slope up
  Grade B: Relaxed - close > EMA50
  Grade C: Basic   - close > EMA200
  Grade D: Accum   - any trend (accumulation phase)

SIGNAL TYPES:
  BREAKOUT   - price closed above pivot (breakout confirmed)
  APPROACHING- price within 2% below pivot (watch zone)
  RETEST_OK  - pulled back to pivot then reclaimed it

SCORING (0-100):
  Contraction Quality 40%
  Trend Strength      25%
  Trigger Quality     25%
  Risk/Market         10%

Output: output/vcp_signals.json
"""
import sqlite3
import yfinance as yf
import pandas as pd
import numpy as np
import json, os
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Tuple

# Local DB path (same repo layout as other scripts)
_DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'marketflow.db')


def _load_ohlcv_from_db(symbol: str, years: int = 2) -> Optional[pd.DataFrame]:
    """
    Load daily OHLCV from local ohlcv_daily table.
    Returns DataFrame with columns [Open, High, Low, Close, Volume] indexed by date,
    or None if data is missing / insufficient.
    Uses the most recent trading day available — works correctly on weekends/holidays.
    """
    db = os.path.abspath(_DB_PATH)
    if not os.path.exists(db):
        return None
    cutoff = (datetime.now() - timedelta(days=365 * years + 14)).strftime('%Y-%m-%d')
    try:
        con = sqlite3.connect(db)
        df = pd.read_sql_query(
            "SELECT date, open AS Open, high AS High, low AS Low, close AS Close, volume AS Volume "
            "FROM ohlcv_daily WHERE symbol = ? AND close IS NOT NULL AND date >= ? ORDER BY date ASC",
            con, params=(symbol.upper(), cutoff),
        )
        con.close()
        if df.empty or len(df) < 80:
            return None
        df['date'] = pd.to_datetime(df['date'])
        df = df.set_index('date')
        return df
    except Exception:
        return None

# ─── Grade Definitions ────────────────────────────────────────────
GRADE_PARAMS = [
    # (params_dict, grade_name)
    ({
        'trend_mode': 'STRICT',          # close > EMA50 > EMA200 + EMA200 slope up
        'min_r12': 1.20,
        'min_r23': 1.10,
        'require_descending_highs': True,
        'require_ascending_lows': True,
        'min_confidence': 50,
    }, 'A'),
    ({
        'trend_mode': 'ABOVE_EMA50',     # close > EMA50
        'min_r12': 1.10,
        'min_r23': 1.05,
        'require_descending_highs': True,
        'require_ascending_lows': False,
        'min_confidence': 42,
    }, 'B'),
    ({
        'trend_mode': 'ABOVE_EMA200',    # close > EMA200
        'min_r12': 1.05,
        'min_r23': 1.0,
        'require_descending_highs': False,
        'require_ascending_lows': False,
        'min_confidence': 38,
    }, 'C'),
    ({
        'trend_mode': 'ANY',             # accumulation - no trend requirement
        'min_r12': 1.05,
        'min_r23': 1.0,
        'require_descending_highs': False,
        'require_ascending_lows': False,
        'min_confidence': 35,
    }, 'D'),
]

# ─── Universe ─────────────────────────────────────────────────────
SCAN_LIST = [
    # Mega cap tech
    'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AVGO', 'ORCL', 'AMD',
    # Large cap tech
    'CRM', 'ADBE', 'INTU', 'NOW', 'PANW', 'SNOW', 'CRWD', 'MDB', 'NET', 'DDOG',
    # Semiconductors
    'AMAT', 'LRCX', 'KLAC', 'MRVL', 'ON', 'TXN', 'QCOM', 'INTC', 'MU', 'SMCI',
    # Healthcare
    'LLY', 'UNH', 'ABBV', 'JNJ', 'MRK', 'TMO', 'ABT', 'ISRG', 'AMGN', 'GILD',
    # Financials
    'JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'BLK', 'SCHW', 'AXP', 'COF',
    # Consumer / Retail
    'HD', 'COST', 'WMT', 'TGT', 'NKE', 'SBUX', 'MCD', 'ABNB', 'BKNG', 'UBER',
    # Industrials
    'CAT', 'DE', 'HON', 'RTX', 'LMT', 'GE', 'BA', 'UPS', 'FDX', 'CSX',
    # Energy
    'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY', 'MPC', 'VLO', 'PSX', 'HAL',
    # Communication
    'NFLX', 'DIS', 'CMCSA', 'T', 'VZ',
    # ETFs
    'SPY', 'QQQ', 'IWM',
]

# Market cap tier thresholds (market cap in USD billions)
MCAP_TIER = {'A': 200e9, 'B': 10e9}  # A=Large, B=Mid, C=Small


# ─── Indicators ───────────────────────────────────────────────────
def calc_rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    delta = prices.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def calc_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    hl = df['High'] - df['Low']
    hc = (df['High'] - df['Close'].shift(1)).abs()
    lc = (df['Low'] - df['Close'].shift(1)).abs()
    tr = pd.concat([hl, hc, lc], axis=1).max(axis=1)
    return tr.rolling(period).mean()


def wick_ratio(o: float, h: float, l: float, c: float) -> float:
    """Upper wick as fraction of total bar range."""
    rng = h - l
    if rng < 1e-9:
        return 0.0
    body_top = max(o, c)
    return (h - body_top) / rng


# ─── Market Regime (SPY-based for stocks) ─────────────────────────
def market_regime_from_spy(spy_df: pd.DataFrame) -> str:
    """Classify SPY regime: SPY_UP / SPY_SIDE / SPY_DOWN"""
    if len(spy_df) < 50:
        return 'SPY_SIDE'
    close = spy_df['Close']
    e50 = close.ewm(span=50).mean()
    slope = float(e50.iloc[-1] - e50.iloc[-21])   # 21-day slope
    if close.iloc[-1] > e50.iloc[-1] and slope > 0:
        return 'SPY_UP'
    if close.iloc[-1] < e50.iloc[-1] and slope < 0:
        return 'SPY_DOWN'
    return 'SPY_SIDE'


# ─── Swing-Based VCP Extraction ───────────────────────────────────
def extract_vcp_from_swings(
    df: pd.DataFrame,
    k: int = 3,
    lookback: int = 200,
    min_r12: float = 1.2,
    min_r23: float = 1.1,
    require_descending_highs: bool = True,
    require_ascending_lows: bool = True,
) -> Optional[Dict]:
    """
    Extract VCP using actual swing high/low points.
    Returns {pivot_high, c1, c2, c3} or None.
    """
    if len(df) < lookback:
        return None

    sub = df.tail(lookback).copy()
    high = sub['High'].values
    low  = sub['Low'].values
    n = len(sub)

    # Find swing highs & lows
    swing_highs: List[Tuple[int, float]] = []
    swing_lows:  List[Tuple[int, float]] = []

    for i in range(k, n - k):
        window_h = high[i-k:i+k+1]
        window_l = low[i-k:i+k+1]
        if high[i] == window_h.max():
            swing_highs.append((i, high[i]))
        if low[i] == window_l.min():
            swing_lows.append((i, low[i]))

    if len(swing_highs) < 2 or len(swing_lows) < 2:
        return None

    # Build contraction pairs from most recent swings
    # Pair each swing_high with nearest swing_low to form a swing range
    contractions: List[float] = []
    used = set()
    for sh_idx, sh_val in reversed(swing_highs):
        # Find nearest preceding swing low
        best_sl = None
        best_dist = 9999
        for sl_idx, sl_val in swing_lows:
            if sl_idx < sh_idx and (sl_idx, sl_val) not in used:
                dist = sh_idx - sl_idx
                if dist < best_dist:
                    best_dist = dist
                    best_sl = (sl_idx, sl_val)
        if best_sl and best_sl[1] > 0:
            rng = (sh_val - best_sl[1]) / best_sl[1] * 100.0
            contractions.append(round(rng, 2))
            used.add(best_sl)
        if len(contractions) >= 3:
            break

    # contractions[0] = most recent (C3), contractions[-1] = oldest (C1)
    if len(contractions) < 2:
        return None

    contractions.reverse()   # now [C1, C2, C3, ...]
    c1 = contractions[0]
    c2 = contractions[1]
    c3 = contractions[2] if len(contractions) > 2 else round(c2 * 0.80, 2)

    eps = 1e-9
    if c2 < eps or c1 / c2 < min_r12:
        return None
    if c3 < eps or c2 / c3 < min_r23:
        return None

    # Structure checks
    if require_descending_highs:
        recent_highs = [h for _, h in swing_highs[-3:]]
        if len(recent_highs) >= 2 and recent_highs[-1] > recent_highs[-2]:
            return None

    if require_ascending_lows:
        recent_lows = [l for _, l in swing_lows[-3:]]
        if len(recent_lows) >= 2 and recent_lows[-1] < recent_lows[-2]:
            return None

    pivot_high = max(h for _, h in swing_highs[-3:]) if swing_highs else float(sub['High'].max())

    return {'pivot_high': float(pivot_high), 'c1': c1, 'c2': c2, 'c3': c3}


# ─── Trend Mode Check ─────────────────────────────────────────────
def check_trend_mode(
    close: pd.Series,
    e50: pd.Series,
    e200: pd.Series,
    mode: str,
) -> bool:
    cur = float(close.iloc[-1])
    v50  = float(e50.iloc[-1])
    v200 = float(e200.iloc[-1])

    if mode == 'STRICT':
        if not (cur > v50 > v200):
            return False
        # EMA200 must have positive slope (21 days)
        if len(e200) > 21:
            slope = float(e200.iloc[-1] - e200.iloc[-21])
            if slope <= 0:
                return False
        return True
    elif mode == 'ABOVE_EMA50':
        return cur > v50
    elif mode == 'ABOVE_EMA200':
        return cur > v200
    else:  # ANY
        return True


# ─── Advanced Scoring Engine ──────────────────────────────────────
def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def norm(x: float, lo: float, hi: float) -> float:
    if hi == lo:
        return 0.0
    return clamp((x - lo) / (hi - lo), 0.0, 1.0)


def score_signal(
    c1: float, c2: float, c3: float,
    atrp_pct: float,
    above_ema50_ratio: float,
    ema_sep_pct: float,
    signal_type: str,
    breakout_close_pct: float,
    vol_ratio: float,
    wk_ratio: float,
    mcap_tier: str,
    market_regime: str,
    retest_depth_pct: float = 0.0,
    retest_vol_ratio: float = 1.0,
    retest_close_above: bool = False,
    vol_dryup_ratio: float = 1.0,
) -> int:
    eps = 1e-9
    r12 = c1 / max(c2, eps)
    r23 = c2 / max(c3, eps)

    # === CONTRACTION (40 pts) ===
    s_decay = 0.5 * norm(r12, 1.1, 1.8) + 0.5 * norm(r23, 1.05, 1.6)
    s_c3    = 1.0 - norm(c3, 2.0, 15.0)    # tighter C3 is better
    s_atrp  = 1.0 - norm(atrp_pct, 0.5, 3.5)
    # Volume dry-up bonus: ratio < 1.0 means volume declining (good for VCP base)
    s_voldryup = 1.0 - norm(vol_dryup_ratio, 0.5, 1.5)
    contraction = 40.0 * (0.40*s_decay + 0.30*s_c3 + 0.15*s_atrp + 0.15*s_voldryup)

    # === TREND (25 pts) ===
    s_hold = norm(above_ema50_ratio, 0.50, 0.85)
    # EMA structure: positive sep means EMA50 > EMA200 (bullish alignment)
    # Negative sep penalized, but not catastrophically
    s_sep  = norm(max(ema_sep_pct, -5.0), -5.0, 15.0)
    trend = 25.0 * (0.60*s_hold + 0.40*s_sep)

    # === TRIGGER (25 pts) ===
    if signal_type == 'BREAKOUT':
        # Best breakout: +1% to +4% above pivot
        s_break = 1.0 - abs(norm(breakout_close_pct, 0.5, 6.0) - 0.4) * 2.0
        s_break = clamp(s_break, 0.0, 1.0)
        s_vol = norm(vol_ratio, 1.2, 3.0)
        trigger = 25.0 * (0.55*s_break + 0.45*s_vol)
    elif signal_type == 'APPROACHING':
        # Near pivot: closer = better; volume dry-up = better (base forming)
        s_prox   = norm(-breakout_close_pct, 0.0, 5.0)   # 0% better than -5%
        s_voldry = 1.0 - norm(vol_ratio, 0.5, 1.5)        # low vol = good
        trigger = 25.0 * (0.60*s_prox + 0.40*s_voldry)
    else:  # RETEST_OK
        s_depth  = 1.0 - abs(norm(retest_depth_pct, 0.0, 3.0) - 0.5) * 1.5
        s_depth  = clamp(s_depth, 0.0, 1.0)
        s_above  = 1.0 if retest_close_above else 0.0
        s_vol2   = 1.0 - norm(retest_vol_ratio, 0.8, 1.8)
        trigger = 25.0 * (0.45*s_depth + 0.35*s_above + 0.20*s_vol2)

    # === RISK / MARKET (10 pts) ===
    s_wick  = 1.0 - norm(wk_ratio, 0.20, 0.65)
    s_mcap  = {'A': 1.0, 'B': 0.6, 'C': 0.3}.get(mcap_tier, 0.3)
    s_reg   = {'SPY_UP': 1.0, 'SPY_SIDE': 0.65, 'SPY_DOWN': 0.25}.get(market_regime, 0.5)
    risk_mkt = 10.0 * (0.45*s_wick + 0.30*s_mcap + 0.25*s_reg)

    total = contraction + trend + trigger + risk_mkt
    return int(round(clamp(total, 0.0, 100.0)))


# ─── Market Cap Tier ──────────────────────────────────────────────
def mcap_tier_from_info(info) -> str:
    mc = getattr(info, 'market_cap', None)
    if mc is None:
        return 'C'
    if mc >= MCAP_TIER['A']:
        return 'A'
    if mc >= MCAP_TIER['B']:
        return 'B'
    return 'C'


# ─── Main Detector ────────────────────────────────────────────────
def detect_vcp(symbol: str, spy_regime: str = 'SPY_SIDE') -> Optional[Dict]:
    """
    Full PART6 VCP detection with tiered grades.
    Data priority: local DB (ohlcv_daily) → yfinance fallback.
    Uses most recent trading day available — works correctly on weekends/holidays.
    Returns best-grade signal dict or None.
    """
    try:
        # ── Load daily data: DB first, yfinance fallback ──────
        hist_d = _load_ohlcv_from_db(symbol, years=2)
        if hist_d is None:
            # DB miss → try yfinance
            ticker = yf.Ticker(symbol)
            hist_d = ticker.history(period='2y')
            if hist_d is None or len(hist_d) < 80:
                return None
            # Build weekly from yfinance for consistency
            hist_w = ticker.history(period='2y', interval='1wk')
        else:
            ticker = None  # Only fetch ticker info later if needed
            # Resample daily → weekly (week ending Friday)
            hist_w = hist_d.resample('W-FRI').agg(
                {'Open': 'first', 'High': 'max', 'Low': 'min', 'Close': 'last', 'Volume': 'sum'}
            ).dropna(subset=['Close'])

        if len(hist_d) < 80 or len(hist_w) < 30:
            return None

        close = hist_d['Close']
        vol_d = hist_d['Volume']
        current = float(close.iloc[-1])

        if current < 5:
            return None

        # Moving averages (일봉 기준)
        e50  = close.ewm(span=50).mean()
        e200 = close.ewm(span=200).mean()
        e21  = close.ewm(span=21).mean()

        if pd.isna(e200.iloc[-1]):
            return None

        v50  = float(e50.iloc[-1])
        v200 = float(e200.iloc[-1])

        # ── Try each grade A → B → C → D ─────────────────────
        # 주봉으로 스윙 추출 (VCP는 주간 단위 패턴)
        vcp = None
        grade = None
        grade_params = None

        for params, g in GRADE_PARAMS:
            if not check_trend_mode(close, e50, e200, params['trend_mode']):
                continue
            result = extract_vcp_from_swings(
                df=hist_w,          # 주봉 데이터로 스윙 추출
                k=2,                # 주봉은 k=2로 (노이즈 적음)
                lookback=80,        # 최근 80주 (~1.5년)
                min_r12=params['min_r12'],
                min_r23=params['min_r23'],
                require_descending_highs=params['require_descending_highs'],
                require_ascending_lows=params['require_ascending_lows'],
            )
            if result:
                vcp = result
                grade = g
                grade_params = params
                break

        if vcp is None:
            return None

        pivot    = vcp['pivot_high']
        c1, c2, c3 = vcp['c1'], vcp['c2'], vcp['c3']

        # ── Additional Indicators ─────────────────────────────
        # ATR%
        atr_series = calc_atr(hist_d, 14)
        atrp_pct = float(atr_series.iloc[-1] / current * 100.0) if current > 0 else 1.0

        # Above EMA50 ratio (last 20 days)
        tail20_close = close.tail(20).values
        tail20_e50   = e50.tail(20).values
        above_ema50_ratio = float((tail20_close > tail20_e50).mean())

        # EMA separation %
        ema_sep_pct = float((v50 - v200) / v200 * 100.0) if v200 > 0 else 0.0

        # Volume metrics
        avg_vol_50  = float(vol_d.tail(50).mean())
        recent_vol5 = float(vol_d.tail(5).mean())
        vol_ratio = round(recent_vol5 / avg_vol_50, 2) if avg_vol_50 > 0 else 1.0

        # Volume dry-up check (VCP base should have declining volume)
        # Split last 40 days into two halves: first 20 vs last 20
        # Volume in the recent half should be lower than the earlier half (dry-up)
        if len(vol_d) >= 40:
            vol_early = float(vol_d.iloc[-40:-20].mean())
            vol_recent = float(vol_d.iloc[-20:].mean())
            vol_dryup_ratio = vol_recent / vol_early if vol_early > 0 else 1.0
        else:
            vol_dryup_ratio = 1.0

        # RSI
        rsi = float(calc_rsi(close).iloc[-1])

        # RSI Filter: VCP is a consolidation pattern — RSI must be in healthy range
        # RSI > 80: overbought momentum surge (not a base, price is extended)
        # RSI < 30: downtrend, too weak to set up a VCP
        if not (30.0 <= rsi <= 80.0):
            return None

        # Wick ratio (last candle)
        last = hist_d.iloc[-1]
        wk = wick_ratio(float(last['Open']), float(last['High']), float(last['Low']), float(last['Close']))

        # 52-week stats
        high_52w = float(close.tail(252).max())
        low_52w  = float(close.tail(252).min())

        # Base low for stop
        base_low = float(hist_d['Low'].tail(60).min())
        base_range_pct = (pivot - base_low) / base_low * 100.0

        # Market cap tier (only call yfinance if we haven't already)
        try:
            if ticker is None:
                ticker = yf.Ticker(symbol)
            fast_info = ticker.fast_info
            mc_tier = mcap_tier_from_info(fast_info)
            name = getattr(fast_info, 'company', symbol)
        except Exception:
            mc_tier = 'C'
            name = symbol

        breakout_close_pct = (current - pivot) / pivot * 100.0

        if breakout_close_pct > 0.5:
            # Already broke out — check if it's a fresh breakout (within 8%)
            if breakout_close_pct <= 8.0:
                signal_type = 'BREAKOUT'
            else:
                # Too extended, not a fresh signal
                return None
        elif -2.0 <= breakout_close_pct <= 0.5:
            signal_type = 'APPROACHING'
        elif -10.0 <= breakout_close_pct < -2.0:
            # Building base — still include these in scan
            signal_type = 'APPROACHING'  # will be overridden to Building stage below
        else:
            # Too far below pivot (>10%)
            return None

        distance_to_pivot_pct = max(0.0, -breakout_close_pct)

        # ── Retest Detection ─────────────────────────────────
        # Check if previous bars suggest a retest pattern
        retest_depth_pct  = 0.0
        retest_vol_ratio  = 1.0
        retest_close_above = False

        if signal_type == 'BREAKOUT' and len(hist_d) >= 20:
            recent_20 = hist_d.tail(20)
            # Look for a dip back to pivot within last 10 bars
            for i in range(len(recent_20) - 5, len(recent_20)):
                row = recent_20.iloc[i]
                bar_low  = float(row['Low'])
                bar_close = float(row['Close'])
                tol_low  = pivot * 0.97
                tol_high = pivot * 1.03
                if tol_low <= bar_low <= tol_high:
                    # Found a retest bar
                    depth = (pivot - bar_low) / pivot * 100.0
                    rv = float(row['Volume']) / avg_vol_50 if avg_vol_50 > 0 else 1.0
                    if bar_close > pivot:
                        signal_type = 'RETEST_OK'
                        retest_depth_pct  = round(depth, 2)
                        retest_vol_ratio  = round(rv, 2)
                        retest_close_above = True
                        break

        # ── Score ─────────────────────────────────────────────
        score = score_signal(
            c1=c1, c2=c2, c3=c3,
            atrp_pct=atrp_pct,
            above_ema50_ratio=above_ema50_ratio,
            ema_sep_pct=ema_sep_pct,
            signal_type=signal_type,
            breakout_close_pct=breakout_close_pct,
            vol_ratio=vol_ratio,
            wk_ratio=wk,
            mcap_tier=mc_tier,
            market_regime=spy_regime,
            retest_depth_pct=retest_depth_pct,
            retest_vol_ratio=retest_vol_ratio,
            retest_close_above=retest_close_above,
            vol_dryup_ratio=vol_dryup_ratio,
        )

        min_conf = grade_params['min_confidence']
        if score < min_conf:
            return None

        # ── Stage ─────────────────────────────────────────────
        if signal_type == 'RETEST_OK':
            stage = 'Retest'
        elif signal_type == 'BREAKOUT':
            stage = 'Breakout'
        elif distance_to_pivot_pct <= 1.5:
            stage = 'Ready'
        elif distance_to_pivot_pct <= 3.0:
            stage = 'Near'
        elif distance_to_pivot_pct <= 6.0:
            stage = 'Near'
        else:
            stage = 'Building'

        stage_colors = {
            'Retest':   '#a855f7',
            'Breakout': '#22c55e',
            'Ready':    '#22c55e',
            'Near':     '#f59e0b',
            'Building': '#3b82f6',
        }

        # R/R
        stop = base_low * 0.97
        target = pivot * 1.15
        rr = round((target - current) / (current - stop), 2) if current > stop else 0.0

        return {
            'ticker': symbol,
            'name': name if name != symbol else symbol,
            'pattern': 'VCP',
            'grade': grade,
            'stage': stage,
            'stage_color': stage_colors.get(stage, '#3b82f6'),
            'signal_type': signal_type,
            'score': score,
            'market_regime': spy_regime,
            'mcap_tier': mc_tier,
            # Price levels
            'current_price': round(current, 2),
            'pivot': round(pivot, 2),
            'breakout_price': round(pivot * 1.02, 2),
            'stop_loss': round(stop, 2),
            'risk_reward': rr,
            'breakout_close_pct': round(breakout_close_pct, 2),
            'distance_to_pivot_pct': round(distance_to_pivot_pct, 2),
            # Contraction metrics
            'c1': round(c1, 2),
            'c2': round(c2, 2),
            'c3': round(c3, 2),
            'r12': round(c1 / max(c2, 1e-9), 2),
            'r23': round(c2 / max(c3, 1e-9), 2),
            'base_range_pct': round(base_range_pct, 1),
            # Indicators
            'rsi': round(rsi, 1),
            'atrp_pct': round(atrp_pct, 2),
            'volume_ratio': vol_ratio,
            'above_ema50_ratio': round(above_ema50_ratio, 2),
            'ema_sep_pct': round(ema_sep_pct, 2),
            'ema50': round(v50, 2),
            'ema200': round(v200, 2),
            '52w_high': round(high_52w, 2),
            '52w_low': round(low_52w, 2),
            # Retest / Volume fields
            'retest_depth_pct': retest_depth_pct,
            'retest_vol_ratio': retest_vol_ratio,
            'vol_dryup_ratio': round(vol_dryup_ratio, 2),
        }

    except Exception:
        return None


# ─── Scanner ──────────────────────────────────────────────────────
def scan_vcp(stock_list: Optional[List[str]] = None, max_results: int = 20) -> List[Dict]:
    if stock_list is None:
        stock_list = SCAN_LIST

    # Get SPY regime: local DB first, yfinance fallback
    spy_regime = 'SPY_SIDE'
    try:
        spy_hist = _load_ohlcv_from_db('SPY', years=1)
        if spy_hist is None:
            spy_hist = yf.Ticker('SPY').history(period='3mo')
        spy_regime = market_regime_from_spy(spy_hist)
        print(f"  Market Regime: {spy_regime}")
    except Exception:
        pass

    signals: List[Dict] = []

    for i, symbol in enumerate(stock_list):
        try:
            result = detect_vcp(symbol, spy_regime)
            if result:
                signals.append(result)
                print(f"  ✓ {symbol} Grade-{result['grade']} | {result['signal_type']} | "
                      f"Score={result['score']} | Pivot=${result['pivot']} | R/R={result['risk_reward']}x")
        except Exception:
            pass

        if (i + 1) % 10 == 0:
            print(f"  Scanned {i+1}/{len(stock_list)} | Found {len(signals)} VCPs")

    # Sort: RETEST_OK first, then BREAKOUT, then APPROACHING; within each by score
    order = {'RETEST_OK': 0, 'BREAKOUT': 1, 'APPROACHING': 2}
    signals.sort(key=lambda x: (order.get(x['signal_type'], 9), -x['score']))

    return signals[:max_results]


# ─── Entry Point ──────────────────────────────────────────────────
if __name__ == '__main__':
    print("Scanning for VCP patterns (PART6 - Tiered Grade System)...")
    signals = scan_vcp()

    output = {
        'timestamp': datetime.now().isoformat(),
        'total_scanned': len(SCAN_LIST),
        'signals': signals,
    }

    out_path = os.path.join(os.path.dirname(__file__), '..', 'output', 'vcp_signals.json')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    grade_counts = {}
    for s in signals:
        grade_counts[s['grade']] = grade_counts.get(s['grade'], 0) + 1
    print(f"\nVCP scan complete: {len(signals)} patterns | Grades: {grade_counts}")
