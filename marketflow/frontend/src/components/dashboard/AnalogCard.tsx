// =============================================================================
// AnalogCard.tsx  (WO-SA20)
// =============================================================================
import type { FormattedAnalog } from '@/lib/formatAnalog'

function fmtReturn(v: number) {
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
}

const REGIME_COLOR: Record<string, string> = {
  STRUCTURAL: '#F87171',
  EVENT:      '#FACC15',
  HYBRID:     '#38BDF8',
  NORMAL:     '#4ADE80',
}

const RUNTIME_COLOR: Record<string, string> = {
  LOCKDOWN:  '#F87171',
  DEFENSIVE: '#F97316',
  LIMITED:   '#FACC15',
  NORMAL:    '#4ADE80',
}

interface Props { analog: FormattedAnalog }

export default function AnalogCard({ analog }: Props) {
  const regimeColor  = REGIME_COLOR[analog.regime]  ?? '#94A3B8'
  const runtimeColor = RUNTIME_COLOR[analog.runtime] ?? '#94A3B8'
  const matchPct     = Math.min(100, Math.round(analog.score / 75 * 100))

  return (
    <div style={{
      background:    '#0A0F18',
      border:        '1px solid rgba(148,163,184,0.08)',
      borderRadius:  10,
      padding:       '0.75rem',
      display:       'flex',
      flexDirection: 'column',
      gap:           6,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ color: '#F8FAFC', fontSize: '0.78rem', fontWeight: 800 }}>{analog.label}</div>
          <div style={{ color: '#475569', fontSize: '0.62rem', marginTop: 2 }}>{analog.period}</div>
        </div>
        <div style={{
          background:    'rgba(99,102,241,0.10)',
          border:        '1px solid rgba(99,102,241,0.22)',
          borderRadius:  5,
          color:         '#818CF8',
          fontSize:      '0.65rem',
          fontWeight:    800,
          padding:       '2px 7px',
          whiteSpace:    'nowrap',
        }}>
          {matchPct}% match
        </div>
      </div>

      {/* Regime + Runtime chips */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.60rem', fontWeight: 700, color: regimeColor,
          background: regimeColor + '15', border: '1px solid ' + regimeColor + '30',
          borderRadius: 4, padding: '2px 6px' }}>
          {analog.regime}
        </span>
        <span style={{ fontSize: '0.60rem', fontWeight: 700, color: runtimeColor,
          background: runtimeColor + '15', border: '1px solid ' + runtimeColor + '30',
          borderRadius: 4, padding: '2px 6px' }}>
          {analog.runtime}
        </span>
      </div>

      {/* Forward returns */}
      {(analog.fwd_5d !== undefined || analog.fwd_20d !== undefined) && (
        <div style={{ display: 'flex', gap: 12 }}>
          {analog.fwd_5d !== undefined && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: '#475569', fontSize: '0.57rem', fontWeight: 700 }}>5D FWD</span>
              <span style={{ color: analog.fwd_5d >= 0 ? '#4ADE80' : '#F87171', fontSize: '0.78rem', fontWeight: 800 }}>
                {fmtReturn(analog.fwd_5d)}
              </span>
            </div>
          )}
          {analog.fwd_20d !== undefined && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: '#475569', fontSize: '0.57rem', fontWeight: 700 }}>20D FWD</span>
              <span style={{ color: analog.fwd_20d >= 0 ? '#4ADE80' : '#F87171', fontSize: '0.78rem', fontWeight: 800 }}>
                {fmtReturn(analog.fwd_20d)}
              </span>
            </div>
          )}
          {analog.max_dd !== undefined && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: '#475569', fontSize: '0.57rem', fontWeight: 700 }}>MAX DD</span>
              <span style={{ color: '#F87171', fontSize: '0.78rem', fontWeight: 800 }}>
                {fmtReturn(analog.max_dd)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {analog.notes && (
        <p style={{ margin: 0, color: '#475569', fontSize: '0.65rem', lineHeight: 1.4 }}>
          {analog.notes}
        </p>
      )}
    </div>
  )
}
