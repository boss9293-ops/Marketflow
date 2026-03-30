"use client"

import { useEffect, useState } from 'react'

function fmtMult(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '--'
  return `${v.toFixed(1)}x`
}

// ?? Types ??????????????????????????????????????????????????????????????????
type IncomeRow = {
  fiscalYear: string | null
  revenue: number | null; cogs: number | null; grossProfit: number | null
  operatingExpenses: number | null; operatingIncome: number | null
  ebitda: number | null; incomeTaxExpense: number | null
  netIncome: number | null; eps: number | null
  grossMargin: number | null; operatingMargin: number | null; netMargin: number | null
}
type BalanceRow = {
  fiscalYear: string | null; cash: number | null; totalAssets: number | null
  totalDebt: number | null; totalEquity: number | null; netDebt: number | null
}
type RatioRow  = { year: string; pe: number | null; ps: number | null; pb: number | null }
type EpsEstimate = {
  year: string; epsAvg: number | null; epsHigh: number | null; epsLow: number | null
  numAnalysts: number | null; revenueAvg: number | null; isFuture: boolean
}
type FinancialsData = {
  symbol: string; incomeStatements: IncomeRow[]; balanceSheets: BalanceRow[]
  ratioHistory: RatioRow[]; epsEstimates: EpsEstimate[]
  marketCap: number | null; fetchedAt: string
}
type Props = { symbol?: string; fetchKey?: number }

// ?? Formatters ?????????????????????????????????????????????????????????????
function fmtB(v: number | null | undefined, dec = 1): string {
  if (v == null || !isFinite(v)) return '--'
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 1e12) return `${s}$${(a/1e12).toFixed(dec)}T`
  if (a >= 1e9)  return `${s}$${(a/1e9).toFixed(dec)}B`
  if (a >= 1e6)  return `${s}$${(a/1e6).toFixed(dec)}M`
  return `${s}$${a.toLocaleString()}`
}
function fmtPct(v: number | null | undefined, dec = 1): string {
  if (v == null || !isFinite(v)) return '--'
  return `${(v * 100).toFixed(dec)}%`
}

// ?? Design tokens ??????????????????????????????????????????????????????????
const C_REV    = '#3b82f6'
const C_NET    = '#22d3ee'
const C_MARGIN = '#f59e0b'
const C_POS    = '#4ade80'
const C_NEG    = '#f87171'
const C_PE     = '#818cf8'
const C_PS     = '#34d399'
const C_AXIS   = '#cbd5e1'
const C_GRID   = 'rgba(255,255,255,0.10)'
const CARD_BG  = 'rgba(15,23,42,0.82)'
const CARD_HDR = 'rgba(30,41,59,0.72)'

// Hover card: position:fixed, follows mouse via hoverAt()
const HOVER_CARD_BASE: React.CSSProperties = {
  position: 'fixed',
  minWidth: 160,
  maxWidth: 220,
  background: 'rgba(8,15,28,0.96)',
  border: '1px solid rgba(148,163,184,0.20)',
  borderRadius: 10,
  padding: '8px 11px',
  boxShadow: '0 14px 28px rgba(0,0,0,0.40)',
  backdropFilter: 'blur(10px)',
  pointerEvents: 'none',
  zIndex: 9999,
}

function hoverAt(cx: number, cy: number): React.CSSProperties {
  const left = Math.min(cx + 18, window.innerWidth - 240)
  const top  = Math.max(cy - 56, 8)
  return { ...HOVER_CARD_BASE, left, top }
}

// ?? Card ???????????????????????????????????????????????????????????????????
function Card({ title, children, full }: { title: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={{
      background: CARD_BG, border: '1px solid rgba(255,255,255,0.09)',
      borderRadius: 10, overflow: 'hidden', height: '100%',
      display: 'flex', flexDirection: 'column',
      gridColumn: full ? '1 / -1' : undefined,
    }}>
      <div style={{
        padding: '6px 12px 5px', background: CARD_HDR,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        color: '#f1f5f9', fontSize: '0.64rem', fontWeight: 700,
        letterSpacing: '0.09em', textTransform: 'uppercase',
      }}>{title}</div>
      <div style={{ padding: '9px 12px 8px', flex: 1 }}>{children}</div>
    </div>
  )
}

// ?? Auto-scale helpers ?????????????????????????????????????????????????????
function autoScale(vals: (number|null)[], padFrac = 0.20, minRange = 0) {
  const v = vals.filter((x): x is number => x != null && isFinite(x))
  if (!v.length) return { min: 0, max: 1, range: 1, yPos: () => 0 }
  const lo = Math.min(...v), hi = Math.max(...v)
  const pad = Math.max((hi - lo) * padFrac, minRange * 0.1)
  const min = lo - pad, max = hi + pad, range = max - min
  return { min, max, range, yPos: (PT: number, cH: number) => (val: number) => PT + cH * (1 - (val - min) / range) }
}

