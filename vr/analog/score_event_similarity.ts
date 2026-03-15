import type { PriorityEventVRTag } from '../types/priority_event_vr_tag'

export type CurrentAnalogFeatures = {
  pattern_type?: string
  ma200_status: PriorityEventVRTag['vr_analysis']['ma200_status']
  leverage_stress: PriorityEventVRTag['vr_analysis']['leverage_stress']
  recovery_quality: PriorityEventVRTag['vr_analysis']['recovery_quality']
  tags: string[]
}

export function scoreEventSimilarity(
  current: CurrentAnalogFeatures,
  historical: PriorityEventVRTag
): number {
  let score = 0

  if (current.pattern_type && current.pattern_type === historical.vr_analysis.pattern_type) {
    score += 40
  }

  const ma200Order = ['above', 'tested', 'breached', 'sustained_below']
  const currentMa200 = ma200Order.indexOf(current.ma200_status)
  const historicalMa200 = ma200Order.indexOf(historical.vr_analysis.ma200_status)
  if (currentMa200 >= 0 && historicalMa200 >= 0) {
    const diff = Math.abs(currentMa200 - historicalMa200)
    score += diff === 0 ? 20 : diff === 1 ? 12 : diff === 2 ? 6 : 0
  }

  const leverageOrder = ['low', 'medium', 'high', 'extreme']
  const currentLeverage = leverageOrder.indexOf(current.leverage_stress)
  const historicalLeverage = leverageOrder.indexOf(historical.vr_analysis.leverage_stress)
  if (currentLeverage >= 0 && historicalLeverage >= 0) {
    const diff = Math.abs(currentLeverage - historicalLeverage)
    score += diff === 0 ? 20 : diff === 1 ? 12 : diff === 2 ? 5 : 0
  }

  const recoveryOrder = ['weak', 'mixed', 'improving', 'strong']
  const currentRecovery = recoveryOrder.indexOf(current.recovery_quality)
  const historicalRecovery = recoveryOrder.indexOf(historical.vr_analysis.recovery_quality)
  if (currentRecovery >= 0 && historicalRecovery >= 0) {
    const diff = Math.abs(currentRecovery - historicalRecovery)
    score += diff === 0 ? 10 : diff === 1 ? 6 : diff === 2 ? 2 : 0
  }

  const overlap = historical.vr_analysis.tags.filter((tag) => current.tags.includes(tag)).length
  const tagDenominator = Math.max(current.tags.length, historical.vr_analysis.tags.length, 1)
  score += Math.round((overlap / tagDenominator) * 10)

  return Math.min(100, score)
}
