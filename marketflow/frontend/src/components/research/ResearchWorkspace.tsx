'use client'

import { useState, useEffect, type CSSProperties } from 'react'
import type { SavedResearchSession } from '@/types/researchSession'
import type { MonitoredTopic } from '@/types/researchMonitor'
import { loadSessions, saveSession, deleteSession } from '@/lib/researchStorage'
import {
  loadMonitoredTopics,
  removeMonitoredTopic,
  findMonitorById,
} from '@/lib/researchMonitorStorage'
import type { VrContextLink } from './ResearchDesk'
import ResearchDesk       from './ResearchDesk'
import SavedSessionsPanel from './SavedSessionsPanel'
import TopicPackSelector  from './TopicPackSelector'
import TopicMonitorPanel  from './TopicMonitorPanel'

interface ResearchWorkspaceProps {
  initialQuery?:  string
  vrContext?:     VrContextLink
  loadMonitorId?: string   // handoff from dashboard ?load_monitor=<id>
}

export default function ResearchWorkspace({ initialQuery, vrContext, loadMonitorId }: ResearchWorkspaceProps) {
  const [sessions,        setSessions]        = useState<SavedResearchSession[]>([])
  const [monitoredTopics, setMonitoredTopics] = useState<MonitoredTopic[]>([])
  const [triggerQuery,    setTriggerQuery]    = useState<{ q: string; ts: number } | undefined>()
  const [loadResult,      setLoadResult]      = useState<{ session: SavedResearchSession; ts: number } | undefined>()

  useEffect(() => {
    setSessions(loadSessions())
    setMonitoredTopics(loadMonitoredTopics())
    // Handle dashboard handoff: auto-load monitored topic by ID
    if (loadMonitorId) {
      const found = findMonitorById(loadMonitorId)
      if (found) doMonitorLoad(found)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function doMonitorLoad(topic: MonitoredTopic) {
    const session: SavedResearchSession = {
      id:         topic.id,
      query:      topic.query,
      response:   topic.latest,
      vr_context: topic.vr_context,
      created_at: topic.created_at,
    }
    setLoadResult({ session, ts: Date.now() })
  }

  // ── Session handlers ──────────────────────────────────────────────────────

  function handleTopicQuery(q: string) {
    setTriggerQuery({ q, ts: Date.now() })
  }

  function handleSave(session: SavedResearchSession) {
    saveSession(session)
    setSessions(loadSessions())
  }

  function handleLoad(session: SavedResearchSession) {
    setLoadResult({ session, ts: Date.now() })
  }

  function handleRerun(session: SavedResearchSession) {
    setTriggerQuery({ q: session.query, ts: Date.now() })
  }

  function handleDelete(id: string) {
    deleteSession(id)
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  // ── Monitor handlers ──────────────────────────────────────────────────────

  function handleWatch(topic: MonitoredTopic) {
    setMonitoredTopics(prev => [topic, ...prev.filter(t => t.id !== topic.id)])
  }

  function handleUnwatch(id: string) {
    setMonitoredTopics(prev => prev.filter(t => t.id !== id))
  }

  function handleMonitorUpdate(updated: MonitoredTopic) {
    setMonitoredTopics(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  function handleMonitorRemove(id: string) {
    removeMonitoredTopic(id)
    setMonitoredTopics(prev => prev.filter(t => t.id !== id))
  }

  function handleMonitorLoad(topic: MonitoredTopic) {
    doMonitorLoad(topic)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 } as CSSProperties}>

      {/* Topic Pack Selector */}
      <TopicPackSelector onQuerySelect={handleTopicQuery} />

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 580px', minWidth: 0 }}>
          <ResearchDesk
            initialQuery={initialQuery}
            vrContext={vrContext}
            triggerQuery={triggerQuery}
            loadResult={loadResult}
            onSave={handleSave}
            onWatch={handleWatch}
            onUnwatch={handleUnwatch}
          />
        </div>
        <div style={{ flex: '0 0 288px', minWidth: '288px' }}>
          <SavedSessionsPanel
            sessions={sessions}
            onLoad={handleLoad}
            onRerun={handleRerun}
            onDelete={handleDelete}
          />
        </div>
      </div>

      {/* Topic Monitor Panel */}
      <TopicMonitorPanel
        topics={monitoredTopics}
        onUpdate={handleMonitorUpdate}
        onRemove={handleMonitorRemove}
        onLoad={handleMonitorLoad}
      />
    </div>
  )
}
