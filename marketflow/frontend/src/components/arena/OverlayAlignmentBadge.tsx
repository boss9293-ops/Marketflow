import type { ArenaOverlayDisplayModel } from '../../lib/arena/overlay/buildArenaOverlayDisplayModel'

function tone(alignment: ArenaOverlayDisplayModel['interpretationAlignment']) {
  switch (alignment) {
    case 'ALIGNED':
      return {
        border: '1px solid rgba(16,185,129,0.32)',
        background: 'rgba(16,185,129,0.12)',
        color: '#34d399',
      }
    case 'CONFLICTED':
      return {
        border: '1px solid rgba(251,146,60,0.32)',
        background: 'rgba(251,146,60,0.12)',
        color: '#fb923c',
      }
    default:
      return {
        border: '1px solid rgba(148,163,184,0.24)',
        background: 'rgba(148,163,184,0.08)',
        color: '#cbd5e1',
      }
  }
}

export default function OverlayAlignmentBadge({
  alignment,
  note,
  interpretationState,
  agreementScore,
  conflictScore,
}: {
  alignment: ArenaOverlayDisplayModel['interpretationAlignment']
  note: string
  interpretationState?: string
  agreementScore?: number | null
  conflictScore?: number | null
}) {
  const palette = tone(alignment)

  return (
    <div
      style={{
        ...palette,
        borderRadius: 14,
        padding: '0.9rem 1rem',
      }}
    >
      <div
        style={{
          fontSize: '0.72rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: 800,
          marginBottom: 6,
        }}
      >
        Interpretation {alignment}
      </div>
      {interpretationState ? (
        <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}>
          {interpretationState.split('_').join(' ')}
        </div>
      ) : null}
      {typeof agreementScore === 'number' || typeof conflictScore === 'number' ? (
        <div style={{ fontSize: '0.77rem', lineHeight: 1.45, marginBottom: 8 }}>
          {typeof agreementScore === 'number' ? `Agreement ${Math.round(agreementScore)}` : 'Agreement n/a'}
          {' | '}
          {typeof conflictScore === 'number' ? `Conflict ${Math.round(conflictScore)}` : 'Conflict n/a'}
        </div>
      ) : null}
      <div style={{ fontSize: '0.82rem', lineHeight: 1.55 }}>{note}</div>
    </div>
  )
}
