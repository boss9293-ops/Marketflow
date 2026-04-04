'use client'

import { useState } from 'react'
import { StrategyInputs, ValidationIssue } from '@/lib/backtest/types'

/* ── Symbol catalog ──────────────────────────────────────────────────── */
const LEVERAGE_SYMBOLS = [
  { symbol: 'TQQQ', label: 'ProShares UltraPro QQQ', factor: '3x' },
  { symbol: 'QLD',  label: 'ProShares Ultra QQQ',    factor: '2x' },
  { symbol: 'SOXL', label: 'Direxion Semi Bull 3X',  factor: '3x' },
  { symbol: 'TECL', label: 'Direxion Tech Bull 3X',  factor: '3x' },
  { symbol: 'UPRO', label: 'ProShares UltraPro S&P500', factor: '3x' },
  { symbol: 'SPXL', label: 'Direxion S&P500 Bull 3X', factor: '3x' },
  { symbol: 'UDOW', label: 'ProShares UltraPro Dow30', factor: '3x' },
  { symbol: 'TNA',  label: 'Direxion Russell2000 Bull 3X', factor: '3x' },
  { symbol: 'LABU', label: 'Direxion Biotech Bull 3X', factor: '3x' },
  { symbol: 'FNGU', label: 'MicroSectors FANG+ 3X',   factor: '3x' },
  { symbol: 'FAS',  label: 'Direxion Financial Bull 3X', factor: '3x' },
  { symbol: 'CURE', label: 'Direxion Healthcare Bull 3X', factor: '3x' },
  { symbol: 'DRN',  label: 'Direxion Real Estate Bull 3X', factor: '3x' },
  { symbol: 'MIDU', label: 'Direxion Mid Cap Bull 3X', factor: '3x' },
  { symbol: 'URTY', label: 'ProShares UltraPro Russell2000', factor: '3x' },
  { symbol: 'UMDD', label: 'ProShares UltraPro MidCap400', factor: '2x' },
  { symbol: 'EDC',  label: 'Direxion EM Bull 3X',    factor: '3x' },
  { symbol: 'HIBL', label: 'Direxion High Beta Bull 3X', factor: '3x' },
  { symbol: 'WEBL', label: 'Direxion Internet Bull 3X', factor: '3x' },
  { symbol: 'DUSL', label: 'Direxion Industrials Bull 3X', factor: '3x' },
]

const TOP20_SYMBOLS = [
  { symbol: 'NVDA',  label: 'NVIDIA' },
  { symbol: 'AAPL',  label: 'Apple' },
  { symbol: 'MSFT',  label: 'Microsoft' },
  { symbol: 'AMZN',  label: 'Amazon' },
  { symbol: 'GOOGL', label: 'Alphabet' },
  { symbol: 'META',  label: 'Meta Platforms' },
  { symbol: 'TSLA',  label: 'Tesla' },
  { symbol: 'AVGO',  label: 'Broadcom' },
  { symbol: 'LLY',   label: 'Eli Lilly' },
  { symbol: 'V',     label: 'Visa' },
  { symbol: 'JPM',   label: 'JPMorgan Chase' },
  { symbol: 'WMT',   label: 'Walmart' },
  { symbol: 'XOM',   label: 'ExxonMobil' },
  { symbol: 'UNH',   label: 'UnitedHealth' },
  { symbol: 'MA',    label: 'Mastercard' },
  { symbol: 'ORCL',  label: 'Oracle' },
  { symbol: 'COST',  label: 'Costco' },
  { symbol: 'HD',    label: 'Home Depot' },
  { symbol: 'NFLX',  label: 'Netflix' },
  { symbol: 'BRK.B', label: 'Berkshire Hathaway' },
]

const INDEX_SYMBOLS = [
  { symbol: 'QQQ',   label: 'Invesco QQQ Trust' },
  { symbol: 'SPY',   label: 'SPDR S&P 500 ETF' },
  { symbol: 'IWM',   label: 'iShares Russell 2000' },
  { symbol: 'DIA',   label: 'SPDR Dow Jones Industrial' },
  { symbol: 'VTI',   label: 'Vanguard Total Market' },
]

