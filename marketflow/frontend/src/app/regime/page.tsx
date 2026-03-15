import RegimeIndicator from '@/components/RegimeIndicator'

export default function RegimePage() {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'white' }}>Market <span style={{ color: '#00D9FF' }}>Regime</span></h1>
        <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>현재 시장 국면 분류 및 전략 추천</p>
      </div>
      <div style={{ background: '#1c1c1e', borderRadius: '12px', padding: '1.5rem', border: '1px solid rgba(255,255,255,0.05)' }}>
        <RegimeIndicator />
      </div>
    </div>
  )
}
