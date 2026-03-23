import type { CSSProperties } from 'react'
import type { SavedResearchSession } from '@/types/researchSession'
import SessionCard from './SessionCard'

interface Props {
  sessions:  SavedResearchSession[]
  onLoad:    (s: SavedResearchSession) => void
  onRerun:   (s: SavedResearchSession) => void
  onDelete:  (id: string) => void
}

export default function SavedSessionsPanel({ sessions, onLoad, onRerun, onDelete }: Props) {
  const recent = sessions.slice(0, 12)

  return (
    <div style={{
      background:   'linear-gradient(180deg, rgba(8,12,22,0.96), rgba(9,11,17,0.99))',
      border:       '1px solid rgba(255,255,255,0.08)',
      borderRadius: 18,
      padding:      '1rem 1.1rem',
    } as CSSProperties}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>
            Saved Sessions
          </div>
          {sessions.length > 0 && (
            <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: 2 }}>
              {sessions.length} saved
            </div>
          )}
        </div>
      </div>

      {recent.length === 0 ? (
        <div style={{ padding: '1.2rem 0', textAlign: 'center' }}>
          <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>📋</div>
          <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.6 }}>
            No saved sessions yet.
            <br />
            Run a research query and click
            <br />
            <strong style={{ color: '#64748b' }}>Save Research</strong> to store it here.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {recent.map(s => (
            <SessionCard
              key={s.id}
              session={s}
              onLoad={() => onLoad(s)}
              onRerun={() => onRerun(s)}
              onDelete={() => onDelete(s.id)}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: '0.66rem', color: '#374151', fontStyle: 'italic', lineHeight: 1.5 }}>
        Sessions are stored locally in your browser. Max 50 sessions.
      </div>
    </div>
  )
}
