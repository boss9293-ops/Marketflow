import fs from 'fs/promises'
import path from 'path'

type Feature = { feature: string; contribution: number; direction?: string }
type PredPack = {
  preds?: {
    pred_up_2d?: number
    pred_up_5d?: number
    pred_up_10d?: number
    label_2d?: string
    label_5d?: string
    label_10d?: string
    confidence_label?: string
  }
  tail?: {
    prob_mdd_le_3_5d?: number
    prob_mdd_le_5_5d?: number
    prob_vol_high_5d?: number
  }
  metrics?: any
  drivers?: Feature[]
}

type MlCache = {
  date?: string | null
  spy?: PredPack
  qqq?: PredPack
  recent_strip?: any
  action?: { mode?: string; text_ko?: string; reasons?: string[] }
  data_version?: string
  generated_at?: string
  rerun_hint?: string
}

const FALLBACK: MlCache = {
  date: null,
  spy: {},
  qqq: {},
  recent_strip: {},
  action: { mode: 'NEUTRAL', text_ko: '예측 데이터가 없어 중립 상태로 표시합니다.', reasons: [] },
  data_version: 'ml_prediction_v2.1',
  rerun_hint: 'python backend/scripts/build_ml_prediction.py',
}

async function readCache(): Promise<MlCache> {
  const candidates = [
    path.resolve(process.cwd(), '..', 'backend', 'output', 'cache', 'ml_prediction.json'),
    path.resolve(process.cwd(), 'backend', 'output', 'cache', 'ml_prediction.json'),
    path.resolve(process.cwd(), '..', 'output', 'cache', 'ml_prediction.json'),
    path.resolve(process.cwd(), 'output', 'cache', 'ml_prediction.json'),
  ]
  for (const p of candidates) {
    try {
      const t = await fs.readFile(p, 'utf-8')
      return JSON.parse(t) as MlCache
    } catch {
      // try next
    }
  }
  return FALLBACK
}

function card() {
  return {
    background: 'linear-gradient(145deg, #17181c 0%, #141518 100%)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: '0.95rem 1rem',
  } as const
}

function pct(v?: number) {
  if (typeof v !== 'number') return '-'
  return `${(v * 100).toFixed(1)}%`
}

function modeColor(mode?: string) {
  if (mode === 'OFFENSIVE') return '#22c55e'
  if (mode === 'DEFENSIVE') return '#ef4444'
  return '#f59e0b'
}

function sideColor(label?: string) {
  if (label === 'Bullish') return '#22c55e'
  if (label === 'Bearish') return '#ef4444'
  return '#f59e0b'
}

function StripLine({ title, val }: { title: string; val: any }) {
  return (
    <div style={{ fontSize: '0.76rem', color: '#d1d5db', display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: '#9ca3af' }}>{title}</span>
      <span>{typeof val === 'number' ? `${(val * 100).toFixed(1)}%` : '-'}</span>
    </div>
  )
}

function PredCard({ name, pack }: { name: string; pack?: PredPack }) {
  const p = pack?.preds || {}
  const t = pack?.tail || {}
  const m = pack?.metrics || {}
  const up5m = m?.up_5d || {}
  const d5m = m?.mdd_le_5_5d || {}
  const drivers = (pack?.drivers || []).slice(0, 5)
  return (
    <section style={{ ...card(), display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '1.02rem', color: '#f3f4f6', fontWeight: 800 }}>{name}</div>
        <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>CONF {p.confidence_label || '-'}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
        <div style={card()}>
          <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>Direction</div>
          <div style={{ color: sideColor(p.label_5d), fontWeight: 800, marginTop: 4 }}>{p.label_5d || '-'}</div>
          <div style={{ fontSize: '0.76rem', color: '#d1d5db', marginTop: 4 }}>2D {pct(p.pred_up_2d)}</div>
          <div style={{ fontSize: '0.76rem', color: '#d1d5db' }}>5D {pct(p.pred_up_5d)}</div>
          <div style={{ fontSize: '0.76rem', color: '#d1d5db' }}>10D {pct(p.pred_up_10d)}</div>
        </div>
        <div style={card()}>
          <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>Tail Risk</div>
          <div style={{ fontSize: '0.78rem', color: '#fb7185', marginTop: 4 }}>MDD ≤ -5%: {pct(t.prob_mdd_le_5_5d)}</div>
          <div style={{ fontSize: '0.78rem', color: '#f97316' }}>MDD ≤ -3%: {pct(t.prob_mdd_le_3_5d)}</div>
          <div style={{ fontSize: '0.78rem', color: '#a78bfa' }}>Vol High: {pct(t.prob_vol_high_5d)}</div>
        </div>
        <div style={card()}>
          <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>Why (Drivers)</div>
          {drivers.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: '0.76rem', marginTop: 6 }}>No drivers</div>
          ) : (
            drivers.map((d, i) => (
              <div key={`${name}-${d.feature}-${i}`} style={{ fontSize: '0.74rem', color: '#d1d5db', lineHeight: 1.45 }}>
                <span style={{ color: '#93c5fd' }}>{d.feature}</span>{' '}
                <span style={{ color: (d.contribution || 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                  {(d.contribution || 0) >= 0 ? '+' : ''}{Number(d.contribution || 0).toFixed(3)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '2px 8px', fontSize: '0.68rem', color: '#9ca3af' }}>
          AUC60 <b style={{ color: '#e5e7eb' }}>{up5m.auc_60d ?? '-'}</b>
        </span>
        <span style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '2px 8px', fontSize: '0.68rem', color: '#9ca3af' }}>
          ACC60 <b style={{ color: '#e5e7eb' }}>{up5m.acc_60d ?? '-'}</b>
        </span>
        <span style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '2px 8px', fontSize: '0.68rem', color: '#9ca3af' }}>
          Brier60 <b style={{ color: '#e5e7eb' }}>{up5m.brier_60d ?? '-'}</b>
        </span>
        <span style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '2px 8px', fontSize: '0.68rem', color: '#9ca3af' }}>
          N60 <b style={{ color: '#e5e7eb' }}>{up5m.n_60d ?? '-'}</b>
        </span>
        <span style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '2px 8px', fontSize: '0.68rem', color: '#9ca3af' }}>
          TailHit60 <b style={{ color: '#e5e7eb' }}>{d5m.tail_signal_hit_rate_60d ?? '-'}</b>
        </span>
      </div>
    </section>
  )
}

