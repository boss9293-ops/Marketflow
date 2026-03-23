// =============================================================================
// lib/formatNarrativeView.ts  (WO-SA28)
// Deterministic template mapping → NarrativeViewPayload
// No freeform AI — pure rule-based text assembly
// =============================================================================
import type { SmartAnalyzerViewPayload }  from '@/lib/formatSmartAnalyzer'
import type { AnalyzerReliabilityPayload } from '@/types/analyzerReliability'
import type { Alert }                      from '@/types/alert'
import type { DailySnapshotView }          from '@/lib/buildDailySnapshot'
import type { ForwardOutlookPayload }      from '@/lib/formatForwardOutlook'
import type { TransitionViewPayload }      from '@/lib/formatTransitionView'
import type { NarrativeViewPayload, MdPromptPayload } from '@/types/narrative'

// ── Input ─────────────────────────────────────────────────────────────────────

export interface NarrativeInput {
  sa?:          SmartAnalyzerViewPayload | null
  reliability?: AnalyzerReliabilityPayload | null
  alerts?:      Alert[]
  dailyView?:   DailySnapshotView | null
  forward?:     ForwardOutlookPayload | null
  transition?:  TransitionViewPayload | null
}

// ── Headline templates ────────────────────────────────────────────────────────

type Runtime = 'NORMAL' | 'LIMITED' | 'DEFENSIVE' | 'LOCKDOWN'
type Gate    = 'OPEN' | 'LIMITED' | 'BLOCKED'

const HEADLINE: Record<Runtime, Record<Gate, string>> = {
  LOCKDOWN: {
    BLOCKED: 'Market conditions require strict defensive posture — all entries restricted',
    LIMITED: 'Lockdown posture active with limited participation still blocked',
    OPEN:    'Market posture locked down — extreme conditions persist',
  },
  DEFENSIVE: {
    BLOCKED: 'Structural pressure keeps posture defensive as buy entries remain blocked',
    LIMITED: 'Defensive conditions persist with selective participation restrictions',
    OPEN:    'Defensive posture holds — conditions are watchful but not fully closed',
  },
  LIMITED: {
    BLOCKED: 'Participation constrained — buy activity blocked under current conditions',
    LIMITED: 'Mixed conditions keep participation selective and measured',
    OPEN:    'Limited posture with open gate — selective conditions remain in force',
  },
  NORMAL: {
    BLOCKED: 'Broadly stable conditions, though buy gate remains restricted',
    LIMITED: 'Normal conditions persist with selective entry restrictions in place',
    OPEN:    'Conditions support broader participation under normal posture',
  },
}

const ALERT_HEADLINE_PREFIX: Record<string, string> = {
  RUNTIME: 'Posture shift detected — ',
  GATE:    'Buy gate restricted — ',
  RISK:    'Risk pressure elevated — ',
}

// ── Summary templates ─────────────────────────────────────────────────────────

const SUMMARY: Record<Runtime, string> = {
  LOCKDOWN:  'Market conditions have reached extreme stress levels. Capital preservation is the current priority, with new risk-taking suspended until conditions stabilize.',
  DEFENSIVE: 'Current conditions remain defensive as structural pressure continues to constrain risk-taking. Participation is limited to high-conviction setups only.',
  LIMITED:   'Signals are mixed but participation remains selective rather than broadly open. Elevated risk management is still warranted.',
  NORMAL:    'Conditions have stabilized and support broader participation. Standard risk management applies, with no extreme restrictions in place.',
}

const SUMMARY_NOISY_SUFFIX = ' Reliability is reduced — signals carry less conviction than usual.'

// ── Posture lines ─────────────────────────────────────────────────────────────

const POSTURE_LINE: Record<Runtime, string> = {
  LOCKDOWN:  'Strict capital preservation is required. Avoid new long exposure until conditions normalize.',
  DEFENSIVE: 'Current posture favors capital preservation over aggressive entry.',
  LIMITED:   'Conditions support selective participation rather than broad exposure.',
  NORMAL:    'Standard risk management applies. Broader participation is supported under current conditions.',
}

// ── Watch items by state ──────────────────────────────────────────────────────

