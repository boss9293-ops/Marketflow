'use client'

import GlossaryInsightPanel from '@/components/macro/GlossaryInsightPanel'

export default function GlossarySplitPanel({
  windowStart,
  windowEnd,
  lastUpdate,
}: {
  windowStart: string
  windowEnd: string
  lastUpdate: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <GlossaryInsightPanel windowStart={windowStart} windowEnd={windowEnd} lastUpdate={lastUpdate} />
    </div>
  )
}
