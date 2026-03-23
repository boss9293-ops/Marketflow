import type { BridgeDebug, BridgeResult } from './bridge';
import type { VrPolicyDebug, VrPolicyResult } from './vrPolicy';
import type { VrRuntimePolicyDebug, VrRuntimePolicyResult } from './vrRuntimePolicy';
import type { VrActionPolicyDebug, VrActionPolicyResult } from './vrAction';
import type { SmartAnalyzerMemoryDebug, SmartAnalyzerMemorySummary } from './memory';
import type { ResearchDeskPayload } from './researchDesk';
import type { ScenarioDebug, ScenarioResult } from './scenario';

export type SmartAnalyzerMarketType = 'EVENT' | 'STRUCTURAL' | 'HYBRID';

export type SmartAnalyzerConfidence = 'LOW' | 'MED' | 'HIGH';

export type SmartAnalyzerStrategy = 'ENTER' | 'PARTIAL' | 'WAIT' | 'DEFENSIVE';

export type SmartAnalyzerRatesInput = {
  us10y: number;
  us2y: number;
  spread: number;
};

export type SmartAnalyzerVolatilityInput = {
  vix?: number;
  spike?: boolean;
  level?: string;
};

export type SmartAnalyzerDrawdownInput = {
  dd3?: number;
  dd5?: number;
  peak_dd?: number;
};

export type SmartAnalyzerLiquidityBalanceSheetTrend = 'EXPANDING' | 'SHRINKING' | 'FLAT';

export type SmartAnalyzerDirectionalTrend = 'UP' | 'DOWN' | 'FLAT';

export type SmartAnalyzerLiquidityInput = {
  rrp?: number;
  fed_balance_sheet_trend?: SmartAnalyzerLiquidityBalanceSheetTrend;
  m2_trend?: SmartAnalyzerDirectionalTrend;
  tga_trend?: SmartAnalyzerDirectionalTrend;
};

export type SmartAnalyzerCreditState = 'EASING' | 'STRESSING' | 'NEUTRAL';

export type SmartAnalyzerCreditInput = {
  hy_oas?: number;
  ig_spread?: number;
  credit_state?: SmartAnalyzerCreditState;
};

export type SmartAnalyzerBreadthState = 'STRONG' | 'WEAK' | 'NEUTRAL';

export type SmartAnalyzerNewHighLowState = 'POSITIVE' | 'NEGATIVE' | 'MIXED';

export type SmartAnalyzerVolumeState = 'EXPANDING_SELL' | 'NORMAL' | 'EXPANDING_BUY';

export type SmartAnalyzerDivergenceState = 'RISK' | 'NONE' | 'POSITIVE';

export type SmartAnalyzerInternalsInput = {
  breadth_state?: SmartAnalyzerBreadthState;
  ad_line_trend?: SmartAnalyzerDirectionalTrend;
  new_high_low_state?: SmartAnalyzerNewHighLowState;
  volume_state?: SmartAnalyzerVolumeState;
  divergence_state?: SmartAnalyzerDivergenceState;
};

export type SmartAnalyzerInput = {
  price_state: string;
  vr_state: string;
  macro_state: string;
  macro_trend: string;
  rates: SmartAnalyzerRatesInput;
  volatility: SmartAnalyzerVolatilityInput;
  drawdown?: SmartAnalyzerDrawdownInput;
  liquidity?: SmartAnalyzerLiquidityInput;
  credit?: SmartAnalyzerCreditInput;
  internals?: SmartAnalyzerInternalsInput;
  news_summary: string[];
};

export type SmartAnalyzerResult = {
  market_type: SmartAnalyzerMarketType;
  confidence: SmartAnalyzerConfidence;
  key_drivers: string[];
  interpretation: string;
  strategy: SmartAnalyzerStrategy;
  summary: string;
  memory: SmartAnalyzerMemorySummary;
  scenario: ScenarioResult;
  bridge: BridgeResult;
  research_desk: ResearchDeskPayload;
  vr_policy: VrPolicyResult;
  vr_runtime_policy: VrRuntimePolicyResult;
  vr_action_policy: VrActionPolicyResult;
  debug: SmartAnalyzerDebug;
  debug_scenario: ScenarioDebug;
  debug_bridge: BridgeDebug;
  debug_vr_policy: VrPolicyDebug;
  debug_vr_runtime_policy: VrRuntimePolicyDebug;
  debug_vr_action_policy: VrActionPolicyDebug;
};

export type SmartAnalyzerEvidence = {
  macro_score: number;
  persistence_score: number;
  reaction_score: number;
  event_score: number;
  velocity_score: number;
  liquidity_score: number;
  credit_score: number;
  internals_score: number;
  shock_flag: boolean;
};

export type SmartAnalyzerDebug = SmartAnalyzerEvidence & {
  classification_reason: string[];
  memory: SmartAnalyzerMemoryDebug;
};
