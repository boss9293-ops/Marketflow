'use client'

type ConditionBucketStats = {
  days?: number
  qqq?: { avg5d?: number | null; p10_5d?: number | null; worst_5d?: number | null; worst_10d?: number | null }
  tqqq?: { avg5d?: number | null; p10_5d?: number | null; worst_5d?: number | null; worst_10d?: number | null }
}

export type ConditionStudyCache = {
  generated_at?: string | null
  range?: { start?: string | null; end?: string | null } | null
  thresholds?: Record<string, number | null>
  tqqq_source?: string | null
  buckets?: Record<string, ConditionBucketStats | undefined>
}

type WindowSnapshot = {
  mpsMax?: { value: number; date: string } | null
  vixMax?: { value: number; date: string } | null
  worst5?: {
    qqq?: { value: number; start: string; end: string } | null
    tqqq?: { value: number; start: string; end: string } | null
  } | null
}

export default function ConditionStudyCard({
  conditionStudy,
  windowSnapshot,
}: {
  conditionStudy?: ConditionStudyCache | null
  windowSnapshot?: WindowSnapshot | null
}) {
  const buckets = conditionStudy?.buckets || {}
  const order = ['Calm', 'Watch', 'Pressure', 'High Pressure', 'Any']
  const rows = order.filter((k) => buckets[k])

  return (
    <div className="bg-[#1a1a1a] rounded-2xl p-5 border border-[#2a2a2a]">
      <div className="text-sm font-semibold text-slate-100 mb-3">Condition Study (Environment → Price Reaction)</div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-4">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
          <div className="text-xs text-slate-400">Current Window Snapshot</div>
          <div className="text-slate-100 font-semibold mt-1">
            MPS max {windowSnapshot?.mpsMax ? `${windowSnapshot.mpsMax.value.toFixed(0)} (${windowSnapshot.mpsMax.date})` : '—'}
          </div>
          <div className="text-slate-100 font-semibold">
            VIX max {windowSnapshot?.vixMax ? `${windowSnapshot.vixMax.value.toFixed(2)} (${windowSnapshot.vixMax.date})` : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
          <div className="text-xs text-slate-400">Worst 5D Drop (Window)</div>
          <div className="text-slate-100 font-semibold mt-1">
            QQQ {windowSnapshot?.worst5?.qqq ? `${windowSnapshot.worst5.qqq.value.toFixed(2)}% (${windowSnapshot.worst5.qqq.start} → ${windowSnapshot.worst5.qqq.end})` : '—'}
          </div>
          <div className="text-slate-100 font-semibold">
            TQQQ {windowSnapshot?.worst5?.tqqq ? `${windowSnapshot.worst5.tqqq.value.toFixed(2)}% (${windowSnapshot.worst5.tqqq.start} → ${windowSnapshot.worst5.tqqq.end})` : '—'}
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-400 mb-2">Condition Buckets (2018~current)</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 border-b border-white/10">
              <th className="text-left py-2 pr-3">Condition</th>
              <th className="text-left py-2 pr-3">Days (N)</th>
              <th className="text-left py-2 pr-3">Avg 5D (QQQ)</th>
              <th className="text-left py-2 pr-3">P10 5D (QQQ)</th>
              <th className="text-left py-2 pr-3">Avg 5D (TQQQ)</th>
              <th className="text-left py-2 pr-3">P10 5D (TQQQ)</th>
              <th className="text-left py-2 pr-3">Worst 5D (QQQ)</th>
              <th className="text-left py-2 pr-3">Worst 5D (TQQQ)</th>
              <th className="text-left py-2 pr-3">Worst 10D (QQQ)</th>
              <th className="text-left py-2 pr-3">Worst 10D (TQQQ)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
                <tr>
                  <td className="py-3 text-slate-400" colSpan={10}>No condition study cache found.</td>
                </tr>
            )}
            {rows.map((key) => {
              const row = buckets[key] || {}
              const qqq = row.qqq || {}
              const tqqq = row.tqqq || {}
              return (
                <tr key={key} className="border-b border-white/5 last:border-0">
                  <td className="py-2 pr-3 text-slate-100">{key}</td>
                  <td className="py-2 pr-3 text-slate-300">{row.days ?? '—'}</td>
                  <td className="py-2 pr-3 text-slate-100">{qqq.avg5d != null ? `${qqq.avg5d.toFixed(2)}%` : '—'}</td>
                  <td className="py-2 pr-3 text-slate-300">{qqq.p10_5d != null ? `${qqq.p10_5d.toFixed(2)}%` : '—'}</td>
                  <td className="py-2 pr-3 text-slate-100">{tqqq.avg5d != null ? `${tqqq.avg5d.toFixed(2)}%` : '—'}</td>
                  <td className="py-2 pr-3 text-slate-300">{tqqq.p10_5d != null ? `${tqqq.p10_5d.toFixed(2)}%` : '—'}</td>
                  <td className="py-2 pr-3 text-slate-100 font-semibold">{qqq.worst_5d != null ? `${qqq.worst_5d.toFixed(2)}%` : '—'}</td>
                  <td className="py-2 pr-3 text-slate-100 font-semibold">{tqqq.worst_5d != null ? `${tqqq.worst_5d.toFixed(2)}%` : '—'}</td>
                  <td className="py-2 pr-3 text-slate-100 font-semibold">{qqq.worst_10d != null ? `${qqq.worst_10d.toFixed(2)}%` : '—'}</td>
                  <td className="py-2 pr-3 text-slate-100 font-semibold">{tqqq.worst_10d != null ? `${tqqq.worst_10d.toFixed(2)}%` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-400 mt-3">
        When MPS≥70 or VIX≥25, 5D tails widen meaningfully vs Calm baseline.
      </div>
      <div className="text-[11px] text-slate-500 mt-2">
        이벤트별 결과 비교가 아니라, 조건 기반으로 tail risk가 커지는지를 학습한다.
      </div>
    </div>
  )
}
