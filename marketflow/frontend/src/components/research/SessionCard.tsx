import type { CSSProperties } from 'react'
import type { SavedResearchSession } from '@/types/researchSession'

const RISK_COLOR: Record<string, string> = {
  Low:      '#5eead4', Moderate: '#93c5fd',
  Elevated: '#fcd34d', High:     '#fca5a5', Critical: '#ef4444',
}
const VR_COLOR: Record<string, string> = {
  NORMAL: '#5eead4', CAUTION: '#fcd34d',
  ARMED: '#fca5a5', EXIT_DONE: '#fca5a5', REENTRY: '#93c5fd',
}

function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface Props {
  session:  SavedResearchSession
  onLoad:   () => void
  onRerun:  () => void
  onDelete: () => void
}

export default function SessionCard({ session, onLoad, onRerun, onDelete }: Props) {
  const riskCol = RISK_COLOR[session.response.risk_level] ?? '#94a3b8'
  const vrCol   = VR_COLOR[session.vr_context?.vr_state ?? ''] ?? '#64748b'
  const ts      = session.updated_at ?? session.created_at

  return (
    <div style={{
      background:   'rgba(255,255,255,0.03)',
      border:       '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10, padding: '0.6rem 0.75rem',
      transition:   'border-color 0.15s',
    } as CSSProperties}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {/* Click area: load result */}
        <div onClick={onLoad} style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}>
          <div style={{
            fontSize: '0.81rem', color: '#cbd5e1', lineHeight: 1.4,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          } as CSSProperties}>
            {session.query}
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{
              fontSize: '0.62rem', fontWeight: 700,
              color: riskCol, background: `${riskCol}18`,
              border: `1px solid ${riskCol}38`,
              padding: '1px 6px', borderRadius: 99,
            }}>
              {session.response.risk_level}
            </span>
            {session.vr_context?.vr_state && (
              <span style={{
                fontSize: '0.62rem', fontWeight: 700,
                color: vrCol, background: `${vrCol}15`,
                border: `1px solid ${vrCol}35`,
                padding: '1px 6px', borderRadius: 99,
              }}>
                {session.vr_context.vr_state}
              </span>
            )}
            <span style={{ fontSize: '0.62rem', color: '#475569' }}>{formatAgo(ts)}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
          <button
            onClick={onRerun}
            title="Re-run analysis with fresh data"
            style={{
              fontSize: '0.7rem', color: '#93c5fd',
              background: 'rgba(147,197,253,0.08)',
              border: '1px solid rgba(147,197,253,0.2)',
              borderRadius: 6, padding: '2px 7px', cursor: 'pointer',
              fontWeight: 700,
            } as CSSProperties}
          >
            ↻
          </button>
          <button
            onClick={onDelete}
            title="Delete session"
            style={{
              fontSize: '0.7rem', color: '#64748b',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 6, padding: '2px 7px', cursor: 'pointer',
              fontWeight: 700,
            } as CSSProperties}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}
