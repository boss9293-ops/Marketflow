/**
 * WO53 — VR Tone & Text Quality Utility
 *
 * Rules enforced here:
 *   - Max 2 sentences per block
 *   - No trading language (buy/sell/entry/exit/long/short/position/target)
 *   - No hedge language (might/could/appears to/suggests that/possibly)
 *   - No hype language (massive/explosive/huge opportunity/strong upside)
 *   - Tone: calm · precise · institutional · explainable · non-trading
 */

// ── Banned word list ────────────────────────────────────────────────────────

export const BANNED_WORDS: string[] = [
  // Trading
  'buy', 'sell', 'entry', 'exit', 'long', 'short', 'position', 'target', 'trade signal',
  // Hedge
  'might', 'could', 'appears to', 'suggests that', 'possibly',
  // Hype
  'massive', 'explosive', 'huge opportunity', 'strong upside',
]

/** Returns true if the text contains banned language. */
export function hasBannedLanguage(text: string): boolean {
  const lower = text.toLowerCase()
  return BANNED_WORDS.some(w => lower.includes(w))
}

/** Strips banned words from text (for runtime sanitization). */
export function stripBannedWords(text: string): string {
  let out = text
  for (const word of BANNED_WORDS) {
    const re = new RegExp('\\b' + word.replace(/\s+/g, '\\s+') + '\\b', 'gi')
    out = out.replace(re, '')
  }
  return out.replace(/\s{2,}/g, ' ').trim()
}

// ── VR State Tone Map ───────────────────────────────────────────────────────

export type VrTone = 'defensive' | 'cautious' | 'stable' | 'transitional'

export const VR_STATE_TONE: Record<string, VrTone> = {
  ARMED:     'defensive',
  EXIT_DONE: 'transitional',
  REENTRY:   'transitional',
  CAUTION:   'cautious',
  INACTIVE:  'stable',
}

// ── Tone keyword sets ───────────────────────────────────────────────────────

interface ToneBlock {
  stance:    string  // Sentence 1 — system stance
  behavior:  string  // Sentence 2 — behavior implication
}

export const VR_TONE_BLOCKS: Record<VrTone, ToneBlock> = {
  defensive: {
    stance:   'VR is maintaining a defensive posture.',
    behavior: 'The system prioritizes drawdown control over participation.',
  },
  cautious: {
    stance:   'VR is holding a cautious posture.',
    behavior: 'The system is monitoring for confirmation before adjusting.',
  },
  stable: {
    stance:   'VR is in a stable posture.',
    behavior: 'The system allows normal participation within defined limits.',
  },
  transitional: {
    stance:   'VR is in a transitional posture.',
    behavior: 'The system is adjusting as new data confirms a regime change.',
  },
}

/**
 * Returns a 2-sentence VR explanation for a given engine state.
 * Follows the WO53 VR template: [stance] [behavior]
 */
export function getVrExplanation(vrState: string): string {
  const tone  = VR_STATE_TONE[vrState] ?? 'cautious'
  const block = VR_TONE_BLOCKS[tone]
  return `${block.stance} ${block.behavior}`
}

// ── Scenario Text Utilities ─────────────────────────────────────────────────

/**
 * Formats a scenario description using the standard 2-sentence template:
 * [What is happening]. [Why it matters].
 */
export function formatScenarioText(what: string, why: string): string {
  const s1 = what.trim().replace(/\.$/, '')
  const s2 = why.trim().replace(/\.$/, '')
  return `${s1}. ${s2}.`
}

/**
 * Truncates text to maxChars, breaking at the last sentence boundary.
 * Default limit: 200 characters.
 */
export function truncateText(text: string, maxChars = 200): string {
  if (text.length <= maxChars) return text
  const cut = text.lastIndexOf('.', maxChars)
  return cut > 0 ? text.slice(0, cut + 1) : text.slice(0, maxChars) + '…'
}
