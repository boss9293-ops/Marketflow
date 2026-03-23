import type { SADisplayTone } from '../../lib/formatSmartAnalyzer'

// SmartAnalyzerDriverList  (WO-SA14)

const IMPACT_DOT: Record<SADisplayTone, string> = {
  red: '#EF4444', orange: '#F97316', amber: '#F59E0B',
  green: '#22C55E', purple: '#8B5CF6', neutral: '#4B5563',
}

interface Props { lines: string[]; impacts: SADisplayTone[] }

export default function SmartAnalyzerDriverList({ lines, impacts }: Props) {
  if (!lines || lines.length === 0) return null
  return (
    <div style={{
      background: '#11161C', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <span style={{ color: '#6B7280', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em' }}>KEY DRIVERS</span>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {lines.map((line, i) => {
          const tone = impacts[i] ?? 'neutral'
          return (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: IMPACT_DOT[tone], flexShrink: 0, marginTop: 5 }} />
              <span style={{ color: '#D1D5DB', fontSize: '0.72rem', lineHeight: 1.5 }}>{line}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
