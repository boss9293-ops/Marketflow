// =============================================================================
// UpgradePrompt.tsx  (WO-SA23)
// Full-width upgrade divider — sits between free and premium content zones.
// =============================================================================
import UpgradeButton from '@/components/subscription/UpgradeButton'
import { DEV_UNLOCK_ALL } from '@/config/dev'

const DEFAULT_FEATURES = [
  'Full historical context & 3 analog matches',
  'Forward outlook range & key drivers',
  'Regime transition score breakdown',
  'Execution history & VR audit',
]

interface Props { features?: string[] }

export default function UpgradePrompt({ features = DEFAULT_FEATURES }: Props) {
  if (DEV_UNLOCK_ALL) return null
  return (
    <div style={{
      background:    'linear-gradient(135deg, rgba(196,255,13,0.04) 0%, rgba(99,102,241,0.06) 100%)',
      border:        '1px solid rgba(196,255,13,0.14)',
      borderRadius:  16,
      padding:       '1rem 1.1rem',
      display:       'flex',
      flexDirection: 'column',
      gap:           '0.75rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.85rem', lineHeight: 1 }}>🔒</span>
          <span style={{ color: '#F8FAFC', fontSize: '0.82rem', fontWeight: 800 }}>Premium Analytics</span>
          <span style={{ color: '#6B7280', fontSize: '0.72rem', fontWeight: 600 }}>· Deeper Insight</span>
        </div>
        <UpgradeButton compact label="Unlock deeper insight" />
      </div>
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap:                 '0.4rem 1rem',
      }}>
        {features.slice(0, 4).map((feat, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ color: '#C4FF0D', fontSize: '0.65rem', flexShrink: 0, marginTop: 2 }}>·</span>
            <span style={{ color: '#94A3B8', fontSize: '0.68rem', lineHeight: 1.45 }}>{feat}</span>
          </div>
        ))}
      </div>
      <div style={{ color: '#374151', fontSize: '0.62rem' }}>
        See full historical context · Access full execution reasoning · Unlock state transitions
      </div>
    </div>
  )
}
