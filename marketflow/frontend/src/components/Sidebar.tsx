'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CSSProperties, useEffect, useState, ReactNode } from 'react'
import { ChevronDown, ScanSearch, Home } from 'lucide-react'
import BilLabel from '@/components/BilLabel'
import { UI_TEXT } from '@/lib/uiText'

const homeItem = { href: '/dashboard', label: UI_TEXT.nav.dashboard, icon: 'home' as const }
const newsLabel = ((UI_TEXT.nav as Record<string, { ko: string; en: string }>).news) ?? { ko: '뉴스', en: 'News' }

// ── Zone OS: Market OS ────────────────────────────────────────────────────────
const osItems = [
  { href: '/news', label: newsLabel, subLabel: { ko: '뉴스 → 종목', en: 'News to Stock' }, dot: '#facc15' },
  { href: '/briefing', label: UI_TEXT.nav.briefing, dot: '#a855f7' },
  { href: '/macro', label: UI_TEXT.nav.macro, subLabel: { ko: '환경 압력', en: 'Environment Pressure' }, dot: '#38bdf8' },
  { href: '/chart', label: UI_TEXT.nav.chart, subLabel: { ko: '차트 · 종목 분석', en: 'Chart & Ticker' }, dot: '#22d3ee' },
  { href: '/watchlist', label: UI_TEXT.nav.terminal, dot: '#f59e0b' },
  { href: '/sectors', label: UI_TEXT.nav.sectors, dot: '#14b8a6' },
  { href: '/sectors/rrg', label: UI_TEXT.nav.rrg, subLabel: { ko: '섹터 로테이션 그래프', en: 'Relative Rotation' }, dot: '#14b8a6' },
]

// ── Top Hubs (Moved to top) ──────────────────────────────────────────────────
const topHubItems = [
  { href: '/crash', label: UI_TEXT.nav.crashHub, dot: '#ef4444', subLabel: { ko: '허브 · 제품 선택', en: 'Hub · Select System' }, vrStyle: true },
  { href: '/crash/navigator', label: UI_TEXT.nav.leverageHub, dot: '#f97316', subLabel: { ko: '모듈 허브', en: 'Module Hub' } },
]

// ── Zone RM: 위험관리엔진 ────────────────────────────────────────────────────
const crashItems = [
  { href: '/risk-v1', label: UI_TEXT.nav.standardRisk, dot: '#6366f1', subLabel: { ko: '리스크 환경 가이드', en: 'Risk Environment' } },
]

// ── Zone LV: 레버리지 길들이기 ───────────────────────────────────────────────
const lvItems = [
  { href: '/vr-survival', label: UI_TEXT.nav.vrSurvival, dot: '#a78bfa', subLabel: { ko: 'TQQQ 생존 시스템', en: 'Leverage Survival' } },
  { href: '/backtest', label: UI_TEXT.nav.backtests, dot: '#22c55e', subLabel: { ko: '전략 검증 레퍼런스', en: 'Reference' } },
]

// ── Zone RE: 개인자산관리 ────────────────────────────────────────────────────
const vrTestItems = [
  { href: '/vr-simulator', label: UI_TEXT.nav.vrTest, dot: '#c4ff0d', subLabel: { ko: 'VR G-Value 백테스트', en: 'VR G-Value Backtest' } },
  { href: '/strategy-sim', label: UI_TEXT.nav.strategySim, dot: '#f59e0b', subLabel: { ko: '매수 전략 백테스터', en: 'DCA Backtester' } },
]

const reItems = [
  { href: '/retirement', label: UI_TEXT.nav.retirement, dot: '#86efac', subLabel: { ko: '장기 자산 배분', en: 'Long-term Allocation' } },
  { href: '/portfolio', label: UI_TEXT.nav.portfolio, dot: '#38bdf8', subLabel: { ko: '포지션 관리', en: 'Position Management' } },
  { href: '/my-holdings', label: UI_TEXT.nav.holdings, dot: '#a3e635', subLabel: { ko: '편입 트래킹', en: 'Holdings Tracker' } },
]

