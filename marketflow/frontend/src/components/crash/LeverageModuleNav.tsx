import Link from 'next/link'

type NavItem = {
  key: string
  label: string
  href: string
}

const NAV_ITEMS: NavItem[] = [
  { key: 'risk', label: '리스크 관리 엔진', href: '/crash/navigator/engine' },
  { key: 'infinite', label: '무한매수 전략', href: '/crash/navigator/infinite-buy' },
  { key: 'backtests', label: '백테스트 센터', href: '/crash/navigator/backtests' },
  { key: 'templates', label: '전략 템플릿', href: '/crash/navigator/templates' },
  { key: 'playbook', label: '리스크 플레이북', href: '/crash/navigator/playbook' },
]

type Props = {
  activeKey: NavItem['key']
}

export default function LeverageModuleNav({ activeKey }: Props) {
  return (
    <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
      {NAV_ITEMS.map((item) => {
        const active = item.key === activeKey
        return (
          <Link
            key={item.key}
            href={item.href}
            style={{
              background: active ? 'rgba(148,163,184,0.14)' : 'rgba(15,19,28,0.9)',
              color: active ? '#e2e8f0' : '#94a3b8',
              border: `1px solid ${active ? 'rgba(148,163,184,0.4)' : 'rgba(255,255,255,0.06)'}`,
              borderRadius: 999,
              padding: '0.38rem 0.8rem',
              fontSize: '0.8rem',
              letterSpacing: '-0.01em',
              textDecoration: 'none',
            }}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
