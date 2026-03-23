// =============================================================================
// EmptyStateCard  (WO-SA19)
// Polished empty / unavailable state.
// =============================================================================

interface Props {
  title:   string
  detail?: string
  compact?: boolean
}

export default function EmptyStateCard({ title, detail, compact = false }: Props) {
  return (
    <div style={{
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            compact ? 4 : 6,
      padding:        compact ? '12px' : '20px',
      textAlign:      'center',
    }}>
      <span style={{
        width: compact ? 6 : 8, height: compact ? 6 : 8,
        borderRadius: '50%', background: 'rgba(156,163,175,0.20)',
        display: 'inline-block',
      }} />
      <span style={{
        color:      '#4B5563',
        fontSize:   compact ? '0.68rem' : '0.72rem',
        fontWeight: 500,
        lineHeight: 1.4,
      }}>
        {title}
      </span>
      {detail && (
        <span style={{ color: '#374151', fontSize: '0.63rem', lineHeight: 1.4 }}>
          {detail}
        </span>
      )}
    </div>
  )
}
