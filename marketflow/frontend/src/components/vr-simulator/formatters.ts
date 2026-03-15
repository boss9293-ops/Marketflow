export function formatCurrency(value: number, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatPercent(value: number, digits = 2) {
  return `${formatNumber(value, digits)}%`
}

export function formatRatio(value: number, digits = 2) {
  return `${formatNumber(value, digits)}x`
}

export function formatShortDate(date: string) {
  return date.slice(2)
}

export function valueColor(value: number) {
  if (value > 0) {
    return '#22c55e'
  }
  if (value < 0) {
    return '#ef4444'
  }
  return '#f8fafc'
}

