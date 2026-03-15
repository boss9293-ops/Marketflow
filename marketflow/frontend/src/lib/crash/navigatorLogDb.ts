import path from 'path'
import Database from 'better-sqlite3'

export type ActingLogEntry = {
  log_key: string
  date: string
  profile_name: string
  state_from: string
  state_to: string
  ret_2d: number
  ret_3d: number
  dd_60d: number
  below_ma200_days: number
  lower_high_streak: number
  exhaustion_score: number
  trigger_dist_defense: number | null
  trigger_dist_panic: number | null
  recommended_action_code: string
  note_short: string
  created_at?: string
}

type InsertEntry = Omit<ActingLogEntry, 'created_at' | 'log_key'> & { log_key: string }

const DB_PATH = path.resolve(process.cwd(), '..', 'backend', 'output', 'navigator_acting_log.db')

let db: InstanceType<typeof Database> | null = null

function getDb() {
  if (db) return db
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS acting_log (
      log_key TEXT PRIMARY KEY,
      date TEXT,
      profile_name TEXT,
      state_from TEXT,
      state_to TEXT,
      ret_2d REAL,
      ret_3d REAL,
      dd_60d REAL,
      below_ma200_days INTEGER,
      lower_high_streak INTEGER,
      exhaustion_score INTEGER,
      trigger_dist_defense REAL,
      trigger_dist_panic REAL,
      recommended_action_code TEXT,
      note_short TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
  return db
}

export function makeLogKey(entry: Omit<ActingLogEntry, 'log_key' | 'created_at'>) {
  const dDef = entry.trigger_dist_defense === null ? '' : entry.trigger_dist_defense.toFixed(1)
  const dPan = entry.trigger_dist_panic === null ? '' : entry.trigger_dist_panic.toFixed(1)
  return `${entry.date}|${entry.profile_name}|${entry.state_from}->${entry.state_to}|${entry.recommended_action_code}|${dDef}|${dPan}`
}

export function logActingEntries(entries: Omit<ActingLogEntry, 'log_key' | 'created_at'>[]) {
  if (!entries.length) return
  const database = getDb()
  const stmt = database.prepare(`
    INSERT OR IGNORE INTO acting_log (
      log_key, date, profile_name, state_from, state_to, ret_2d, ret_3d, dd_60d,
      below_ma200_days, lower_high_streak, exhaustion_score, trigger_dist_defense,
      trigger_dist_panic, recommended_action_code, note_short
    ) VALUES (
      @log_key, @date, @profile_name, @state_from, @state_to, @ret_2d, @ret_3d, @dd_60d,
      @below_ma200_days, @lower_high_streak, @exhaustion_score, @trigger_dist_defense,
      @trigger_dist_panic, @recommended_action_code, @note_short
    )
  `)
  const insertMany = database.transaction((rows: InsertEntry[]) => {
    rows.forEach((row) => stmt.run(row))
  })
  const payload = entries.map((entry) => ({
    ...entry,
    log_key: makeLogKey(entry),
  }))
  insertMany(payload)
}

export function fetchRecentLogs(limit = 10): ActingLogEntry[] {
  const database = getDb()
  const rows = database
    .prepare(
      `
      SELECT
        log_key, date, profile_name, state_from, state_to, ret_2d, ret_3d, dd_60d,
        below_ma200_days, lower_high_streak, exhaustion_score, trigger_dist_defense,
        trigger_dist_panic, recommended_action_code, note_short, created_at
      FROM acting_log
      ORDER BY date DESC, created_at DESC
      LIMIT ?
      `
    )
    .all(limit) as ActingLogEntry[]
  return rows
}
