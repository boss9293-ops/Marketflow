import fs from 'fs/promises'
import path from 'path'
import { backendApiUrl } from '@/lib/backendApi'

async function readJsonFromBackend<T>(filename: string): Promise<T | null> {
  try {
    const res = await fetch(backendApiUrl(`/api/data/${filename}`), { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function readCacheJson<T>(filename: string, fallback: T): Promise<T> {
  const remote = await readJsonFromBackend<T>(filename)
  if (remote !== null) {
    return remote
  }

  const candidates = [
    path.resolve(process.cwd(), '..', 'backend', 'output', filename),
    path.resolve(process.cwd(), 'backend', 'output', filename),
    path.resolve(process.cwd(), '..', 'backend', 'output', 'cache', filename),
    path.resolve(process.cwd(), 'backend', 'output', 'cache', filename),
    path.resolve(process.cwd(), '..', 'output', filename),
    path.resolve(process.cwd(), 'output', filename),
  ]
  for (const candidate of candidates) {
    try {
      return JSON.parse(await fs.readFile(candidate, 'utf-8')) as T
    } catch {
      // try next
    }
  }
  return fallback
}

export async function readCacheJsonOrNull<T>(filename: string): Promise<T | null> {
  const remote = await readJsonFromBackend<T>(filename)
  if (remote !== null) {
    return remote
  }

  const candidates = [
    path.resolve(process.cwd(), '..', 'backend', 'output', filename),
    path.resolve(process.cwd(), 'backend', 'output', filename),
    path.resolve(process.cwd(), '..', 'backend', 'output', 'cache', filename),
    path.resolve(process.cwd(), 'backend', 'output', 'cache', filename),
    path.resolve(process.cwd(), '..', 'output', filename),
    path.resolve(process.cwd(), 'output', filename),
  ]
  for (const candidate of candidates) {
    try {
      return JSON.parse(await fs.readFile(candidate, 'utf-8')) as T
    } catch {
      // try next
    }
  }
  return null
}
