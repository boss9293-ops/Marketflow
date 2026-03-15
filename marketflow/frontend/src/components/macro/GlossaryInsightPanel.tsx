'use client'

import { useEffect, useMemo, useState } from 'react'
import MarkdownRenderer from '@/components/shared/MarkdownRenderer'

function resolvePlaybackSlug(windowStart: string, windowEnd: string) {
  const startYear = Number(windowStart?.slice(0, 4))
  const endYear = Number(windowEnd?.slice(0, 4))
  const year = Number.isFinite(startYear) ? startYear : Number.isFinite(endYear) ? endYear : 2022

  if (year >= 2025) return '2025-tariff-shock'
  if (year >= 2024) return '2024-yen-carry'
  if (year >= 2022) return '2022-tightening'
  if (year >= 2020) return '2020-crisis'
  return '2022-tightening'
}

export default function GlossaryInsightPanel({
  windowStart,
  windowEnd,
  lastUpdate,
}: {
  windowStart: string
  windowEnd: string
  lastUpdate: string
}) {
  const slug = useMemo(() => resolvePlaybackSlug(windowStart, windowEnd), [windowStart, windowEnd])
  const [markdown, setMarkdown] = useState<string>('_Loading narrative..._')

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    const load = async () => {
      try {
        setMarkdown('_Loading narrative..._')
        const res = await fetch(`/api/playback-events/${slug}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('not found')
        const text = await res.text()
        if (active) setMarkdown(text)
      } catch (err: any) {
        if (!active || err?.name === 'AbortError') return
        setMarkdown('_Narrative not available._')
      }
    }

    load()
    return () => {
      active = false
      controller.abort()
    }
  }, [slug, lastUpdate])

  return <MarkdownRenderer content={markdown} />
}
