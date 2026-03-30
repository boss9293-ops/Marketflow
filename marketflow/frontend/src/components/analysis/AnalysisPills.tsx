'use client'

type StateTone = 'premium' | 'fair' | 'discount'
type ConfidenceTone = 'high' | 'medium' | 'low'

const stateToneClasses: Record<StateTone, string> = {
  premium: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  fair: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
  discount: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
}

const confidenceToneClasses: Record<ConfidenceTone, string> = {
  high: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  medium: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
  low: 'border-rose-400/25 bg-rose-400/10 text-rose-200',
}

function normalizeStateTone(value: string | undefined | null, fallback: StateTone): StateTone {
  const tone = String(value || '').trim().toLowerCase() as StateTone
  return tone === 'premium' || tone === 'fair' || tone === 'discount' ? tone : fallback
}

function normalizeConfidenceTone(value: string | undefined | null, fallback: ConfidenceTone): ConfidenceTone {
  const tone = String(value || '').trim().toLowerCase() as ConfidenceTone
  return tone === 'high' || tone === 'medium' || tone === 'low' ? tone : fallback
}

function titleCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function StatePill({
  label,
  className = '',
}: {
  label?: string | null
  className?: string
}) {
  const tone = normalizeStateTone(label, 'fair')
  return (
    <span
      className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${stateToneClasses[tone]} ${className}`}
    >
      {titleCase(tone)}
    </span>
  )
}

export function ConfidencePill({
  confidence,
  className = '',
}: {
  confidence?: string | null
  className?: string
}) {
  const tone = normalizeConfidenceTone(confidence, 'low')
  return (
    <span
      className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${confidenceToneClasses[tone]} ${className}`}
    >
      {titleCase(tone)} confidence
    </span>
  )
}
