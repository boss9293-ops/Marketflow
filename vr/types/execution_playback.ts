export type CyclePoolCapOption = '30' | '40' | '50' | 'unlimited'
export type FalseBottomRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type BuyDelayStrength = 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG'
export type ResetConfidence = 'LOW' | 'MEDIUM' | 'HIGH'
export type ResetReason = 'STRUCTURE' | 'REBOUND' | 'EXHAUSTION'
export type FastSnapbackOverrideStrength = 'NONE' | 'WEAK' | 'MODERATE'
export type FastSnapbackOverrideReason = 'SNAPBACK' | 'NO_REENTRY' | 'EARLY_RECOVERY'
export type ExecutionScenarioEngine = 'vfinal' | 'explainable_vr_v1' | 'vr_original_v2'
export type ExplainableVRState = 'NORMAL' | 'WARNING' | 'RISK_OFF' | 'BOTTOM_WATCH' | 'RE_ENTRY'
export type ExplainableVRReasonCode =
  | 'NORMAL'
  | 'WARNING_ENERGY'
  | 'RISK_OFF_BREAK'
  | 'BOTTOM_WATCH_DELAY'
  | 'REENTRY_PARTIAL'
  | 'REENTRY_DELAYED'
  | 'SNAPBACK_ENTRY'
export type ExplainableVRBand = 'LOW' | 'MED' | 'HIGH'

export type ExecutionMarker = {
  date: string
  price: number
  normalized_value: number
  cycle_no: number
  title: string
  reason: string
  marker_type: 'buy' | 'sell' | 'defense' | 'cap_block'
  trigger_source?: 'evaluation_vmax_gate' | 'representative_sell_ladder' | 'defense_reduction' | 'buy_vmin_recovery' | 'cycle_cap_block'
  ladder_level_hit?: number | null
  sell_gate_open?: boolean
  share_delta?: number
  blocked_level_no?: number
  shares_after_trade: number
  avg_cost_after_trade: number
  pool_cash_after_trade: number
  total_portfolio_value?: number
  cycle_pool_used_pct: number
  evaluation_value?: number
  vref_eval?: number
  vmin_eval?: number
  vmax_eval?: number
  state_after_trade?: string
}

export type ExecutionZone = {
  start_date: string
  end_date: string
  label: string
}

export type ExecutionPoint = {
  date: string
  in_event: boolean
  cycle_no: number | null
  day_in_cycle: number | null
  asset_price: number
  evaluation_value_before_trade: number
  evaluation_value: number
  evaluation_normalized: number
  tqqq_price_normalized: number
  portfolio_value_before_trade: number
  portfolio_value: number
  portfolio_normalized: number
  vref_eval: number | null
  vmin_eval: number | null
  vmax_eval: number | null
  vref_line: number | null
  vmin_line: number | null
  vmax_line: number | null
  vref_price: number | null
  vmin_price: number | null
  vmax_price: number | null
  avg_cost_after_trade: number
  avg_cost_normalized: number
  shares_before_trade: number
  shares_after_trade: number
  pool_cash_before_trade: number
  pool_cash_after_trade: number
  cycle_pool_used_pct: number
  cycle_pool_cap_pct: number | null
  cumulative_pool_spent: number
  buy_blocked_by_cycle_cap: boolean
  false_bottom_risk_level: FalseBottomRiskLevel
  buy_delay_flag: boolean
  delay_strength: BuyDelayStrength
  reset_ready_flag: boolean
  reset_confidence: ResetConfidence
  reset_reason: ResetReason
  fast_snapback_flag: boolean
  override_strength: FastSnapbackOverrideStrength
  override_reason: FastSnapbackOverrideReason
  snapback_candidate_flag: boolean
  low_reentry_flag: boolean
  first_buy_override_used: boolean
  override_triggered: boolean
  trade_reason: string | null
  state_after_trade: string
  structural_state: 'NONE' | 'STRUCTURAL_WATCH' | 'STRUCTURAL_STRESS' | 'STRUCTURAL_CRASH'
  explainable_state: ExplainableVRState | null
  explainable_prev_state: ExplainableVRState | null
  explainable_state_days: number | null
  explainable_delay_counter: number | null
  explainable_partial_entry_stage: number | null
  explainable_exposure_target: number | null
  explainable_buy_allowed: boolean
  explainable_sell_allowed: boolean
  explainable_reentry_allowed: boolean
  explainable_reason_code: ExplainableVRReasonCode | null
  explainable_energy_score: ExplainableVRBand | null
  explainable_lower_high_count: number | null
  explainable_lower_low_count: number | null
  explainable_recovery_quality: ExplainableVRBand | null
  explainable_retest_risk: 'LOW' | 'HIGH' | null
}

