import type { DailyDigest } from '@/types/digest'

export function formatDigestDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return iso.slice(0, 10) }
}

export function formatDigestCountLabel(
  count: number,
  singular: string,
  plural?: string,
): string {
  return `${count}\u00a0${count === 1 ? singular : (plural ?? singular + 's')}`
}

export type DigestHeadlineClass = 'critical' | 'elevated' | 'routine' | 'empty'

export function getDigestHeadlineClass(digest: DailyDigest): DigestHeadlineClass {
  if (digest.empty)              return 'empty'
  if (digest.warning_count > 0)  return 'critical'
  if (digest.changed_count  > 0) return 'elevated'
  return 'routine'
}

export const HEADLINE_COLOR: Record<DigestHeadlineClass, string> = {
  critical: '#fca5a5',
  elevated: '#fcd34d',
  routine:  '#94a3b8',
  empty:    '#374151',
}
