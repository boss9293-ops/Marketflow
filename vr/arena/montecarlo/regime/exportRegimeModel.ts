import type { RegimeModel } from './types'

export function serializeRegimeModel(model: RegimeModel) {
  return JSON.stringify(model, null, 2)
}
