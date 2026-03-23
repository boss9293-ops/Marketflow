export type MemoryInflationRegime = 'HIGH' | 'LOW' | 'NORMAL';

export type MemoryRatesTrend = 'UP' | 'DOWN' | 'FLAT';

export type MemoryLiquidityState = 'TIGHT' | 'LOOSE' | 'NEUTRAL';

export type MemoryClassification = 'EVENT' | 'STRUCTURAL' | 'HYBRID';

export type EventMemoryCase = {
  id: string;
  event_type: string;
  macro_context: {
    inflation: MemoryInflationRegime;
    rates_trend: MemoryRatesTrend;
    liquidity: MemoryLiquidityState;
  };
  market_context: {
    velocity_score: number;
    internals_score: number;
    credit_score: number;
  };
  classification: MemoryClassification;
  outcome: {
    next_5d: number;
    next_10d: number;
    next_20d: number;
    rebound: boolean;
    continuation: boolean;
  };
};

export type MemoryMatch = {
  id: string;
  similarity_score: number;
  classification: MemoryClassification;
  outcome: EventMemoryCase['outcome'];
  event_type: string;
};

export type MemoryAggregatedInsight = {
  structural_probability: number;
  event_probability: number;
  rebound_probability: number;
  continuation_probability: number;
};

export type MemoryEngineOutput = {
  matched_cases: MemoryMatch[];
  aggregated_insight: MemoryAggregatedInsight;
};

// Embedded in SmartAnalyzerResult
export type SmartAnalyzerMemorySummary = {
  top_match: string | null;
  similarity: number | null;
  structural_probability: number;
  rebound_probability: number;
};

// Embedded in SmartAnalyzerDebug
export type SmartAnalyzerMemoryDebug = {
  top_match_id: string | null;
  similarity_score: number | null;
  structural_probability: number;
  rebound_probability: number;
};
