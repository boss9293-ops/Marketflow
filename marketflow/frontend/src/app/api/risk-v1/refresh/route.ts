import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'

export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)

async function runScript(scriptPath: string) {
  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  }
  const python = process.env.PYTHON_BIN || 'python'
  return execFileAsync(python, ['-X', 'utf8', scriptPath], { env })
}

export async function POST() {
  try {
    const scriptsDir = join(process.cwd(), '..', 'backend', 'scripts')
    const buildRisk = join(scriptsDir, 'build_risk_v1.py')
    const buildCur90 = join(scriptsDir, 'build_current_90d.py')

    await runScript(buildRisk)
    await runScript(buildCur90)

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'Risk v1 refresh failed', details: String(e) },
      { status: 500 }
    )
  }
}
