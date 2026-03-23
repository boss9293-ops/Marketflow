'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import HistoricalAnalogPanel, { type HistoricalAnalogSummary } from './HistoricalAnalogPanel'
import { StrategyLabTab, type LabEvent } from './StrategyLabTab'
import ScenarioEnginePanel from './ScenarioEnginePanel'
import SuggestedPostureStrip, { type VRPostureMessage } from './SuggestedPostureStrip'
import VrActionAuditCard from '../../vr/VrActionAuditCard'
import VrTimelinePanel from '../../vr/VrTimelinePanel'
import type { VrAuditViewPayload } from '../../../lib/formatVrAudit'
import type { InvestorActionViewPayload } from '../../../types/investorAction'
import InvestorActionBadgeRow from '../../dashboard/InvestorActionBadgeRow'
import type { VrTimelineRow } from '../../../lib/formatVrTimeline'
import OverlayAlignmentBadge from '../../arena/OverlayAlignmentBadge'
import MonteCarloOverlayCard from '../../arena/MonteCarloOverlayCard'
import OverlayScoreStrip from '../../arena/OverlayScoreStrip'
import {
  buildArenaOverlayDisplayModel,
  type ArenaOverlayDisplayModel,
} from '../../../lib/arena/overlay/buildArenaOverlayDisplayModel'
import {
  buildVariantForCap,
  type ExecutionPlaybackSource,
} from '../../../../../../vr/playback/build_execution_playback'
import CycleSummaryCard from '../../vr/CycleSummaryCard'

export type VRSurvivalData = {
  run_id: string
  current: {
    score: number
    level: number
    level_label: string
    state: string
    pool_pct: number
    exposure_pct: number
    survival_active: boolean
    explain: string
    structural_state: string
    shock_cooldown: number
    days_below_ma200: number
    price: number
    ma50: number
    ma200: number
    dd_pct: number
    vol_pct: number
    components: {
      trend: number
      depth: number
      vol: number
      dd: number
    }
  }
  pool_logic: {
    level_pools: Array<{
      level: number
      label: string
      pool: number
      exposure: number
      color: string
    }>
  }
}

export type ETFRoomData = {
  sections?: {
    leverage?: {
      items?: Array<{
        symbol: string
        name: string
        ret_1d: number | null
        ret_5d: number | null
        ret_20d: number | null
        vol_surge: number | null
        above_sma50: boolean | null
        above_sma200: boolean | null
      }>
    }
  }
}

export type VRDashboardPatternSummary = {
  snapshot?: {
    as_of_date: string
    market_pattern: string
    nasdaq_drawdown: string
    tqqq_drawdown: string
    ma200_status: string
    market_structure: string
    volatility_regime: string
    recommended_posture: string[]
  }
  posture_message?: VRPostureMessage
  historical_analogs?: HistoricalAnalogSummary
  top_matches: Array<{
    pattern_id: string
    pattern_name: string
    score: number
    explanation?: string[]
  }>
  scenarios: Array<{
    scenario_id: string
    scenario_name: string
    description: string
    posture_guidance: string[]
  }>
  suggested_posture?: string[]
}

