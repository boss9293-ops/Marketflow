export type RealtimeTone = 'safe' | 'caution' | 'risk'

export function realtimeTone(phase: string, defensiveMode: string, shockProb: number | null): RealtimeTone {
  if (defensiveMode === 'ON' || phase === 'Shock' || (shockProb ?? 0) > 50) return 'risk'
  if (defensiveMode === 'WATCH' || phase === 'Slowdown' || phase === 'Contraction' || (shockProb ?? 0) >= 30) return 'caution'
  return 'safe'
}

export function realtimeHeadline(tone: RealtimeTone, mode: 'ko' | 'en') {
  if (mode === 'en') {
    if (tone === 'risk') return 'Defense-first regime. Risk checks are required.'
    if (tone === 'caution') return 'Momentum is slowing. Confirmation is preferred.'
    return 'The current market environment is relatively stable.'
  }
  if (tone === 'risk') return '방어 우선 구간입니다. 리스크 점검이 필요합니다.'
  if (tone === 'caution') return '속도는 둔화 중입니다. 확인이 유리합니다.'
  return '현재 시장 환경은 비교적 안정적입니다.'
}

export function realtimeExplainScript(
  mode: 'ko' | 'en',
  lpiText: string,
  rpiText: string,
  riskText: string,
  drivers: string[],
) {
  if (mode === 'en') {
    return {
      line1: `In plain words, liquidity is ${lpiText}, rate pressure is ${rpiText}, and volatility/credit is ${riskText}.`,
      line2: `So today, focus on pace control first. Key checks: ${drivers.slice(0, 2).join(', ') || 'VRI, CSI'}.`,
    }
  }
  return {
    line1: `한마디로, 유동성은 ${lpiText}, 금리는 ${rpiText}, 변동성/신용은 ${riskText} 흐름입니다.`,
    line2: `그래서 오늘은 무리한 확대보다 흐름 확인에 무게를 두시면 좋습니다. 확인 포인트는 ${drivers.slice(0, 2).join(', ') || 'VRI, CSI'}입니다.`,
  }
}

export function sensorStatusLabel(value: number, kind: 'lpi' | 'rpi' | 'risk', mode: 'ko' | 'en') {
  if (mode === 'en') {
    if (value >= 66) return kind === 'lpi' ? 'Pressure Building' : kind === 'rpi' ? 'Restrictive' : 'Stress Expanding'
    if (value >= 33) return kind === 'lpi' ? 'Balanced' : kind === 'rpi' ? 'Neutral' : 'Moderate'
    return kind === 'lpi' ? 'Buffering' : kind === 'rpi' ? 'Easing' : 'Stable'
  }
  if (value >= 66) return kind === 'lpi' ? '압박이 커지는 구간' : kind === 'rpi' ? '부담이 높은 구간' : '긴장도 상승 구간'
  if (value >= 33) return kind === 'lpi' ? '무난한 균형 구간' : kind === 'rpi' ? '무리 없는 중간 구간' : '조심해서 보는 구간'
  return kind === 'lpi' ? '유동성 여유 구간' : kind === 'rpi' ? '금리 부담이 낮은 구간' : '차분한 구간'
}
