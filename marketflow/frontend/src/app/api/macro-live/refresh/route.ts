import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { readdir } from 'fs/promises'

export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
const US_TZ = 'America/New_York'

function getUsDateString(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: US_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

async function runScript(scriptPath: string) {
  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  }
  const python = process.env.PYTHON_BIN || 'python'
  return execFileAsync(python, ['-X', 'utf8', scriptPath], { env })
}

async function getLatestSnapshotDate(): Promise<string | null> {
  try {
    const dir = join(process.cwd(), '..', 'backend', 'storage', 'macro_snapshots')
    const names = await readdir(dir)
    const files = names.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()
    return files.at(-1)?.replace(/\.json$/, '') ?? null
  } catch {
    return null
  }
}

async function isUpToDate(): Promise<boolean> {
  try {
    const last = await getLatestSnapshotDate()
    if (!last) return false
    const today = getUsDateString()
    return last >= today
  } catch {
    return false
  }
}

async function computeRefreshDays(): Promise<number> {
  try {
    const last = await getLatestSnapshotDate()
    if (!last) return 180
    const usToday = getUsDateString()
    const today = new Date(`${usToday}T00:00:00Z`)
    const lastDate = new Date(`${last}T00:00:00Z`)
    const diffMs = today.getTime() - lastDate.getTime()
    const diffDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
    const target = diffDays + 5
    return Math.min(Math.max(target, 10), 365)
  } catch {
    return 180
  }
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json().catch(() => ({}))) as { force?: boolean }
    const force = payload?.force === true
    if (!force && (await isUpToDate())) {
      return NextResponse.json({ ok: true, skipped: true }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const scriptsDir = join(process.cwd(), '..', 'backend', 'scripts')
    const updateDaily = join(scriptsDir, 'update_market_daily.py')
    const buildMarketTape = join(scriptsDir, 'build_market_tape.py')
    const buildMacro = join(scriptsDir, 'macro_fred4_pipeline.py')
    const buildOverview = join(scriptsDir, 'build_overview.py')
    const buildActionSnapshot = join(scriptsDir, 'build_action_snapshot.py')
    const backfillSnapshots = join(scriptsDir, 'backfill_macro_snapshots.py')

    const warnings: string[] = []

    try {
      const days = await computeRefreshDays()
      await execFileAsync(process.env.PYTHON_BIN || 'python', ['-X', 'utf8', updateDaily, '--days', String(days)], {
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      })
    } catch (e) {
      warnings.push(`update_market_daily failed: ${String(e)}`)
    }

    await runScript(buildMarketTape)
    await runScript(buildMacro)
    await runScript(buildOverview)
    await runScript(buildActionSnapshot)
    await execFileAsync(process.env.PYTHON_BIN || 'python', ['-X', 'utf8', backfillSnapshots, '--years', '3'], {
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    })

    return NextResponse.json(
      { ok: true, warnings },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'Macro live refresh failed', details: String(e) },
      { status: 500 }
    )
  }
}