function buildWatchItems(
  runtime: Runtime,
  gate: Gate,
  transition?: TransitionViewPayload | null,
): string[] {
  const items: string[] = []

  if (gate !== 'OPEN') {
    items.push('Watch for easing in buy gate restrictions before re-engaging')
  }
  if (runtime === 'LOCKDOWN' || runtime === 'DEFENSIVE') {
    items.push('Watch whether rebound quality and breadth improve')
    items.push('Watch for persistence or resolution of structural pressure')
  } else if (runtime === 'LIMITED') {
    items.push('Watch whether conditions evolve toward broader participation')
    items.push('Monitor for consistency in breadth and momentum signals')
  } else {
    items.push('Monitor for any deterioration in current stable conditions')
    items.push('Watch for breadth leadership to confirm broader participation')
  }

  if (transition?.next_bias === 'TIGHTER') {
    items.push('Transition signals lean tighter — conditions may tighten further')
  } else if (transition?.next_bias === 'SOFTER') {
    items.push('Transition signals suggest conditions may soften soon')
  }

  return items.slice(0, 3)
}

// ── Key points ────────────────────────────────────────────────────────────────

function buildKeyPoints(
  runtime: Runtime,
  gate: Gate,
  reliability?: AnalyzerReliabilityPayload | null,
  drivers?: { label: string }[],
  dailyView?: DailySnapshotView | null,
): string[] {
  const points: string[] = []

  // 1. Runtime change or state
  const runtimeChange = dailyView?.changes.find(c => c.field === 'Runtime')
  if (runtimeChange) {
    points.push('Runtime moved from ' + runtimeChange.from + ' to ' + runtimeChange.to + ' today')
  } else {
    points.push('Runtime posture remains ' + runtime)
  }

  // 2. Gate (if not OPEN)
  if (gate !== 'OPEN') {
    const gateChange = dailyView?.changes.find(c => c.field === 'Buy Gate')
    if (gateChange) {
      points.push('Buy gate changed from ' + gateChange.from + ' to ' + gateChange.to)
    } else {
      points.push('Buy activity is ' + gate.toLowerCase() + ' under current conditions')
    }
  }

  // 3. Reliability or top driver
  if (points.length < 3) {
    if (reliability?.noise_flag) {
      points.push('Signal reliability is reduced — noisy conditions lower conviction')
    } else if (reliability?.instability_flag) {
      points.push('Regime instability detected — signals carry reduced confidence')
    } else if (reliability?.evidence_strength) {
      points.push('Evidence strength is ' + reliability.evidence_strength.toLowerCase() + ', signal agreement is ' + reliability.signal_agreement.toLowerCase())
    } else if (drivers && drivers.length > 0) {
      points.push('Top driver: ' + drivers[0].label)
    }
  }

  return points.slice(0, 3)
}

// ── Analog line ───────────────────────────────────────────────────────────────

function buildAnalogLine(
  runtime: Runtime,
  regime: string,
): string | undefined {
  if (regime === 'STRUCTURAL') {
    if (runtime === 'LOCKDOWN' || runtime === 'DEFENSIVE') {
      return 'Historical analogs suggest structural stress periods where rebounds remained fragile until breadth and policy conditions improved.'
    }
    return 'Structural regime conditions have historically required patience — broad re-entry preceded by multi-week stabilization.'
  }
  if (regime === 'EVENT') {
    return 'Event-driven conditions can resolve quickly, but historical precedent favors waiting for confirmation before increasing exposure.'
  }
  if (runtime === 'LOCKDOWN') {
    return 'Similar lockdown conditions in the past preceded extended recovery periods before conditions normalized.'
  }
  return undefined
}

// ── Outlook line ──────────────────────────────────────────────────────────────

function buildOutlookLine(
  runtime: Runtime,
  forward?: ForwardOutlookPayload | null,
  transition?: TransitionViewPayload | null,
): string | undefined {
  const bias = forward?.bias

  if (bias === 'DOWNSIDE' || runtime === 'LOCKDOWN') {
    return 'Near-term path remains tilted toward downside pressure, though this reflects current conditions rather than a fixed outcome.'
  }
  if (bias === 'UPSIDE' && runtime === 'NORMAL') {
    return 'Near-term outlook leans constructive, contingent on current stable conditions persisting.'
  }
  if (transition?.next_bias === 'SOFTER') {
    return 'Transition signals suggest conditions may ease in the near term, though confirmation is still needed.'
  }
  if (transition?.next_bias === 'TIGHTER') {
    return 'Conditions suggest a tighter near-term path unless current pressure begins to resolve.'
  }
  return 'Conditions suggest a range-bound path unless current restrictions begin to ease.'
}

