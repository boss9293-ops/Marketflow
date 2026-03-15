'use client'

import { StrategyInputs, ValidationIssue } from '@/lib/backtest/types'

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.04)',
  color: '#f8fafc',
  padding: '0.68rem 0.75rem',
  fontSize: '0.9rem',
}

const labelStyle: React.CSSProperties = {
  color: '#8ea1b9',
  fontSize: '0.74rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '0.35rem',
  display: 'block',
}

function findIssue(field: ValidationIssue['field'], issues: ValidationIssue[]) {
  return issues.find((issue) => issue.field === field)?.message ?? null
}

export default function InputPanel({
  inputs,
  validationIssues,
  symbolOptions,
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
    { key: 'startDate', label: 'Start Date', type: 'date' },
    { key: 'initialCapital', label: 'Initial Capital', type: 'number', min: 1, step: '1' },
    { key: 'rebalanceDays', label: 'Rebalance Days', type: 'number', min: 1, step: '1' },
    { key: 'growthRate', label: 'Growth Rate (%)', type: 'number', min: 0, step: '0.1' },
    { key: 'fixedAdd', label: 'Fixed Add ($)', type: 'number', min: 0, step: '1' },
    { key: 'upperMult', label: 'Upper Multiplier', type: 'number', min: 1.01, step: '0.01' },
    { key: 'lowerMult', label: 'Lower Multiplier', type: 'number', min: 0.01, step: '0.01' },
    { key: 'initialGValue', label: 'Initial G Value', type: 'number', step: '0.1' },
    { key: 'gAnnualIncrement', label: 'Annual G Increment', type: 'number', step: '0.01' },
    { key: 'periodsPerYear', label: 'Periods Per Year', type: 'number', min: 1, step: '1' },
  ]

  return (
    <aside
      style={{
        position: 'sticky',
        top: 16,
        alignSelf: 'start',
        borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(15,20,30,0.92)',
        padding: '1rem',
      }}
    >
      <div style={{ marginBottom: '0.9rem' }}>
        <div style={{ color: '#f8fafc', fontWeight: 800, fontSize: '1.05rem' }}>Simulator Inputs</div>
        <div style={{ color: '#8ea1b9', fontSize: '0.8rem', lineHeight: 1.5, marginTop: '0.35rem' }}>
          Edit parameters and the client reruns the full backtest immediately.
        </div>
      </div>

      <div style={{ display: 'grid', gap: '0.8rem' }}>
        <label>
          <span style={labelStyle}>Symbol</span>
          <select
            value={inputs.symbol}
            onChange={(event) => onChange('symbol', event.target.value)}
            style={inputStyle}
          >
            {symbolOptions.map((option) => (
              <option key={option.symbol} value={option.symbol}>
                {option.symbol} · {option.label}
              </option>
            ))}
          </select>
        </label>

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
                onChange={(event) => {
                  const nextValue =
                    field.type === 'date'
                      ? event.target.value
                      : Number(event.target.value)
                  onChange(field.key, nextValue as StrategyInputs[typeof field.key])
                }}
                style={{
                  ...inputStyle,
                  borderColor: issue ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.10)',
                }}
              />
              {issue ? (
                <div style={{ color: '#fca5a5', fontSize: '0.76rem', marginTop: '0.35rem' }}>{issue}</div>
              ) : null}
            </label>
          )
        })}
      </div>

      {validationIssues.some((issue) => issue.field === 'bars') ? (
        <div
          style={{
            marginTop: '0.9rem',
            borderRadius: 12,
            border: '1px solid rgba(239,68,68,0.18)',
            background: 'rgba(239,68,68,0.08)',
            color: '#fecaca',
            padding: '0.75rem',
            fontSize: '0.8rem',
            lineHeight: 1.5,
          }}
        >
          {findIssue('bars', validationIssues)}
        </div>
      ) : (
        <div
          style={{
            marginTop: '0.9rem',
            borderRadius: 12,
            border: '1px solid rgba(196,255,13,0.14)',
            background: 'rgba(196,255,13,0.06)',
            color: '#d9f99d',
            padding: '0.75rem',
            fontSize: '0.8rem',
            lineHeight: 1.5,
          }}
        >
          Minimum buy order is $50. Fractional shares are enabled. G value is tracked but not used in execution yet.
        </div>
      )}
    </aside>
  )
}

