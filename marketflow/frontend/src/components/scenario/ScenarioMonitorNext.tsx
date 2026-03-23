export default function ScenarioMonitorNext({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <div style={{
        fontSize: '0.7rem', color: '#64748b', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4,
      }}>
        Monitor next
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((item, i) => (
          <li key={i} style={{ fontSize: '0.77rem', color: '#94a3b8', display: 'flex', gap: 5, alignItems: 'flex-start' }}>
            <span style={{ color: '#475569', flexShrink: 0 }}>▸</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
