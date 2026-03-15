'use client'

import { useSyncExternalStore } from 'react'
import { rollingPercentile, bandFromPercentile, refBandText, type Point } from '@/lib/macro/normalize'
import { coverageRatio, isStale, qualityLabel } from '@/lib/macro/quality'

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:5001'

export type MacroSnapshotV2 = {
  snapshot_date: string
  computed?: Record<string, any>
  series?: Record<string, any>
  _meta?: { source_file?: string; source_path?: string }
}

type State = {
  loading: boolean
  error: string | null
  data: MacroSnapshotV2 | null
  fetchedAt: number | null
}

const store: {
  state: State
  listeners: Set<() => void>
} = {
  state: { loading: false, error: null, data: null, fetchedAt: null },
  listeners: new Set(),
}

function emit() {
  store.listeners.forEach((l) => l())
}

function setState(next: Partial<State>) {
  store.state = { ...store.state, ...next }
  emit()
}

export async function refreshMacroStore(): Promise<void> {
  setState({ loading: true, error: null })
  const controller = new AbortController()
  const timeoutMs = 12000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}/api/macro/v2/latest`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as MacroSnapshotV2
    setState({ loading: false, error: null, data: json, fetchedAt: Date.now() })

    // Commit 2: utility integration smoke log (no UI/compute refactor yet)
    const sample: Point[] = [
      { date: '2026-02-20', value: 18.1 },
      { date: '2026-02-21', value: 18.9 },
      { date: '2026-02-24', value: 19.2 },
      { date: '2026-02-25', value: 18.7 },
    ]
    const p = rollingPercentile(sample, 756)
    const band = bandFromPercentile(p, 'HIGH_BAD')
    const q = qualityLabel({
      coverage: coverageRatio(sample, 756),
      stale: isStale('2026-02-25', 'daily'),
      revisionRisk: false,
      proxyUsed: false,
    })
    console.log('[macroStore] normalize+quality smoke', {
      percentile: p,
      band,
      quality: q,
      refBand: refBandText('HIGH_BAD'),
    })
  } catch (e: any) {
    const msg = e?.name === 'AbortError'
      ? `Request timeout (${timeoutMs / 1000}s): ${API_BASE}/api/macro/v2/latest`
      : (e?.message || 'Failed to load macro snapshot')
    setState({ loading: false, error: msg })
  } finally {
    clearTimeout(timeoutId)
  }
}

export function useMacroStore() {
  return useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    },
    () => store.state,
    () => store.state
  )
}
