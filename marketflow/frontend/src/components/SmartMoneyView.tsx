'use client'

import { useMemo, useState } from 'react'

export type SmartMoneyItem = {
  symbol: string
  name?: string
  sector?: string
  price?: number | null
  vol_ratio?: number | null
  rs_3m?: number | null
  ret_3m?: number | null
  sma50?: number | null
  sma200?: number | null
  rsi?: number | null
  score?: number | null
  rank?: number | null
  tags?: string[]
}

export type SmartMoneySector = {
  sector: string
  count: number
  avg_score: number
}

export type SmartMoneyCache = {
  date?: string | null
  top?: SmartMoneyItem[]
  watch?: SmartMoneyItem[]
  excluded?: SmartMoneyItem[]
  smart_flow?: {
    leaders80_count?: number
    leaders80_delta_1d?: number | null
    rs_leader_ratio?: number | null
    concentration_level?: string
    acceleration_state?: string
    regime?: string
    shock_prob_30d?: number | null
    tail_sigma?: number | null
    liquidity_state?: string
    breadth_state?: string
    trend_state?: string
    gate_mode?: string
  }
  sectors?: {
    top?: SmartMoneySector[]
    bottom?: SmartMoneySector[]
    all?: SmartMoneySector[]
  }
  coverage?: {
    universe_total?: number
    eligible_with_ohlcv?: number
    scored?: number
    coverage_ratio?: number
  }
  count?: number
  data_version?: string
  generated_at?: string | null
  rerun_hint?: string
}

type SortKey = 'score' | 'vol_ratio' | 'rs_3m' | 'sm_final'
type SortDir = 'asc' | 'desc'
type SmartMoneyViewMode = 'full' | 'drilldown'

function cardStyle() {
  return {
    background: 'linear-gradient(145deg, #17181c 0%, #141518 100%)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: '0.9rem 1rem',
  } as const
}