type TabKey = 'leverage' | 'top20' | 'index'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'leverage', label: '레버리지 ETF' },
  { key: 'top20',    label: '시총 Top 20' },
  { key: 'index',    label: '지수 ETF' },
]

/* ── Styles ──────────────────────────────────────────────────────────── */
const inputStyle: React.CSSProperties = {
  width: '100%', borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.04)',
  color: '#f8fafc', padding: '0.68rem 0.75rem',
  fontSize: '0.9rem',
}
const labelStyle: React.CSSProperties = {
  color: '#8ea1b9', fontSize: '0.74rem', textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: '0.35rem', display: 'block',
}

function findIssue(field: ValidationIssue['field'], issues: ValidationIssue[]) {
  return issues.find((i) => i.field === field)?.message ?? null
}

/* ── Symbol Picker ───────────────────────────────────────────────────── */
function SymbolPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (sym: string) => void
}) {
  const [tab, setTab] = useState<TabKey>('leverage')

  const symbolList =
    tab === 'leverage' ? LEVERAGE_SYMBOLS
    : tab === 'top20'  ? TOP20_SYMBOLS
    :                    INDEX_SYMBOLS

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.45rem', flexWrap: 'wrap' }}>
        {TABS.map(t => {
          const active = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '0.22rem 0.6rem', borderRadius: 999, fontSize: '0.72rem',
              border: `1px solid ${active ? 'rgba(196,255,13,0.45)' : 'rgba(255,255,255,0.10)'}`,
              background: active ? 'rgba(196,255,13,0.12)' : 'rgba(255,255,255,0.04)',
              color: active ? '#d9f99d' : '#6b7280', cursor: 'pointer',
              fontWeight: active ? 700 : 400, transition: 'all 120ms',
            }}>{t.label}</button>
          )
        })}
      </div>

      {/* Symbol grid */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.3rem',
        maxHeight: 200, overflowY: 'auto',
        background: 'rgba(10,14,24,0.8)', borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.08)', padding: '0.5rem',
      }}>
        {symbolList.map(s => {
          const active = s.symbol === value
          const factor = 'factor' in s ? (s as any).factor as string : null
          return (
            <button key={s.symbol}
              onClick={() => onChange(s.symbol)}
              title={s.label}
              style={{
                padding: '0.25rem 0.55rem', borderRadius: 7, fontSize: '0.78rem',
                border: `1px solid ${active ? 'rgba(196,255,13,0.5)' : 'rgba(255,255,255,0.10)'}`,
                background: active ? 'rgba(196,255,13,0.15)' : 'rgba(255,255,255,0.04)',
                color: active ? '#d9f99d' : '#cbd5e1', cursor: 'pointer',
                fontWeight: active ? 700 : 400, transition: 'all 100ms',
                display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              {s.symbol}
              {factor && (
                <span style={{ color: active ? '#86efac' : '#4b5563', fontSize: '0.65rem' }}>
                  {factor}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Active selection label */}
      <div style={{ color: '#8ea1b9', fontSize: '0.75rem', marginTop: '0.35rem' }}>
        선택: <span style={{ color: '#d9f99d', fontWeight: 700 }}>{value}</span>
        {' · '}
        {[...LEVERAGE_SYMBOLS, ...TOP20_SYMBOLS, ...INDEX_SYMBOLS].find(s => s.symbol === value)?.label ?? ''}
      </div>
    </div>
  )
}

/* ── InputPanel ──────────────────────────────────────────────────────── */
export default function InputPanel({
  inputs,
  validationIssues,
  symbolOptions: _symbolOptions,
  onChange,
}: {
  inputs: StrategyInputs
  validationIssues: ValidationIssue[]
  symbolOptions: Array<{ symbol: string; label: string }>
  onChange: <K extends keyof StrategyInputs>(field: K, value: StrategyInputs[K]) => void
}) {
  const fields: Array<{
    key: keyof StrategyInputs
    label: string
    type?: 'number' | 'date'
    step?: string
    min?: number
  }> = [
    { key: 'startDate',        label: 'Start Date',        type: 'date' },
    { key: 'initialCapital',   label: 'Initial Capital',   type: 'number', min: 1,    step: '1' },
    { key: 'rebalanceDays',    label: 'Rebalance Days',    type: 'number', min: 1,    step: '1' },
    { key: 'growthRate',       label: 'Growth Rate (%)',   type: 'number', min: 0,    step: '0.1' },
    { key: 'fixedAdd',         label: 'Fixed Add ($)',     type: 'number', min: 0,    step: '1' },
    { key: 'upperMult',        label: 'Upper Multiplier',  type: 'number', min: 1.01, step: '0.01' },
    { key: 'lowerMult',        label: 'Lower Multiplier',  type: 'number', min: 0.01, step: '0.01' },
    { key: 'initialGValue',    label: 'Initial G Value',   type: 'number',            step: '0.1' },
    { key: 'gAnnualIncrement', label: 'Annual G Increment',type: 'number',            step: '0.01' },
    { key: 'periodsPerYear',   label: 'Periods Per Year',  type: 'number', min: 1,    step: '1' },
  ]

  return (
    <aside style={{
      position: 'sticky', top: 16, alignSelf: 'start',
      borderRadius: 18, border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(15,20,30,0.92)', padding: '1rem',
    }}>
      <div style={{ marginBottom: '0.9rem' }}>
        <div style={{ color: '#f8fafc', fontWeight: 800, fontSize: '1.05rem' }}>Simulator Inputs</div>
        <div style={{ color: '#8ea1b9', fontSize: '0.8rem', lineHeight: 1.5, marginTop: '0.35rem' }}>
          Edit parameters and the client reruns the full backtest immediately.
        </div>
      </div>

      <div style={{ display: 'grid', gap: '0.8rem' }}>
        {/* Symbol picker */}
        <div>
          <span style={labelStyle}>Symbol</span>
          <SymbolPicker
            value={inputs.symbol}
            onChange={(sym) => onChange('symbol', sym)}
          />
        </div>

        {fields.map((field) => {
          const issue = findIssue(field.key, validationIssues)
          return (
            <label key={field.key}>
              <span style={labelStyle}>{field.label}</span>
              <input
                type={field.type ?? 'number'}
                value={String(inputs[field.key])}
                min={field.min}
                step={field.step}
                onChange={(e) => {
                  const v = field.type === 'date' ? e.target.value : Number(e.target.value)
                  onChange(field.key, v as StrategyInputs[typeof field.key])
                }}
                style={{
                  ...inputStyle,
                  borderColor: issue ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.10)',
                }}
              />
              {issue && (
                <div style={{ color: '#fca5a5', fontSize: '0.76rem', marginTop: '0.35rem' }}>{issue}</div>
              )}
            </label>
          )
        })}
      </div>

      {validationIssues.some(i => i.field === 'bars') ? (
        <div style={{
          marginTop: '0.9rem', borderRadius: 12,
          border: '1px solid rgba(239,68,68,0.18)', background: 'rgba(239,68,68,0.08)',
          color: '#fecaca', padding: '0.75rem', fontSize: '0.8rem', lineHeight: 1.5,
        }}>
          {findIssue('bars', validationIssues)}
        </div>
      ) : (
        <div style={{
          marginTop: '0.9rem', borderRadius: 12,
          border: '1px solid rgba(196,255,13,0.14)', background: 'rgba(196,255,13,0.06)',
          color: '#d9f99d', padding: '0.75rem', fontSize: '0.8rem', lineHeight: 1.5,
        }}>
          Minimum buy order is $50. Fractional shares are enabled.
        </div>
      )}
    </aside>
  )
}
