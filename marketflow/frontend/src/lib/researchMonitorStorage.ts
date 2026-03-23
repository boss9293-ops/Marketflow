import type { MonitoredTopic } from '@/types/researchMonitor'

const STORAGE_KEY = 'mf_research_monitor_v1'
const MAX_TOPICS  = 20

export function loadMonitoredTopics(): MonitoredTopic[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as MonitoredTopic[] }
  catch { return [] }
}

export function saveMonitoredTopic(topic: MonitoredTopic): void {
  if (typeof window === 'undefined') return
  const all = loadMonitoredTopics().filter(t => t.id !== topic.id)
  all.unshift(topic)
  if (all.length > MAX_TOPICS) all.splice(MAX_TOPICS)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}

export function removeMonitoredTopic(id: string): void {
  if (typeof window === 'undefined') return
  const all = loadMonitoredTopics().filter(t => t.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}

export function updateMonitoredTopic(topic: MonitoredTopic): void {
  saveMonitoredTopic(topic)
}

export function findMonitorByQuery(query: string): MonitoredTopic | undefined {
  return loadMonitoredTopics().find(
    t => t.query.trim().toLowerCase() === query.trim().toLowerCase()
  )
}

export function findMonitorById(id: string): MonitoredTopic | undefined {
  return loadMonitoredTopics().find(t => t.id === id)
}
