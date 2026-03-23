'use client'

import { useState, useEffect, type CSSProperties } from 'react'
import {
  type IntegratedAiResponse,
  type IntegratedScenario,
  type RetrievedCase,
  type VrContext,
  type AiTrustStatus,
  normalizeIntegratedResponse,
  loadCache,
  saveCache,
  isCacheStale,
  formatCacheAge,
} from '@/types/integratedAi'

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          'linear-gradient(180deg, rgba(8,12,22,0.96), rgba(9,11,17,0.99))',
  bgCard:      'rgba(255,255,255,0.03)',
  border:      '1px solid rgba(255,255,255,0.08)',
  radius:      20,
  radiusSm:    12,
  shadow:      '0 18px 40px rgba(0,0,0,0.22)',
  textPrimary: '#f8fafc',
  textSub:     '#cbd5e1',
  textMuted:   '#94a3b8',
  textDim:     '#64748b',
  blue:        '#93c5fd',
  teal:        '#5eead4',
  amber:       '#fcd34d',
  rose:        '#fca5a5',
  slate:       '#94a3b8',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function card(extra?: CSSProperties): CSSProperties {
  return {
    background:   C.bgCard,
    border:       C.border,
    borderRadius: C.radiusSm,
    padding:      '0.9rem 1rem',
    ...extra,
  }
}

function sectionLabel(text: string) {
  return (
    <div style={{
      fontSize: '0.7rem', color: C.textDim,
      textTransform: 'uppercase', letterSpacing: '0.13em',
      marginBottom: 8, fontWeight: 600,
    }}>
      {text}
    </div>
  )
}

function microLabel(text: string, color = C.textDim) {
  return (
    <div style={{ fontSize: '0.68rem', color, fontWeight: 600, letterSpacing: '0.08em', marginBottom: 8 }}>
      {text}
    </div>
  )
}

// ── VR state config ───────────────────────────────────────────────────────────

type VrStateCfg = { color: string; bg: string; border: string; desc: string; phase: string; tooltip: string }

const VR_STATE_CFG: Record<string, VrStateCfg> = {
  NORMAL: {
    color: C.teal, bg: 'rgba(94,234,212,0.07)', border: 'rgba(94,234,212,0.22)',
    phase: 'Monitoring',
    desc:  'Market conditions within expected range. VR engine is in active monitoring mode.',
    tooltip: 'NORMAL: All indicators within expected bounds. No defensive posture required.',
  },
  CAUTION: {
    color: C.amber, bg: 'rgba(252,211,77,0.07)', border: 'rgba(252,211,77,0.22)',
    phase: 'Elevated Watch',
    desc:  'Early warning signals detected. Heightened monitoring — no position change yet.',
    tooltip: 'CAUTION: One or more early-warning signals active. Monitor closely but no action yet.',
  },
  ARMED: {
    color: C.rose, bg: 'rgba(252,165,165,0.08)', border: 'rgba(252,165,165,0.28)',
    phase: 'Crash Trigger Active',
    desc:  'Crash trigger conditions met. Defensive posture is the primary objective — pool preservation overrides return optimization.',
    tooltip: 'ARMED: Crash trigger conditions are satisfied. VR engine is in maximum defensive mode.',
  },
  EXIT_DONE: {
    color: C.rose, bg: 'rgba(252,165,165,0.06)', border: 'rgba(252,165,165,0.2)',
    phase: 'Post-Exit Hold',
    desc:  'Defensive exit has been executed. Focus: confirming whether this is a temporary drawdown or structural shift before any re-entry.',
    tooltip: 'EXIT_DONE: Defensive exit completed. Holding protected allocation. Awaiting recovery confirmation.',
  },
  REENTRY: {
    color: C.blue, bg: 'rgba(147,197,253,0.07)', border: 'rgba(147,197,253,0.22)',
    phase: 'Re-entry Evaluation',
    desc:  'Re-entry evaluation active. Bottom-zone uncertainty remains elevated — recovery must be confirmed as sustained before reducing defensive allocation.',
    tooltip: 'REENTRY: Recovery signals detected but not yet confirmed. Apply re-entry caution — premature exposure increases pool risk.',
  },
}

function getVrCfg(vr_state: string): VrStateCfg {
  return VR_STATE_CFG[vr_state] ?? VR_STATE_CFG['NORMAL']
}

// ── Confidence display ────────────────────────────────────────────────────────

