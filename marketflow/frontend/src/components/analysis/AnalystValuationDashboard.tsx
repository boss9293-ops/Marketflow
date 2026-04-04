'use client'

import React, { useMemo, useState } from 'react'
import { TrendingUp, ArrowUpDown, Info } from 'lucide-react'
import { pickLang, useUiLang } from '@/lib/useLangMode'

export type AnalystRecord = {
  firm: string
  target: number
  rating: 'Buy' | 'Hold' | 'Sell' | 'Overweight' | 'Underweight' | string
  date: string
}

export type HistoricalData = {
  per_avg: number
  per_range: string
  eps_3y: number
}

export type AnalystValuationDashboardProps = {
  symbol?: string
  currentPrice?: number
  analysts?: AnalystRecord[]
  historical?: HistoricalData
}

const DEFAULT_ANALYSTS: AnalystRecord[] = [
  { firm: 'Morgan Stanley', target: 650, rating: 'Overweight', date: '3/23' },
  { firm: 'BofA Securities', target: 600, rating: 'Buy', date: '3/18' },
  { firm: 'Goldman Sachs', target: 580, rating: 'Buy', date: '3/22' },
  { firm: 'JPMorgan', target: 520, rating: 'Hold', date: '3/20' },
  { firm: 'Citigroup', target: 490, rating: 'Hold', date: '3/15' },
]

const ANALYST_TEXT = {
  wallStreetConsensus: { ko: '월가 컨센서스', en: 'Wall Street Consensus' },
  modelCalculation: { ko: '모델 계산식', en: 'Our Model Calculation' },
  summaryLead: { ko: '기관 컨센서스 평균', en: 'Street consensus average sits near' },
  summaryBridge: {
    ko: '수준이며, 역사적 PER 멀티플 기준 방어적 모델은',
    en: 'while a defensive model based on historical P/E points to',
  },
  summaryTail: { ko: '수준을 시사합니다.', en: 'as the conservative line.' },
} as const

