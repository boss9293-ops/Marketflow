'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { normalizeTicker } from '@/lib/stockAnalysis'

type BriefItem = {
  id: string
  ticker?: string
  symbol: string
  checkpointET?: string
  headline: string
  source?: string
  summary?: string
  url?: string
  dateET?: string
}

export default function NewsPage() {
  const router = useRouter()
  const [ticker, setTicker] = useState('AAPL')
  const [queryTicker, setQueryTicker] = useState('AAPL')
  const [briefs, setBriefs] = useState<BriefItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingTicker, setPendingTicker] = useState<string | null>(null)

  const normalizedTicker = useMemo(() => normalizeTicker(queryTicker) || 'AAPL', [queryTicker])

  const buildAnalyzeHref = (brief: BriefItem) => {
    const analyzeTicker = normalizeTicker(brief.ticker || brief.symbol || normalizedTicker) || normalizedTicker
    const params = new URLSearchParams()
    params.set('from', 'news')
    if (brief.headline) params.set('headline', brief.headline)
    if (brief.source) params.set('source', brief.source)
    return `/stock/${encodeURIComponent(analyzeTicker)}?${params.toString()}`
  }

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    setLoading(true)
    setError(null)

    fetch(`/api/news?symbol=${encodeURIComponent(normalizedTicker)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error || 'Failed to load news')
        const list = Array.isArray(json?.briefs) ? json.briefs : []
        if (alive) setBriefs(list)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Failed to load news')
        setBriefs([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
      controller.abort()
    }
  }, [normalizedTicker])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.10),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(236,72,153,0.10),transparent_26%),linear-gradient(180deg,#020617_0%,#07131f_100%)] px-4 py-5 text-slate-100 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-slate-500">News Entry</div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white md:text-4xl">
              News <span className="text-cyan-300">to Analyze</span>
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Pick a ticker, scan the latest headlines, and jump into automatic stock analysis with one click.
            </p>
          </div>

          <Link
            href="/chart"
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
          >
            Open Chart
          </Link>
        </div>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold text-slate-400">Ticker</label>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setQueryTicker(ticker)
              }}
              className="min-w-[140px] rounded-xl border border-white/10 bg-slate-950/70 px-4 py-2 text-sm font-semibold text-white outline-none transition focus:border-cyan-400/40"
              placeholder="AAPL"
            />
            <button
              onClick={() => setQueryTicker(ticker)}
              className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
            >
              Load News
            </button>
            <div className="ml-auto text-sm text-slate-400">
              Active: <span className="font-semibold text-white">{normalizedTicker}</span>
            </div>
          </div>
        </section>

        {error && (
          <section className="rounded-3xl border border-rose-400/25 bg-rose-400/10 px-5 py-4 text-rose-100">
            {error}
          </section>
        )}

        {!loading && !error && !briefs.length && (
          <section className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-slate-300">
            No high-quality news matched the current filters yet.
          </section>
        )}
        <section className="grid gap-4 lg:grid-cols-2">
          {(loading ? Array.from({ length: 4 }) : briefs).map((item, index) => {
            if (loading) {
              return (
                <div
                  key={`skeleton-${index}`}
                  className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)]"
                >
                  <div className="animate-pulse space-y-3">
                    <div className="h-4 w-24 rounded bg-white/10" />
                    <div className="h-6 w-3/4 rounded bg-white/10" />
                    <div className="h-4 w-full rounded bg-white/10" />
                    <div className="h-4 w-11/12 rounded bg-white/10" />
                    <div className="flex gap-3 pt-2">
                      <div className="h-9 w-28 rounded-full bg-white/10" />
                      <div className="h-9 w-24 rounded-full bg-white/10" />
                    </div>
                  </div>
                </div>
              )
            }

            const brief = item as BriefItem
            return (
              <article
                key={brief.id}
                className="rounded-3xl border border-white/10 bg-slate-950/85 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5 hover:border-cyan-400/20"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-500">
                  <span>{brief.ticker || brief.symbol}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-600" />
                  <span>{brief.source || 'News'}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-600" />
                  <span>{brief.checkpointET || brief.dateET || '--'}</span>
                </div>

                <h2 className="mt-3 text-lg font-bold leading-7 text-white">{brief.headline}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {brief.summary || 'Headline summary unavailable.'}
                </p>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={() => {
                      const href = buildAnalyzeHref(brief)
                      setPendingTicker(brief.ticker || brief.symbol || normalizedTicker)
                      router.push(href)
                    }}
                    disabled={pendingTicker === (brief.ticker || brief.symbol)}
                    className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pendingTicker === (brief.ticker || brief.symbol) ? 'Opening...' : 'Analyze'}
                  </button>
                  {brief.url && (
                    <a
                      href={brief.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
                    >
                      Open Article
                    </a>
                  )}
                </div>
              </article>
            )
          })}
        </section>
      </div>
    </div>
  )
}
