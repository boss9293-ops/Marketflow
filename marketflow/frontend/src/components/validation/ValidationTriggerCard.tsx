import type { CSSProperties } from 'react'
import type { ValidationTrigger, ValidationTriggerLevel } from '@/types/validationTrigger'
import ValidationReasonPill  from './ValidationReasonPill'
import ValidationChecklist   from './ValidationChecklist'

const LEVEL_CFG: Record<ValidationTriggerLevel, {
  label: string; color: string; bg: string; border: string
}> = {
  critical: { label: 'Critical', color: '#f87171', bg: 'rgba(248,113,113,0.06)', border: 'rgba(248,113,113,0.22)' },
  elevated: { label: 'Elevated', color: '#fcd34d', bg: 'rgba(252,211,77,0.05)',  border: 'rgba(252,211,77,0.2)'  },
  review:   { label: 'Review',   color: '#93c5fd', bg: 'rgba(147,197,253,0.05)', border: 'rgba(147,197,253,0.18)' },
  watch:    { label: 'Watch',    color: '#5eead4', bg: 'rgba(94,234,212,0.04)',  border: 'rgba(94,234,212,0.15)'  },
}

const RISK_COLOR: Record<string, string> = {
  Low: '#5eead4', Moderate: '#fcd34d', Elevated: '#fb923c', High: '#fca5a5', Critical: '#f87171',
}

export default function ValidationTriggerCard({ trigger }: { trigger: ValidationTrigger }) {
  const lc        = LEVEL_CFG[trigger.level]
  const riskColor = RISK_COLOR[trigger.risk_level ?? ''] ?? '#94a3b8'

  return (
    <div style={{
      padding:      '0.8rem 0.9rem',
      background:   lc.bg,
      border:       `1px solid ${lc.border}`,
      borderRadius: 12,
      display:      'flex', flexDirection: 'column', gap: 8,
    } as CSSProperties}>

      {/* Level + VR state + risk badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
          color: lc.color, background: `${lc.color}14`, border: `1px solid ${lc.color}35`,
          padding: '2px 8px', borderRadius: 99,
        } as CSSProperties}>
          {lc.label}
        </span>
        {trigger.linked_vr_state && (
          <span style={{
            fontSize: '0.6rem', fontWeight: 700, color: '#818cf8',
            background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.22)',
            padding: '1px 7px', borderRadius: 99,
          } as CSSProperties}>
            {trigger.linked_vr_state}
          </span>
        )}
        {trigger.risk_level && (
          <span style={{
            fontSize: '0.6rem', fontWeight: 700, color: riskColor,
            background: `${riskColor}12`, border: `1px solid ${riskColor}30`,
            padding: '1px 6px', borderRadius: 99,
          } as CSSProperties}>
            {trigger.risk_level} Risk
          </span>
        )}
        {trigger.crash_trigger && (
          <span style={{
            fontSize: '0.6rem', fontWeight: 700, color: '#fca5a5',
            background: 'rgba(252,165,165,0.08)', border: '1px solid rgba(252,165,165,0.25)',
            padding: '1px 6px', borderRadius: 99,
          } as CSSProperties}>
            Crash Trigger
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0', lineHeight: 1.35 }}>
        {trigger.title}
      </div>

      {/* Summary */}
      <div style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.5 }}>
        {trigger.summary}
      </div>

      {/* Reasons */}
      {trigger.reasons.length > 0 && (
        <div>
          <div style={{
            fontSize: '0.6rem', color: '#475569', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5,
          }}>
            Reasons
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {trigger.reasons.map((r, i) => (
              <ValidationReasonPill key={i} reason={r} />
            ))}
          </div>
        </div>
      )}

      {/* Checklist */}
      {trigger.checklist.length > 0 && (
        <div>
          <div style={{
            fontSize: '0.6rem', color: '#475569', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5,
          }}>
            Validation Checklist
          </div>
          <ValidationChecklist items={trigger.checklist} maxShow={3} />
        </div>
      )}

      {/* Action links */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 2 }}>
        <a
          href={trigger.primary_href}
          style={{
            fontSize: '0.7rem', fontWeight: 700, color: '#e2e8f0', textDecoration: 'none',
            padding: '0.3rem 0.75rem',
            background: `${lc.color}12`, border: `1px solid ${lc.color}28`,
            borderRadius: 7,
          } as CSSProperties}
        >
          Open VR \u2192
        </a>
        {trigger.secondary_href && (
          <a
            href={trigger.secondary_href}
            style={{
              fontSize: '0.7rem', fontWeight: 600, color: '#818cf8', textDecoration: 'none',
              padding: '0.3rem 0.75rem',
              background: 'rgba(129,140,248,0.07)', border: '1px solid rgba(129,140,248,0.2)',
              borderRadius: 7,
            } as CSSProperties}
          >
            {trigger.secondary_label ?? 'Open Research'} \u2192
          </a>
        )}
      </div>
    </div>
  )
}
