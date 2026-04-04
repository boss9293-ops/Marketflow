import Link from 'next/link'

const MODULES = [
  {
    key: 'risk',
    title: '由ъ뒪??愿由??붿쭊',
    description: '湲됰씫 媛?? 諛⑹뼱 紐⑤뱶, 援ъ“???섎씫???먯??섍퀬 ?④퀎蹂???묒쓣 ?쒖떆?⑸땲??',
    cta: { label: '?붿쭊 ?ㅽ뻾', href: '/crash/navigator/engine' },
    active: true,
  },
  {
    key: 'infinite',
    title: '臾댄븳留ㅼ닔 ?꾨왂',
    description: '蹂?숈꽦 湲곕컲 遺꾪븷留ㅼ닔 ?꾨왂 ?곌뎄 怨듦컙?낅땲??',
    status: '以鍮꾩쨷',
  },
  {
    key: 'backtests',
    title: '諛깊뀒?ㅽ듃 ?쇳꽣',
    description: '?덈쾭由ъ? ?꾨왂???곗씠??湲곕컲?쇰줈 寃利앺븯??怨듦컙?낅땲??',
    status: '以鍮꾩쨷',
  },
  {
    key: 'templates',
    title: '?꾨왂 ?쒗뵆由?',
    description: '寃利앸맂 ?꾨왂 ?ㅼ젙媛?諛??댁슜 ?쒗뵆由우쓣 ?쒓났?⑸땲??',
    status: '以鍮꾩쨷',
  },
  {
    key: 'playbook',
    title: '由ъ뒪???뚮젅?대턿',
    description: '??씫/?⑤땳 援ш컙?먯꽌???됰룞 留ㅻ돱?쇱쓣 ?뺣━?⑸땲??',
    status: '以鍮꾩쨷',
  },
]

const MODULE_SHORTCUTS: Record<string, { label: string; href: string }> = {
  backtests: { label: 'Open Backtest', href: '/vr-survival?tab=Backtest' },
  templates: { label: 'Open Playback', href: '/vr-survival?tab=Playback' },
}

export default function LeverageTamingLanding() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#0a0f1a',
        color: '#e5e7eb',
        fontFamily: "var(--font-ui-sans, var(--font-terminal), 'Nanum Gothic Coding', 'Noto Sans KR', monospace)",
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
              ?덈쾭由ъ????쇱깮留덉엯?덈떎.
            </div>
            <div style={{ fontSize: '1.15rem', color: '#cbd5f5', letterSpacing: '-0.01em' }}>
              ?곕━??洹멸쾬??湲몃뱾?대뒗 踰뺤쓣 ?곌뎄?⑸땲??
            </div>
            <div style={{ fontSize: '1rem', color: '#94a3b8', lineHeight: 1.6 }}>
              蹂?怨듦컙? ?덈쾭由ъ? ?먯궛(TQQQ, SOXL ?????듭젣?섍린 ?꾪븳
              <br />
              由ъ뒪??愿由?諛??꾨왂 ?곌뎄 紐⑤뱢?낅땲??
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
              ?붿쭊 ?ㅽ뻾
            </Link>
          </div>
        </section>

        <section>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.8rem' }}>
            ?곌뎄 紐⑤뱢
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
                  {module.cta?.label ?? '?붿쭊 ?ㅽ뻾'}
                </Link>
              ) : (
                <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{module.status}</div>
              )}
              {!module.active && MODULE_SHORTCUTS[module.key] ? (
                <Link
                  href={MODULE_SHORTCUTS[module.key].href}
                  style={{
                    alignSelf: 'flex-start',
                    background: 'rgba(56,189,248,0.12)',
                    color: '#e5e7eb',
                    border: '1px solid rgba(56,189,248,0.24)',
                    borderRadius: 10,
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.8rem',
                    textDecoration: 'none',
                  }}
                >
                  {MODULE_SHORTCUTS[module.key].label}
                </Link>
              ) : null}
            </div>
          ))}
          </div>
        </section>
      </div>
    </main>
  )
}

