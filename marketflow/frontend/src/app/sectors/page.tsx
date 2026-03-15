import SectorsTabs from '@/components/SectorsTabs'

export default function SectorsPage() {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'white' }}>Sector <span style={{ color: '#00D9FF' }}>Analysis</span></h1>
        <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>섹터별 퍼포먼스 및 로테이션 분석</p>
      </div>
      <SectorsTabs />
    </div>
  )
}
