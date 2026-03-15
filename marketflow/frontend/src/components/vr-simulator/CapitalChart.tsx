'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import ChartShell from '@/components/vr-simulator/ChartShell'
import ChartTooltip from '@/components/vr-simulator/ChartTooltip'
import { formatCurrency, formatShortDate } from '@/components/vr-simulator/formatters'
import { BacktestRow } from '@/lib/backtest/types'

export default function CapitalChart({ rows }: { rows: BacktestRow[] }) {
  return (
    <ChartShell title="Chart C · Cash vs Invested Capital" subtitle="Cash balance, market value, and total portfolio value">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="cashFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="marketFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fill: '#8ea1b9', fontSize: 11 }} tickFormatter={formatShortDate} minTickGap={40} />
          <YAxis tick={{ fill: '#8ea1b9', fontSize: 11 }} tickFormatter={(value) => formatCurrency(value, 0)} />
          <Tooltip content={<ChartTooltip />} />
          <Area type="monotone" dataKey="cash" stroke="#38bdf8" fill="url(#cashFill)" strokeWidth={1.8} name="Cash" />
          <Area type="monotone" dataKey="marketValue" stroke="#f59e0b" fill="url(#marketFill)" strokeWidth={1.8} name="Market Value" />
          <Line type="monotone" dataKey="portfolioValue" stroke="#f8fafc" dot={false} strokeWidth={2.1} name="Portfolio" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  )
}

