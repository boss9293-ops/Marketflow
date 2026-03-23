'use client'

import { useState } from 'react'
import { formatVrTimeline, buildSampleTimeline, type VrTimelineRow } from '../../lib/formatVrTimeline'
import VrTimelineRowComponent from './VrTimelineRow'
import EmptyStateCard from '../common/EmptyStateCard'
import { EMPTY_STATE } from '../../lib/uxCopy'

// =============================================================================
// VrTimelinePanel  (WO-SA13)
//
// Container: VR execution timeline with mode transitions + block streak tracking
// Shows state history: t-N → ... → t-1 → t
// =============================================================================

interface Props {
  rows?:    VrTimelineRow[] | null;
  maxRows?: number;
  useSampleData?: boolean;   // dev mode: show sample data when no real rows
}

export default function VrTimelinePanel({ rows, maxRows = 100, useSampleData = false }: Props) {
  const [showReasons, setShowReasons]   = useState(false)
  const [showAll,     setShowAll]       = useState(false)

  const rawRows = (rows && rows.length > 0)
    ? rows
    : (useSampleData ? buildSampleTimeline() : [])

  const formatted = formatVrTimeline(rawRows, maxRows)

  // Count stats
  const transitions = formatted.filter(r => r.is_transition).length
  const blocked     = formatted.filter(r => r.decision_tone === 'red').length
  const partials    = formatted.filter(r => r.decision_tone === 'amber').length
  const executed    = formatted.filter(r => r.decision_tone === 'positive').length

  // Display limit
  const displayRows = showAll ? formatted : formatted.slice(-20)
  const isEmpty = formatted.length === 0 && !useSampleData

  return (
    <div style={{
      background:    '#0A0E14',
      border:        '1px solid rgba(148,163,184,0.09)',
      borderRadius:  14,
      padding:       '0.85rem',
      display:       'flex',
      flexDirection: 'column',
      gap:           '0.75rem',
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 4, height: 22, borderRadius: 4, background: '#6366F1', flexShrink: 0 }} />
          <span style={{ color: '#F8FAFC', fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.04em' }}>
            VR Execution Timeline
          </span>
          <span style={{ color: '#6B7280', fontSize: '0.70rem' }}>· Policy history</span>
        </div>

        {/* Toggle controls */}
        <div style={{ display: 'flex', gap: 6 }}>
          <ToggleButton active={showReasons} onClick={() => setShowReasons(v => !v)} label="Reasons" />
          {formatted.length > 20 && (
            <ToggleButton active={showAll} onClick={() => setShowAll(v => !v)}
              label={showAll ? `Show less` : `Show all (${formatted.length})`} />
          )}
        </div>
      </div>

      {/* ── Context intro (SA16/SA19) ── */}
      <div style={{ color: '#374151', fontSize: '0.63rem', lineHeight: 1.4 }}>
        Timeline shows how analyzer posture shifts affected VR execution over time.
      </div>
      {/* Sample data notice (SA19) */}
      {rawRows === buildSampleTimeline() && (
        <div style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.12)', borderRadius: 6, padding: '4px 10px' }}>
          <span style={{ color: '#FBBF24', fontSize: '0.60rem' }}>Showing sample data — live history loads after analyzer runs.</span>
        </div>
      )}

      {/* ── Empty state (SA19) ── */}
      {isEmpty && (
        <EmptyStateCard
          title={EMPTY_STATE.VR_TIMELINE.title}
          detail={EMPTY_STATE.VR_TIMELINE.detail}
        />
      )}

      {/* ── Stats strip ── */}
      {formatted.length > 0 && (
        <div style={{
          display:    'flex',
          gap:        6,
          flexWrap:   'wrap',
          background: 'rgba(255,255,255,0.025)',
          border:     '1px solid rgba(255,255,255,0.05)',
          borderRadius: 8,
          padding:    '5px 10px',
        }}>
          <StatChip label="Rows"        value={formatted.length} color="#9CA3AF" />
          <StatChip label="Transitions" value={transitions}       color="#FBBF24" />
          <StatChip label="Blocked"     value={blocked}           color="#EF4444" />
          <StatChip label="Partial"     value={partials}          color="#F59E0B" />
          <StatChip label="Executed"    value={executed}          color="#22C55E" />
        </div>
      )}

      {/* ── Legend ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <LegendItem color="#FBBF24" label="Mode transition" />
        <LegendItem color="#EF4444" label="Blocked" />
        <LegendItem color="#F59E0B" label="Partial" />
        <LegendItem color="#22C55E" label="Executed" />
        <LegendItem color="#8B5CF6" label="Defense priority" />
      </div>

      {/* ── Timeline rows ── */}
      {formatted.length === 0 ? (
        <div style={{
          color:        '#4B5563',
          fontSize:     '0.75rem',
          textAlign:    'center',
          padding:      '2rem 0',
        }}>
          No VR timeline data available
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Column headers */}
          <div style={{
            display:    'grid',
            gridTemplateColumns: '80px 60px auto',
            gap:        6,
            padding:    '3px 10px',
          }}>
            <span style={headerStyle}>DATE</span>
            <span style={headerStyle}>PRICE</span>
            <span style={headerStyle}>STATUS</span>
          </div>

          {displayRows.map((row, i) => (
            <VrTimelineRowComponent
              key={`${row.timestamp}-${i}`}
              row={row}
              showReason={showReasons}
            />
          ))}

          {/* "More" note when truncated */}
          {!showAll && formatted.length > 20 && (
            <div style={{ color: '#374151', fontSize: '0.65rem', textAlign: 'center', padding: '4px 0' }}>
              Showing last 20 of {formatted.length} rows
            </div>
          )}
        </div>
      )}

      {/* ── Sample data notice ── */}
      {useSampleData && (!rows || rows.length === 0) && (
        <div style={{
          color:        '#374151',
          fontSize:     '0.65rem',
          textAlign:    'center',
          borderTop:    '1px solid rgba(255,255,255,0.05)',
          paddingTop:   8,
        }}>
          Sample data — connect backend vr_timeline array to populate
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ color: '#4B5563', fontSize: '0.62rem', fontWeight: 600 }}>{label}</span>
      <span style={{ color, fontSize: '0.68rem', fontWeight: 800 }}>{value}</span>
    </span>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ color: '#6B7280', fontSize: '0.62rem' }}>{label}</span>
    </div>
  )
}

function ToggleButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background:   active ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
        border:       active ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        color:        active ? '#A5B4FC' : '#6B7280',
        fontSize:     '0.65rem',
        fontWeight:   700,
        padding:      '3px 8px',
        cursor:       'pointer',
      }}
    >
      {label}
    </button>
  )
}

const headerStyle: React.CSSProperties = {
  color:         '#374151',
  fontSize:      '0.58rem',
  fontWeight:    700,
  letterSpacing: '0.07em',
}
