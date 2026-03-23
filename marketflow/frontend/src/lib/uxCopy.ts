// =============================================================================
// uxCopy.ts  (WO-SA19)
//
// Single source of truth for all UX copy — section intros, tooltips,
// empty states, status glossary. Import from here only.
// =============================================================================

// ── Section intros (1 line, subdued) ─────────────────────────────────────────

export const SECTION_INTRO = {
  SMART_ANALYZER:
    'Current market interpretation based on regime, runtime posture, and evidence alignment.',
  INVESTOR_ACTION:
    'A posture summary showing how actively conditions currently support participation.',
  VR_AUDIT:
    'Shows how current policy changed or constrained a specific VR action.',
  VR_TIMELINE:
    'Tracks how analyzer posture changes affected VR behavior over time.',
  RELIABILITY:
    'Confidence reflects how well-aligned and stable the current evidence set is.',
} as const

// ── Tooltip copy (1-2 sentences, calm, credible) ─────────────────────────────

export const TOOLTIP = {
  REGIME:
    'The market regime describes the dominant character of current stress or stability.',
  RUNTIME:
    'Runtime mode translates analyzer conditions into the VR operating posture.',
  RELIABILITY:
    'Reliability reflects how aligned and stable the current evidence set is. Higher agreement means the posture is more trustworthy.',
  BUY_GATE:
    'The buy gate controls whether new base buy actions are allowed, limited, or blocked under the current policy.',
  REBOUND_GATE:
    'The rebound gate controls whether counter-trend rebound entries are allowed under the current policy.',
  BLOCKED:
    'This action was not executed because the current policy prevents it under the active runtime mode.',
  PARTIAL:
    'This action was executed at a reduced size — the policy capped notional exposure.',
  PRIORITIZED:
    'Defense was prioritized over this action, overriding normal execution.',
  CONFIDENCE:
    'Confidence reflects how clearly the available evidence supports the current posture interpretation.',
  EVIDENCE:
    'Evidence strength indicates how many confirming data layers (macro, credit, internals, gates) are aligned.',
  SIGNAL_AGREEMENT:
    'Agreement shows whether core layers (regime, runtime, policy) are pointing in the same direction.',
  STRUCTURAL:
    'Structural stress means broad macro pressure appears persistent rather than purely event-driven.',
  DEFENSIVE:
    'Defensive posture means the system is prioritizing capital preservation over aggressive entry.',
  LOCKDOWN:
    'Lockdown means new risk-taking is blocked while defense is prioritized.',
  LIMITED:
    'Limited mode means participation is still possible, but new exposure should remain selective.',
} as const

export type TooltipKey = keyof typeof TOOLTIP

// ── Empty state copy ──────────────────────────────────────────────────────────

export const EMPTY_STATE = {
  SMART_ANALYZER: {
    title:   'Smart Analyzer data is currently unavailable.',
    detail:  'Please check back after the next data refresh.',
  },
  VR_AUDIT: {
    title:   'No constrained VR action is available yet for this view.',
    detail:  undefined,
  },
  VR_TIMELINE: {
    title:   'Timeline data is not available yet.',
    detail:  'State changes will appear here once sufficient history is loaded.',
  },
  RELIABILITY_PARTIAL: {
    title:   'Reliability is derived from currently available fields.',
    detail:  'Additional backend signals may improve accuracy over time.',
  },
  INVESTOR_ACTION: {
    title:   'Investor posture is currently unavailable.',
    detail:  'Data will appear after Smart Analyzer runs.',
  },
} as const

// ── Status glossary ───────────────────────────────────────────────────────────

export const STATUS_GLOSSARY = [
  {
    section: 'Regime',
    items: [
      { term: 'Normal',     desc: 'Broad participation — no major stress' },
      { term: 'Event',      desc: 'Event-driven pressure — monitor conditions' },
      { term: 'Structural', desc: 'Persistent macro stress — caution required' },
      { term: 'Mixed',      desc: 'Conflicting signals — selective approach' },
    ],
  },
  {
    section: 'Runtime Mode',
    items: [
      { term: 'Normal',    desc: 'Full participation available' },
      { term: 'Limited',   desc: 'Selective entries only' },
      { term: 'Defensive', desc: 'Capital preservation first' },
      { term: 'Lockdown',  desc: 'New risk-taking blocked' },
    ],
  },
  {
    section: 'Execution',
    items: [
      { term: 'Executed',    desc: 'Action allowed and run' },
      { term: 'Partial',     desc: 'Size was capped by policy' },
      { term: 'Blocked',     desc: 'Action not executed — policy prevented it' },
      { term: 'Prioritized', desc: 'Defense took precedence over this action' },
    ],
  },
] as const

// ── First-time user micro-guide ───────────────────────────────────────────────

export const MICRO_GUIDE =
  'Start here: Regime shows market character — Runtime shows system posture — Action Console shows participation stance.'
