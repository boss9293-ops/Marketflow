export default function ScenarioReasonList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {reasons.map((r, i) => (
        <li key={i} style={{ fontSize: '0.79rem', color: '#cbd5e1', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ color: '#818cf8', flexShrink: 0, marginTop: 1 }}>•</span>
          <span>{r}</span>
        </li>
      ))}
    </ul>
  )
}
