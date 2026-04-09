import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { resolveBackendBaseUrl } from '@/lib/backendApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
const BACKEND_URL = resolveBackendBaseUrl()
const HAS_REMOTE_BACKEND =
  Boolean(
    process.env.FLASK_API_URL ||
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.NEXT_PUBLIC_BACKEND_API ||
      process.env.NEXT_PUBLIC_API_URL,
  ) ||
  process.env.NODE_ENV === 'production'

async function runScript(scriptPath: string) {
  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  }
  const python = process.env.PYTHON_BIN || 'python'
  return execFileAsync(python, ['-X', 'utf8', scriptPath], { env })
}

async function runRemoteRefresh() {
  const res = await fetch(`${BACKEND_URL}/api/risk-v1/refresh`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  const text = await res.text()
  let payload: unknown = text
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  return { ok: res.ok, status: res.status, payload }
}

export async function POST() {
  if (HAS_REMOTE_BACKEND) {
    try {
      const remote = await runRemoteRefresh()
      if (!remote.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Remote risk_v1 refresh failed',
            details: remote.payload,
          },
          { status: remote.status }
        )
      }

      const body =
        remote.payload && typeof remote.payload === 'object'
          ? (remote.payload as Record<string, unknown>)
          : { ok: true, response: remote.payload }

      return NextResponse.json(body, {
        status: remote.status,
        headers: { 'Cache-Control': 'no-store' },
      })
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: 'Remote risk_v1 refresh failed', details: String(error) },
        { status: 500 }
      )
    }
  }

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
