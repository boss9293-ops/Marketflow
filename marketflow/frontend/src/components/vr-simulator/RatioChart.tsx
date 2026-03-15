'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import ChartShell from '@/components/vr-simulator/ChartShell'
import ChartTooltip from '@/components/vr-simulator/ChartTooltip'
import { formatNumber, formatShortDate } from '@/components/vr-simulator/formatters'
import { BacktestRow } from '@/lib/backtest/types'

export default function RatioChart({ rows }: { rows: BacktestRow[] }) {
  return (
    <ChartShell title="Chart D · Ratios and State" subtitle="Portfolio-to-target ratio and tracked G value">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fill: '#8ea1b9', fontSize: 11 }} tickFormatter={formatShortDate} minTickGap={40} />
          <YAxis yAxisId="left" tick={{ fill: '#8ea1b9', fontSize: 11 }} tickFormatter={(value) => formatNumber(value, 2)} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: '#8ea1b9', fontSize: 11 }} tickFormatter={(value) => formatNumber(value, 2)} />
          <Tooltip content={<ChartTooltip />} />
          <Line yAxisId="left" type="monotone" dataKey="pvRatio" stroke="#22c55e" dot={false} strokeWidth={2} name="P/V Ratio" />
          <Line yAxisId="right" type="monotone" dataKey="currentGValue" stroke="#c4ff0d" dot={false} strokeWidth={1.8} name="G Value" />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  )
}

