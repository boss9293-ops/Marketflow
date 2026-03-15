import fs from 'fs/promises'
import path from 'path'
import { notFound } from 'next/navigation'
import SmartMoneyView, { SmartMoneyCache } from '@/components/SmartMoneyView'

const FALLBACK: SmartMoneyCache = {
  date: null,
  top: [],
  watch: [],
  sectors: { top: [], bottom: [], all: [] },
  coverage: {},
  count: 0,
  data_version: 'smart_money_v1',
  generated_at: null,
  rerun_hint: 'python backend/scripts/build_smart_money.py',
}

async function readSmartMoneyCache(): Promise<SmartMoneyCache> {
  const candidates = [
    path.resolve(process.cwd(), '..', 'backend', 'output', 'smart_money.json'),
    path.resolve(process.cwd(), 'backend', 'output', 'smart_money.json'),
    path.resolve(process.cwd(), '..', 'output', 'cache', 'smart_money.json'),
    path.resolve(process.cwd(), 'output', 'cache', 'smart_money.json'),
  ]
  for (const candidate of candidates) {
    try {
      const text = await fs.readFile(candidate, 'utf-8')
      const data = JSON.parse(text) as SmartMoneyCache
      return data
    } catch {
      // try next
    }
  }
  return FALLBACK
}

export default async function SmartMoneyPage() {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_SMART_MONEY === 'true'
  if (!enabled) notFound()
  const data = await readSmartMoneyCache()
  return <SmartMoneyView data={data} />
}
