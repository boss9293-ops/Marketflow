'use client'

import { formatCurrency, formatNumber, formatRatio, valueColor } from '@/components/vr-simulator/formatters'
import { TradeEvent } from '@/lib/backtest/types'

const cellStyle: React.CSSProperties = {
  padding: '0.72rem 0.8rem',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  fontSize: '0.8rem',
  color: '#dbe4f0',
  whiteSpace: 'nowrap',
}

export default function TradeLogTable({
  trades,
}: {
  trades: TradeEvent[]
}) {
  return (
    <section
      style={{
        borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(15,20,30,0.92)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '1rem 1rem 0.8rem' }}>
        <div style={{ fontSize: '0.98rem', fontWeight: 700, color: '#f3f4f6' }}>Trade Log</div>
        <div style={{ color: '#8ea1b9', fontSize: '0.78rem', marginTop: 4 }}>
          Executed orders with post-trade account state.
        </div>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 520 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1280 }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
              {[
                'Date',
                'Action',
                'Price',
                'Order Amount',
                'Quantity',
                'Cash After',
                'Shares After',
                'Avg Cost',
                'Portfolio After',
                'Target',
                'Upper',
                'Lower',
                'P/V Ratio',
                'Realized PnL',
                'Reason',
              ].map((header) => (
                <th
                  key={header}
                  style={{
                    ...cellStyle,
                    color: '#8ea1b9',
                    fontSize: '0.74rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    textAlign: 'left',
                    position: 'sticky',
                    top: 0,
                    background: 'rgba(17,22,32,0.98)',
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id}>
                <td style={cellStyle}>{trade.date}</td>
                <td style={{ ...cellStyle, color: trade.action === 'SELL' ? '#fca5a5' : '#86efac', fontWeight: 700 }}>
                  {trade.action}
                </td>
                <td style={cellStyle}>{formatCurrency(trade.price)}</td>
                <td style={cellStyle}>{formatCurrency(trade.orderAmount)}</td>
                <td style={cellStyle}>{formatNumber(trade.quantity, 4)}</td>
                <td style={cellStyle}>{formatCurrency(trade.cashAfterTrade)}</td>
                <td style={cellStyle}>{formatNumber(trade.sharesAfterTrade, 4)}</td>
                <td style={cellStyle}>{formatCurrency(trade.avgCostAfterTrade)}</td>
                <td style={cellStyle}>{formatCurrency(trade.portfolioValueAfterTrade)}</td>
                <td style={cellStyle}>{formatCurrency(trade.targetValue)}</td>
                <td style={cellStyle}>{formatCurrency(trade.upperBand)}</td>
                <td style={cellStyle}>{formatCurrency(trade.lowerBand)}</td>
                <td style={cellStyle}>{formatRatio(trade.pvRatio)}</td>
                <td style={{ ...cellStyle, color: valueColor(trade.realizedPnl) }}>{formatCurrency(trade.realizedPnl)}</td>
                <td style={{ ...cellStyle, whiteSpace: 'normal', minWidth: 180 }}>{trade.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

