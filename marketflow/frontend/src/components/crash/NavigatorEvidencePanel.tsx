'use client'

import { useEffect, useState } from 'react'

type Metrics = {
  date?: string
  close?: number | null
  ret2?: number | null
  ret3?: number | null
  ret5?: number | null
  dd60?: number | null
  ma50?: number | null
  ma200?: number | null
  ma200GapAbs?: number | null
  ma200GapDir?: string | null
  ma200GapLabel?: string | null
}

type Props = {
  lang?: 'ko' | 'en'
  ret3TailLine?: string | null
}

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  const pct = value * 100
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

export default function NavigatorEvidencePanel({ lang = 'ko', ret3TailLine }: Props) {
  const t = (ko: string, en: string) => (lang === 'en' ? en : ko)
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as Metrics | undefined
      if (detail) setMetrics(detail)
    }
    window.addEventListener('tqqq-metrics', handler as EventListener)
    return () => window.removeEventListener('tqqq-metrics', handler as EventListener)
  }, [])

  const close = metrics?.close ?? null
  const ma50 = metrics?.ma50 ?? null
  const ma200 = metrics?.ma200 ?? null
  const above50 = close !== null && ma50 !== null ? close > ma50 : null
  const above200 = close !== null && ma200 !== null ? close > ma200 : null
  const maGap =
    metrics?.ma200GapAbs === null || metrics?.ma200GapAbs === undefined
      ? '-'
      : `${metrics.ma200GapAbs.toFixed(1)}% ${metrics.ma200GapDir ?? ''} · ${metrics.ma200GapLabel ?? ''}`

  return (
    <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem 1.1rem' }}>
      <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: 6 }}>{t('Evidence Panel', 'Evidence Panel')}</div>
      {ret3TailLine && (
        <div style={{ fontSize: '0.8rem', color: '#cbd5f5', marginBottom: 6 }}>
          {ret3TailLine}
        </div>
      )}
      <div style={{ fontSize: '0.9rem', color: '#e5e7eb' }}>ret_2d: {formatPct(metrics?.ret2)}</div>
      <div style={{ fontSize: '0.9rem', color: '#e5e7eb' }}>ret_3d: {formatPct(metrics?.ret3)}</div>
      <div style={{ fontSize: '0.9rem', color: '#e5e7eb' }}>ret_5d: {formatPct(metrics?.ret5)}</div>
      <div style={{ fontSize: '0.9rem', color: '#e5e7eb' }}>dd_60d: {formatPct(metrics?.dd60)}</div>
      <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: 6 }}>
        MA50: {above50 === null ? '?' : above50 ? t('상단', 'Above') : t('하단', 'Below')} · MA200:{' '}
        {above200 === null ? '?' : above200 ? t('상단', 'Above') : t('하단', 'Below')}
      </div>
      <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: 6 }}>
        {t('MA200 Gap', 'MA200 Gap')}: {maGap}
      </div>
    </div>
  )
}
