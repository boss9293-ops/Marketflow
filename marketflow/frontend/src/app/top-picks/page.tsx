import TopPicksTable from '@/components/TopPicksTable'

export default function TopPicksPage() {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'white' }}>Top <span style={{ color: '#00D9FF' }}>Picks</span></h1>
        <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>AI 복합 점수 기반 상위 10개 추천 종목</p>
      </div>
      <div style={{ background: '#1c1c1e', borderRadius: '12px', padding: '1.5rem', border: '1px solid rgba(255,255,255,0.05)', overflowX: 'auto' }}>
        <TopPicksTable />
      </div>
    </div>
  )
}