export default function AnalystValuationDashboard({
  symbol = 'NVDA',
  currentPrice = 358.00,
  analysts = DEFAULT_ANALYSTS,
  historical = {
    per_avg: 28.4,
    per_range: '22-35x',
    eps_3y: 18.2
  }
}: AnalystValuationDashboardProps) {
  const uiLang = useUiLang()

  // --- Sorting State ---
  const [sortField, setSortField] = useState<keyof AnalystRecord>('target')
  const [sortDesc, setSortDesc] = useState(true)

  // --- Calculations ---
  const ourModelTarget = historical.eps_3y * historical.per_avg
  const validTargets = analysts.filter(a => a.target > 0)
  const avgTarget = validTargets.length > 0 
    ? validTargets.reduce((sum, a) => sum + a.target, 0) / validTargets.length 
    : 0

  const topAnalyst = validTargets.reduce((prev, curr) => (curr.target > prev.target ? curr : prev), { firm: 'N/A', target: 0 })

  const buyCount = analysts.filter(a => ['Buy', 'Overweight', 'Strong Buy'].includes(a.rating)).length
  const buyRatio = analysts.length > 0 ? (buyCount / analysts.length) * 100 : 0

  const calcUpside = (target: number) => {
    if (currentPrice <= 0) return 0
    return ((target - currentPrice) / currentPrice) * 100
  }

  const formatPct = (val: number) => `${val > 0 ? '+' : ''}${val.toFixed(1)}%`
  const formatCur = (val: number) => `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  const getRatingColor = (rating: string) => {
    const r = rating.toLowerCase()
    if (r.includes('buy') || r.includes('overweight')) return 'text-green-400 bg-green-400/10 border-green-500/20'
    if (r.includes('sell') || r.includes('underweight')) return 'text-red-400 bg-red-400/10 border-red-500/20'
    return 'text-gray-300 bg-gray-500/10 border-gray-500/20'
  }

  // Sorted Data
  const sortedAnalysts = useMemo(() => {
    return [...analysts].sort((a, b) => {
      let valA = a[sortField]
      let valB = b[sortField]
      if (typeof valA === 'string' && typeof valB === 'string') {
        const cmp = valA.localeCompare(valB)
        return sortDesc ? -cmp : cmp
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortDesc ? valB - valA : valA - valB
      }
      return 0
    })
  }, [analysts, sortField, sortDesc])

  const toggleSort = (field: keyof AnalystRecord) => {
    if (sortField === field) setSortDesc(!sortDesc)
    else { setSortField(field); setSortDesc(true) }
  }

  // UI Helpers
  const Card = ({ children, className = '' }: { children: React.ReactNode, className?: string }) => (
    <div className={`bg-[#1e2129] border border-white/10 rounded-xl p-5 ${className}`}>
      {children}
    </div>
  )

  return (
    <div className="flex flex-col gap-5 w-full text-[#e8edf9] font-sans antialiased">

      {/* 1. TOP STATS (Consensus Header) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Top Target */}
        <div className="bg-gradient-to-br from-[#1e2129] to-[#14151a] border border-blue-500/20 rounded-xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-[50px] pointer-events-none transition-opacity group-hover:opacity-100 opacity-50"></div>
          <div className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            Highest Target ({topAnalyst.firm})
          </div>
          <div className="flex items-end gap-3 mt-1">
            <span className="text-3xl font-bold tracking-tight text-white">{formatCur(topAnalyst.target)}</span>
            <span className="text-lg font-bold text-blue-400 pb-0.5">{formatPct(calcUpside(topAnalyst.target))}</span>
          </div>
        </div>

        {/* Avg Target */}
        <div className="bg-gradient-to-br from-[#1e2129] to-[#14151a] border border-white/10 rounded-xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gray-500/10 blur-[50px] pointer-events-none transition-opacity group-hover:opacity-100 opacity-50"></div>
          <div className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-gray-500"></span>
            Street Avg Target
          </div>
          <div className="flex items-end gap-3 mt-1">
            <span className="text-3xl font-bold tracking-tight text-white">{formatCur(avgTarget)}</span>
            <span className="text-lg font-bold text-gray-300 pb-0.5">{formatPct(calcUpside(avgTarget))}</span>
          </div>
        </div>

        {/* Our Model */}
        <div className="bg-gradient-to-br from-[#1e2129] to-[#14151a] border border-green-500/30 rounded-xl p-5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/10 blur-[50px] pointer-events-none transition-opacity group-hover:opacity-100 opacity-50"></div>
          <div className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            Our Model (Historical PER)
          </div>
          <div className="flex items-end gap-3 mt-1">
            <span className="text-3xl font-bold tracking-tight text-white">{formatCur(ourModelTarget)}</span>
            <span className="text-lg font-bold text-green-400 pb-0.5">{formatPct(calcUpside(ourModelTarget))}</span>
          </div>
        </div>
      </div>


      {/* 2. MID SECTION: Table & Historical */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* Left: Analyst Table */}
        <Card className="lg:col-span-2 overflow-hidden flex flex-col p-0 border border-white/10">
          <div className="p-5 border-b border-white/10 flex justify-between items-center bg-white/[0.02]">
            <div className="font-bold text-gray-200">
              {pickLang(uiLang, ANALYST_TEXT.wallStreetConsensus.ko, ANALYST_TEXT.wallStreetConsensus.en)}
            </div>
            <div className="text-xs bg-green-500/10 text-green-400 px-3 py-1 rounded-full border border-green-500/20 font-bold">
              {buyRatio.toFixed(0)}% BUY
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-black/20 text-xs text-gray-400 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-4 font-semibold cursor-pointer hover:text-white transition-colors" onClick={() => toggleSort('firm')}>
                    <div className="flex items-center gap-1">Firm <ArrowUpDown size={12} className={sortField === 'firm' ? 'text-blue-400' : 'opacity-50'} /></div>
                  </th>
                  <th className="px-5 py-4 font-semibold cursor-pointer hover:text-white transition-colors" onClick={() => toggleSort('target')}>
                    <div className="flex items-center gap-1">Target <ArrowUpDown size={12} className={sortField === 'target' ? 'text-blue-400' : 'opacity-50'} /></div>
                  </th>
                  <th className="px-5 py-4 font-semibold cursor-pointer hover:text-white transition-colors" onClick={() => toggleSort('rating')}>
                    <div className="flex items-center gap-1">Rating <ArrowUpDown size={12} className={sortField === 'rating' ? 'text-blue-400' : 'opacity-50'} /></div>
                  </th>
                  <th className="px-5 py-4 font-semibold cursor-pointer hover:text-white transition-colors" onClick={() => toggleSort('date')}>
                    <div className="flex items-center gap-1">Date <ArrowUpDown size={12} className={sortField === 'date' ? 'text-blue-400' : 'opacity-50'} /></div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sortedAnalysts.map((a, i) => (
                  <tr key={i} className="hover:bg-white/[0.02] group transition-colors relative cursor-pointer">
                    <td className="px-5 py-4 font-medium text-gray-300">{a.firm}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{formatCur(a.target)}</span>
                        <span className="text-xs text-gray-500 hidden sm:inline-block">({formatPct(calcUpside(a.target))})</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${getRatingColor(a.rating)}`}>
                        {a.rating}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-500 text-xs">{a.date}</td>
                    
                    {/* Hover Tooltip (Simulating Report Link/Summary) */}
                    <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity bg-[#14151a] border border-white/20 text-xs text-gray-300 p-3 rounded-lg shadow-2xl z-20 pointer-events-none -translate-y-full left-1/4 max-w-[200px]">
                      <div className="font-bold text-white mb-1">{a.firm} Update</div>
                      Analyst reiterated {a.rating} rating and issued a target of {formatCur(a.target)}.
                    </div>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Right: Historical Data & Growth Model */}
        <div className="flex flex-col gap-5 lg:col-span-1">
          
          <Card className="flex-1 bg-gradient-to-b from-[#1e2129] to-[#14151a]">
            <div className="text-sm font-bold text-gray-300 mb-5 flex items-center justify-between">
              Historical Valuation
              <TrendingUp size={16} className="text-gray-500" />
            </div>
            
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center border-b border-white/5 pb-3">
                <span className="text-sm text-gray-400">Historical Avg PER</span>
                <span className="font-bold text-lg text-white">{historical.per_avg.toFixed(1)}x</span>
              </div>
              <div className="flex justify-between items-center border-b border-white/5 pb-3">
                <span className="text-sm text-gray-400">Historical Range</span>
                <span className="font-bold text-white">{historical.per_range}</span>
              </div>
            </div>
          </Card>

          <Card className="flex-1 bg-gradient-to-b from-[#1e2129] to-[#14151a] relative group">
            <div className="text-sm font-bold text-gray-300 mb-5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              3Y Growth Model
            </div>
            <div className="absolute top-4 right-4 text-gray-500 cursor-help"><Info size={16}/></div>
            
            <div className="flex flex-col gap-4">
              <div className="flex justify-between items-center border-b border-white/5 pb-3">
                <span className="text-sm text-gray-400">EPS Consensus (3Y)</span>
                <span className="font-bold text-white">{historical.eps_3y.toFixed(1)}</span>
              </div>
              <div className="flex justify-between items-center pt-1">
                <span className="text-sm font-bold text-green-400">Model Target</span>
                <span className="font-bold text-2xl text-green-400">{formatCur(ourModelTarget)}</span>
              </div>
            </div>

            {/* Formula Tooltip */}
            <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity bg-black border border-green-500/30 text-xs text-green-100 p-3 rounded-lg shadow-xl z-20 pointer-events-none bottom-full mb-2 right-0 w-[200px]">
              <span className="font-bold block text-green-300 mb-1">{pickLang(uiLang, ANALYST_TEXT.modelCalculation.ko, ANALYST_TEXT.modelCalculation.en)}:</span>
              3Y EPS ({historical.eps_3y}) x Hist. Avg PER ({historical.per_avg.toFixed(1)}x) = {formatCur(ourModelTarget)}
            </div>
          </Card>

        </div>
      </div>

      {/* 3. BOTTOM SUMMARY */}
      <div className="bg-[#1e2129] border border-[#d4b76a]/30 rounded-xl p-5 mt-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-[#d4b76a]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-[#d4b76a] font-serif font-bold italic">i</span>
          </div>
          <div className="text-[#d4b76a] font-medium text-sm md:text-base tracking-wide leading-relaxed">
            {pickLang(uiLang, ANALYST_TEXT.summaryLead.ko, ANALYST_TEXT.summaryLead.en)}{' '}<strong className="text-white mx-1">{formatCur(avgTarget)}</strong>{' '}{pickLang(uiLang, ANALYST_TEXT.summaryBridge.ko, ANALYST_TEXT.summaryBridge.en)}{' '}<strong className="text-white mx-1">{formatCur(ourModelTarget)}</strong>{' '}{pickLang(uiLang, ANALYST_TEXT.summaryTail.ko, ANALYST_TEXT.summaryTail.en)}
          </div>
        </div>
      </div>

    </div>
  )
}
