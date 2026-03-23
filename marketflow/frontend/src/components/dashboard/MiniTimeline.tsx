// =============================================================================
// MiniTimeline.tsx  (WO-SA25)
// Last 5 days compact runtime timeline
// =============================================================================

const RUNTIME_COLOR: Record<string, string> = {
  LOCKDOWN:  '#F87171',
  DEFENSIVE: '#F97316',
  LIMITED:   '#FACC15',
  NORMAL:    '#4ADE80',
}

interface TimelineEntry {
  date:    string
  label:   string
  runtime: string
}

interface Props {
  entries: TimelineEntry[]
}

export default function MiniTimeline({ entries }: Props) {
  if (!entries || entries.length === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
      {entries.map((entry, i) => {
        const color = RUNTIME_COLOR[entry.runtime] ?? '#94A3B8'
        const isLast = i === entries.length - 1
        return (
          <div key={entry.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, opacity: isLast ? 1 : 0.55 + i * 0.1 }}>
            <span style={{
              borderRadius: 4,
              background:   color + '18',
              border:       '1px solid ' + color + '35',
              color,
              fontSize:     '0.55rem',
              fontWeight:   800,
              padding:      '1px 5px',
              letterSpacing: '0.04em',
            }}>
              {entry.runtime.slice(0, 3)}
            </span>
            <span style={{ color: '#374151', fontSize: '0.57rem', fontWeight: 600 }}>{entry.label}</span>
          </div>
        )
      })}
    </div>
  )
}
