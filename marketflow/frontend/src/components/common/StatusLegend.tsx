'use client'
import { useState } from 'react'
import { STATUS_GLOSSARY } from '../../lib/uxCopy'

// =============================================================================
// StatusLegend  (WO-SA19)
// Collapsible compact glossary strip. Closed by default.
// =============================================================================

export default function StatusLegend() {
  const [open, setOpen] = useState(false)

  return (
    <div style={{
      background:   '#070B10',
      border:       '1px solid rgba(148,163,184,0.07)',
      borderRadius: 10,
    }}>
      {/* Toggle row */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width:        '100%',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'space-between',
          background:   'transparent',
          border:       'none',
          cursor:       'pointer',
          padding:      '7px 12px',
          gap:          8,
        }}
      >
        <span style={{ color: '#4B5563', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.05em' }}>
          STATUS GLOSSARY
        </span>
        <span style={{ color: '#374151', fontSize: '0.60rem' }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Legend content */}
      {open && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.04)',
          padding:   '8px 12px 10px',
          display:   'flex',
          gap:       '1.2rem',
          flexWrap:  'wrap',
        }}>
          {STATUS_GLOSSARY.map(section => (
            <div key={section.section} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 130 }}>
              <span style={{ color: '#374151', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 1 }}>
                {section.section.toUpperCase()}
              </span>
              {section.items.map(item => (
                <div key={item.term} style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
                  <span style={{ color: '#6B7280', fontSize: '0.65rem', fontWeight: 700, minWidth: 68 }}>{item.term}</span>
                  <span style={{ color: '#374151', fontSize: '0.63rem', lineHeight: 1.35 }}>{item.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
