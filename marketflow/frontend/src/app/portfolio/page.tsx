import Link from 'next/link'
import MacroBadgeStrip from '@/components/MacroBadgeStrip'

function card(extra?: object) {
  return {
    background: 'linear-gradient(145deg, #17181c 0%, #141518 100%)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: '1.5rem',
    ...extra,
  } as const
}

const sections = [
  {
    href: '/my',
    label: 'My Portfolio',
    subtitle: 'Google Sheets 연동 · P&L 히스토리 차트 · Account History',
    color: '#38bdf8',
    icon: '📊',
    features: ['Google Sheets import', 'P&L Line Chart (X/Y scale controls)', 'Multi-tab position view', 'Goal tracking'],
  },
  {
    href: '/my-holdings',
    label: 'My Holdings',
    subtitle: '보유 종목 상세 분석 · 신호 오버레이 · 섹터 분포',
    color: '#818cf8',
    icon: '📋',
    features: ['Holdings table', 'Signal overlay per ticker', 'Sector allocation', 'Performance attribution'],
  },
  {
    href: '/etf',
    label: 'ETF Room',
    subtitle: 'ETF 비교 · QQQ/SPY/TLT/GLD · 레버리지 ETF 현황',
    color: '#f43f5e',
    icon: '🏦',
    features: ['ETF comparison grid', 'Leveraged ETF status', 'Correlation matrix', 'Risk metrics per ETF'],
  },
]

export default function PortfolioPage() {
  return (
    <div style={{ padding: '1.6rem 1.8rem 2.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.9rem', fontWeight: 800, color: '#f3f4f6' }}>
            My <span style={{ color: '#38bdf8' }}>Portfolio</span>
          </h1>
          <p style={{ color: '#6b7280', marginTop: '0.35rem', fontSize: '0.82rem' }}>
            Holdings · P&L · ETF Room · Google Sheets 연동
          </p>
        </div>
        <MacroBadgeStrip />
      </div>

      {/* Quick nav pills */}
      <div style={{ display: 'flex', gap: 8 }}>
        {sections.map(s => (
          <Link key={s.href} href={s.href} style={{
            fontSize: '0.74rem', padding: '5px 14px',
            border: `1px solid ${s.color}44`,
            background: `${s.color}10`,
            color: s.color,
            borderRadius: 999,
            textDecoration: 'none',
            fontWeight: 600,
          }}>
            {s.icon} {s.label}
          </Link>
        ))}
      </div>

      {/* Section cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {sections.map(s => (
          <section key={s.href} style={{ ...card(), display: 'flex', flexDirection: 'column', gap: '0.75rem', borderColor: `${s.color}22` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '1.25rem' }}>{s.icon}</span>
                  <span style={{ fontWeight: 700, color: '#f3f4f6', fontSize: '1.05rem' }}>{s.label}</span>
                </div>
                <div style={{ color: '#6b7280', fontSize: '0.78rem', marginTop: 4 }}>{s.subtitle}</div>
              </div>
              <Link href={s.href} style={{
                fontSize: '0.72rem', color: s.color,
                textDecoration: 'none',
                border: `1px solid ${s.color}44`,
                background: `${s.color}10`,
                borderRadius: 8, padding: '5px 12px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>
                Open →
              </Link>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {s.features.map(f => (
                <span key={f} style={{
                  fontSize: '0.68rem', color: '#6b7280',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 5, padding: '2px 7px',
                }}>
                  {f}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Navigation tip */}
      <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: '0.75rem 1rem', fontSize: '0.72rem', color: '#4b5563', borderLeft: '2px solid rgba(56,189,248,0.3)' }}>
        Tip: Use <Link href="/crash" style={{ color: '#ef4444', textDecoration: 'none' }}>Crash Engine</Link> to check VR energy before adjusting portfolio exposure.
        Full exposure guidance is on the <Link href="/dashboard" style={{ color: '#22c55e', textDecoration: 'none' }}>Command Center</Link> Action panel.
      </div>
    </div>
  )
}
