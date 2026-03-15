'use client'

export type TabType = 'chart' | 'valuation' | 'earnings' | 'sentiment'

type Props = {
  activeTab: TabType
  onChange: (tab: TabType) => void
}

const tabs: { key: TabType; label: string }[] = [
  { key: 'chart', label: 'Chart Analysis' },
  { key: 'valuation', label: 'Valuation' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'sentiment', label: 'Sentiment' },
]

export default function TopicTabs({ activeTab, onChange }: Props) {
  return (
    <div className="flex gap-3 border-b border-slate-700 mb-2">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`px-4 py-2 rounded-lg text-sm transition-colors ${
            activeTab === tab.key
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
