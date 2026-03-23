'use client'
import { useState, useRef } from 'react'
import type { TooltipKey } from '../../lib/uxCopy'
import { TOOLTIP } from '../../lib/uxCopy'

// =============================================================================
// InfoTooltip  (WO-SA19)
// Hover tooltip for key terms. 'use client' required for hover state.
// =============================================================================

interface Props {
  term:      TooltipKey
  children?: React.ReactNode   // the annotated label/badge
  placement?: 'top' | 'bottom'
}

export default function InfoTooltip({ term, children, placement = 'top' }: Props) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const text = TOOLTIP[term]

  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'default' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {/* info dot */}
      <span style={{
        width: 13, height: 13, borderRadius: '50%',
        background: 'rgba(156,163,175,0.12)', border: '1px solid rgba(156,163,175,0.25)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: '#6B7280', fontSize: '0.55rem', fontWeight: 800, flexShrink: 0,
        lineHeight: 1, userSelect: 'none',
      }}>?</span>

      {/* tooltip bubble */}
      {visible && (
        <span style={{
          position:     'absolute',
          [placement === 'top' ? 'bottom' : 'top']: 'calc(100% + 6px)',
          left:         0,
          zIndex:       9999,
          background:   '#1C2333',
          border:       '1px solid rgba(148,163,184,0.15)',
          borderRadius: 8,
          padding:      '7px 10px',
          width:        220,
          color:        '#CBD5E1',
          fontSize:     '0.67rem',
          lineHeight:   1.5,
          fontWeight:   400,
          whiteSpace:   'normal',
          pointerEvents:'none',
          boxShadow:    '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}
