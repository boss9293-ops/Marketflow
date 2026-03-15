"""Chart pattern detection (basic implementation)."""
import numpy as np
from typing import List, Dict

def detect_vcp(prices: List[float], volumes: List[float]) -> Dict:
    """Detect Volatility Contraction Pattern (VCP)."""
    if len(prices) < 20:
        return {'pattern': 'None', 'confidence': 0}

    prices_arr = np.array(prices[-20:])

    # Calculate volatility contraction
    early_vol = np.std(prices_arr[:10])
    late_vol = np.std(prices_arr[10:])

    contraction_ratio = late_vol / early_vol if early_vol > 0 else 1

    if contraction_ratio < 0.7:
        return {
            'pattern': 'VCP',
            'confidence': round((1 - contraction_ratio) * 100, 1),
            'contraction_ratio': round(contraction_ratio, 2)
        }
    return {'pattern': 'None', 'confidence': 0, 'contraction_ratio': round(contraction_ratio, 2)}

if __name__ == '__main__':
    import random
    prices = [100 + random.gauss(0, 2) for _ in range(20)]
    print(detect_vcp(prices, []))
