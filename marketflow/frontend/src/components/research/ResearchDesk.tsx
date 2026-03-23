'use client'

import { useState, useEffect, type CSSProperties } from 'react'
import type { ResearchResponse, ResearchStatus } from '@/types/research'
import type { SavedResearchSession } from '@/types/researchSession'
import type { MonitoredTopic } from '@/types/researchMonitor'
import { normalizeResearchResponse } from '@/lib/normalizeResearchResponse'
import QueryBar             from './QueryBar'
import ResearchTrustBar     from './ResearchTrustBar'
import ResearchSummaryPanel from './ResearchSummaryPanel'
import SourceTable          from './SourceTable'
import EngineImpactBox      from './EngineImpactBox'
import VRSignalCrossCheck   from './VRSignalCrossCheck'
import EmptyResearchState   from './EmptyResearchState'
import ResearchLoadingState from './ResearchLoadingState'
import WatchTopicButton     from './WatchTopicButton'

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          'linear-gradient(180deg, rgba(8,12,22,0.96), rgba(9,11,17,0.99))',
  border:      '1px solid rgba(255,255,255,0.08)',
  radius:      20,
  shadow:      '0 18px 40px rgba(0,0,0,0.22)',
  textPrimary: '#f8fafc',
  textDim:     '#64748b',
  rose:        '#fca5a5',
  teal:        '#5eead4',
}

const VR_STATE_COLOR: Record<string, string> = {
  NORMAL: '#5eead4', CAUTION: '#fcd34d',
  ARMED:  '#fca5a5', EXIT_DONE: '#fca5a5', REENTRY: '#93c5fd',
}

export interface VrContextLink {
  vr_state:      string
  crash_trigger: boolean
  confidence:    'low' | 'medium' | 'high'
}

// ── VR context badge ──────────────────────────────────────────────────────────

