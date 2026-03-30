'use client'

export type TabType = 'chart' | 'valuation' | 'statistics' | 'financials'

type Props = {
  activeTab: TabType
  onChange: (tab: TabType) => void
}

const MONO = '"JetBrains Mono", monospace'

const tabs: { key: TabType; label: string }[] = [
  { key: 'chart',      label: 'chart_analysis' },
  { key: 'valuation',  label: 'valuation'       },
  { key: 'statistics', label: 'statistics'      },
  { key: 'financials', label: 'financials'      },
]

export default function TopicTabs({ activeTab, onChange }: Props) {
  return (
    <div style={{ display:'flex', alignItems:'center', borderBottom:'1px solid #1F1F1F', gap:0 }}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            style={{
              display:'flex', alignItems:'center', gap:5,
              padding:'12px 18px',
              background:'transparent',
              border:'none',
              borderBottom: isActive ? '2px solid #22C55E' : '2px solid transparent',
              color: isActive ? '#E5E5E5' : '#7A8598',
              fontSize:12,
              fontFamily:MONO,
              fontWeight: isActive ? 500 : 400,
              cursor:'pointer',
              marginBottom:-1,
            }}
          >
            {isActive && <span style={{ color:'#22C55E', fontWeight:600, fontSize:11 }}>{'>'}&nbsp;</span>}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
