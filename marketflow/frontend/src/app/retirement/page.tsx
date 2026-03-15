import Link from 'next/link'

function card() {
  return {
    background: 'linear-gradient(145deg, #17181c 0%, #141518 100%)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: '0.95rem',
  } as const
}

export default function RetirementPage() {
  return (
    <div style={{ padding: '1.35rem 1.4rem 2rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h1 style={{ margin: 0, color: '#f3f4f6', fontSize: '1.8rem', fontWeight: 800 }}>
          Retirement <span style={{ color: '#A7F3D0' }}>Lens</span>
        </h1>
        <p style={{ marginTop: 6, color: '#8b93a8', fontSize: '0.8rem' }}>
          Capital preservation first, then growth.
        </p>
      </div>

      <section style={card()}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 8 }}>Core Checklist</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, color: '#cbd5e1', fontSize: '0.86rem' }}>
          <div>1. Maintain withdrawal buffer (cash runway) before adding risk.</div>
          <div>2. Keep leverage exposure tactical and time-limited.</div>
          <div>3. Recheck allocation when Risk Engine flips to defensive.</div>
        </div>
      </section>

      <section style={card()}>
        <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 8 }}>Navigation</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/dashboard" style={{ color: '#93c5fd', textDecoration: 'none', fontWeight: 700, fontSize: '0.82rem' }}>
            Command Center →
          </Link>
          <Link href="/portfolio" style={{ color: '#7dd3fc', textDecoration: 'none', fontWeight: 700, fontSize: '0.82rem' }}>
            Portfolio →
          </Link>
          <Link href="/risk" style={{ color: '#fca5a5', textDecoration: 'none', fontWeight: 700, fontSize: '0.82rem' }}>
            Risk →
          </Link>
        </div>
      </section>
    </div>
  )
}
