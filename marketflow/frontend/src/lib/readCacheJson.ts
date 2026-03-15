import fs from 'fs/promises'
import path from 'path'

export async function readCacheJson<T>(filename: string, fallback: T): Promise<T> {
  const candidates = [
    path.resolve(process.cwd(), '..', 'data', 'snapshots', filename),
    path.resolve(process.cwd(), 'data', 'snapshots', filename),
    path.resolve(process.cwd(), '..', 'backend', 'output', filename),
    path.resolve(process.cwd(), 'backend', 'output', filename),
    path.resolve(process.cwd(), '..', 'backend', 'output', 'cache', filename),
    path.resolve(process.cwd(), 'backend', 'output', 'cache', filename),
    path.resolve(process.cwd(), '..', 'output', filename),
    path.resolve(process.cwd(), 'output', filename),
    path.resolve(process.cwd(), '..', 'output', 'cache', filename),
    path.resolve(process.cwd(), 'output', 'cache', filename),
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
  const candidates = [
    path.resolve(process.cwd(), '..', 'data', 'snapshots', filename),
    path.resolve(process.cwd(), 'data', 'snapshots', filename),
    path.resolve(process.cwd(), '..', 'backend', 'output', filename),
    path.resolve(process.cwd(), 'backend', 'output', filename),
    path.resolve(process.cwd(), '..', 'backend', 'output', 'cache', filename),
    path.resolve(process.cwd(), 'backend', 'output', 'cache', filename),
    path.resolve(process.cwd(), '..', 'output', filename),
    path.resolve(process.cwd(), 'output', filename),
    path.resolve(process.cwd(), '..', 'output', 'cache', filename),
    path.resolve(process.cwd(), 'output', 'cache', filename),
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