// ── Zone TO: Tools ───────────────────────────────────────────────────────────
const toolItems = [
  { href: '/opportunity-signals', label: UI_TEXT.nav.opportunitySignals, subLabel: { ko: 'VCP', en: 'Pattern Scanner' }, dot: '#22c55e', icon: 'scan' as const },
  { href: '/calendar', label: UI_TEXT.nav.calendar, dot: '#84cc16' },
  { href: '/lab', label: UI_TEXT.nav.lab, dot: '#f472b6', subLabel: { ko: 'Crash/Research', en: 'Crash/Research' } },
  {
    href: '/smart-money',
    label: UI_TEXT.nav.smartFlow,
    subLabel: { ko: '프록시 플로우 지수', en: 'Proxy flow index' },
    dot: '#38bdf8',
    tooltip: '기관 데이터(13F)가 아닌 거래량·상대강도·추세의 프록시\n레짐 적합 시 참고용',
  },
]

// ── Zone KR: KR Market (collapsed) ──────────────────────────────────────────
const krItems = [
  { href: '/kr-market', label: UI_TEXT.nav.overview, dot: '#f43f5e' },
  { href: '/kr-market/signals', label: UI_TEXT.nav.signals, dot: '#f59e0b' },
  { href: '/kr-market/ai-history', label: UI_TEXT.nav.aiHistory, dot: '#a855f7' },
  { href: '/kr-market/performance', label: UI_TEXT.nav.performance, dot: '#22c55e' },
]

const baseLinkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.62rem',
  padding: '0.52rem 0.78rem 0.52rem 1.56rem',
  textDecoration: 'none',
  color: '#b8c5d6',
  fontSize: '0.84rem',
  borderRadius: 10,
  margin: '0.1rem 0.5rem',
  transition: 'all 140ms ease',
}

