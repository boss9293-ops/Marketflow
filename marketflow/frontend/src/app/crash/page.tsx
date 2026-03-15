// Crash Protection Hub — entry point for crash protection tools
export default function CrashHubPage() {
  return (
    <main style={{
      minHeight: '100vh',
      background: '#0c0e13',
      color: '#e5e7eb',
      fontFamily: "'Inter','Segoe UI',sans-serif",
      padding: '2.6rem 1.95rem',
    }}>
      <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2.6rem' }}>

        {/* Header */}
        <div>
          <div style={{ fontSize: '0.78rem', color: '#9ca3af', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            MarketFlow · Crash Protection
          </div>
          <h1 style={{ fontSize: '2.6rem', fontWeight: 900, color: '#e5e7eb', margin: '0.39rem 0 0' }}>
            Crash Hub
          </h1>
          <p style={{ fontSize: '0.94rem', color: '#9ca3af', marginTop: '0.52rem', lineHeight: 1.5 }}>
            Risk management tools for equity and leveraged ETF investors.
            Select your strategy below — each system is designed for a different risk profile.
          </p>
        </div>

        {/* Product cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.3rem' }}>

          {/* Standard (QQQ) */}
          <a href="/risk-v1" style={{ textDecoration: 'none' }}>
            <div style={{
              background: '#111318',
              border: '1px solid rgba(99,102,241,0.3)',
              borderLeft: '4px solid #6366f1',
              borderRadius: 14,
              padding: '1.82rem 2.08rem',
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ background: 'rgba(99,102,241,0.15)', borderRadius: 6, padding: '0.2rem 0.65rem', fontSize: '0.78rem', color: '#a5b4fc', fontWeight: 700, letterSpacing: '0.08em' }}>
                      STANDARD
                    </div>
                    <div style={{ fontSize: '0.81rem', color: '#9ca3af' }}>QQQ · Long-only</div>
                  </div>
                  <div style={{ fontSize: '1.43rem', fontWeight: 800, color: '#e5e7eb', marginBottom: 6 }}>
                    Standard Risk System
                  </div>
                  <div style={{ fontSize: '0.88rem', color: '#9ca3af', lineHeight: 1.5 }}>
                    4-component macro score (Trend · Depth · Volatility · Drawdown).
                    Event type classification (Shock / Structural / Grinding).
                    Exposure guide by level. Educational, no prediction.
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                    {['Level 0–4', 'Event Library', 'Playback', 'Methodology'].map(t => (
                      <span key={t} style={{ fontSize: '0.75rem', color: '#9ca3af', background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '0.13rem 0.45rem' }}>{t}</span>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: '1.82rem', color: '#6366f1', flexShrink: 0, marginLeft: 16, alignSelf: 'center' }}>→</div>
              </div>
            </div>
          </a>

          {/* VR Survival (TQQQ) */}
          <a href="/vr-survival" style={{ textDecoration: 'none' }}>
            <div style={{
              background: '#111318',
              border: '1px solid rgba(167,139,250,0.3)',
              borderLeft: '4px solid #a78bfa',
              borderRadius: 14,
              padding: '1.82rem 2.08rem',
              cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ background: 'rgba(167,139,250,0.15)', borderRadius: 6, padding: '0.2rem 0.65rem', fontSize: '0.78rem', color: '#a78bfa', fontWeight: 700, letterSpacing: '0.08em' }}>
                      VR SURVIVAL
                    </div>
                    <div style={{ fontSize: '0.81rem', color: '#9ca3af' }}>TQQQ · 3× Leveraged</div>
                  </div>
                  <div style={{ fontSize: '1.43rem', fontWeight: 800, color: '#e5e7eb', marginBottom: 6 }}>
                    VR Leverage Survival
                  </div>
                  <div style={{ fontSize: '0.88rem', color: '#9ca3af', lineHeight: 1.5 }}>
                    4-layer architecture: Macro Score → State Machine → Pool Control → Re-Entry Discipline.
                    SHOCK / STRUCTURAL / GRINDING modes. Staged re-entry 25→50→75→100%.
                    Primary objective: account survival.
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                    {['SHOCK mode', 'Pool Logic', 'Staged Re-entry', '$10k Sim'].map(t => (
                      <span key={t} style={{ fontSize: '0.75rem', color: '#9ca3af', background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '0.13rem 0.45rem' }}>{t}</span>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: '1.82rem', color: '#a78bfa', flexShrink: 0, marginLeft: 16, alignSelf: 'center' }}>→</div>
              </div>
            </div>
          </a>

          {/* Backtests (Reference) */}
          <a href="/backtest" style={{ textDecoration: 'none' }}>
            <div style={{
              background: '#111318',
              border: '1px solid rgba(34,197,94,0.25)',
              borderLeft: '4px solid #22c55e',
              borderRadius: 14,
              padding: '1.82rem 2.08rem',
              cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ background: 'rgba(34,197,94,0.1)', borderRadius: 6, padding: '0.2rem 0.65rem', fontSize: '0.78rem', color: '#22c55e', fontWeight: 700, letterSpacing: '0.08em' }}>
                      BACKTESTS
                    </div>
                    <div style={{ fontSize: '0.81rem', color: '#9ca3af' }}>Reference · SRAS 27yr</div>
                  </div>
                  <div style={{ fontSize: '1.43rem', fontWeight: 800, color: '#e5e7eb', marginBottom: 6 }}>
                    Historical Validation
                  </div>
                  <div style={{ fontSize: '0.88rem', color: '#9ca3af', lineHeight: 1.5 }}>
                    27-year SRAS backtest (QQQ vs Risk Alert Strategy).
                    Cumulative returns, drawdown comparison, per-event performance table.
                    Custom date range selection.
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                    {['1999–2026', 'B&H vs SRAS', 'Drawdown', 'Date Range'].map(t => (
                      <span key={t} style={{ fontSize: '0.75rem', color: '#9ca3af', background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '0.13rem 0.45rem' }}>{t}</span>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: '1.82rem', color: '#22c55e', flexShrink: 0, marginLeft: 16, alignSelf: 'center' }}>→</div>
              </div>
            </div>
          </a>

          {/* Legacy SRAS link (subtle) */}
          <div style={{ textAlign: 'center', paddingTop: '0.65rem' }}>
            <a href="/crash/legacy-sras" style={{ fontSize: '0.78rem', color: '#9ca3af', textDecoration: 'none', borderBottom: '1px solid #6b7280' }}>
              Legacy SRAS Engine (9-indicator system) →
            </a>
          </div>
        </div>

        {/* Disclaimer */}
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, padding: '0.98rem 1.3rem', fontSize: '0.78rem', color: '#9ca3af', lineHeight: 1.6 }}>
          ⚠ These systems measure risk environment probability — they do NOT predict market movements or guarantee capital preservation.
          Like a weather forecast, they describe current conditions to guide exposure decisions.
          Past backtest performance does not guarantee future results. Not financial advice.
        </div>

        <div style={{ textAlign: 'center', paddingBottom: '1.3rem' }}>
          <a href="/dashboard" style={{ fontSize: '0.81rem', color: '#9ca3af', textDecoration: 'none' }}>← Dashboard</a>
        </div>
      </div>
    </main>
  )
}