function fmtPct(v?: number | null, digits = 2) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '-'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`
}

function fmtNum(v?: number | null, digits = 2) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '-'
  return v.toFixed(digits)
}

function scoreColor(score?: number | null) {
  if (typeof score !== 'number') return '#9ca3af'
  if (score >= 75) return '#22c55e'
  if (score >= 60) return '#f59e0b'
  return '#ef4444'
}

function tagStyle(tag: string) {
  if (tag.includes('SURGE')) return { color: '#93c5fd', bg: 'rgba(59,130,246,0.16)', border: 'rgba(59,130,246,0.35)' }
  if (tag.includes('LEADER') || tag.includes('UP')) return { color: '#86efac', bg: 'rgba(34,197,94,0.16)', border: 'rgba(34,197,94,0.35)' }
  if (tag.includes('OVERHEAT') || tag.includes('VOLATILE')) return { color: '#fca5a5', bg: 'rgba(239,68,68,0.16)', border: 'rgba(239,68,68,0.35)' }
  return { color: '#d1d5db', bg: 'rgba(107,114,128,0.18)', border: 'rgba(107,114,128,0.35)' }
}

export default function SmartMoneyView({
  data,
  mode = 'full',
  showScoreDefault = false,
}: {
  data: SmartMoneyCache
  mode?: SmartMoneyViewMode
  showScoreDefault?: boolean
}) {
  const top = data.top || []
  const watch = data.watch || []
  const rows = useMemo(() => [...top, ...watch].slice(0, 50), [top, watch])
  const hasData = rows.length > 0

  const [sortKey, setSortKey] = useState<SortKey>(mode === 'drilldown' ? 'sm_final' : 'score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selected, setSelected] = useState<SmartMoneyItem | null>(rows[0] || null)
  const [showScore, setShowScore] = useState(mode !== 'drilldown' || showScoreDefault)
  const showOverview = mode === 'full'

  const sorted = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => {
      const av =
        sortKey === 'sm_final'
          ? Number((a as any).sm_final ?? (a as any).SM_final ?? -9999)
          : Number((a as any)[sortKey] ?? -9999)
      const bv =
        sortKey === 'sm_final'
          ? Number((b as any).sm_final ?? (b as any).SM_final ?? -9999)
          : Number((b as any)[sortKey] ?? -9999)
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return arr
  }, [rows, sortKey, sortDir])

  function onSort(next: SortKey) {
    if (sortKey === next) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))
      return
    }
    setSortKey(next)
    setSortDir('desc')
  }

  return (
    <div style={{ padding: mode === 'drilldown' ? '1rem' : '1.5rem 1.75rem 2rem', display: 'flex', flexDirection: 'column', gap: '0.95rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: mode === 'drilldown' ? '1.4rem' : '1.9rem', fontWeight: 800, color: '#f3f4f6' }}>
            {mode === 'drilldown' ? (
              <>
                Smart <span style={{ color: '#00D9FF' }}>Flow</span>
              </>
            ) : (
              <>
                Smart <span style={{ color: '#00D9FF' }}>Flow</span> Index
              </>
            )}
          </h1>
          <div style={{ marginTop: 4, color: '#6b7280', fontSize: '0.78rem' }}>
            Cache-only | date: {data.date || '-'} | version: {data.data_version || '-'}
          </div>
        </div>
        {mode === 'drilldown' && (
          <button
            onClick={() => setShowScore((prev) => !prev)}
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.03)',
              color: '#cbd5f5',
              borderRadius: 8,
              padding: '0.35rem 0.6rem',
              fontSize: '0.74rem',
              cursor: 'pointer',
            }}
          >
            Score {showScore ? '숨김' : '표시'}
          </button>
        )}
      </div>
      {mode === 'drilldown' && (
        <div style={{ border: '1px solid rgba(250,204,21,0.25)', background: 'rgba(250,204,21,0.08)', color: '#fef08a', borderRadius: 10, padding: '0.6rem 0.8rem', fontSize: '0.78rem', lineHeight: 1.5 }}>
          이 리스트는 거래량·상대강도·추세 기반 프록시이며 종목 추천이 아닙니다.
        </div>
      )}

      {!hasData ? (
        <section style={cardStyle()}>
          <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>smart_money cache is missing.</div>
          <div style={{ marginTop: 8, color: '#9ca3af', fontSize: '0.82rem' }}>
            rerun: <code style={{ color: '#fcd34d' }}>{data.rerun_hint || 'python backend/scripts/build_smart_money.py'}</code>
          </div>
        </section>
      ) : (
        <>
          {showOverview && (
          <section style={cardStyle()}>
            <div style={{ color: '#f3f4f6', fontWeight: 800, marginBottom: 10 }}>오늘의 Smart Flow Index Top 10</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
              {top.slice(0, 10).map((item) => (
                <button
                  key={item.symbol}
                  onClick={() => setSelected(item)}
                  style={{
                    textAlign: 'left',
                    border: selected?.symbol === item.symbol ? '1px solid rgba(0,217,255,0.38)' : '1px solid rgba(255,255,255,0.08)',
                    background: selected?.symbol === item.symbol ? 'rgba(0,217,255,0.10)' : 'rgba(255,255,255,0.03)',
                    borderRadius: 10,
                    padding: '0.55rem 0.62rem',
                    cursor: 'pointer',
                    minHeight: 92,
                  }}
                >
                  <div style={{ color: '#f4f6fb', fontSize: '0.82rem', fontWeight: 700 }}>{item.symbol}</div>
                  <div style={{ color: '#8b93a8', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name || item.symbol}</div>
                  <div style={{ color: scoreColor(item.score), fontWeight: 800, marginTop: 4 }}>{fmtNum(item.score, 1)}</div>
                  <div style={{ color: '#93a0ba', fontSize: '0.72rem', marginTop: 2 }}>
                    Vol {fmtNum(item.vol_ratio, 2)}x · RS {fmtPct(item.rs_3m)}
                  </div>
                </button>
              ))}
            </div>
          </section>
          )}

          {showOverview && (
          <section style={{ ...cardStyle(), display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
            <div>
              <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>Top Sectors</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(data.sectors?.top || []).map((s) => (
                  <span key={`top-${s.sector}`} style={{ border: '1px solid rgba(34,197,94,0.35)', borderRadius: 999, background: 'rgba(34,197,94,0.14)', color: '#86efac', padding: '2px 9px', fontSize: '0.74rem' }}>
                    {s.sector} ({s.avg_score.toFixed(1)})
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div style={{ color: '#d1d5db', fontWeight: 700, marginBottom: 6 }}>Bottom Sectors</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(data.sectors?.bottom || []).map((s) => (
                  <span key={`bot-${s.sector}`} style={{ border: '1px solid rgba(239,68,68,0.35)', borderRadius: 999, background: 'rgba(239,68,68,0.14)', color: '#fca5a5', padding: '2px 9px', fontSize: '0.74rem' }}>
                    {s.sector} ({s.avg_score.toFixed(1)})
                  </span>
                ))}
              </div>
            </div>
            <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
              Scored: <b style={{ color: '#e5e7eb' }}>{data.coverage?.scored ?? rows.length}</b> / Eligible: <b style={{ color: '#e5e7eb' }}>{data.coverage?.eligible_with_ohlcv ?? '-'}</b>
            </div>
            <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
              Coverage Ratio: <b style={{ color: '#e5e7eb' }}>{typeof data.coverage?.coverage_ratio === 'number' ? `${data.coverage.coverage_ratio.toFixed(1)}%` : '-'}</b>
            </div>
          </section>
          )}

          <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 10 }}>
            <div style={cardStyle()}>
              <div style={{ color: '#f3f4f6', fontWeight: 800, marginBottom: 8 }}>
                {mode === 'drilldown' ? 'Flow List (Debug)' : 'Top 50 (sortable)'}
              </div>
              <div style={{ overflowX: 'auto' }}>
                {mode === 'drilldown' ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontSize: '0.79rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af' }}>
                        <th style={{ textAlign: 'left', padding: '0.44rem 0.35rem' }}>Ticker</th>
                        <th style={{ textAlign: 'left', padding: '0.44rem 0.35rem' }}>Flow Alignment</th>
                        <th style={{ textAlign: 'left', padding: '0.44rem 0.35rem' }}>Environment Fit</th>
                        <th style={{ textAlign: 'left', padding: '0.44rem 0.35rem' }}>Vol Risk</th>
                        <th style={{ textAlign: 'right', padding: '0.44rem 0.35rem' }}>
                          <button onClick={() => onSort('sm_final')} style={{ color: '#9ca3af', background: 'none', border: 0, cursor: 'pointer' }}>
                            SM Final {sortKey === 'sm_final' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((item) => (
                        <tr
                          key={item.symbol}
                          onClick={() => setSelected(item)}
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            cursor: 'pointer',
                            background: selected?.symbol === item.symbol ? 'rgba(0,217,255,0.10)' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '0.46rem 0.35rem', color: '#f3f4f6', fontWeight: 700 }}>{item.symbol}</td>
                          <td style={{ padding: '0.46rem 0.35rem', color: '#d1d5db' }}>{(item as any).flow_alignment || (item as any).FlowAlignment || '-'}</td>
                          <td style={{ padding: '0.46rem 0.35rem', color: '#d1d5db' }}>{(item as any).environment_fit || (item as any).EnvironmentFit || '-'}</td>
                          <td style={{ padding: '0.46rem 0.35rem', color: '#d1d5db' }}>{(item as any).vol_risk || (item as any).VolRisk || '-'}</td>
                          <td style={{ padding: '0.46rem 0.35rem', textAlign: 'right', color: '#94A3B8', fontSize: '0.72rem' }}>
                            {fmtNum((item as any).sm_final ?? (item as any).SM_final, 1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920, fontSize: '0.79rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af' }}>
                        <th style={{ textAlign: 'left', padding: '0.44rem 0.35rem' }}>Rank</th>
                        <th style={{ textAlign: 'left', padding: '0.44rem 0.35rem' }}>Ticker</th>
                        <th style={{ textAlign: 'left', padding: '0.44rem 0.35rem' }}>Name</th>
                        <th style={{ textAlign: 'left', padding: '0.44rem 0.35rem' }}>Sector</th>
                        {showScore && (
                          <th style={{ textAlign: 'right', padding: '0.44rem 0.35rem' }}>
                            <button onClick={() => onSort('score')} style={{ color: '#9ca3af', background: 'none', border: 0, cursor: 'pointer' }}>
                              Score {sortKey === 'score' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                            </button>
                          </th>
                        )}
                        <th style={{ textAlign: 'right', padding: '0.44rem 0.35rem' }}>
                          <button onClick={() => onSort('vol_ratio')} style={{ color: '#9ca3af', background: 'none', border: 0, cursor: 'pointer' }}>
                            Vol Ratio {sortKey === 'vol_ratio' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                          </button>
                        </th>
                        <th style={{ textAlign: 'right', padding: '0.44rem 0.35rem' }}>
                          <button onClick={() => onSort('rs_3m')} style={{ color: '#9ca3af', background: 'none', border: 0, cursor: 'pointer' }}>
                            RS 3M {sortKey === 'rs_3m' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                          </button>
                        </th>
                        <th style={{ textAlign: 'right', padding: '0.44rem 0.35rem' }}>Ret 3M</th>
                        <th style={{ textAlign: 'left', padding: '0.44rem 0.35rem' }}>Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((item) => (
                        <tr
                          key={item.symbol}
                          onClick={() => setSelected(item)}
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            cursor: 'pointer',
                            background: selected?.symbol === item.symbol ? 'rgba(0,217,255,0.10)' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '0.46rem 0.35rem', color: '#9ca3af' }}>{item.rank ?? '-'}</td>
                          <td style={{ padding: '0.46rem 0.35rem', color: '#f3f4f6', fontWeight: 700 }}>{item.symbol}</td>
                          <td style={{ padding: '0.46rem 0.35rem', color: '#d1d5db' }}>{item.name || '-'}</td>
                          <td style={{ padding: '0.46rem 0.35rem', color: '#9ca3af' }}>{item.sector || '-'}</td>
                          {showScore && (
                            <td style={{ padding: '0.46rem 0.35rem', textAlign: 'right', color: scoreColor(item.score), fontWeight: 700 }}>{fmtNum(item.score, 1)}</td>
                          )}
                          <td style={{ padding: '0.46rem 0.35rem', textAlign: 'right', color: '#93c5fd' }}>{fmtNum(item.vol_ratio, 2)}x</td>
                          <td style={{ padding: '0.46rem 0.35rem', textAlign: 'right', color: (item.rs_3m ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>{fmtPct(item.rs_3m)}</td>
                          <td style={{ padding: '0.46rem 0.35rem', textAlign: 'right', color: (item.ret_3m ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>{fmtPct(item.ret_3m)}</td>
                          <td style={{ padding: '0.46rem 0.35rem' }}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {(item.tags || []).slice(0, 3).map((tag) => {
                                const st = tagStyle(tag)
                                return (
                                  <span key={`${item.symbol}-${tag}`} style={{ border: `1px solid ${st.border}`, background: st.bg, color: st.color, borderRadius: 999, padding: '0 7px', fontSize: '0.66rem', lineHeight: '1.25rem' }}>
                                    {tag}
                                  </span>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <aside style={{ ...cardStyle(), minHeight: 420 }}>
              <div style={{ color: '#f3f4f6', fontWeight: 800, marginBottom: 8 }}>
                {mode === 'drilldown' ? 'Detail (Flow Evidence)' : 'Detail Drawer'}
              </div>
              {!selected ? (
                <div style={{ color: '#6b7280', fontSize: '0.82rem' }}>Select a row to inspect details.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div style={{ color: '#f3f4f6', fontWeight: 800, fontSize: '1rem' }}>{selected.symbol}</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>{selected.name || '-'}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6 }}>
                    {showScore && (
                      <>
                        <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>SM Score</div>
                        <div style={{ color: scoreColor(selected.score), fontWeight: 700, textAlign: 'right' }}>{fmtNum(selected.score, 1)}</div>
                      </>
                    )}
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>SM Final</div>
                    <div style={{ color: '#e5e7eb', textAlign: 'right' }}>{fmtNum((selected as any).sm_final ?? (selected as any).SM_final, 1)}</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>Environment Fit</div>
                    <div style={{ color: '#e5e7eb', textAlign: 'right' }}>{(selected as any).environment_fit || (selected as any).EnvironmentFit || '-'}</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>Flow Alignment</div>
                    <div style={{ color: '#e5e7eb', textAlign: 'right' }}>{(selected as any).flow_alignment || (selected as any).FlowAlignment || '-'}</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>Vol Risk</div>
                    <div style={{ color: '#e5e7eb', textAlign: 'right' }}>{(selected as any).vol_risk || (selected as any).VolRisk || '-'}</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>Regime Fit</div>
                    <div style={{ color: '#e5e7eb', textAlign: 'right' }}>{(selected as any).regime_fit || (selected as any).RegimeFit || '-'}</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>Vol Ratio</div>
                    <div style={{ color: '#e5e7eb', textAlign: 'right' }}>{fmtNum(selected.vol_ratio, 2)}x</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>RS 3M</div>
                    <div style={{ color: (selected.rs_3m ?? 0) >= 0 ? '#22c55e' : '#ef4444', textAlign: 'right' }}>{fmtPct(selected.rs_3m)}</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>Ret 3M</div>
                    <div style={{ color: (selected.ret_3m ?? 0) >= 0 ? '#22c55e' : '#ef4444', textAlign: 'right' }}>{fmtPct(selected.ret_3m)}</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>Price</div>
                    <div style={{ color: '#e5e7eb', textAlign: 'right' }}>{fmtNum(selected.price, 2)}</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>SMA50 / SMA200</div>
                    <div style={{ color: '#e5e7eb', textAlign: 'right' }}>{fmtNum(selected.sma50, 2)} / {fmtNum(selected.sma200, 2)}</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>RSI</div>
                    <div style={{ color: '#e5e7eb', textAlign: 'right' }}>{fmtNum(selected.rsi, 1)}</div>
                    <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>Sector</div>
                    <div style={{ color: '#e5e7eb', textAlign: 'right' }}>{selected.sector || '-'}</div>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <div style={{ color: '#9ca3af', fontSize: '0.72rem', marginBottom: 6 }}>Tags</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {(selected.tags || []).map((tag) => {
                        const st = tagStyle(tag)
                        return (
                          <span key={`drawer-${selected.symbol}-${tag}`} style={{ border: `1px solid ${st.border}`, background: st.bg, color: st.color, borderRadius: 999, padding: '1px 8px', fontSize: '0.68rem' }}>
                            {tag}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </section>
        </>
      )}
    </div>
  )
}
