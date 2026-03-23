// =============================================================================
// VrPolicyReasonList  (WO-SA12)
// Bullet list of policy decision reasons — deterministic text only
// =============================================================================

interface Props {
  lines:    string[];
  heading?: string;
}

export default function VrPolicyReasonList({ lines, heading }: Props) {
  if (!lines || lines.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {heading && (
        <span style={{ color: '#6B7280', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em' }}>
          {heading}
        </span>
      )}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {lines.map((line, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ color: '#4B5563', fontSize: '0.65rem', flexShrink: 0, marginTop: 2 }}>·</span>
            <span style={{ color: '#94A3B8', fontSize: '0.70rem', lineHeight: 1.45 }}>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
