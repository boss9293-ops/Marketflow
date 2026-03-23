import type { CSSProperties } from 'react'
import type { ResearchResponse, ResearchRiskLevel, EngineImpactDirection } from '@/types/research'
import type { VrContextLink } from './ResearchDesk'

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bgCard:    'rgba(255,255,255,0.03)',
  border:    '1px solid rgba(255,255,255,0.08)',
  radiusSm:  12,
  textDim:   '#64748b',
  textMuted: '#94a3b8',
  textSub:   '#cbd5e1',
  teal:      '#5eead4',
  rose:      '#fca5a5',
  amber:     '#fcd34d',
}

const VR_STATE_COLOR: Record<string, string> = {
  NORMAL:    '#5eead4',
  CAUTION:   '#fcd34d',
  ARMED:     '#fca5a5',
  EXIT_DONE: '#fca5a5',
  REENTRY:   '#93c5fd',
}

const RISK_SCORE: Record<ResearchRiskLevel, number> = {
  Low: 1, Moderate: 2, Elevated: 3, High: 4, Critical: 5,
}

const ALIGNMENT_CFG = {
  high:  { label: 'High Alignment',  color: '#5eead4', bg: 'rgba(94,234,212,0.08)',  border: 'rgba(94,234,212,0.25)' },
  mixed: { label: 'Mixed Alignment', color: '#fcd34d', bg: 'rgba(252,211,77,0.07)',  border: 'rgba(252,211,77,0.22)' },
  weak:  { label: 'Weak Alignment',  color: '#fca5a5', bg: 'rgba(252,165,165,0.07)', border: 'rgba(252,165,165,0.22)' },
}

// ── Alignment computation ─────────────────────────────────────────────────────

type AlignmentLevel = 'high' | 'mixed' | 'weak'
interface AlignmentResult {
  level:    AlignmentLevel
  supports: string[]
  conflicts: string[]
  monitor:  string[]
}

