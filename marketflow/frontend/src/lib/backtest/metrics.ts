import { BacktestRow, PerformanceMetrics, TradeEvent } from '@/lib/backtest/types'

export function calculateMaxDrawdown(rows: BacktestRow[]) {
  let peak = 0
  let maxDrawdown = 0

  for (const row of rows) {
    peak = Math.max(peak, row.portfolioValue)
    if (peak <= 0) {
      continue
    }
    const drawdown = ((peak - row.portfolioValue) / peak) * 100
    maxDrawdown = Math.max(maxDrawdown, drawdown)
  }

  return maxDrawdown
}

export function buildPerformanceMetrics(
  symbol: string,
  rows: BacktestRow[],
  trades: TradeEvent[],
): PerformanceMetrics | null {
  if (rows.length === 0) {
    return null
  }

  const firstRow = rows[0]
  const lastRow = rows[rows.length - 1]
  const buyTrades = trades.filter((trade) => trade.action === 'BUY' || trade.action === 'INIT_BUY').length
  const sellTrades = trades.filter((trade) => trade.action === 'SELL').length
  const totalReturnPct =
    firstRow.portfolioValue > 0
      ? ((lastRow.portfolioValue - firstRow.portfolioValue) / firstRow.portfolioValue) * 100
      : 0

  return {
    symbol,
    finalPortfolioValue: lastRow.portfolioValue,
    totalReturnPct,
    realizedPnl: lastRow.realizedPnl,
    unrealizedPnl: lastRow.unrealizedPnl,
    maxDrawdownPct: calculateMaxDrawdown(rows),
    buyTrades,
    sellTrades,
    cashBalance: lastRow.cash,
    currentShares: lastRow.shares,
    currentAvgCost: lastRow.avgCost,
    currentTargetValue: lastRow.targetValue,
    currentUpperBand: lastRow.upperBand,
    currentLowerBand: lastRow.lowerBand,
    currentPvRatio: lastRow.pvRatio,
    elapsedDays: lastRow.totalDays,
    elapsedYears: lastRow.totalDays / 252,
    currentGValue: lastRow.currentGValue,
  }
}
