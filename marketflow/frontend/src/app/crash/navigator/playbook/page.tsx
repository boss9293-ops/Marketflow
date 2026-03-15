import LeverageModuleNav from '@/components/crash/LeverageModuleNav'

export default function RiskPlaybookPlaceholder() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#0a0f1a',
        color: '#e5e7eb',
        fontFamily: "'Inter','Segoe UI',sans-serif",
        padding: '3.2rem 2.2rem',
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.8rem' }}>
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '1.6rem',
          }}
        >
          <div
            style={{
              background: '#0f1522',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 16,
              padding: '2.1rem 2.2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.7rem',
            }}
          >
            <div style={{ fontSize: '2.6rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
              레버리지는 야생마입니다.
            </div>
            <div style={{ fontSize: '1.05rem', color: '#cbd5f5', letterSpacing: '-0.01em' }}>
              우리는 그것을 길들이는 법을 연구합니다.
            </div>
            <LeverageModuleNav activeKey="playbook" />
          </div>
          <div
            style={{
              background: '#0f1522',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 16,
              padding: '1.8rem 2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
              justifyContent: 'center',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: '#c9a86a', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Research Phase
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>리스크 플레이북</div>
            <div style={{ fontSize: '0.98rem', color: '#cbd5f5' }}>
              준비 중입니다. 폭락 구간 행동 매뉴얼을 정리하는 공간입니다.
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
