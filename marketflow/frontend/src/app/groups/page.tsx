import SectorRotation from '@/components/SectorRotation'

export default function GroupsPage() {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'white' }}>
          Sector <span style={{ color: '#00D9FF' }}>Groups</span>
        </h1>
        <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>
          1일 · 1주 · 1개월 섹터별 수익률 비교
        </p>
      </div>

      <div style={{ background: '#1c1c1e', borderRadius: '12px', padding: '1.5rem', border: '1px solid rgba(255,255,255,0.05)' }}>
        <SectorRotation />
      </div>
    </div>
  )
}
