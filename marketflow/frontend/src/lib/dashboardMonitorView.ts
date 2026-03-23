import type { MonitoredTopic, MonitorStatus } from '@/types/researchMonitor'

export const STATUS_PRIORITY: Record<MonitorStatus, number> = {
  warning:  4,
  changed:  3,
  updated:  2,
  watching: 1,
}

/** Sort by status priority desc, cap at 5 for dashboard display */
export function sortForDashboard(topics: MonitoredTopic[]): MonitoredTopic[] {
  return [...topics]
    .sort((a, b) => STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status])
    .slice(0, 5)
}

export function formatAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
