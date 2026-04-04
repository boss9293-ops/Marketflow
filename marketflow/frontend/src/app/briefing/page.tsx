import { cookies } from 'next/headers'
import { readCacheJsonOrNull } from '@/lib/readCacheJson'
import DailyBriefingV3, { type DailyBriefingV3Data } from '@/components/briefing/DailyBriefingV3'
import { CONTENT_LANG_COOKIE, UI_LANG_COOKIE, normalizeUiLang } from '@/lib/uiLang'

export const dynamic = 'force-dynamic'

export default async function BriefingPage() {
  const uiLang = normalizeUiLang(cookies().get(UI_LANG_COOKIE)?.value)
  const rawContentLang = cookies().get(CONTENT_LANG_COOKIE)?.value
  const initialContentLang = rawContentLang === 'ko' || rawContentLang === 'en' ? rawContentLang : uiLang
  const data = await readCacheJsonOrNull<DailyBriefingV3Data>('daily_briefing_v3.json')
  return <DailyBriefingV3 data={data} initialContentLang={initialContentLang} />
}
