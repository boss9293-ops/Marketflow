import { NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const OUTPUT_DIR = join(process.cwd(), '..', 'backend', 'output')

export async function GET() {
  try {
    // 1. Try live output (produced by build_smart_analyzer.py)
    const livePath = join(OUTPUT_DIR, 'smart_analyzer_latest.json')
    if (existsSync(livePath)) {
      const data = JSON.parse(readFileSync(livePath, 'utf-8'))
      return NextResponse.json({ ...data, _source: 'live' })
    }

    // 2. Fall back to first scenario in sample file
    const samplePath = join(OUTPUT_DIR, 'smart_analyzer_sample.json')
    if (existsSync(samplePath)) {
      const sample = JSON.parse(readFileSync(samplePath, 'utf-8'))
      if (Array.isArray(sample?.scenarios) && sample.scenarios.length > 0) {
        const output = sample.scenarios[0]?.output ?? {}
        return NextResponse.json({ ...output, _source: 'sample' })
      }
    }

    return NextResponse.json(
      { error: 'smart_analyzer_latest.json not found — run build_smart_analyzer.py' },
      { status: 404 }
    )
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to read smart analyzer data', detail: String(err) },
      { status: 500 }
    )
  }
}
