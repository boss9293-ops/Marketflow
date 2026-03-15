// ── Bilingual text registry ───────────────────────────────────────────────────
// All user-visible static strings live here.
// Components import from this file — no hardcoded strings inside JSX.

import type { BiText } from './lang'

// ── Section / card titles ─────────────────────────────────────────────────────

export const SECTION_TITLES = {
  // Column-level labels
  structure:      { ko: '시장 구조',    en: 'Market Structure'      } satisfies BiText,
  risk:           { ko: '리스크',       en: 'Risk'                  } satisfies BiText,
  // StructurePanel cards
  regimeGauge:    { ko: '레짐 게이지',  en: 'Regime Gauge'          } satisfies BiText,
  breadth:        { ko: '추세 · 폭',    en: 'Breadth & Sentiment'   } satisfies BiText,
  sectorRotation: { ko: '섹터 순환',    en: 'Sector Rotation'       } satisfies BiText,
  // RiskPanel cards
  tailRisk:       { ko: '꼬리 리스크',  en: 'Tail Risk Thermometer' } satisfies BiText,
  volatility:     { ko: '변동성 구조',  en: 'Volatility Structure'  } satisfies BiText,
  crashWeather:   { ko: '충격 날씨',    en: 'Crash Weather'         } satisfies BiText,
  // ExposureGuidance
  exposure:       { ko: '노출 가이드',  en: 'Exposure Guidance'     } satisfies BiText,
}

// ── ExposureGuidance deviation labels ─────────────────────────────────────────

export const EXPOSURE_TEXT = {
  overweight:      { ko: '과다 노출',             en: 'Overweight'                           } satisfies BiText,
  underweight:     { ko: '부족 노출',             en: 'Underweight'                          } satisfies BiText,
  withinBand:      { ko: '목표 범위 내',           en: 'Within target band'                   } satisfies BiText,
  connectHoldings: { ko: '보유 종목 연결 후 추적 가능', en: 'Connect holdings to track live exposure' } satisfies BiText,
}