export type PoolUsageSummary = {
  initial_pool_cash: number
  cycle_pool_cap_pct: number | null
  cycle_pool_used_pct: number
  active_cycle_pool_used_pct: number
  pool_cash_remaining: number
  cumulative_pool_spent: number
  blocked_buy_count: number
  deferred_buy_count: number
  false_bottom_risk_level: FalseBottomRiskLevel
  buy_delay_flag: boolean
  delay_strength: BuyDelayStrength
  reset_ready_flag: boolean
  reset_confidence: ResetConfidence
  reset_reason: ResetReason
  fast_snapback_flag: boolean
  override_strength: FastSnapbackOverrideStrength
  override_reason: FastSnapbackOverrideReason
  snapback_candidate_flag: boolean
  low_reentry_flag: boolean
  first_buy_override_used: boolean
  override_triggered: boolean
  guard_partial_buy_count: number
  guard_delayed_buy_count: number
  guard_blocked_buy_count: number
  executed_buy_count: number
  executed_sell_count: number
  executed_defense_count: number
  active_cycle_no: number | null
  active_cycle_blocked_buy_count: number
  last_trade_date: string | null
}

export type ExecutionDebugRecord = {
  replay_date: string
  cycle_no: number | null
  state_before: string
  buy_signal: boolean
  sell_signal: boolean
  defense_signal: boolean
  trade_executed: boolean
  trade_type: 'buy' | 'sell' | 'defense' | 'blocked_buy' | null
  trigger_source: 'evaluation_vmax_gate' | 'representative_sell_ladder' | 'defense_reduction' | 'buy_vmin_recovery' | 'cycle_cap_block' | null
  ladder_level_hit: number | null
  trade_price: number | null
  stock_evaluation_value: number
  vref_eval: number | null
  vmax_eval: number | null
  sell_gate_open: boolean
  shares_before: number
  shares_after: number
  avg_cost_before: number
  avg_cost_after: number
  pool_cash_before: number
  pool_cash_after: number
  cycle_pool_used_pct: number
  blocked_by_cap: boolean
  false_bottom_risk_level: FalseBottomRiskLevel
  buy_delay_flag: boolean
  delay_strength: BuyDelayStrength
  reset_ready_flag: boolean
  reset_confidence: ResetConfidence
  reset_reason: ResetReason
  fast_snapback_flag: boolean
  override_strength: FastSnapbackOverrideStrength
  override_reason: FastSnapbackOverrideReason
  snapback_candidate_flag: boolean
  low_reentry_flag: boolean
  first_buy_override_used: boolean
  override_triggered: boolean
  state_after: string
}

export type ExecutionValidationSummary = {
  has_buy_execution: boolean
  has_sell_execution: boolean
  has_defense_execution: boolean
  avg_cost_changed: boolean
  shares_changed: boolean
  pool_cash_changed: boolean
  blocked_by_cap_observed: boolean
  executed_buy_count: number
  executed_sell_count: number
  executed_defense_count: number
  blocked_buy_count: number
}

export type MarketStructurePlayback = {
  rows: Array<{
    date: string
    tqqq_price: number
    ma50: number | null
    ma200: number | null
  }>
  tqqq_price_series: Array<{ date: string; value: number }>
  ma50_series: Array<{ date: string; value: number | null }>
  ma200_series: Array<{ date: string; value: number | null }>
  cycle_boundaries: Array<{ date: string; cycle_no: number }>
  event_window: { start_date: string; end_date: string }
  breach_points: Array<{ date: string; title: string; value: number }>
  recovery_markers: Array<{ date: string; title: string; value: number }>
}

