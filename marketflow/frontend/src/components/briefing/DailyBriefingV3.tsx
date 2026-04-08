'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { pickLang as pickUiLang, useContentLang, useUiLang } from '@/lib/useLangMode'
import { applyContentLangToDocument, persistContentLang } from '@/lib/uiLang'

// ?? Types ????????????????????????????????????????????????????????????????????
export type BriefingV3Section = {
  id: string
  title: string
  structural: string
  structural_ko?: string
  implication: string
  implication_ko?: string
  signal: 'bull' | 'caution' | 'bear' | 'neutral'
  color: string
}

export type BriefingV3RiskCheck = {
  triggered: boolean
  level: number
  mss: number
  zone: string
  message: string
  color: string
}

export type DailyBriefingV3Data = {
  generated_at: string
  data_date: string
  model: string
  tokens: { input: number; output: number; cost_usd: number }
  hook: string
  hook_ko?: string
  sections: BriefingV3Section[]
  risk_check: BriefingV3RiskCheck
  one_line: string
  one_line_ko?: string
}

type Lang = 'en' | 'ko'

type Props = {
  data: DailyBriefingV3Data | null
  initialContentLang?: Lang
}

// ?? Helpers ???????????????????????????????????????????????????????????????????
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      timeZone: 'America/New_York',
    })
  } catch { return iso }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York', hour12: false,
    }) + ' ET'
  } catch { return iso }
}

function pick(en: string, ko: string | undefined, lang: Lang): string {
  if (lang === 'ko' && ko) return ko
  return en
}

const MONO_FONT = 'var(--font-terminal-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const TYPE_SCALE = 0.8
const rem = (value: number) => `${Number((value * TYPE_SCALE).toFixed(3))}rem`

const BRIEF_UI_TEXT = {
  dailyBriefing: { ko: '데일리 브리핑', en: 'DAILY BRIEFING' },
  generatedLabel: { ko: '생성', en: 'Generated' },
  noBriefing: { ko: '아직 브리핑이 없습니다.', en: 'No briefing available yet.' },
  generateBriefing: { ko: '브리핑 생성', en: 'GENERATE BRIEFING' },
  generating: { ko: '생성 중...', en: 'GENERATING...' },
  refresh: { ko: '새로고침', en: 'REFRESH' },
  forceRegen: { ko: '강제 재생성', en: 'FORCE REGEN' },
  marketHook: { ko: '마켓 훅', en: 'MARKET HOOK' },
  structural: { ko: 'A · 구조', en: 'A · STRUCTURAL' },
  implication: { ko: 'B · 해석', en: 'B · IMPLICATION' },
  noStructural: { ko: '구조 설명이 없습니다.', en: 'No structural text.' },
  noImplication: { ko: '해석 문장이 없습니다.', en: 'No implication text.' },
  riskCheck: { ko: '리스크 체크', en: 'RISK CHECK' },
  oneLine: { ko: '오늘의 한줄 요약', en: 'TODAY ONE-LINER' },
} as const

