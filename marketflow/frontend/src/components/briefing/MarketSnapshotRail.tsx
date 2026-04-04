import type { CSSProperties } from 'react'
import type { StructuredBriefingOutput } from '@/lib/briefing-data'
import { formatPercent } from '@/lib/briefing-data'

type Props = {
  structuredBriefing?: StructuredBriefingOutput | null
}

type SnapshotRow = {
  label: string
  mid: string
  right: string
  pctChange: number | null
}

const CARD_STYLE: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(10,11,16,0.99) 0%, rgba(7,8,12,0.99) 100%)',
  border: '1px solid rgba(148,163,184,0.12)',
  boxShadow: 'none',
}

const MONO: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function cleanText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatLevel(value: number | null): string {
  if (value === null) return '--'
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }
  if (Math.abs(value) >= 100) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function midCellStyle(change: number | null): CSSProperties {
  if (change === null) {
    return {
      color: '#9aa7bb',
    }
  }
  if (change > 0) {
    return {
      color: '#22c55e',
    }
  }
  if (change < 0) {
    return {
      color: '#ef4444',
    }
  }
  return {
    color: '#7dd3fc',
  }
}

function buildRows(structuredBriefing?: StructuredBriefingOutput | null): SnapshotRow[] {
  const levels = structuredBriefing?.market_levels ?? {}
  const snapshot = structuredBriefing?.market_snapshot ?? {}

  const spxPct = toNumber(snapshot.sp500_pct)
  const ndxPct = toNumber(snapshot.nasdaq_pct)
  const us10yLevel = toNumber(levels.us10y_level ?? snapshot.us10y_level ?? snapshot.us10y)
  const wtiLevel = toNumber(levels.oil_level ?? snapshot.oil_level ?? snapshot.oil)
  const nvdaPct = toNumber(snapshot.nvda_pct)
  const techProxyPct = toNumber(snapshot.tech_proxy_pct ?? snapshot.xlk_pct)
  const techProxySymbol = (
    cleanText(snapshot.tech_proxy_symbol) ||
    cleanText(structuredBriefing?.data_source_meta?.tech_proxy_symbol) ||
    'SMH'
  ).toUpperCase()

  return [
    {
      label: 'SPX',
      mid: formatPercent(spxPct),
      right: formatLevel(toNumber(levels.sp500_level ?? snapshot.sp500_level)),
      pctChange: spxPct,
    },
    {
      label: 'NDX',
      mid: formatPercent(ndxPct),
      right: formatLevel(toNumber(levels.nasdaq_level ?? snapshot.nasdaq_level)),
      pctChange: ndxPct,
    },
    {
      label: 'US10Y',
      mid: us10yLevel === null ? '--' : `${us10yLevel.toFixed(2)}%`,
      right: 'yield',
      pctChange: null,
    },
    {
      label: 'WTI',
      mid: formatLevel(wtiLevel),
      right: 'oil',
      pctChange: null,
    },
    {
      label: 'NVDA',
      mid: formatPercent(nvdaPct),
      right: 'mega',
      pctChange: nvdaPct,
    },
    {
      label: techProxySymbol,
      mid: formatPercent(techProxyPct),
      right: 'tech',
      pctChange: techProxyPct,
    },
  ]
}

export default function MarketSnapshotRail({ structuredBriefing }: Props) {
  const rows = buildRows(structuredBriefing)

  return (
    <aside
      style={{
        ...CARD_STYLE,
        width: '100%',
        maxWidth: 336,
        borderRadius: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.65rem 0.8rem',
          borderBottom: '1px solid rgba(148,163,184,0.10)',
          background: 'rgba(255,255,255,0.012)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22d3ee', boxShadow: '0 0 10px #22d3ee88' }} />
          <span
            style={{
              ...MONO,
              color: '#22d3ee',
              fontSize: '0.62rem',
              letterSpacing: '0.22em',
              fontWeight: 800,
              textTransform: 'uppercase',
            }}
          >
            MARKET SNAPSHOT &gt;
          </span>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.015)' }}>
            <th
              style={{
                ...MONO,
                textAlign: 'left',
                padding: '0.4rem 0.65rem',
                color: '#3d4d66',
                fontSize: '0.58rem',
                letterSpacing: '0.14em',
                borderBottom: '1px solid rgba(148,163,184,0.10)',
                borderRight: '1px solid rgba(148,163,184,0.10)',
                fontWeight: 600,
              }}
            >
              Label
            </th>
            <th
              style={{
                ...MONO,
                textAlign: 'center',
                padding: '0.4rem 0.5rem',
                color: '#3d4d66',
                fontSize: '0.58rem',
                letterSpacing: '0.14em',
                borderBottom: '1px solid rgba(148,163,184,0.10)',
                borderRight: '1px solid rgba(148,163,184,0.10)',
                fontWeight: 600,
              }}
            >
              % / Val
            </th>
            <th
              style={{
                ...MONO,
                textAlign: 'right',
                padding: '0.4rem 0.65rem',
                color: '#3d4d66',
                fontSize: '0.58rem',
                letterSpacing: '0.14em',
                borderBottom: '1px solid rgba(148,163,184,0.10)',
                fontWeight: 600,
              }}
            >
              Ref
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const midStyle = midCellStyle(row.pctChange)
            return (
              <tr key={row.label}>
                <td
                  style={{
                    ...MONO,
                    padding: '0.45rem 0.65rem',
                    color: '#8ddcff',
                    fontSize: '0.74rem',
                    fontWeight: 900,
                    letterSpacing: '0.04em',
                    borderTop: '1px solid rgba(148,163,184,0.10)',
                    borderRight: '1px solid rgba(148,163,184,0.10)',
                    textTransform: 'uppercase',
                  }}
                >
                  {row.label}
                </td>
                <td
                  style={{
                    ...MONO,
                    ...midStyle,
                    textAlign: 'center',
                    padding: '0.45rem 0.5rem',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    letterSpacing: '0.02em',
                    borderTop: '1px solid rgba(148,163,184,0.10)',
                    borderRight: '1px solid rgba(148,163,184,0.10)',
                  }}
                >
                  {row.mid}
                </td>
                <td
                  style={{
                    ...MONO,
                    padding: '0.45rem 0.65rem',
                    textAlign: 'right',
                    color: '#9aa7bb',
                    fontSize: '0.68rem',
                    letterSpacing: '0.08em',
                    borderTop: '1px solid rgba(148,163,184,0.10)',
                    textTransform: 'lowercase',
                  }}
                >
                  {row.right}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </aside>
  )
}
