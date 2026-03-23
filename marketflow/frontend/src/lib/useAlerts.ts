'use client'
// =============================================================================
// lib/useAlerts.ts  (WO-SA26)
// Client hook: merges server alerts with localStorage-dismissed dedup
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import type { Alert } from '@/types/alert'

const STORAGE_KEY = 'mf_dismissed_alerts'
const MAX_DISMISSED = 200   // prevent unbounded growth

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    // Keep only the last MAX_DISMISSED entries
    const arr = Array.from(ids).slice(-MAX_DISMISSED)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
  } catch {
    // quota exceeded — ignore
  }
}

export function useAlerts(serverAlerts: Alert[]) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [hydrated,  setHydrated]  = useState(false)

  useEffect(() => {
    setDismissed(loadDismissed())
    setHydrated(true)
  }, [])

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(id)
      saveDismissed(next)
      return next
    })
  }, [])

  const dismissAll = useCallback(() => {
    const ids = new Set(serverAlerts.map(a => a.id))
    setDismissed(prev => {
      const next = new Set([...prev, ...ids])
      saveDismissed(next)
      return next
    })
  }, [serverAlerts])

  // Until hydrated show all (avoids flicker on first render)
  const visible = hydrated
    ? serverAlerts.filter(a => !dismissed.has(a.id))
    : serverAlerts

  return { visible, dismiss, dismissAll }
}
