// ── Language mode system ─────────────────────────────────────────────────────
// Lightweight bilingual foundation — no i18n library, no external dependencies.
// Default: "both" (KO primary, EN secondary stacked).
// Future toggle: set DEFAULT_LANG to "ko" or "en" to switch.

export type LangMode = 'ko' | 'en' | 'both'

export const DEFAULT_LANG: LangMode = 'both'

/** A bilingual text pair */
export type BiText = { ko: string; en: string }