const CONFIDENCE_CFG = {
  high:   { label: 'High Confidence',   color: 'rgba(94,234,212,0.8)',   bg: 'rgba(94,234,212,0.08)',  border: 'rgba(94,234,212,0.25)',  tooltip: 'State classification is clear — score is far from level boundaries or state is a terminal condition.' },
  medium: { label: 'Medium Confidence', color: 'rgba(147,197,253,0.8)',  bg: 'rgba(147,197,253,0.08)', border: 'rgba(147,197,253,0.25)', tooltip: 'State classification has moderate certainty — score is within transition zone or state is inherently ambiguous (e.g. REENTRY).' },
  low:    { label: 'Low Confidence',    color: 'rgba(252,211,77,0.8)',   bg: 'rgba(252,211,77,0.08)',  border: 'rgba(252,211,77,0.25)',  tooltip: 'Score is very close to a level boundary — state could shift with minor data changes. Apply extra caution to any interpretation.' },
}

// ── Historical case context ───────────────────────────────────────────────────

const CASE_WHY: Record<string, string> = {
  '2018_vol_spike':         'Rapid volatility spike that resolved quickly — helps distinguish transient stress from the start of persistent deterioration.',
  '2018_q4_correction':     'Fed-driven structural drawdown with a clean bottom — relevant for calibrating re-entry timing after policy-induced sell-offs.',
  '2020_covid_crash':       'Extreme policy response followed by a V-shaped recovery — shows how crash trigger sequencing behaved under maximum uncertainty.',
  '2022_fed_bear':          'Prolonged bear market with multiple false dawns — a critical warning against premature re-entry in rate-driven environments.',
  '2025_tariff_correction': 'Policy shock with unresolved trajectory — parallels for managing exogenous risk when the ultimate policy outcome is unknown.',
}

// ── Trust helpers ─────────────────────────────────────────────────────────────

function trustColor(s: AiTrustStatus): string {
  if (s === 'live')   return C.teal
  if (s === 'cached') return C.blue
  if (s === 'stale')  return C.amber
  if (s === 'failed') return C.rose
  return C.textDim
}

function trustLabel(s: AiTrustStatus): string {
  if (s === 'live')    return 'LIVE'
  if (s === 'cached')  return 'CACHED'
  if (s === 'stale')   return 'STALE'
  if (s === 'failed')  return 'FAILED'
  if (s === 'loading') return 'LOADING'
  return 'IDLE'
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
      <style>{`
        @keyframes aiPulse{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
        .ai-dot{width:8px;height:8px;border-radius:50%;background:rgba(148,163,184,.7);animation:aiPulse 1.2s ease-in-out infinite}
        .ai-dot:nth-child(2){animation-delay:.15s}.ai-dot:nth-child(3){animation-delay:.3s}
      `}</style>
      <div className="ai-dot" /><div className="ai-dot" /><div className="ai-dot" />
    </div>
  )
}

// ── VR State Summary Strip ────────────────────────────────────────────────────

