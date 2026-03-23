import type { CSSProperties } from 'react'

interface Props {
  loading:   boolean
  onRefresh: () => void
}

export default function RefreshTopicButton({ loading, onRefresh }: Props) {
  return (
    <button
      onClick={onRefresh}
      disabled={loading}
      style={{
        fontSize: '0.65rem', fontWeight: 600,
        color:      loading ? '#475569' : '#93c5fd',
        background: loading ? 'rgba(71,85,105,0.06)' : 'rgba(147,197,253,0.07)',
        border:     loading ? '1px solid rgba(71,85,105,0.2)' : '1px solid rgba(147,197,253,0.22)',
        borderRadius: 7, padding: '0.25rem 0.65rem',
        cursor: loading ? 'not-allowed' : 'pointer',
      } as CSSProperties}
    >
      {loading ? '\u21bb Refreshing\u2026' : '\u21bb Refresh'}
    </button>
  )
}
