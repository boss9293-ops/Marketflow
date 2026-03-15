'use client'

import Link from 'next/link'
import { useWatchlist } from '@/contexts/WatchlistContext'

type Tone = 'green' | 'amber' | 'orange' | 'red' | 'neutral'

const TONE_MAP: Record<Tone, { label: string; color: string; bg: string; border: string }> = {
  green:   { label: '강세', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.35)' },
  amber:   { label: '주의', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)' },
  orange:  { label: '약세', color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.35)' },
  red:     { label: '위험', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)' },
  neutral: { label: '안정', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.35)' },
}

export default function WatchlistMiniTable({ tone = 'neutral' }: { tone?: Tone }) {
  const { items, loading } = useWatchlist()
  const badge = TONE_MAP[tone] ?? TONE_MAP.neutral

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '0.98rem' }}>관심 종목</div>
        <Link href="/my-holdings" style={{ color: '#93c5fd', fontSize: '0.78rem', textDecoration: 'none', fontWeight: 600 }}>
          전체 보기
        </Link>
      </div>

      {loading ? (
        <div style={{ color: '#9ca3af', fontSize: '0.78rem' }}>불러오는 중...</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#9ca3af', fontSize: '0.78rem', lineHeight: 1.6 }}>
          아직 관심 종목이 없어요.
          <br />
          오른쪽 위 Watchlist 버튼에서 추가할 수 있습니다.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
          <div style={{ color: '#9ca3af', fontSize: '0.7rem' }}>종목</div>
          <div style={{ color: '#9ca3af', fontSize: '0.7rem', textAlign: 'right' }}>하루 변동</div>
          <div style={{ color: '#9ca3af', fontSize: '0.7rem', textAlign: 'right' }}>상태</div>

          {items.slice(0, 6).map((item) => (
            <div key={item.symbol} style={{ display: 'contents' }}>
              <div style={{ color: '#f3f4f6', fontSize: '0.82rem', fontWeight: 600 }}>
                {item.symbol}
                {item.name ? <span style={{ color: '#9ca3af', marginLeft: 6, fontWeight: 500 }}>{item.name}</span> : null}
              </div>
              <div style={{ color: '#cbd5f5', fontSize: '0.78rem', textAlign: 'right' }}>--</div>
              <div style={{ textAlign: 'right' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    color: badge.color,
                    background: badge.bg,
                    border: `1px solid ${badge.border}`,
                  }}
                >
                  {badge.label}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
