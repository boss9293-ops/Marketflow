interface SparkLineProps {
  data:        number[]
  width?:      number
  height?:     number
  color?:      string
  strokeWidth?: number
}

/**
 * Lightweight SVG polyline sparkline.
 * No external dependencies, server-component safe.
 */
export default function SparkLine({
  data,
  width       = 64,
  height      = 28,
  color       = '#4ade80',
  strokeWidth = 1.5,
}: SparkLineProps) {
  const mid = height / 2

  if (!Array.isArray(data) || data.length < 2) {
    // dashed flat line when no data
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ overflow: 'visible', display: 'block' }}
      >
        <line
          x1={0} y1={mid} x2={width} y2={mid}
          stroke="rgba(148,163,184,0.25)"
          strokeWidth={1}
          strokeDasharray="3,3"
        />
      </svg>
    )
  }

  const pad  = 1
  const w    = width  - pad * 2
  const h    = height - pad * 2
  const min  = Math.min(...data)
  const max  = Math.max(...data)
  const range = max - min || 1

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w + pad
      const y = h - ((v - min) / range) * h + pad
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: 'visible', display: 'block' }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
