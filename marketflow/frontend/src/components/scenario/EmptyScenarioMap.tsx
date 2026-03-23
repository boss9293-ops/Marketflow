import Link from 'next/link'

export default function EmptyScenarioMap() {
  return (
    <div style={{
      background:   'rgba(255,255,255,0.02)',
      border:       '1px solid rgba(255,255,255,0.06)',
      borderRadius: 12,
      padding:      '2rem 1.5rem',
      textAlign:    'center',
    }}>
      <div style={{ fontSize: '2rem', marginBottom: 12 }}>&#x1F5FA;&#xFE0F;</div>
      <div style={{ fontSize: '0.95rem', color: '#94a3b8', marginBottom: 6 }}>
        No monitored topics to map
      </div>
      <div style={{ fontSize: '0.82rem', color: '#64748b', maxWidth: 360, margin: '0 auto 16px' }}>
        Watch research topics to see how current signals map to VR scenario paths.
      </div>
      <Link
        href="/research"
        style={{
          display:        'inline-block',
          padding:        '0.4rem 1.1rem',
          borderRadius:   8,
          background:     'rgba(99,102,241,0.12)',
          color:          '#a5b4fc',
          textDecoration: 'none',
          fontSize:       '0.82rem',
          border:         '1px solid rgba(99,102,241,0.22)',
        }}
      >
        Open Research Desk &#x2192;
      </Link>
    </div>
  )
}
