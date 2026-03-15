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
import { formatCurrency, formatShortDate } from '@/components/vr-simulator/formatters'
import { BacktestRow } from '@/lib/backtest/types'

export default function PortfolioChart({ rows }: { rows: BacktestRow[] }) {
  return (
    <ChartShell title="Chart B · Portfolio and Bands" subtitle="Portfolio value against target and rebalance bands">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fill: '#8ea1b9', fontSize: 11 }} tickFormatter={formatShortDate} minTickGap={40} />
          <YAxis tick={{ fill: '#8ea1b9', fontSize: 11 }} tickFormatter={(value) => formatCurrency(value, 0)} />
          <Tooltip content={<ChartTooltip />} />
          <Line type="monotone" dataKey="portfolioValue" stroke="#f8fafc" dot={false} strokeWidth={2.2} name="Portfolio" />
          <Line type="monotone" dataKey="targetValue" stroke="#c4ff0d" dot={false} strokeWidth={1.9} name="Target" />
          <Line type="monotone" dataKey="upperBand" stroke="#f59e0b" dot={false} strokeDasharray="6 4" name="Upper Band" />
          <Line type="monotone" dataKey="lowerBand" stroke="#38bdf8" dot={false} strokeDasharray="6 4" name="Lower Band" />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  )
}

