// =============================================================================
// NarrativeBriefCard.tsx  (WO-SA28)
// Forecast-style narrative brief — readable in 10-20 seconds
// =============================================================================
import type { NarrativeViewPayload } from '@/types/narrative'
import PremiumLockCard from '@/components/common/PremiumLockCard'

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{
      color:         '#475569',
      fontSize:      '0.58rem',
      fontWeight:    800,
      letterSpacing: '0.07em',
      textTransform: 'uppercase',
      marginBottom:  4,
    }}>
      {children}
    </div>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
          <span style={{ color: '#334155', fontSize: '0.60rem', flexShrink: 0, marginTop: 2 }}>—</span>
          <span style={{ color: '#94A3B8', fontSize: '0.68rem', lineHeight: 1.5 }}>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(148,163,184,0.07)', margin: '0.55rem 0' }} />
}

// ── Main card ─────────────────────────────────────────────────────────────────

interface Props {
  view:       NarrativeViewPayload | null
  isPremium?: boolean
}

export default function NarrativeBriefCard({ view, isPremium = false }: Props) {
  if (!view) return null

  if (!view.has_data) {
    return (
      <div style={{
        background:   '#070B10',
        border:       '1px solid rgba(148,163,184,0.09)',
        borderRadius: 12,
        padding:      '0.75rem 0.9rem',
      }}>
        <span style={{ color: '#374151', fontSize: '0.68rem' }}>{view.summary}</span>
      </div>
    )
  }

  return (
    <div style={{
      background:    '#070B10',
      border:        '1px solid rgba(148,163,184,0.09)',
      borderRadius:  12,
      padding:       '0.8rem 0.95rem',
      display:       'flex',
      flexDirection: 'column',
      gap:           0,
    }}>
      {/* ── Card header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.55rem' }}>
        <span style={{ width: 4, height: 18, borderRadius: 4, background: '#818CF8', flexShrink: 0 }} />
        <span style={{ color: '#94A3B8', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.05em' }}>
          MARKET BRIEF
        </span>
      </div>

      {/* ── Headline ── */}
      <div style={{
        color:       '#F8FAFC',
        fontSize:    '0.82rem',
        fontWeight:  700,
        lineHeight:  1.35,
        marginBottom:'0.45rem',
      }}>
        {view.headline}
      </div>

      {/* ── Summary ── always free ── */}
      <div style={{
        color:        '#94A3B8',
        fontSize:     '0.68rem',
        lineHeight:   1.55,
        marginBottom: '0.1rem',
      }}>
        {view.summary}
      </div>

      {/* ── Premium gate ── */}
      {!isPremium ? (
        <>
          <Divider />
          <PremiumLockCard
            compact
            title="Full brief — Key Points, Posture, Watch Next + MD export"
          />
        </>
      ) : (
        <>
          {/* Key Points */}
          {view.key_points.length > 0 && (
            <>
              <Divider />
              <SectionLabel>Key Points</SectionLabel>
              <BulletList items={view.key_points} />
            </>
          )}

          {/* Current Posture */}
          <Divider />
          <SectionLabel>Current Posture</SectionLabel>
          <div style={{ color: '#CBD5E1', fontSize: '0.68rem', lineHeight: 1.5 }}>
            {view.posture_line}
          </div>

          {/* Watch Next */}
          {view.watch_items.length > 0 && (
            <>
              <Divider />
              <SectionLabel>Watch Next</SectionLabel>
              <BulletList items={view.watch_items} />
            </>
          )}

          {/* Historical Context */}
          {view.analog_line && (
            <>
              <Divider />
              <SectionLabel>Historical Context</SectionLabel>
              <div style={{ color: '#94A3B8', fontSize: '0.67rem', lineHeight: 1.5, fontStyle: 'italic' }}>
                {view.analog_line}
              </div>
            </>
          )}

          {/* Forward View */}
          {view.outlook_line && (
            <>
              <Divider />
              <SectionLabel>Forward View</SectionLabel>
              <div style={{ color: '#94A3B8', fontSize: '0.67rem', lineHeight: 1.5 }}>
                {view.outlook_line}
              </div>
            </>
          )}

          {/* Closing */}
          <Divider />
          <div style={{ color: '#334155', fontSize: '0.60rem', lineHeight: 1.5, fontStyle: 'italic' }}>
            {view.closing_line}
          </div>
        </>
      )}
    </div>
  )
}
