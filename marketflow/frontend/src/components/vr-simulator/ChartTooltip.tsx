import { formatCurrency, formatNumber } from '@/components/vr-simulator/formatters'

export default function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) {
    return null
  }

  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(7,10,16,0.96)',
        padding: '0.7rem 0.8rem',
      }}
    >
      <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '0.84rem', marginBottom: '0.45rem' }}>{label}</div>
      {payload.map((item: any) => (
        <div
          key={`${item.dataKey}-${item.name}`}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '0.8rem',
            color: '#cbd5e1',
            fontSize: '0.76rem',
            marginTop: '0.2rem',
          }}
        >
          <span style={{ color: item.color }}>{item.name}</span>
          <span style={{ color: '#f8fafc' }}>
            {String(item.name).toLowerCase().includes('ratio') || String(item.name).toLowerCase().includes('g value')
              ? formatNumber(Number(item.value))
              : formatCurrency(Number(item.value))}
          </span>
        </div>
      ))}
    </div>
  )
}

