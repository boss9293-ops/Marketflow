'use client'

import { useEffect, useState } from 'react'

interface RiskGaugeProps {
  score: number // 0-100
  size?: number // outer dimension (width = size, height = size/2 + 20)
}

function gaugeColor(s: number) {
  if (s <= 30) return '#22c55e'
  if (s <= 60) return '#eab308'
  if (s <= 80) return '#f97316'
  return '#ef4444'
}

/**
 * Semicircle SVG gauge opening upward.
 * Arc goes from left (180째) through top (270째) to right (0째).
 */
export default function RiskGauge({ score, size = 120 }: RiskGaugeProps) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const id = setTimeout(() => setDisplay(Math.max(0, Math.min(100, score))), 60)
    return () => clearTimeout(id)
  }, [score])

  const thickness = Math.max(8, Math.round(size / 12))
  const r = (size - thickness * 2 - 4) / 2
  const cx = size / 2
  const cy = size / 2
  const svgH = size / 2 + 22

  const bgPath = `M ${(cx - r).toFixed(1)} ${cy} A ${r} ${r} 0 0 1 ${(cx + r).toFixed(1)} ${cy}`

  const clamped = Math.max(0, Math.min(100, display))
  const progressPath = (() => {
    if (clamped <= 0) return null
    if (clamped >= 100) return bgPath
    const angleDeg = 180 + clamped * 1.8
    const angleRad = (angleDeg * Math.PI) / 180
    const ex = cx + r * Math.cos(angleRad)
    const ey = cy + r * Math.sin(angleRad)
    return `M ${(cx - r).toFixed(1)} ${cy} A ${r} ${r} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`
  })()

  const color = gaugeColor(score)
  const label = score <= 30 ? 'LOW' : score <= 60 ? 'MEDIUM' : score <= 80 ? 'HIGH' : 'EXTREME'

  return (
    <svg width={size} height={svgH} viewBox={`0 0 ${size} ${svgH}`} style={{ display: 'block', overflow: 'visible' }}>
      <path d={bgPath} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={thickness} strokeLinecap="round" />

      {progressPath && (
        <path
          d={progressPath}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          style={{ transition: 'all 0.55s cubic-bezier(0.4,0,0.2,1)' }}
        />
      )}

      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        fill={color}
        fontSize={Math.round(size * 0.22)}
        fontWeight={800}
        fontFamily="var(--font-ui-sans)"
        style={{ transition: 'fill 0.4s ease' }}
      >
        {Math.round(clamped)}
      </text>

      <text
        x={cx}
        y={cy + Math.round(size * 0.22) + 2}
        textAnchor="middle"
        fill="rgba(148,163,184,0.7)"
        fontSize={Math.round(size * 0.11)}
        fontFamily="var(--font-ui-sans)"
      >
        /100 - {label}
      </text>
    </svg>
  )
}
