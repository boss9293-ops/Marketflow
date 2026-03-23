'use client'

import { useState, type KeyboardEvent, type CSSProperties } from 'react'

const C = {
  bgCard:      'rgba(255,255,255,0.03)',
  border:      '1px solid rgba(255,255,255,0.08)',
  borderFocus: '1px solid rgba(147,197,253,0.35)',
  radiusSm:    12,
  textPrimary: '#f8fafc',
  textSub:     '#cbd5e1',
  textMuted:   '#94a3b8',
  textDim:     '#64748b',
  blue:        '#93c5fd',
}

interface QueryBarProps {
  onSubmit:  (query: string) => void
  loading:   boolean
  lastQuery?: string
}

export default function QueryBar({ onSubmit, loading, lastQuery }: QueryBarProps) {
  const [value, setValue] = useState(lastQuery ?? '')
  const [focused, setFocused] = useState(false)

  function submit() {
    const q = value.trim()
    if (q.length >= 5 && !loading) onSubmit(q)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
  }

  const canSubmit = value.trim().length >= 5 && !loading

  return (
    <div style={{
      background: C.bgCard,
      border: focused ? C.borderFocus : C.border,
      borderRadius: C.radiusSm,
      padding: '0.75rem 0.9rem',
      transition: 'border-color 0.2s',
    }}>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={loading}
        placeholder="Ask a research question about current market conditions, risk factors, or macro context…"
        rows={2}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontSize: '0.92rem',
          color: C.textSub,
          lineHeight: 1.6,
          fontFamily: 'inherit',
        } as CSSProperties}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div style={{ fontSize: '0.7rem', color: C.textDim }}>
          {value.trim().length > 0
            ? `${value.trim().length} chars · Ctrl+Enter to submit`
            : 'Enter a research question — min 5 characters'
          }
        </div>
        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{
            fontSize: '0.84rem', fontWeight: 700,
            color:      canSubmit ? C.textSub  : C.textDim,
            background: canSubmit ? 'rgba(147,197,253,0.08)' : 'rgba(255,255,255,0.02)',
            border:     `1px solid rgba(147,197,253,${canSubmit ? '0.25' : '0.08'})`,
            borderRadius: 9, padding: '0.45rem 1.1rem',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s', whiteSpace: 'nowrap',
          } as CSSProperties}
        >
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>
    </div>
  )
}