function VrContextBadge({ ctx }: { ctx: VrContextLink }) {
  const col = VR_STATE_COLOR[ctx.vr_state] ?? '#94a3b8'
  return (
    <div style={{
      display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
      padding: '0.55rem 0.9rem',
      background: 'rgba(129,140,248,0.05)',
      border: '1px solid rgba(129,140,248,0.22)',
      borderRadius: 10, marginBottom: 14,
    } as CSSProperties}>
      <span style={{ fontSize: '0.65rem', color: '#818cf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        Linked from VR Survival
      </span>
      <span style={{ fontSize: '0.65rem', color: '#64748b' }}>\u00b7</span>
      <span style={{
        fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.06em',
        color: col, background: `${col}18`, border: `1px solid ${col}40`,
        padding: '1px 7px', borderRadius: 99,
      }}>
        {ctx.vr_state}
      </span>
      {ctx.crash_trigger && (
        <span style={{
          fontSize: '0.65rem', fontWeight: 700, color: '#fca5a5',
          background: 'rgba(252,165,165,0.1)', border: '1px solid rgba(252,165,165,0.3)',
          padding: '1px 7px', borderRadius: 99,
        }}>
          Crash Trigger
        </span>
      )}
      <span style={{
        fontSize: '0.65rem', fontWeight: 600, color: '#94a3b8',
        background: 'rgba(148,163,184,0.07)', border: '1px solid rgba(148,163,184,0.18)',
        padding: '1px 7px', borderRadius: 99, textTransform: 'capitalize',
      }}>
        {ctx.confidence} confidence
      </span>
      <a href="/vr-survival" style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#818cf8', textDecoration: 'none', fontWeight: 600 }}>
        \u2190 Back to VR
      </a>
    </div>
  )
}

// ── Save session button ───────────────────────────────────────────────────────

interface SaveButtonProps {
  query:      string
  result:     ResearchResponse
  vrContext?: VrContextLink
  isSaved:    boolean
  onSave:     (s: SavedResearchSession) => void
}

function SaveSessionButton({ query, result, vrContext, isSaved, onSave }: SaveButtonProps) {
  function handleSave() {
    const session: SavedResearchSession = {
      id:         `mf-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      query,
      response:   result,
      vr_context: vrContext ? {
        vr_state:      vrContext.vr_state,
        crash_trigger: vrContext.crash_trigger,
        confidence:    vrContext.confidence,
      } : undefined,
      created_at: new Date().toISOString(),
    }
    onSave(session)
  }

  return (
    <button
      onClick={isSaved ? undefined : handleSave}
      disabled={isSaved}
      title={isSaved ? 'Research session saved' : 'Save this research to sessions panel'}
      style={{
        fontSize: '0.74rem', fontWeight: 700,
        color:      isSaved ? C.teal : '#94a3b8',
        background: isSaved ? 'rgba(94,234,212,0.08)' : 'rgba(255,255,255,0.04)',
        border:     `1px solid ${isSaved ? 'rgba(94,234,212,0.3)' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 8, padding: '0.38rem 0.9rem',
        cursor: isSaved ? 'default' : 'pointer', transition: 'all 0.15s',
      } as CSSProperties}
    >
      {isSaved ? '\u2713 Saved' : 'Save Research'}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface ResearchDeskProps {
  initialQuery?:  string
  vrContext?:     VrContextLink
  triggerQuery?:  { q: string; ts: number }
  loadResult?:    { session: SavedResearchSession; ts: number }
  onSave?:        (s: SavedResearchSession) => void
  onWatch?:       (topic: MonitoredTopic) => void
  onUnwatch?:     (id: string) => void
}

export default function ResearchDesk({
  initialQuery, vrContext, triggerQuery, loadResult, onSave, onWatch, onUnwatch,
}: ResearchDeskProps) {
  const [status,  setStatus]  = useState<ResearchStatus>('idle')
  const [result,  setResult]  = useState<ResearchResponse | null>(null)
  const [query,   setQuery]   = useState(initialQuery ?? '')
  const [errMsg,  setErrMsg]  = useState('')
  const [isSaved, setIsSaved] = useState(false)

  useEffect(() => {
    if (initialQuery) runResearch(initialQuery)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (triggerQuery) runResearch(triggerQuery.q)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerQuery?.ts])

  useEffect(() => {
    if (!loadResult) return
    setQuery(loadResult.session.query)
    setResult(loadResult.session.response)
    setStatus('live')
    setIsSaved(true)
    setErrMsg('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadResult?.ts])

  async function runResearch(q: string) {
    setQuery(q)
    setStatus('loading')
    setErrMsg('')
    setIsSaved(false)
    try {
      const res = await fetch('/api/research', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: q }),
      })
      const raw = await res.json() as Record<string, unknown>
      if (!res.ok || raw._route_error_code || raw._error) {
        const msg = typeof raw._error === 'string' ? raw._error : `Service error (${res.status})`
        setErrMsg(msg)
        setStatus('failed')
        return
      }
      setResult(normalizeResearchResponse(raw))
      setStatus('live')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e))
      setStatus('failed')
    }
  }

  const isLoading = status === 'loading'
  const vrCtxForWatch = vrContext
    ? { vr_state: vrContext.vr_state, crash_trigger: vrContext.crash_trigger, confidence: vrContext.confidence }
    : undefined

  return (
    <div style={{
      background:   C.bg,
      border:       C.border,
      borderRadius: C.radius,
      padding:      '1.4rem 1.5rem',
      boxShadow:    C.shadow,
    } as CSSProperties}>

      {vrContext && <VrContextBadge ctx={vrContext} />}

      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '0.7rem', color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.13em', marginBottom: 5 }}>
          Research Desk
        </div>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: C.textPrimary }}>
          AI Market Research \u00b7 Source-Transparent Analysis
        </div>
        <div style={{ fontSize: '0.83rem', color: C.textDim, marginTop: 5, lineHeight: 1.5, maxWidth: 560 }}>
          Ask a research question. The AI synthesizes relevant context, identifies sources, and maps findings to the VR engine. Not a trading instruction.
        </div>
      </div>

      {/* Query Bar */}
      <div style={{ marginBottom: 16 }}>
        <QueryBar onSubmit={runResearch} loading={isLoading} lastQuery={query} />
      </div>

      {isLoading && <ResearchLoadingState query={query} />}

      {status === 'failed' && (
        <div style={{
          background: 'rgba(252,165,165,0.06)',
          border: '1px solid rgba(252,165,165,0.2)',
          borderRadius: 12, padding: '0.8rem 1rem',
          fontSize: '0.86rem', color: C.rose,
        }}>
          <strong>Research unavailable:</strong> {errMsg || 'Unknown error'}
        </div>
      )}

      {status === 'idle' && (
        <EmptyResearchState onQuery={q => runResearch(q)} />
      )}

      {!isLoading && status === 'live' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Action buttons row */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <WatchTopicButton
              query={query}
              result={result}
              vrContext={vrCtxForWatch}
              onWatch={onWatch}
              onUnwatch={onUnwatch}
            />
            <SaveSessionButton
              query={query}
              result={result}
              vrContext={vrContext}
              isSaved={isSaved}
              onSave={s => { onSave?.(s); setIsSaved(true) }}
            />
          </div>
          <ResearchTrustBar status={status} meta={result._meta} />
          <ResearchSummaryPanel result={result} />
          <EngineImpactBox impact={result.engine_impact} vrContext={vrContext} />
          {vrContext && <VRSignalCrossCheck result={result} vrContext={vrContext} />}
          <SourceTable sources={result.sources} />
        </div>
      )}
    </div>
  )
}
