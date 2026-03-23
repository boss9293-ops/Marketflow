import type { SmartAnalyzerViewPayload } from '@/lib/formatSmartAnalyzer'
import type { AnalyzerReliabilityPayload } from '@/types/analyzerReliability'
import { buildTransitionView, type TransitionBias, type TransitionState } from '@/lib/formatTransitionView'
import PremiumLockCard from '@/components/common/PremiumLockCard'

const STATE_LABEL: Record<TransitionState, string> = { NORMAL: 'Normal', LIMITED: 'Limited', DEFENSIVE: 'Defensive', LOCKDOWN: 'Lockdown' }
const STATE_COLOR: Record<TransitionState, string> = { NORMAL: '#4ADE80', LIMITED: '#FACC15', DEFENSIVE: '#F97316', LOCKDOWN: '#F87171' }

function biasStyle(bias: TransitionBias) {
  if (bias === 'TIGHTER') return { color: '#F87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.22)', label: 'Tighter' }
  if (bias === 'SOFTER')  return { color: '#4ADE80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.22)',  label: 'Softer'  }
  return                         { color: '#94A3B8', bg: 'rgba(148,163,175,0.06)', border: 'rgba(148,163,175,0.18)', label: 'Stable'  }
}

const BAR_CONFIG = {
  stay:    { label: 'Stay',    color: '#94A3B8' },
  soften:  { label: 'Soften',  color: '#4ADE80' },
  tighten: { label: 'Tighten', color: '#F87171' },
} as const
type ScoreKey = keyof typeof BAR_CONFIG

function ScoreRow({ name, value }: { name: ScoreKey; value: number }) {
  const cfg = BAR_CONFIG[name]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 56, color: '#6B7280', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}>{cfg.label}</span>
      <div style={{ flex: 1, height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(2, value)}%`, height: '100%', borderRadius: 999, background: cfg.color }} />
      </div>
      <span style={{ width: 28, textAlign: 'right', color: cfg.color, fontSize: '0.70rem', fontWeight: 800, flexShrink: 0 }}>{value}</span>
    </div>
  )
}

interface Props {
  payload?:     SmartAnalyzerViewPayload | null
  reliability?: AnalyzerReliabilityPayload | null
  isPremium?:   boolean
}

export default function TransitionProbabilityCard({ payload, reliability, isPremium = false }: Props) {
  const view = buildTransitionView(payload, reliability)
  if (!view) return null
  const stateColor = STATE_COLOR[view.current_state]
  const bias       = biasStyle(view.next_bias)
  const scores     = view.transition_scores
  return (
    <section style={{ background: '#070B10', border: '1px solid rgba(148,163,184,0.09)', borderRadius: 16, padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.72rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 4, height: 22, borderRadius: 4, background: '#A78BFA', flexShrink: 0 }} />
        <span style={{ color: '#F8FAFC', fontSize: '0.82rem', fontWeight: 800 }}>Transition Outlook</span>
        <span style={{ color: '#6B7280', fontSize: '0.72rem', fontWeight: 600 }}>· Regime Tendency</span>
      </div>
      {!view.has_data ? (
        <div style={{ padding: '0.85rem', color: '#374151', fontSize: '0.72rem', textAlign: 'center', background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8 }}>
          Transition outlook unavailable due to insufficient current state data.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: '#6B7280', fontSize: '0.65rem', fontWeight: 700 }}>CURRENT</span>
            <span style={{ borderRadius: 5, background: stateColor + '12', border: '1px solid ' + stateColor + '30', color: stateColor, fontSize: '0.68rem', fontWeight: 800, padding: '2px 8px' }}>
              {STATE_LABEL[view.current_state]}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.12)', fontSize: '0.65rem' }}>·</span>
            <span style={{ color: '#6B7280', fontSize: '0.65rem', fontWeight: 700 }}>BIAS</span>
            <span style={{ borderRadius: 5, background: bias.bg, border: '1px solid ' + bias.border, color: bias.color, fontSize: '0.68rem', fontWeight: 800, padding: '2px 8px' }}>
              {bias.label}
            </span>
          </div>
          {isPremium ? (
            <>
              <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '0.6rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <ScoreRow name="stay"    value={scores.stay}    />
                <ScoreRow name="soften"  value={scores.soften}  />
                <ScoreRow name="tighten" value={scores.tighten} />
              </div>
              {view.summary && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ color: '#475569', fontSize: '0.60rem', fontWeight: 700 }}>SUMMARY</span>
                  <p style={{ margin: 0, color: '#94A3B8', fontSize: '0.72rem', lineHeight: 1.5 }}>{view.summary}</p>
                </div>
              )}
              {view.reasons.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ color: '#475569', fontSize: '0.60rem', fontWeight: 700 }}>REASONS</span>
                  {view.reasons.map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 5 }}>
                      <span style={{ color: '#374151', fontSize: '0.60rem' }}>–</span>
                      <span style={{ color: '#94A3B8', fontSize: '0.68rem' }}>{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : <PremiumLockCard compact title="Transition score breakdown" />}
        </>
      )}
      <div style={{ background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.10)', borderRadius: 6, padding: '5px 9px', color: '#475569', fontSize: '0.62rem' }}>
        Transition outlook reflects current posture persistence or easing/tightening tendency, not a guaranteed path.
      </div>
    </section>
  )
}
