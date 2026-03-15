export type CyclePlaceholderValue = number | null
export type CyclePendingState = 'pending' | 'allowed' | 'paused' | 'active' | 'monitoring'

export type CycleGridLevel = {
  level_no: number
  price: number
  weight: number
  status: 'pending' | 'ready' | 'watch'
  touched: boolean
  executed: boolean
  note: string
}

export type EventReplayCycle = {
  cycle_no: number
  cycle_start_date: string
  cycle_end_date: string
  event_id: string
  event_date: string
  is_active_cycle: boolean
  days_from_event_start: number
  days_to_event_end: number
  vref: CyclePlaceholderValue
  vmin: CyclePlaceholderValue
  vmax: CyclePlaceholderValue
  ma200_status: string | null
  leverage_stress: string | null
  recovery_quality: string | null
  pattern_type: string | null
  scenario_bias: string[]
  playbook_bias: string[]
  buy_permission_state: CyclePendingState
  defense_state: CyclePendingState
  theoretical_buy_grid: CycleGridLevel[]
  theoretical_sell_grid: CycleGridLevel[]
  representative_buy_grid: CycleGridLevel[]
  representative_sell_grid: CycleGridLevel[]
}

export type TriggerLogItem = {
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
}

export type ChartOverlayContract = {
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
    severity: TriggerLogItem['severity']
  }>
}

export type CycleSnapshot = {
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
}

export type ActiveCycleSelection = {
  active_cycle: EventReplayCycle | null
  previous_cycle: Pick<EventReplayCycle, 'cycle_no' | 'cycle_start_date' | 'cycle_end_date'> | null
  next_cycle: Pick<EventReplayCycle, 'cycle_no' | 'cycle_start_date' | 'cycle_end_date'> | null
  active_cycle_index: number
}

export type EventCycleFramework = {
  cycles: EventReplayCycle[]
  active_selection: ActiveCycleSelection
  snapshot: CycleSnapshot | null
  trigger_log: TriggerLogItem[]
  chart_overlay: ChartOverlayContract
}
