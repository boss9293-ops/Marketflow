import { cookies } from 'next/headers'
import { readCacheJson } from '@/lib/readCacheJson'
import RiskV1ClientShell from '@/components/crash/standard/RiskV1ClientShell'
import RiskV1RefreshButton from '@/components/crash/standard/RiskV1RefreshButton'
import type { RiskV1Data } from '@/components/crash/standard/RiskSystemV1'
import { UI_LANG_COOKIE, normalizeUiLang, pickLang, type UiLang } from '@/lib/uiLang'

export default async function RiskV1Page() {
  const uiLang: UiLang = normalizeUiLang(cookies().get(UI_LANG_COOKIE)?.value)
  const raw = await readCacheJson<RiskV1Data | null>('risk_v1.json', null)

  if (!raw) {
    return (
      <main style={{ padding: '2.6rem', color: '#b7c6df', fontFamily: 'monospace' }}>
        <h2 style={{ color: '#ef4444' }}>{pickLang(uiLang, 'risk_v1.json??李얠쓣 ???놁뒿?덈떎', 'risk_v1.json not found')}</h2>
        <p>
          {pickLang(uiLang, '?ㅽ뻾:', 'Run:')}{' '}
          <code style={{ background: '#111', padding: '0.26rem 0.65rem', borderRadius: 4 }}>
            py marketflow/backend/scripts/build_risk_v1.py
          </code>
        </p>
        <a href="/crash" style={{ color: '#6366f1' }}>
          {pickLang(uiLang, '???щ옒???덈툕', '??Crash Hub')}
        </a>
        <div style={{ marginTop: '1rem' }}>
          <RiskV1RefreshButton uiLang={uiLang} />
        </div>
      </main>
    )
  }

  return <RiskV1ClientShell data={raw} initialUiLang={uiLang} />
}
