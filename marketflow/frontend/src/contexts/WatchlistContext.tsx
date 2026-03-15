'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

type WatchlistItem = {
  symbol: string
  name?: string
  label?: string | null
  known?: boolean
  created_at?: string
}

type WatchlistContextValue = {
  items: WatchlistItem[]
  selectedSymbol: string
  loading: boolean
  setSelectedSymbol: (symbol: string) => void
  refresh: () => Promise<void>
  addSymbol: (symbol: string, label?: string) => Promise<{ ok: boolean; message?: string }>
  removeSymbol: (symbol: string) => Promise<{ ok: boolean; message?: string }>
  searchSymbols: (query: string, limit?: number) => Promise<Array<{
    symbol: string
    name?: string
    sector?: string
    last_date?: string
    in_watchlist?: number
  }>>
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:5001'
const WATCHLIST_STORAGE_KEY = 'marketflow_watchlist_v1'
const WATCHLIST_SELECTED_KEY = 'marketflow_watchlist_selected_v1'

const WatchlistContext = createContext<WatchlistContextValue | null>(null)

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase()
}

function parseStoredItems(raw: string | null): WatchlistItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((x: any) => ({
        symbol: normalizeSymbol(String(x?.symbol || '')),
        name: x?.name ? String(x.name) : undefined,
        label: x?.label ? String(x.label) : null,
        known: typeof x?.known === 'boolean' ? x.known : false,
        created_at: x?.created_at ? String(x.created_at) : undefined,
      }))
      .filter((x: WatchlistItem) => !!x.symbol)
  } catch {
    return []
  }
}

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [selectedSymbol, setSelectedSymbolState] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)

  const setSelectedSymbol = useCallback((symbol: string) => {
    const clean = normalizeSymbol(symbol)
    setSelectedSymbolState(clean)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WATCHLIST_SELECTED_KEY, clean)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return
    try {
      const nextItems = parseStoredItems(window.localStorage.getItem(WATCHLIST_STORAGE_KEY))
      setItems(nextItems)
      const storedSelected = normalizeSymbol(window.localStorage.getItem(WATCHLIST_SELECTED_KEY) || '')
      const fallback = nextItems[0]?.symbol || ''
      const nextSelected = nextItems.find((x) => x.symbol === storedSelected) ? storedSelected : fallback
      setSelectedSymbolState(nextSelected)
      if (nextSelected) {
        window.localStorage.setItem(WATCHLIST_SELECTED_KEY, nextSelected)
      }
    } catch {
      // keep previous state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(items))
  }, [items])

  const addSymbol = useCallback(async (symbol: string, label?: string) => {
    const clean = normalizeSymbol(symbol)
    if (!clean) return { ok: false, message: 'Symbol is required.' }
    if (!/^[A-Z0-9.\-]{1,10}$/.test(clean)) {
      return { ok: false, message: 'Use A-Z, 0-9, dot, dash only (max 10).' }
    }
    if (items.find((x) => x.symbol === clean)) {
      setSelectedSymbol(clean)
      return { ok: true }
    }

    let known = false
    let resolvedName = label?.trim() || clean
    try {
      const rows = await (async () => {
        const q = encodeURIComponent(clean)
        const res = await fetch(`${API_BASE}/api/watchlist/symbols?q=${q}&limit=20`, { cache: 'no-store' })
        const data = await res.json()
        if (!res.ok || !Array.isArray(data?.symbols)) return []
        return data.symbols as Array<{ symbol?: string; name?: string }>
      })()
      const exact = rows.find((x) => normalizeSymbol(String(x?.symbol || '')) === clean)
      if (exact) {
        known = true
        if (exact.name) resolvedName = String(exact.name)
      }
    } catch {
      // universe lookup unavailable -> keep unknown but allow insert
    }

    const nextItem: WatchlistItem = {
      symbol: clean,
      name: resolvedName,
      label: label?.trim() || null,
      known,
      created_at: new Date().toISOString(),
    }
    setItems((prev) => [nextItem, ...prev])
    setSelectedSymbol(clean)
    return { ok: true, message: known ? undefined : 'Added as unknown symbol.' }
  }, [items, setSelectedSymbol])

  const removeSymbol = useCallback(async (symbol: string) => {
    const clean = normalizeSymbol(symbol)
    if (!clean) return { ok: false, message: 'Symbol is required.' }
    setItems((prev) => {
      const next = prev.filter((x) => x.symbol !== clean)
      if (selectedSymbol === clean) {
        const fallback = next[0]?.symbol || ''
        setSelectedSymbolState(fallback)
        if (typeof window !== 'undefined') {
          if (fallback) window.localStorage.setItem(WATCHLIST_SELECTED_KEY, fallback)
          else window.localStorage.removeItem(WATCHLIST_SELECTED_KEY)
        }
      }
      return next
    })
    return { ok: true }
  }, [selectedSymbol])

  const searchSymbols = useCallback(async (query: string, limit = 40) => {
    try {
      const q = encodeURIComponent((query || '').trim())
      const res = await fetch(`${API_BASE}/api/watchlist/symbols?q=${q}&limit=${Math.max(1, Math.min(limit, 200))}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok || !Array.isArray(data?.symbols)) return []
      return data.symbols
    } catch {
      return []
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<WatchlistContextValue>(() => ({
    items,
    selectedSymbol,
    loading,
    setSelectedSymbol,
    refresh,
    addSymbol,
    removeSymbol,
    searchSymbols,
  }), [items, selectedSymbol, loading, setSelectedSymbol, refresh, addSymbol, removeSymbol, searchSymbols])

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>
}

export function useWatchlist() {
  const ctx = useContext(WatchlistContext)
  if (!ctx) {
    throw new Error('useWatchlist must be used within WatchlistProvider')
  }
  return ctx
}
