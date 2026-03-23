'use client'

import { useState, useEffect, type CSSProperties } from 'react'
import type { ResearchResponse } from '@/types/research'
import type { MonitoredTopic } from '@/types/researchMonitor'
import {
  findMonitorByQuery,
  saveMonitoredTopic,
  removeMonitoredTopic,
} from '@/lib/researchMonitorStorage'

interface Props {
  query:      string
  result:     ResearchResponse
  vrContext?: { vr_state?: string; crash_trigger?: boolean; confidence?: string }
  onWatch?:   (topic: MonitoredTopic) => void
  onUnwatch?: (id: string) => void
}

export default function WatchTopicButton({ query, result, vrContext, onWatch, onUnwatch }: Props) {
  const [existing, setExisting] = useState<MonitoredTopic | undefined>(undefined)

  useEffect(() => {
    setExisting(findMonitorByQuery(query))
  }, [query])

  function handleClick() {
    if (existing) {
      removeMonitoredTopic(existing.id)
      onUnwatch?.(existing.id)
      setExisting(undefined)
    } else {
      const topic: MonitoredTopic = {
        id:           crypto.randomUUID(),
        query,
        vr_context:   vrContext,
        status:       'watching',
        latest:       result,
        last_checked: new Date().toISOString(),
        created_at:   new Date().toISOString(),
      }
      saveMonitoredTopic(topic)
      setExisting(topic)
      onWatch?.(topic)
    }
  }

  const isWatching = !!existing
  return (
    <button
      onClick={handleClick}
      title={isWatching ? 'Remove from Topic Monitor' : 'Add to Topic Monitor watchlist'}
      style={{
        fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.04em',
        color:      isWatching ? '#5eead4' : '#94a3b8',
        background: isWatching ? 'rgba(94,234,212,0.08)' : 'rgba(148,163,184,0.05)',
        border:     isWatching ? '1px solid rgba(94,234,212,0.25)' : '1px solid rgba(148,163,184,0.15)',
        borderRadius: 8, padding: '0.3rem 0.75rem', cursor: 'pointer', transition: 'all 0.15s',
      } as CSSProperties}
    >
      {isWatching ? '\u25c9 Watching' : '\u25cb Watch Topic'}
    </button>
  )
}
