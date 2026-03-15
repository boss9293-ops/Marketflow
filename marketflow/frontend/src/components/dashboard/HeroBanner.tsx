import RiskGauge from '@/components/shared/RiskGauge'

export type RiskModeKey = 'GREEN' | 'YELLOW' | 'RED' | 'BLACK'

export interface HeroBannerProps {
  riskMode:   RiskModeKey
  exposure:   string
  leverage:   string
  strategy:   string
  phase:      string
  phaseAlert: boolean
  riskScore:  number
  var95:      number | null
  cvar95:     number | null
  volRatio:   number | null
  actionLine: string
}

const MODE_META: Record<RiskModeKey, { label: string; color: string; bgGrad: string }> = {
  GREEN:  { label: 'GREEN',     color: '#22c55e', bgGrad: 'rgba(34,197,94,0.07)'  },
  YELLOW: { label: 'WATCH',     color: '#eab308', bgGrad: 'rgba(234,179,8,0.08)'  },
  RED:    { label: 'DEFENSIVE', color: '#f97316', bgGrad: 'rgba(249,115,22,0.09)' },
  BLACK:  { label: 'BREAKDOWN', color: '#ef4444', bgGrad: 'rgba(239,68,68,0.10)'  },
}

const PHASE_BADGE: Record<string, { en: string; ko: string; color: string }> = {
  EXPAN: { en: 'EXPANSION',   ko: '확장', color: '#22c55e' },
  RECOV: { en: 'RECOVERY',    ko: '회복', color: '#3b82f6' },
  SLOW:  { en: 'SLOWDOWN',    ko: '둔화', color: '#eab308' },
  CONTR: { en: 'CONTRACTION', ko: '수축', color: '#ef4444' },
}

function fmt(v: number | null | undefined, digits = 2) {
  return v != null && Number.isFinite(v) ? v.toFixed(digits) + '%' : '--'
}

export default function HeroBanner({
  riskMode, exposure, leverage, strategy, phase,
  phaseAlert, riskScore, var95, cvar95, volRatio, actionLine,
}: HeroBannerProps) {
  const meta      = MODE_META[riskMode] ?? MODE_META.GREEN
  const phaseMeta = PHASE_BADGE[phase] ?? { en: phase, ko: phase, color: '#94A3B8' }
  const divBorder = '1px solid rgba(255,255,255,0.07)'

  return (
    <section
      style={{
        background: 'linear-gradient(135deg, ' + meta.bgGrad + ' 0%, #070B10 60%)',
        border: '1px solid ' + meta.color + '22',
        borderRadius: 18,
        overflow: 'hidden',
        minHeight: 160,
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-3" style={{ minHeight: 160 }}>

        {/* LEFT: Risk Mode */}
        <div style={{
          padding: '1.2rem 1.3rem',
          display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center',
          borderRight: divBorder,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: meta.color, boxShadow: '0 0 8px ' + meta.color + '80', flexShrink: 0,
            }} />
            <span style={{
              color: meta.color,
              fontSize: 'clamp(1.5rem, 2.8vw, 2.1rem)',
              fontWeight: 900,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}>
              {meta.label}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ color: '#94A3B8', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em' }}>
              RECOMMENDED EXPOSURE
            </span>
            <span style={{ color: '#F8FAFC', fontSize: '1.05rem', fontWeight: 800 }}>{exposure}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#94A3B8', fontSize: '0.72rem', fontWeight: 700 }}>Leverage:</span>
            <span style={{
              borderRadius: 6,
              background: meta.color + '18',
              border: '1px solid ' + meta.color + '35',
              color: meta.color,
              padding: '2px 9px', fontSize: '0.78rem', fontWeight: 800,
            }}>
              {leverage}
            </span>
          </div>
        </div>

        {/* CENTER: Strategy Line */}
        <div style={{
          padding: '1.2rem 1.3rem',
          display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center',
          borderRight: divBorder,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              borderRadius: 6, background: phaseMeta.color + '18',
              border: '1px solid ' + phaseMeta.color + '35',
              color: phaseMeta.color, padding: '2px 9px', fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em',
            }}>
              {phaseMeta.ko} · {phaseMeta.en}
            </span>
            {phaseAlert && (
              <span style={{
                borderRadius: 6, background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.28)',
                color: '#fca5a5', padding: '2px 9px', fontSize: '0.68rem', fontWeight: 800,
              }}>
                ⚠ 국면 전환 가능
              </span>
            )}
          </div>

          <div style={{
            color: '#F8FAFC',
            fontSize: 'clamp(2.2rem, 4vw, 3.2rem)',
            fontWeight: 900,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}>
            {strategy}
          </div>

          <div style={{ color: '#D8E6F5', fontSize: '0.82rem', lineHeight: 1.45, opacity: 0.9, maxWidth: 290 }}>
            {actionLine}
          </div>
        </div>

        {/* RIGHT: Risk Score + Gauge */}
        <div style={{
          padding: '1rem 1.2rem',
          display: 'flex', flexDirection: 'column', gap: '0.4rem',
          justifyContent: 'center', alignItems: 'center',
        }}>
          <RiskGauge score={riskScore} size={130} />

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>
            {[
              { label: 'VaR95',    val: fmt(var95) },
              { label: 'CVaR95',   val: fmt(cvar95) },
              { label: 'VolRatio', val: volRatio != null && Number.isFinite(volRatio) ? volRatio.toFixed(2) : '--' },
            ].map(({ label, val }) => (
              <div key={label} style={{
                textAlign: 'center', borderRadius: 8,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                padding: '3px 10px',
              }}>
                <div style={{ color: '#94A3B8', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.06em' }}>
                  {label}
                </div>
                <div style={{ color: '#F8FAFC', fontSize: '0.82rem', fontWeight: 800 }}>{val}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  )
}
