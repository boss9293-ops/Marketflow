import { EVENT_INITIAL_STATE_DEFAULTS } from './default_event_state'
import type { SimulationStartOption } from '../types/event_initial_state'

export function getSimulationStartDate(input: {
  availableStartOptions: SimulationStartOption[]
  overrideDate?: string
}) {
  const options = input.availableStartOptions
  if (!options.length) {
    return {
      simulationStartDate: null,
      effectiveWarmupTradingDays: 0,
    }
  }

  if (input.overrideDate) {
    const exact = options.find((option) => option.date === input.overrideDate) ?? null
    if (exact) {
      const index = options.findIndex((option) => option.date === exact.date)
      return {
        simulationStartDate: exact.date,
        effectiveWarmupTradingDays: options.length - index,
      }
    }
  }

  const defaultIndex = Math.max(0, options.length - EVENT_INITIAL_STATE_DEFAULTS.warmupTradingDays)
  return {
    simulationStartDate: options[defaultIndex].date,
    effectiveWarmupTradingDays: options.length - defaultIndex,
  }
}
