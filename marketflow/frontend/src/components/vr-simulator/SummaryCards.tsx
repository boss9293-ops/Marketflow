'use client'

import {
  formatCurrency,
  formatPercent,
  formatRatio,
  formatNumber,
  valueColor,
} from '@/components/vr-simulator/formatters'
import { PerformanceMetrics } from '@/lib/backtest/types'

function Card({
  label,
  value,
  detail,
  accent,
}: {
  label: string
  value: string
  detail: string
  accent: string
}) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(15,20,30,0.92)',
        padding: '0.9rem',
      }}
    >
      <div style={{ color: '#8ea1b9', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ color: accent, fontSize: '1.35rem', fontWeight: 800, marginTop: '0.35rem' }}>{value}</div>
      <div style={{ color: '#cbd5e1', fontSize: '0.78rem', marginTop: '0.28rem', lineHeight: 1.5 }}>{detail}</div>
    </div>
  )
}

export default function SummaryCards({
  metrics,
}: {
  metrics: PerformanceMetrics | null
}) {
  if (!metrics) {
    return null
  }

  const cards = [
    {
      label: 'Final Portfolio',
      value: formatCurrency(metrics.finalPortfolioValue),
      detail: `Cash ${formatCurrency(metrics.cashBalance)} · Shares ${formatNumber(metrics.currentShares, 4)}`,
      accent: '#f8fafc',
    },
    {
      label: 'Total Return',
      value: formatPercent(metrics.totalReturnPct),
      detail: `Max DD ${formatPercent(metrics.maxDrawdownPct)} · Realized ${formatCurrency(metrics.realizedPnl)}`,
      accent: valueColor(metrics.totalReturnPct),
    },
    {
      label: 'Unrealized PnL',
      value: formatCurrency(metrics.unrealizedPnl),
      detail: `Avg cost ${formatCurrency(metrics.currentAvgCost)} · G value ${formatNumber(metrics.currentGValue, 2)}`,
      accent: valueColor(metrics.unrealizedPnl),
    },
    {
      label: 'Bands',
      value: `${formatCurrency(metrics.currentLowerBand)} - ${formatCurrency(metrics.currentUpperBand)}`,
      detail: `Target ${formatCurrency(metrics.currentTargetValue)} · P/V ${formatRatio(metrics.currentPvRatio)}`,
      accent: '#f59e0b',
    },
    {
      label: 'Trade Count',
      value: `${metrics.buyTrades} / ${metrics.sellTrades}`,
      detail: `Buys / Sells · ${metrics.elapsedDays} elapsed bars`,
      accent: '#38bdf8',
    },
  ]

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.8rem' }}>
      {cards.map((card) => (
        <Card key={card.label} {...card} />
      ))}
    </section>
  )
}
