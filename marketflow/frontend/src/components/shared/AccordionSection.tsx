'use client'

import { ReactNode, useEffect, useId, useState } from 'react'

interface AccordionSectionProps {
  /** Stable id for localStorage state persistence */
  storageKey:   string
  header:       ReactNode
  /** Compact summary chips shown in header when collapsed */
  chips?:       { label: string; value: string; color?: string }[]
  children:     ReactNode
  defaultOpen?: boolean
  accentColor?: string
}

/**
 * Collapsible section with CSS height-transition and localStorage persistence.
 * Header always visible; body expands/collapses on click.
 */
export default function AccordionSection({
  storageKey,
  header,
  chips,
  children,
  defaultOpen = false,
  accentColor = '#2563EB',
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const innerId = useId()

  // Restore state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('accordion_' + storageKey)
      if (saved !== null) setOpen(saved === '1')
    } catch {
      // localStorage unavailable (SSR / private browsing)
    }
  }, [storageKey])

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem('accordion_' + storageKey, next ? '1' : '0')
      } catch {}
      return next
    })
  }

  return (
    <section
      style={{
        background: '#070B10',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      {/* ── Header (always visible, clickable) ── */}
      <button
        onClick={toggle}
        aria-expanded={open}
        aria-controls={innerId}
        style={{
          width: '100%',
          padding: '0.75rem 0.85rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          textAlign: 'left',
        }}
      >
        <span style={{ width: 4, height: 24, borderRadius: 4, background: accentColor, flexShrink: 0 }} />

        {/* Header content */}
        <div style={{ flex: 1, minWidth: 0 }}>{header}</div>

        {/* Chip row (visible when closed) */}
        {!open && chips && chips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
            {chips.map((c) => (
              <span
                key={c.label}
                style={{
                  borderRadius: 999,
                  border: '1px solid rgba(148,163,184,0.24)',
                  background: 'rgba(255,255,255,0.02)',
                  color: c.color || '#D8E6F5',
                  padding: '2px 8px',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}: {c.value}
              </span>
            ))}
          </div>
        )}

        {/* Arrow */}
        <span
          style={{
            color: '#94A3B8',
            fontSize: '0.8rem',
            transition: 'transform 0.25s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            flexShrink: 0,
            marginLeft: open ? 'auto' : 4,
          }}
        >
          ▼
        </span>
      </button>

      {/* ── Body (animated collapse) ── */}
      <div
        id={innerId}
        style={{
          overflow: 'hidden',
          maxHeight: open ? '4000px' : '0px',
          transition: open
            ? 'max-height 0.45s cubic-bezier(0.4,0,0.2,1)'
            : 'max-height 0.3s cubic-bezier(0.4,0,0.2,1)',
          borderTop: open ? '1px solid rgba(255,255,255,0.05)' : 'none',
        }}
      >
        <div style={{ padding: '0.8rem 0.85rem 0.9rem' }}>
          {children}
        </div>
      </div>
    </section>
  )
}
