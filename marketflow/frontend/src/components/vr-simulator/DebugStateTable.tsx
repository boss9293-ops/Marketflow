'use client'

import { formatCurrency, formatNumber, formatRatio } from '@/components/vr-simulator/formatters'
import { BacktestRow } from '@/lib/backtest/types'

const cellStyle: React.CSSProperties = {
  padding: '0.68rem 0.75rem',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  fontSize: '0.78rem',
  color: '#dbe4f0',
  whiteSpace: 'nowrap',
}

export default function DebugStateTable({
  rows,
}: {
  rows: BacktestRow[]
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
        <div style={{ fontSize: '0.98rem', fontWeight: 700, color: '#f3f4f6' }}>Debug State</div>
        <div style={{ color: '#8ea1b9', fontSize: '0.78rem', marginTop: 4 }}>
          Bar-by-bar portfolio state for parity inspection.
        </div>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 520 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1220 }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
              {[
                'Date',
                'Close',
                'Cash',
                'Shares',
                'Portfolio',
                'Target',
                'Upper',
                'Lower',
                'P/V',
                'Period',
                'G',
                'Buy',
                'Sell',
                'Action',
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
            {rows.map((row) => (
              <tr key={`${row.date}-${row.totalDays}`}>
                <td style={cellStyle}>{row.date}</td>
                <td style={cellStyle}>{formatCurrency(row.close)}</td>
                <td style={cellStyle}>{formatCurrency(row.cash)}</td>
                <td style={cellStyle}>{formatNumber(row.shares, 4)}</td>
                <td style={cellStyle}>{formatCurrency(row.portfolioValue)}</td>
                <td style={cellStyle}>{formatCurrency(row.targetValue)}</td>
                <td style={cellStyle}>{formatCurrency(row.upperBand)}</td>
                <td style={cellStyle}>{formatCurrency(row.lowerBand)}</td>
                <td style={cellStyle}>{formatRatio(row.pvRatio)}</td>
                <td style={cellStyle}>{row.currentPeriod}</td>
                <td style={cellStyle}>{formatNumber(row.currentGValue, 2)}</td>
                <td style={cellStyle}>{formatCurrency(row.buyAmount)}</td>
                <td style={cellStyle}>{formatCurrency(row.sellAmount)}</td>
                <td style={cellStyle}>{row.action ?? '-'}</td>
                <td style={{ ...cellStyle, whiteSpace: 'normal', minWidth: 180 }}>{row.reason ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
