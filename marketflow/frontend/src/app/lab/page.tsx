import Link from 'next/link'

export default function LabPage() {
  return (
    <div className="min-h-screen bg-[#0b0f14] text-white px-6 py-10">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Crash / Research Lab</h1>
          <p className="text-sm text-slate-400 mt-2">
            Placeholder space for rare-event research and controlled experiments.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: 'Crash Protocol (A)', body: 'Rare event response research area.' },
            { title: 'Backtest Playback', body: 'Case comparison / event marking.' },
            { title: 'Signals Sandbox', body: 'Experimental parameters & overlays.' },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
            >
              <div className="text-sm font-semibold text-slate-100">{card.title}</div>
              <div className="text-xs text-slate-400 mt-2">Coming soon</div>
              <div className="text-xs text-slate-500 mt-2">{card.body}</div>
            </div>
          ))}
        </div>

        <div className="text-xs text-slate-400 leading-relaxed">
          This area is for research/education, not prediction. The main portal is simplified around B (Monitoring OS).
        </div>

        <Link href="/dashboard" className="text-xs text-sky-300 hover:text-sky-200">
          Back to Portal
        </Link>
      </div>
    </div>
  )
}