function NavLinks({
  items,
  pathname,
  vrStyle,
  compact,
  onNavigate,
}: {
  items: Array<{ href: string; label: { ko: string; en: string }; subLabel?: { ko: string; en: string }; dot: string; icon?: 'scan' | 'home'; tooltip?: string; vrStyle?: boolean }>
  pathname: string
  vrStyle?: boolean
  compact?: boolean
  onNavigate?: () => void
}) {
  return (
    <nav style={{ marginTop: '0.06rem' }}>
      {items.map((item) => {
        const isActive =
          item.href === '/'
            ? pathname === '/'
            : pathname === item.href || pathname.startsWith(item.href + '/')
        const itemVrStyle = vrStyle || item.vrStyle
        const activeBg = itemVrStyle
          ? 'linear-gradient(90deg, rgba(239,68,68,0.2), rgba(239,68,68,0.06))'
          : 'linear-gradient(90deg, rgba(245,158,11,0.2), rgba(245,158,11,0.06))'
        const activeBorder = itemVrStyle ? 'rgba(239,68,68,0.28)' : 'rgba(245,158,11,0.28)'
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.tooltip}
            style={{
              ...baseLinkStyle,
              color: isActive ? '#f8fbff' : '#b8c5d6',
              background: isActive ? activeBg : 'transparent',
              border: isActive ? `1px solid ${activeBorder}` : '1px solid transparent',
              padding: compact ? '0.52rem 0.62rem 0.52rem 0.9rem' : baseLinkStyle.padding,
              justifyContent: compact ? 'center' : 'flex-start',
            }}
            onClick={onNavigate}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.035)'
                e.currentTarget.style.color = '#f2f6ff'
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = '#b8c5d6'
              }
            }}
          >
            {'icon' in item && item.icon === 'scan' && !compact && (
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 6,
                  background: 'rgba(34,197,94,0.10)',
                  border: '1px solid rgba(34,197,94,0.22)',
                  color: '#86efac',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginLeft: -2,
                }}
              >
                <ScanSearch size={11} />
              </span>
            )}
            {'icon' in item && item.icon === 'home' && (
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 6,
                  background: 'rgba(96,165,250,0.12)',
                  border: '1px solid rgba(96,165,250,0.28)',
                  color: '#93c5fd',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginLeft: -2,
                }}
              >
                <Home size={11} />
              </span>
            )}
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: item.dot,
                boxShadow: `0 0 ${vrStyle ? '10px' : '7px'} ${item.dot}${vrStyle ? 'cc' : '66'}`,
                flexShrink: 0,
              }}
            />
            <span style={{ lineHeight: 1, color: 'inherit', minWidth: 0, display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <BilLabel ko={item.label.ko} en={item.label.en} variant="micro" showEn={!compact} />
              {!compact && 'subLabel' in item && item.subLabel && (
                <span style={{ color: '#9aa8bb', marginTop: 2, lineHeight: 1 }}>
                  <BilLabel ko={item.subLabel.ko} en={item.subLabel.en} variant="micro" showEn={false} />
                </span>
              )}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}

function ZoneHeader({
  icon,
  label,
  badge,
  badgeColor,
  onClick,
  isOpen,
  compact,
}: {
  icon: ReactNode
  label: string
  badge?: string
  badgeColor?: string
  onClick: () => void
  isOpen: boolean
  compact?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        border: '1px solid rgba(148,163,184,0.18)',
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 10,
        color: '#f4f8ff',
        fontWeight: 700,
        padding: '0.55rem 0.7rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        cursor: 'pointer',
        justifyContent: compact ? 'center' : 'flex-start',
      }}
    >
      {icon}
      {!compact && (
        <span
          style={{
            fontSize: '0.82rem',
            letterSpacing: '0.04em',
            color: '#f4f8ff',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      )}
      {badge && (
        <span
          style={{
            marginLeft: compact ? 0 : 'auto',
            fontSize: '0.62rem',
            color: badgeColor || '#c7d2e1',
            border: `1px solid ${badgeColor || '#9ca3af'}44`,
            borderRadius: 999,
            padding: '1px 6px',
            fontWeight: 700,
          }}
        >
          {badge}
        </span>
      )}
      <ChevronDown
        size={13}
        style={{
          marginLeft: compact ? 0 : badge ? 4 : 'auto',
          color: '#8e97ac',
          transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 130ms ease',
          flexShrink: 0,
        }}
      />
    </button>
  )
}

export default function Sidebar({
  compact = false,
  overlay = false,
  open = true,
  onClose,
}: {
  compact?: boolean
  overlay?: boolean
  open?: boolean
  onClose?: () => void
}) {
  const pathname = usePathname() ?? ''
  const [osOpen, setOsOpen] = useState(true)
  const [crashOpen, setCrashOpen] = useState(true)
  const [lvOpen, setLvOpen] = useState(true)
  const [vrTestOpen, setVrTestOpen] = useState(true)
  const [reOpen, setReOpen] = useState(true)
  const [toolsOpen, setToolsOpen] = useState(true)
  const [krOpen, setKrOpen] = useState(false)

  useEffect(() => {
    if (!overlay || !open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlay, open, onClose])

  useEffect(() => {
    if (!overlay || !open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [overlay, open])

  const aside = (
    <aside
      style={{
        width: compact ? 96 : 280,
        minWidth: compact ? 96 : 280,
        height: '100vh',
        overflowY: 'auto',
        background: 'linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-main) 100%)',
        borderRight: '1px solid rgba(255,255,255,0.07)',
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.02)',
        padding: compact ? '0.7rem 0' : '0.92rem 0',
      }}
    >
      {/* Logo */}
      <div style={{ padding: compact ? '0 0.5rem 0.8rem' : '0 0.82rem 0.92rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: compact ? '0.35rem' : '0.62rem', justifyContent: compact ? 'center' : 'flex-start' }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: 'linear-gradient(140deg, #3b82f6, #0ea5e9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#e8f1ff',
              fontWeight: 800,
              fontSize: '0.92rem',
              flexShrink: 0,
            }}
          >
            M
          </div>
          {!compact && (
            <div style={{ color: '#f2f5ff', fontWeight: 800, lineHeight: 1 }}>
              <span style={{ fontSize: '1.25rem' }}>Market</span>
              <span style={{ color: '#3b82f6', fontSize: '1.25rem' }}>Flow</span>
            </div>
          )}
        </div>
      </div>

      {/* ENTRY (Standalone) */}
      <div style={{ padding: compact ? '0.4rem 0.4rem 0.1rem' : '0.5rem 0.5rem 0.2rem' }}>
        <Link
          href="/entry"
          style={{
            width: '100%',
            border: '1px solid rgba(201,168,76,0.25)',
            background: 'rgba(201,168,76,0.06)',
            borderRadius: 10,
            color: '#e8d5a3',
            fontWeight: 700,
            padding: '0.55rem 0.7rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            textDecoration: 'none',
            justifyContent: compact ? 'center' : 'flex-start',
            transition: 'background 0.2s, border-color 0.2s',
          }}
          className="hover:bg-[rgba(201,168,76,0.12)] hover:border-[rgba(201,168,76,0.4)]"
          onClick={overlay ? onClose : undefined}
        >
          <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>⬡</span>
          {!compact && <span style={{ fontSize: '0.82rem', letterSpacing: '0.04em' }}>들어가기</span>}
        </Link>
      </div>

      {/* HOME (Standalone) */}
      <div style={{ padding: compact ? '0.2rem 0.4rem 0.2rem' : '0.3rem 0.5rem 0.3rem' }}>
        <Link
          href={homeItem.href}
          style={{
            width: '100%',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 10,
            color: '#e8edf9',
            fontWeight: 700,
            padding: '0.55rem 0.7rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            textDecoration: 'none',
            justifyContent: compact ? 'center' : 'flex-start',
          }}
          onClick={overlay ? onClose : undefined}
        >
          <Home size={14} />
          {!compact && <span style={{ fontSize: '0.82rem', letterSpacing: '0.04em' }}>HOME</span>}
        </Link>
      </div>

      {/* Top Hubs */}
      <NavLinks items={topHubItems} pathname={pathname} compact={compact} onNavigate={overlay ? onClose : undefined} />

      {/* Zone OS: MARKET OS */}
      <div style={{ padding: compact ? '0.65rem 0.4rem 0.15rem' : '0.78rem 0.5rem 0.2rem' }}>
        <ZoneHeader
          icon={<span style={{ fontSize: '0.82rem' }}>OS</span>}
          label={compact ? 'US' : '미국증시'}
          onClick={() => setOsOpen((p) => !p)}
          isOpen={osOpen}
          compact={compact}
        />
      </div>
      {osOpen && <NavLinks items={osItems} pathname={pathname} compact={compact} onNavigate={overlay ? onClose : undefined} />}

      {/* Zone RM: CRASH OVERRIDE */}
      <div
        style={{
          marginTop: '0.72rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: '0.58rem',
          paddingLeft: compact ? '0.4rem' : '0.5rem',
          paddingRight: compact ? '0.4rem' : '0.5rem',
        }}
      >
        <ZoneHeader
          icon={<span style={{ fontSize: '0.86rem' }}>RM</span>}
          label={compact ? 'RM' : '위험관리엔진'}
          badge="VR"
          badgeColor="#ef4444"
          onClick={() => setCrashOpen((p) => !p)}
          isOpen={crashOpen}
          compact={compact}
        />
      </div>
      {crashOpen && <NavLinks items={crashItems} pathname={pathname} vrStyle compact={compact} onNavigate={overlay ? onClose : undefined} />}

      <div
        style={{
          marginTop: '0.72rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: '0.58rem',
          paddingLeft: compact ? '0.4rem' : '0.5rem',
          paddingRight: compact ? '0.4rem' : '0.5rem',
        }}
      >
        <ZoneHeader
          icon={<span style={{ fontSize: '0.82rem', color: '#d9f99d' }}>VR</span>}
          label={compact ? 'VR' : '전략시뮬레이터'}
          badge="NEW"
          badgeColor="#c4ff0d"
          onClick={() => setVrTestOpen((p) => !p)}
          isOpen={vrTestOpen}
          compact={compact}
        />
      </div>
      {vrTestOpen && <NavLinks items={vrTestItems} pathname={pathname} compact={compact} onNavigate={overlay ? onClose : undefined} />}

      {/* Zone LV: 레버리지 길들이기 */}
      <div
        style={{
          marginTop: '0.72rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: '0.58rem',
          paddingLeft: compact ? '0.4rem' : '0.5rem',
          paddingRight: compact ? '0.4rem' : '0.5rem',
        }}
      >
        <ZoneHeader
          icon={<span style={{ fontSize: '0.82rem', color: '#fb923c' }}>LV</span>}
          label={compact ? 'LV' : '레버리지 길들이기'}
          badge="3X"
          badgeColor="#f97316"
          onClick={() => setLvOpen((p) => !p)}
          isOpen={lvOpen}
          compact={compact}
        />
      </div>
      {lvOpen && <NavLinks items={lvItems} pathname={pathname} compact={compact} onNavigate={overlay ? onClose : undefined} />}

      {/* Zone RE: 개인자산관리 */}
      <div
        style={{
          marginTop: '0.72rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: '0.58rem',
          paddingLeft: compact ? '0.4rem' : '0.5rem',
          paddingRight: compact ? '0.4rem' : '0.5rem',
        }}
      >
        <ZoneHeader
          icon={<span style={{ fontSize: '0.82rem', color: '#86efac' }}>RE</span>}
          label={compact ? 'RE' : '개인자산관리'}
          onClick={() => setReOpen((p) => !p)}
          isOpen={reOpen}
          compact={compact}
        />
      </div>
      {reOpen && <NavLinks items={reItems} pathname={pathname} compact={compact} onNavigate={overlay ? onClose : undefined} />}

      {/* Zone TO: TOOLS */}
      <div
        style={{
          marginTop: '0.72rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: '0.58rem',
          paddingLeft: compact ? '0.4rem' : '0.5rem',
          paddingRight: compact ? '0.4rem' : '0.5rem',
        }}
      >
        <ZoneHeader
          icon={<span style={{ fontSize: '0.82rem', color: '#9ca3af' }}>TO</span>}
          label="TOOLS"
          onClick={() => setToolsOpen((p) => !p)}
          isOpen={toolsOpen}
          compact={compact}
        />
      </div>
      {toolsOpen && <NavLinks items={toolItems} pathname={pathname} compact={compact} onNavigate={overlay ? onClose : undefined} />}

      {/* Zone KR: KR Market (collapsed) */}
      <div
        style={{
          marginTop: '0.72rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: '0.58rem',
          paddingLeft: compact ? '0.4rem' : '0.5rem',
          paddingRight: compact ? '0.4rem' : '0.5rem',
        }}
      >
        <ZoneHeader
          icon={<span style={{ fontSize: '0.82rem' }}>KR</span>}
          label={compact ? 'KR' : 'KR MARKET'}
          onClick={() => setKrOpen((p) => !p)}
          isOpen={krOpen}
          compact={compact}
        />
      </div>
      {krOpen && <NavLinks items={krItems} pathname={pathname} compact={compact} onNavigate={overlay ? onClose : undefined} />}

      <div
        style={{
          marginTop: 'auto',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: '0.72rem',
          paddingBottom: '1rem',
          paddingLeft: compact ? '0.4rem' : '0.5rem',
          paddingRight: compact ? '0.4rem' : '0.5rem',
        }}
      >
        <a
          href="/admin/service"
          onClick={overlay ? onClose : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: compact ? 0 : '0.64rem',
            padding: compact ? '0.5rem 0' : '0.45rem 0.64rem',
            borderRadius: '0.45rem',
            color: pathname === '/admin/service' ? '#fff' : 'rgba(255,255,255,0.6)',
            background: pathname === '/admin/service' ? 'rgba(255,255,255,0.06)' : 'transparent',
            textDecoration: 'none',
            justifyContent: compact ? 'center' : 'flex-start',
            transition: 'all 0.15s ease'
          }}
          className="hover:bg-white/5 hover:text-white"
        >
          <span style={{ fontSize: '1.1rem', opacity: pathname === '/admin/service' ? 1 : 0.7 }}>⚙️</span>
          {!compact && <span style={{ fontSize: '0.86rem', fontWeight: pathname === '/admin/service' ? 600 : 500 }}>Service Mode</span>}
        </a>
      </div>
    </aside>
  )

  if (!overlay) return aside
  if (!open) return null

  return (
    <>
      <button
        type="button"
        aria-label="Close sidebar backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.52)',
          zIndex: 89,
          border: 'none',
          cursor: 'pointer',
        }}
      />
      <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 90 }}>
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 10,
            right: -46,
            width: 40,
            height: 40,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(17,22,28,0.92)',
            color: '#e5e7eb',
            cursor: 'pointer',
            zIndex: 91,
          }}
        >
          ✕
        </button>
        {aside}
      </div>
    </>
  )
}
