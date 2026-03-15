export type RiskTokenKey = 'R0' | 'R1' | 'R2' | 'R3' | 'R4'

export type RiskToken = {
  key: RiskTokenKey
  colorVar: string
  bgVar: string
  borderVar: string
  labelEn: 'Calm' | 'Low' | 'Caution' | 'High' | 'Extreme'
  labelKo: '안정' | '낮음' | '경계' | '높음' | '극단'
  icon: string
}

type RiskInput = {
  riskScore?: number | null
  riskLevel?: string | null
}

type SecondaryInput = {
  vixChange1d?: number | null
  volRatio?: number | null
  cvar95?: number | null
  tailSigma?: number | null
  shockProb30d?: number | null
}

export const riskPalette: Record<RiskTokenKey, RiskToken> = {
  R0: { key: 'R0', colorVar: 'var(--risk-0)', bgVar: 'var(--risk-bg-0)', borderVar: 'var(--risk-border-0)', labelEn: 'Calm',    labelKo: '안정', icon: '◌' },
  R1: { key: 'R1', colorVar: 'var(--risk-1)', bgVar: 'var(--risk-bg-1)', borderVar: 'var(--risk-border-1)', labelEn: 'Low',     labelKo: '낮음', icon: '●' },
  R2: { key: 'R2', colorVar: 'var(--risk-2)', bgVar: 'var(--risk-bg-2)', borderVar: 'var(--risk-border-2)', labelEn: 'Caution', labelKo: '경계', icon: '▲' },
  R3: { key: 'R3', colorVar: 'var(--risk-3)', bgVar: 'var(--risk-bg-3)', borderVar: 'var(--risk-border-3)', labelEn: 'High',    labelKo: '높음', icon: '⚠' },
  R4: { key: 'R4', colorVar: 'var(--risk-4)', bgVar: 'var(--risk-bg-4)', borderVar: 'var(--risk-border-4)', labelEn: 'Extreme', labelKo: '극단', icon: '⛔' },
}

function normalizeScore(input: RiskInput): number | null {
  if (typeof input.riskScore === 'number' && Number.isFinite(input.riskScore)) {
    return Math.max(0, Math.min(100, input.riskScore))
  }
  const level = String(input.riskLevel || '').toUpperCase()
  if (level === 'LOW') return 23
  if (level === 'MEDIUM') return 42
  if (level === 'HIGH') return 62
  if (level === 'EXTREME' || level === 'CRISIS') return 90
  return null
}

export function riskLevelToToken(input: RiskInput): RiskToken {
  const score = normalizeScore(input)
  if (score == null) return riskPalette.R2
  // Unified thresholds (recommended): 0-15 / 16-30 / 31-50 / 51-70 / 71-100
  if (score <= 15) return riskPalette.R0
  if (score <= 30) return riskPalette.R1
  if (score <= 50) return riskPalette.R2
  if (score <= 70) return riskPalette.R3
  return riskPalette.R4
}

export function getRiskSecondaryAccents(input: SecondaryInput) {
  const vixPulse =
    input.vixChange1d == null ? 'neutral'
    : input.vixChange1d <= -5 ? 'cooling'
    : input.vixChange1d <= 5 ? 'neutral'
    : input.vixChange1d <= 12 ? 'warning'
    : 'stress'

  const volRegime =
    input.volRatio == null ? 'normal'
    : input.volRatio < 0.95 ? 'compressing'
    : input.volRatio < 1.1 ? 'normal'
    : input.volRatio < 1.25 ? 'elevated'
    : 'expanding'

  const cvarAbs = typeof input.cvar95 === 'number' ? Math.abs(input.cvar95) : null
  const cvarStress =
    cvarAbs == null ? 'moderate'
    : cvarAbs < 1.5 ? 'mild'
    : cvarAbs < 2.5 ? 'moderate'
    : cvarAbs < 4.0 ? 'high'
    : 'severe'

  const tailStress =
    input.tailSigma == null ? 'caution'
    : input.tailSigma < 1 ? 'calm'
    : input.tailSigma < 2 ? 'low'
    : input.tailSigma < 3.5 ? 'caution'
    : input.tailSigma < 5 ? 'high'
    : 'extreme'

  const shockStress =
    input.shockProb30d == null ? 'caution'
    : input.shockProb30d < 10 ? 'low'
    : input.shockProb30d < 20 ? 'caution'
    : input.shockProb30d < 35 ? 'high'
    : 'extreme'

  return { vixPulse, volRegime, cvarStress, tailStress, shockStress }
}

export function accentColorFromLevel(level: string): string {
  switch (level) {
    case 'cooling':
      return 'var(--risk-accent-cooling)'
    case 'warning':
      return 'var(--risk-accent-warning)'
    case 'stress':
    case 'severe':
    case 'extreme':
      return 'var(--risk-accent-stress)'
    case 'elevated':
    case 'high':
    case 'caution':
      return 'var(--risk-3)'
    case 'mild':
    case 'low':
      return 'var(--risk-1)'
    case 'compressing':
      return 'var(--risk-0)'
    case 'normal':
    case 'neutral':
    default:
      return 'var(--risk-accent-neutral)'
  }
}
