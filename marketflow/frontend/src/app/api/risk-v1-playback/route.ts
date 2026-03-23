import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

export async function GET() {
  try {
    const filePath = join(process.cwd(), '..', 'backend', 'output', 'risk_v1_playback.json')
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: 'risk_v1_playback.json not found — run build_risk_v1.py' },
      { status: 404 }
    )
  }
}
