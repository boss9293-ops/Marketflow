import LeverageModuleNav from '@/components/crash/LeverageModuleNav'

export default function InfiniteBuyPlaceholder() {
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
              ?덈쾭由ъ????쇱깮留덉엯?덈떎.
            </div>
            <div style={{ fontSize: '1.05rem', color: '#cbd5f5', letterSpacing: '-0.01em' }}>
              ?곕━??洹멸쾬??湲몃뱾?대뒗 踰뺤쓣 ?곌뎄?⑸땲??
            </div>
            <LeverageModuleNav activeKey="infinite" />
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
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>臾댄븳留ㅼ닔 ?꾨왂</div>
            <div style={{ fontSize: '0.98rem', color: '#cbd5f5' }}>
              以鍮?以묒엯?덈떎. 由ъ뒪???붿쭊怨??곌껐?섎뒗 援ъ“濡??뺤옣???덉젙?낅땲??
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

