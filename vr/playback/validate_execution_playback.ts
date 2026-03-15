import type { ExecutionPlaybackCollection } from '../types/execution_playback'
import type { VRPlaybackView } from './vr_playback_loader'

type BenchmarkValidation = {
  event_id: string
  event_name: string
  default_cap: {
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
    last_trade_date: string | null
  }
  cap_comparison: {
    cap_30_blocked_buys: number
    cap_50_blocked_buys: number
    cap_unlimited_blocked_buys: number
    cap_30_cycle_pool_used_pct: number
    cap_50_cycle_pool_used_pct: number
    cap_unlimited_cycle_pool_used_pct: number
  }
  recent_trades: Array<{
    replay_date: string
    trade_type: 'buy' | 'sell' | 'defense' | 'blocked_buy' | null
    state_after: string
    shares_after: number
    avg_cost_after: number
    pool_cash_after: number
    cycle_pool_used_pct: number
    blocked_by_cap: boolean
  }>
}

function summarizeCollection(collection: ExecutionPlaybackCollection) {
  const variant50 = collection.variants['50']
  return {
    has_buy_execution: variant50.validation_summary.has_buy_execution,
    has_sell_execution: variant50.validation_summary.has_sell_execution,
    has_defense_execution: variant50.validation_summary.has_defense_execution,
    avg_cost_changed: variant50.validation_summary.avg_cost_changed,
    shares_changed: variant50.validation_summary.shares_changed,
    pool_cash_changed: variant50.validation_summary.pool_cash_changed,
    blocked_by_cap_observed: variant50.validation_summary.blocked_by_cap_observed,
    executed_buy_count: variant50.validation_summary.executed_buy_count,
    executed_sell_count: variant50.validation_summary.executed_sell_count,
    executed_defense_count: variant50.validation_summary.executed_defense_count,
    blocked_buy_count: variant50.validation_summary.blocked_buy_count,
    last_trade_date: variant50.pool_usage_summary.last_trade_date,
  }
}

export function validateExecutionPlaybackBenchmarks(
  view: VRPlaybackView | null,
  benchmarkEventIds = ['2020-02', '2024-07', '2025-01']
): BenchmarkValidation[] {
  if (!view?.events?.length) return []

  return benchmarkEventIds
    .map((eventId) => {
      const event = view.events.find((item) => item.event_id === eventId)
      if (!event) return null
      const variant30 = event.execution_playback.variants['30']
      const variant50 = event.execution_playback.variants['50']
      const variantUnlimited = event.execution_playback.variants.unlimited
      return {
        event_id: event.event_id,
        event_name: event.name,
        default_cap: summarizeCollection(event.execution_playback),
        cap_comparison: {
          cap_30_blocked_buys: variant30.validation_summary.blocked_buy_count,
          cap_50_blocked_buys: variant50.validation_summary.blocked_buy_count,
          cap_unlimited_blocked_buys: variantUnlimited.validation_summary.blocked_buy_count,
          cap_30_cycle_pool_used_pct: variant30.pool_usage_summary.active_cycle_pool_used_pct,
          cap_50_cycle_pool_used_pct: variant50.pool_usage_summary.active_cycle_pool_used_pct,
          cap_unlimited_cycle_pool_used_pct: variantUnlimited.pool_usage_summary.active_cycle_pool_used_pct,
        },
        recent_trades: variant50.trade_log
          .filter((item) => item.trade_executed || item.blocked_by_cap)
          .slice(-5)
          .map((item) => ({
            replay_date: item.replay_date,
            trade_type: item.trade_type,
            state_after: item.state_after,
            shares_after: item.shares_after,
            avg_cost_after: item.avg_cost_after,
            pool_cash_after: item.pool_cash_after,
            cycle_pool_used_pct: item.cycle_pool_used_pct,
            blocked_by_cap: item.blocked_by_cap,
          })),
      }
    })
    .filter((item): item is BenchmarkValidation => item != null)
}