function compute(vrc: VrContextLink, result: ResearchResponse): AlignmentResult {
  const { vr_state, crash_trigger } = vrc
  const riskScore  = RISK_SCORE[result.risk_level] ?? 2
  const direction  = result.engine_impact.direction
  const evidCount  = result.evidence.length
  const contrCount = result.contradictions.length

  const isDefensive = crash_trigger || vr_state === 'ARMED' || vr_state === 'EXIT_DONE'
  const isReentry   = vr_state === 'REENTRY'
  const isCaution   = vr_state === 'CAUTION'
  const isNormal    = vr_state === 'NORMAL'

  const supports:  string[] = []
  const conflicts: string[] = []
  const monitor:   string[] = []
  let score = 0

  // ── Score: risk level vs expected posture ──────────────────────────────────
  if (isDefensive) {
    if (riskScore >= 4)      { score += 2; supports.push(`Research risk level (${result.risk_level}) is consistent with the active defensive posture.`) }
    else if (riskScore === 3) { score += 0; supports.push(`Research risk level (${result.risk_level}) provides partial support for a defensive read.`) }
    else                      { score -= 2; conflicts.push(`Research risk level (${result.risk_level}) is lower than the defensive posture implies — the trigger event may be partially priced in or overstated.`) }
  } else if (isReentry) {
    if (riskScore <= 2)      { score += 1; supports.push(`Research risk level (${result.risk_level}) is consistent with improving conditions that support re-entry evaluation.`) }
    else if (riskScore === 3) { score -= 1; conflicts.push(`Research risk level (${result.risk_level}) suggests persistent stress — re-entry caution remains warranted.`) }
    else                      { score -= 2; conflicts.push(`Research risk level (${result.risk_level}) indicates elevated risk, which conflicts with a re-entry readiness thesis.`) }
  } else if (isCaution) {
    if (riskScore >= 3)      { score += 1; supports.push(`Research risk level (${result.risk_level}) is consistent with an elevated watch posture.`) }
    else                      { score -= 1; conflicts.push(`Research risk level (${result.risk_level}) is below what the CAUTION state would suggest — environment may be less stressed than current signals indicate.`) }
  } else {
    // NORMAL
    if (riskScore <= 2)      { score += 2; supports.push(`Research risk level (${result.risk_level}) is consistent with normal operating conditions.`) }
    else if (riskScore === 3) { score -= 1; conflicts.push(`Research risk level (${result.risk_level}) is above the baseline — worth monitoring for early transition signals.`) }
    else                      { score -= 2; conflicts.push(`Research risk level (${result.risk_level}) is elevated relative to the current NORMAL state — may indicate emerging risks not yet reflected in the engine.`) }
  }

  // ── Score: engine impact direction ─────────────────────────────────────────
  const dirLabel: Record<EngineImpactDirection, string> = {
    increases_risk: 'increasing risk',
    decreases_risk: 'decreasing risk',
    neutral:        'neutral impact',
  }
  if (isDefensive) {
    if (direction === 'increases_risk') { score += 1; supports.push(`Engine impact direction (${dirLabel[direction]}) reinforces the defensive posture.`) }
    if (direction === 'decreases_risk') { score -= 2; conflicts.push(`Engine impact direction (${dirLabel[direction]}) conflicts with the active defensive signal — conditions may be normalizing faster than the trigger implies.`) }
  } else if (isReentry) {
    if (direction === 'decreases_risk') { score += 1; supports.push(`Engine impact direction (${dirLabel[direction]}) supports a recovery thesis.`) }
    if (direction === 'increases_risk') { score -= 1; conflicts.push(`Engine impact direction (${dirLabel[direction]}) conflicts with the recovery framing required for safe re-entry.`) }
  } else if (isCaution) {
    if (direction === 'increases_risk') { score += 1; supports.push(`Engine impact direction (${dirLabel[direction]}) is consistent with heightened monitoring.`) }
    if (direction === 'decreases_risk') { score -= 1; conflicts.push(`Engine impact direction (${dirLabel[direction]}) may indicate the CAUTION signal is overstating near-term risk.`) }
  } else {
    if (direction === 'increases_risk') { score -= 1; conflicts.push(`Engine impact direction (${dirLabel[direction]}) is worth monitoring even in a NORMAL state as an early transition indicator.`) }
    if (direction === 'decreases_risk') { supports.push(`Engine impact direction (${dirLabel[direction]}) is consistent with the current environment.`) }
  }

  // ── Score: evidence / contradictions balance ───────────────────────────────
  if (isDefensive && evidCount > 0)
    supports.push(`${evidCount} evidence signal${evidCount > 1 ? 's' : ''} identified in research, supporting a cautious read.`)
  if (isDefensive && contrCount > 0)
    conflicts.push(`${contrCount} contradiction${contrCount > 1 ? 's' : ''} identified — may limit downside or signal conditions are more stable than the trigger implies.`)
  if (isReentry && contrCount > 0)
    supports.push(`${contrCount} contradiction${contrCount > 1 ? 's' : ''} to previous risk thesis present — potentially supportive of a recovery path.`)
  if (isReentry && evidCount > 0)
    conflicts.push(`${evidCount} risk evidence signal${evidCount > 1 ? 's' : ''} still present — re-entry caution remains warranted despite improving conditions.`)

  // ── Monitor-next cues ──────────────────────────────────────────────────────
  if (vr_state === 'ARMED' || crash_trigger) {
    monitor.push('Monitor downside acceleration vs. stabilization — the resolution direction determines when defensive posture can be relaxed.')
    monitor.push('Monitor credit and liquidity stress signals for confirmation of structural deterioration vs. temporary shock.')
  } else if (vr_state === 'EXIT_DONE') {
    monitor.push('Monitor rebound quality — distinguish technical relief from a genuine regime shift.')
    monitor.push('Monitor whether contradiction signals develop into sustained recovery patterns or fail as false starts.')
  } else if (isReentry) {
    monitor.push('Monitor confirmation vs. false recovery — the first retest of prior lows is the critical inflection point.')
    monitor.push('Monitor whether risk evidence signals are fading consistently or re-emerging with new data.')
  } else if (isCaution) {
    monitor.push('Monitor whether caution signals escalate toward trigger conditions or normalize over the next few sessions.')
    monitor.push('Monitor volatility regime and credit spread direction for the first clear signal of state resolution.')
  } else {
    monitor.push('Monitor whether risk signals persist or dissipate as new data arrives.')
    if (direction === 'increases_risk')
      monitor.push('Monitor engine impact direction for any sustained shift — a second consecutive risk-increasing data point would warrant upgrading the watch level.')
  }

  // ── Final alignment label ──────────────────────────────────────────────────
  const level: AlignmentLevel = score >= 2 ? 'high' : score <= -2 ? 'weak' : 'mixed'
  return { level, supports, conflicts, monitor }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BulletRow({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginBottom: 6 }}>
      <span style={{ color, fontSize: '0.75rem', marginTop: 3, flexShrink: 0, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '0.82rem', color: C.textSub, lineHeight: 1.55 }}>{text}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VRSignalCrossCheck({
  result,
  vrContext,
}: {
  result:    ResearchResponse
  vrContext: VrContextLink
}) {
  const alignment  = compute(vrContext, result)
  const cfg        = ALIGNMENT_CFG[alignment.level]
  const stateColor = VR_STATE_COLOR[vrContext.vr_state] ?? C.textMuted

  return (
    <div style={{
      background:   C.bgCard,
      border:       C.border,
      borderRadius: C.radiusSm,
      padding:      '0.85rem 1rem',
    } as CSSProperties}>

      {/* Header */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{
          fontSize: '0.7rem', color: C.textDim,
          textTransform: 'uppercase', letterSpacing: '0.13em', fontWeight: 600,
        }}>
          VR Signal Cross-Check
        </div>
        <span style={{
          fontSize: '0.72rem', fontWeight: 800,
          color: cfg.color, background: cfg.bg,
          border: `1px solid ${cfg.border}`,
          padding: '2px 10px', borderRadius: 99,
        }}>
          {cfg.label}
        </span>
        <span style={{
          fontSize: '0.65rem', fontWeight: 700,
          color: stateColor,
          background: `${stateColor}18`,
          border: `1px solid ${stateColor}40`,
          padding: '1px 7px', borderRadius: 99,
        }}>
          vs {vrContext.vr_state}
        </span>
        {vrContext.crash_trigger && (
          <span style={{
            fontSize: '0.63rem', color: C.rose, fontWeight: 700,
            background: 'rgba(252,165,165,0.08)',
            border: '1px solid rgba(252,165,165,0.25)',
            padding: '1px 7px', borderRadius: 99,
          }}>
            Crash Trigger Active
          </span>
        )}
      </div>

      {/* Supports / Conflicts two-column */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{
            fontSize: '0.63rem', color: C.teal, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8,
          }}>
            Supports Current State
          </div>
          {alignment.supports.length === 0
            ? <div style={{ fontSize: '0.8rem', color: C.textDim, fontStyle: 'italic' }}>No clear support signals.</div>
            : alignment.supports.map((s, i) => <BulletRow key={i} icon="↑" color={C.teal} text={s} />)
          }
        </div>
        <div>
          <div style={{
            fontSize: '0.63rem', color: C.rose, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8,
          }}>
            Conflicts / Tensions
          </div>
          {alignment.conflicts.length === 0
            ? <div style={{ fontSize: '0.8rem', color: C.textDim, fontStyle: 'italic' }}>No significant conflicts identified.</div>
            : alignment.conflicts.map((c, i) => <BulletRow key={i} icon="↕" color={C.rose} text={c} />)
          }
        </div>
      </div>

      {/* Monitor-next */}
      {alignment.monitor.length > 0 && (
        <div style={{
          paddingTop: 10,
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}>
          <div style={{
            fontSize: '0.63rem', color: C.textMuted, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8,
          }}>
            What to Monitor Next
          </div>
          {alignment.monitor.map((m, i) => <BulletRow key={i} icon="→" color={C.textMuted} text={m} />)}
        </div>
      )}

      <div style={{
        fontSize: '0.69rem', color: '#374151',
        marginTop: 10, fontStyle: 'italic', lineHeight: 1.5,
      }}>
        Alignment is rule-based — not AI-generated. Derived from research risk level, engine impact direction, and evidence signal counts.
        Does not constitute a trading or position-sizing signal.
      </div>
    </div>
  )
}
