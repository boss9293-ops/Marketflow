import { NextResponse } from 'next/server'
import { resolveBackendBaseUrl } from '@/lib/backendApi'

const FLASK_URL = resolveBackendBaseUrl()

export async function POST(request: Request) {
  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const res = await fetch(`${FLASK_URL}/api/analyze/portfolio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { error: text || 'Invalid response from backend' }
  }

  return NextResponse.json(data ?? {}, { status: res.status })
}