// ?? Chart 1: Revenue & Earnings ????????????????????????????????????????????
function RevenueTrendChart({ rows }: { rows: IncomeRow[] }) {
  if (!rows.length) return <div style={{ color: '#64748b', fontSize: '0.9rem' }}>No data</div>
  const W = 560, H = 280, PL = 62, PR = 52, PT = 32, PB = 40
  const cW = W - PL - PR, cH = H - PT - PB
  const maxVal = Math.max(...rows.map(r => r.revenue ?? 0), 1)
  const barW   = Math.floor(cW / rows.length * 0.34)
  const gapW   = Math.floor(cW / rows.length)
  const marginVals = rows
    .map((r) => r.netMargin)
    .filter((v): v is number => v != null && isFinite(v))
  const marginMinData = marginVals.length ? Math.min(...marginVals, 0) : 0
  const marginMaxData = marginVals.length ? Math.max(...marginVals, 0.1) : 0.1
  const marginPad = Math.max((marginMaxData - marginMinData) * 0.12, 0.03)
  const marginMin = marginMinData - marginPad
  const marginMax = marginMaxData + marginPad
  const marginRange = Math.max(0.05, marginMax - marginMin)
  const marginY = (v: number) => PT + cH * (1 - (v - marginMin) / marginRange)
  const marginPoints = rows
    .map((r, i) => {
      if (r.netMargin == null || !isFinite(r.netMargin)) return null
      return { x: PL + i * gapW + gapW / 2, y: marginY(r.netMargin), value: r.netMargin }
    })
    .filter((p): p is { x: number; y: number; value: number } => p !== null)
  const marginPts = marginPoints.map((p) => `${p.x},${p.y}`).join(' ')
  const yLbls = [0, 0.5, 1.0].map(f => ({ y: PT + cH*(1-f), lbl: fmtB(maxVal*f, 0) }))
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [mouseCoords, setMouseCoords] = useState<{x:number;y:number}|null>(null)
  const pointXs = rows.map((_, i) => PL + i * gapW + gapW / 2)
  const hoverRow = hoverIndex != null ? rows[hoverIndex] : null
  const hoverX = hoverIndex != null ? pointXs[hoverIndex] : null
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    setMouseCoords({ x: e.clientX, y: e.clientY })
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W
    let best = 0, bestDist = Infinity
    pointXs.forEach((x, i) => { const d = Math.abs(svgX - x); if (d < bestDist) { bestDist = d; best = i } })
    setHoverIndex(best)
  }

  return (
    <div style={{ position: 'relative' }}>
      {hoverRow && mouseCoords && (
        <div style={hoverAt(mouseCoords.x, mouseCoords.y)}>
          <div style={{ color: '#7dd3fc', fontSize: '0.66rem', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700 }}>
            FY{hoverRow.fiscalYear?.slice(-2) ?? '--'}
          </div>
          <div style={{ color: '#f8fafc', fontSize: '0.88rem', fontWeight: 800, marginTop: 3 }}>
            Revenue {fmtB(hoverRow.revenue, 1)}
          </div>
          <div style={{ color: '#cbd5e1', fontSize: '0.78rem', marginTop: 3 }}>
            Net Income {fmtB(hoverRow.netIncome, 1)}
          </div>
          <div style={{ color: C_MARGIN, fontSize: '0.78rem', marginTop: 2 }}>
            Net Margin {fmtPct(hoverRow.netMargin)}
          </div>
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width:'100%', height:'auto', overflow:'visible' }}
        onMouseMove={handleMove}
        onMouseLeave={() => { setHoverIndex(null); setMouseCoords(null) }}
      >
        {yLbls.map((g, i) => (
          <g key={i}>
            <line x1={PL} y1={g.y} x2={W-PR} y2={g.y} stroke={C_GRID} strokeWidth={1}/>
            <text x={PL-6} y={g.y+5} textAnchor="end" fill={C_AXIS} fontSize={10} fontWeight={600}>{g.lbl}</text>
          </g>
        ))}
        {hoverX != null && (
          <line x1={hoverX} y1={PT} x2={hoverX} y2={PT + cH} stroke="rgba(125,211,252,0.18)" strokeWidth={1} />
        )}
        {rows.map((row, i) => {
          const cx   = PL + i*gapW + gapW/2
          const revH = cH*(row.revenue??0)/maxVal
          const netH = cH*Math.max(0,row.netIncome??0)/maxVal
          return (
            <g key={i}>
              <rect x={cx-barW-2} y={PT+cH-revH} width={barW} height={revH}
                fill={C_REV} opacity={hoverIndex === i ? 0.98 : 0.80} rx={0}
                stroke={hoverIndex === i ? 'rgba(255,255,255,0.35)' : 'none'} strokeWidth={hoverIndex === i ? 1 : 0}/>
              {revH > 16 && (
                <text x={cx-barW/2-2} y={PT+cH-revH-5} textAnchor="middle" fill={C_REV} fontSize={8} fontWeight={700}>
                  {fmtB(row.revenue,0)}
                </text>
              )}
              <rect x={cx+2} y={PT+cH-netH} width={barW} height={netH}
                fill={C_NET} opacity={hoverIndex === i ? 1 : 0.90} rx={0}
                stroke={hoverIndex === i ? 'rgba(255,255,255,0.35)' : 'none'} strokeWidth={hoverIndex === i ? 1 : 0}/>
              {netH > 16 && (
                <text x={cx+barW/2+2} y={PT+cH-netH-5} textAnchor="middle" fill={C_NET} fontSize={8} fontWeight={700}>
                  {fmtB(row.netIncome,0)}
                </text>
              )}
              {hoverIndex === i && row.netMargin != null && isFinite(row.netMargin) && (
                <circle cx={cx} cy={marginY(row.netMargin)} r={5} fill={C_MARGIN} stroke="rgba(8,15,28,0.95)" strokeWidth={2} />
              )}
              <text x={cx} y={H-6} textAnchor="middle" fill={C_AXIS} fontSize={10} fontWeight={600}>
                FY{row.fiscalYear?.slice(-2) ?? '?'}
              </text>
            </g>
          )
        })}
        {marginPoints.length > 1 && (
          <>
            <polyline points={marginPts} fill="none" stroke={C_MARGIN} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
            {rows.map((r, i) => {
              if (r.netMargin == null) return null
              const x = PL + i*gapW + gapW/2
              const y = marginY(r.netMargin)
              return (
                <g key={i}>
                  <circle cx={x} cy={y} r={hoverIndex === i ? 5.5 : 4} fill={C_MARGIN} stroke={hoverIndex === i ? 'rgba(255,255,255,0.35)' : 'none'} strokeWidth={hoverIndex === i ? 1 : 0}/>
                  <text x={x} y={y-9} textAnchor="middle" fill={C_MARGIN} fontSize={10} fontWeight={700}>
                    {fmtPct(r.netMargin,0)}
                  </text>
                </g>
              )
            })}
          </>
        )}
        <text x={W-2} y={PT-4} textAnchor="end" fill={C_MARGIN} fontSize={8} fontWeight={700}>Margin</text>
        <text x={W-2} y={PT+10} textAnchor="end" fill={C_MARGIN} fontSize={8}>{`${(marginMin * 100).toFixed(0)}~${(marginMax * 100).toFixed(0)}%`}</text>
      </svg>
      <div style={{ display:'flex', gap:20, justifyContent:'center', marginTop:6 }}>
        {[{color:C_REV,label:'Revenue'},{color:C_NET,label:'Net Income'},{color:C_MARGIN,label:'Net Margin %'}].map(({color,label}) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ width:13, height:13, background:color, borderRadius:3, opacity:0.95 }}/>
            <span style={{ color:'#e2e8f0', fontSize:'0.82rem', fontWeight:500 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ?? Chart 2: Horizontal Waterfall ????????????????????????????????????????
function WaterfallChart({ row }: { row: IncomeRow | null }) {
  if (!row || !row.revenue) return <div style={{ color:'#64748b', fontSize:'0.9rem' }}>No data</div>
  const rev   = row.revenue
  const cogs  = row.cogs ?? (rev - (row.grossProfit ?? rev))
  const gross = row.grossProfit ?? (rev - cogs)
  const opEx  = row.operatingExpenses ?? (gross - (row.operatingIncome ?? gross))
  const opInc = row.operatingIncome ?? (gross - opEx)
  const net   = row.netIncome ?? opInc

  const steps = [
    { label:'Revenue',      value:rev,   isNeg:false, color:C_REV    },
    { label:'-COGS',        value:cogs,  isNeg:true,  color:C_NEG    },
    { label:'Gross Profit', value:gross, isNeg:false, color:C_POS    },
    { label:'-Op. Exp',     value:opEx,  isNeg:true,  color:C_NEG    },
    { label:'Op. Income',   value:opInc, isNeg:false, color:C_POS    },
    { label:'Net Income',   value:net,   isNeg:false, color:'#a78bfa' },
  ]

  const W = 480, ROW_H = 32, PAD_V = 12
  const H = steps.length * ROW_H + PAD_V * 2
  const PL = 86, PR = 90, barAreaW = W - PL - PR

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'auto' }}>
      {steps.map((s, i) => {
        const y   = PAD_V + i * ROW_H
        const pct = s.value / rev
        const bW  = Math.max(2, barAreaW * pct)
        const cy  = y + ROW_H / 2

        return (
          <g key={i}>
            <text x={PL - 6} y={cy + 5} textAnchor="end"
              fill={s.isNeg ? C_NEG : C_AXIS} fontSize={10} fontWeight={s.isNeg ? 600 : 700}>
              {s.label}
            </text>
            <rect x={PL} y={y+4} width={barAreaW} height={ROW_H-8}
              fill="rgba(255,255,255,0.04)" rx={0}/>
            <rect x={PL} y={y+4} width={bW} height={ROW_H-8}
              fill={s.color} opacity={s.isNeg ? 0.70 : 0.85} rx={0}/>
            <text x={PL + bW + 6} y={cy + 5} textAnchor="start"
              fill={s.color} fontSize={10} fontWeight={700}>
              {fmtB(s.value, 1)}
            </text>
            <text x={W - 2} y={cy + 5} textAnchor="end"
              fill="#64748b" fontSize={8}>
              {Math.round(pct * 100)}%
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ?? Chart 3: P/E 쨌 P/S History ????????????????????????????????????????????
function PERatioChart({ rows }: { rows: RatioRow[] }) {
  if (rows.length < 2) return <div style={{ color:'#64748b', fontSize:'0.9rem' }}>No data</div>

  const W = 560, H = 220, PL = 44, PR = 52, PT = 20, PB = 32
  const cH = H - PT - PB, cW = W - PL - PR
  const gapW = cW / (rows.length - 1)

  const peVals = rows.map(r => r.pe).filter((v): v is number => v != null)
  const psVals = rows.map(r => r.ps).filter((v): v is number => v != null)
  if (!peVals.length && !psVals.length) return <div style={{ color:'#64748b', fontSize:'0.9rem' }}>No data</div>
  const { min:peMin, max:peMax, range:peRange } = autoScale(peVals, 0.20, 5)
  const { min:psMin, max:psMax, range:psRange } = autoScale(psVals, 0.20, 2)

  const peY  = (v: number) => PT + cH * (1 - (v - peMin) / peRange)
  const psY  = (v: number) => PT + cH * (1 - (v - psMin) / psRange)

  const pePts = rows.map((r, i) => r.pe != null ? `${PL+i*gapW},${peY(r.pe)}` : null).filter(Boolean).join(' ')
  const psPts = rows.map((r, i) => r.ps != null ? `${PL+i*gapW},${psY(r.ps)}` : null).filter(Boolean).join(' ')
  const pointXs = rows.map((_, i) => PL + i * gapW)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [mouseCoords, setMouseCoords] = useState<{x:number;y:number}|null>(null)
  const hoverRow = hoverIndex != null ? rows[hoverIndex] : null
  const hoverX = hoverIndex != null ? pointXs[hoverIndex] : null
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    setMouseCoords({ x: e.clientX, y: e.clientY })
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W
    let best = 0, bestDist = Infinity
    pointXs.forEach((x, i) => { const d = Math.abs(svgX - x); if (d < bestDist) { bestDist = d; best = i } })
    setHoverIndex(best)
  }

  const peTicks = [peMin, (peMin+peMax)/2, peMax].map(v => Math.round(v))

  return (
    <div style={{ position: 'relative' }}>
      {hoverRow && mouseCoords && (
        <div style={hoverAt(mouseCoords.x, mouseCoords.y)}>
          <div style={{ color: '#7dd3fc', fontSize: '0.66rem', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700 }}>
            FY{hoverRow.year.slice(-2)}
          </div>
          <div style={{ color: '#f8fafc', fontSize: '0.88rem', fontWeight: 800, marginTop: 3 }}>
            P/E {fmtMult(hoverRow.pe)}
          </div>
          <div style={{ color: '#cbd5e1', fontSize: '0.78rem', marginTop: 3 }}>
            P/S {fmtMult(hoverRow.ps)}
          </div>
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width:'100%', height:'auto' }}
        onMouseMove={handleMove}
        onMouseLeave={() => { setHoverIndex(null); setMouseCoords(null) }}
      >
        {peTicks.map((tick, i) => {
          const y = peY(tick)
          return (
            <g key={i}>
              <line x1={PL} y1={y} x2={W-PR} y2={y} stroke={C_GRID} strokeWidth={1}/>
              <text x={PL-5} y={y+5} textAnchor="end" fill={C_PE} fontSize={9} fontWeight={600}>{tick}x</text>
            </g>
          )
        })}
        {hoverX != null && <line x1={hoverX} y1={PT} x2={hoverX} y2={PT + cH} stroke="rgba(125,211,252,0.18)" strokeWidth={1} />}

        {pePts && (
          <>
            <polyline points={pePts} fill="none" stroke={C_PE} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
            {rows.map((r, i) => r.pe != null ? (
              <circle key={i} cx={PL+i*gapW} cy={peY(r.pe)} r={hoverIndex === i ? 5.5 : 4} fill={C_PE} stroke={hoverIndex === i ? 'rgba(255,255,255,0.35)' : 'none'} strokeWidth={hoverIndex === i ? 1 : 0}/>
            ) : null)}
          </>
        )}

        {psPts && (
          <>
            <polyline points={psPts} fill="none" stroke={C_PS} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6,3"/>
            {rows.map((r, i) => r.ps != null ? (
              <circle key={i} cx={PL+i*gapW} cy={psY(r.ps)} r={hoverIndex === i ? 5.5 : 4} fill={C_PS} stroke={hoverIndex === i ? 'rgba(255,255,255,0.35)' : 'none'} strokeWidth={hoverIndex === i ? 1 : 0}/>
            ) : null)}
          </>
        )}

        {[psMin, (psMin+psMax)/2, psMax].map((tick, i) => {
          const y = psY(tick)
          return (
            <text key={i} x={W-PR+5} y={y+5} textAnchor="start"
              fill={C_PS} fontSize={9} fontWeight={600}>{Math.round(tick*10)/10}x</text>
          )
        })}

        {(() => {
          const lastPE = rows[rows.length-1]?.pe
          const lastPS = rows[rows.length-1]?.ps
          const lx = PL + (rows.length-1)*gapW
          return (
            <>
              {lastPE != null && (
                <text x={lx+6} y={peY(lastPE)+5} fill={C_PE} fontSize={9} fontWeight={700}>
                  {Math.round(lastPE)}x
                </text>
              )}
              {lastPS != null && (
                <text x={lx+6} y={psY(lastPS)+5} fill={C_PS} fontSize={9} fontWeight={700}>
                  {Math.round(lastPS*10)/10}x
                </text>
              )}
            </>
          )
        })()}

        {rows.map((r, i) => (
          <text key={i} x={PL+i*gapW} y={H-6} textAnchor="middle" fill={C_AXIS} fontSize={10} fontWeight={600}>
            FY{r.year.slice(-2)}
          </text>
        ))}
      </svg>

      <div style={{ display:'flex', gap:20, justifyContent:'center', marginTop:4 }}>
        {[{color:C_PE,label:'P/E Ratio',dash:false},{color:C_PS,label:'P/S Ratio',dash:true}].map(({color,label,dash}) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:7 }}>
            <svg width={22} height={14}>
              <line x1={0} y1={7} x2={22} y2={7} stroke={color} strokeWidth={2.5}
                strokeDasharray={dash ? '5,3' : undefined}/>
              <circle cx={11} cy={7} r={3.5} fill={color}/>
            </svg>
            <span style={{ color:'#e2e8f0', fontSize:'0.82rem', fontWeight:500 }}>{label}</span>
          </div>
        ))}
        <div style={{ color:'#64748b', fontSize:'0.78rem', alignSelf:'center' }}>Left = P/E, Right = P/S</div>
      </div>
    </div>
  )
}

// ?? Chart 4: EPS History + Forward Estimates ???????????????????????????????
function EpsChart({ rows, estimates }: { rows: IncomeRow[]; estimates: EpsEstimate[] }) {
  const histEps = rows.map(r => ({ year: r.fiscalYear ?? '--', eps: r.eps, isFuture: false }))
  const fwdEps  = estimates.map(e => ({ year: e.year, eps: e.epsAvg, epsH: e.epsHigh, epsL: e.epsLow, isFuture: true }))
  const allItems = [...histEps, ...fwdEps]
  if (!allItems.length) return <div style={{ color:'#64748b', fontSize:'0.9rem' }}>No data</div>

  const W = 560, H = 260, PL = 52, PR = 20, PT = 28, PB = 40
  const cH = H - PT - PB, cW = W - PL - PR
  const allEps = allItems.map(d => d.eps).filter((v): v is number => v != null)
  const fwdMax = fwdEps.map(d => d.epsH).filter((v): v is number => v != null)
  const maxVal = Math.max(...allEps, ...fwdMax, 0.01)
  const minVal = Math.min(...allEps, 0)
  const range  = maxVal - minVal || 1
  const barW   = Math.floor(cW / allItems.length * 0.60)
  const gapW   = cW / allItems.length

  const yP = (v: number) => PT + cH * (1 - (v - minVal) / range)
  const pointXs = allItems.map((_, i) => PL + i * gapW + gapW / 2)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [mouseCoords, setMouseCoords] = useState<{x:number;y:number}|null>(null)
  const hoverItem = hoverIndex != null ? allItems[hoverIndex] : null
  const hoverX = hoverIndex != null ? pointXs[hoverIndex] : null
  const epsHover = hoverItem
    ? (hoverItem as { epsH?: number | null; epsL?: number | null })
    : null
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    setMouseCoords({ x: e.clientX, y: e.clientY })
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W
    let best = 0, bestDist = Infinity
    pointXs.forEach((x, i) => { const d = Math.abs(svgX - x); if (d < bestDist) { bestDist = d; best = i } })
    setHoverIndex(best)
  }

  return (
    <div style={{ position: 'relative' }}>
      {hoverItem && mouseCoords && (
        <div style={hoverAt(mouseCoords.x, mouseCoords.y)}>
          <div style={{ color: '#7dd3fc', fontSize: '0.66rem', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700 }}>
            FY{hoverItem.year.slice(-2)}
          </div>
          <div style={{ color: '#f8fafc', fontSize: '0.88rem', fontWeight: 800, marginTop: 3 }}>
            EPS {hoverItem.eps != null ? `$${hoverItem.eps.toFixed(2)}` : '--'}
          </div>
          {hoverItem.isFuture ? (
            <div style={{ color: '#cbd5e1', fontSize: '0.76rem', marginTop: 3 }}>Consensus estimate</div>
          ) : (
            <div style={{ color: '#cbd5e1', fontSize: '0.76rem', marginTop: 3 }}>Reported EPS</div>
          )}
          {hoverItem.isFuture && epsHover?.epsH != null && epsHover?.epsL != null && (
            <div style={{ color: '#a78bfa', fontSize: '0.76rem', marginTop: 2 }}>
              Range {`$${epsHover.epsL.toFixed(2)} ~ $${epsHover.epsH.toFixed(2)}`}
            </div>
          )}
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width:'100%', height:'auto', overflow:'visible' }}
        onMouseMove={handleMove}
        onMouseLeave={() => { setHoverIndex(null); setMouseCoords(null) }}
      >
        {[minVal, (minVal+maxVal)/2, maxVal].map((v, i) => {
          const y = yP(v)
          return (
            <g key={i}>
              <line x1={PL} y1={y} x2={W-PR} y2={y} stroke={C_GRID} strokeWidth={1}/>
              <text x={PL-6} y={y+5} textAnchor="end" fill={C_AXIS} fontSize={10} fontWeight={600}>
                ${v.toFixed(1)}
              </text>
            </g>
          )
        })}
        {hoverX != null && <line x1={hoverX} y1={PT} x2={hoverX} y2={PT + cH} stroke="rgba(125,211,252,0.18)" strokeWidth={1} />}

        {fwdEps.length > 0 && histEps.length > 0 && (() => {
          const divX = PL + histEps.length * gapW - gapW / 2
          return (
            <>
              <line x1={divX} y1={PT} x2={divX} y2={PT+cH} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="4,3"/>
              <text x={divX+4} y={PT+12} fill="#64748b" fontSize={8}>Estimates</text>
            </>
          )
        })()}

        {allItems.map((item, i) => {
          const cx    = PL + i*gapW + gapW/2
          const eps   = item.eps
          if (eps == null) return null
          const barH  = Math.max(2, cH * (eps - minVal) / range)
          const barY  = PT + cH - barH
          const isFwd = item.isFuture
          const color = isFwd ? '#94a3b8' : C_REV

          return (
            <g key={i}>
              {isFwd ? (
                <rect x={cx-barW/2} y={barY} width={barW} height={barH}
                  fill={color} opacity={hoverIndex === i ? 0.45 : 0.32}
                  stroke={color} strokeWidth={hoverIndex === i ? 1.8 : 1.2} rx={0}/>
              ) : (
                <rect x={cx-barW/2} y={barY} width={barW} height={barH}
                  fill={color} opacity={hoverIndex === i ? 0.98 : 0.85} rx={0}
                  stroke={hoverIndex === i ? 'rgba(255,255,255,0.32)' : 'none'}
                  strokeWidth={hoverIndex === i ? 1 : 0}/>
              )}
              <text x={cx} y={barY-5} textAnchor="middle"
                fill={isFwd ? '#94a3b8' : C_REV} fontSize={8} fontWeight={700}>
                ${eps.toFixed(2)}
              </text>
              {hoverIndex === i && (
                <circle cx={cx} cy={barY} r={5.5} fill={isFwd ? '#94a3b8' : C_REV} stroke="rgba(8,15,28,0.95)" strokeWidth={2} />
              )}
              <text x={cx} y={H-6} textAnchor="middle" fill={C_AXIS} fontSize={10} fontWeight={600}>
                FY{item.year.slice(-2)}
              </text>
            </g>
          )
        })}
      </svg>

      <div style={{ display:'flex', gap:20, justifyContent:'center', marginTop:6 }}>
        {[
          { color:C_REV,     label:'EPS Reported',            isFwd:false },
          { color:'#94a3b8', label:'EPS Estimate (Consensus)', isFwd:true  },
        ].map(({ color, label, isFwd }) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:7 }}>
            {isFwd
              ? <svg width={13} height={13}><rect x={1} y={1} width={11} height={11} fill={color} opacity={0.35} stroke={color} strokeWidth={1.4} rx={2}/></svg>
              : <div style={{ width:13, height:13, background:color, borderRadius:3, opacity:0.9 }}/>
            }
            <span style={{ color:'#e2e8f0', fontSize:'0.82rem', fontWeight:500 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ?? Chart 5: Margin Trend ??????????????????????????????????????????????????
function MarginHistoryChart({ rows }: { rows: IncomeRow[] }) {
  if (rows.length < 2) return null
  const W = 560, H = 240, PL = 46, PR = 86, PT = 16, PB = 36
  const cH = H - PT - PB, cW = W - PL - PR
  const gapW = cW / (rows.length - 1)

  type MD = { key: keyof IncomeRow; label: string; color: string }
  const defs: MD[] = [
    { key:'grossMargin',     label:'Gross',     color:'#a78bfa' },
    { key:'operatingMargin', label:'Operating', color:C_MARGIN },
    { key:'netMargin',       label:'Net',       color:C_NET },
  ]

  const allVals = rows.flatMap(r => defs.map(d => r[d.key] as number|null).filter((v): v is number => v != null))
  if (!allVals.length) return null
  const dataMin = Math.min(...allVals), dataMax = Math.max(...allVals)
  const pad = Math.max((dataMax-dataMin)*0.30, 0.04)
  const axMin = Math.max(0, Math.floor((dataMin-pad)/0.05)*0.05)
  const axMax = Math.ceil((dataMax+pad)/0.05)*0.05
  const axRange = axMax - axMin
  const yP = (v: number) => PT + cH*(1-(v-axMin)/axRange)

  const step = axRange <= 0.12 ? 0.02 : axRange <= 0.25 ? 0.05 : 0.10
  const ticks: number[] = []
  let t = Math.ceil(axMin/step)*step
  while (t <= axMax+0.001) { ticks.push(parseFloat(t.toFixed(4))); t += step }

  type LP = { color:string; label:string; value:number; anchorY:number; displayY:number }
  const lines = defs.map(({key,label,color}) => {
    const pts = rows.map((r,i) => {
      const v = r[key] as number|null
      return v != null ? {x:PL+i*gapW, y:yP(v), v} : null
    }).filter(Boolean) as {x:number;y:number;v:number}[]
    return {key:key as string,label,color,pts}
  }).filter(l => l.pts.length >= 2)

  const LBL_H = 30
  const endLabels: LP[] = lines.filter(l => l.pts.length > 0).map(l => {
    const last = l.pts[l.pts.length-1]
    return {color:l.color, label:l.label, value:last.v, anchorY:last.y, displayY:last.y}
  }).sort((a,b) => a.anchorY-b.anchorY)
  for (let i = 1; i < endLabels.length; i++)
    if (endLabels[i].displayY < endLabels[i-1].displayY + LBL_H)
      endLabels[i].displayY = endLabels[i-1].displayY + LBL_H
  const maxDY = PT + cH - 4
  for (let i = endLabels.length-1; i >= 0; i--) {
    if (endLabels[i].displayY + LBL_H > maxDY) endLabels[i].displayY = maxDY - LBL_H
    if (i > 0 && endLabels[i-1].displayY + LBL_H > endLabels[i].displayY)
      endLabels[i-1].displayY = endLabels[i].displayY - LBL_H
  }
  const lX = W - PR + 8
  const pointXs = rows.map((_, i) => PL + i * gapW)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [mouseCoords, setMouseCoords] = useState<{x:number;y:number}|null>(null)
  const hoverRow = hoverIndex != null ? rows[hoverIndex] : null
  const hoverX = hoverIndex != null ? pointXs[hoverIndex] : null
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    setMouseCoords({ x: e.clientX, y: e.clientY })
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W
    let best = 0, bestDist = Infinity
    pointXs.forEach((x, i) => { const d = Math.abs(svgX - x); if (d < bestDist) { bestDist = d; best = i } })
    setHoverIndex(best)
  }

  return (
    <div style={{ position: 'relative' }}>
      {hoverRow && mouseCoords && (
        <div style={hoverAt(mouseCoords.x, mouseCoords.y)}>
          <div style={{ color: '#7dd3fc', fontSize: '0.66rem', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700 }}>
            FY{hoverRow.fiscalYear?.slice(-2) ?? '--'}
          </div>
          <div style={{ color: '#a78bfa', fontSize: '0.82rem', marginTop: 4, fontWeight: 700 }}>Gross {fmtPct(hoverRow.grossMargin, 1)}</div>
          <div style={{ color: C_MARGIN, fontSize: '0.82rem', marginTop: 2, fontWeight: 700 }}>Operating {fmtPct(hoverRow.operatingMargin, 1)}</div>
          <div style={{ color: C_NET, fontSize: '0.82rem', marginTop: 2, fontWeight: 700 }}>Net {fmtPct(hoverRow.netMargin, 1)}</div>
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width:'100%', height:'auto' }}
        onMouseMove={handleMove}
        onMouseLeave={() => { setHoverIndex(null); setMouseCoords(null) }}
      >
      {ticks.map((tick,i) => {
        const y = yP(tick)
        return (
          <g key={i}>
            <line x1={PL} y1={y} x2={W-PR} y2={y} stroke={C_GRID} strokeWidth={1}/>
            <text x={PL-5} y={y+5} textAnchor="end" fill={C_AXIS} fontSize={10} fontWeight={600}>{Math.round(tick*100)}%</text>
          </g>
        )
      })}
      {hoverX != null && <line x1={hoverX} y1={PT} x2={hoverX} y2={PT + cH} stroke="rgba(125,211,252,0.18)" strokeWidth={1} />}
      {lines.map(({key,color,pts}) => (
        <g key={key}>
          <polyline points={pts.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
          {pts.map((p,i) => <circle key={i} cx={p.x} cy={p.y} r={hoverIndex === i ? 5.5 : 4} fill={color} stroke={hoverIndex === i ? 'rgba(255,255,255,0.35)' : 'none'} strokeWidth={hoverIndex === i ? 1 : 0}/>)}
        </g>
      ))}
      {endLabels.map(e => (
        <g key={e.label}>
          <line x1={W-PR-2} y1={e.anchorY} x2={lX+1} y2={e.displayY+7}
            stroke={e.color} strokeWidth={1} opacity={0.45} strokeDasharray="3,2"/>
          <text x={lX} y={e.displayY+5}  fill={e.color} fontSize={10} fontWeight={700}>{e.label}</text>
          <text x={lX} y={e.displayY+19} fill={e.color} fontSize={9}>{fmtPct(e.value,1)}</text>
        </g>
      ))}
      {rows.map((r,i) => (
        <text key={i} x={PL+i*gapW} y={H-6} textAnchor="middle" fill={C_AXIS} fontSize={10} fontWeight={600}>
          FY{r.fiscalYear?.slice(-2) ?? '?'}
        </text>
      ))}
      </svg>
    </div>
  )
}

// ?? Capital Structure ??????????????????????????????????????????????????????
function CapitalStructureCard({ bs, marketCap }: { bs: BalanceRow|null; marketCap: number|null }) {
  if (!bs) return <div style={{ color:'#64748b', fontSize:'0.85rem' }}>No data</div>
  const cash   = bs.cash ?? 0
  const debt   = bs.totalDebt ?? 0
  const equity = marketCap ?? (bs.totalEquity ?? 0)
  const ev     = equity + debt - cash
  // Use equity+debt+cash as denominator so each segment shows its true share
  const total  = Math.max(equity + debt + cash, 1)
  const items = [
    { label:'Market Cap', value:equity, pct: equity / total, color:C_REV },
    { label:'Total Debt',  value:debt,   pct: debt   / total, color:C_NEG },
    { label:'Cash',        value:cash,   pct: cash   / total, color:C_POS },
  ]
  const W = 560, BAR_Y = 6, BAR_H = 22, LEGEND_Y = 36, H = 54
  const PL = 4, PR = 52
  const cW = W - PL - PR

  return (
    <div>
      <div style={{ display:'flex', gap:14, marginBottom:8, flexWrap:'wrap' }}>
        {[
          {label:'Market Cap',       value:equity},
          {label:'Enterprise Value', value:ev},
          {label:'Total Debt',       value:debt},
          {label:'Cash & Equiv.',    value:cash},
        ].map(({label,value}) => (
          <div key={label}>
            <div style={{ color:'#94a3b8', fontSize:'0.63rem', letterSpacing:'0.07em', textTransform:'uppercase' }}>{label}</div>
            <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:'0.90rem' }}>{fmtB(value)}</div>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'auto' }}>
        {/* Background track */}
        <rect x={PL} y={BAR_Y} width={cW} height={BAR_H} fill="rgba(255,255,255,0.05)" rx={0}/>
        {/* Stacked bars + inside labels */}
        {(() => {
          let x = PL
          return items.map((item, i) => {
            const w   = Math.max(2, cW * item.pct)
            const cy  = BAR_Y + BAR_H / 2 + 4
            const pct = `${Math.round(item.pct * 100)}%`
            const el  = (
              <g key={i}>
                <rect x={x} y={BAR_Y} width={w} height={BAR_H} fill={item.color} opacity={0.82}
                  rx={0}/>
                {w > 34 && (
                  <text x={x + w/2} y={cy} textAnchor="middle" fill="#fff" fontSize={9} fontWeight={700}>
                    {pct}
                  </text>
                )}
              </g>
            )
            x += w; return el
          })
        })()}
        {/* External % labels for narrow bars (Total Debt=1, Cash=2) ??stacked right of bar area */}
        {(() => {
          const ws = items.map(item => Math.max(2, cW * item.pct))
          return items.map((item, i) => {
            if (ws[i] > 34) return null   // already shown inside bar
            const labelX = PL + cW + 5
            // Stagger vertically: i=1 (Debt) top, i=2 (Cash) below
            const labelY = BAR_Y + (i === 1 ? 13 : 25)
            return (
              <text key={i} x={labelX} y={labelY} textAnchor="start"
                fill={item.color} fontSize={8} fontWeight={700}>
                {`${Math.round(item.pct * 100)}%`}
              </text>
            )
          })
        })()}
        {/* Legend */}
        {items.map((item, i) => (
          <g key={i}>
            <rect x={PL + i*130} y={LEGEND_Y} width={10} height={10} fill={item.color} rx={2}/>
            <text x={PL + i*130 + 14} y={LEGEND_Y + 9} fill={C_AXIS} fontSize={9} fontWeight={500}>
              {item.label}: {fmtB(item.value)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ?? Key Metrics Table ??????????????????????????????????????????????????????
function MetricsTable({ rows }: { rows: IncomeRow[] }) {
  if (!rows.length) return null
  const latest = rows[rows.length-1]
  const prev   = rows.length > 1 ? rows[rows.length-2] : null
  function g(curr: number|null, p: number|null): string {
    if (curr==null||p==null||p===0) return ''
    const pct = (curr-p)/Math.abs(p)*100
    return `${pct>=0?'+':''}${pct.toFixed(1)}%`
  }
  type Fmt = (v: number|null) => string
  const rows2: {label:string;curr:number|null;pv:number|null;fmt:Fmt}[] = [
    {label:'Revenue',          curr:latest.revenue,         pv:prev?.revenue??null,         fmt:v=>fmtB(v)},
    {label:'Gross Profit',     curr:latest.grossProfit,     pv:prev?.grossProfit??null,     fmt:v=>fmtB(v)},
    {label:'Operating Income', curr:latest.operatingIncome, pv:prev?.operatingIncome??null, fmt:v=>fmtB(v)},
    {label:'Net Income',       curr:latest.netIncome,       pv:prev?.netIncome??null,       fmt:v=>fmtB(v)},
    {label:'EPS (Diluted)',    curr:latest.eps,             pv:prev?.eps??null,             fmt:v=>v!=null?`$${v.toFixed(2)}`:'--'},
    {label:'Gross Margin',     curr:latest.grossMargin,     pv:null,                        fmt:v=>fmtPct(v)},
    {label:'Operating Margin', curr:latest.operatingMargin, pv:null,                        fmt:v=>fmtPct(v)},
    {label:'Net Margin',       curr:latest.netMargin,       pv:null,                        fmt:v=>fmtPct(v)},
  ]
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 12px', marginTop:8, paddingTop:8, borderTop:'1px solid rgba(255,255,255,0.08)' }}>
      {rows2.map(({label,curr,pv,fmt}) => {
        const growth = g(curr,pv); const isPos = growth.startsWith('+')
        return (
          <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ color:'#94a3b8', fontSize:'0.76rem' }}>{label}</span>
            <div style={{ textAlign:'right' }}>
              <span style={{ color:'#f1f5f9', fontSize:'0.82rem', fontWeight:700 }}>{fmt(curr)}</span>
              {growth && <span style={{ color:isPos?'#4ade80':'#f87171', fontSize:'0.70rem', marginLeft:5, fontWeight:600 }}>{growth}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ?? Main ??????????????????????????????????????????????????????????????????
export default function FinancialsPanel({ symbol = 'AAPL', fetchKey = 0 }: Props) {
  const [data, setData]       = useState<FinancialsData|null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string|null>(null)

  useEffect(() => {
    const ticker = symbol.trim().toUpperCase() || 'AAPL'
    const ctrl   = new AbortController()
    let alive    = true
    setLoading(true); setError(null)
    fetch(`/api/analyze/financials?symbol=${ticker}`, { signal: ctrl.signal })
      .then(r => r.json()).then(d => { if (alive) setData(d) })
      .catch(err => { if (err?.name==='AbortError'||!alive) return; setError(err?.message??'Failed') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive=false; ctrl.abort() }
  }, [symbol, fetchKey])

  if (loading) return <div style={{ padding:48, textAlign:'center', color:'#94a3b8', fontSize:'0.95rem' }}>Loading financials...</div>
  if (error || !data) return (
    <div style={{ position: 'relative', background: '#080808', borderLeft: '3px solid #FF5C33', overflow: 'hidden', borderRadius: 2, padding: '22px 20px 22px 22px', margin: '1rem', minHeight: 200 }}>
      <div style={{ position: 'absolute', fontSize: 128, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: '#FF5C33', opacity: 0.07, top: 10, right: -10, pointerEvents: 'none', lineHeight: 1, userSelect: 'none' }}>ERR</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
        <span style={{ display: 'inline-block', background: 'rgba(255,92,51,0.09)', color: '#FF5C33', fontSize: 9, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, letterSpacing: '0.8px', padding: '3px 8px', borderRadius: 2, width: 'fit-content' }}>CONNECTION_FAILED</span>
        <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>Unable to load financial data.</div>
        <div style={{ color: '#4a4a4a', fontSize: 11, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.7 }}>{error || 'No data available'}</div>
      </div>
    </div>
  )

  if (!data.incomeStatements && !data.balanceSheets) return (
    <div style={{ position: 'relative', background: '#080808', borderLeft: '3px solid #FF8400', overflow: 'hidden', borderRadius: 2, padding: '22px 20px 22px 22px', margin: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 200 }}>
      <div style={{ position: 'absolute', fontSize: 128, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: '#FF8400', opacity: 0.06, top: 10, right: -10, pointerEvents: 'none', lineHeight: 1, userSelect: 'none' }}>404</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
        <span style={{ display: 'inline-block', background: 'rgba(255,132,0,0.09)', color: '#FF8400', fontSize: 9, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, letterSpacing: '0.8px', padding: '3px 8px', borderRadius: 2, width: 'fit-content' }}>TICKER_NOT_FOUND</span>
        <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>No financial data found.</div>
        <div style={{ color: '#4a4a4a', fontSize: 11, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.7 }}>Financial statements are unavailable for this ticker.</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <div style={{ width: 16, height: 1, background: 'rgba(255,132,0,0.27)' }} />
        <span style={{ color: '#333', fontSize: 9, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '1.5px' }}>AAPL  NVDA  MSFT  QQQ</span>
      </div>
    </div>
  )

  const inc  = data.incomeStatements ?? []
  const bal  = data.balanceSheets ?? []
  const latestInc  = inc.length > 0 ? inc[inc.length-1] : null
  const latestBal  = bal.length > 0 ? bal[bal.length-1] : null
  const latestYear = latestInc?.fiscalYear ?? '--'

  return (
    <div style={{ maxWidth:1280, margin:'0 auto', padding:'2px 0 10px' }}>

      {/* Header */}
      <div style={{
        display:'flex', alignItems:'center', gap:8, marginBottom:8,
        padding:'7px 12px', background:CARD_BG,
        border:'1px solid rgba(255,255,255,0.09)', borderRadius:10,
      }}>
        <span style={{ color:'#f1f5f9', fontWeight:800, fontSize:'1.0rem' }}>{data.symbol}</span>
        <span style={{ color:'#94a3b8', fontSize:'0.82rem' }}>Annual Financials</span>
        <span style={{ marginLeft:'auto', color:'#cbd5e1', fontSize:'0.76rem', fontWeight:600, background:'rgba(255,255,255,0.08)', padding:'2px 8px', borderRadius:5 }}>
          Latest FY: {latestYear}
        </span>
      </div>

      {/* Capital Structure ??full width top */}
      <div style={{ marginBottom:8 }}>
        <Card title="Capital Structure">
          <CapitalStructureCard bs={latestBal} marketCap={data.marketCap}/>
        </Card>
      </div>

      {/* 2-col grid */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(480px,1fr))', gap:8, alignItems:'stretch' }}>

        <Card title="Revenue &amp; Earnings - 5 Year">
          <RevenueTrendChart rows={inc}/>
          <MetricsTable rows={inc}/>
        </Card>

        <Card title={`Profit Waterfall - FY${latestYear}`}>
          <WaterfallChart row={latestInc}/>
        </Card>

        <Card title="P/E / P/S Ratio History - 5 Year">
          <PERatioChart rows={data.ratioHistory}/>
        </Card>

        <Card title="EPS History &amp; Forward Estimates">
          <EpsChart rows={inc} estimates={data.epsEstimates}/>
        </Card>

        <Card title="Margin Trend - 5 Year">
          <MarginHistoryChart rows={inc}/>
        </Card>

      </div>
    </div>
  )
}