type VRPlaybackEventView = {
  id: string
  suite_id: string
  event_id: string
  name: string
  archive_name: string
  suite_group: 'Crash Tests' | 'Leverage Stress' | 'Corrections'
  suite_note: string
  start: string
  end: string
  duration_days: number
  standard_context?: string
  standard_explanation?: string
  vr_support_status: 'ready' | 'partial' | 'pending_synthetic'
  placeholder_messages: string[]
  chart_data: Array<{
    date: string
    qqq_n: number | null
    tqqq_n: number | null
    ma50_n: number | null
    ma200_n: number | null
    qqq_dd: number | null
    tqqq_dd: number | null
    in_event: boolean
  }>
  leveraged_stress: {
    qqq_drawdown_pct: number | null
    tqqq_drawdown_pct: number | null
    amplification: number | null
    real_tqqq_available: boolean
    tqqq_source: 'real' | 'synthetic' | 'unavailable'
  }
  recovery_path: {
    rebound_strength_pct: number | null
    rebound_persistence: string
    lower_high_failure_risk: string
    secondary_drawdown_risk: string
  }
  vr_tagged_event: {
    source?: 'priority_tag' | 'fallback'
    vr_support_status: 'ready' | 'partial' | 'pending_synthetic'
    vr_analysis: {
      pattern_type?: string
      ma200_status?: string
      leverage_stress?: 'low' | 'medium' | 'high' | 'extreme'
      recovery_quality?: 'weak' | 'mixed' | 'improving' | 'strong'
      tags: string[]
      lesson?: string
      scenario_bias?: string[]
      playbook_bias?: string[]
    }
  }
  pattern_matches: {
    top_matches: Array<{
      pattern_id: string
      pattern_name: string
      score: number
      explanation?: string[]
    }>
  }
  scenario_playbook: {
    primary_pattern: {
      pattern_id: string
      pattern_name: string
      score: number
    } | null
    scenarios: Array<{
      scenario_id: string
      scenario_name: string
      description: string
      posture_guidance: string[]
    }>
  }
  cycle_start: {
    event_id: string
    ticker: 'TQQQ'
    event_start_date: string
    event_end_date: string
    simulation_start_date: string | null
    default_warmup_trading_days: number
    requested_warmup_trading_days: number
    initial_state: {
      initial_capital: number
      stock_allocation_pct: number
      pool_allocation_pct: number
      start_price: number
      initial_share_count: number
      initial_average_price: number
      initial_stock_cost: number
      initial_pool_cash: number
    } | null
    available_start_options: Array<{
      date: string
      start_price: number
      price_source: 'real_tqqq' | 'synthetic_tqqq_3x'
    }>
    validation: {
      valid: boolean
      errors: string[]
    }
    lookup_error?: string
    manual_start_price_override_allowed: boolean
    cycle_placeholders: {
      vref: number | null
      vmin: number | null
      vmax: number | null
      cycle_no: number | null
      cycle_start_date: string | null
      cycle_end_date: string | null
    }
  }
  cycle_framework: {
    cycles: Array<{
      cycle_no: number
      cycle_start_date: string
      cycle_end_date: string
      event_id: string
      event_date: string
      is_active_cycle: boolean
      days_from_event_start: number
      days_to_event_end: number
      vref: number | null
      vmin: number | null
      vmax: number | null
      ma200_status: string | null
      leverage_stress: string | null
      recovery_quality: string | null
      pattern_type: string | null
      scenario_bias: string[]
      playbook_bias: string[]
      buy_permission_state: 'pending' | 'allowed' | 'paused' | 'active' | 'monitoring'
      defense_state: 'pending' | 'allowed' | 'paused' | 'active' | 'monitoring'
      theoretical_buy_grid: Array<{
        level_no: number
        price: number
        weight: number
        status: 'pending' | 'ready' | 'watch'
        touched: boolean
        executed: boolean
        note: string
      }>
      theoretical_sell_grid: Array<{
        level_no: number
        price: number
        weight: number
        status: 'pending' | 'ready' | 'watch'
        touched: boolean
        executed: boolean
        note: string
      }>
      representative_buy_grid: Array<{
        level_no: number
        price: number
        weight: number
        status: 'pending' | 'ready' | 'watch'
        touched: boolean
        executed: boolean
        note: string
      }>
      representative_sell_grid: Array<{
        level_no: number
        price: number
        weight: number
        status: 'pending' | 'ready' | 'watch'
        touched: boolean
        executed: boolean
        note: string
      }>
    }>
    active_selection: {
      active_cycle: {
        cycle_no: number
        cycle_start_date: string
        cycle_end_date: string
        representative_buy_grid: Array<{ level_no: number; price: number; weight: number; status: string; touched: boolean; executed: boolean; note: string }>
        representative_sell_grid: Array<{ level_no: number; price: number; weight: number; status: string; touched: boolean; executed: boolean; note: string }>
      } | null
      previous_cycle: {
        cycle_no: number
        cycle_start_date: string
        cycle_end_date: string
      } | null
      next_cycle: {
        cycle_no: number
        cycle_start_date: string
        cycle_end_date: string
      } | null
      active_cycle_index: number
    }
    snapshot: {
      cycle_no: number
      cycle_window: string
      vref: string
      vmin: string
      vmax: string
      pattern_type: string
      ma200_status: string
      leverage_stress: string
      recovery_quality: string
      buy_permission: string
      defense_state: string
      scenario_bias: string[]
      playbook_bias: string[]
      representative_buy_levels: string[]
      representative_sell_levels: string[]
      key_trigger_notes: string[]
    } | null
    trigger_log: Array<{
      timestamp: string
      cycle_no: number
      event_type: string
      severity: 'info' | 'watch' | 'warning' | 'critical'
      title: string
      message: string
      source: string
      related_metric: string | null
      related_value: string | number | null
      note: string | null
    }>
    chart_overlay: {
      cycle_boundary_markers: Array<{
        date: string
        cycle_no: number
        label: string
      }>
      active_cycle_highlight: {
        start_date: string
        end_date: string
      } | null
      reference_lines: Array<{
        line_type: 'vref' | 'vmin' | 'vmax'
        cycle_no: number
        value: number | null
        start_date: string
        end_date: string
      }>
      representative_buy_markers: Array<{
        date: string
        cycle_no: number
        level_no: number
        price: number
      }>
      representative_sell_markers: Array<{
        date: string
        cycle_no: number
        level_no: number
        price: number
      }>
      trigger_flags: Array<{
        date: string
        cycle_no: number
        title: string
        severity: 'info' | 'watch' | 'warning' | 'critical'
      }>
    }
  }
  execution_playback: {
    default_cap_option: '30' | '40' | '50' | 'unlimited'
    original_vr: {
      cap_option: '30' | '40' | '50' | 'unlimited'
      cap_label: string
      points: Array<{
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
        false_bottom_risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
        buy_delay_flag: boolean
        delay_strength: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG'
        reset_ready_flag: boolean
        reset_confidence: 'LOW' | 'MEDIUM' | 'HIGH'
        reset_reason: 'STRUCTURE' | 'REBOUND' | 'EXHAUSTION'
        trade_reason: string | null
        state_after_trade: string
      }>
      buy_markers: Array<{
        date: string; price: number; normalized_value: number; cycle_no: number;
        title: string; reason: string; marker_type: 'buy' | 'sell' | 'defense' | 'cap_block';
        trigger_source?: string; ladder_level_hit?: number | null; sell_gate_open?: boolean;
        share_delta?: number; blocked_level_no?: number; shares_after_trade: number;
        avg_cost_after_trade: number; pool_cash_after_trade: number; total_portfolio_value?: number;
        cycle_pool_used_pct: number; evaluation_value?: number;
        vref_eval?: number; vmin_eval?: number; vmax_eval?: number; state_after_trade?: string;
      }>
      sell_markers: Array<{
        date: string; price: number; normalized_value: number; cycle_no: number;
        title: string; reason: string; marker_type: 'buy' | 'sell' | 'defense' | 'cap_block';
        trigger_source?: string; ladder_level_hit?: number | null; sell_gate_open?: boolean;
        share_delta?: number; blocked_level_no?: number; shares_after_trade: number;
        avg_cost_after_trade: number; pool_cash_after_trade: number; total_portfolio_value?: number;
        cycle_pool_used_pct: number; evaluation_value?: number;
        vref_eval?: number; vmin_eval?: number; vmax_eval?: number; state_after_trade?: string;
      }>
      defense_markers: Array<{
        date: string; price: number; normalized_value: number; cycle_no: number;
        title: string; reason: string; marker_type: 'buy' | 'sell' | 'defense' | 'cap_block';
        trigger_source?: string; ladder_level_hit?: number | null; sell_gate_open?: boolean;
        share_delta?: number; blocked_level_no?: number; shares_after_trade: number;
        avg_cost_after_trade: number; pool_cash_after_trade: number; total_portfolio_value?: number;
        cycle_pool_used_pct: number; evaluation_value?: number;
        vref_eval?: number; vmin_eval?: number; vmax_eval?: number; state_after_trade?: string;
      }>
      avg_cost_line: Array<{ date: string; value: number }>
      pool_cap_flags: Array<{
        date: string; price: number; normalized_value: number; cycle_no: number;
        title: string; reason: string; marker_type: 'buy' | 'sell' | 'defense' | 'cap_block';
        trigger_source?: string; ladder_level_hit?: number | null; sell_gate_open?: boolean;
        share_delta?: number; blocked_level_no?: number; shares_after_trade: number;
        avg_cost_after_trade: number; pool_cash_after_trade: number; total_portfolio_value?: number;
        cycle_pool_used_pct: number; evaluation_value?: number;
        vref_eval?: number; vmin_eval?: number; vmax_eval?: number; state_after_trade?: string;
      }>
      vmin_recovery_attempt_zones: Array<{ start_date: string; end_date: string; label: string }>
      failed_recovery_zones: Array<{ start_date: string; end_date: string; label: string }>
      scenario_phase_zones: Array<{ start_date: string; end_date: string; label: string }>
      pool_usage_summary: {
        initial_pool_cash: number
        cycle_pool_cap_pct: number | null
        cycle_pool_used_pct: number
        active_cycle_pool_used_pct: number
        pool_cash_remaining: number
        cumulative_pool_spent: number
        blocked_buy_count: number
        deferred_buy_count: number
        false_bottom_risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
        buy_delay_flag: boolean
        delay_strength: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG'
        reset_ready_flag: boolean
        reset_confidence: 'LOW' | 'MEDIUM' | 'HIGH'
        reset_reason: 'STRUCTURE' | 'REBOUND' | 'EXHAUSTION'
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
      trade_log: Array<{
        replay_date: string; cycle_no: number | null; state_before: string; buy_signal: boolean; sell_signal: boolean;
        defense_signal: boolean; trade_executed: boolean; trade_type: 'buy' | 'sell' | 'defense' | 'blocked_buy' | null;
        trigger_source: string | null; ladder_level_hit: number | null; trade_price: number | null;
        stock_evaluation_value: number; vref_eval: number | null; vmax_eval: number | null; sell_gate_open: boolean;
        shares_before: number; shares_after: number; avg_cost_before: number; avg_cost_after: number;
        pool_cash_before: number; pool_cash_after: number; cycle_pool_used_pct: number; blocked_by_cap: boolean;
        false_bottom_risk_level: 'LOW' | 'MEDIUM' | 'HIGH'; buy_delay_flag: boolean; delay_strength: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG'; reset_ready_flag: boolean; reset_confidence: 'LOW' | 'MEDIUM' | 'HIGH'; reset_reason: 'STRUCTURE' | 'REBOUND' | 'EXHAUSTION'; state_after: string;
      }>
      validation_summary: {
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
      market_chart: {
        rows: Array<{ date: string; tqqq_price: number; ma50: number | null; ma200: number | null }>
        tqqq_price_series: Array<{ date: string; value: number }>
        ma50_series: Array<{ date: string; value: number | null }>
        ma200_series: Array<{ date: string; value: number | null }>
        cycle_boundaries: Array<{ date: string; cycle_no: number }>
        event_window: { start_date: string; end_date: string }
        breach_points: Array<{ date: string; title: string; value: number }>
        recovery_markers: Array<{ date: string; title: string; value: number }>
      }
      cycle_summaries: Array<{
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
      }>
      focus_window: {
        mode: 'auto_focus'
        start_date: string
        end_date: string
        first_buy_signal_date: string | null
        first_defense_date: string | null
        first_vmin_break_date: string | null
        event_low_date: string | null
      } | null
    }
    variants: Partial<Record<
      '30' | '40' | '50' | 'unlimited',
      {
        cap_option: '30' | '40' | '50' | 'unlimited'
        cap_label: string
        sell_policy: {
          vmax_visual_only: boolean
          sell_only_on_defense: boolean
          allow_first_cycle_sell: boolean
        }
      points: Array<{
        date: string
        in_event: boolean
        cycle_no: number | null
        asset_price: number
        evaluation_value: number
        evaluation_normalized: number
        tqqq_price_normalized: number
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
          shares_after_trade: number
          pool_cash_after_trade: number
          cycle_pool_used_pct: number
          cycle_pool_cap_pct: number | null
          cumulative_pool_spent: number
          buy_blocked_by_cycle_cap: boolean
          false_bottom_risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
          buy_delay_flag: boolean
          delay_strength: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG'
          reset_ready_flag: boolean
          reset_confidence: 'LOW' | 'MEDIUM' | 'HIGH'
          reset_reason: 'STRUCTURE' | 'REBOUND' | 'EXHAUSTION'
          trade_reason: string | null
          state_after_trade: string
        }>
        buy_markers: Array<{
          date: string
          price: number
          normalized_value: number
          cycle_no: number
          title: string
          reason: string
          marker_type: 'buy' | 'sell' | 'defense' | 'cap_block'
          trigger_source?: string
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
        }>
        sell_markers: Array<{
          date: string
          price: number
          normalized_value: number
          cycle_no: number
          title: string
          reason: string
          marker_type: 'buy' | 'sell' | 'defense' | 'cap_block'
          trigger_source?: string
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
        }>
        defense_markers: Array<{
          date: string
          price: number
          normalized_value: number
          cycle_no: number
          title: string
          reason: string
          marker_type: 'buy' | 'sell' | 'defense' | 'cap_block'
          trigger_source?: string
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
        }>
        avg_cost_line: Array<{ date: string; value: number }>
        pool_cap_flags: Array<{
          date: string
          price: number
          normalized_value: number
          cycle_no: number
          title: string
          reason: string
          marker_type: 'buy' | 'sell' | 'defense' | 'cap_block'
          trigger_source?: string
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
        }>
        vmin_recovery_attempt_zones: Array<{
          start_date: string
          end_date: string
          label: string
        }>
        failed_recovery_zones: Array<{
          start_date: string
          end_date: string
          label: string
        }>
        scenario_phase_zones: Array<{
          start_date: string
          end_date: string
          label: string
        }>
        pool_usage_summary: {
          cycle_pool_cap_pct: number | null
          cycle_pool_used_pct: number
          active_cycle_pool_used_pct: number
          pool_cash_remaining: number
          cumulative_pool_spent: number
          blocked_buy_count: number
          deferred_buy_count: number
          false_bottom_risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
          buy_delay_flag: boolean
          delay_strength: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG'
          reset_ready_flag: boolean
          reset_confidence: 'LOW' | 'MEDIUM' | 'HIGH'
          reset_reason: 'STRUCTURE' | 'REBOUND' | 'EXHAUSTION'
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
        trade_log: Array<{
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
          false_bottom_risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
          buy_delay_flag: boolean
          delay_strength: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG'
          reset_ready_flag: boolean
          reset_confidence: 'LOW' | 'MEDIUM' | 'HIGH'
          reset_reason: 'STRUCTURE' | 'REBOUND' | 'EXHAUSTION'
          state_after: string
        }>
        validation_summary: {
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
        market_chart: {
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
        cycle_summaries: Array<{
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
        }>
        focus_window: {
          mode: 'auto_focus'
          start_date: string
          end_date: string
          first_buy_signal_date: string | null
          first_defense_date: string | null
          first_vmin_break_date: string | null
          event_low_date: string | null
        } | null
      }
    >>
    comparison_by_cap: Partial<Record<
      '30' | '40' | '50' | 'unlimited',
      {
        chart_rows: Array<{
          date: string
          original_evaluation_value: number
          scenario_evaluation_value: number
          original_portfolio_value: number
          scenario_portfolio_value: number
          original_pool_remaining: number
          scenario_pool_remaining: number
        }>
        original_summary: {
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
        scenario_summary: {
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
        metric_cards: Array<{
          label: string
          original_value: string
          scenario_value: string
          difference: string
        }>
        behavior_rows: Array<{
          label: string
          original_value: string
          scenario_value: string
        }>
        interpretation: {
          headline: string
          subline: string
        }
      }
    >>
  }
}

type VRPlaybackView = {
  events: VRPlaybackEventView[]
  archive_event_count: number
}

const PLAYBACK_SUITE_GROUP_ORDER: Array<VRPlaybackEventView['suite_group']> = ['Crash Tests', 'Leverage Stress', 'Corrections']

type StrategyArenaView = {
  events: Array<{
    id: string
    label: string
    standard_event_name: string
    playback_event_id: string
    start: string
    end: string
    vr_source: 'survival_archive' | null
    adaptive_exposure_report?: {
      event: string
      initial_state: {
        exposure: number
        reason: string
      }
      full_transitions: Array<{
        date: string
        from_exposure: number
        to_exposure: number
        reason: string
        asset_n: number
        tqqq_ma200_n: number | null
        dd3: number | null
        dd5: number | null
        peak_dd: number | null
        rebound_from_low: number | null
      }>
      visible_transitions: Array<{
        date: string
        from_exposure: number
        to_exposure: number
        reason: string
        asset_n: number
        tqqq_ma200_n: number | null
        dd3: number | null
        dd5: number | null
        peak_dd: number | null
        rebound_from_low: number | null
      }>
    }
    strategy_reports?: Partial<
      Record<
        string,
        {
          initial_state: {
            exposure: number
            reason: string
          }
          full_transitions: Array<{
            date: string
            from_exposure: number
            to_exposure: number
            reason: string
          }>
          visible_transitions: Array<{
            date: string
            from_exposure: number
            to_exposure: number
            reason: string
          }>
        }
      >
    >
    warning_layer?: {
      warning_state: 'NORMAL' | 'WATCH' | 'ALERT' | 'DEFENSE_READY' | 'DEFENSE_ACTIVE' | 'RECOVERY_MODE'
      peak_warning_state: 'NORMAL' | 'WATCH' | 'ALERT' | 'DEFENSE_READY' | 'DEFENSE_ACTIVE' | 'RECOVERY_MODE'
      warning_reason: string
      trigger_metrics: {
        dd3: number | null
        dd5: number | null
        dd6: number | null
        peakDD: number | null
        rebound_from_low_pct: number | null
        distance_to_ma200_pct: number | null
        vr_band_level: number | null
      }
      scenario_hint: 'V' | 'Correction' | 'Bear' | 'Mixed'
      mc_overlay: {
        mcCrashRiskScore: number
        mcBearPathSimilarity: number
        mcVShapeOdds20d: number
        mcRecoveryOdds20d: number
        mcCashStressRisk: number
        mcFalseRecoveryRisk: number
        mcWarningConfidence: number
        dominantMcScenario: 'V' | 'Correction' | 'Bear' | 'Mixed'
        mcCurrentRegime: 'NORMAL' | 'SELLOFF' | 'PANIC' | 'BOTTOMING' | 'RECOVERY'
        mcNextStateOdds: {
          NORMAL: number
          SELLOFF: number
          PANIC: number
          BOTTOMING: number
          RECOVERY: number
        }
        mcPanicPersistenceRisk: number
        mcRecoveryTransitionOdds: number
        mcRegimeConfidence: number
        mcAgreementScore: number
        mcConflictScore: number
        mcInterpretationState:
          | 'STRONG_BEAR_CONFIRMATION'
          | 'WEAK_BEAR'
          | 'MIXED'
          | 'EARLY_RECOVERY'
          | 'FALSE_RECOVERY_RISK'
          | 'HIGH_UNCERTAINTY'
        mcAgreementReason: string
        mcTrustScore: number
        mcCalibrationBucket: 'HIGH_CONFIDENCE' | 'MEDIUM_CONFIDENCE' | 'LOW_CONFIDENCE'
        overlayReason: string
      } | null
      full_transitions: Array<{
        date: string
        from_state: 'NORMAL' | 'WATCH' | 'ALERT' | 'DEFENSE_READY' | 'DEFENSE_ACTIVE' | 'RECOVERY_MODE'
        to_state: 'NORMAL' | 'WATCH' | 'ALERT' | 'DEFENSE_READY' | 'DEFENSE_ACTIVE' | 'RECOVERY_MODE'
        reason: string
      }>
      visible_transitions: Array<{
        date: string
        from_state: 'NORMAL' | 'WATCH' | 'ALERT' | 'DEFENSE_READY' | 'DEFENSE_ACTIVE' | 'RECOVERY_MODE'
        to_state: 'NORMAL' | 'WATCH' | 'ALERT' | 'DEFENSE_READY' | 'DEFENSE_ACTIVE' | 'RECOVERY_MODE'
        reason: string
      }>
    }
    metrics: Partial<{
      buy_hold: {
        final_return_pct: number
        max_drawdown_pct: number
        recovery_time_days: number | null
        exposure_stability_pct: number
      }
      ma200_risk_control_50: {
        final_return_pct: number
        max_drawdown_pct: number
        recovery_time_days: number | null
        exposure_stability_pct: number
      }
      ma200_lb30_hybrid: {
        final_return_pct: number
        max_drawdown_pct: number
        recovery_time_days: number | null
        exposure_stability_pct: number
      }
      low_based_lb30: {
        final_return_pct: number
        max_drawdown_pct: number
        recovery_time_days: number | null
        exposure_stability_pct: number
      }
      low_based_lb25: {
        final_return_pct: number
        max_drawdown_pct: number
        recovery_time_days: number | null
        exposure_stability_pct: number
      }
      adaptive_exposure: {
        final_return_pct: number
        max_drawdown_pct: number
        recovery_time_days: number | null
        exposure_stability_pct: number
      }
      original_vr_scaled: {
        final_return_pct: number
        max_drawdown_pct: number
        recovery_time_days: number | null
        exposure_stability_pct: number
      }
    }>
    chart_data: Array<{
      date: string
      buy_hold_equity: number
      ma200_risk_control_50_equity: number
      ma200_lb30_hybrid_equity: number
      low_based_lb30_equity: number
      low_based_lb25_equity: number
      adaptive_exposure_equity: number | null
      original_vr_scaled_equity: number | null
      buy_hold_drawdown: number
      ma200_risk_control_50_drawdown: number
      ma200_lb30_hybrid_drawdown: number
      low_based_lb30_drawdown: number
      low_based_lb25_drawdown: number
      adaptive_exposure_drawdown: number | null
      original_vr_scaled_drawdown: number | null
      buy_hold_exposure: number
      ma200_risk_control_50_exposure: number
      ma200_lb30_hybrid_exposure: number
      low_based_lb30_exposure: number
      low_based_lb25_exposure: number
      adaptive_exposure_exposure: number | null
      original_vr_scaled_exposure: number | null
    }>
  }>
  methodology: {
    fixed_stop_loss_rule: string
    ma200_rule: string
    vr_source_priority: string
    warning_layer_rule: string
  }
}

const TABS = ['Overview', 'Strategy Lab', 'Crash Analysis', 'Backtest', 'Playback', 'Pool Logic', 'Options Overlay', 'Philosophy', 'Timeline'] as const
const HEATMAP_SYMBOLS = ['TQQQ', 'SOXL', 'TECL', 'SPXL', 'UPRO', 'LABU'] as const
export type Tab = (typeof TABS)[number]
type HeatmapState = 'Stable' | 'Weak' | 'Fragile' | 'Breakdown Risk' | 'No Data'

const STRATEGY_LABELS = {
  buy_hold: 'Buy & Hold',
  ma200_risk_control_50: 'MA200 (50%)',
  ma200_lb30_hybrid: 'MA200 + LB30',
  low_based_lb30: 'LB30',
  low_based_lb25: 'LB25',
  adaptive_exposure: 'Adaptive Exposure',
  original_vr_scaled: 'VR Original (Capped)',
} as const

const STRATEGY_CHIP_LABELS = {
  buy_hold: 'Buy & Hold',
  ma200_risk_control_50: 'MA200 (50%)',
  ma200_lb30_hybrid: 'MA200 + LB30',
  low_based_lb30: 'LB30',
  low_based_lb25: 'LB25',
  adaptive_exposure: 'Adaptive Exposure',
  original_vr_scaled: 'VR Original (Capped)',
} as const

const STRATEGY_COLORS = {
  buy_hold: '#9CA3AF',
  ma200_risk_control_50: '#F59E0B',
  ma200_lb30_hybrid: '#C084FC',
  low_based_lb30: '#14B8A6',
  low_based_lb25: '#22D3EE',
  adaptive_exposure: '#10B981',
  original_vr_scaled: '#3B82F6',
} as const

type StrategyArenaKey = keyof typeof STRATEGY_LABELS

const ARENA_BACKTEST_TEXT = {
  en: {
    backtest: {
      philosophy: {
        eyebrow: 'Backtest Philosophy',
        title: 'Positioning Map, Not Winner Selection',
        body: [
          'This backtest is not designed to identify the best strategy.',
          'Instead, it shows how different approaches are positioned under the same market conditions.',
          'Each approach reflects a different balance between risk, drawdown, recovery behavior, and psychological stability.',
          'The warning layer comes before execution. It is designed to flag abnormal downside behavior early, not to auto-trade by itself.',
        ],
        footer: 'Backtest is a map, not the answer.',
      },
      conditions: {
        eyebrow: 'Test Conditions',
        title: 'What This Comparison Is Testing',
        labels: {
          period: 'Period',
          asset: 'Asset',
          execution: 'Execution',
          purpose: 'Purpose',
          note: 'Important Note',
        },
        asset: {
          name: 'TQQQ',
          detail: 'A 3x leveraged Nasdaq-100 ETF with much higher volatility than standard ETFs.',
        },
        execution:
          'Signals are evaluated at the close of each trading day and applied on the next trading session. All Arena strategies begin from the same 80% invested / 20% cash allocation.',
        purpose:
          'This comparison is intended to show positioning differences, not to determine a superior strategy.',
        note:
          'Leveraged ETFs amplify both gains and losses, which can lead to large drawdowns and rapid rebounds.',
        marketContextByEventId: {
          '2008-crash': 'A prolonged global deleveraging period tied to the credit crisis.',
          '2011-debt-crisis': 'US downgrade stress and Eurozone instability created a sharp risk-off phase.',
          '2018-volmageddon': 'A volatility shock and rapid deleveraging event hit leveraged Nasdaq exposure.',
          '2020-covid-crash': 'Pandemic panic and policy shock created a historic crash followed by a violent rebound.',
          '2022-bear-market': 'A prolonged bearish market with rising rates and persistent inflation pressure.',
          '2024-yen-carry': 'A fast unwind in crowded risk positioning produced a sharp selloff and rebound.',
          '2025-tariff':
            'This period reflects tariff-related uncertainty and policy-driven volatility. Markets experienced intermittent drawdowns, uneven recoveries, and elevated sensitivity to macro and geopolitical signals.',
        },
        purposeByEventId: {
          '2025-tariff':
            'To observe how different approaches behave under non-linear, macro-driven stress conditions.',
        },
      },
        summary: {
          adaptive: {
            title: 'Adaptive Exposure',
            fallback: 'Featured advanced defensive approach',
          },
          lb30: {
            title: 'LB30',
            detail: 'Default low-based recovery | Slower re-risking, lower flip-flop',
          },
          ma200: {
            title: 'MA200 (50%)',
            detail: 'Psychological stability reference | Simpler, slower response',
          },
          hybrid: {
            title: 'MA200 + LB30',
            detail: 'MA200 defense with low-based recovery | Hybrid reference',
          },
          vr: {
            title: 'VR Original (Capped)',
            detail: 'Original VR reference | Core comparison baseline from the VR family',
          },
        },
    },
    strategy: {
      buy_hold:
        'Starts with 80% invested in TQQQ and keeps a permanent 20% cash reserve. It does not rebalance, defend, or re-enter, so it serves as the plain market baseline under the shared Arena allocation.',
      ma200_risk_control:
        'Starts from the shared 80 / 20 Arena allocation, moves to cash below the 200-day moving average, and restores to the 80% invested cap above it. This is a stricter research reference, not the main anchor for this page.',
      ma200_risk_control_50:
        'Starts from the shared 80 / 20 Arena allocation, reduces exposure to 50% when price falls below the 200-day moving average, and restores to the 80% invested cap when price recovers above it. Its primary purpose is psychological stability, helping investors stay invested during large drawdowns. This is a familiar reference approach, not a return-maximizing strategy.',
      ma200_risk_control_50_early_rebuy:
        'A traditional MA200-based defensive approach with an optional early re-entry feature. After reducing exposure below the 200-day moving average, a partial re-entry is triggered if price rebounds significantly from the local low. This helps reduce delayed re-entry during recovery phases while keeping the MA200 framework intact.',
      ma200_lb30_hybrid:
        'Uses a simple MA200 defense on the way down, then re-adds risk through the LB30 low-based rebound ladder instead of waiting for a full MA200-only recovery.',
      fixed_stop_loss:
        'A hard stop-based defensive rule that exits after a deep instrument drawdown and waits for a cleaner re-entry setup.',
      low_based_lb30:
        'Default low-based recovery approach. It keeps the existing Adaptive downside evidence, caps the deepest defense at 40% invested, and re-adds risk through slower 30% / 40% / 50%-or-MA200 rebound steps.',
      low_based_lb25:
        'Bear-market reference version of the low-based recovery ladder. It uses the same downside evidence, but re-enters a bit earlier with 25% / 35% / 45%-or-MA200 rebound steps.',
      adaptive_exposure:
        'Adaptive keeps the current evidence-based defensive ladder unchanged. In Arena, it is used as the fast-recovery and V-shape reference rather than the default low-based recovery model.',
      adaptive_exposure_fast_reentry:
        'Experimental variant of Adaptive Exposure with a faster rebound step from 25% back to 50%.',
      adaptive_exposure_relaxed_reentry:
        'Experimental variant of Adaptive Exposure with a looser condition for returning from 50% back to the 80% Arena cap.',
      adaptive_exposure_step_reentry:
        'Experimental variant of Adaptive Exposure that re-risks in smaller staged steps.',
      original_vr_scaled:
        'Original VR reference that reuses archive VR defense and Vmin-buy intent on the Arena-local TQQQ path. Vmin-triggered rebuys are constrained by a 50% per-cycle capital cap and a permanent 20% cash floor, making it a controlled baseline rather than an unbounded averaging system.',
    },
  },
} as const

const BACKTEST_COPY = ARENA_BACKTEST_TEXT.en

const ARENA_TOOLTIP_ORDER: StrategyArenaKey[] = [
  'buy_hold',
  'original_vr_scaled',
  'ma200_risk_control_50',
  'ma200_lb30_hybrid',
  'low_based_lb30',
  'low_based_lb25',
  'adaptive_exposure',
]

const STRATEGY_SERIES_KEYS: Record<
  StrategyArenaKey,
  {
    equity: StrategyArenaView['events'][number]['chart_data'][number] extends infer Row
      ? Row extends Record<string, unknown>
        ? keyof Row
        : never
      : never
    drawdown: StrategyArenaView['events'][number]['chart_data'][number] extends infer Row
      ? Row extends Record<string, unknown>
        ? keyof Row
        : never
      : never
    exposure: StrategyArenaView['events'][number]['chart_data'][number] extends infer Row
      ? Row extends Record<string, unknown>
        ? keyof Row
        : never
      : never
  }
> = {
  buy_hold: {
    equity: 'buy_hold_equity',
    drawdown: 'buy_hold_drawdown',
    exposure: 'buy_hold_exposure',
  },
  ma200_risk_control_50: {
    equity: 'ma200_risk_control_50_equity',
    drawdown: 'ma200_risk_control_50_drawdown',
    exposure: 'ma200_risk_control_50_exposure',
  },
  ma200_lb30_hybrid: {
    equity: 'ma200_lb30_hybrid_equity',
    drawdown: 'ma200_lb30_hybrid_drawdown',
    exposure: 'ma200_lb30_hybrid_exposure',
  },
  low_based_lb30: {
    equity: 'low_based_lb30_equity',
    drawdown: 'low_based_lb30_drawdown',
    exposure: 'low_based_lb30_exposure',
  },
  low_based_lb25: {
    equity: 'low_based_lb25_equity',
    drawdown: 'low_based_lb25_drawdown',
    exposure: 'low_based_lb25_exposure',
  },
  adaptive_exposure: {
    equity: 'adaptive_exposure_equity',
    drawdown: 'adaptive_exposure_drawdown',
    exposure: 'adaptive_exposure_exposure',
  },
  original_vr_scaled: {
    equity: 'original_vr_scaled_equity',
    drawdown: 'original_vr_scaled_drawdown',
    exposure: 'original_vr_scaled_exposure',
  },
}

const STRATEGY_SETUP_NOTES: Record<StrategyArenaKey, string> = {
  buy_hold: BACKTEST_COPY.strategy.buy_hold,
  ma200_risk_control_50: BACKTEST_COPY.strategy.ma200_risk_control_50,
  ma200_lb30_hybrid: BACKTEST_COPY.strategy.ma200_lb30_hybrid,
  low_based_lb30: BACKTEST_COPY.strategy.low_based_lb30,
  low_based_lb25: BACKTEST_COPY.strategy.low_based_lb25,
  adaptive_exposure: BACKTEST_COPY.strategy.adaptive_exposure,
  original_vr_scaled: BACKTEST_COPY.strategy.original_vr_scaled,
}

function formatAdaptiveTransitionSummary(
  transitions: AdaptiveExposureReport['full_transitions']
) {
  return transitions
    .map((transition) => `${transition.from_exposure}->${transition.to_exposure} ${transition.date} (${transition.reason})`)
    .join('; ')
}

type AdaptiveExposureReport = NonNullable<StrategyArenaView['events'][number]['adaptive_exposure_report']>
type StrategyExposureReport = NonNullable<NonNullable<StrategyArenaView['events'][number]['strategy_reports']>[string]>
type WarningLayerReport = NonNullable<StrategyArenaView['events'][number]['warning_layer']>

function formatAdaptiveExplainability(report?: AdaptiveExposureReport) {
  if (!report) return ''

  const visibleTransitionKeys = new Set(
    report.visible_transitions.map(
      (transition) => `${transition.date}|${transition.from_exposure}|${transition.to_exposure}|${transition.reason}`
    )
  )
  const earlierTransitions = report.full_transitions.filter(
    (transition) =>
      !visibleTransitionKeys.has(
        `${transition.date}|${transition.from_exposure}|${transition.to_exposure}|${transition.reason}`
      )
  )

  return [
    `Visible start posture: ${report.initial_state.exposure}% (${report.initial_state.reason}).`,
    earlierTransitions.length
      ? `Earlier full-series transitions: ${formatAdaptiveTransitionSummary(earlierTransitions)}.`
      : 'No earlier full-series transitions before the visible window.',
    report.visible_transitions.length
      ? `Visible-window transitions: ${formatAdaptiveTransitionSummary(report.visible_transitions)}.`
      : 'No exposure transitions inside the visible window.',
  ].join(' ')
}

function formatStrategyExplainability(report?: StrategyExposureReport) {
  if (!report) return ''
  const transitionSummary = (transitions: StrategyExposureReport['full_transitions']) =>
    transitions
      .map((transition) => `${transition.from_exposure}->${transition.to_exposure} ${transition.date} (${transition.reason})`)
      .join('; ')

  return [
    `Visible start posture: ${report.initial_state.exposure}% (${report.initial_state.reason}).`,
    report.visible_transitions.length
      ? `Visible-window transitions: ${transitionSummary(report.visible_transitions)}.`
      : 'No exposure transitions inside the visible window.',
  ].join(' ')
}

function formatWarningExplainability(report?: WarningLayerReport) {
  if (!report) return ''
  const visibleTransitionSummary = report.visible_transitions
    .map((transition) => `${transition.from_state} → ${transition.to_state} ${transition.date}`)
    .join('; ')

  return [
    `Current warning state: ${formatWarningStateLabel(report.warning_state)}.`,
    `Reason: ${report.warning_reason}`,
    `Scenario hint: ${report.scenario_hint}.`,
    report.visible_transitions.length
      ? `Visible-window state changes: ${visibleTransitionSummary}.`
      : 'No warning-state transitions inside the visible window.',
    'This system detects abnormal downside behavior before executing defensive actions.',
    'Warning does not equal trading.',
  ].join(' ')
}

function warningStateTone(state: WarningLayerReport['warning_state']) {
  switch (state) {
    case 'NORMAL':
      return '#94a3b8'
    case 'WATCH':
      return '#fbbf24'
    case 'ALERT':
      return '#fb923c'
    case 'DEFENSE_READY':
      return '#f97316'
    case 'DEFENSE_ACTIVE':
      return '#ef4444'
    case 'RECOVERY_MODE':
      return '#10b981'
    default:
      return '#cbd5e1'
  }
}

function formatOptionalPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return 'n/a'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatWarningStateLabel(value: WarningLayerReport['warning_state']) {
  return value.split('_').join(' ')
}

function panelStyle(extra?: CSSProperties): CSSProperties {
  return {
    background: 'linear-gradient(180deg, rgba(8,12,22,0.94), rgba(9,11,17,0.98))',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 20,
    padding: '1.35rem 1.45rem',
    boxShadow: '0 18px 40px rgba(0,0,0,0.18)',
    ...extra,
  }
}

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: '0.65rem 1rem',
    borderRadius: 999,
    border: active ? '1px solid rgba(148,163,184,0.3)' : '1px solid rgba(255,255,255,0.08)',
    background: active ? 'rgba(148,163,184,0.16)' : 'rgba(255,255,255,0.03)',
    color: active ? '#f8fafc' : '#94a3b8',
    fontSize: '0.9rem',
    fontWeight: 700,
    cursor: 'pointer',
  }
}

function SectionHeader({
  eyebrow,
  title,
  note,
}: {
  eyebrow?: string
  title: string
  note?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 14,
      }}
    >
      <div>
        {eyebrow ? (
          <div
            style={{
              color: '#64748b',
              fontSize: '0.72rem',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              marginBottom: 4,
            }}
          >
            {eyebrow}
          </div>
        ) : null}
        <div style={{ color: '#f8fafc', fontSize: '1.08rem', fontWeight: 800 }}>{title}</div>
      </div>
      {note ? <div style={{ color: '#64748b', fontSize: '0.8rem', maxWidth: 460, lineHeight: 1.55 }}>{note}</div> : null}
    </div>
  )
}

function PlaceholderCard({
  label,
  text,
  detail,
  compact,
}: {
  label: string
  text: string
  detail?: string
  compact?: boolean
}) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 16,
        padding: compact ? '0.8rem 0.9rem' : '1rem',
        minHeight: compact ? 96 : 132,
      }}
    >
      <div
        style={{
          fontSize: '0.71rem',
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </div>
      <div style={{ color: '#e5e7eb', fontSize: compact ? '0.96rem' : '1rem', fontWeight: 700, marginTop: compact ? 8 : 10 }}>{text}</div>
      {detail ? <div style={{ color: '#94a3b8', fontSize: compact ? '0.78rem' : '0.82rem', lineHeight: 1.5, marginTop: compact ? 8 : 10 }}>{detail}</div> : null}
    </div>
  )
}

function PlaceholderSection({
  eyebrow,
  title,
  note,
  cards,
}: {
  eyebrow?: string
  title: string
  note?: string
  cards: Array<{ label: string; text: string }>
}) {
  return (
    <div style={panelStyle()}>
      <SectionHeader eyebrow={eyebrow} title={title} note={note} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {cards.map((card) => (
          <PlaceholderCard key={card.label} label={card.label} text={card.text} />
        ))}
      </div>
    </div>
  )
}

function formatDisplayLabel(value: string) {
  return value
    .split('_')
    .map((part) => (part.toLowerCase() === 'ma200' ? 'MA200' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatRecoveryDays(value: number | null) {
  return value == null ? 'Not Recovered' : `${value}d`
}

function formatArenaPeriodRange(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const startValue = new Date(`${start}T00:00:00Z`)
  const endValue = new Date(`${end}T00:00:00Z`)
  return `${formatter.format(startValue)} - ${formatter.format(endValue)}`
}

function formatArenaDelta(value: number, suffix = 'pts') {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} ${suffix}`
}

function arenaDeltaTone(value: number): string {
  if (value > 0.05) return '#10b981'
  if (value < -0.05) return '#ef4444'
  return '#94a3b8'
}

function getArenaLineVisuals(strategyKey: StrategyArenaKey) {
  if (strategyKey === 'adaptive_exposure') {
    return { strokeWidth: 2.8, strokeOpacity: 1, strokeDasharray: undefined }
  }
  if (strategyKey === 'ma200_risk_control_50') {
    return { strokeWidth: 1.9, strokeOpacity: 0.95, strokeDasharray: '6 4' }
  }
  if (strategyKey === 'ma200_lb30_hybrid') {
    return { strokeWidth: 2.1, strokeOpacity: 0.95, strokeDasharray: '7 3' }
  }
  if (strategyKey === 'low_based_lb30') {
    return { strokeWidth: 2.15, strokeOpacity: 0.98, strokeDasharray: undefined }
  }
  if (strategyKey === 'low_based_lb25') {
    return { strokeWidth: 1.95, strokeOpacity: 0.9, strokeDasharray: '5 3' }
  }
  if (strategyKey === 'buy_hold') {
    return { strokeWidth: 1.9, strokeOpacity: 0.95, strokeDasharray: undefined }
  }
  if (strategyKey === 'original_vr_scaled') {
    return { strokeWidth: 2, strokeOpacity: 0.95, strokeDasharray: '5 3' }
  }
  return { strokeWidth: 1.35, strokeOpacity: 0.58, strokeDasharray: undefined }
}

function BacktestChartTooltip({
  active,
  payload,
  label,
  visibleStrategyKeys,
  metricKind = 'equity',
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string; value?: number | null; color?: string }>
  label?: string | number
  visibleStrategyKeys: StrategyArenaKey[]
  metricKind?: 'equity' | 'drawdown' | 'exposure'
}) {
  if (!active || !payload?.length) return null

  const visibleKeySet = new Set(visibleStrategyKeys)
  const payloadByStrategy = new Map<StrategyArenaKey, { value: number | null; color?: string }>()

  ;(Object.keys(STRATEGY_SERIES_KEYS) as StrategyArenaKey[]).forEach((strategyKey) => {
    const seriesKey = STRATEGY_SERIES_KEYS[strategyKey][metricKind]
    const entry = payload.find((item) => item.dataKey === seriesKey)
    if (entry) {
      payloadByStrategy.set(strategyKey, { value: entry.value ?? null, color: entry.color })
    }
  })

  const orderedItems = ARENA_TOOLTIP_ORDER
    .filter((strategyKey) => visibleKeySet.has(strategyKey))
    .map((strategyKey) => ({
      strategyKey,
      entry: payloadByStrategy.get(strategyKey),
    }))
    .filter((item) => item.entry && typeof item.entry.value === 'number')

  if (!orderedItems.length) return null

  return (
    <div
      style={{
        background: '#111827',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        padding: '0.75rem 0.85rem',
        minWidth: 200,
      }}
    >
      <div style={{ color: '#f8fafc', fontSize: '0.84rem', fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {orderedItems.map(({ strategyKey, entry }) => (
          <div
            key={strategyKey}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: '0.79rem' }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#cbd5e1' }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: entry?.color ?? STRATEGY_COLORS[strategyKey],
                }}
              />
              {STRATEGY_CHIP_LABELS[strategyKey]}
            </div>
            <span style={{ color: '#f8fafc', fontVariantNumeric: 'tabular-nums' }}>
              {metricKind === 'equity'
                ? entry?.value?.toFixed(2)
                : metricKind === 'drawdown'
                  ? formatSignedPercent(entry?.value ?? 0)
                  : `${(entry?.value ?? 0).toFixed(0)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CycleStartPanel({
  cycleStart,
  eventId,
  eventStart,
  eventEnd,
  chartData,
  onApply,
}: {
  cycleStart: VRPlaybackEventView['cycle_start']
  eventId: string
  eventStart: string
  eventEnd: string
  chartData: VRPlaybackEventView['chart_data']
  onApply?: (data: { cycle_start: VRPlaybackEventView['cycle_start']; execution_playback: VRPlaybackEventView['execution_playback'] }) => void
}) {
  const [mode, setMode] = useState<'basic' | 'advanced'>('basic')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [initialCapital, setInitialCapital] = useState(cycleStart.initial_state?.initial_capital ?? 10000)
  const [stockAllocationPct, setStockAllocationPct] = useState(Math.round((cycleStart.initial_state?.stock_allocation_pct ?? 0.8) * 100))
  const [poolAllocationPct, setPoolAllocationPct] = useState(Math.round((cycleStart.initial_state?.pool_allocation_pct ?? 0.2) * 100))
  const [simulationStartDate, setSimulationStartDate] = useState(cycleStart.simulation_start_date ?? '')
  const [manualStartPrice, setManualStartPrice] = useState(cycleStart.initial_state?.start_price ?? 0)
  const [initialAveragePrice, setInitialAveragePrice] = useState(cycleStart.initial_state?.initial_average_price ?? 0)
  const [initialShareCount, setInitialShareCount] = useState(cycleStart.initial_state?.initial_share_count ?? 0)
  const [initialPoolCash, setInitialPoolCash] = useState(cycleStart.initial_state?.initial_pool_cash ?? 0)

  const selectedStartOption =
    cycleStart.available_start_options.find((option) => option.date === simulationStartDate) ?? cycleStart.available_start_options[0]

  const basicStartPrice = selectedStartOption?.start_price ?? manualStartPrice
  const derivedShareCount = Math.floor((initialCapital * (stockAllocationPct / 100)) / basicStartPrice)
  const derivedStockCost = Number((derivedShareCount * basicStartPrice).toFixed(2))
  const derivedPoolCash = Number((initialCapital - derivedStockCost).toFixed(2))
  const effectiveInitialState =
    mode === 'basic'
      ? {
          initial_capital: initialCapital,
          stock_allocation_pct: stockAllocationPct / 100,
          pool_allocation_pct: poolAllocationPct / 100,
          start_price: basicStartPrice,
          initial_share_count: derivedShareCount,
          initial_average_price: basicStartPrice,
          initial_stock_cost: derivedStockCost,
          initial_pool_cash: derivedPoolCash,
        }
      : {
          initial_capital: initialCapital,
          stock_allocation_pct: stockAllocationPct / 100,
          pool_allocation_pct: poolAllocationPct / 100,
          start_price: manualStartPrice || basicStartPrice,
          initial_share_count: initialShareCount,
          initial_average_price: initialAveragePrice,
          initial_stock_cost: Number((initialShareCount * initialAveragePrice).toFixed(2)),
          initial_pool_cash: initialPoolCash,
        }
  const localErrors: string[] = []
  if (!simulationStartDate) localErrors.push('Simulation start date is required.')
  if (!(effectiveInitialState.start_price > 0)) localErrors.push('Start price must be greater than zero.')
  if (!(effectiveInitialState.initial_capital > 0)) localErrors.push('Initial capital must be greater than zero.')
  if (mode === 'basic' && stockAllocationPct + poolAllocationPct !== 100) {
    localErrors.push('Stock allocation and pool allocation must sum to 100% in Basic Mode.')
  }
  if (effectiveInitialState.initial_pool_cash < 0) localErrors.push('Initial pool cash cannot be negative.')
  if (effectiveInitialState.initial_share_count < 0) localErrors.push('Initial share count must be zero or greater.')
  const mergedErrors = Array.from(new Set([...(cycleStart.validation.errors ?? []), ...(cycleStart.lookup_error ? [cycleStart.lookup_error] : []), ...localErrors]))

  return (
    <div style={panelStyle()}>
      <SectionHeader
        eyebrow="Cycle Start"
        title="Event Initial State"
        note="Default warm-up is 150 trading days with an 80 / 20 stock-to-pool split. Advanced overrides are local to this view."
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button type="button" onClick={() => setMode('basic')} style={tabStyle(mode === 'basic')}>
          Basic Mode
        </button>
        <button type="button" onClick={() => setMode('advanced')} style={tabStyle(mode === 'advanced')}>
          Advanced Mode
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
        <PlaceholderCard
          label="Simulation Start"
          text={simulationStartDate || 'Not available'}
          detail={`${cycleStart.default_warmup_trading_days} trading days of effective warm-up before ${cycleStart.event_start_date}`}
        />
        <PlaceholderCard label="Event Window" text={`${cycleStart.event_start_date} to ${cycleStart.event_end_date}`} />
        <PlaceholderCard
          label="Start Price Source"
          text={
            selectedStartOption
              ? selectedStartOption.price_source === 'synthetic_tqqq_3x'
                ? 'Synthetic TQQQ 3x'
                : 'Real TQQQ'
              : 'Manual Override'
          }
          detail={`Ticker ${cycleStart.ticker}`}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
        <label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }}>
          Initial Capital
          <input
            type="number"
            value={initialCapital}
            onChange={(event) => setInitialCapital(Number(event.target.value || 0))}
            style={{ background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }}>
          Simulation Start Date
          <select
            value={simulationStartDate}
            onChange={(event) => setSimulationStartDate(event.target.value)}
            style={{ background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' }}
          >
            {cycleStart.available_start_options.map((option) => (
              <option key={option.date} value={option.date}>
                {option.date} | {option.price_source === 'synthetic_tqqq_3x' ? 'Synthetic' : 'Real'} | {option.start_price.toFixed(2)}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }}>
          Stock Allocation %
          <input
            type="number"
            value={stockAllocationPct}
            onChange={(event) => setStockAllocationPct(Number(event.target.value || 0))}
            style={{ background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }}>
          Pool Allocation %
          <input
            type="number"
            value={poolAllocationPct}
            onChange={(event) => setPoolAllocationPct(Number(event.target.value || 0))}
            style={{ background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' }}
          />
        </label>
      </div>

      {cycleStart.manual_start_price_override_allowed ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          <label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }}>
            Manual Start Price Override
            <input
              type="number"
              value={manualStartPrice}
              onChange={(event) => setManualStartPrice(Number(event.target.value || 0))}
              style={{ background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' }}
            />
          </label>
        </div>
      ) : null}

      {mode === 'advanced' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          <label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }}>
            Initial Average Price
            <input
              type="number"
              value={initialAveragePrice}
              onChange={(event) => setInitialAveragePrice(Number(event.target.value || 0))}
              style={{ background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }}>
            Initial Share Count
            <input
              type="number"
              value={initialShareCount}
              onChange={(event) => setInitialShareCount(Number(event.target.value || 0))}
              style={{ background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.86rem' }}>
            Initial Pool Cash
            <input
              type="number"
              value={initialPoolCash}
              onChange={(event) => setInitialPoolCash(Number(event.target.value || 0))}
              style={{ background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 0.85rem' }}
            />
          </label>
        </div>
      ) : null}

      {mergedErrors.length ? (
        <div
          style={{
            marginBottom: 16,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.18)',
            borderRadius: 16,
            padding: '0.9rem 1rem',
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ color: '#fecaca', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Initialization Validation
          </div>
          {mergedErrors.map((error) => (
            <div key={error} style={{ color: '#fca5a5', fontSize: '0.86rem', lineHeight: 1.5 }}>
              {error}
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <PlaceholderCard label="Start Price" text={effectiveInitialState.start_price.toFixed(2)} detail={`Average ${effectiveInitialState.initial_average_price.toFixed(2)}`} />
        <PlaceholderCard label="Initial Shares" text={`${effectiveInitialState.initial_share_count}`} detail={`Stock Cost ${effectiveInitialState.initial_stock_cost.toFixed(2)}`} />
        <PlaceholderCard label="Initial Pool Cash" text={effectiveInitialState.initial_pool_cash.toFixed(2)} detail={`Capital ${effectiveInitialState.initial_capital.toFixed(2)}`} />
        <PlaceholderCard
          label="Allocation"
          text={`${(effectiveInitialState.stock_allocation_pct * 100).toFixed(0)} / ${(effectiveInitialState.pool_allocation_pct * 100).toFixed(0)}`}
          detail="Stock / Pool allocation"
        />
        <PlaceholderCard
          label="Cycle Placeholders"
          text="Vref / Vmin / Vmax"
          detail={`cycle_no ${cycleStart.cycle_placeholders.cycle_no ?? 'pending'} | cycle_start ${cycleStart.cycle_placeholders.cycle_start_date ?? 'pending'} | cycle_end ${cycleStart.cycle_placeholders.cycle_end_date ?? 'pending'}`}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <button
          type="button"
          disabled={applying}
          onClick={() => {
            setApplying(true)
            const base = window.location.pathname
            const params = new URLSearchParams(window.location.search)
            params.set('sim_event', eventId)
            params.set('event', eventId)
            params.set('sim_start', simulationStartDate || '')
            params.set('sim_capital', String(initialCapital))
            params.set('sim_stock_pct', String(stockAllocationPct))
            params.set('tab', 'Playback')
            window.location.href = base + '?' + params.toString()
          }}
          style={{
            padding: '0.55rem 1.4rem',
            borderRadius: 10,
            background: applying ? 'rgba(99,102,241,0.45)' : 'rgba(99,102,241,0.85)',
            color: '#fff',
            border: 'none',
            cursor: applying ? 'not-allowed' : 'pointer',
            fontWeight: 700,
            fontSize: '0.85rem',
          }}
        >
          {applying ? 'Running...' : 'Apply & Re-run'}
        </button>
      </div>
    </div>
  )
}

function CycleFrameworkPanel({ framework }: { framework: VRPlaybackEventView['cycle_framework'] }) {
  const snapshot = framework.snapshot
  const active = framework.active_selection.active_cycle

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={panelStyle()}>
        <SectionHeader
          eyebrow="Cycle Engine"
          title="Cycle Snapshot Framework"
          note="Two-week cycle segmentation, placeholder VR state, trigger log, and chart overlay contract."
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {framework.cycles.map((cycle) => (
            <div
              key={cycle.cycle_no}
              style={{
                ...tabStyle(cycle.is_active_cycle),
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                minWidth: 148,
                cursor: 'default',
              }}
            >
              <span>{`Cycle ${cycle.cycle_no}`}</span>
              <span style={{ fontSize: '0.72rem', color: cycle.is_active_cycle ? '#e5e7eb' : '#94a3b8' }}>
                {cycle.cycle_start_date} - {cycle.cycle_end_date}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <PlaceholderCard
            label="Active Cycle"
            text={active ? `Cycle ${active.cycle_no}` : 'No Active Cycle'}
            detail={active ? `${active.cycle_start_date} - ${active.cycle_end_date}` : 'Playback range did not yield a cycle window.'}
          />
          <PlaceholderCard
            label="Previous Cycle"
            text={framework.active_selection.previous_cycle ? `Cycle ${framework.active_selection.previous_cycle.cycle_no}` : 'None'}
            detail={
              framework.active_selection.previous_cycle
                ? `${framework.active_selection.previous_cycle.cycle_start_date} - ${framework.active_selection.previous_cycle.cycle_end_date}`
                : 'No prior cycle in the replay window.'
            }
          />
          <PlaceholderCard
            label="Next Cycle"
            text={framework.active_selection.next_cycle ? `Cycle ${framework.active_selection.next_cycle.cycle_no}` : 'None'}
            detail={
              framework.active_selection.next_cycle
                ? `${framework.active_selection.next_cycle.cycle_start_date} - ${framework.active_selection.next_cycle.cycle_end_date}`
                : 'No next cycle in the replay window.'
            }
          />
          <PlaceholderCard
            label="Overlay Contract"
            text={`${framework.chart_overlay.cycle_boundary_markers.length} boundaries`}
            detail={`${framework.chart_overlay.trigger_flags.length} trigger flags | ${framework.chart_overlay.reference_lines.length} reference lines`}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(280px, 0.8fr)', gap: 12 }}>
        <div style={panelStyle()}>
          <SectionHeader eyebrow="Snapshot Table" title="Active Cycle Snapshot" />
          {snapshot ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {[
                    ['Cycle No', `${snapshot.cycle_no}`],
                    ['Cycle Window', snapshot.cycle_window],
                    ['Vref', snapshot.vref],
                    ['Vmin', snapshot.vmin],
                    ['Vmax', snapshot.vmax],
                    ['Pattern Type', snapshot.pattern_type],
                    ['MA200 Status', snapshot.ma200_status],
                    ['Leverage Stress', snapshot.leverage_stress],
                    ['Recovery Quality', snapshot.recovery_quality],
                    ['Buy Permission', snapshot.buy_permission],
                    ['Defense State', snapshot.defense_state],
                    ['Scenario Bias', snapshot.scenario_bias.join(', ') || 'Pending'],
                    ['Playbook Bias', snapshot.playbook_bias.join(', ') || 'Pending'],
                    ['Representative Buy Levels', snapshot.representative_buy_levels.join(' | ') || 'Pending'],
                    ['Representative Sell Levels', snapshot.representative_sell_levels.join(' | ') || 'Pending'],
                    ['Key Trigger Notes', snapshot.key_trigger_notes.join(' | ') || 'Pending'],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td
                        style={{
                          padding: '0.7rem 0.8rem',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          color: '#94a3b8',
                          fontSize: '0.8rem',
                          width: '34%',
                          verticalAlign: 'top',
                        }}
                      >
                        {label}
                      </td>
                      <td
                        style={{
                          padding: '0.7rem 0.8rem',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          color: '#e5e7eb',
                          fontSize: '0.85rem',
                          lineHeight: 1.55,
                        }}
                      >
                        {value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <PlaceholderCard label="Active Cycle Snapshot" text="No cycle snapshot available" />
          )}
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div style={panelStyle()}>
            <SectionHeader eyebrow="Trigger Log" title="Diagnostic Trigger Events" />
            <div style={{ display: 'grid', gap: 8 }}>
              {framework.trigger_log.slice(0, 6).map((item) => (
                <div
                  key={`${item.timestamp}-${item.title}`}
                  style={{
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 14,
                    padding: '0.8rem 0.9rem',
                    background: 'rgba(255,255,255,0.02)',
                  }}
                >
                  <div style={{ color: '#f8fafc', fontSize: '0.86rem', fontWeight: 700 }}>{item.title}</div>
                  <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: 4 }}>
                    {item.timestamp} | Cycle {item.cycle_no} | {formatDisplayLabel(item.event_type)}
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.5, marginTop: 6 }}>{item.message}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={panelStyle()}>
            <SectionHeader eyebrow="Grid Contract" title="Representative Grid Placeholders" />
            {active ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <PlaceholderCard
                  label="Representative Buy Grid"
                  text={active.representative_buy_grid.length ? active.representative_buy_grid.map((level) => `${level.level_no}:${level.price.toFixed(2)}`).join(' | ') : 'Pending'}
                />
                <PlaceholderCard
                  label="Representative Sell Grid"
                  text={active.representative_sell_grid.length ? active.representative_sell_grid.map((level) => `${level.level_no}:${level.price.toFixed(2)}`).join(' | ') : 'Pending'}
                />
              </div>
            ) : (
              <PlaceholderCard label="Representative Grid" text="No active cycle selected" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function deriveVRState(data: VRSurvivalData) {
  const current = data.current
  const target = data.pool_logic.level_pools.find((item) => item.level === current.level)

  const drawdownVelocity =
    current.dd_pct <= -12 || current.components.dd >= 12 ? 3 :
    current.dd_pct <= -8 || current.components.dd >= 6 ? 2 :
    current.dd_pct <= -4 || current.components.dd >= 2 ? 1 : 0

  const trendFailure =
    current.price < current.ma200 ? 3 :
    current.price < current.ma50 || current.days_below_ma200 > 0 ? 2 :
    current.price / current.ma200 < 1.04 ? 1 : 0

  const volatilityExpansion =
    current.vol_pct >= 85 || current.components.vol >= 18 ? 3 :
    current.vol_pct >= 70 || current.components.vol >= 12 ? 2 :
    current.vol_pct >= 55 || current.components.vol >= 6 ? 1 : 0

  const reboundFailure =
    current.shock_cooldown > 0 || (current.survival_active && current.pool_pct >= 75) ? 3 :
    current.price < current.ma50 && current.dd_pct <= -6 ? 2 :
    current.pool_pct > 0 || current.survival_active ? 1 : 0

  const fragilityScore = drawdownVelocity + trendFailure + volatilityExpansion + reboundFailure
  const fragilityState =
    fragilityScore >= 9 ? 'Breakdown Risk' :
    fragilityScore >= 6 ? 'Fragile' :
    fragilityScore >= 3 ? 'Weak' : 'Stable'

  const eventState =
    current.state.toUpperCase() === 'SHOCK' || current.shock_cooldown > 0 || (current.dd_pct <= -10 && current.vol_pct >= 75)
      ? 'Crash Event'
      : current.dd_pct <= -5 || current.vol_pct >= 65 || current.components.dd >= 3
      ? 'Stress Event'
      : 'Normal'

  const downsideState =
    eventState === 'Crash Event'
      ? 'Active Downside'
      : current.pool_pct > 0 && current.exposure_pct > 0 && current.price >= current.ma50
      ? 'Exhaustion Emerging'
      : 'Potential Exhaustion'

  const reentryStatus =
    downsideState === 'Exhaustion Emerging' && fragilityState !== 'Fragile' && current.days_below_ma200 === 0
      ? 'Recovery Confirming'
      : downsideState !== 'Active Downside' && fragilityState !== 'Breakdown Risk' && current.price >= current.ma50
      ? 'Trial Eligible'
      : 'Not Qualified'

  const phaseMap =
    eventState === 'Crash Event' && fragilityState === 'Breakdown Risk' ? 'Collapse Phase' :
    eventState === 'Stress Event' && fragilityState === 'Fragile' ? 'Panic Phase' :
    downsideState === 'Potential Exhaustion' ? 'Exhaustion Phase' :
    reentryStatus === 'Trial Eligible' ? 'Recovery Attempt Phase' :
    reentryStatus === 'Recovery Confirming' ? 'Recovery Confirming Phase' :
    'Collapse Phase'

  const leveragePosture =
    reentryStatus === 'Trial Eligible' || reentryStatus === 'Recovery Confirming' ? 'Re-entry Watch' :
    fragilityState === 'Breakdown Risk' ? 'High Risk' :
    fragilityState === 'Fragile' ? 'Defensive Bias' :
    fragilityState === 'Weak' ? 'Caution' : 'Normal'

  const poolGuidance =
    reentryStatus === 'Trial Eligible' || reentryStatus === 'Recovery Confirming' ? 'Pool may be redeployed selectively' :
    fragilityState === 'Breakdown Risk' ? 'Raise pool aggressively' :
    fragilityState === 'Weak' || fragilityState === 'Fragile' ? 'Raise pool gradually' :
    'Maintain pool'

  const buyAttemptSignal =
    reentryStatus === 'Recovery Confirming' ? 'Recovery Attempt Active' :
    reentryStatus === 'Trial Eligible' ? 'Limited Buy Attempt Reasonable' :
    downsideState === 'Active Downside' ? 'Avoid Aggressive Buying' :
    'Watch for Exhaustion'

  return {
    current,
    target,
    fragilityState,
    eventState,
    downsideState,
    reentryStatus,
    phaseMap,
    leveragePosture,
    poolGuidance,
    buyAttemptSignal,
    fragilityDrivers: {
      drawdownVelocity,
      trendFailure,
      volatilityExpansion,
      reboundFailure,
    },
  }
}

function classifyHeatmapState(item?: {
  ret_1d: number | null
  ret_5d: number | null
  ret_20d: number | null
  vol_surge: number | null
  above_sma50: boolean | null
  above_sma200: boolean | null
}): HeatmapState {
  if (
    !item ||
    item.ret_1d == null ||
    item.ret_5d == null ||
    item.ret_20d == null ||
    item.vol_surge == null ||
    item.above_sma50 == null ||
    item.above_sma200 == null
  ) {
    return 'No Data'
  }

  const total =
    (item.ret_20d <= -20 ? 3 : item.ret_20d <= -10 ? 2 : item.ret_20d <= -4 ? 1 : 0) +
    (item.ret_5d <= -8 || item.ret_1d <= -6 ? 3 : item.ret_5d <= -5 || item.ret_1d <= -3 ? 2 : item.ret_5d <= -2 ? 1 : 0) +
    (item.vol_surge >= 1.6 ? 3 : item.vol_surge >= 1.3 ? 2 : item.vol_surge >= 1.1 ? 1 : 0) +
    (item.above_sma50 === false && item.above_sma200 === false ? 3 : item.above_sma50 === false ? 1 : 0)

  return total >= 9 ? 'Breakdown Risk' : total >= 6 ? 'Fragile' : total >= 3 ? 'Weak' : 'Stable'
}

function heatmapTone(state: HeatmapState): CSSProperties {
  if (state === 'Stable') {
    return { border: '1px solid rgba(34,197,94,0.32)', background: 'rgba(34,197,94,0.12)', color: '#86efac' }
  }
  if (state === 'Weak') {
    return { border: '1px solid rgba(250,204,21,0.32)', background: 'rgba(250,204,21,0.12)', color: '#fde68a' }
  }
  if (state === 'Fragile') {
    return { border: '1px solid rgba(249,115,22,0.32)', background: 'rgba(249,115,22,0.12)', color: '#fdba74' }
  }
  if (state === 'Breakdown Risk') {
    return { border: '1px solid rgba(239,68,68,0.32)', background: 'rgba(239,68,68,0.12)', color: '#fca5a5' }
  }
  return { border: '1px solid rgba(100,116,139,0.26)', background: 'rgba(100,116,139,0.1)', color: '#94a3b8' }
}

function playbackStatusTone(status: VRPlaybackEventView['vr_support_status']): CSSProperties {
  if (status === 'ready') {
    return { border: '1px solid rgba(34,197,94,0.32)', background: 'rgba(34,197,94,0.12)', color: '#86efac' }
  }
  if (status === 'partial') {
    return { border: '1px solid rgba(250,204,21,0.32)', background: 'rgba(250,204,21,0.12)', color: '#fde68a' }
  }
  return { border: '1px solid rgba(148,163,184,0.22)', background: 'rgba(148,163,184,0.1)', color: '#cbd5e1' }
}

function formatPlaybackStatus(status: VRPlaybackEventView['vr_support_status']) {
  if (status === 'ready') return 'Ready'
  if (status === 'partial') return 'Partial'
  return 'Pending Synthetic'
}

function formatPlaybackToken(value: string) {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getFalseBottomGuardInterpretation(args: {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  buyDelayFlag: boolean
  delayStrength: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG'
}) {
  if (!args.buyDelayFlag || args.delayStrength === 'NONE' || args.riskLevel === 'LOW') {
    return 'Rebound conditions do not currently require a delay guard.'
  }
  if (args.delayStrength === 'STRONG') {
    return 'Current rebound is weak and another low remains possible. Early buying is being held back.'
  }
  if (args.delayStrength === 'MODERATE') {
    return 'The rebound remains fragile, so new buying is being delayed until conditions settle.'
  }
  return 'The rebound is still fragile, so buying is being staged more slowly.'
}

function getResetReleaseInterpretation(args: {
  resetReadyFlag: boolean
  resetConfidence: 'LOW' | 'MEDIUM' | 'HIGH'
  resetReason: 'STRUCTURE' | 'REBOUND' | 'EXHAUSTION'
}) {
  if (!args.resetReadyFlag) {
    return 'Additional downside has not fully stabilized yet, so the guard remains in place.'
  }

  if (args.resetReason === 'REBOUND') {
    return 'Additional lows have paused and rebound quality is improving, so guarded buying can reopen.'
  }

  if (args.resetReason === 'STRUCTURE') {
    return 'Internal structure is stabilizing without fresh lows, so the delay layer is being eased.'
  }

  return 'Downside pressure appears exhausted, but the reset is still being released cautiously.'
}

function renderTokenChips(values: string[]) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {values.map((value) => (
        <div
          key={value}
          style={{
            padding: '0.45rem 0.7rem',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
            color: '#cbd5e1',
            fontSize: '0.82rem',
            fontWeight: 700,
          }}
        >
          {formatPlaybackToken(value)}
        </div>
      ))}
    </div>
  )
}

function PlaybackChartTooltip({
  active,
  payload,
  label,
  resolveByDate,
  variant = 'execution',
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number | null; color?: string; payload?: Record<string, unknown> }>
  label?: string | number
  resolveByDate?: (date?: string | number) => Record<string, unknown> | null
  variant?: 'execution' | 'market' | 'portfolio_compare' | 'pool_compare' | 'evaluation_compare'
}) {
  if (!active || !payload?.length) return null
  if (variant === 'market') {
    const source = payload.find((entry) => entry.payload)?.payload ?? null
    const title = typeof source?.title === 'string' ? source.title : label
    return (
      <div
        style={{
          background: '#111827',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          padding: '0.7rem 0.8rem',
        }}
      >
        <div style={{ color: '#f8fafc', fontSize: '0.84rem', marginBottom: 6 }}>{title}</div>
        {label ? <div style={{ color: '#94a3b8', fontSize: '0.72rem', marginBottom: 6 }}>Date: {label}</div> : null}
        {typeof source?.tqqq_price === 'number' ? (
          <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>TQQQ Price: {source.tqqq_price.toFixed(2)}</div>
        ) : null}
        {typeof source?.ma50 === 'number' ? (
          <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>MA50: {source.ma50.toFixed(2)}</div>
        ) : null}
        {typeof source?.ma200 === 'number' ? (
          <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>MA200: {source.ma200.toFixed(2)}</div>
        ) : null}
        {typeof source?.value === 'number' && typeof source?.title === 'string' ? (
          <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>{source.title}: {source.value.toFixed(2)}</div>
        ) : null}
      </div>
    )
  }
  if (variant === 'evaluation_compare') {
    const source = payload.find((entry) => entry.payload)?.payload ?? null
    const originalEval = typeof source?.original_evaluation_value === 'number' ? source.original_evaluation_value as number : null
    const scenarioEval = typeof source?.scenario_evaluation_value === 'number' ? source.scenario_evaluation_value as number : null
    const delta = originalEval != null && scenarioEval != null ? scenarioEval - originalEval : null
    return (
      <div
        style={{
          background: '#111827',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          padding: '0.7rem 0.8rem',
          minWidth: 180,
        }}
      >
        <div style={{ color: '#f8fafc', fontSize: '0.84rem', fontWeight: 700, marginBottom: 6 }}>{typeof source?.date === 'string' ? source.date : label}</div>
        {originalEval != null ? (
          <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
            Original VR (Playback): {originalEval.toFixed(2)}
          </div>
        ) : null}
        {scenarioEval != null ? (
          <div style={{ color: '#34d399', fontSize: '0.72rem' }}>
            Scenario VR: {scenarioEval.toFixed(2)}
          </div>
        ) : null}
        {delta != null ? (
          <div style={{ color: delta >= 0 ? '#34d399' : '#f87171', fontSize: '0.72rem', marginTop: 4, fontWeight: 600 }}>
            {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
          </div>
        ) : null}
      </div>
    )
  }
  if (variant === 'portfolio_compare' || variant === 'pool_compare') {
    const source = payload.find((entry) => entry.payload)?.payload ?? null
    const originalKey = variant === 'portfolio_compare' ? 'original_portfolio_value' : 'original_pool_remaining'
    const scenarioKey = variant === 'portfolio_compare' ? 'scenario_portfolio_value' : 'scenario_pool_remaining'
    const originalValue = typeof source?.[originalKey] === 'number' ? source[originalKey] : null
    const scenarioValue = typeof source?.[scenarioKey] === 'number' ? source[scenarioKey] : null
    return (
      <div
        style={{
          background: '#111827',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          padding: '0.7rem 0.8rem',
        }}
      >
        <div style={{ color: '#f8fafc', fontSize: '0.84rem', marginBottom: 6 }}>{label}</div>
        {typeof originalValue === 'number' ? (
          <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
            Original VR (Playback): {originalValue.toFixed(2)}
          </div>
        ) : null}
        {typeof scenarioValue === 'number' ? (
          <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
            Scenario VR: {scenarioValue.toFixed(2)}
          </div>
        ) : null}
      </div>
    )
  }
  const source = payload.find((entry) => entry.payload)?.payload ?? resolveByDate?.(label) ?? null
  const displayDate = typeof source?.date === 'string' ? source.date : typeof label === 'string' ? label : null
  const title = typeof source?.title === 'string' ? source.title : displayDate
  const reason = typeof source?.reason === 'string' ? source.reason : null
  const closeValue = typeof source?.asset_price === 'number' ? source.asset_price : typeof source?.price === 'number' ? source.price : null
  const evaluationValue = typeof source?.evaluation_value === 'number' ? source.evaluation_value : null
  const totalPortfolioValue =
    typeof source?.portfolio_value === 'number'
      ? source.portfolio_value
      : typeof source?.total_portfolio_value === 'number'
        ? source.total_portfolio_value
        : typeof evaluationValue === 'number' && typeof source?.pool_cash_after_trade === 'number'
          ? evaluationValue + source.pool_cash_after_trade
          : null
  const vrefEval = typeof source?.vref_eval === 'number' ? source.vref_eval : null
  const vminEval = typeof source?.vmin_eval === 'number' ? source.vmin_eval : null
  const vmaxEval = typeof source?.vmax_eval === 'number' ? source.vmax_eval : null
  const markerType = typeof source?.marker_type === 'string' ? source.marker_type : null
  const shareDelta = typeof source?.share_delta === 'number' ? source.share_delta : null
  const blockedLevelNo = typeof source?.blocked_level_no === 'number' ? source.blocked_level_no : null
  const triggerSource = typeof source?.trigger_source === 'string' ? source.trigger_source : null
  const ladderLevelHit = typeof source?.ladder_level_hit === 'number' ? source.ladder_level_hit : null
  const sellGateOpen = typeof source?.sell_gate_open === 'boolean' ? source.sell_gate_open : null

  return (
    <div
      style={{
        background: '#111827',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        padding: '0.7rem 0.8rem',
      }}
    >
      <div style={{ color: '#f8fafc', fontSize: '0.84rem', marginBottom: 6 }}>{title}</div>
      {reason ? <div style={{ color: '#94a3b8', fontSize: '0.72rem', marginBottom: 6 }}>{reason}</div> : null}
      {typeof source?.cycle_no === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem', marginTop: 6 }}>Cycle: {source.cycle_no}</div>
      ) : null}
      {typeof source?.day_in_cycle === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Day In Cycle: {source.day_in_cycle}</div>
      ) : null}
      {displayDate ? <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Date: {displayDate}</div> : null}
      {typeof closeValue === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Close: {closeValue.toFixed(2)}</div>
      ) : null}
      {typeof source?.shares_after_trade === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Shares After: {source.shares_after_trade}</div>
      ) : null}
      {typeof evaluationValue === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Evaluation Value: {evaluationValue.toFixed(2)}</div>
      ) : null}
      {typeof source?.avg_cost_after_trade === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Avg Cost After: {source.avg_cost_after_trade.toFixed(2)}</div>
      ) : null}
      {typeof source?.pool_cash_after_trade === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Pool Cash: {source.pool_cash_after_trade.toFixed(2)}</div>
      ) : null}
      {typeof totalPortfolioValue === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Total Portfolio Value: {totalPortfolioValue.toFixed(2)}</div>
      ) : null}
      {typeof vrefEval === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Vref Eval: {vrefEval.toFixed(2)}</div>
      ) : null}
      {typeof vminEval === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Vmin Eval: {vminEval.toFixed(2)}</div>
      ) : null}
      {typeof vmaxEval === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Vmax Eval: {vmaxEval.toFixed(2)}</div>
      ) : null}
      {typeof source?.cycle_pool_used_pct === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Cycle Pool Used: {source.cycle_pool_used_pct.toFixed(1)}%</div>
      ) : null}
      {triggerSource ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Trigger Source: {formatPlaybackToken(triggerSource)}</div>
      ) : null}
      {typeof ladderLevelHit === 'number' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Ladder Level: L{ladderLevelHit}</div>
      ) : null}
      {typeof sellGateOpen === 'boolean' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Sell Gate Open: {sellGateOpen ? 'Yes' : 'No'}</div>
      ) : null}
      {markerType === 'buy' && typeof shareDelta === 'number' ? (
        <div style={{ color: '#34d399', fontSize: '0.72rem' }}>Buy Executed: +{shareDelta} shares</div>
      ) : null}
      {markerType === 'sell' && typeof shareDelta === 'number' ? (
        <div style={{ color: '#f59e0b', fontSize: '0.72rem' }}>Sell Executed: {shareDelta} shares</div>
      ) : null}
      {markerType === 'defense' && typeof shareDelta === 'number' ? (
        <div style={{ color: '#ef4444', fontSize: '0.72rem' }}>Defense Reduction: {shareDelta} shares</div>
      ) : null}
      {markerType === 'cap_block' ? (
        <div style={{ color: '#a78bfa', fontSize: '0.72rem' }}>
          Blocked Buy{typeof blockedLevelNo === 'number' ? `: level ${blockedLevelNo}` : ''} due to cycle cap
        </div>
      ) : null}
      {typeof source?.state_after_trade === 'string' ? (
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>State After: {source.state_after_trade}</div>
      ) : null}
    </div>
  )
}

function collectNumericValues(values: Array<number | null | undefined>) {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

function buildAxisDomain(values: Array<number | null | undefined>, paddingRatio = 0.08): [number | string, number | string] {
  const numericValues = collectNumericValues(values)
  if (!numericValues.length) return ['auto', 'auto']
  const min = Math.min(...numericValues)
  const max = Math.max(...numericValues)
  const span = Math.max(max - min, Math.abs(max) * paddingRatio, 1)
  const padding = span * paddingRatio
  return [Number((min - padding).toFixed(2)), Number((max + padding).toFixed(2))]
}

function quantile(sortedValues: number[], q: number) {
  if (!sortedValues.length) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  const index = (sortedValues.length - 1) * q
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sortedValues[lower]
  const weight = index - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

function buildFocusedAxisDomain(
  values: Array<number | null | undefined>,
  paddingRatio = 0.04,
  lowerQuantile = 0.05,
  upperQuantile = 0.95,
): [number | string, number | string] {
  const numericValues = collectNumericValues(values).sort((a, b) => a - b)
  if (!numericValues.length) return ['auto', 'auto']
  const focusedMin = quantile(numericValues, lowerQuantile)
  const focusedMax = quantile(numericValues, upperQuantile)
  const span = Math.max(focusedMax - focusedMin, 1)
  const padding = span * paddingRatio
  return [Number((focusedMin - padding).toFixed(2)), Number((focusedMax + padding).toFixed(2))]
}

function buildDateAxisTicks(dates: string[], cycleBoundaryDates: string[]) {
  if (!dates.length) return []
  const tickSet = new Set<string>([dates[0], dates[dates.length - 1]])
  cycleBoundaryDates.forEach((date) => {
    if (dates.includes(date)) tickSet.add(date)
  })
  return dates.filter((date) => tickSet.has(date))
}

function sortByDateAsc<T extends { date: string }>(rows: T[]) {
  return [...rows].sort((left, right) => left.date.localeCompare(right.date))
}

function formatAxisDateTick(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  return `${match[1].slice(2)}-${match[2]}-${match[3]}`
}

function toChartTimestamp(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return Number.NaN
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function mapRowsWithTimestamp<T extends { date: string }>(rows: T[]) {
  return rows.map((row) => ({
    ...row,
    date_ts: toChartTimestamp(row.date),
  }))
}

function toTimestampOrNull(date?: string | null) {
  if (!date) return null
  const ts = toChartTimestamp(date)
  return Number.isFinite(ts) ? ts : null
}

function PlaybackExplorerPanel({ playbackData }: { playbackData?: VRPlaybackView | null }) {
  const events = playbackData?.events ?? []
  const groupedEvents = PLAYBACK_SUITE_GROUP_ORDER.map((group) => ({
    group,
    items: events.filter((event) => event.suite_group === group),
  })).filter((group) => group.items.length > 0)

  return (
    <div style={panelStyle()}>
      <SectionHeader
        eyebrow="Playback Explorer"
        title="Curated VR Test Suite"
        note="Playback is a focused strategy research suite: crash tests, leverage stress cases, and corrections."
      />
      <div style={{ display: 'grid', gap: 12 }}>
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16,
            padding: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }}>
              {events.length ? `${events.length} curated playback cases` : 'Playback archive not available'}
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.86rem', lineHeight: 1.55 }}>
              {playbackData?.archive_event_count
                ? `${playbackData.archive_event_count} raw archive events remain in the data layer, but the main UI now focuses on the curated VR test suite.`
                : 'Open the playback explorer to compare current structure against curated historical leverage cases.'}
            </div>
          </div>
          <a
            href="/vr-survival?tab=Playback"
            style={{
              ...tabStyle(false),
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            Open Playback Explorer
          </a>
        </div>

        {groupedEvents.length ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {groupedEvents.map((group) => (
              <div key={group.group} style={{ display: 'grid', gap: 10 }}>
                <div style={{ color: '#94a3b8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {group.group}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {group.items.map((event) => (
                    <a
                      key={event.id}
                      href={`/vr-survival?tab=Playback&event=${event.suite_id}`}
                      style={{
                        textDecoration: 'none',
                        color: 'inherit',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: 16,
                        padding: '1rem',
                        display: 'grid',
                        gap: 8,
                      }}
                    >
                      <div style={{ color: '#f8fafc', fontSize: '0.95rem', fontWeight: 800 }}>{event.name}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.8rem', lineHeight: 1.5 }}>{event.suite_note}</div>
                      <div style={{ color: '#64748b', fontSize: '0.72rem' }}>{event.archive_name}</div>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function MethodologyPanel() {
  return (
    <div style={panelStyle()}>
      <SectionHeader
        eyebrow="Methodology"
        title="How The VR Engine Works"
        note="Interpretation only. The engine summarizes risk structure, historical analogs, scenarios, and posture without forecasting exact outcomes."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <PlaceholderCard
          label="Market Data"
          text="Internal DB State"
          detail="QQQ, TQQQ, MA200 relation, volatility regime, drawdown depth, and rebound behavior."
        />
        <PlaceholderCard
          label="Pattern Detection"
          text="Pattern Memory"
          detail="Current structure is matched against the VR pattern library using deterministic rule scoring."
        />
        <PlaceholderCard
          label="Historical Analogs"
          text="Tagged Cases"
          detail="The engine compares current conditions against curated VR-tagged historical events."
        />
        <PlaceholderCard
          label="Scenario Engine"
          text="Path Monitoring"
          detail="Scenario branches highlight downside risk, neutral monitoring, and recovery-attempt paths."
        />
        <PlaceholderCard
          label="Posture Messaging"
          text="Executive Summary"
          detail="Suggested posture compresses the current structure into high-signal, non-deterministic guidance."
        />
      </div>
    </div>
  )
}

function OverviewTab({
  data,
  patternDashboard,
  playbackData,
  vrAudit,
}: {
  data: VRSurvivalData
  patternDashboard?: VRDashboardPatternSummary | null
  playbackData?: VRPlaybackView | null
  vrAudit?: VrAuditViewPayload | null
}) {
  const vr = deriveVRState(data)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={panelStyle({ borderColor: 'rgba(56,189,248,0.2)' })}>
        <SectionHeader
          eyebrow="Current State"
          title="Current Market Snapshot"
          note="DB-backed market state, pattern match, and scenario posture summary for the current leveraged ETF regime."
        />
        {patternDashboard?.snapshot ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <PlaceholderCard
                label="Market Pattern"
                text={patternDashboard.snapshot.market_pattern}
                detail={`As of ${patternDashboard.snapshot.as_of_date}`}
              />
              <PlaceholderCard label="Nasdaq Drawdown" text={patternDashboard.snapshot.nasdaq_drawdown} />
              <PlaceholderCard label="TQQQ Drawdown" text={patternDashboard.snapshot.tqqq_drawdown} />
              <PlaceholderCard label="MA200 Status" text={patternDashboard.snapshot.ma200_status} />
              <PlaceholderCard label="Market Structure" text={patternDashboard.snapshot.market_structure} />
              <PlaceholderCard label="Volatility" text={patternDashboard.snapshot.volatility_regime} />
            </div>

            {patternDashboard.snapshot.recommended_posture.length ? (
              <div
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 16,
                  padding: '1rem',
                }}
              >
                <div
                  style={{
                    fontSize: '0.71rem',
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 10,
                  }}
                >
                  Recommended Posture
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {patternDashboard.snapshot.recommended_posture.slice(0, 3).map((item) => (
                    <div key={item} style={{ color: '#e5e7eb', fontSize: '0.95rem', fontWeight: 700 }}>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a href="/vr-survival" style={{ ...tabStyle(false), textDecoration: 'none' }}>
                View Closest Patterns
              </a>
              <a href="/vr-survival" style={{ ...tabStyle(false), textDecoration: 'none' }}>
                Open Historical Analog
              </a>
              <a href="/vr-survival" style={{ ...tabStyle(false), textDecoration: 'none' }}>
                View Scenario Playbook
              </a>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <PlaceholderCard label="Market Pattern" text="Not Classified Yet" />
            <PlaceholderCard label="Snapshot" text="Current market snapshot not available" />
          </div>
        )}
      </div>

      <SuggestedPostureStrip message={patternDashboard?.posture_message} />

      <div style={panelStyle()}>
        <SectionHeader
          eyebrow="Pattern Memory"
          title="Closest Pattern Matches"
          note="Current-market historical analogs from the VR pattern engine."
        />
        {patternDashboard?.top_matches.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {patternDashboard.top_matches.slice(0, 3).map((match) => (
              <div key={match.pattern_id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <PlaceholderCard
                  label={match.pattern_name}
                  text={match.score.toFixed(2)}
                  detail={match.explanation?.join(' | ') ?? 'Historical analog overlap only.'}
                />
                <a
                  href="/vr-survival"
                  style={{ color: '#94a3b8', fontSize: '0.8rem', textDecoration: 'none', paddingLeft: 4 }}
                >
                  View in Playback
                </a>
              </div>
            ))}
          </div>
        ) : (
          <PlaceholderCard label="Closest Pattern Matches" text="No pattern analog available yet" />
        )}
      </div>

      <HistoricalAnalogPanel analogs={patternDashboard?.historical_analogs} />

      <ScenarioEnginePanel
        scenarios={patternDashboard?.scenarios ?? []}
        suggested_posture={patternDashboard?.suggested_posture}
        historical_analogs={patternDashboard?.historical_analogs}
      />

      <PlaybackExplorerPanel playbackData={playbackData} />

      <MethodologyPanel />

      <div
        style={{
          ...panelStyle(),
          paddingTop: '1rem',
          color: '#94a3b8',
          fontSize: '0.84rem',
          lineHeight: 1.65,
        }}
      >
        {vr.current.explain}
      </div>

      {/* ── VR Execution Audit (WO-SA12) ── */}
      {vrAudit && <VrActionAuditCard payload={vrAudit} />}
    </div>
  )
}

function PlaybackTab({
  playbackData,
  initialPlaybackEventId,
}: {
  playbackData?: VRPlaybackView | null
  initialPlaybackEventId?: string
}) {
  const events = playbackData?.events ?? []
  const initialEvent =
    (initialPlaybackEventId
      ? events.find(
          (event) =>
            event.suite_id === initialPlaybackEventId ||
            event.event_id === initialPlaybackEventId ||
            event.name.startsWith(initialPlaybackEventId) ||
            event.start.startsWith(initialPlaybackEventId)
        )
      : null) ?? events[0]
  const [selId, setSelId] = useState(initialEvent?.id ?? '')
  const [cyclePoolCap, setCyclePoolCap] = useState<'30' | '40' | '50' | 'unlimited'>(
    initialEvent?.execution_playback.default_cap_option ?? '50'
  )
  type _CapKey = '30' | '40' | '50' | 'unlimited'
  type _CachedVariant = {
    variant: NonNullable<VRPlaybackEventView['execution_playback']['variants'][_CapKey]>
    comparison: NonNullable<VRPlaybackEventView['execution_playback']['comparison_by_cap'][_CapKey]>
  }
  const [variantCache, setVariantCache] = useState<Partial<Record<_CapKey, _CachedVariant>>>({})
  const [playbackLayer, setPlaybackLayer] = useState<'cycle' | 'daily'>('cycle')
  const [dailyWindowMode, setDailyWindowMode] = useState<'auto_focus' | 'full_event'>('auto_focus')
  const [executionMode, setExecutionMode] = useState<'original' | 'scenario' | 'compare'>('scenario')
  const [cursorMode, setCursorMode] = useState<'daily' | 'cycle'>('daily')
  const [lockedCursorDate, setLockedCursorDate] = useState<string | null>(null)
  const [hoveredCursorDate, setHoveredCursorDate] = useState<string | null>(null)
  const [hoveredExecutionPayload, setHoveredExecutionPayload] = useState<Record<string, unknown> | null>(null)
  const [hoveredComparisonPayload, setHoveredComparisonPayload] = useState<Record<string, unknown> | null>(null)
  const [selectedCycleNo, setSelectedCycleNo] = useState<number | null>(null)
  const [executionOverride, setExecutionOverride] = useState<{
    cycle_start: VRPlaybackEventView['cycle_start']
    execution_playback: VRPlaybackEventView['execution_playback']
  } | null>(null)
  const selected = events.find((event) => event.id === selId) ?? events[0]
  const groupedEvents = PLAYBACK_SUITE_GROUP_ORDER.map((group) => ({
    group,
    items: events.filter((event) => event.suite_group === group),
  })).filter((group) => group.items.length > 0)

  useEffect(() => {
    setCyclePoolCap(selected.execution_playback.default_cap_option)
    setPlaybackLayer('cycle')
    setDailyWindowMode('auto_focus')
    setExecutionMode('scenario')
    setCursorMode('daily')
    setLockedCursorDate(null)
    setHoveredCursorDate(null)
    setHoveredExecutionPayload(null)
    setHoveredComparisonPayload(null)
    setSelectedCycleNo(null)
    setExecutionOverride(null)
    setVariantCache({})
  }, [selected.id, selected.execution_playback.default_cap_option])

  useEffect(() => {
    if (playbackLayer === 'cycle' && executionMode === 'compare') {
      setExecutionMode('scenario')
    }
  }, [playbackLayer, executionMode])

  useEffect(() => {
    setLockedCursorDate(null)
    setHoveredCursorDate(null)
    setHoveredExecutionPayload(null)
    setHoveredComparisonPayload(null)
  }, [executionMode, dailyWindowMode, cursorMode])

  // Lazy: compute variant only for the selected cap option
  useEffect(() => {
    const ep = selected.execution_playback
    if (ep.variants[cyclePoolCap] || variantCache[cyclePoolCap]) return
    const eventSrc = selected as unknown as ExecutionPlaybackSource
    const { variant, comparison } = buildVariantForCap(eventSrc, cyclePoolCap)
    setVariantCache((prev) => ({ ...prev, [cyclePoolCap]: { variant, comparison } }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cyclePoolCap, selected.id])

  if (!selected) {
    return (
      <PlaceholderSection
        eyebrow="Playback"
        title="Historical Playback"
        note="Playback archive is not available."
        cards={[
          { label: 'Event Selector', text: 'No event archive loaded' },
          { label: 'VR Readiness', text: 'Unavailable' },
        ]}
      />
    )
  }

  const eventDates = selected.chart_data.filter((point) => point.in_event)
  const x1 = eventDates[0]?.date
  const x2 = eventDates[eventDates.length - 1]?.date
  const resolvedActiveCycle =
    (selectedCycleNo != null
      ? selected.cycle_framework.cycles.find((cycle) => cycle.cycle_no === selectedCycleNo)
      : null) ?? selected.cycle_framework.active_selection.active_cycle
  const activeCycleHighlight = resolvedActiveCycle
    ? { start_date: resolvedActiveCycle.cycle_start_date, end_date: resolvedActiveCycle.cycle_end_date }
    : selected.cycle_framework.chart_overlay.active_cycle_highlight
  const activeCycleNo = resolvedActiveCycle?.cycle_no ?? null
  const _ep = executionOverride?.execution_playback ?? selected.execution_playback
  const executionVariant =
    _ep.variants[cyclePoolCap] ??
    variantCache[cyclePoolCap]?.variant ??
    _ep.variants[_ep.default_cap_option]!
  // Playback "original" mode always uses the archive replay baseline, not Arena "Original VR (Scaled)".
  const displayedExecutionVariant =
    executionMode === 'original' ? (executionOverride?.execution_playback ?? selected.execution_playback).original_vr : executionVariant
  const comparisonView =
    _ep.comparison_by_cap[cyclePoolCap] ??
    variantCache[cyclePoolCap]?.comparison ??
    _ep.comparison_by_cap[_ep.default_cap_option]!
  const marketRows = displayedExecutionVariant.market_chart.rows
  const cycleBoundaries = displayedExecutionVariant.market_chart.cycle_boundaries
  const cycleSummaries = displayedExecutionVariant.cycle_summaries
  const focusWindow = displayedExecutionVariant.focus_window
  const firstCycleStartDate =
    selected.cycle_framework.cycles[0]?.cycle_start_date ??
    cycleSummaries[0]?.start_date ??
    displayedExecutionVariant.points.find((pt) => pt.cycle_no != null)?.date ??
    selected.cycle_start.simulation_start_date ??
    displayedExecutionVariant.points[0]?.date ??
    selected.start
  const fullEventStartDate =
    firstCycleStartDate
  const lastMeaningfulExecutionPoint =
    [...displayedExecutionVariant.points]
      .reverse()
      .find((point) => point.cycle_no != null || point.in_event) ?? null
  const fullEventEndDate =
    selected.cycle_framework.cycles[selected.cycle_framework.cycles.length - 1]?.cycle_end_date ??
    cycleSummaries[cycleSummaries.length - 1]?.end_date ??
    lastMeaningfulExecutionPoint?.date ??
    selected.end
  const resolvedDailyWindow =
    dailyWindowMode === 'full_event'
      ? { start_date: fullEventStartDate, end_date: fullEventEndDate }
      : focusWindow ?? { start_date: fullEventStartDate, end_date: fullEventEndDate }
  const dailyWindowStartDate = resolvedDailyWindow.start_date
  const dailyWindowEndDate = resolvedDailyWindow.end_date
  const isInDailyWindow = (date: string) => date >= dailyWindowStartDate && date <= dailyWindowEndDate
  const clipZoneToDailyWindow = <T extends { start_date: string; end_date: string }>(zone: T): T | null => {
    const start = zone.start_date < dailyWindowStartDate ? dailyWindowStartDate : zone.start_date
    const end = zone.end_date > dailyWindowEndDate ? dailyWindowEndDate : zone.end_date
    if (start > end) return null
    return { ...zone, start_date: start, end_date: end }
  }
  const filteredExecutionPoints = sortByDateAsc(displayedExecutionVariant.points.filter((point) => isInDailyWindow(point.date)))
  const filteredComparisonRows = sortByDateAsc(comparisonView.chart_rows.filter((row) => isInDailyWindow(row.date)))
  const filteredBuyMarkers = sortByDateAsc(displayedExecutionVariant.buy_markers.filter((marker) => isInDailyWindow(marker.date)))
  const filteredSellMarkers = sortByDateAsc(displayedExecutionVariant.sell_markers.filter((marker) => isInDailyWindow(marker.date)))
  const filteredDefenseMarkers = sortByDateAsc(displayedExecutionVariant.defense_markers.filter((marker) => isInDailyWindow(marker.date)))
  const filteredPoolCapFlags = sortByDateAsc(displayedExecutionVariant.pool_cap_flags.filter((marker) => isInDailyWindow(marker.date)))
  const filteredScenarioZones = displayedExecutionVariant.scenario_phase_zones
    .filter((zone) => zone.end_date >= dailyWindowStartDate)
    .map((zone) => clipZoneToDailyWindow(zone))
    .filter((zone): zone is NonNullable<typeof zone> => zone != null)
  const filteredRecoveryZones = displayedExecutionVariant.vmin_recovery_attempt_zones
    .map((zone) => clipZoneToDailyWindow(zone))
    .filter((zone): zone is NonNullable<typeof zone> => zone != null)
  const filteredFailedZones = displayedExecutionVariant.failed_recovery_zones
    .map((zone) => clipZoneToDailyWindow(zone))
    .filter((zone): zone is NonNullable<typeof zone> => zone != null)
  const filteredMarketRows = sortByDateAsc(marketRows.filter((row) => isInDailyWindow(row.date)))
  // Daily display starts at the actual event window; cycle overlays share the same boundary.
  const filteredCycleBoundaries = sortByDateAsc(
    cycleBoundaries.filter((boundary) =>
      isInDailyWindow(boundary.date) &&
      boundary.date >= dailyWindowStartDate
    )
  )
  const filteredBreachPoints = sortByDateAsc(displayedExecutionVariant.market_chart.breach_points.filter((point) => isInDailyWindow(point.date)))
  const filteredRecoveryMarkers = sortByDateAsc(displayedExecutionVariant.market_chart.recovery_markers.filter((point) => isInDailyWindow(point.date)))
  const dailyEventDates = filteredExecutionPoints.filter((point) => point.in_event).map((point) => point.date)
  const dailyEventWindowStart = dailyEventDates[0] ?? x1
  const dailyEventWindowEnd = dailyEventDates[dailyEventDates.length - 1] ?? x2
  const buyMarkerByDate = new Map(filteredBuyMarkers.map((marker) => [marker.date, marker]))
  const sellMarkerByDate = new Map(filteredSellMarkers.map((marker) => [marker.date, marker]))
  const defenseMarkerByDate = new Map(filteredDefenseMarkers.map((marker) => [marker.date, marker]))
  const capBlockMarkerByDate = new Map(filteredPoolCapFlags.map((marker) => [marker.date, marker]))
  const mergedExecutionRows = filteredExecutionPoints.map((point) => {
    const primaryMarker =
      defenseMarkerByDate.get(point.date) ??
      sellMarkerByDate.get(point.date) ??
      buyMarkerByDate.get(point.date) ??
      capBlockMarkerByDate.get(point.date) ??
      null

    return {
      ...point,
      title: primaryMarker?.title ?? point.date,
      reason: primaryMarker?.reason ?? point.trade_reason ?? null,
      marker_type: primaryMarker?.marker_type ?? null,
      trigger_source: primaryMarker?.trigger_source ?? null,
      ladder_level_hit: primaryMarker?.ladder_level_hit ?? null,
      sell_gate_open: primaryMarker?.sell_gate_open ?? null,
      share_delta: primaryMarker?.share_delta ?? null,
      blocked_level_no: primaryMarker?.blocked_level_no ?? null,
      buy_marker_eval: buyMarkerByDate.get(point.date)?.evaluation_value ?? null,
      sell_marker_eval: sellMarkerByDate.get(point.date)?.evaluation_value ?? null,
      defense_marker_eval: defenseMarkerByDate.get(point.date)?.evaluation_value ?? null,
      cap_block_marker_eval: capBlockMarkerByDate.get(point.date)?.evaluation_value ?? null,
      buy_marker_portfolio: buyMarkerByDate.get(point.date)?.total_portfolio_value ?? null,
      sell_marker_portfolio: sellMarkerByDate.get(point.date)?.total_portfolio_value ?? null,
      defense_marker_portfolio: defenseMarkerByDate.get(point.date)?.total_portfolio_value ?? null,
    }
  })
  const executionChartRows = mapRowsWithTimestamp(mergedExecutionRows)
  const comparisonChartRows = mapRowsWithTimestamp(filteredComparisonRows)
  const executionDateTicks = buildDateAxisTicks(
    (executionMode === 'compare' ? filteredComparisonRows : mergedExecutionRows).map((row) => row.date),
    filteredCycleBoundaries.map((boundary) => boundary.date),
  )
  const executionTimestampTicks = executionDateTicks
    .map((date) => ({ date, ts: toChartTimestamp(date) }))
    .filter((entry) => Number.isFinite(entry.ts))
  const executionDateByTimestamp = new Map(executionTimestampTicks.map((entry) => [entry.ts, entry.date]))
  const executionStartTs = executionChartRows[0]?.date_ts
  const executionEndTs = executionChartRows[executionChartRows.length - 1]?.date_ts
  const marketDateTicks = buildDateAxisTicks(
    filteredMarketRows.map((row) => row.date),
    filteredCycleBoundaries.map((boundary) => boundary.date),
  )
  const avgCyclePoolUsed =
    cycleSummaries.length > 0
      ? cycleSummaries.reduce((sum, cycle) => sum + cycle.pool_used_pct_in_cycle, 0) / cycleSummaries.length
      : 0
  const maxCyclePoolUsed =
    cycleSummaries.length > 0 ? Math.max(...cycleSummaries.map((cycle) => cycle.pool_used_pct_in_cycle)) : 0
  const activeCycleSummary =
    cycleSummaries.find((cycle) => cycle.cycle_no === activeCycleNo) ?? cycleSummaries[cycleSummaries.length - 1] ?? null
  const cycleChartRows = cycleSummaries.map((cycle) => ({
    cycle_label: `C${cycle.cycle_no}`,
    cycle_no: cycle.cycle_no,
    cycle_window: cycle.cycle_window,
    vref_eval: cycle.vref_eval,
    vmin_eval: cycle.vmin_eval,
    vmax_eval: cycle.vmax_eval,
    start_evaluation_value: cycle.start_evaluation_value,
    end_evaluation_value: cycle.end_evaluation_value,
    start_pool_pct: cycle.start_pool_pct,
    end_pool_pct: cycle.end_pool_pct,
    pool_used_pct_in_cycle: cycle.pool_used_pct_in_cycle,
    buy_count: cycle.buy_count,
    sell_count: cycle.sell_count,
    defense_count: cycle.defense_count,
  }))
  const cycleByNo = new Map(selected.cycle_framework.cycles.map((cycle) => [cycle.cycle_no, cycle]))
  const filteredExecutionPointByDate = new Map(mergedExecutionRows.map((point) => [point.date, point]))
  const filteredExecutionPointByTimestamp = new Map(executionChartRows.map((point) => [point.date_ts, point]))
  const filteredComparisonRowByDate = new Map(filteredComparisonRows.map((row) => [row.date, row]))
  const filteredComparisonRowByTimestamp = new Map(comparisonChartRows.map((row) => [row.date_ts, row]))
  const executionPointByDate = new Map(displayedExecutionVariant.points.map((point) => [point.date, point]))
  const resolveExecutionPointByDate = (date?: string | number) => {
    if (date == null) return null
    const dateKey =
      typeof date === 'number'
        ? filteredExecutionPointByTimestamp.get(date)?.date ?? executionDateByTimestamp.get(date)
        : date
    if (!dateKey) return null
    const point = filteredExecutionPointByDate.get(dateKey) ?? executionPointByDate.get(dateKey) ?? null
    if (!point) return null
    if (cursorMode === 'daily') return point
    const cycle = typeof point.cycle_no === 'number' ? cycleByNo.get(point.cycle_no) : null
    return cycle?.cycle_start_date
      ? filteredExecutionPointByDate.get(cycle.cycle_start_date) ??
          executionPointByDate.get(cycle.cycle_start_date) ??
          point
      : point
  }
  const resolveLockedDate = (date?: string | number) => {
    if (date == null) return null
    const dateKey =
      typeof date === 'number'
        ? filteredExecutionPointByTimestamp.get(date)?.date ?? executionDateByTimestamp.get(date)
        : date
    if (!dateKey) return null
    if (cursorMode === 'daily') return dateKey
    const point = resolveExecutionPointByDate(dateKey)
    const cycle = typeof point?.cycle_no === 'number' ? cycleByNo.get(point.cycle_no) : null
    return cycle?.cycle_start_date ?? dateKey
  }
  const handleDailyChartClick = (state?: { activeLabel?: string | number; activePayload?: Array<{ payload?: { date?: string; date_ts?: number } }> }) => {
    const payloadDate = state?.activePayload?.[0]?.payload?.date ?? state?.activePayload?.[0]?.payload?.date_ts
    const resolvedDate = resolveLockedDate(payloadDate ?? state?.activeLabel)
    if (!resolvedDate) return
    setLockedCursorDate((current) => (current === resolvedDate ? null : resolvedDate))
  }
  const handleDailyChartMove = (state?: { activeLabel?: string | number; activePayload?: Array<{ payload?: { date?: string; date_ts?: number } }> }) => {
    if (lockedCursorDate) return
    const payloadDate = state?.activePayload?.[0]?.payload?.date ?? state?.activePayload?.[0]?.payload?.date_ts
    const resolvedDate = resolveLockedDate(payloadDate ?? state?.activeLabel)
    if (executionMode === 'compare') {
      setHoveredComparisonPayload(resolveComparisonRowByDate(resolvedDate ?? payloadDate ?? state?.activeLabel) ?? null)
      setHoveredExecutionPayload(null)
    } else {
      setHoveredExecutionPayload(resolveExecutionPointByDate(resolvedDate ?? payloadDate ?? state?.activeLabel) ?? null)
      setHoveredComparisonPayload(null)
    }
    setHoveredCursorDate(resolvedDate ?? null)
  }
  const handleDailyChartLeave = () => {
    if (!lockedCursorDate) {
      setHoveredCursorDate(null)
      setHoveredExecutionPayload(null)
      setHoveredComparisonPayload(null)
    }
  }
  const jumpToCycleDaily = (cycleNo: number, cycleStartDate: string) => {
    setSelectedCycleNo(cycleNo)
    setPlaybackLayer('daily')
    setDailyWindowMode('full_event')
    setCursorMode('cycle')
    setLockedCursorDate(cycleStartDate)
  }
  const currentCursorDate = lockedCursorDate ?? hoveredCursorDate
  const currentCursorTs = currentCursorDate ? toChartTimestamp(currentCursorDate) : null
  const lockedExecutionPoint = resolveExecutionPointByDate(currentCursorDate ?? undefined)
  const resolveComparisonRowByDate = (date?: string | number) => {
    if (date == null) return null
    const dateKey =
      typeof date === 'number'
        ? filteredComparisonRowByTimestamp.get(date)?.date ?? executionDateByTimestamp.get(date)
        : date
    if (!dateKey) return null
    return filteredComparisonRowByDate.get(dateKey) ?? null
  }
  const lockedComparisonRow = resolveComparisonRowByDate(currentCursorDate ?? undefined)
  const currentExecutionPopupSource =
    executionMode === 'compare'
      ? (lockedComparisonRow ?? hoveredComparisonPayload)
      : (lockedExecutionPoint ?? hoveredExecutionPayload);
  const cursorCycleForHighlight =
    cursorMode === 'cycle' && currentCursorDate
      ? (selected.cycle_framework.cycles.find(
          (cycle) =>
            currentCursorDate >= cycle.cycle_start_date && currentCursorDate <= cycle.cycle_end_date,
        ) ?? null)
      : null
  const effectiveCycleHighlight = cursorCycleForHighlight
    ? { start_date: cursorCycleForHighlight.cycle_start_date, end_date: cursorCycleForHighlight.cycle_end_date }
    : activeCycleHighlight
  const clippedCycleHighlight =
    effectiveCycleHighlight
      ? {
          start_date:
            effectiveCycleHighlight.start_date < dailyWindowStartDate ? dailyWindowStartDate : effectiveCycleHighlight.start_date,
          end_date:
            effectiveCycleHighlight.end_date > dailyWindowEndDate ? dailyWindowEndDate : effectiveCycleHighlight.end_date,
        }
      : null
  const visibleCycleHighlight =
    clippedCycleHighlight && clippedCycleHighlight.start_date <= clippedCycleHighlight.end_date ? clippedCycleHighlight : null
  const executionChartData = executionMode === 'compare' ? comparisonChartRows : executionChartRows
  const dailyEventWindowStartTs = toTimestampOrNull(dailyEventWindowStart)
  const dailyEventWindowEndTs = toTimestampOrNull(dailyEventWindowEnd)
  const visibleCycleHighlightStartTs = toTimestampOrNull(visibleCycleHighlight?.start_date)
  const visibleCycleHighlightEndTs = toTimestampOrNull(visibleCycleHighlight?.end_date)
  const executionEvaluationDomain = buildAxisDomain(
    mergedExecutionRows.flatMap((point) =>
      executionMode === 'scenario'
        ? [point.portfolio_value, point.vref_eval, point.vmin_eval, point.vmax_eval].filter((v): v is number => typeof v === 'number' && v > 0)
        : [point.evaluation_value, point.vref_eval, point.vmin_eval, point.vmax_eval]
    ),
    0.05,
  )
  const cycleEvaluationDomain = buildAxisDomain(
    cycleChartRows.flatMap((row) => [row.start_evaluation_value, row.end_evaluation_value]),
    0.1,
  )
  const cyclePoolDomain = buildAxisDomain(
    cycleChartRows.flatMap((row) => [row.start_pool_pct, row.end_pool_pct, row.pool_used_pct_in_cycle]),
    0.08,
  )
  const marketPriceDomain =
    dailyWindowMode === 'full_event'
      ? buildFocusedAxisDomain(
          filteredMarketRows.flatMap((row) => [row.tqqq_price, row.ma50, row.ma200]),
          0.04,
          0.06,
          0.94,
        )
      : buildAxisDomain(
          filteredMarketRows.flatMap((row) => [row.tqqq_price, row.ma50, row.ma200]),
          0.05
        )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={panelStyle()}>
        <SectionHeader
          eyebrow="Playback"
          title="Historical Event Playback"
          note="Standard remains the master archive. VR adds readiness state, leveraged interpretation, and scenario mapping."
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 12, width: '100%' }}>
            {groupedEvents.map((group) => (
              <div key={group.group} style={{ display: 'grid', gap: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {group.group}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {group.items.map((event) => {
                    const on = event.id === selected.id
                    const tone = playbackStatusTone(event.vr_support_status)
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => setSelId(event.id)}
                        style={{
                          ...tabStyle(on),
                          textAlign: 'left',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          minWidth: 220,
                        }}
                      >
                        <span>{event.name}</span>
                        <span style={{ color: '#94a3b8', fontSize: '0.72rem', lineHeight: 1.4 }}>{event.suite_note}</span>
                        <span
                          style={{
                            alignSelf: 'flex-start',
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            ...tone,
                          }}
                        >
                          {formatPlaybackStatus(event.vr_support_status)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={panelStyle()}>
        <SectionHeader eyebrow="Event Header" title={selected.name} note={`${selected.start} - ${selected.end}`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <PlaceholderCard label="Duration" text={`${selected.duration_days} trading days`} />
          <PlaceholderCard label="Playback Group" text={selected.suite_group} detail={selected.archive_name} />
          <PlaceholderCard label="VR Support" text={formatPlaybackStatus(selected.vr_support_status)} />
          <PlaceholderCard
            label="VR Pattern"
            text={selected.vr_tagged_event.vr_analysis.pattern_type ?? 'Not Classified Yet'}
            detail={selected.suite_note}
          />
        </div>
      </div>

      <CycleStartPanel
        key={selected.event_id}
        cycleStart={executionOverride?.cycle_start ?? selected.cycle_start}
        eventId={selected.event_id}
        eventStart={selected.start}
        eventEnd={selected.end}
        chartData={selected.chart_data}
        onApply={(data) => {
          setExecutionOverride(data)
          setCyclePoolCap(data.execution_playback.default_cap_option)
        }}
      />

      <CycleFrameworkPanel framework={selected.cycle_framework} />

      <div style={panelStyle()}>
        <SectionHeader
          eyebrow="Execution Playback"
          title="VR Execution Playback"
          note={
            playbackLayer === 'cycle'
              ? 'Cycle View summarizes pool consumption, average execution conditions, and how each two-week cycle ended.'
              : executionMode === 'compare'
              ? 'Compare the original grid-following VR against the scenario overlay engine across portfolio path, pool preservation, and execution behavior.'
              : 'Evaluation value path and V-band only. Price and cost remain in tooltip and the lower market chart.'
          }
        />
        <CycleSummaryCard cycleSummaries={cycleSummaries} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['cycle', 'daily'] as const).map((layer) => (
              <button key={layer} type="button" onClick={() => setPlaybackLayer(layer)} style={tabStyle(playbackLayer === layer)}>
                {layer === 'cycle' ? 'Cycle View' : 'Daily View'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {playbackLayer === 'daily' ? (
              <>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem', display: 'flex', alignItems: 'center' }}>Daily Window</div>
                {(['auto_focus', 'full_event'] as const).map((mode) => (
                  <button key={mode} type="button" onClick={() => setDailyWindowMode(mode)} style={tabStyle(dailyWindowMode === mode)}>
                    {mode === 'auto_focus' ? 'Auto Focus' : 'Full Event'}
                  </button>
                ))}
              </>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.82rem', display: 'flex', alignItems: 'center' }}>Cycle Pool Usage Cap</div>
            {(['30', '40', '50', 'unlimited'] as const).map((cap) => (
              <button key={cap} type="button" onClick={() => setCyclePoolCap(cap)} style={tabStyle(cyclePoolCap === cap)}>
                {cap === 'unlimited' ? 'Unlimited' : `${cap}%`}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(playbackLayer === 'cycle' ? (['original', 'scenario'] as const) : (['original', 'scenario', 'compare'] as const)).map((mode) => (
              <button key={mode} type="button" onClick={() => setExecutionMode(mode)} style={tabStyle(executionMode === mode)}>
                {mode === 'original' ? 'Original VR (Playback)' : mode === 'scenario' ? 'Scenario VR' : 'Compare'}
              </button>
            ))}
          </div>
        </div>
        {playbackLayer === 'cycle' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
              <PlaceholderCard compact label="Cycles Covered" text={`${cycleSummaries.length}`} detail={`Engine: ${executionMode === 'original' ? 'Original VR (Playback)' : 'Scenario VR'}`} />
              <PlaceholderCard compact label="Average Pool Used / Cycle" text={`${avgCyclePoolUsed.toFixed(1)}%`} detail={`Max ${maxCyclePoolUsed.toFixed(1)}%`} />
              <PlaceholderCard
                compact
                label="Active Cycle End State"
                text={activeCycleSummary ? formatPlaybackToken(activeCycleSummary.ending_state) : 'Not available'}
                detail={activeCycleSummary ? `Cycle ${activeCycleSummary.cycle_no} | Cash ${activeCycleSummary.end_pool_pct.toFixed(1)}%` : 'No cycle summary'}
              />
              <PlaceholderCard
                compact
                label="Active Cycle Pool Spend"
                text={activeCycleSummary ? activeCycleSummary.pool_spent_in_cycle.toFixed(2) : '0.00'}
                detail={activeCycleSummary ? `${activeCycleSummary.pool_used_pct_in_cycle.toFixed(1)}% of initial pool` : 'No cycle summary'}
              />
              <PlaceholderCard
                compact
                label="Current Pool Remaining"
                text={displayedExecutionVariant.pool_usage_summary.pool_cash_remaining.toFixed(2)}
                detail={`Latest replay state | Cycle ${displayedExecutionVariant.pool_usage_summary.active_cycle_no ?? 'N/A'}`}
              />
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.84rem', lineHeight: 1.6 }}>
              Cycle View answers how much pool each two-week cycle consumed, the average execution conditions inside the cycle, and how the cycle ended.
            </div>
            <div
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 18,
                padding: '1rem',
              }}
            >
              <div style={{ color: '#e5e7eb', fontSize: '0.92rem', fontWeight: 700, marginBottom: 6 }}>
                Full Event Cycle Overview
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: 12, lineHeight: 1.6 }}>
                This chart compresses the full event into cycle-level checkpoints so you can see how evaluation value evolved across the entire replay.
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={cycleChartRows} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="cycle_label" tick={{ fontSize: 11, fill: '#e5e7eb' }} />
                  <YAxis
                    yAxisId="evaluation"
                    tick={{ fontSize: 11, fill: '#e5e7eb' }}
                    width={56}
                    domain={cycleEvaluationDomain}
                    label={{ value: 'Evaluation Value', angle: -90, position: 'insideLeft', fill: '#94a3b8', dx: -4 }}
                  />
                  {activeCycleSummary ? (
                    <ReferenceArea
                      x1={`C${activeCycleSummary.cycle_no}`}
                      x2={`C${activeCycleSummary.cycle_no}`}
                      yAxisId="evaluation"
                      fill="rgba(96,165,250,0.08)"
                      strokeOpacity={0}
                    />
                  ) : null}
                  <Tooltip
                    formatter={(value: number | string, name: string) => {
                      if (typeof value !== 'number') return [value, name]
                      if (name.includes('%')) return [`${value.toFixed(1)}%`, name]
                      return [value.toFixed(2), name]
                    }}
                    labelFormatter={(label) => {
                      const row = cycleChartRows.find((item) => item.cycle_label === label)
                      return row ? `${row.cycle_label} | ${row.cycle_window}` : String(label)
                    }}
                    contentStyle={{
                      background: '#111827',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 12,
                      color: '#f8fafc',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#cbd5e1' }} />
                  <Line yAxisId="evaluation" type="monotone" dataKey="start_evaluation_value" name="Start Eval" stroke="rgba(148,163,184,0.55)" strokeWidth={1.4} dot={false} />
                  <Line yAxisId="evaluation" type="monotone" dataKey="end_evaluation_value" name="End Eval" stroke="#f8fafc" strokeWidth={2.4} dot={{ r: 2.5, fill: '#f8fafc' }} activeDot={{ r: 4 }} />
                  <Line yAxisId="evaluation" type="monotone" dataKey="vref_eval" name="Vref Eval" stroke="#34d399" strokeWidth={2} dot={false} strokeDasharray="6 4" />
                  <Line yAxisId="evaluation" type="monotone" dataKey="vmin_eval" name="Vmin Eval" stroke="#ef4444" strokeWidth={1.4} dot={false} strokeDasharray="4 4" />
                  <Line yAxisId="evaluation" type="monotone" dataKey="vmax_eval" name="Vmax Eval" stroke="#f59e0b" strokeWidth={1.4} dot={false} strokeDasharray="4 4" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 18,
                padding: '1rem',
              }}
            >
              <div style={{ color: '#e5e7eb', fontSize: '0.92rem', fontWeight: 700, marginBottom: 6 }}>
                Cycle Pool Overview
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: 12, lineHeight: 1.6 }}>
                Pool cash ratio and per-cycle pool usage are separated below so you can compare capital preservation directly against the cycle evaluation chart above.
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={cycleChartRows} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="cycle_label" tick={{ fontSize: 11, fill: '#e5e7eb' }} />
                  <YAxis
                    yAxisId="pool"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    width={58}
                    domain={cyclePoolDomain}
                    label={{ value: 'Cash Ratio / Pool Used %', angle: -90, position: 'insideLeft', fill: '#94a3b8', dx: -4 }}
                  />
                  {activeCycleSummary ? (
                    <ReferenceArea
                      x1={`C${activeCycleSummary.cycle_no}`}
                      x2={`C${activeCycleSummary.cycle_no}`}
                      yAxisId="pool"
                      fill="rgba(96,165,250,0.08)"
                      strokeOpacity={0}
                    />
                  ) : null}
                  <Tooltip
                    formatter={(value: number | string, name: string) => {
                      if (typeof value !== 'number') return [value, name]
                      return [`${value.toFixed(1)}%`, name]
                    }}
                    labelFormatter={(label) => {
                      const row = cycleChartRows.find((item) => item.cycle_label === label)
                      return row ? `${row.cycle_label} | ${row.cycle_window}` : String(label)
                    }}
                    contentStyle={{
                      background: '#111827',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 12,
                      color: '#f8fafc',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#cbd5e1' }} />
                  <Line yAxisId="pool" type="monotone" dataKey="start_pool_pct" name="Start Pool %" stroke="#38bdf8" strokeWidth={1.4} dot={false} strokeDasharray="4 4" />
                  <Line yAxisId="pool" type="monotone" dataKey="end_pool_pct" name="End Pool %" stroke="#34d399" strokeWidth={2} dot={{ r: 2.5, fill: '#34d399' }} />
                  <Area yAxisId="pool" type="monotone" dataKey="pool_used_pct_in_cycle" name="Pool Used %" fill="rgba(245,158,11,0.18)" stroke="#f59e0b" strokeWidth={1.5} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100, tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {[
                      'Cycle',
                      'Window',
                      'Vref',
                      'Vmin',
                      'Vmax',
                      'Start Eval',
                      'End Eval',
                      'Start Pool',
                      'End Pool (%)',
                      'Pool Used',
                      'Pool Spent',
                      'Avg Buy Px',
                      'Avg Sell Px',
                      'Buys',
                      'Sells',
                      'Defense',
                      'Blocked',
                      'End Shares',
                      'End Avg Cost',
                      'End State',
                      'Scenario Bias',
                      'Playbook Bias',
                    ].map((label) => (
                      <th
                        key={label}
                        style={{
                          padding: '0.18rem 0.28rem',
                          borderBottom: '1px solid rgba(255,255,255,0.08)',
                          color: '#94a3b8',
                          fontSize: '0.62rem',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          width:
                            label === 'Cycle'
                              ? 38
                              : label === 'Window'
                                ? 148
                                : label === 'Scenario Bias' || label === 'Playbook Bias'
                                  ? 90
                                  : 58,
                        }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cycleSummaries.map((cycle) => {
                    const active = cycle.cycle_no === activeCycleNo
                    return (
                      <tr key={cycle.cycle_no} style={{ background: active ? 'rgba(96,165,250,0.08)' : 'transparent' }}>
                        
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f8fafc', fontWeight: 800, whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                          <button
                            type="button"
                            onClick={() => jumpToCycleDaily(cycle.cycle_no, cycle.start_date)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#f8fafc',
                              fontWeight: 800,
                              padding: 0,
                              cursor: 'pointer',
                            }}
                          >
                            C{cycle.cycle_no}
                          </button>
                        </td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', minWidth: 148, lineHeight: 1.38, fontSize: '0.72rem' }}>
                          {cycle.cycle_window}
                        </td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#34d399', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
                          {Math.round(cycle.vref_eval)}
                        </td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#ef4444', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
                          {Math.round(cycle.vmin_eval)}
                        </td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f59e0b', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
                          {Math.round(cycle.vmax_eval)}
                        </td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
                          {Math.round(cycle.start_evaluation_value)}
                        </td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>{Math.round(cycle.end_evaluation_value)}</td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', lineHeight: 1.32, fontSize: '0.72rem' }}>
                          {Math.round(cycle.start_pool_cash)} ({cycle.start_pool_pct.toFixed(0)}%)
                        </td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', lineHeight: 1.28, fontSize: '0.72rem' }}>
                          {cycle.end_pool_pct.toFixed(0)}%
                          <div style={{ color: '#64748b', fontSize: '0.66rem', marginTop: 2 }}>{Math.round(cycle.end_pool_cash)}</div>
                        </td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#e5e7eb', fontWeight: 700, whiteSpace: 'nowrap', fontSize: '0.72rem' }}>{cycle.pool_used_pct_in_cycle.toFixed(0)}%</td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>{Math.round(cycle.pool_spent_in_cycle)}</td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#34d399', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
                          {cycle.avg_buy_price == null ? 'N/A' : Math.round(cycle.avg_buy_price)}
                        </td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f59e0b', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>
                          {cycle.avg_sell_price == null ? 'N/A' : Math.round(cycle.avg_sell_price)}
                        </td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#34d399', textAlign: 'center', fontSize: '0.72rem' }}>{cycle.buy_count}</td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f59e0b', textAlign: 'center', fontSize: '0.72rem' }}>{cycle.sell_count}</td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#ef4444', textAlign: 'center', fontSize: '0.72rem' }}>{cycle.defense_count}</td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#a78bfa', textAlign: 'center', fontSize: '0.72rem' }}>{cycle.blocked_buy_count}</td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>{cycle.end_shares}</td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>{cycle.end_avg_cost.toFixed(1)}</td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f8fafc', lineHeight: 1.28, fontSize: '0.71rem' }}>{formatPlaybackToken(cycle.ending_state)}</td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', minWidth: 90, fontSize: '0.72rem', lineHeight: 1.25 }}>
                          {cycle.scenario_bias.length ? cycle.scenario_bias.slice(0, 2).map(formatPlaybackToken).join(', ') : <span style={{ color: '#64748b' }}>N/A</span>}
                        </td>
                        <td style={{ padding: '0.18rem 0.28rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', minWidth: 90, fontSize: '0.72rem', lineHeight: 1.25 }}>
                          {cycle.playbook_bias.length ? cycle.playbook_bias.slice(0, 2).map(formatPlaybackToken).join(', ') : <span style={{ color: '#64748b' }}>N/A</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <>
        {dailyWindowMode === 'auto_focus' && focusWindow ? (
          <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 12, lineHeight: 1.6 }}>
            Auto Focus: {focusWindow.start_date} to {focusWindow.end_date}. Anchored from the earliest stress trigger to the early recovery window after the event low.
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.82rem', display: 'flex', alignItems: 'center' }}>Cursor Mode</div>
            {(['daily', 'cycle'] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => setCursorMode(mode)} style={tabStyle(cursorMode === mode)}>
                {mode === 'daily' ? 'Daily Cursor' : 'Cycle Cursor'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart
              data={executionChartData}
              margin={{ top: 10, right: 18, left: 12, bottom: 10 }}
              onClick={handleDailyChartClick}
              onMouseMove={handleDailyChartMove}
              onMouseLeave={handleDailyChartLeave}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                type="number"
                dataKey="date_ts"
                domain={
                  executionStartTs != null && executionEndTs != null ? [executionStartTs, executionEndTs] : ['dataMin', 'dataMax']
                }
                ticks={executionTimestampTicks.map((entry) => entry.ts)}
                scale="time"
                allowDuplicatedCategory={false}
                height={50}
                tick={{ fontSize: 11, fill: '#e5e7eb' }}
                tickFormatter={(value) => formatAxisDateTick(executionDateByTimestamp.get(Number(value)) ?? '')}
                angle={-28}
                textAnchor="end"
              />
              {executionMode === 'compare' ? (
                <YAxis
                  tick={{ fontSize: 12, fill: '#e5e7eb' }}
                  width={78}
                  tickCount={6}
                  domain={buildAxisDomain(comparisonView.chart_rows.flatMap((row) => [row.original_evaluation_value, row.scenario_evaluation_value]), 0.08)}
                  label={{ value: 'Evaluation Value', angle: -90, position: 'insideLeft', fill: '#94a3b8', dx: -4 }}
                />
              ) : (
                <>
                  <YAxis
                    yAxisId="evaluation"
                    tick={{ fontSize: 12, fill: '#e5e7eb' }}
                    width={82}
                    tickCount={6}
                    domain={executionEvaluationDomain}
                    label={{ value: 'Evaluation Value', angle: -90, position: 'insideLeft', fill: '#94a3b8', dx: -4 }}
                  />
                </>
              )}
              <Legend wrapperStyle={{ fontSize: 12, color: '#cbd5e1' }} />
              {dailyEventWindowStartTs != null && dailyEventWindowEndTs != null ? (
                <ReferenceArea
                  x1={dailyEventWindowStartTs}
                  x2={dailyEventWindowEndTs}
                  fill="rgba(255,255,255,0.03)"
                  stroke="rgba(255,255,255,0.08)"
                />
              ) : null}
              {filteredCycleBoundaries.map((boundary) => (
                <ReferenceLine
                  key={`execution-boundary-${boundary.date}`}
                  x={toChartTimestamp(boundary.date)}
                  {...(executionMode !== 'compare' ? { yAxisId: 'evaluation' as const } : {})}
                  stroke="rgba(148,163,184,0.14)"
                  strokeDasharray="2 3"
                  label={{ value: `C${boundary.cycle_no}`, position: 'insideTop', fill: '#64748b', fontSize: 10 }}
                />
              ))}
              {currentCursorTs != null ? (
                <ReferenceLine
                  x={currentCursorTs}
                  yAxisId={executionMode === 'compare' ? undefined : 'evaluation'}
                  stroke={lockedCursorDate ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.32)'}
                  strokeDasharray={lockedCursorDate ? '3 3' : '2 3'}
                />
              ) : null}
              {executionMode !== 'compare' && filteredScenarioZones.map((zone) => (
                <ReferenceArea
                  key={`scenario-${zone.start_date}-${zone.end_date}`}
                  x1={toChartTimestamp(zone.start_date)}
                  x2={toChartTimestamp(zone.end_date)}
                  fill="rgba(148,163,184,0.05)"
                  strokeOpacity={0}
                />
              ))}
              {executionMode !== 'compare' && filteredRecoveryZones.map((zone) => (
                <ReferenceArea
                  key={`recover-${zone.start_date}-${zone.end_date}`}
                  x1={toChartTimestamp(zone.start_date)}
                  x2={toChartTimestamp(zone.end_date)}
                  fill="rgba(52,211,153,0.08)"
                  strokeOpacity={0}
                />
              ))}
              {executionMode !== 'compare' && filteredFailedZones.map((zone) => (
                <ReferenceArea
                  key={`failed-${zone.start_date}-${zone.end_date}`}
                  x1={toChartTimestamp(zone.start_date)}
                  x2={toChartTimestamp(zone.end_date)}
                  fill="rgba(239,68,68,0.08)"
                  strokeOpacity={0}
                />
              ))}
              {executionMode !== 'compare' && visibleCycleHighlightStartTs != null && visibleCycleHighlightEndTs != null ? (
                <ReferenceArea
                  x1={visibleCycleHighlightStartTs}
                  x2={visibleCycleHighlightEndTs}
                  fill={cursorCycleForHighlight ? 'rgba(96,165,250,0.16)' : 'rgba(96,165,250,0.08)'}
                  stroke={cursorCycleForHighlight ? 'rgba(96,165,250,0.5)' : 'rgba(96,165,250,0.22)'}
                  strokeWidth={cursorCycleForHighlight ? 1.5 : 1}
                />
              ) : null}
              {executionMode === 'compare' ? (
                <Tooltip content={<PlaybackChartTooltip variant="evaluation_compare" />} />
              ) : (
                <Tooltip content={<PlaybackChartTooltip resolveByDate={resolveExecutionPointByDate} variant="execution" />} />
              )}
              {executionMode === 'compare' ? (
                <>
                  <Line dataKey="original_evaluation_value" stroke="#94a3b8" strokeWidth={2} dot={false} name="Original VR (Playback) Portfolio Value" connectNulls />
                  <Line dataKey="scenario_evaluation_value" stroke="#34d399" strokeWidth={2.4} dot={false} name="Scenario Portfolio Value" connectNulls />
                </>
              ) : (
                <>
                  <Line yAxisId="evaluation" dataKey={executionMode === 'scenario' ? 'portfolio_value' : 'evaluation_value'} stroke={executionMode === 'original' ? '#94a3b8' : '#e5e7eb'} strokeWidth={2.4} dot={false} name={executionMode === 'original' ? 'Original VR (Playback) Evaluation Value' : 'Portfolio Value (Stock + Cash)'} connectNulls />
                  <Line yAxisId="evaluation" type="stepAfter" dataKey="vref_eval" stroke="#34d399" strokeWidth={2.2} strokeDasharray="6 4" dot={false} name="Vref Eval" connectNulls />
                  <Line yAxisId="evaluation" type="stepAfter" dataKey="vmin_eval" stroke="#ef4444" strokeWidth={1.5} dot={false} name="Vmin Eval" connectNulls />
                  <Line yAxisId="evaluation" type="stepAfter" dataKey="vmax_eval" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Vmax Eval" connectNulls />
                  <Scatter yAxisId="evaluation" data={executionChartRows} dataKey={executionMode === 'scenario' ? 'buy_marker_portfolio' : 'buy_marker_eval'} fill="#34d399" name="Buy Executions" />
                  <Scatter yAxisId="evaluation" data={executionChartRows} dataKey={executionMode === 'scenario' ? 'sell_marker_portfolio' : 'sell_marker_eval'} fill="#f59e0b" name="Sell Executions" />
                  <Scatter yAxisId="evaluation" data={executionChartRows} dataKey={executionMode === 'scenario' ? 'defense_marker_portfolio' : 'defense_marker_eval'} fill="#ef4444" name="Defense Reductions" />
                  <Scatter yAxisId="evaluation" data={executionChartRows} dataKey="cap_block_marker_eval" fill="#a78bfa" name="Cap Blocked Buys" />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {executionMode === 'compare' ? (
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <div style={{ color: '#94a3b8', fontSize: '0.84rem', lineHeight: 1.6 }}>
              Compare the original grid-following VR against the scenario overlay engine across portfolio path, pool preservation, and execution behavior.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {comparisonView.metric_cards.map((metric) => (
                <div
                  key={metric.label}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 14,
                    padding: '0.9rem',
                    display: 'grid',
                    gap: 5,
                  }}
                >
                  <div style={{ color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{metric.label}</div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.8rem' }}>Original: {metric.original_value}</div>
                  <div style={{ color: '#f8fafc', fontSize: '0.86rem', fontWeight: 700 }}>Scenario: {metric.scenario_value}</div>
                  <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Delta: {metric.difference}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
          </>
        )}
      </div>

      {playbackLayer === 'daily' ? (
      <div style={panelStyle()}>
        <SectionHeader
          eyebrow="Panel 2"
          title="Real TQQQ + MA50 / MA200"
          note="Actual leveraged market path with structural references, event window shading, and cycle boundaries."
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
          <PlaceholderCard
            label="Active Cycle Pool Used"
            text={`${displayedExecutionVariant.pool_usage_summary.active_cycle_pool_used_pct.toFixed(1)}%`}
            detail={`Cycle ${displayedExecutionVariant.pool_usage_summary.active_cycle_no ?? 'N/A'} | Cap ${displayedExecutionVariant.pool_usage_summary.cycle_pool_cap_pct == null ? 'Unlimited' : `${displayedExecutionVariant.pool_usage_summary.cycle_pool_cap_pct}%`}`}
          />
          <PlaceholderCard
            label="Pool Cash Remaining"
            text={displayedExecutionVariant.pool_usage_summary.pool_cash_remaining.toFixed(2)}
            detail={`Cumulative spent ${displayedExecutionVariant.pool_usage_summary.cumulative_pool_spent.toFixed(2)}`}
          />
          {executionMode === 'scenario' ? (
            <PlaceholderCard
              label="False Bottom Guard"
              text={`${displayedExecutionVariant.pool_usage_summary.false_bottom_risk_level} | ${displayedExecutionVariant.pool_usage_summary.buy_delay_flag ? `ACTIVE (${displayedExecutionVariant.pool_usage_summary.delay_strength})` : 'INACTIVE'}`}
              detail={getFalseBottomGuardInterpretation({
                riskLevel: displayedExecutionVariant.pool_usage_summary.false_bottom_risk_level,
                buyDelayFlag: displayedExecutionVariant.pool_usage_summary.buy_delay_flag,
                delayStrength: displayedExecutionVariant.pool_usage_summary.delay_strength,
              })}
            />
          ) : null}
          {executionMode === 'scenario' ? (
            <PlaceholderCard
              label="Reset Signal"
              text={displayedExecutionVariant.pool_usage_summary.reset_ready_flag ? `ACTIVE (${displayedExecutionVariant.pool_usage_summary.reset_confidence})` : 'INACTIVE'}
              detail={`Reason: ${formatPlaybackToken(displayedExecutionVariant.pool_usage_summary.reset_reason)}. ${getResetReleaseInterpretation({
                resetReadyFlag: displayedExecutionVariant.pool_usage_summary.reset_ready_flag,
                resetConfidence: displayedExecutionVariant.pool_usage_summary.reset_confidence,
                resetReason: displayedExecutionVariant.pool_usage_summary.reset_reason,
              })}`}
            />
          ) : null}
          <PlaceholderCard
            label="Blocked Buys"
            text={`${displayedExecutionVariant.pool_usage_summary.blocked_buy_count}`}
            detail={`Active cycle blocked ${displayedExecutionVariant.pool_usage_summary.active_cycle_blocked_buy_count}`}
          />
          <PlaceholderCard
            label="Execution State"
            text={displayedExecutionVariant.points[displayedExecutionVariant.points.length - 1]?.state_after_trade ?? 'Pending'}
            detail={displayedExecutionVariant.points[displayedExecutionVariant.points.length - 1]?.trade_reason ?? 'No recent trade marker'}
          />
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={filteredMarketRows} margin={{ top: 8, right: 14, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="date"
              ticks={marketDateTicks}
              interval={0}
              minTickGap={0}
              height={50}
              tick={{ fontSize: 11, fill: '#e5e7eb' }}
              tickFormatter={formatAxisDateTick}
              angle={-28}
              textAnchor="end"
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#e5e7eb' }}
              width={72}
              tickCount={6}
              domain={marketPriceDomain}
              label={{ value: 'TQQQ / MA50 / MA200', angle: -90, position: 'insideLeft', fill: '#94a3b8', dx: -4 }}
            />
            <Tooltip content={<PlaybackChartTooltip variant="market" />} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#cbd5e1' }} />
            {dailyEventWindowStart && dailyEventWindowEnd ? (
              <ReferenceArea
                x1={dailyEventWindowStart}
                x2={dailyEventWindowEnd}
                fill="rgba(255,255,255,0.03)"
                stroke="rgba(255,255,255,0.08)"
              />
            ) : null}
            {filteredCycleBoundaries.map((boundary) => (
              <ReferenceLine key={`boundary-${boundary.date}`} x={boundary.date} stroke="rgba(148,163,184,0.16)" strokeDasharray="2 3" />
            ))}
            <Line dataKey="tqqq_price" stroke="#e5e7eb" strokeWidth={2.2} dot={false} name="TQQQ Price" connectNulls />
            <Line dataKey="ma50" stroke="#60a5fa" strokeWidth={1.5} dot={false} name="MA50" connectNulls />
            <Line dataKey="ma200" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="MA200" connectNulls />
            <Scatter data={filteredBreachPoints} dataKey="value" fill="#ef4444" name="MA200 Breach" />
            <Scatter data={filteredRecoveryMarkers} dataKey="value" fill="#34d399" name="Recovery Marker" />
          </ComposedChart>
        </ResponsiveContainer>
        {selected.leveraged_stress.tqqq_source === 'synthetic' ? (
          <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginTop: 8 }}>
            TQQQ comparison is using a QQQ 3x synthetic proxy because real TQQQ history was not available before 2010.
          </div>
        ) : selected.leveraged_stress.tqqq_source === 'unavailable' ? (
          <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginTop: 8 }}>
            TQQQ-specific comparison is not available for this event in the real Standard archive.
          </div>
        ) : null}
      </div>
      ) : null}

      {playbackLayer === 'daily' ? (
      <div style={panelStyle()}>
        <SectionHeader
          eyebrow="Execution Validation"
          title="Execution Validation Pass"
          note="Trade log, state transitions, and validation flags sourced from the same replay execution stream."
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
          <PlaceholderCard
            label="Buy Executions"
            text={`${displayedExecutionVariant.validation_summary.executed_buy_count}`}
            detail={displayedExecutionVariant.validation_summary.has_buy_execution ? 'Detected in replay' : 'No buy executions'}
          />
          <PlaceholderCard
            label="Sell Executions"
            text={`${displayedExecutionVariant.validation_summary.executed_sell_count}`}
            detail={displayedExecutionVariant.validation_summary.has_sell_execution ? 'Detected in replay' : 'No sell executions'}
          />
          <PlaceholderCard
            label="Defense Events"
            text={`${displayedExecutionVariant.validation_summary.executed_defense_count}`}
            detail={displayedExecutionVariant.validation_summary.has_defense_execution ? 'Detected in replay' : 'No defense reductions'}
          />
          <PlaceholderCard
            label="Cap Blocking"
            text={displayedExecutionVariant.validation_summary.blocked_by_cap_observed ? 'Observed' : 'None'}
            detail={`${displayedExecutionVariant.validation_summary.blocked_buy_count} blocked buys`}
          />
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ color: '#94a3b8', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Recent Trade Log
          </div>
          {displayedExecutionVariant.trade_log.filter((item) => item.trade_executed || item.blocked_by_cap).slice(-8).reverse().map((item) => (
            <div
              key={`${item.replay_date}-${item.trade_type ?? 'none'}-${item.cycle_no ?? 'x'}`}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 14,
                padding: '0.85rem 0.95rem',
                display: 'grid',
                gap: 4,
              }}
            >
              <div style={{ color: '#f8fafc', fontSize: '0.9rem', fontWeight: 700 }}>
                {item.replay_date} | Cycle {item.cycle_no ?? 'N/A'} | {item.trade_type ?? 'none'}
              </div>
              <div style={{ color: '#cbd5e1', fontSize: '0.82rem' }}>
                State {item.state_before} {'\u2192'} {item.state_after} | Shares {item.shares_before} {'\u2192'} {item.shares_after} | Avg Cost {item.avg_cost_before.toFixed(2)} {'\u2192'} {item.avg_cost_after.toFixed(2)}
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                Pool {item.pool_cash_before.toFixed(2)} {'\u2192'} {item.pool_cash_after.toFixed(2)} | Cycle Pool Used {item.cycle_pool_used_pct.toFixed(1)}%{item.blocked_by_cap ? ' | blocked by cap' : ''}
              </div>
            </div>
          ))}
          {!displayedExecutionVariant.trade_log.some((item) => item.trade_executed || item.blocked_by_cap) ? (
            <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No execution records generated yet for this replay variant.</div>
          ) : null}
        </div>
      </div>
      ) : null}

      {playbackLayer === 'daily' && executionMode === 'compare' ? (
      <div style={panelStyle()}>
        <SectionHeader
          eyebrow="Comparison Layer"
          title="Original VR (Playback) vs Scenario Overlay"
          note="Mechanical baseline versus scenario-aware overlay, with emphasis on deployment pace, pool survival, and late-stage optionality."
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
          {comparisonView.metric_cards.map((metric) => (
            <div
              key={metric.label}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 16,
                padding: '1rem',
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {metric.label}
              </div>
              <div style={{ color: '#cbd5e1', fontSize: '0.82rem' }}>Original VR (Playback): {metric.original_value}</div>
              <div style={{ color: '#f8fafc', fontSize: '0.88rem', fontWeight: 700 }}>Scenario VR: {metric.scenario_value}</div>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Difference: {metric.difference}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 12, marginBottom: 12 }}>
          <div style={{ ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }}>
            <SectionHeader eyebrow="Portfolio Path" title="Portfolio Path Comparison" note="Original VR (Playback) versus scenario overlay portfolio value through the replay." />
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={comparisonView.chart_rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#e5e7eb' }} interval={Math.max(1, Math.floor(comparisonView.chart_rows.length / 10))} />
                <YAxis tick={{ fontSize: 11, fill: '#e5e7eb' }} width={60} domain={buildAxisDomain(comparisonView.chart_rows.flatMap((row) => [row.original_portfolio_value, row.scenario_portfolio_value]), 0.08)} />
                <Tooltip content={<PlaybackChartTooltip variant="portfolio_compare" />} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#cbd5e1' }} />
                <Line dataKey="original_portfolio_value" stroke="#94a3b8" strokeWidth={2} dot={false} name="Original VR (Playback) Portfolio" connectNulls />
                <Line dataKey="scenario_portfolio_value" stroke="#34d399" strokeWidth={2.4} dot={false} name="Scenario VR Portfolio" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div style={{ ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }}>
            <SectionHeader eyebrow="Pool Survival" title="Pool Survival Comparison" note="How much pool capital remained available through the event." />
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={comparisonView.chart_rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#e5e7eb' }} interval={Math.max(1, Math.floor(comparisonView.chart_rows.length / 10))} />
                <YAxis tick={{ fontSize: 11, fill: '#e5e7eb' }} width={60} domain={buildAxisDomain(comparisonView.chart_rows.flatMap((row) => [row.original_pool_remaining, row.scenario_pool_remaining]), 0.08)} />
                <Tooltip content={<PlaybackChartTooltip variant="pool_compare" />} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#cbd5e1' }} />
                <Line dataKey="original_pool_remaining" stroke="#94a3b8" strokeWidth={2} dot={false} name="Original VR (Playback) Pool Remaining" connectNulls />
                <Line dataKey="scenario_pool_remaining" stroke="#60a5fa" strokeWidth={2.4} dot={false} name="Scenario VR Pool Remaining" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(280px, 0.8fr)', gap: 12 }}>
          <div style={{ ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }}>
            <SectionHeader eyebrow="Behavior Difference" title="Structural Comparison" />
            <div style={{ display: 'grid', gap: 10 }}>
              {comparisonView.behavior_rows.map((row) => (
                <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr', gap: 10, alignItems: 'start' }}>
                  <div style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700 }}>{row.label}</div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.5 }}>{row.original_value}</div>
                  <div style={{ color: '#f8fafc', fontSize: '0.82rem', lineHeight: 1.5 }}>{row.scenario_value}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }}>
            <SectionHeader eyebrow="Interpretation" title="What Changed" />
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ color: '#f8fafc', fontSize: '0.92rem', fontWeight: 700, lineHeight: 1.5 }}>
                {comparisonView.interpretation.headline}
              </div>
              <div style={{ color: '#cbd5e1', fontSize: '0.84rem', lineHeight: 1.6 }}>
                {comparisonView.interpretation.subline}
              </div>
            </div>
          </div>
        </div>
      </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={panelStyle()}>
          <SectionHeader eyebrow="Panel 3" title="Recovery Path" note="Compact rebound-quality summary." />
          <div style={{ display: 'grid', gap: 12 }}>
            <PlaceholderCard
              label="Rebound Strength"
              text={
                selected.recovery_path.rebound_strength_pct == null
                  ? 'Unavailable'
                  : `${selected.recovery_path.rebound_strength_pct.toFixed(1)}%`
              }
            />
            <PlaceholderCard label="Rebound Persistence" text={selected.recovery_path.rebound_persistence} />
            <PlaceholderCard label="Lower-High Failure Risk" text={selected.recovery_path.lower_high_failure_risk} />
            <PlaceholderCard label="Secondary Drawdown Risk" text={selected.recovery_path.secondary_drawdown_risk} />
          </div>
        </div>

        <div style={panelStyle()}>
          <SectionHeader eyebrow="VR Interpretation" title="Event-Level VR Metadata" note="Manual priority tags first, fallback interpretation otherwise." />
          {selected.vr_tagged_event.source === 'fallback' ? (
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: 12 }}>
              This event remains available in Standard playback, but curated VR interpretation metadata has not yet been attached.
            </div>
          ) : null}
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <PlaceholderCard
                label="Pattern Type"
                text={
                  selected.vr_tagged_event.vr_analysis.pattern_type
                    ? formatPlaybackToken(selected.vr_tagged_event.vr_analysis.pattern_type)
                    : 'Not Classified Yet'
                }
              />
              <PlaceholderCard
                label="MA200 Status"
                text={
                  selected.vr_tagged_event.vr_analysis.ma200_status
                    ? formatPlaybackToken(selected.vr_tagged_event.vr_analysis.ma200_status)
                    : 'Not available'
                }
              />
              <PlaceholderCard
                label="Leverage Stress"
                text={
                  selected.vr_tagged_event.vr_analysis.leverage_stress
                    ? formatPlaybackToken(selected.vr_tagged_event.vr_analysis.leverage_stress)
                    : 'Not available'
                }
              />
              <PlaceholderCard
                label="Recovery Quality"
                text={
                  selected.vr_tagged_event.vr_analysis.recovery_quality
                    ? formatPlaybackToken(selected.vr_tagged_event.vr_analysis.recovery_quality)
                    : 'Not available'
                }
              />
            </div>

            <div style={{ ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }}>
              <SectionHeader eyebrow="VR Tags" title="Tags" />
              {selected.vr_tagged_event.vr_analysis.tags.length
                ? renderTokenChips(selected.vr_tagged_event.vr_analysis.tags)
                : <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Not available</div>}
            </div>

            <PlaceholderCard
              label="Key Lesson"
              text={selected.vr_tagged_event.vr_analysis.lesson ?? 'Not yet tagged for curated VR playback.'}
            />

            <div style={{ ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }}>
              <SectionHeader eyebrow="Scenario Bias" title="Scenario Bias" />
              {selected.vr_tagged_event.vr_analysis.scenario_bias?.length
                ? renderTokenChips(selected.vr_tagged_event.vr_analysis.scenario_bias)
                : <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Not available</div>}
            </div>

            <div style={{ ...panelStyle({ padding: '1rem', borderRadius: 16 }), boxShadow: 'none' }}>
              <SectionHeader eyebrow="Playbook Bias" title="Playbook Bias" />
              {selected.vr_tagged_event.vr_analysis.playbook_bias?.length
                ? renderTokenChips(selected.vr_tagged_event.vr_analysis.playbook_bias)
                : <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Not available</div>}
            </div>
          </div>
        </div>
      </div>

      {selected.vr_support_status === 'pending_synthetic' ? (
        <div style={panelStyle({ borderColor: 'rgba(148,163,184,0.18)' })}>
          <SectionHeader eyebrow="VR Placeholder" title="Pending Synthetic Support" />
          <div style={{ display: 'grid', gap: 8 }}>
            {selected.placeholder_messages.map((message) => (
              <div key={message} style={{ color: '#cbd5e1', fontSize: '0.92rem', lineHeight: 1.6 }}>
                {message}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {selected.placeholder_messages.length ? (
            <div style={panelStyle({ borderColor: 'rgba(148,163,184,0.16)' })}>
              <SectionHeader eyebrow="VR Note" title="Playback Source Notes" />
              <div style={{ display: 'grid', gap: 8 }}>
                {selected.placeholder_messages.map((message) => (
                  <div key={message} style={{ color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.6 }}>
                    {message}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div style={panelStyle()}>
            <SectionHeader eyebrow="Pattern Detector" title="Closest Pattern Matches" />
            {selected.pattern_matches.top_matches.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                {selected.pattern_matches.top_matches.map((match) => (
                  <PlaceholderCard
                    key={match.pattern_id}
                    label={match.pattern_name}
                    text={match.score.toFixed(2)}
                    detail={match.explanation?.join(' | ') ?? 'Historical analog overlap only.'}
                  />
                ))}
              </div>
            ) : (
              <PlaceholderCard label="Closest Pattern Matches" text="No VR pattern analog available yet" />
            )}
          </div>

          <div style={panelStyle()}>
            <SectionHeader eyebrow="Scenario Playbook" title="Possible Scenarios" note="Maximum 3 scenarios, derived from the current primary match." />
            {selected.scenario_playbook.scenarios.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                {selected.scenario_playbook.scenarios.map((scenario) => (
                  <PlaceholderCard
                    key={scenario.scenario_id}
                    label={scenario.scenario_name}
                    text={scenario.description}
                    detail={`Posture: ${scenario.posture_guidance.join(', ')}`}
                  />
                ))}
              </div>
            ) : (
              <PlaceholderCard label="Scenario Playbook" text="Scenario mapping not available" />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function BacktestTab({ strategyArena }: { strategyArena?: StrategyArenaView | null }) {
  const events = strategyArena?.events ?? []
  const [selectedId, setSelectedId] = useState(events[0]?.id ?? '')
  const [arenaViewMode, setArenaViewMode] = useState<'charts' | 'test_setup'>('charts')
  const selected = events.find((event) => event.id === selectedId) ?? events[0]

  if (!selected) {
    return (
      <PlaceholderSection
        eyebrow="Strategy Arena"
        title="Strategy Comparison Arena"
        note="Historical strategy comparison is not available yet."
        cards={[{ label: 'Strategy Arena', text: 'No event comparison data loaded' }]}
      />
    )
  }

  const strategyKeys = ARENA_TOOLTIP_ORDER
  const displayStrategyKeys = strategyKeys.filter(
    (strategyKey) => strategyKey !== 'original_vr_scaled' || selected.vr_source === 'survival_archive'
  )
  const metricRows: Array<{
    strategyKey: StrategyArenaKey
    metric: {
      final_return_pct: number
      max_drawdown_pct: number
      recovery_time_days: number | null
      exposure_stability_pct: number
    }
  }> = displayStrategyKeys.reduce((rows, strategyKey) => {
    const metric = selected.metrics[strategyKey]
    if (metric) {
      rows.push({ strategyKey, metric })
    }
    return rows
  }, [])
  const bestFinalPerformer = metricRows.length
    ? metricRows.reduce((best, row) => (row.metric.final_return_pct > best.metric.final_return_pct ? row : best), metricRows[0])
    : null
  const lowestDrawdownPerformer = metricRows.length
    ? metricRows.reduce((best, row) => (row.metric.max_drawdown_pct > best.metric.max_drawdown_pct ? row : best), metricRows[0])
    : null
  const buyHoldMetric = selected.metrics.buy_hold
  const originalVrMetric = selected.metrics.original_vr_scaled
  const ma200HalfMetric = selected.metrics.ma200_risk_control_50
  const ma200Lb30HybridMetric = selected.metrics.ma200_lb30_hybrid
  const lowBasedLb30Metric = selected.metrics.low_based_lb30
  const lowBasedLb25Metric = selected.metrics.low_based_lb25
  const adaptiveMetric = selected.metrics.adaptive_exposure
  const warningLayer = selected.warning_layer
  const overlayDisplayModel: ArenaOverlayDisplayModel | null = warningLayer
    ? buildArenaOverlayDisplayModel({
        warningState: warningLayer.warning_state,
        warningReason: warningLayer.warning_reason,
        scenarioHint: warningLayer.scenario_hint,
        mcOverlay: warningLayer.mc_overlay,
      })
    : null
  const adaptiveDrawdownDelta =
    adaptiveMetric && buyHoldMetric
      ? adaptiveMetric.max_drawdown_pct - buyHoldMetric.max_drawdown_pct
      : null
  const adaptiveReturnDelta =
    adaptiveMetric && buyHoldMetric
      ? adaptiveMetric.final_return_pct - buyHoldMetric.final_return_pct
      : null
  const visibleStrategyNotes = displayStrategyKeys
  const currentMarketContext =
    BACKTEST_COPY.backtest.conditions.marketContextByEventId[
      selected.id as keyof typeof BACKTEST_COPY.backtest.conditions.marketContextByEventId
    ] ?? 'A historical stress period used to compare positioning differences under the same market conditions.'
  const currentPurpose =
    BACKTEST_COPY.backtest.conditions.purposeByEventId?.[
      selected.id as keyof NonNullable<typeof BACKTEST_COPY.backtest.conditions.purposeByEventId>
    ] ?? BACKTEST_COPY.backtest.conditions.purpose

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={panelStyle()}>
        <SectionHeader
          eyebrow="Strategy Arena"
          title="Strategy Comparison Arena"
          note="Same-condition TQQQ stress comparison. Warning comes before execution, and Arena remains a positioning tool rather than a winner-selection engine."
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {events.map((event) => (
            <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} style={tabStyle(selected.id === event.id)}>
              {event.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {([
            { key: 'charts', label: 'Charts' },
            { key: 'test_setup', label: 'Test Setup' },
          ] as const).map((item) => (
            <button key={item.key} type="button" onClick={() => setArenaViewMode(item.key)} style={tabStyle(arenaViewMode === item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <PlaceholderCard label="Source Event" text={selected.standard_event_name} detail={`${selected.start} to ${selected.end}`} />
          <PlaceholderCard
            label="Execution Stack"
            text="Forecast first, execution second"
            detail={
              selected.vr_source === 'survival_archive'
                ? 'The warning layer is read-only. Arena execution engines remain local, and the survival archive is used only to provide VR Original defense and Vmin-buy intent.'
                : 'The warning layer is read-only. Arena execution engines remain local, and no survival archive is attached for the VR Original reference.'
            }
          />
          <PlaceholderCard
            label="Playback"
            text="Open Event Study"
            detail={`Use /vr-survival?tab=Playback&event=${selected.playback_event_id} to review the full playback case.`}
          />
        </div>
      </div>

      {arenaViewMode === 'charts' ? (
        <>
      {warningLayer ? (
      <div style={panelStyle({ padding: '1rem 1.1rem' })}>
        <SectionHeader
          eyebrow="Forecast Layer"
          title="Downside Warning State"
          note="This system detects abnormal downside behavior before executing defensive actions. Warning does not equal trading."
        />
        {overlayDisplayModel ? <OverlayScoreStrip model={overlayDisplayModel} /> : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            marginTop: 12,
          }}
        >
          <PlaceholderCard
            compact
            label="Trigger Snapshot"
            text={`dd3 ${formatOptionalPercent(warningLayer.trigger_metrics.dd3)} | dd5 ${formatOptionalPercent(warningLayer.trigger_metrics.dd5)}`}
            detail={`dd6 ${formatOptionalPercent(warningLayer.trigger_metrics.dd6)} | PeakDD ${formatOptionalPercent(warningLayer.trigger_metrics.peakDD)} | Rebound ${formatOptionalPercent(warningLayer.trigger_metrics.rebound_from_low_pct)} | MA200 gap ${formatOptionalPercent(warningLayer.trigger_metrics.distance_to_ma200_pct)}`}
          />
          <PlaceholderCard
            compact
            label="VR Band Context"
            text={`Level ${warningLayer.trigger_metrics.vr_band_level ?? 'n/a'}`}
            detail={strategyArena?.methodology.warning_layer_rule}
          />
          <PlaceholderCard
            compact
            label="Overlay Status"
            text={warningLayer.mc_overlay ? 'Available' : 'Unavailable'}
            detail={
              warningLayer.mc_overlay
                ? `Dominant MC scenario: ${warningLayer.mc_overlay.dominantMcScenario} | Current regime: ${warningLayer.mc_overlay.mcCurrentRegime}`
                : 'Monte Carlo overlay is optional. Rule-based warning remains primary.'
            }
          />
        </div>
        <div style={{ marginTop: 12, color: warningStateTone(warningLayer.warning_state), fontSize: '0.82rem', fontWeight: 700 }}>
          {formatWarningExplainability(warningLayer)}
        </div>
        {overlayDisplayModel ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.3fr) minmax(260px, 0.95fr)',
              gap: 12,
              marginTop: 14,
            }}
          >
            <MonteCarloOverlayCard model={overlayDisplayModel} />
            <div style={{ display: 'grid', gap: 12 }}>
              <OverlayAlignmentBadge
                alignment={overlayDisplayModel.interpretationAlignment}
                note={overlayDisplayModel.interpretationNote}
                interpretationState={overlayDisplayModel.mcOverlay?.mcInterpretationState}
                agreementScore={overlayDisplayModel.mcOverlay?.mcAgreementScore}
                conflictScore={overlayDisplayModel.mcOverlay?.mcConflictScore}
              />
              <PlaceholderCard
                compact
                label="Overlay Use"
                text="Interpretive Only"
                detail="Monte Carlo overlay summarizes how similar synthetic stress paths behaved. Overlay is interpretive, not executable."
              />
            </div>
          </div>
        ) : null}
      </div>
      ) : null}

      <div style={panelStyle({ padding: '1rem 1.1rem' })}>
        <SectionHeader
          eyebrow={BACKTEST_COPY.backtest.philosophy.eyebrow}
          title={BACKTEST_COPY.backtest.philosophy.title}
        />
        <div style={{ display: 'grid', gap: 8 }}>
          {BACKTEST_COPY.backtest.philosophy.body.map((line) => (
            <div key={line} style={{ color: '#cbd5e1', fontSize: '0.92rem', lineHeight: 1.65 }}>
              {line}
            </div>
          ))}
          <div style={{ color: '#94a3b8', fontSize: '0.82rem', fontWeight: 700, marginTop: 2 }}>
            {BACKTEST_COPY.backtest.philosophy.footer}
          </div>
        </div>
      </div>

      <div style={panelStyle({ padding: '1rem 1.1rem' })}>
        <SectionHeader
          eyebrow={BACKTEST_COPY.backtest.conditions.eyebrow}
          title={BACKTEST_COPY.backtest.conditions.title}
          note="Simple English framing so the chart can be read as a positioning map."
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <PlaceholderCard
            compact
            label={BACKTEST_COPY.backtest.conditions.labels.period}
            text={formatArenaPeriodRange(selected.start, selected.end)}
            detail={currentMarketContext}
          />
          <PlaceholderCard
            compact
            label={BACKTEST_COPY.backtest.conditions.labels.asset}
            text={BACKTEST_COPY.backtest.conditions.asset.name}
            detail={BACKTEST_COPY.backtest.conditions.asset.detail}
          />
          <PlaceholderCard
            compact
            label={BACKTEST_COPY.backtest.conditions.labels.execution}
            text="Close signal, next-session action"
            detail={BACKTEST_COPY.backtest.conditions.execution}
          />
          <PlaceholderCard
            compact
            label={BACKTEST_COPY.backtest.conditions.labels.purpose}
            text="Positioning differences"
            detail={currentPurpose}
          />
          <PlaceholderCard
            compact
            label={BACKTEST_COPY.backtest.conditions.labels.note}
            text="Leveraged ETF behavior matters"
            detail={BACKTEST_COPY.backtest.conditions.note}
          />
        </div>
      </div>

      <div style={panelStyle()}>
        <SectionHeader
          eyebrow="Metrics"
          title="Final Return, Max Drawdown, Recovery Time, Exposure Stability"
          note="Arena compares seven response profiles under the same starting allocation and next-bar execution rules."
        />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Strategy', 'Final Return', 'Max Drawdown', 'Recovery Time', 'Exposure Stability'].map((header) => (
                  <th
                    key={header}
                    style={{
                      padding: '0.8rem 0.85rem',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      color: '#94a3b8',
                      textAlign: 'left',
                      fontSize: '0.78rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayStrategyKeys.map((strategyKey) => {
                const metric = selected.metrics[strategyKey]
                if (!metric) return null
                return (
                  <tr key={strategyKey}>
                    <td style={{ padding: '0.9rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#e5e7eb', fontWeight: 700 }}>
                      <span style={{ display: 'inline-flex', width: 10, height: 10, borderRadius: 999, background: STRATEGY_COLORS[strategyKey], marginRight: 10 }} />
                      {STRATEGY_LABELS[strategyKey]}
                    </td>
                    <td style={{ padding: '0.9rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1' }}>
                      {formatSignedPercent(metric.final_return_pct)}
                    </td>
                    <td style={{ padding: '0.9rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1' }}>
                      {formatSignedPercent(metric.max_drawdown_pct)}
                    </td>
                    <td style={{ padding: '0.9rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1' }}>
                      {formatRecoveryDays(metric.recovery_time_days)}
                    </td>
                    <td style={{ padding: '0.9rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1' }}>
                      {metric.exposure_stability_pct.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={panelStyle()}>
        <SectionHeader eyebrow="Chart 1" title="Equity Curve Comparison" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 14,
              padding: '0.85rem 0.95rem',
            }}
          >
            <div style={{ color: '#10B981', fontSize: '0.82rem', fontWeight: 800, marginBottom: 4 }}>Adaptive Exposure</div>
            {adaptiveMetric && buyHoldMetric ? (
              <div style={{ display: 'grid', gap: 4, fontSize: '0.82rem' }}>
                <span style={{ color: arenaDeltaTone(adaptiveDrawdownDelta ?? 0) }}>
                  DD vs B&amp;H {formatArenaDelta(adaptiveDrawdownDelta ?? 0)}
                </span>
                <span style={{ color: arenaDeltaTone(adaptiveReturnDelta ?? 0) }}>
                  Return vs B&amp;H {formatArenaDelta(adaptiveReturnDelta ?? 0)}
                </span>
              </div>
            ) : (
              <div style={{ color: '#64748b', fontSize: '0.8rem' }}>Adaptive Exposure is unavailable for this event.</div>
            )}
          </div>
          <div
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 14,
              padding: '0.85rem 0.95rem',
            }}
          >
            <div style={{ color: STRATEGY_COLORS.ma200_risk_control_50, fontSize: '0.82rem', fontWeight: 800, marginBottom: 4 }}>
              {BACKTEST_COPY.backtest.summary.ma200.title}
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.6 }}>
              {BACKTEST_COPY.backtest.summary.ma200.detail}
            </div>
            {ma200HalfMetric ? (
              <>
                <div style={{ color: '#94a3b8', fontSize: '0.77rem', marginTop: 6 }}>
                  MA200 (50%) {formatSignedPercent(ma200HalfMetric.final_return_pct)} | Max DD {formatSignedPercent(ma200HalfMetric.max_drawdown_pct)}
                </div>
                {ma200Lb30HybridMetric ? (
                  <div style={{ color: '#94a3b8', fontSize: '0.77rem', marginTop: 4 }}>
                    MA200 + LB30 {formatSignedPercent(ma200Lb30HybridMetric.final_return_pct)} | Max DD {formatSignedPercent(ma200Lb30HybridMetric.max_drawdown_pct)}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          <div
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 14,
              padding: '0.85rem 0.95rem',
            }}
          >
            <div style={{ color: STRATEGY_COLORS.low_based_lb30, fontSize: '0.82rem', fontWeight: 800, marginBottom: 4 }}>
              {BACKTEST_COPY.backtest.summary.lb30.title}
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.6 }}>
              {BACKTEST_COPY.backtest.summary.lb30.detail}
            </div>
            {lowBasedLb30Metric ? (
              <div style={{ color: '#94a3b8', fontSize: '0.77rem', marginTop: 6 }}>
                Final return {formatSignedPercent(lowBasedLb30Metric.final_return_pct)} | Max DD {formatSignedPercent(lowBasedLb30Metric.max_drawdown_pct)}
              </div>
            ) : (
              <div style={{ color: '#64748b', fontSize: '0.77rem', marginTop: 6 }}>
                Default low-based recovery reference for this event.
              </div>
            )}
          </div>
          <div
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 14,
              padding: '0.85rem 0.95rem',
            }}
          >
            <div style={{ color: STRATEGY_COLORS.original_vr_scaled, fontSize: '0.82rem', fontWeight: 800, marginBottom: 4 }}>
              {BACKTEST_COPY.backtest.summary.vr.title}
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.6 }}>
              {BACKTEST_COPY.backtest.summary.vr.detail}
            </div>
            {originalVrMetric ? (
              <div style={{ color: '#94a3b8', fontSize: '0.77rem', marginTop: 6 }}>
                Final return {formatSignedPercent(originalVrMetric.final_return_pct)} | Max DD {formatSignedPercent(originalVrMetric.max_drawdown_pct)}
              </div>
            ) : (
              <div style={{ color: '#64748b', fontSize: '0.77rem', marginTop: 6 }}>
                VR Original (Capped) is hidden for this event because no survival archive is attached.
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {displayStrategyKeys.map((strategyKey) => (
            <div
              key={strategyKey}
              title={
                strategyKey === 'original_vr_scaled'
                  ? 'VR Original (Capped): Reuses archive VR defense and Vmin-buy intent on the Arena-local TQQQ path. Rebuys are capped to 50% added capital per cycle and exposure never re-risks above 80%.'
                  : undefined
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '0.45rem 0.7rem',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                color: '#cbd5e1',
                fontSize: '0.8rem',
                cursor: strategyKey === 'original_vr_scaled' ? 'help' : undefined,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 999, background: STRATEGY_COLORS[strategyKey] }} />
              {STRATEGY_CHIP_LABELS[strategyKey]}
              {strategyKey === 'original_vr_scaled' && (
                <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: 2 }}>i</span>
              )}
            </div>
          ))}
          {selected.vr_source !== 'survival_archive' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.45rem 0.7rem', borderRadius: 999, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', color: '#475569', fontSize: '0.78rem', fontStyle: 'italic' }}>
              VR Original (Capped) reference hidden for this event because no survival archive is attached
            </div>
          )}
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={selected.chart_data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <Tooltip content={<BacktestChartTooltip visibleStrategyKeys={displayStrategyKeys} metricKind="equity" />} />
            {displayStrategyKeys.map((strategyKey) => {
              const lineVisuals = getArenaLineVisuals(strategyKey)
              return (
                <Line
                  key={strategyKey}
                  dataKey={STRATEGY_SERIES_KEYS[strategyKey].equity}
                  stroke={STRATEGY_COLORS[strategyKey]}
                  strokeWidth={lineVisuals.strokeWidth}
                  strokeOpacity={lineVisuals.strokeOpacity}
                  strokeDasharray={lineVisuals.strokeDasharray}
                  dot={false}
                  name={STRATEGY_LABELS[strategyKey]}
                  connectNulls={false}
                />
              )
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={panelStyle()}>
        <SectionHeader eyebrow="Chart 2" title="Drawdown Comparison" />
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={selected.chart_data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <Tooltip content={<BacktestChartTooltip visibleStrategyKeys={displayStrategyKeys} metricKind="drawdown" />} />
            {displayStrategyKeys.map((strategyKey) => {
              const lineVisuals = getArenaLineVisuals(strategyKey)
              return (
                <Line
                  key={strategyKey}
                  dataKey={STRATEGY_SERIES_KEYS[strategyKey].drawdown}
                  stroke={STRATEGY_COLORS[strategyKey]}
                  strokeWidth={strategyKey === 'adaptive_exposure' ? 2.2 : Math.max(1.2, lineVisuals.strokeWidth - 0.35)}
                  strokeOpacity={lineVisuals.strokeOpacity}
                  strokeDasharray={lineVisuals.strokeDasharray}
                  dot={false}
                  name={`${STRATEGY_LABELS[strategyKey]} DD`}
                  connectNulls={false}
                />
              )
            })}
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={panelStyle()}>
        <SectionHeader eyebrow="Chart 3" title="Exposure Timeline" note="Exposure is shown as a percent of capital deployed to the leveraged instrument." />
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={selected.chart_data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} domain={[0, 100]} />
            <Tooltip content={<BacktestChartTooltip visibleStrategyKeys={displayStrategyKeys} metricKind="exposure" />} />
            {displayStrategyKeys.map((strategyKey) => {
              const lineVisuals = getArenaLineVisuals(strategyKey)
              return (
                <Line
                  key={strategyKey}
                  dataKey={STRATEGY_SERIES_KEYS[strategyKey].exposure}
                  stroke={STRATEGY_COLORS[strategyKey]}
                  strokeWidth={strategyKey === 'adaptive_exposure' ? 2.2 : Math.max(1.2, lineVisuals.strokeWidth - 0.35)}
                  strokeOpacity={lineVisuals.strokeOpacity}
                  strokeDasharray={lineVisuals.strokeDasharray}
                  dot={false}
                  name={`${STRATEGY_LABELS[strategyKey]} Exposure`}
                  connectNulls={false}
                />
              )
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={panelStyle()}>
        <SectionHeader eyebrow="Method" title="Strategy Rules Used In This Arena" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <PlaceholderCard label="MA200 (50%)" text="80 -> 50 -> 80" detail={strategyArena?.methodology.ma200_rule} />
          <PlaceholderCard label="MA200 + LB30" text="50% MA defense + low-based recovery" detail={strategyArena?.methodology.ma200_rule} />
          <PlaceholderCard label="LB30 / LB25" text="Adaptive downside + low-based re-risk" detail={strategyArena?.methodology.vr_source_priority} />
          <PlaceholderCard label="Adaptive Exposure" text="V-shape reference" detail={strategyArena?.methodology.vr_source_priority} />
          <PlaceholderCard
            label="VR Original (Capped)"
            text="Controlled VR baseline"
            detail="Archive VR defense and Vmin-buy intent are replayed on the Arena-local TQQQ path, but rebuys stay capped so the baseline remains controlled."
          />
          <PlaceholderCard
            label="Warning Layer"
            text="Forecast first"
            detail={strategyArena?.methodology.warning_layer_rule}
          />
          <PlaceholderCard
            label="Vmin Handling"
            text="Visual only"
            detail="Vmin remains a reference band for Arena warning and low-based engines. VR Original alone is allowed to reuse archive Vmin-buy intent, but those rebuys are capped by cycle capital and cash-preservation rules."
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <a href={`/vr-survival?tab=Playback&event=${selected.playback_event_id}`} style={{ ...tabStyle(false), textDecoration: 'none' }}>
            Open Playback For {selected.label}
          </a>
        </div>
      </div>
        </>
      ) : (
        <>
          <div style={panelStyle()}>
            <SectionHeader
              eyebrow="Test Setup"
              title="Initial Conditions"
              note="Arena compares same-condition TQQQ paths. Playback remains a separate archive replay tab."
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <PlaceholderCard compact label="Asset" text="TQQQ" detail="Common leveraged instrument across this Arena event." />
              <PlaceholderCard compact label="Initial Value" text="100" detail="Normalized starting value for every visible curve." />
              <PlaceholderCard compact label="Date Range" text={`${selected.start} to ${selected.end}`} detail="Current selected event window." />
              <PlaceholderCard compact label="Price Series" text="Common TQQQ series" detail="All Arena curves are compared on the same TQQQ baseline." />
              <PlaceholderCard compact label="Comparison Basis" text="Same-condition Arena" detail="Each strategy is measured inside the same event window." />
              <PlaceholderCard compact label="Baseline Note" text="Common start, different path" detail="All curves start from the same baseline; only paths differ." />
              {selected.adaptive_exposure_report ? (
                <PlaceholderCard
                  compact
                  label="Adaptive Start"
                  text={`${selected.adaptive_exposure_report.initial_state.exposure}%`}
                  detail={selected.adaptive_exposure_report.initial_state.reason}
                />
              ) : null}
              {warningLayer ? (
                <PlaceholderCard
                  compact
                  label="Warning Start"
                  text={formatWarningStateLabel(warningLayer.warning_state)}
                  detail={warningLayer.warning_reason}
                />
              ) : null}
            </div>
          </div>

          <div style={panelStyle()}>
            <SectionHeader eyebrow="Strategy Notes" title="What Each Curve Represents" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {visibleStrategyNotes.map((strategyKey) => (
                <PlaceholderCard
                  key={strategyKey}
                  label={STRATEGY_LABELS[strategyKey]}
                  text={STRATEGY_LABELS[strategyKey]}
                  detail={
                    strategyKey === 'adaptive_exposure'
                      ? `${STRATEGY_SETUP_NOTES[strategyKey]} ${formatAdaptiveExplainability(selected.adaptive_exposure_report)}`
                      : strategyKey === 'low_based_lb30' ||
                          strategyKey === 'low_based_lb25' ||
                          strategyKey === 'ma200_lb30_hybrid' ||
                          strategyKey === 'ma200_risk_control_50'
                        ? `${STRATEGY_SETUP_NOTES[strategyKey]} ${formatStrategyExplainability(selected.strategy_reports?.[strategyKey])}`
                      : strategyKey === 'original_vr_scaled'
                        ? `${STRATEGY_SETUP_NOTES[strategyKey]} ${formatStrategyExplainability(selected.strategy_reports?.[strategyKey])}${selected.vr_source !== 'survival_archive' ? ' Hidden for this event because no survival archive is attached.' : ''}`
                        : STRATEGY_SETUP_NOTES[strategyKey]
                  }
                />
              ))}
            </div>
          </div>

          <div style={panelStyle()}>
            <SectionHeader eyebrow="Read Guide" title="How to Read Results" />
            <div style={{ display: 'grid', gap: 10 }}>
              {[
                'Higher equity curve = stronger cumulative growth.',
                'Smaller drawdown = better downside control.',
                'Curves are compared under the same TQQQ baseline.',
                'VR Original uses archive VR defense and Vmin-buy intent, but applies it as a controlled Arena-local baseline with capped rebuys.',
                'Warning state is forecast-first. It prepares interpretation and comparison, but does not directly trade.',
              ].map((note) => (
                <div
                  key={note}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 14,
                    padding: '0.85rem 0.95rem',
                    color: '#cbd5e1',
                    fontSize: '0.84rem',
                    lineHeight: 1.55,
                  }}
                >
                  {note}
                </div>
              ))}
            </div>
          </div>

          <div style={panelStyle()}>
            <SectionHeader
              eyebrow="Quick Summary"
              title="Current Event Snapshot"
              note={metricRows.length ? 'Uses the visible Arena metrics for this selected event.' : 'Static explanatory text only.'}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <PlaceholderCard
                compact
                label="Highest Final Return"
                text={bestFinalPerformer ? STRATEGY_LABELS[bestFinalPerformer.strategyKey] : 'Metrics not available'}
                detail={bestFinalPerformer ? `Final return ${formatSignedPercent(bestFinalPerformer.metric.final_return_pct)} | Read as a positioning outcome, not a winner.` : 'Quick summary falls back to static setup guidance.'}
              />
              <PlaceholderCard
                compact
                label="Lowest Drawdown"
                text={lowestDrawdownPerformer ? STRATEGY_LABELS[lowestDrawdownPerformer.strategyKey] : 'Metrics not available'}
                detail={lowestDrawdownPerformer ? `Max drawdown ${formatSignedPercent(lowestDrawdownPerformer.metric.max_drawdown_pct)}` : 'Use the charts tab for visual inspection.'}
              />
              <PlaceholderCard
                compact
                label="Adaptive vs Buy & Hold"
                text={
                  adaptiveMetric && buyHoldMetric
                    ? adaptiveMetric.final_return_pct > buyHoldMetric.final_return_pct
                      ? 'Adaptive Exposure finished above Buy & Hold'
                      : adaptiveMetric.final_return_pct < buyHoldMetric.final_return_pct
                        ? 'Adaptive Exposure finished below Buy & Hold'
                        : 'Adaptive Exposure matched Buy & Hold'
                    : 'Adaptive Exposure not available'
                }
                detail={
                  adaptiveMetric && buyHoldMetric
                    ? `${formatSignedPercent(adaptiveMetric.final_return_pct)} vs ${formatSignedPercent(buyHoldMetric.final_return_pct)} final return`
                    : 'Adaptive metrics are unavailable for this event.'
                }
              />
              <PlaceholderCard
                compact
                label="LB30 vs LB25"
                text={
                  lowBasedLb30Metric && lowBasedLb25Metric
                    ? lowBasedLb30Metric.final_return_pct >= lowBasedLb25Metric.final_return_pct
                      ? 'LB30 finished above LB25'
                      : 'LB25 finished above LB30'
                    : 'Low-based comparison unavailable'
                }
                detail={
                  lowBasedLb30Metric && lowBasedLb25Metric
                    ? `${formatSignedPercent(lowBasedLb30Metric.final_return_pct)} vs ${formatSignedPercent(lowBasedLb25Metric.final_return_pct)} final return`
                    : 'This card compares the two low-based recovery ladders for the selected event.'
                }
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function PoolLogicTab() {
  return (
    <div style={panelStyle()}>
      <SectionHeader
        eyebrow="Pool Logic"
        title="Pool Survival Mechanism"
        note="Pool is the capital buffer that lets VR reduce leverage early and restore it in controlled stages."
      />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th
                style={{
                  padding: '0.8rem 0.85rem',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  color: '#94a3b8',
                  textAlign: 'left',
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                }}
              >
                State
              </th>
              <th
                style={{
                  padding: '0.8rem 0.85rem',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  color: '#94a3b8',
                  textAlign: 'left',
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                }}
              >
                Pool Goal
              </th>
              <th
                style={{
                  padding: '0.8rem 0.85rem',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  color: '#94a3b8',
                  textAlign: 'left',
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                }}
              >
                Exposure Rule
              </th>
              <th
                style={{
                  padding: '0.8rem 0.85rem',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  color: '#94a3b8',
                  textAlign: 'left',
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                }}
              >
                Recovery Rule
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#f59e0b', fontWeight: 800 }}>
                Caution
              </td>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }}>15%</td>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }}>Trim slightly</td>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }}>Wait for stabilization</td>
            </tr>
            <tr>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#fb923c', fontWeight: 800 }}>
                Defense Prep
              </td>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }}>25-35%</td>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }}>Reduce leverage</td>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }}>Wait for recovery signals</td>
            </tr>
            <tr>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#ef4444', fontWeight: 800 }}>
                Defense
              </td>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }}>50%+</td>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }}>Capital preservation</td>
              <td style={{ padding: '0.8rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#cbd5e1' }}>Avoid aggressive re-entry</td>
            </tr>
            <tr>
              <td style={{ padding: '0.8rem 0.85rem', color: '#38bdf8', fontWeight: 800 }}>Re-entry Trial</td>
              <td style={{ padding: '0.8rem 0.85rem', color: '#cbd5e1' }}>Deploy small</td>
              <td style={{ padding: '0.8rem 0.85rem', color: '#cbd5e1' }}>Test market</td>
              <td style={{ padding: '0.8rem 0.85rem', color: '#cbd5e1' }}>Scale if recovery persists</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OptionsOverlayTab() {
  return (
    <div style={panelStyle({ borderColor: 'rgba(56,189,248,0.28)' })}>
      <SectionHeader
        eyebrow="Advanced Overlay"
        title="Options Overlay"
        note="Supplementary only. This tab does not override VR signals."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))', gap: 12 }}>
        <PlaceholderCard label="Put/Call Ratio" text="Advanced overlay placeholder" />
        <PlaceholderCard label="VIX Term Structure" text="Advanced overlay placeholder" />
        <PlaceholderCard label="VVIX" text="Advanced overlay placeholder" />
      </div>
    </div>
  )
}

function PhilosophyTab({ runId }: { runId: string }) {
  return (
    <div style={panelStyle()}>
      <SectionHeader
        eyebrow="Philosophy"
        title="VR Survival Framework"
        note={`Loaded from vr_survival.json (${runId}).`}
      />
      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 16,
          padding: '1rem',
          color: '#cbd5e1',
          lineHeight: 1.8,
          fontSize: '0.98rem',
        }}
      >
        <div>Standard defines the environment.</div>
        <div>VR defines leverage exposure.</div>
        <div style={{ marginTop: 10 }}>Standard evaluates systemic conditions.</div>
        <div>VR controls leverage exposure and survival posture.</div>
        <div style={{ marginTop: 10 }}>VR may turn defensive earlier than Standard.</div>
      </div>
    </div>
  )
}

function LeverageStressHeatmap({ heatmapData }: { heatmapData?: ETFRoomData | null }) {
  const leverageItems = heatmapData?.sections?.leverage?.items ?? []
  const rows = HEATMAP_SYMBOLS.map((symbol) => {
    const item = leverageItems.find((entry) => entry.symbol === symbol)
    return {
      symbol,
      item,
      state: classifyHeatmapState(item),
    }
  })

  return (
    <div style={panelStyle()}>
      <SectionHeader
        eyebrow="System View"
        title="Leverage Stress Heatmap"
        note="Green stable, yellow weak, orange fragile, red breakdown risk. Missing backend rows remain no data."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {rows.map((row) => {
          const tone = heatmapTone(row.state)

          return (
            <div
              key={row.symbol}
              style={{
                borderRadius: 16,
                padding: '1rem',
                minHeight: 132,
                ...tone,
              }}
            >
              <div
                style={{
                  fontSize: '0.71rem',
                  color: '#cbd5e1',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                {row.symbol}
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 800, marginTop: 10 }}>{row.state}</div>
              <div style={{ color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.5, marginTop: 10 }}>
                {row.item
                  ? `20d ${row.item.ret_20d?.toFixed(1)}% | 5d ${row.item.ret_5d?.toFixed(1)}% | Vol ${row.item.vol_surge?.toFixed(2)}x`
                  : 'No existing output row in etf_room.json'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function VRSurvival({
  data,
  heatmapData,
  patternDashboard,
  playbackData,
  strategyArena,
  initialTab,
  initialPlaybackEventId,
  vrAudit,
  vrTimeline,
  iaPayload,
  simParams,
}: {
  data: VRSurvivalData
  heatmapData?: ETFRoomData | null
  patternDashboard?: VRDashboardPatternSummary | null
  playbackData?: VRPlaybackView | null
  strategyArena?: StrategyArenaView | null
  initialTab?: Tab
  initialPlaybackEventId?: string
  vrAudit?: VrAuditViewPayload | null
  vrTimeline?: VrTimelineRow[] | null
  iaPayload?: InvestorActionViewPayload | null
  simParams?: { event_id?: string; sim_start?: string; sim_capital?: string; sim_stock_pct?: string }
}) {
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab ?? 'Overview') ? (initialTab as Tab) : 'Overview')
  const [fetchedPlayback, setFetchedPlayback] = useState<VRPlaybackView | null>(null)
  const [playbackLoading, setPlaybackLoading] = useState(false)
  const [fetchedArena, setFetchedArena] = useState<StrategyArenaView | null>(null)
  const [arenaLoading, setArenaLoading] = useState(false)
  const playbackFetchRef = useRef(false)
  const arenaFetchRef = useRef(false)

  // Fetch playback data on mount (used by Overview, Playback, Strategy Lab tabs)
  useEffect(() => {
    if (playbackFetchRef.current) return
    playbackFetchRef.current = true
    setPlaybackLoading(true)
    const params = new URLSearchParams()
    if (simParams?.event_id) params.set('event_id', simParams.event_id)
    if (simParams?.sim_start) params.set('sim_start', simParams.sim_start)
    if (simParams?.sim_capital) params.set('sim_capital', simParams.sim_capital)
    if (simParams?.sim_stock_pct) params.set('sim_stock_pct', simParams.sim_stock_pct)
    const url = `/api/vr-playback${params.size > 0 ? `?${params.toString()}` : ''}`
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: VRPlaybackView | null) => setFetchedPlayback(data))
      .catch(() => {})
      .finally(() => setPlaybackLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch arena data lazily when Backtest tab is activated
  useEffect(() => {
    if (tab !== 'Backtest') return
    if (arenaFetchRef.current) return
    arenaFetchRef.current = true
    setArenaLoading(true)
    fetch('/api/vr-arena')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: StrategyArenaView | null) => setFetchedArena(data))
      .catch(() => {})
      .finally(() => setArenaLoading(false))
  }, [tab])

  const effectivePlayback = fetchedPlayback ?? playbackData ?? null
  const effectiveArena = fetchedArena ?? strategyArena ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)} style={tabStyle(tab === item)}>
            {item}
          </button>
        ))}
      </div>

      {/* ── Investor posture compact strip (SA17) ── */}
      {iaPayload && (
        <div style={{
          display:       'flex',
          alignItems:    'center',
          gap:           8,
          background:    'rgba(255,255,255,0.02)',
          border:        '1px solid rgba(255,255,255,0.05)',
          borderRadius:  8,
          padding:       '5px 12px',
          flexWrap:      'wrap',
        }}>
          <span style={{ color: '#4B5563', fontSize: '0.62rem', fontWeight: 700 }}>Investor posture</span>
          <InvestorActionBadgeRow posture={iaPayload.action_posture} size="sm" />
          {iaPayload.constraints.length > 0 && (
            <span style={{ color: '#6B7280', fontSize: '0.62rem' }}>· {iaPayload.constraints[0]}</span>
          )}
        </div>
      )}

      {tab === 'Overview' ? (
        <OverviewTab data={data} patternDashboard={patternDashboard} playbackData={effectivePlayback} vrAudit={vrAudit} />
      ) : null}
      {tab === 'Playback' ? (
        <PlaybackTab playbackData={effectivePlayback} initialPlaybackEventId={initialPlaybackEventId} />
      ) : null}
      {tab === 'Backtest' ? <BacktestTab strategyArena={effectiveArena} /> : null}
      {tab === 'Pool Logic' ? <PoolLogicTab /> : null}
      {tab === 'Options Overlay' ? <OptionsOverlayTab /> : null}
      {tab === 'Philosophy' ? <PhilosophyTab runId={data.run_id} /> : null}
      {tab === 'Crash Analysis' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{
            background: 'rgba(252,165,165,0.05)',
            border: '1px solid rgba(252,165,165,0.18)',
            borderRadius: 14,
            padding: '0.75rem 1rem',
          }}>
            <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.13em', fontWeight: 600, marginBottom: 6 }}>
              Crash Analysis · Validation Layer
            </div>
            <div style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.55 }}>
              Use this view to validate the AI interpretation above against observed engine behavior.
              Pattern matches and historical analogs here should confirm or challenge the scenarios in the AI panel — not replace them.
              Discrepancies between AI scenario probabilities and historical pattern data are signal, not noise.
            </div>
          </div>
          <OverviewTab data={data} patternDashboard={patternDashboard} playbackData={effectivePlayback} vrAudit={vrAudit} />
        </div>
      ) : null}
      {tab === 'Strategy Lab' ? (
        <StrategyLabTab events={(effectivePlayback?.events ?? []) as unknown as LabEvent[]} />
      ) : null}
      {tab === 'Timeline' ? (
        <VrTimelinePanel rows={vrTimeline} useSampleData={true} />
      ) : null}
      <LeverageStressHeatmap heatmapData={heatmapData} />
    </div>
  )
}