export type ExecutionFocusWindow = {
  mode: 'auto_focus'
  start_date: string
  end_date: string
  first_buy_signal_date: string | null
  first_defense_date: string | null
  first_vmin_break_date: string | null
  event_low_date: string | null
}

export type CycleExecutionSummary = {
  cycle_no: number
  cycle_window: string
  start_date: string
  end_date: string
  in_event: boolean
  vref_eval: number
  vmin_eval: number
  vmax_eval: number
  start_evaluation_value: number
  avg_evaluation_value: number
  end_evaluation_value: number
  start_pool_cash: number
  start_pool_pct: number
  end_pool_cash: number
  end_pool_pct: number
  avg_avg_cost: number
  avg_execution_price: number | null
  avg_buy_price: number | null
  avg_sell_price: number | null
  pool_spent_in_cycle: number
  pool_used_pct_in_cycle: number
  end_shares: number
  end_avg_cost: number
  ending_state: string
  buy_count: number
  sell_count: number
  defense_count: number
  blocked_buy_count: number
  scenario_bias: string[]
  playbook_bias: string[]
}

export type ExecutionPlaybackVariant = {
  engine_id: ExecutionScenarioEngine | 'original'
  engine_label: string
  cap_option: CyclePoolCapOption
  cap_label: string
  sell_policy: {
    vmax_visual_only: boolean
    sell_only_on_defense: boolean
    allow_first_cycle_sell: boolean
  }
  points: ExecutionPoint[]
  buy_markers: ExecutionMarker[]
  sell_markers: ExecutionMarker[]
  defense_markers: ExecutionMarker[]
  avg_cost_line: Array<{ date: string; value: number }>
  pool_cap_flags: ExecutionMarker[]
  vmin_recovery_attempt_zones: ExecutionZone[]
  failed_recovery_zones: ExecutionZone[]
  scenario_phase_zones: ExecutionZone[]
  pool_usage_summary: PoolUsageSummary
  trade_log: ExecutionDebugRecord[]
  validation_summary: ExecutionValidationSummary
  market_chart: MarketStructurePlayback
  cycle_summaries: CycleExecutionSummary[]
  focus_window: ExecutionFocusWindow | null
}

export type VRExecutionSummary = {
  buy_count: number
  sell_count: number
  defense_count: number
  buy_pause_count: number
  total_pool_spent: number
  lowest_pool_remaining: number
  avg_cost_at_event_low: number | null
  final_evaluation_value: number
  final_portfolio_value: number
  final_unrealized_pl: number
  final_pool_cash_remaining: number
  final_pool_used_pct: number
}

export type VRComparisonMetric = {
  label: string
  original_value: string
  scenario_value: string
  difference: string
}

export type VRBehaviorDifferenceRow = {
  label: string
  original_value: string
  scenario_value: string
}

export type VRComparisonView = {
  chart_rows: Array<{
    date: string
    original_evaluation_value: number
    scenario_evaluation_value: number
    original_portfolio_value: number
    scenario_portfolio_value: number
    original_pool_remaining: number
    scenario_pool_remaining: number
  }>
  original_summary: VRExecutionSummary
  scenario_summary: VRExecutionSummary
  metric_cards: VRComparisonMetric[]
  behavior_rows: VRBehaviorDifferenceRow[]
  interpretation: {
    headline: string
    subline: string
  }
}

export type ExecutionPlaybackCollection = {
  default_cap_option: CyclePoolCapOption
  // Playback-only archive replay baseline. Distinct from Arena "Original VR (Scaled)".
  original_vr: ExecutionPlaybackVariant
  // VR Original V2: frozen benchmark engine with 50%-of-remaining pool deployment. DO NOT MODIFY.
  vr_original_v2_vr?: ExecutionPlaybackVariant
  variants: Partial<Record<CyclePoolCapOption, ExecutionPlaybackVariant>>
  comparison_by_cap: Partial<Record<CyclePoolCapOption, VRComparisonView>>
}
