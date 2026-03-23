import type { SavedResearchSession } from '@/types/researchSession'

const STORAGE_KEY  = 'mf_research_sessions_v1'
const MAX_SESSIONS = 50

export function loadSessions(): SavedResearchSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as SavedResearchSession[]) : []
  } catch {
    return []
  }
}

export function saveSession(session: SavedResearchSession): void {
  try {
    const sessions = loadSessions()
    const idx = sessions.findIndex(s => s.id === session.id)
    if (idx >= 0) {
      sessions[idx] = { ...session, updated_at: new Date().toISOString() }
    } else {
      sessions.unshift(session)
      if (sessions.length > MAX_SESSIONS) sessions.splice(MAX_SESSIONS)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch { /* storage unavailable */ }
}

export function deleteSession(id: string): void {
  try {
    const sessions = loadSessions().filter(s => s.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch { /* ignore */ }
}

export function updateSession(session: SavedResearchSession): void {
  saveSession({ ...session, updated_at: new Date().toISOString() })
}
