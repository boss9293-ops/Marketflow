import Link from 'next/link'

const MODULES = [
  {
    key: 'risk',
    title: '리스크 관리 엔진',
    description: '급락 가속, 방어 모드, 구조적 하락을 탐지하고 단계별 대응을 제시합니다.',
    cta: { label: '엔진 실행', href: '/crash/navigator/engine' },
    active: true,
  },
  {
    key: 'infinite',
    title: '무한매수 전략',
    description: '변동성 기반 분할매수 전략 연구 공간입니다.',
    status: '준비중',
  },
  {
    key: 'backtests',
    title: '백테스트 센터',
    description: '레버리지 전략을 데이터 기반으로 검증하는 공간입니다.',
    status: '준비중',
  },
  {
    key: 'templates',
    title: '전략 템플릿',
    description: '검증된 전략 설정값 및 운용 템플릿을 제공합니다.',
    status: '준비중',
  },
  {
    key: 'playbook',
    title: '리스크 플레이북',
    description: '폭락/패닉 구간에서의 행동 매뉴얼을 정리합니다.',
    status: '준비중',
  },
]

export default function LeverageTamingLanding() {
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
      <div style={{ maxWidth: 1160, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '1.6rem',
            alignItems: 'stretch',
          }}
        >
          <div
            style={{
              background: '#0f1522',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 16,
              padding: '2.2rem 2.3rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.85rem',
            }}
          >
            <div
              style={{
                fontSize: '2.6rem',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                whiteSpace: 'nowrap',
              }}
            >
              레버리지는 야생마입니다.
            </div>
            <div style={{ fontSize: '1.15rem', color: '#cbd5f5', letterSpacing: '-0.01em' }}>
              우리는 그것을 길들이는 법을 연구합니다.
            </div>
            <div style={{ fontSize: '1rem', color: '#94a3b8', lineHeight: 1.6 }}>
              본 공간은 레버리지 자산(TQQQ, SOXL 등)을 통제하기 위한
              <br />
              리스크 관리 및 전략 연구 모듈입니다.
            </div>
          </div>
          <div
            style={{
              background: '#0f1522',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 16,
              padding: '1.8rem 2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.85rem',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontSize: '0.82rem', color: '#9ca3af', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Live Status
            </div>
            <div style={{ display: 'grid', gap: '0.65rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem' }}>
                <span style={{ color: '#94a3b8' }}>Current Asset</span>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>TQQQ (proxy QQQ)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem' }}>
                <span style={{ color: '#94a3b8' }}>Current Mode</span>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Run Engine</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem' }}>
                <span style={{ color: '#94a3b8' }}>Trigger Distance</span>
                <span style={{ color: '#c9a86a', fontWeight: 600 }}>See Engine</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem' }}>
                <span style={{ color: '#94a3b8' }}>Stability</span>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Monitoring</span>
              </div>
            </div>
            <Link
              href="/crash/navigator/engine"
              style={{
                alignSelf: 'flex-start',
                background: 'rgba(148,163,184,0.18)',
                color: '#e5e7eb',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 12,
                padding: '0.45rem 0.9rem',
                fontSize: '0.82rem',
                textDecoration: 'none',
              }}
            >
              엔진 실행
            </Link>
          </div>
        </section>

        <section>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.8rem' }}>
            연구 모듈
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.1rem' }}>
          {MODULES.map((module) => (
            <div
              key={module.key}
              style={{
                background: module.active ? 'rgba(15,21,34,0.98)' : 'rgba(15,21,34,0.86)',
                border: module.active ? '1px solid rgba(148,163,184,0.35)' : '1px solid rgba(255,255,255,0.04)',
                borderRadius: 14,
                padding: '1.4rem 1.5rem',
                opacity: module.active ? 1 : 0.7,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.01em' }}>{module.title}</div>
                {!module.active && (
                  <span
                    style={{
                      fontSize: '0.72rem',
                      color: '#c9a86a',
                      border: '1px solid rgba(201,168,106,0.4)',
                      borderRadius: 999,
                      padding: '0.12rem 0.5rem',
                    }}
                  >
                    Research Phase
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.98rem', color: '#cbd5f5', lineHeight: 1.55 }}>{module.description}</div>
              {module.active ? (
                <Link
                  href={module.cta?.href ?? '/crash/navigator/engine'}
                  style={{
                    alignSelf: 'flex-start',
                    background: 'rgba(148,163,184,0.18)',
                    color: '#e5e7eb',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.8rem',
                    textDecoration: 'none',
                  }}
                >
                  {module.cta?.label ?? '엔진 실행'}
                </Link>
              ) : (
                <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{module.status}</div>
              )}
            </div>
          ))}
          </div>
        </section>
      </div>
    </main>
  )
}