function SignalBadge({ signal, uiLang }: { signal: BriefingV3Section['signal']; uiLang: Lang }) {
  const map = {
    bull:    { label: { ko: '강세', en: 'BULL' }, bg: 'rgba(34,197,94,0.12)',   text: '#22c55e' },
    caution: { label: { ko: '주의', en: 'CAUTION' }, bg: 'rgba(245,158,11,0.12)',  text: '#f59e0b' },
    bear:    { label: { ko: '약세', en: 'BEAR' }, bg: 'rgba(239,68,68,0.12)',   text: '#ef4444' },
    neutral: { label: { ko: '중립', en: 'NEUTRAL' }, bg: 'rgba(100,116,139,0.12)', text: '#94a3b8' },
  }
  const { label, bg, text } = map[signal] ?? map.neutral
  return (
    <span style={{
      background: bg, color: text, border: `1px solid ${text}33`,
      borderRadius: 4, padding: '4px 10px', fontSize: rem(0.77),
      fontFamily: MONO_FONT,
      fontWeight: 700, letterSpacing: '0.12em',
    }}>
      {pickUiLang(uiLang, label.ko, label.en)}
    </span>
  )
}

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  const btn = (l: Lang, label: string) => (
    <button
      key={l}
      onClick={() => onChange(l)}
      style={{
        background: lang === l ? '#d7ff3f' : 'transparent',
        color: lang === l ? '#111827' : '#64748b',
        border: `1px solid ${lang === l ? '#d7ff3f' : 'rgba(148,163,184,0.2)'}`,
        borderRadius: l === 'en' ? '5px 0 0 5px' : '0 5px 5px 0',
        padding: '6px 12px',
        fontSize: rem(0.8),
        fontFamily: MONO_FONT,
        fontWeight: 700,
        letterSpacing: '0.08em',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
  return (
    <div style={{ display: 'flex' }}>
      {btn('en', 'EN')}
      {btn('ko', 'KR')}
    </div>
  )
}

function SectionCard({
  section,
  index,
  contentLang,
  uiLang,
}: {
  section: BriefingV3Section
  index: number
  contentLang: Lang
  uiLang: Lang
}) {
  const structural  = pick(section.structural,  section.structural_ko,  contentLang)
  const implication = pick(section.implication, section.implication_ko, contentLang)
  const bodyFontSize = rem(contentLang === 'ko' ? 0.97 : 1.06)
  const bodyLineHeight = contentLang === 'ko' ? 1.68 : 1.74

  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(10,13,20,0.96) 0%, rgba(7,9,15,0.98) 100%)',
      border: '1px solid rgba(148,163,184,0.08)',
      borderLeft: `3px solid ${section.color}`,
      borderRadius: '0 8px 8px 0',
      padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontFamily: MONO_FONT,
          fontSize: rem(0.81), color: section.color, fontWeight: 700,
          letterSpacing: '0.06em', opacity: 0.85,
        }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <span style={{
          fontSize: rem(1.03), fontWeight: 700, color: '#e2e8f0',
          letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>
          {section.title}
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <SignalBadge signal={section.signal} uiLang={uiLang} />
        </div>
      </div>

      <div>
        <div style={{
          fontSize: rem(0.83),
          fontFamily: MONO_FONT,
          color: '#94a3b8', letterSpacing: '0.14em', textTransform: 'uppercase',
          marginBottom: 6, fontWeight: 600, fontStyle: 'italic',
        }}>
          {pick(BRIEF_UI_TEXT.structural.en, BRIEF_UI_TEXT.structural.ko, contentLang)}
        </div>
        <p style={{ margin: 0, color: '#cbd5e1', fontSize: bodyFontSize, lineHeight: bodyLineHeight }}>
          {structural || <span style={{ color: '#475569' }}>{pick(BRIEF_UI_TEXT.noStructural.en, BRIEF_UI_TEXT.noStructural.ko, contentLang)}</span>}
        </p>
      </div>

      <div>
        <div style={{
          fontSize: rem(0.83),
          fontFamily: MONO_FONT,
          color: section.color, letterSpacing: '0.14em', textTransform: 'uppercase',
          marginBottom: 6, fontWeight: 600, fontStyle: 'italic',
        }}>
          {pick(BRIEF_UI_TEXT.implication.en, BRIEF_UI_TEXT.implication.ko, contentLang)}
        </div>
        <p style={{ margin: 0, color: '#94a3b8', fontSize: bodyFontSize, lineHeight: bodyLineHeight }}>
          {implication || <span style={{ color: '#475569' }}>{pick(BRIEF_UI_TEXT.noImplication.en, BRIEF_UI_TEXT.noImplication.ko, contentLang)}</span>}
        </p>
      </div>
    </div>
  )
}

// ?? Main ?????????????????????????????????????????????????????????????????????
export default function DailyBriefingV3({ data, initialContentLang = 'en' }: Props) {
  const uiLang = useUiLang()
  const contentLang = useContentLang(initialContentLang)
  const [generating, setGenerating] = useState(false)
  const [genStatus,  setGenStatus]  = useState<string | null>(null)
  const [lang,       setLang]       = useState<Lang>(contentLang)
  const router = useRouter()

  useEffect(() => {
    setLang(contentLang)
  }, [contentLang])

  const handleGenerate = useCallback(async (force: boolean, genLang?: Lang) => {
    setGenerating(true); setGenStatus(null)
    try {
      const res  = await fetch('/api/daily-briefing-v3', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force, lang: genLang ?? 'ko' }),
      })
      const json = await res.json()
      if (json.ok) {
        const newDate = json?.data?.data_date ? String(json.data.data_date) : null
        setGenStatus(
          newDate
            ? pickUiLang(uiLang, `업데이트 ${json.elapsed}초 · ${newDate}`, `Updated in ${json.elapsed}s · ${newDate}`)
            : pickUiLang(uiLang, `업데이트 ${json.elapsed}초`, `Updated in ${json.elapsed}s`)
        )
        router.refresh()
      } else {
        setGenStatus(pickUiLang(uiLang, `오류: ${json.error}`, `Error: ${json.error}`))
      }
    } catch (err) {
      setGenStatus(pickUiLang(uiLang, `실패: ${String(err)}`, `Failed: ${String(err)}`))
    } finally {
      setGenerating(false)
    }
  }, [router, uiLang])

  const onContentLangChange = useCallback((next: Lang) => {
    setLang(next)
    persistContentLang(next)
    applyContentLangToDocument(next)
    // If switching to EN and no English content exists yet, auto-generate EN
    if (next === 'en' && data && !data.hook && !generating) {
      handleGenerate(false, 'en')
    }
  }, [data, generating, handleGenerate])

  if (!data) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 20, padding: '40px 24px' }}>
        <p style={{ color: '#64748b', fontSize: rem(0.88) }}>{pickUiLang(uiLang, BRIEF_UI_TEXT.noBriefing.ko, BRIEF_UI_TEXT.noBriefing.en)}</p>
        <button onClick={() => handleGenerate(true)} disabled={generating} style={{
          background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)',
          color: '#60a5fa', borderRadius: 6, padding: '8px 20px', fontSize: rem(0.78),
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', cursor: 'pointer',
        }}>
          {generating
            ? pickUiLang(uiLang, BRIEF_UI_TEXT.generating.ko, BRIEF_UI_TEXT.generating.en)
            : pickUiLang(uiLang, BRIEF_UI_TEXT.generateBriefing.ko, BRIEF_UI_TEXT.generateBriefing.en)}
        </button>
        {genStatus && <p style={{ color: '#94a3b8', fontSize: rem(0.78) }}>{genStatus}</p>}
      </div>
    )
  }

  const rc = data.risk_check
  const summaryLine = pick(data.one_line, data.one_line_ko, lang).trim()
  const hookLine = pick(data.hook, data.hook_ko, lang).trim()
  const heroLabel = lang === 'en' ? BRIEF_UI_TEXT.marketHook.en : BRIEF_UI_TEXT.oneLine.ko
  const heroLine = hookLine || summaryLine

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '28px 24px 48px',
      display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ?? Header ??????????????????????????????????????????????????????????? */}
      <div style={{ display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{
            fontFamily: MONO_FONT,
            fontSize: rem(1.58), color: '#00b8ff', fontWeight: 800,
            letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6,
          }}>
            <span style={{ color: '#00b8ff' }}>{pickUiLang(uiLang, BRIEF_UI_TEXT.dailyBriefing.ko, BRIEF_UI_TEXT.dailyBriefing.en)}</span>
            <span style={{ color: '#d7ff3f' }}> | {data.data_date}</span>
          </div>
          <div style={{
            fontFamily: MONO_FONT,
            fontSize: rem(1.04), color: '#94a3b8',
          }}>
            {pickUiLang(uiLang, BRIEF_UI_TEXT.generatedLabel.ko, BRIEF_UI_TEXT.generatedLabel.en)} {formatDate(data.generated_at)} | {formatTime(data.generated_at)} |{' '}
            <span style={{ color: '#cbd5e1' }}>{data.model}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <LangToggle lang={lang} onChange={onContentLangChange} />
          {genStatus && <span style={{ fontSize: rem(0.88), color: '#64748b' }}>{genStatus}</span>}
          <button onClick={() => handleGenerate(false, lang)} disabled={generating} style={{
            background: 'transparent', border: '1px solid rgba(148,163,184,0.15)',
            color: '#475569', borderRadius: 5, padding: '7px 14px', fontSize: rem(0.8),
            fontFamily: MONO_FONT,
            cursor: generating ? 'not-allowed' : 'pointer', letterSpacing: '0.08em',
          }}>
            {generating
              ? pickUiLang(uiLang, BRIEF_UI_TEXT.generating.ko, BRIEF_UI_TEXT.generating.en)
              : pickUiLang(uiLang, BRIEF_UI_TEXT.refresh.ko, BRIEF_UI_TEXT.refresh.en)}
          </button>
          <button onClick={() => handleGenerate(true, lang)} disabled={generating} style={{
            background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)',
            color: '#3b82f6', borderRadius: 5, padding: '7px 14px', fontSize: rem(0.8),
            fontFamily: MONO_FONT,
            cursor: generating ? 'not-allowed' : 'pointer', letterSpacing: '0.08em',
          }}>
            {pickUiLang(uiLang, BRIEF_UI_TEXT.forceRegen.ko, BRIEF_UI_TEXT.forceRegen.en)}
          </button>
        </div>
      </div>

      {/* ?? Hook ????????????????????????????????????????????????????????????? */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(10,15,30,0.95) 100%)',
        border: '1px solid rgba(148,163,184,0.1)', borderRadius: 10, padding: '22px 24px',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1,
          background: 'linear-gradient(90deg, transparent 0%, rgba(148,163,184,0.2) 50%, transparent 100%)',
        }} />
        <div style={{
          fontFamily: MONO_FONT,
          fontSize: rem(0.83), color: '#94a3b8', letterSpacing: '0.16em',
          textTransform: 'uppercase', marginBottom: 12,
        }}>
          {heroLabel}
        </div>
        <p style={{ margin: 0, fontSize: rem(1.33), lineHeight: 1.62, color: '#e2e8f0', fontWeight: 600 }}>
          {heroLine}
        </p>
      </div>

      {/* ?? Sections ????????????????????????????????????????????????????????? */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: 12 }}>
        {data.sections.map((sec, i) => (
          <SectionCard key={sec.id} section={sec} index={i} contentLang={lang} uiLang={uiLang} />
        ))}
      </div>

      {/* ?? Risk Check ??????????????????????????????????????????????????????? */}
      <div style={{
        background: rc.triggered
          ? `linear-gradient(135deg, ${rc.color}0d 0%, ${rc.color}06 100%)`
          : 'rgba(10,13,20,0.7)',
        border: `1px solid ${rc.triggered ? rc.color + '40' : 'rgba(148,163,184,0.08)'}`,
        borderRadius: 8, padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'flex-start',
      }}>
        <div style={{
          flexShrink: 0, width: 36, height: 36, borderRadius: '50%',
          background: rc.triggered ? rc.color + '1a' : 'rgba(34,197,94,0.1)',
          border: `1.5px solid ${rc.triggered ? rc.color + '60' : '#22c55e40'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: MONO_FONT,
          fontSize: rem(0.81), fontWeight: 700,
          color: rc.triggered ? rc.color : '#4ade80',
        }}>
          {rc.triggered ? `L${rc.level}` : 'OK'}
        </div>
        <div style={{ flex: 1 }}>
        <div style={{
          fontFamily: MONO_FONT,
          fontSize: rem(0.74), color: rc.triggered ? rc.color : '#4ade80',
          letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6,
        }}>
            {pickUiLang(uiLang, BRIEF_UI_TEXT.riskCheck.ko, BRIEF_UI_TEXT.riskCheck.en)} | MSS {rc.mss}
          </div>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: rem(0.95), lineHeight: 1.62 }}>
            {rc.message}
          </p>
        </div>
      </div>

      {/* ?? One Line ????????????????????????????????????????????????????????? */}
      <div style={{ borderTop: '1px solid rgba(148,163,184,0.06)', paddingTop: 20, textAlign: 'center' }}>
        <div style={{
          fontFamily: MONO_FONT,
          fontSize: rem(0.7), color: '#64748b', letterSpacing: '0.18em',
          textTransform: 'uppercase', marginBottom: 10,
        }}>
          {pick(BRIEF_UI_TEXT.oneLine.en, BRIEF_UI_TEXT.oneLine.ko, lang)}
        </div>
        <p style={{ margin: '0 auto', maxWidth: 640, color: '#64748b',
          fontSize: rem(0.97), lineHeight: 1.62, fontStyle: 'italic' }}>
          {pick(data.one_line, data.one_line_ko, lang)}
        </p>
      </div>

      {/* ?? Footer ??????????????????????????????????????????????????????????? */}
      <div style={{ borderTop: '1px solid rgba(148,163,184,0.04)', paddingTop: 12,
        display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{
          fontFamily: MONO_FONT,
          fontSize: rem(0.66), color: '#475569', letterSpacing: '0.08em',
        }}>
          {data.tokens.input + data.tokens.output} tokens | ${data.tokens.cost_usd.toFixed(5)}
        </span>
      </div>
    </div>
  )
}

