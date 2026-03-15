export type ToneCode = 'T0' | 'T1' | 'T2' | 'T3' | 'T4'
export type ToneName = 'Calm' | 'Confirm' | 'Caution' | 'Defensive' | 'Shock Watch'

export type ToneSelectorInput = {
  macro: {
    lpiBand?: string | null
    rpiBand?: string | null
    vriBand?: string | null
    xconfState?: string | null
    mps?: number | null
    stale?: boolean
    partial?: boolean
  }
  health: {
    shsScore?: number | null
    breadthWeak?: boolean
    mixedSignals?: boolean
  }
  risk: {
    riskToken?: string | null
    shockFlag?: boolean
  }
  data: {
    macroStale?: boolean
    marketStale?: boolean
  }
}

export type ToneSelectorOutput = {
  toneCode: ToneCode
  toneName: ToneName
  subtitleTags: [string, string]
}

const TONE_NAME: Record<ToneCode, ToneName> = {
  T0: 'Calm',
  T1: 'Confirm',
  T2: 'Caution',
  T3: 'Defensive',
  T4: 'Shock Watch',
}

function normBand(v?: string | null): string {
  return String(v || 'NA').trim()
}

function riskRank(token?: string | null): number {
  const s = String(token || '').toUpperCase()
  if (s === 'R4') return 4
  if (s === 'R3') return 3
  if (s === 'R2') return 2
  if (s === 'R1') return 1
  if (s === 'R0') return 0
  if (s.includes('HIGH')) return 3
  if (s.includes('MED')) return 2
  if (s.includes('LOW')) return 1
  return 0
}

function maxTone(a: ToneCode, b: ToneCode): ToneCode {
  const order: ToneCode[] = ['T0', 'T1', 'T2', 'T3', 'T4']
  return order[Math.max(order.indexOf(a), order.indexOf(b))]
}

function tagPair(lpi: string, rpi: string, vri: string, xconf: string): [string, string] {
  const right = xconf === 'Mixed' || xconf === 'Stress'
    ? `확인:${xconf}`
    : `금리:${rpi === 'NA' ? '확인필요' : rpi}`
  const left = vri !== 'NA' ? `변동성:${vri}` : `유동성:${lpi}`
  return [left, right]
}

export function selectMarketTone(input: ToneSelectorInput): ToneSelectorOutput {
  const lpi = normBand(input.macro.lpiBand)
  const rpi = normBand(input.macro.rpiBand)
  const vri = normBand(input.macro.vriBand)
  const xconf = String(input.macro.xconfState || 'Mixed')
  const shs = typeof input.health.shsScore === 'number' ? input.health.shsScore : null
  const breadthWeak = Boolean(input.health.breadthWeak)
  const mixedSignals = Boolean(input.health.mixedSignals)
  const rRank = riskRank(input.risk.riskToken)
  const shock = Boolean(input.risk.shockFlag)

  let tone: ToneCode = 'T0'

  // Priority 1) Risk shock
  if (shock || rRank >= 4) {
    tone = 'T4'
  } else if (rRank >= 3) {
    tone = 'T3'
  // Priority 2) Macro extreme combo
  } else if (vri === 'Expanding' && lpi === 'Tight') {
    tone = 'T3'
  } else if (rpi === 'Restrictive' && (breadthWeak || (shs !== null && shs < 60))) {
    tone = 'T2'
  } else if (xconf === 'Stress') {
    tone = maxTone(tone, 'T2')
  // Priority 3) Mixed signals
  } else if (mixedSignals || (shs !== null && shs >= 40 && shs <= 60)) {
    tone = 'T1'
  // Priority 4) Else
  } else {
    tone = 'T0'
  }

  return {
    toneCode: tone,
    toneName: TONE_NAME[tone],
    subtitleTags: tagPair(lpi, rpi, vri, xconf),
  }
}
