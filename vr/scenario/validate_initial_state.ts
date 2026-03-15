import type { EventInitialState, EventInitialStateOverrides } from '../types/event_initial_state'

export function validateInitialState(input: {
  simulationStartDate: string | null
  initialState: EventInitialState | null
  overrides?: EventInitialStateOverrides
}): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  const initialState = input.initialState
  const advancedMode = Boolean(input.overrides?.advanced_mode)

  if (!input.simulationStartDate) {
    errors.push('Simulation start date is required.')
  }

  if (!initialState) {
    errors.push('Initial state could not be derived.')
    return { valid: false, errors }
  }

  if (!(initialState.start_price > 0)) {
    errors.push('Start price must exist and be greater than zero.')
  }
  if (!(initialState.initial_capital > 0)) {
    errors.push('Initial capital must be greater than zero.')
  }
  if (!advancedMode) {
    const allocationSum = initialState.stock_allocation_pct + initialState.pool_allocation_pct
    if (Math.abs(allocationSum - 1) > 0.0001) {
      errors.push('Stock allocation and pool allocation must sum to 100%.')
    }
  }
  if (initialState.initial_pool_cash < 0) {
    errors.push('Initial pool cash cannot be negative.')
  }
  if (initialState.initial_share_count < 0) {
    errors.push('Initial share count must be zero or greater.')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
