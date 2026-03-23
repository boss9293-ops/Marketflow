import type { CSSProperties } from 'react'
import type { EngineImpact } from '@/types/research'
import type { VrContextLink } from './ResearchDesk'

const C = {
  bgCard:    'rgba(255,255,255,0.03)',
  border:    '1px solid rgba(255,255,255,0.08)',
  radiusSm:  12,
  textDim:   '#64748b',
  textMuted: '#94a3b8',
  textSub:   '#cbd5e1',
  teal:      '#5eead4',
  rose:      '#fca5a5',
  slate:     '#94a3b8',
}

const VR_STATE_COLOR: Record<string, string> = {
  NORMAL:    '#5eead4',
  CAUTION:   '#fcd34d',
  ARMED:     '#fca5a5',
  EXIT_DONE: '#fca5a5',
  REENTRY:   '#93c5fd',
}

const DIRECTION_CFG = {
  increases_risk: { label: 'Increases Risk',  color: '#fca5a5', bg: 'rgba(252,165,165,0.08)', border: 'rgba(252,165,165,0.25)' },
  decreases_risk: { label: 'Decreases Risk',  color: '#5eead4', bg: 'rgba(94,234,212,0.08)',  border: 'rgba(94,234,212,0.25)' },
  neutral:        { label: 'Neutral Impact',  color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)' },
}

interface Props {
  impact:     EngineImpact
  vrContext?: VrContextLink
}

export default function EngineImpactBox({ impact, vrContext }: Props) {
  const dir = DIRECTION_CFG[impact.direction] ?? DIRECTION_CFG.neutral

  return (
    <div style={{
      background: C.bgCard,
      border: C.border,
      borderRadius: C.radiusSm,
      padding: '0.85rem 1rem',
    } as CSSProperties}>
      <div style={{
        fontSize: '0.7rem', color: C.textDim,
        textTransform: 'uppercase', letterSpacing: '0.13em',
        marginBottom: 10, fontWeight: 600,
      }}>
        VR Engine Impact
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <span style={{
          fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em',
          color: dir.color, background: dir.bg,
          border: `1px solid ${dir.border}`,
          padding: '2px 10px', borderRadius: 99,
        }}>
          {dir.label}
        </span>
        {impact.vr_relevant && (
          <span style={{
            fontSize: '0.68rem', fontWeight: 700, color: '#93c5fd',
            background: 'rgba(147,197,253,0.08)',
            border: '1px solid rgba(147,197,253,0.22)',
            padding: '2px 8px', borderRadius: 99,
          }}>
            VR Relevant
          </span>
        )}
        {impact.relevant_track && (
          <span style={{
            fontSize: '0.68rem', fontWeight: 600, color: C.textMuted,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.09)',
            padding: '2px 8px', borderRadius: 99,
          }}>
            {impact.relevant_track}
          </span>
        )}
        {impact.affects_risk_level && (
          <span style={{
            fontSize: '0.68rem', fontWeight: 600, color: '#fcd34d',
            background: 'rgba(252,211,77,0.07)',
            border: '1px solid rgba(252,211,77,0.2)',
            padding: '2px 8px', borderRadius: 99,
          }}>
            May affect risk level
          </span>
        )}
      </div>

      <div style={{ fontSize: '0.86rem', color: C.textSub, lineHeight: 1.6 }}>
        {impact.summary}
      </div>

      {!impact.vr_relevant && !vrContext && (
        <div style={{ fontSize: '0.73rem', color: C.textDim, marginTop: 8, fontStyle: 'italic' }}>
          This research is not directly linked to current VR engine signals.
        </div>
      )}

      {vrContext && (
        <div style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.63rem', color: '#818cf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            VR Context
          </span>
          <span style={{
            fontSize: '0.65rem', fontWeight: 800,
            color: VR_STATE_COLOR[vrContext.vr_state] ?? C.textMuted,
            background: `${VR_STATE_COLOR[vrContext.vr_state] ?? '#94a3b8'}18`,
            border: `1px solid ${VR_STATE_COLOR[vrContext.vr_state] ?? '#94a3b8'}40`,
            padding: '1px 6px', borderRadius: 99,
          }}>
            {vrContext.vr_state}
          </span>
          {vrContext.crash_trigger && (
            <span style={{ fontSize: '0.65rem', color: C.rose, fontWeight: 600 }}>
              · Crash Trigger Active
            </span>
          )}
          <span style={{ fontSize: '0.65rem', color: C.textDim, textTransform: 'capitalize' }}>
            · {vrContext.confidence} confidence
          </span>
        </div>
      )}
    </div>
  )
}
