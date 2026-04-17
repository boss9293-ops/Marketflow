'use client'

import { useRouter } from 'next/navigation'
import {
  applyContentLangToDocument,
  persistContentLang,
  readStoredContentLang,
  type UiLang,
} from '@/lib/uiLang'

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

type Props = {
  value: UiLang
  /** Optional: override the default persist+refresh behaviour (e.g. for pure client pages) */
  onChange?: (next: UiLang) => void
}

export default function ContentLangToggle({ value, onChange }: Props) {
  const router = useRouter()

  const handle = (next: UiLang) => {
    if (onChange) {
      onChange(next)
      return
    }
    persistContentLang(next)
    applyContentLangToDocument(next)
    router.refresh()
  }

  const items: { l: UiLang; flag: string; label: string }[] = [
    { l: 'ko', flag: '\u{1F1F0}\u{1F1F7}', label: 'KR' },
    { l: 'en', flag: '\u{1F1FA}\u{1F1F8}', label: 'EN' },
  ]

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      background: 'rgba(8,12,22,0.85)',
      border: '1px solid rgba(56,189,248,0.22)',
      borderRadius: 7,
      overflow: 'hidden',
      fontFamily: MONO,
      boxShadow: '0 0 8px rgba(56,189,248,0.06)',
    }}>
      {items.map(({ l, flag, label }, idx) => {
        const active = value === l
        return (
          <button
            key={l}
            onClick={() => handle(l)}
            title={l === 'ko' ? '한국어 본문' : 'English content'}
            style={{
              background: active ? 'rgba(56,189,248,0.13)' : 'transparent',
              color: active ? '#38bdf8' : '#475569',
              border: 'none',
              borderRight: idx === 0 ? '1px solid rgba(56,189,248,0.15)' : 'none',
              padding: '5px 13px',
              fontSize: '0.75rem',
              fontFamily: MONO,
              fontWeight: 700,
              letterSpacing: '0.1em',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
              transition: 'background 0.12s, color 0.12s',
              minWidth: 54, justifyContent: 'center',
              outline: 'none',
            }}
          >
            <span style={{ fontSize: '1em', lineHeight: 1 }}>{flag}</span>
            <span>{label}</span>
            {active && (
              <span style={{
                width: 4, height: 4, borderRadius: '50%',
                background: '#38bdf8', flexShrink: 0,
                boxShadow: '0 0 4px #38bdf8',
              }} />
            )}
          </button>
        )
      })}
    </div>
  )
}
