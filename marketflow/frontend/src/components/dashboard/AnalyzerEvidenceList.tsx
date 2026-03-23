// =============================================================================
// AnalyzerEvidenceList  (WO-SA18)
// Compact bullet list of reliability reason lines
// =============================================================================

interface Props {
  reasons?: string[]
  compact?: boolean
}

export default function AnalyzerEvidenceList({ reasons, compact = false }: Props) {
  if (!reasons || reasons.length === 0) return null

  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: compact ? 2 : 3 }}>
      {reasons.map((line, i) => (
        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span style={{ color: '#4B5563', fontSize: compact ? '0.60rem' : '0.62rem', flexShrink: 0, marginTop: 2 }}>›</span>
          <span style={{ color: '#6B7280', fontSize: compact ? '0.65rem' : '0.68rem', lineHeight: 1.4 }}>{line}</span>
        </li>
      ))}
    </ul>
  )
}
