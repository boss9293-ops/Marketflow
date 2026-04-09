'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SessionProvider } from 'next-auth/react'
import Sidebar from '@/components/Sidebar'
import WatchlistSidebar from '@/components/WatchlistSidebar'
import { WatchlistProvider } from '@/contexts/WatchlistContext'
import { AuthProvider } from '@/contexts/AuthContext'
import UserPlanBadge from '@/components/subscription/UserPlanBadge'
import LanguageModeToggle from '@/components/LanguageModeToggle'
import BackendFetchBridge from '@/components/BackendFetchBridge'
import {
  applyContentLangToDocument,
  applyUiLangToDocument,
  persistContentLang,
  persistUiLang,
  readStoredContentLang,
  readStoredUiLang,
  type ContentLang,
  type UiLang,
} from '@/lib/uiLang'
import { pickLang } from '@/lib/useLangMode'
import { UI_TEXT } from '@/lib/uiText'

const SIDEBAR_DEFAULT = 220
const SIDEBAR_MIN     = 120   // 최소 폭 (이 미만으로 드래그 → 접힘)
const SIDEBAR_MAX     = 400
const SIDEBAR_SNAP    = 40    // 이 이하 → width 0 (완전 접힘)

export default function ClientLayout({
  children,
  initialUiLang,
  initialContentLang,
}: {
  children: React.ReactNode
  initialUiLang: UiLang
  initialContentLang: ContentLang
}) {
  const [watchlistOpen, setWatchlistOpen]     = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth]       = useState(SIDEBAR_DEFAULT)
  const [isDragging, setIsDragging]           = useState(false)
  const [uiLang, setUiLang]                   = useState<UiLang>(initialUiLang)
  const [contentLang, setContentLang]         = useState<ContentLang>(initialContentLang)

  const dragStartX     = useRef(0)
  const dragStartWidth = useRef(SIDEBAR_DEFAULT)

  // ── Lang sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = readStoredUiLang(initialUiLang)
    if (saved !== uiLang) setUiLang(saved)
    const savedContent = readStoredContentLang(initialContentLang)
    if (savedContent !== contentLang) setContentLang(savedContent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUiLang, initialContentLang])

  useEffect(() => { applyUiLangToDocument(uiLang); persistUiLang(uiLang) }, [uiLang])
  useEffect(() => { applyContentLangToDocument(contentLang); persistContentLang(contentLang) }, [contentLang])

  // ── Resize drag ──────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartX.current     = e.clientX
    dragStartWidth.current = sidebarWidth
    setIsDragging(true)
  }, [sidebarWidth])

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      const next = dragStartWidth.current + (e.clientX - dragStartX.current)
      setSidebarWidth(
        next < SIDEBAR_SNAP ? 0 : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next))
      )
    }
    const onUp = () => setIsDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isDragging])

  const collapsed = sidebarWidth === 0

  return (
    <SessionProvider>
      <AuthProvider>
        <WatchlistProvider>
          <BackendFetchBridge />

          {/* 드래그 중 전체 커서 오버레이 */}
          {isDragging && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999, cursor: 'col-resize' }} />
          )}

          <div
            className="flex h-screen overflow-hidden"
            style={{
              background: 'var(--bg-main)',
              color: 'var(--text-primary)',
              userSelect: isDragging ? 'none' : undefined,
            }}
          >
            {/* ── Desktop sidebar (resizable) ── */}
            <div
              className="hidden lg:block"
              style={{
                flexShrink: 0,
                width: sidebarWidth,
                overflow: 'hidden',
                transition: isDragging ? 'none' : 'width 180ms ease',
              }}
            >
              <Sidebar />
            </div>

            {/* ── Resize handle (lg+) ── */}
            <div
              className="hidden lg:flex"
              onMouseDown={onMouseDown}
              onDoubleClick={() => setSidebarWidth(collapsed ? SIDEBAR_DEFAULT : 0)}
              title={collapsed ? '더블클릭: 사이드바 열기 / 드래그: 폭 조절' : '더블클릭: 닫기 / 드래그: 폭 조절'}
              style={{
                width: collapsed ? 8 : 5,
                flexShrink: 0,
                cursor: 'col-resize',
                alignItems: 'center',
                justifyContent: 'center',
                background: collapsed
                  ? 'rgba(59,130,246,0.10)'
                  : isDragging ? 'rgba(59,130,246,0.30)' : 'transparent',
                borderRight: collapsed ? '1px solid rgba(59,130,246,0.25)' : 'none',
                transition: 'background 150ms, width 180ms ease',
                zIndex: 10,
              }}
            >
              <div style={{
                width: 2,
                height: collapsed ? '35%' : '55%',
                borderRadius: 2,
                background: collapsed
                  ? 'rgba(59,130,246,0.55)'
                  : isDragging ? '#3b82f6' : 'rgba(255,255,255,0.12)',
                transition: 'background 150ms',
              }} />
            </div>

            {/* ── compact sidebar (md only) ── */}
            <div className="hidden md:block lg:hidden" style={{ flexShrink: 0 }}>
              <Sidebar compact />
            </div>

            {/* ── mobile overlay sidebar ── */}
            <div className="md:hidden">
              <Sidebar overlay open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />
            </div>

            {/* ── Main content ── */}
            <main
              className="flex-1 overflow-y-auto"
              style={{ minWidth: 0, width: '100%' }}
            >
              {/* Mobile hamburger */}
              <button
                type="button"
                aria-label="Open sidebar"
                onClick={() => setMobileSidebarOpen(true)}
                className="md:hidden"
                style={{
                  position: 'fixed', top: 12, left: 12, zIndex: 70,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'var(--text-primary)',
                  borderRadius: 10, width: 40, height: 40,
                  cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem',
                }}
              >
                &#x2630;
              </button>
              {children}
            </main>

            {/* ── Top-right controls ── */}
            <div style={{ position: 'fixed', top: 12, right: 14, zIndex: 70, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserPlanBadge />
              <LanguageModeToggle
                value={uiLang}
                onChange={(next) => {
                  setUiLang(next)
                  setContentLang(next)
                }}
              />
              <button
                onClick={() => setWatchlistOpen(true)}
                style={{
                  border: '1px solid rgba(0,217,255,0.38)',
                  background: 'rgba(0,217,255,0.16)',
                  color: '#67e8f9',
                  borderRadius: 10,
                  padding: '0.42rem 0.7rem',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title={pickLang(uiLang, UI_TEXT.common.openWatchlist.ko, UI_TEXT.common.openWatchlist.en)}
              >
                {pickLang(uiLang, UI_TEXT.nav.watchlist.ko, UI_TEXT.nav.watchlist.en)}
              </button>
            </div>

            <WatchlistSidebar open={watchlistOpen} onClose={() => setWatchlistOpen(false)} />
          </div>

        </WatchlistProvider>
      </AuthProvider>
    </SessionProvider>
  )
}
