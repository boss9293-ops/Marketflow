'use client'

import RiskSystemV1, { type RiskV1Data } from '@/components/crash/standard/RiskSystemV1'
import RiskV1RefreshButton from '@/components/crash/standard/RiskV1RefreshButton'
import { UI_TEXT } from '@/lib/uiText'
import { pickLang, type UiLang } from '@/lib/uiLang'
import { useUiLang } from '@/lib/useLangMode'

function formatRunId(runId?: string): string {
  if (!runId || !/^\d{8}_\d{6}$/.test(runId)) return runId || '—'
  const y = runId.slice(0, 4)
  const m = runId.slice(4, 6)
  const d = runId.slice(6, 8)
  const hh = runId.slice(9, 11)
  const mm = runId.slice(11, 13)
  const ss = runId.slice(13, 15)
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

export default function RiskV1ClientShell({
  data,
  initialUiLang,
}: {
  data: RiskV1Data
  initialUiLang: UiLang
}) {
  const uiLang = useUiLang(initialUiLang)
  const dataAsOf = data?.data_as_of || data?.current?.date || '—'
  const generatedAt = formatRunId(data?.run_id)

  return (
    <main
      className="mf-risk-v1-root"
      style={{
        minHeight: '100vh',
        background: '#080b10',
        color: '#e5e7eb',
        fontFamily: "var(--font-ui-sans, var(--font-terminal), 'Nanum Gothic Coding', 'Noto Sans KR', monospace)",
        padding: '24px',
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#b7c6df', letterSpacing: '0.15em', textTransform: 'uppercase' }}>MarketFlow</div>
            <h1 style={{ fontSize: 40, fontWeight: 900, color: '#e5e7eb', margin: '2px 0 0' }}>
              {pickLang(uiLang, UI_TEXT.riskV1.title.ko, UI_TEXT.riskV1.title.en)} <span style={{ color: '#6366f1' }}>v1</span>
            </h1>
            <div style={{ fontSize: 14, color: '#b7c6df', marginTop: 6 }}>
              {pickLang(uiLang, UI_TEXT.riskV1.subtitle.ko, UI_TEXT.riskV1.subtitle.en)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#b7c6df', marginRight: 4 }}>{pickLang(uiLang, `데이터 기준일: ${dataAsOf}`, `Data as-of: ${dataAsOf}`)}</div>
            <div style={{ fontSize: 13, color: '#8fa3c8', marginRight: 4 }}>{pickLang(uiLang, `생성 시각: ${generatedAt}`, `Generated: ${generatedAt}`)}</div>
            <RiskV1RefreshButton uiLang={uiLang} />
            <a href="/crash" style={linkBtnStyle}>{pickLang(uiLang, '← 크래시 허브', '← Crash Hub')}</a>
            <a href="/backtest" style={linkBtnStyle}>{pickLang(uiLang, '백테스트 (SRAS)', 'Backtest (SRAS)')}</a>
            <a href="/dashboard" style={linkBtnStyle}>{pickLang(uiLang, '대시보드', 'Dashboard')}</a>
          </div>
        </div>

        <RiskSystemV1 data={data} uiLang={uiLang} />

        <div style={{ fontSize: 12, color: '#4b5563', textAlign: 'center', paddingTop: 8 }}>
          {pickLang(uiLang, `생성 시각: ${generatedAt} · MarketFlow 리스크 시스템 v1`, `Generated: ${generatedAt} · MarketFlow Risk System v1`)}
        </div>
      </div>
    </main>
  )
}

const linkBtnStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#b7c6df',
  textDecoration: 'none',
  padding: '8px 14px',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
}
