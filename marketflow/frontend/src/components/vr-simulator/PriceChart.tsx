'use client'

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import ChartShell from '@/components/vr-simulator/ChartShell'
import ChartTooltip from '@/components/vr-simulator/ChartTooltip'
import { formatCurrency, formatShortDate } from '@/components/vr-simulator/formatters'
import { BacktestRow } from '@/lib/backtest/types'

export default function PriceChart({ rows }: { rows: BacktestRow[] }) {
  const buyMarkers = rows.filter((row) => row.buySignal)
  const sellMarkers = rows.filter((row) => row.sellSignal)

  return (
    <ChartShell title="Chart A · Price and Trade Markers" subtitle="Daily close with executed buy and sell points">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fill: '#8ea1b9', fontSize: 11 }} tickFormatter={formatShortDate} minTickGap={40} />
          <YAxis tick={{ fill: '#8ea1b9', fontSize: 11 }} tickFormatter={(value) => formatCurrency(value, 0)} />
          <Tooltip content={<ChartTooltip />} />
          <Line type="monotone" dataKey="close" stroke="#f8fafc" dot={false} strokeWidth={2} name="Close" />
          <Scatter data={buyMarkers} dataKey="close" fill="#22c55e" name="Buy Price" />
          <Scatter data={sellMarkers} dataKey="close" fill="#ef4444" name="Sell Price" />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartShell>
  )
}

