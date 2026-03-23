// =============================================================================
// fetchSmartAnalyzer.ts  (WO-SA15)
//
// Server-side fetch util for Smart Analyzer data.
// Tries /api/smart-analyzer; returns null on any failure.
// Call from async server components only.
// =============================================================================

import type { SmartAnalyzerViewPayload } from './formatSmartAnalyzer'
import { buildSmartAnalyzerView } from './buildSmartAnalyzerView'

type RawSaOutput = Record<string, unknown>

/**
 * Fetch live smart analyzer output and convert to SmartAnalyzerViewPayload.
 * Returns null if the endpoint is unavailable or data is malformed.
 */
export async function fetchSmartAnalyzer(
  baseUrl = 'http://localhost:3000',
): Promise<SmartAnalyzerViewPayload | null> {
  try {
    const res = await fetch(`${baseUrl}/api/smart-analyzer`, {
      next: { revalidate: 60 },  // cache 60 s
    })
    if (!res.ok) return null
    const raw: RawSaOutput = await res.json()
    if (!raw || typeof raw !== 'object' || 'error' in raw) return null
    return buildSmartAnalyzerView(raw as Parameters<typeof buildSmartAnalyzerView>[0])
  } catch {
    return null
  }
}