function VRStateStrip({ vrc }: { vrc: VrContext }) {
  const cfg      = getVrCfg(vrc.vr_state)
  const confCfg  = CONFIDENCE_CFG[vrc.confidence]

  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      padding: '0.65rem 0.9rem',
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: C.radiusSm,
      marginBottom: 14,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.65rem', color: C.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            VR Engine State
          </span>
          {/* State badge with tooltip */}
          <span
            title={cfg.tooltip}
            style={{
              fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.08em',
              color: cfg.color,
              background: `${cfg.color}18`,
              border: `1px solid ${cfg.color}40`,
              padding: '1px 8px', borderRadius: 99,
              cursor: 'help',
            }}
          >
            {vrc.vr_state}
          </span>
          <span style={{ fontSize: '0.72rem', color: C.textDim, fontStyle: 'italic' }}>
            {cfg.phase}
          </span>
          {/* Confidence badge */}
          <span
            title={confCfg.tooltip}
            style={{
              fontSize: '0.65rem', fontWeight: 700,
              color: confCfg.color,
              background: confCfg.bg,
              border: `1px solid ${confCfg.border}`,
              padding: '1px 7px', borderRadius: 99,
              cursor: 'help',
            }}
          >
            {confCfg.label}
          </span>
          {/* Crash trigger badge */}
          {vrc.crash_trigger && (
            <span
              title="One or more crash trigger conditions are currently satisfied by the VR engine."
              style={{
                fontSize: '0.66rem', fontWeight: 700,
                color: C.rose, background: 'rgba(252,165,165,0.1)',
                border: '1px solid rgba(252,165,165,0.35)',
                padding: '1px 8px', borderRadius: 99, letterSpacing: '0.06em',
                cursor: 'help',
              }}
            >
              CRASH TRIGGER
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.81rem', color: C.textMuted, lineHeight: 1.5 }}>
          {cfg.desc}
        </div>
      </div>
    </div>
  )
}

// ── State-aware framing banner ────────────────────────────────────────────────

function StateAwareFraming({ vrc }: { vrc: VrContext }) {
  const { vr_state, crash_trigger } = vrc
  if (crash_trigger || vr_state === 'ARMED') {
    return (
      <div style={{ ...card({ padding: '0.75rem 1rem' }), borderColor: 'rgba(252,165,165,0.25)', background: 'rgba(252,165,165,0.05)', marginBottom: 4 }}>
        <span style={{ fontSize: '0.84rem', color: C.rose, fontWeight: 700 }}>Crash trigger active. </span>
        <span style={{ fontSize: '0.84rem', color: C.textMuted }}>
          Pool preservation is the primary objective. The AI interpretation below is framed for a defensive posture. Scenario probabilities reflect elevated downside risk. Historical analogs are selected for structural similarity to high-stress trigger conditions — not for recovery timing.
        </span>
      </div>
    )
  }
  if (vr_state === 'EXIT_DONE') {
    return (
      <div style={{ ...card({ padding: '0.75rem 1rem' }), borderColor: 'rgba(252,165,165,0.18)', background: 'rgba(252,165,165,0.04)', marginBottom: 4 }}>
        <span style={{ fontSize: '0.84rem', color: C.rose, fontWeight: 700 }}>Defensive exit executed. </span>
        <span style={{ fontSize: '0.84rem', color: C.textMuted }}>
          The focus is confirming whether this is a temporary drawdown or a structural regime shift. Historical analogs below include both false recovery signals and genuine bottoms — the distribution matters more than the label.
        </span>
      </div>
    )
  }
  if (vr_state === 'REENTRY') {
    return (
      <div style={{ ...card({ padding: '0.75rem 1rem' }), borderColor: 'rgba(147,197,253,0.2)', background: 'rgba(147,197,253,0.04)', marginBottom: 4 }}>
        <span style={{ fontSize: '0.84rem', color: C.blue, fontWeight: 700 }}>Re-entry evaluation active. </span>
        <span style={{ fontSize: '0.84rem', color: C.textMuted }}>
          Re-entry caution applies: bottom-zone uncertainty remains elevated even when momentum looks constructive. Historical analogs show the range of recovery profiles — from clean V-reversals to extended base-building with multiple retests.
        </span>
      </div>
    )
  }
  return null
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BulletList({ items, accent = C.textMuted }: { items: string[]; accent?: string }) {
  if (!items.length) return null
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <span style={{ color: accent, fontSize: '0.78rem', marginTop: 3, flexShrink: 0 }}>•</span>
          <span style={{ fontSize: '0.88rem', color: C.textSub, lineHeight: 1.55 }}>{item}</span>
        </div>
      ))}
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ fontSize: '0.84rem', color: C.textDim, fontStyle: 'italic', padding: '0.5rem 0' }}>
      {text}
    </div>
  )
}

function ScenarioRow({ s, isTop }: { s: IntegratedScenario; isTop: boolean }) {
  const pct = Math.round(s.prob * 100)
  const barColor = pct >= 50 ? 'rgba(94,234,212,0.55)'
                 : pct >= 30 ? 'rgba(251,191,36,0.55)'
                 : 'rgba(248,113,113,0.45)'
  return (
    <div style={card({ padding: '0.8rem 0.95rem', borderColor: isTop ? 'rgba(94,234,212,0.38)' : undefined, background: isTop ? 'rgba(94,234,212,0.05)' : C.bgCard })}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isTop && (
            <span title="Highest probability scenario" style={{
              fontSize: '0.62rem', fontWeight: 800, color: C.teal,
              background: 'rgba(94,234,212,0.1)', border: '1px solid rgba(94,234,212,0.3)',
              padding: '1px 7px', borderRadius: 99, letterSpacing: '0.08em',
              cursor: 'help',
            }}>
              TOP
            </span>
          )}
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: C.textSub }}>
            {s.name || 'Unnamed scenario'}
          </span>
        </div>
        <span style={{ fontSize: '1.1rem', fontWeight: 800, color: C.textPrimary, minWidth: 40, textAlign: 'right' }}>
          {pct}%
        </span>
      </div>
      <div style={{
        height: 10, borderRadius: 99,
        background: 'rgba(148,163,184,0.12)',
        position: 'relative', overflow: 'hidden', marginTop: 8,
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0,
          height: '100%', width: `${pct}%`,
          background: barColor, borderRadius: 99,
          transition: 'width 0.6s ease',
        }} />
      </div>
      {s.description && (
        <div style={{ fontSize: '0.83rem', color: C.textMuted, marginTop: 7, lineHeight: 1.5 }}>
          {s.description}
        </div>
      )}
    </div>
  )
}