// ── Closing lines ─────────────────────────────────────────────────────────────

const CLOSING: Record<Runtime, string> = {
  LOCKDOWN:  'This briefing reflects current conditions, not a guaranteed path. The system will update as conditions evolve.',
  DEFENSIVE: 'This briefing reflects current conditions and will be updated as the analyzer refreshes.',
  LIMITED:   'Conditions are monitored continuously. This brief will update with new market data.',
  NORMAL:    'The system remains posture-aware and will reflect changes as conditions evolve.',
}

// ── Main export ───────────────────────────────────────────────────────────────

const EMPTY: NarrativeViewPayload = {
  headline:    'Market brief unavailable',
  summary:     'Narrative brief unavailable until current analyzer data is ready.',
  key_points:  [],
  posture_line:'—',
  watch_items: [],
  closing_line:'The system will update as data becomes available.',
  has_data:    false,
  md_prompt: {
    briefing_title: '',
    regime:         '',
    runtime:        '',
    posture:        '',
    reliability:    '',
    top_drivers:    [],
    key_changes:    [],
    analog_context: '',
    forward_bias:   '',
    watch_items:    [],
  },
}

export function formatNarrativeView(input: NarrativeInput): NarrativeViewPayload {
  const { sa, reliability, alerts = [], dailyView, forward, transition } = input

  if (!sa) return EMPTY

  const runtime = (sa.runtime_mode ?? 'NORMAL') as Runtime
  const regime  = sa.market_regime ?? 'NORMAL'
  const gate    = (sa.policy_link?.buy_gate ?? 'OPEN') as Gate
  const drivers = sa.top_drivers ?? []

  // ── Headline ──
  const baseHeadline = HEADLINE[runtime]?.[gate] ?? HEADLINE.NORMAL.OPEN
  const highAlert    = alerts.find(a => a.severity === 'HIGH')
  const headline     = highAlert
    ? (ALERT_HEADLINE_PREFIX[highAlert.type] ?? '') + baseHeadline.charAt(0).toLowerCase() + baseHeadline.slice(1)
    : baseHeadline

  // ── Summary ──
  const noisySuffix = (reliability?.noise_flag || reliability?.instability_flag) ? SUMMARY_NOISY_SUFFIX : ''
  const summary     = (SUMMARY[runtime] ?? SUMMARY.NORMAL) + noisySuffix

  // ── Key points ──
  const key_points = buildKeyPoints(runtime, gate, reliability, drivers, dailyView)

  // ── Posture ──
  const posture_line = POSTURE_LINE[runtime] ?? POSTURE_LINE.NORMAL

  // ── Watch items ──
  const watch_items = buildWatchItems(runtime, gate, transition)

  // ── Analog ──
  const analog_line = buildAnalogLine(runtime, regime)

  // ── Outlook ──
  const outlook_line = buildOutlookLine(runtime, forward, transition)

  // ── Closing ──
  const closing_line = CLOSING[runtime] ?? CLOSING.NORMAL

  // ── MD prompt payload ──
  const forwardBias =
    forward?.bias ??
    (runtime === 'LOCKDOWN' || runtime === 'DEFENSIVE' ? 'DOWNSIDE' :
     runtime === 'NORMAL'                              ? 'UPSIDE'   : 'BALANCED')

  const reliabilityLabel =
    reliability ? reliability.confidence_level + ' confidence / ' + reliability.evidence_strength.toLowerCase() + ' evidence' : 'unknown'

  const md_prompt: MdPromptPayload = {
    briefing_title: headline,
    regime,
    runtime,
    posture:        sa.posture_label ?? runtime,
    reliability:    reliabilityLabel,
    top_drivers:    drivers.slice(0, 3).map(d => d.label),
    key_changes:    (dailyView?.changes ?? []).slice(0, 3).map(c => c.field + ': ' + c.from + ' -> ' + c.to),
    analog_context: analog_line ?? '',
    forward_bias:   forwardBias,
    watch_items,
  }

  return {
    headline,
    summary,
    key_points,
    posture_line,
    watch_items,
    analog_line,
    outlook_line,
    closing_line,
    md_prompt,
    has_data: true,
  }
}
