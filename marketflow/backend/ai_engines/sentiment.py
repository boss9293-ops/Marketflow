"""News sentiment analysis (basic implementation)."""
import json, os
from datetime import datetime

def analyze_sentiment(text: str) -> dict:
    """Basic sentiment analysis."""
    positive_words = ['growth', 'rally', 'gain', 'bullish', 'strong', 'beat', 'surge']
    negative_words = ['decline', 'fall', 'bearish', 'weak', 'miss', 'drop', 'recession']

    text_lower = text.lower()
    pos_count = sum(1 for w in positive_words if w in text_lower)
    neg_count = sum(1 for w in negative_words if w in text_lower)

    if pos_count > neg_count:
        sentiment = 'Positive'
        score = min(1.0, pos_count * 0.15)
    elif neg_count > pos_count:
        sentiment = 'Negative'
        score = -min(1.0, neg_count * 0.15)
    else:
        sentiment = 'Neutral'
        score = 0.0

    return {'sentiment': sentiment, 'score': round(score, 2)}

if __name__ == '__main__':
    result = analyze_sentiment("Market rallied strongly on earnings beat.")
    print(result)
