import type { SmartAnalyzerMetricItem, SADisplayTone } from '../../lib/formatSmartAnalyzer'
import InfoTooltip from '../common/InfoTooltip'
import type { TooltipKey } from '../../lib/uxCopy'

// SmartAnalyzerMetricStrip  (WO-SA14)

const TONE_COLOR: Record<SADisplayTone, string> = {
  red: '#EF4444', orange: '#F97316', amber: '#F59E0B',
  green: '#22C55E', purple: '#8B5CF6', neutral: '#6B7280',
}

const TOOLTIP_KEY: Partial<Record<string, TooltipKey>> = {
  Regime:         'REGIME',
  Runtime:        'RUNTIME',
  'Buy Gate':     'BUY_GATE',
  'Rebound Gate': 'REBOUND_GATE',
  Confidence:     'CONFIDENCE',
}

interface Props { items: SmartAnalyzerMetricItem[] }

export default function SmartAnalyzerMetricStrip({ items }: Props) {
  if (!items || items.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      {items.map((item, i) => {
        const color = TONE_COLOR[item.tone] ?? TONE_COLOR.neutral
        return (
          <div key={i} style={{
            background: '#11161C', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 8, padding: '5px 10px',
            display: 'flex', flexDirection: 'column', gap: 2, minWidth: 72,
          }}>
            {TOOLTIP_KEY[item.label] ? (
              <InfoTooltip term={TOOLTIP_KEY[item.label]!}>
                <span style={{ color: '#4B5563', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.05em' }}>
                  {item.label.toUpperCase()}
                </span>
              </InfoTooltip>
            ) : (
              <span style={{ color: '#4B5563', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.05em' }}>
                {item.label.toUpperCase()}
              </span>
            )}
            <span style={{ color, fontSize: '0.73rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {item.value}
            </span>
          </div>
        )
      })}
    </div>
  )
}
