import path from 'path'

function normalizeRelativePath(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+|\/+$/g, '')
}

function dedupePaths(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const candidate = path.resolve(value)
    if (seen.has(candidate)) {
      continue
    }
    seen.add(candidate)
    out.push(candidate)
  }
  return out
}

export function resolveNewsHistoryCandidates(filename: string): string[] {
  const rel = normalizeRelativePath(filename)
  if (!rel) return []

  const cwd = process.cwd()
  const repoRoot = path.resolve(cwd, '..')

  return dedupePaths([
    path.resolve(repoRoot, 'backend', 'output', 'cache', rel),
    path.resolve(cwd, 'backend', 'output', 'cache', rel),
    path.resolve(repoRoot, 'frontend', '.cache', rel),
    path.resolve(cwd, '.cache', rel),
    path.resolve(repoRoot, 'output', 'cache', rel),
    path.resolve(cwd, 'output', 'cache', rel),
    path.resolve(repoRoot, 'backend', 'output', rel),
    path.resolve(cwd, 'backend', 'output', rel),
  ])
}

export function resolvePreferredNewsHistoryPath(filename: string): string {
  const candidates = resolveNewsHistoryCandidates(filename)
  if (candidates.length > 0) {
    return candidates[0]
  }
  return path.resolve(process.cwd(), '.cache', normalizeRelativePath(filename))
}
