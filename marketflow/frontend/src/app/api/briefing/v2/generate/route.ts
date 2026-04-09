import { NextResponse } from 'next/server'
import { resolveBackendBaseUrl } from '@/lib/backendApi'

const FLASK = resolveBackendBaseUrl()

export async function POST() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 125000)

  try {
    const res = await fetch(`${FLASK}/api/briefing/v2/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    const json = await res.json().catch(() => ({ ok: false, error: 'flask unavailable' }))
    return NextResponse.json(json, { status: res.ok ? 200 : 500 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  } finally {
    clearTimeout(timeout)
  }
}