export default async function PredictionPage() {
  const c = await readCache()
  const hasData = !!(c.spy && c.qqq && (c.spy.preds || c.qqq.preds))
  const rs = c.recent_strip || {}
  const rss = rs.symbols || {}

  return (
    <div style={{ padding: '1.6rem 1.8rem 2.2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.9rem', fontWeight: 800, color: '#f3f4f6' }}>
          ML <span style={{ color: '#00D9FF' }}>Prediction v2</span>
        </h1>
        <div style={{ marginTop: 4, color: '#6b7280', fontSize: '0.78rem' }}>
          Cache-only | date: {c.date ?? '-'} | version: {c.data_version ?? '-'}
        </div>
      </div>

      {!hasData ? (
        <section style={card()}>
          <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>ml_prediction.json is missing.</div>
          <div style={{ marginTop: 8, color: '#9ca3af', fontSize: '0.82rem' }}>
            rerun: <code style={{ color: '#fcd34d' }}>{c.rerun_hint || 'python backend/scripts/build_ml_prediction.py'}</code>
          </div>
        </section>
      ) : (
        <>
          <section style={{ ...card(), border: `1px solid ${modeColor(c.action?.mode)}55`, background: `linear-gradient(145deg, ${modeColor(c.action?.mode)}12 0%, #15171a 100%)` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ color: '#f3f4f6', fontWeight: 800, fontSize: '1.05rem' }}>Action</div>
              <div style={{ color: modeColor(c.action?.mode), fontWeight: 800, fontSize: '0.9rem' }}>{c.action?.mode || 'NEUTRAL'}</div>
            </div>
            <div style={{ color: '#d1d5db', whiteSpace: 'pre-line', lineHeight: 1.6, marginTop: 8, fontSize: '0.88rem' }}>
              {c.action?.text_ko || '중립 운영을 유지하세요.'}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(c.action?.reasons || []).map((r, i) => (
                <span key={`rsn-${i}`} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '2px 8px', fontSize: '0.7rem', color: '#9ca3af' }}>
                  {r}
                </span>
              ))}
            </div>
          </section>

          <section style={{ ...card() }}>
            <div style={{ color: '#f3f4f6', fontWeight: 700, marginBottom: 8 }}>Recent Strip</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
              <div style={card()}>
                <div style={{ color: '#93c5fd', fontWeight: 700, fontSize: '0.78rem', marginBottom: 6 }}>SPY</div>
                <StripLine title="Hit 2D (60)" val={rss?.SPY?.direction_hit_rate_60d?.['2d']} />
                <StripLine title="Hit 5D (60)" val={rss?.SPY?.direction_hit_rate_60d?.['5d']} />
                <StripLine title="Hit 10D (60)" val={rss?.SPY?.direction_hit_rate_60d?.['10d']} />
                <StripLine title="Tail Hit (60)" val={rss?.SPY?.tail_risk_5d?.hit_rate_60d} />
              </div>
              <div style={card()}>
                <div style={{ color: '#93c5fd', fontWeight: 700, fontSize: '0.78rem', marginBottom: 6 }}>QQQ</div>
                <StripLine title="Hit 2D (60)" val={rss?.QQQ?.direction_hit_rate_60d?.['2d']} />
                <StripLine title="Hit 5D (60)" val={rss?.QQQ?.direction_hit_rate_60d?.['5d']} />
                <StripLine title="Hit 10D (60)" val={rss?.QQQ?.direction_hit_rate_60d?.['10d']} />
                <StripLine title="Tail Hit (60)" val={rss?.QQQ?.tail_risk_5d?.hit_rate_60d} />
              </div>
              <div style={card()}>
                <div style={{ color: '#93c5fd', fontWeight: 700, fontSize: '0.78rem', marginBottom: 6 }}>Overall</div>
                <StripLine title="Avg Hit 2D (60)" val={rs?.overall?.direction_hit_rate_60d?.['2d']} />
                <StripLine title="Avg Hit 5D (60)" val={rs?.overall?.direction_hit_rate_60d?.['5d']} />
                <StripLine title="Avg Hit 10D (60)" val={rs?.overall?.direction_hit_rate_60d?.['10d']} />
                <div style={{ fontSize: '0.76rem', color: '#d1d5db', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#9ca3af' }}>Window Days</span>
                  <span>{rs?.window_days ?? '-'}</span>
                </div>
              </div>
            </div>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
            <PredCard name="SPY" pack={c.spy} />
            <PredCard name="QQQ" pack={c.qqq} />
          </div>
        </>
      )}
    </div>
  )
}
