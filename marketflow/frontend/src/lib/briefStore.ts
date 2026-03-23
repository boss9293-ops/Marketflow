// =============================================================================
// lib/briefStore.ts  (WO-SA29)
// Async JSON file store for daily briefs — data/brief_history.json
// Keeps last MAX_HISTORY entries; deduplicates by date + session_type
// =============================================================================
import fs   from 'fs/promises'
import path from 'path'
import type { DailyBrief, BriefHistoryEntry } from '@/types/brief'

const STORE_PATH  = path.join(process.cwd(), 'data', 'brief_history.json')
const MAX_HISTORY = 30

interface BriefStore {
  briefs: DailyBrief[]
}

async function loadStore(): Promise<BriefStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8')
    return JSON.parse(raw) as BriefStore
  } catch {
    return { briefs: [] }
  }
}

async function saveStore(store: BriefStore): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true })
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
}

/** Upsert brief — overwrites same date + session_type. */
export async function saveBrief(brief: DailyBrief): Promise<void> {
  const store = await loadStore()

  const idx = store.briefs.findIndex(
    b => b.date === brief.date && b.session_type === brief.session_type
  )
  if (idx >= 0) {
    store.briefs[idx] = brief   // overwrite
  } else {
    store.briefs.unshift(brief) // prepend newest
  }

  // Sort desc by as_of and cap
  store.briefs.sort((a, b) => b.as_of.localeCompare(a.as_of))
  store.briefs = store.briefs.slice(0, MAX_HISTORY)

  await saveStore(store)
}

/** Latest stored brief (most recent as_of). */
export async function getLatestBrief(): Promise<DailyBrief | null> {
  const store = await loadStore()
  return store.briefs[0] ?? null
}

/** Lightweight history — headline only, no full narrative payload. */
export async function getBriefHistory(): Promise<BriefHistoryEntry[]> {
  const store = await loadStore()
  return store.briefs.map(b => ({
    id:           b.id,
    as_of:        b.as_of,
    date:         b.date,
    session_type: b.session_type,
    headline:     b.narrative_view.headline,
  }))
}
