'use client'

import { useState } from 'react'
import SparkLine from '@/components/shared/SparkLine'

type TapeItem = {
  symbol?:   string | null
  last?:     number | null
  chg_pct?:  number | null
  spark_1d?: number[] | null
}

const TABS = ['All', 'Indices', 'Rates', 'FX', 'Commodities', 'Crypto'] as const

const TAB_LABELS: Record<string, { ko: string; en: string }> = {
  All:         { ko: '전체',   en: 'All' },
  Indices:     { ko: '지수',   en: 'Indices' },
  Rates:       { ko: '금리',   en: 'Rates' },
  FX:          { ko: '환율',   en: 'FX' },
  Commodities: { ko: '원자재', en: 'Commodities' },
  Crypto:      { ko: '크립토', en: 'Crypto' },
}

const TAB_SYMBOLS: Record<string, string[]> = {
  Indices:     ['SPY', 'QQQ', 'IWM', 'DIA', 'VIX'],
  Rates:       ['US10Y', 'US2Y', 'EFFR', 'HY_OAS'],
  FX:          ['DXY', 'EURUSD', 'USDJPY', 'USD_BROAD'],
  Commodities: ['GOLD', 'GLD', 'CL1', 'OIL', 'SILVER'],
  Crypto:      ['BTCUSD', 'BTC', 'ETH', 'SOL'],
}

type Row = { label: string; key: string; altKey?: string }

const ALL_ROWS: Row[] = [
  { label: 'SPY',        key: 'SPY' },
  { label: 'QQQ',        key: 'QQQ' },
  { label: 'IWM',        key: 'IWM' },
  { label: 'VIX',        key: 'VIX' },
  { label: '10Y Yield',  key: 'US10Y', altKey: 'DGS10' },
  { label: 'Dollar',     key: 'DXY',   altKey: 'USD_BROAD' },
  { label: 'Oil',        key: 'OIL',   altKey: 'CL1' },
  { label: 'GOLD',       key: 'GOLD' },
  { label: 'BTC',        key: 'BTCUSD' },
]

function fmt(v: number | null | undefined) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const abs = Math.abs(v)
  if (abs >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (abs >= 100)   return v.toFixed(1)
  return v.toFixed(2)
}

function SkeletonCard() {
  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8,
      background: 'rgba(255,255,255,0.02)', padding: '0.3rem 0.35rem',
      minHeight: 72, overflow: 'hidden', position: 'relative',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        animation: 'shimmer 1.4s infinite',
      }} />
      {[28, 36, 24].map((w, i) => (
        <div key={i} style={{
          height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)',
          width: w + 'px', marginTop: i === 0 ? 4 : 6,
        }} />
      ))}
    </div>
  )
}

function AssetCard({ label, item }: { label: string; item: TapeItem | undefined }) {
  const chg   = typeof item?.chg_pct === 'number' ? item.chg_pct : null
  const price = typeof item?.last    === 'number' ? item.last    : null
  const spark = Array.isArray(item?.spark_1d) ? (item.spark_1d as number[]) : null
  const up    = (chg ?? 0) >= 0
  const col   = chg == null ? '#D8E6F5' : up ? '#4ade80' : '#f87171'
  const arrow = chg == null ? '' : up ? '\u25b4' : '\u25be'

  if (price == null && chg == null) return <SkeletonCard />

  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8,
      background: 'rgba(255,255,255,0.02)', padding: '0.35rem 0.4rem',
      minHeight: 72, display: 'flex', flexDirection: 'column', gap: 2,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ color: '#D8E6F5', fontSize: '0.64rem', fontWeight: 800 }}>{label}</div>
      <div style={{ color: '#F8FAFC', fontSize: '0.82rem', fontWeight: 800, lineHeight: 1 }}>
        {fmt(price) ?? '--'}
      </div>
      <div style={{ color: col, fontSize: '0.7rem', fontWeight: 800 }}>
        {chg == null ? '--' : arrow + ' ' + Math.abs(chg).toFixed(2) + '%'}
      </div>
      {spark && spark.length >= 2 && (
        <div style={{ position: 'absolute', bottom: 4, right: 4, opacity: 0.85 }}>
          <SparkLine data={spark} width={48} height={22} color={col} strokeWidth={1.2} />
        </div>
      )}
    </div>
  )
}

export default function CrossAssetStripCompact({
  items,
  defaultTab = 'Indices',
}: {
  items: TapeItem[]
  defaultTab?: string
}) {
  const [activeTab, setActiveTab] = useState(defaultTab)
  const map = new Map((items || []).map((it) => [String(it.symbol || '').toUpperCase(), it]))

  const rows = activeTab === 'All'
    ? ALL_ROWS
    : ALL_ROWS.filter((r) => (TAB_SYMBOLS[activeTab] ?? []).includes(r.key))

  const visibleRows = rows.length > 0 ? rows : ALL_ROWS

  return (
    <section style={{
      background: '#0B0F14', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12, padding: '0.65rem 0.75rem', minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: '#F8FAFC', fontSize: '0.75rem', fontWeight: 700 }}>Market Pulse</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {TABS.map((tab) => {
            const active = tab === activeTab
            const lbl = TAB_LABELS[tab] ?? { ko: tab, en: tab }
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  borderRadius: 8,
                  border: active ? '1px solid rgba(59,130,246,0.35)' : '1px solid rgba(255,255,255,0.08)',
                  background: active ? 'rgba(37,99,235,0.14)' : 'rgba(255,255,255,0.02)',
                  color: active ? '#93C5FD' : '#94A3B8',
                  padding: '0.18rem 0.45rem',
                  fontSize: '0.67rem', fontWeight: active ? 800 : 500,
                  cursor: 'pointer', lineHeight: 1.2,
                }}
              >
                <span style={{ display: 'block', fontSize: '0.66rem' }}>{lbl.ko}</span>
                <span style={{ display: 'block', fontSize: '0.58rem', opacity: 0.7 }}>{lbl.en}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-4 md:grid-cols-8 gap-2" style={{ marginTop: 8 }}>
        {visibleRows.map(({ label, key, altKey }) => (
          <AssetCard key={key} label={label} item={map.get(key) ?? (altKey ? map.get(altKey) : undefined)} />
        ))}
      </div>

      <style>{`@keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }`}</style>
    </section>
  )
}
