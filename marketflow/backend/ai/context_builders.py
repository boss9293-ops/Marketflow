"""
Context Builders for RICE Prompts.
Aggregates and normalizes data from backend/output/cache JSONs.
"""

from typing import Dict, Any

def normalize_list(data: Any, key: str, default: list = None) -> list:
    val = data.get(key, default or [])
    if isinstance(val, list):
        return val
    return []

def build_context_for_A(
    overview: Dict[str, Any],
    hot_zone: Dict[str, Any],
    sector_rotation: Dict[str, Any],
    alerts: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Build context for Dashboard Brief (A).
    Focus: Market Phase, Gate, Top Sectors, Themes.
    """
    
    # Extract Overview Data
    market_gate = overview.get('market_gate', {})
    market_phase = market_gate.get('market_phase', 'Neutral')
    gate_score = market_gate.get('score', 0)
    risk_trend = market_gate.get('risk_trend', 'Stable')

    # Extract Sector Data
    sectors = sector_rotation.get('ranking', {})
    top_sectors = [s['sector'] for s in normalize_list(sectors, 'leading', [])[:3]]

    # Extract Hot Zone Themes (using top stocks as proxies if themes absent)
    # Assuming hot_zone structure has 'hot_stocks' or similar
    hot_stocks = normalize_list(hot_zone, 'hot_stocks', [])
    leading_themes = []
    # Simple extraction: just top 3 ticker symbols to represent "themes" roughly for now
    if hot_stocks:
        leading_themes = [s.get('symbol', 'Unknown') for s in hot_stocks[:3]]

    # Alert Count
    alert_count = len(normalize_list(alerts, 'recent_alerts', []))

    return {
        'market_phase': market_phase,
        'gate_score': gate_score,
        'risk_trend': risk_trend,
        'top_sectors': top_sectors,
        'leading_themes': leading_themes,
        'alert_count': alert_count,
        'data_notes': f"Context built from {len(top_sectors)} sectors and {len(hot_stocks)} hot stocks."
    }

def build_context_for_B(
    overview: Dict[str, Any],
    ml_prediction: Dict[str, Any],
    hot_zone: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Build context for Risk Strategy Brief (B).
    Focus: Risk Level, VIX, ML Tail Risk, Overheating.
    """
    
    # Overview Risk Metrics
    market_gate = overview.get('market_gate', {})
    market_phase = market_gate.get('market_phase', 'Neutral')
    risk_level = market_gate.get('risk_score', 50) # Assuming risk_score exists implies level
    
    # ML Predictions
    # Assuming ml_prediction has 'crash_probability' or similar
    crash_prob = ml_prediction.get('tail_risk_probability', 'Low') # Placeholder key
    
    # Hot Zone Intensity (simple proxy: count of overheated stocks)
    hot_stocks = normalize_list(hot_zone, 'hot_stocks', [])
    hot_zone_intensity = "High" if len(hot_stocks) > 10 else "Normal"

    return {
        'market_phase': market_phase,
        'risk_level': risk_level,
        'vix_trend': 'Checking...', # If VIX data available in overview, populate here
        'crash_prob': crash_prob,
        'hot_zone_intensity': hot_zone_intensity,
        'data_notes': "Risk context derived from market gate and ML tail risk estimates."
    }