function RetrievedCaseCard({ rc, idx }: { rc: RetrievedCase; idx: number }) {
  const pct     = Math.round(rc.similarity * 100)
  const whyText = CASE_WHY[rc.case_id] ?? null
  return (
    <div style={card({ padding: '0.85rem 0.95rem' })}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: C.textDim, fontWeight: 700 }}>{idx + 1}.</span>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: C.textSub }}>
            {rc.title ?? rc.case_id.replace(/_/g, ' ')}
          </span>
        </div>
        <span title={`Deterministic similarity score: ${pct}% structural match`} style={{
          fontSize: '0.78rem', fontWeight: 800, cursor: 'help',
          color: pct >= 70 ? C.teal : pct >= 50 ? C.blue : C.slate,
          background: pct >= 70 ? 'rgba(94,234,212,0.08)' : pct >= 50 ? 'rgba(147,197,253,0.08)' : 'rgba(148,163,184,0.08)',
          border: `1px solid ${pct >= 70 ? 'rgba(94,234,212,0.25)' : pct >= 50 ? 'rgba(147,197,253,0.25)' : 'rgba(148,163,184,0.15)'}`,
          padding: '2px 9px', borderRadius: 99,
        }}>
          {pct}% match
        </span>
      </div>
      {whyText && (
        <div style={{
          marginTop: 8, padding: '0.45rem 0.7rem',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8,
          fontSize: '0.8rem', color: C.textMuted, lineHeight: 1.55, fontStyle: 'italic',
        }}>
          <span style={{ color: C.textDim, fontStyle: 'normal', fontWeight: 600, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 6 }}>
            Why it matters:
          </span>
          {whyText}
        </div>
      )}
      {rc.reasons.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {rc.reasons.slice(0, 4).map((r, ri) => (
            <span key={ri} style={{
              fontSize: '0.73rem', color: C.textDim,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
              padding: '2px 8px', borderRadius: 99,
            }}>
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Zone A — Decision Context ─────────────────────────────────────────────────

function ZoneA({ result }: { result: IntegratedAiResponse }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {result.market_summary && (
        <div style={{
          ...card({ padding: '1.1rem 1.2rem' }),
          borderColor: 'rgba(147,197,253,0.15)',
          background: 'rgba(147,197,253,0.04)',
          borderLeft: '3px solid rgba(147,197,253,0.4)',
        }}>
          {sectionLabel('Market Context')}
          <p style={{ fontSize: '0.97rem', color: C.textPrimary, margin: 0, lineHeight: 1.7, fontWeight: 500 }}>
            {result.market_summary}
          </p>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {[
          { label: 'Regime Assessment',   text: result.regime_assessment,   accent: 'rgba(148,163,184,0.3)' },
          { label: 'VR Tactical State',   text: result.vr_assessment,       accent: 'rgba(94,234,212,0.3)' },
          { label: 'Combined Assessment', text: result.combined_assessment, accent: 'rgba(147,197,253,0.3)' },
        ].map(({ label, text, accent }) => (
          <div key={label} style={{ ...card(), borderLeft: `3px solid ${accent}` }}>
            <div style={{ fontSize: '0.7rem', color: C.textDim, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {label}
            </div>
            <p style={{ fontSize: '0.87rem', color: C.textSub, margin: 0, lineHeight: 1.6 }}>
              {text || <span style={{ color: C.textDim, fontStyle: 'italic' }}>—</span>}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Zone B — Decision Framework ───────────────────────────────────────────────

function ZoneB({ result, vrc }: { result: IntegratedAiResponse; vrc?: VrContext }) {
  const sortedScenarios = [...result.scenarios].sort((a, b) => b.prob - a.prob)
  const retrieved       = result._meta?.retrieved_cases ?? []
  const topScenario     = sortedScenarios[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Scenario Map */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: '0.7rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.13em', fontWeight: 600 }}>
            Scenario Map
          </div>
          {/* Scenario → Strategy Lab link */}
          {topScenario && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <a
                href="?tab=Strategy+Lab"
                title={`Open Strategy Lab to compare how historical scenarios like "${topScenario.name}" resolved in backtests`}
                style={{
                  fontSize: '0.72rem', color: C.blue, fontWeight: 600,
                  textDecoration: 'none',
                  background: 'rgba(147,197,253,0.07)',
                  border: '1px solid rgba(147,197,253,0.2)',
                  padding: '2px 10px', borderRadius: 99,
                  display: 'flex', alignItems: 'center', gap: 5,
                  transition: 'all 0.2s',
                }}
              >
                <span>Strategy Lab</span>
                <span style={{ fontSize: '0.8rem' }}>→</span>
              </a>
              <a
                href="?tab=Crash+Analysis"
                title="Validate the risk assessment above against pattern engine data and historical crash sequences"
                style={{
                  fontSize: '0.72rem', color: C.rose, fontWeight: 600,
                  textDecoration: 'none',
                  background: 'rgba(252,165,165,0.07)',
                  border: '1px solid rgba(252,165,165,0.2)',
                  padding: '2px 10px', borderRadius: 99,
                  display: 'flex', alignItems: 'center', gap: 5,
                  transition: 'all 0.2s',
                }}
              >
                <span>Crash Analysis</span>
                <span style={{ fontSize: '0.8rem' }}>→</span>
              </a>
            </div>
          )}
        </div>
        {sortedScenarios.length === 0
          ? <EmptyHint text="No scenario breakdown available." />
          : (
            <div style={{ display: 'grid', gap: 8 }}>
              {sortedScenarios.map((s, i) => (
                <ScenarioRow key={i} s={s} isTop={i === 0} />
              ))}
            </div>
          )
        }
      </div>

      {/* Historical Pattern Match */}
      <div>
        {sectionLabel('Historical Pattern Match')}
        <div style={{ fontSize: '0.78rem', color: C.textDim, marginBottom: 10, lineHeight: 1.55 }}>
          {vrc && (vrc.vr_state === 'REENTRY' || vrc.vr_state === 'EXIT_DONE')
            ? 'Cases below were retrieved for structural similarity to current conditions. Pay attention to how each case resolved — both the recovery path and the false starts.'
            : 'Retrieved from research DB by deterministic similarity scoring — not AI-generated. Cases ranked by structural match, not recency.'
          }
        </div>
        {retrieved.length > 0
          ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {retrieved.map((rc, i) => <RetrievedCaseCard key={rc.case_id} rc={rc} idx={i} />)}
            </div>
          )
          : result.similar_cases.length > 0
            ? (
              <div style={{ display: 'grid', gap: 6 }}>
                {result.similar_cases.map((item, i) => (
                  <div key={i} style={card({ display: 'flex', gap: 10, alignItems: 'center' })}>
                    <span style={{ fontSize: '0.7rem', color: C.textDim, fontWeight: 700 }}>{i + 1}.</span>
                    <span style={{ fontSize: '0.88rem', color: C.textSub }}>{item}</span>
                  </div>
                ))}
              </div>
            )
            : <EmptyHint text="No closely retrieved historical analogs." />
        }
      </div>

      {/* Evidence + Contradictions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div style={card()}>
          {sectionLabel('Evidence')}
          {microLabel('Signals that support the current risk assessment', 'rgba(94,234,212,0.6)')}
          {result.evidence.length === 0
            ? <EmptyHint text="No evidence points available." />
            : <BulletList items={result.evidence} accent={C.teal} />
          }
        </div>
        <div style={{ ...card(), border: '1px solid rgba(251,191,36,0.2)', background: 'rgba(251,191,36,0.04)' }}>
          {sectionLabel('Contradictions')}
          {microLabel('Signals that may limit downside or suggest overstating risk', 'rgba(252,211,77,0.65)')}
          {result.contradictions.length === 0
            ? <EmptyHint text="No major contradictions identified." />
            : <BulletList items={result.contradictions} accent={C.amber} />
          }
        </div>
      </div>

      {/* VR Context Boundaries + Cautions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div style={card()}>
          {sectionLabel('VR Context Boundaries')}
          <div style={{ fontSize: '0.75rem', color: C.textDim, marginBottom: 8, lineHeight: 1.5 }}>
            Observation activities appropriate for the current VR phase. Not trading instructions — position decisions are governed by VR engine rules, not this panel.
          </div>
          {result.allowed_actions.length === 0
            ? <EmptyHint text="No context boundaries defined for this state." />
            : <BulletList items={result.allowed_actions} accent={C.blue} />
          }
        </div>
        <div style={{ ...card(), border: '1px solid rgba(248,113,113,0.15)', background: 'rgba(248,113,113,0.04)' }}>
          {sectionLabel('Cautions')}
          <div style={{ fontSize: '0.75rem', color: C.textDim, marginBottom: 8, lineHeight: 1.5 }}>
            Conditions or patterns that warrant extra attention in the current phase.
          </div>
          {result.cautions.length === 0
            ? <EmptyHint text="No specific cautions raised." />
            : <BulletList items={result.cautions} accent={C.rose} />
          }
        </div>
      </div>

      {/* Interpretive Conclusion */}
      {result.recommendation && (
        <div style={card({ borderColor: 'rgba(255,255,255,0.1)' })}>
          {sectionLabel('Interpretive Conclusion')}
          <p style={{ fontSize: '0.9rem', color: C.textSub, margin: 0, lineHeight: 1.65 }}>
            {result.recommendation}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Trust metadata bar ────────────────────────────────────────────────────────

function TrustBar({ status, result, cacheTs, errMsg }: {
  status: AiTrustStatus
  result: IntegratedAiResponse | null
  cacheTs: number | null
  errMsg: string
}) {
  const color = trustColor(status)
  const label = trustLabel(status)
  const meta  = result?._meta

  return (
    <div style={{
      display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
      padding: '0.55rem 0.8rem',
      background: 'rgba(255,255,255,0.02)',
      border: C.border,
      borderRadius: C.radiusSm,
      marginBottom: 14,
    }}>
      <span title={`Data freshness: ${label}`} style={{
        fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em',
        color,
        background: `${color}18`,
        border: `1px solid ${color}40`,
        padding: '2px 9px', borderRadius: 99, cursor: 'help',
      }}>
        {label}
      </span>
      {meta && (
        <>
          <span style={{ fontSize: '0.72rem', color: C.textDim }}>AI Generated</span>
          <span style={{ fontSize: '0.72rem', color: C.textDim }}>{meta.provider} / {meta.model}</span>
          {meta.latency_ms != null && (
            <span title="AI response latency" style={{ fontSize: '0.72rem', color: C.textDim, cursor: 'help' }}>
              {meta.latency_ms}ms
            </span>
          )}
          {meta.date && (
            <span style={{ fontSize: '0.72rem', color: C.textDim }}>as of {meta.date}</span>
          )}
        </>
      )}
      {cacheTs != null && (status === 'cached' || status === 'stale') && (
        <span style={{ fontSize: '0.72rem', color: status === 'stale' ? C.amber : C.textDim }}>
          {formatCacheAge(cacheTs)}
        </span>
      )}
      {status === 'failed' && errMsg && (
        <span style={{ fontSize: '0.72rem', color: C.rose }}>{errMsg}</span>
      )}
      {(status === 'cached' || status === 'stale') && errMsg && (
        <span style={{ fontSize: '0.72rem', color: C.amber }}>{errMsg}</span>
      )}
      <span style={{ fontSize: '0.72rem', color: C.textDim, fontStyle: 'italic', marginLeft: 'auto' }}>
        Engine = facts · Research DB = memory · AI = interpretation · Human = decision
      </span>
    </div>
  )
}

// ── Transition connector to sections below ────────────────────────────────────


// ── Research Desk link builder ────────────────────────────────────────────────

function buildResearchQuery(vrc: VrContext, topScenarioName?: string, result?: IntegratedAiResponse | null): string {
  const parts: string[] = []
  if (vrc.crash_trigger || vrc.vr_state === "ARMED") {
    parts.push(`VR engine is in ${vrc.vr_state} state with crash trigger active.`)
    parts.push("Analyze what market conditions drive TQQQ leverage risk in this type of regime and how similar periods resolved historically.")
  } else if (vrc.vr_state === "EXIT_DONE") {
    parts.push("VR engine has executed a defensive exit.")
    parts.push("Analyze recovery patterns after high-stress defensive exits in leveraged ETF portfolios and typical drawdown resolution paths.")
  } else if (vrc.vr_state === "REENTRY") {
    parts.push("VR engine is in re-entry evaluation mode.")
    parts.push("Analyze historical re-entry timing risk for TQQQ and what conditions reliably signal a sustained recovery vs a bear market rally.")
  } else {
    parts.push(`Current VR state is ${vrc.vr_state}.`)
    parts.push("Analyze current market regime conditions and their historical precedents for leveraged ETF exposure.")
  }
  if (topScenarioName) parts.push(`Top AI scenario: "${topScenarioName}".`)
  if (result?.market_summary) {
    const first = result.market_summary.split(".")[0]
    if (first && first.length < 130) parts.push(`Context: ${first}.`)
  }
  return parts.join(" ")
}

function buildResearchUrl(vrc: VrContext, topScenarioName?: string, result?: IntegratedAiResponse | null): string {
  const params = new URLSearchParams({
    q:             buildResearchQuery(vrc, topScenarioName, result),
    vr_state:      vrc.vr_state,
    crash_trigger: String(vrc.crash_trigger),
    confidence:    vrc.confidence,
  })
  return `/research?${params.toString()}`
}

function TransitionLine({ topScenarioName, researchUrl }: { topScenarioName?: string; researchUrl?: string }) {
  return (
    <div style={{
      marginTop: 6,
      padding: '0.7rem 0.95rem',
      background: 'rgba(255,255,255,0.02)',
      border: C.border,
      borderRadius: C.radiusSm,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: topScenarioName ? 6 : 0 }}>
        <span style={{ fontSize: '0.73rem', color: C.textDim }}>
          This interpretation connects to the analysis layers below — each validates a different dimension of the AI assessment:
        </span>
        {[
        { label: 'Strategy Lab',   color: C.blue,  tip: 'Backtest top scenario against historical events in Strategy Lab' },
        { label: 'Crash Analysis', color: C.rose,  tip: 'Validate risk assessment against pattern engine and historical crash data' },
        { label: 'Playback',       color: C.slate, tip: 'Review event-by-event execution details in Playback' },
      ].map(({ label, color, tip }, i, arr) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <a
              href={`?tab=${encodeURIComponent(label)}`}
              title={tip}
              style={{ fontSize: '0.73rem', color, fontWeight: 600, textDecoration: 'none' }}
            >
              {label}
            </a>
            {i < arr.length - 1 && (
              <span style={{ fontSize: '0.73rem', color: C.textDim }}>·</span>
            )}
          </span>
        ))}
        {researchUrl && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.73rem', color: C.textDim }}>·</span>
            <a
              href={researchUrl}
              title="Open regime-linked research in Research Desk — prefilled with current VR state and scenario context"
              style={{ fontSize: '0.73rem', color: '#818cf8', fontWeight: 600, textDecoration: 'none' }}
            >
              Research Desk ↗
            </a>
          </span>
        )}
      </div>
      {topScenarioName && (
        <div style={{ fontSize: '0.73rem', color: C.textDim, fontStyle: 'italic', lineHeight: 1.5 }}>
          Top scenario: <span style={{ color: C.textMuted, fontStyle: 'normal', fontWeight: 600 }}>{topScenarioName}</span>
          {' '}— use Strategy Lab to test scenarios, Crash Analysis to validate risk, and Playback to review execution.
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function IntegratedResearchPanel() {
  const [status,  setStatus]  = useState<AiTrustStatus>('idle')
  const [result,  setResult]  = useState<IntegratedAiResponse | null>(null)
  const [cacheTs, setCacheTs] = useState<number | null>(null)
  const [errMsg,  setErrMsg]  = useState('')

  useEffect(() => {
    const entry = loadCache()
    if (entry) {
      setResult(normalizeIntegratedResponse(entry.data))
      setCacheTs(entry.timestamp)
      setStatus(isCacheStale(entry) ? 'stale' : 'cached')
    }
  }, [])

  async function runAnalysis() {
    setStatus('loading')
    setErrMsg('')
    try {
      const res = await fetch('/api/analyze-integrated', { method: 'POST' })
      const raw = await res.json() as Record<string, unknown>
      if (!res.ok || raw._route_error_code || raw._error) {
        const entry = loadCache()
        const msg = typeof raw._error === 'string' ? raw._error : `Service error (${res.status})`
        if (entry) {
          setResult(normalizeIntegratedResponse(entry.data))
          setCacheTs(entry.timestamp)
          setStatus(isCacheStale(entry) ? 'stale' : 'cached')
          setErrMsg(`${msg} — showing cached result`)
        } else {
          setErrMsg(msg)
          setStatus('failed')
        }
        return
      }
      const norm = normalizeIntegratedResponse(raw)
      saveCache(norm)
      setResult(norm)
      setCacheTs(Date.now())
      setStatus('live')
    } catch (e) {
      const entry = loadCache()
      const msg = e instanceof Error ? e.message : String(e)
      if (entry) {
        setResult(normalizeIntegratedResponse(entry.data))
        setCacheTs(entry.timestamp)
        setStatus(isCacheStale(entry) ? 'stale' : 'cached')
        setErrMsg('Network error — showing cached result')
      } else {
        setErrMsg(msg)
        setStatus('failed')
      }
    }
  }

  const hasResult = result !== null
  const isLoading = status === 'loading'
  const btnLabel  = isLoading         ? 'Analyzing…'
                  : status === 'live' ? 'Re-analyze'
                  : hasResult         ? 'Refresh'
                  : 'Generate Analysis'

  const vrc             = result?._vr_context
  const sortedScenarios = result ? [...result.scenarios].sort((a, b) => b.prob - a.prob) : []
  const topScenarioName = sortedScenarios[0]?.name
  const researchUrl     = vrc ? buildResearchUrl(vrc, topScenarioName, result) : undefined

  return (
    <div style={{
      background:   C.bg,
      border:       C.border,
      borderRadius: C.radius,
      padding:      '1.4rem 1.5rem',
      boxShadow:    C.shadow,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.13em', marginBottom: 5 }}>
            AI Interpretation Layer · Step 1 of 4
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: C.textPrimary }}>
            VR Decision Support · Research-Backed Interpretation
          </div>
          <div style={{ fontSize: '0.83rem', color: C.textDim, marginTop: 5, lineHeight: 1.5, maxWidth: 540 }}>
            Interprets current VR engine state, market regime, and historical research analogs.
            Defensive bias applies. Not a trading instruction.
          </div>
        </div>
        <button
          onClick={runAnalysis}
          disabled={isLoading}
          title="AI interpretation uses current VR engine state plus retrieved historical research cases."
          style={{
            fontSize: '0.85rem', fontWeight: 700,
            color:      isLoading ? C.textDim : C.textSub,
            background: isLoading ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
            border:     `1px solid rgba(255,255,255,${isLoading ? '0.05' : '0.12'})`,
            borderRadius: 10, padding: '0.55rem 1.1rem',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s', whiteSpace: 'nowrap',
          }}
        >
          {btnLabel}
        </button>
      </div>

      {/* Trust bar */}
      {(hasResult || status === 'failed') && (
        <TrustBar status={status} result={result} cacheTs={cacheTs} errMsg={errMsg} />
      )}

      {/* Loading */}
      {isLoading && (
        <div style={{ ...card({ padding: '2rem' }), textAlign: 'center', color: C.textDim, fontSize: '0.88rem', letterSpacing: '0.04em' }}>
          <Spinner />
          <div style={{ marginTop: 14 }}>
            Retrieving historical cases · calling AI interpretation layer…
          </div>
        </div>
      )}

      {/* Failed, no cache */}
      {status === 'failed' && !hasResult && (
        <div style={{ ...card({ borderColor: 'rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.06)', padding: '0.8rem 1rem' }), color: C.rose, fontSize: '0.86rem' }}>
          <strong>Analysis unavailable:</strong> {errMsg || 'Unknown error'}
        </div>
      )}

      {/* Results */}
      {!isLoading && hasResult && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {vrc && <VRStateStrip vrc={vrc} />}
          {vrc && <StateAwareFraming vrc={vrc} />}

          <section>
            <div style={{ fontSize: '0.65rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10, fontWeight: 700 }}>
              Zone A · Decision Context
            </div>
            <ZoneA result={result} />
          </section>

          <section>
            <div style={{ fontSize: '0.65rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10, fontWeight: 700 }}>
              Zone B · Decision Framework
            </div>
            <ZoneB result={result} vrc={vrc} />
          </section>

          <TransitionLine topScenarioName={topScenarioName} researchUrl={researchUrl} />

        </div>
      )}
    </div>
  )
}
