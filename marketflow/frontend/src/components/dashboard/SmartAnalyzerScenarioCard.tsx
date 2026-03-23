import type { SmartAnalyzerScenarioItem } from '../../lib/formatSmartAnalyzer'

// SmartAnalyzerScenarioCard  (WO-SA14)

const COLORS = ['#EF4444', '#F59E0B', '#22C55E']

interface Props { items: SmartAnalyzerScenarioItem[]; vrLinkLines?: string[] }

export default function SmartAnalyzerScenarioCard({ items, vrLinkLines }: Props) {
  return (
    <div style={{
      background: '#11161C', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {items && items.length > 0 && (
        <>
          <span style={{ color: '#6B7280', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em' }}>SCENARIO VIEW</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {items.map((item, i) => {
              const color = COLORS[i] ?? '#9CA3AF'
              const pct = Math.max(2, Math.min(100, item.probability))
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#94A3B8', fontSize: '0.68rem' }}>{item.name}</span>
                    <span style={{ color, fontSize: '0.68rem', fontWeight: 800 }}>{pct}%</span>
                  </div>
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, opacity: 0.75 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
      {vrLinkLines && vrLinkLines.length > 0 && (
        <>
          {items && items.length > 0 && <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 6 }} />}
          <span style={{ color: '#6B7280', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em' }}>VR LINK</span>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {vrLinkLines.map((line, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ color: '#4B5563', fontSize: '0.62rem', flexShrink: 0, marginTop: 2 }}>›</span>
                <span style={{ color: '#9CA3AF', fontSize: '0.69rem', lineHeight: 1.4 }}>{line}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {(!items || items.length === 0) && (!vrLinkLines || vrLinkLines.length === 0) && (
        <span style={{ color: '#374151', fontSize: '0.70rem' }}>No scenario data</span>
      )}
    </div>
  )
}
