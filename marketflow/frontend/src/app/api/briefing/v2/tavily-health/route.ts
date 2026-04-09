import { NextResponse } from 'next/server'
import { resolveBackendBaseUrl } from '@/lib/backendApi'

const FLASK = resolveBackendBaseUrl()

export async function GET(req: Request) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const url = new URL(req.url)
    const query = url.searchParams.get('query')
    const topic = url.searchParams.get('topic')
    const target = new URL(`${FLASK}/api/briefing/v2/tavily-health`)
    if (query) target.searchParams.set('query', query)
    if (topic) target.searchParams.set('topic', topic)

    const res = await fetch(target.toString(), {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })
    const json = await res.json().catch(() => ({ ok: false, status: 'proxy_error', message: 'flask unavailable' }))
    return NextResponse.json(json, { status: 200 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, status: 'proxy_error', message: msg }, { status: 200 })
  } finally {
    clearTimeout(timeout)
  }
}
