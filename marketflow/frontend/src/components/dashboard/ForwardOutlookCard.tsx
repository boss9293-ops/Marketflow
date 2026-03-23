import type { SmartAnalyzerViewPayload } from '@/lib/formatSmartAnalyzer'
import type { AnalyzerReliabilityPayload } from '@/types/analyzerReliability'
import { buildForwardOutlook, type ForwardBias } from '@/lib/formatForwardOutlook'
import PremiumLockCard from '@/components/common/PremiumLockCard'

function biasStyle(bias: ForwardBias) {
  if (bias === 'DOWNSIDE') return { color: '#F87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.22)', label: 'Downside' }
  if (bias === 'UPSIDE')   return { color: '#4ADE80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.22)',  label: 'Upside'   }
  return                          { color: '#94A3B8', bg: 'rgba(148,163,175,0.06)', border: 'rgba(148,163,175,0.18)', label: 'Balanced' }
}
function confidenceStyle(c: string) {
  if (c === 'HIGH')   return { color: '#C4FF0D', bg: 'rgba(196,255,13,0.07)'  }
  if (c === 'MEDIUM') return { color: '#FACC15', bg: 'rgba(250,204,21,0.07)'  }
  return                     { color: '#94A3B8', bg: 'rgba(148,163,175,0.06)' }
}
function fmtReturn(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%' }

interface Props {
  payload?:     SmartAnalyzerViewPayload | null
  reliability?: AnalyzerReliabilityPayload | null
  isPremium?:   boolean
}

export default function ForwardOutlookCard({ payload, reliability, isPremium = false }: Props) {
  const outlook = buildForwardOutlook(payload, reliability)
  if (!outlook) return null
  const bias  = biasStyle(outlook.bias)
  const conf  = confidenceStyle(outlook.confidence)
  const range = outlook.expected_range
  const hasRange = range.downside_20d !== undefined || range.upside_20d !== undefined
  return (
    <section style={{ background: '#070B10', border: '1px solid rgba(148,163,184,0.09)', borderRadius: 16, padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 4, height: 22, borderRadius: 4, background: '#38BDF8', flexShrink: 0 }} />
        <span style={{ color: '#F8FAFC', fontSize: '0.82rem', fontWeight: 800 }}>Forward Outlook</span>
        <span style={{ color: '#6B7280', fontSize: '0.72rem', fontWeight: 600 }}>· Possible Paths</span>
      </div>
      {!outlook.has_data ? (
        <div style={{ padding: '0.85rem', color: '#374151', fontSize: '0.72rem', textAlign: 'center', background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8 }}>
          Forward outlook unavailable due to insufficient analog data.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: '#6B7280', fontSize: '0.65rem', fontWeight: 700 }}>BIAS</span>
            <span style={{ borderRadius: 5, background: bias.bg, border: '1px solid ' + bias.border, color: bias.color, fontSize: '0.68rem', fontWeight: 800, padding: '2px 8px' }}>{bias.label}</span>
            <span style={{ color: 'rgba(255,255,255,0.12)', fontSize: '0.65rem' }}>·</span>
            <span style={{ color: '#6B7280', fontSize: '0.65rem', fontWeight: 700 }}>CONFIDENCE</span>
            <span style={{ borderRadius: 5, background: conf.bg, border: '1px solid ' + conf.color + '30', color: conf.color, fontSize: '0.68rem', fontWeight: 800, padding: '2px 8px' }}>
              {outlook.confidence === 'HIGH' ? 'High' : outlook.confidence === 'MEDIUM' ? 'Medium' : 'Low'}
            </span>
          </div>
          {hasRange && (isPremium ? (
            <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '0.6rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: '#475569', fontSize: '0.60rem', fontWeight: 700 }}>RANGE (20D) FROM ANALOGS</span>
              <div style={{ display: 'flex', gap: 16, marginTop: 2 }}>
                {range.downside_20d !== undefined && <span style={{ color: '#F87171', fontSize: '0.88rem', fontWeight: 800 }}>{fmtReturn(range.downside_20d)}</span>}
                {range.upside_20d   !== undefined && <span style={{ color: '#4ADE80', fontSize: '0.88rem', fontWeight: 800 }}>{fmtReturn(range.upside_20d)}</span>}
              </div>
            </div>
          ) : <PremiumLockCard compact title="Full outlook range" />)}
          {outlook.path_summary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ color: '#475569', fontSize: '0.60rem', fontWeight: 700 }}>SUMMARY</span>
              <p style={{ margin: 0, color: '#94A3B8', fontSize: '0.72rem', lineHeight: 1.5 }}>{outlook.path_summary}</p>
            </div>
          )}
          {outlook.drivers.length > 0 && isPremium && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ color: '#475569', fontSize: '0.60rem', fontWeight: 700 }}>KEY DRIVERS</span>
              {outlook.drivers.map((d, i) => <div key={i} style={{ display: 'flex', gap: 5 }}><span style={{ color: '#374151', fontSize: '0.60rem' }}>–</span><span style={{ color: '#94A3B8', fontSize: '0.68rem' }}>{d}</span></div>)}
            </div>
          )}
        </>
      )}
      <div style={{ background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.10)', borderRadius: 6, padding: '5px 9px', color: '#475569', fontSize: '0.62rem' }}>
        This outlook reflects possible paths based on current conditions and historical analogs.
      </div>
    </section>
  )
}
