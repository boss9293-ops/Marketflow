// =============================================================================
// AnalogList.tsx  (WO-SA20)
// =============================================================================
import type { SmartAnalyzerViewPayload } from '@/lib/formatSmartAnalyzer'
import { findAnalogs }      from '@/lib/analogFinder'
import { formatAnalogView } from '@/lib/formatAnalog'
import AnalogCard           from './AnalogCard'
import PremiumLockCard      from '@/components/common/PremiumLockCard'

interface Props {
  payload?:   SmartAnalyzerViewPayload | null
  isPremium?: boolean
}

export default function AnalogList({ payload, isPremium = false }: Props) {
  const matches   = findAnalogs(payload)
  const formatted = formatAnalogView(matches)
  const isEmpty   = formatted.length === 0

  const FREE_LIMIT     = 1
  const visibleCards   = isPremium ? formatted : formatted.slice(0, FREE_LIMIT)
  const lockedCards    = isPremium ? [] : formatted.slice(FREE_LIMIT)
  const hasLockedCards = lockedCards.length > 0

  return (
    <section style={{
      background:    '#070B10',
      border:        '1px solid rgba(148,163,184,0.09)',
      borderRadius:  16,
      padding:       '0.85rem',
      display:       'flex',
      flexDirection: 'column',
      gap:           '0.75rem',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 4, height: 22, borderRadius: 4, background: '#6366F1', flexShrink: 0 }} />
          <span style={{ color: '#F8FAFC', fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.04em' }}>
            Historical Analogs
          </span>
          <span style={{ color: '#6B7280', fontSize: '0.72rem', fontWeight: 600 }}>
            · Scenario Memory
          </span>
        </div>
        {!isEmpty && (
          <span style={{ color: '#374151', fontSize: '0.60rem', fontWeight: 600 }}>
            {isPremium
              ? 'top ' + formatted.length + ' match' + (formatted.length > 1 ? 'es' : '')
              : visibleCards.length + ' of ' + formatted.length + ' · free'}
          </span>
        )}
      </div>

      {/* Disclaimer */}
      <div style={{
        background:   'rgba(99,102,241,0.06)',
        border:       '1px solid rgba(99,102,241,0.14)',
        borderRadius: 7,
        padding:      '5px 10px',
        color:        '#6B7280',
        fontSize:     '0.63rem',
        lineHeight:   1.4,
      }}>
        Historical analogs are reference scenarios, not predictions. Past conditions show similarity — outcomes are not deterministic.
      </div>

      {/* Cards */}
      {isEmpty ? (
        <div style={{
          padding: '0.85rem', color: '#374151', fontSize: '0.72rem',
          textAlign: 'center', background: 'rgba(255,255,255,0.015)',
          border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8,
        }}>
          No strong historical analogs found for current conditions.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '0.65rem',
          }}>
            {visibleCards.map(analog => (
              <AnalogCard key={analog.label} analog={analog} />
            ))}
          </div>

          {hasLockedCards && (
            <div style={{ position: 'relative' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '0.65rem',
                filter: 'blur(3px)',
                opacity: 0.3,
                pointerEvents: 'none',
                userSelect: 'none',
              }} aria-hidden="true">
                {lockedCards.map(analog => (
                  <AnalogCard key={analog.label} analog={analog} />
                ))}
              </div>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem' }}>
                <PremiumLockCard
                  compact
                  title={lockedCards.length + ' more analog' + (lockedCards.length > 1 ? 's' : '')}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
