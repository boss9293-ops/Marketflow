import fs from 'fs/promises'
import path from 'path'

import { backendApiUrl } from '@/lib/backendApi'

type DataManifestArtifact = {
  relative_path?: string | null
  exists?: boolean | null
  path?: string | null
}

type DataManifest = {
  manifest_version?: string | null
  generated_at?: string | null
  data_mode?: string | null
  source_profile?: string | null
  artifacts?: Record<string, DataManifestArtifact> | null
}

const LOCAL_MANIFEST_CANDIDATES = [
  path.resolve(process.cwd(), '..', 'backend', 'output', 'cache', 'data_manifest.json'),
  path.resolve(process.cwd(), 'backend', 'output', 'cache', 'data_manifest.json'),
  path.resolve(process.cwd(), '..', 'backend', 'output', 'data_manifest.json'),
  path.resolve(process.cwd(), 'backend', 'output', 'data_manifest.json'),
  path.resolve(process.cwd(), '..', 'output', 'cache', 'data_manifest.json'),
  path.resolve(process.cwd(), 'output', 'cache', 'data_manifest.json'),
]

let dataManifestCache: DataManifest | null | undefined
let dataManifestPromise: Promise<DataManifest | null> | null = null

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

function normalizeApiPath(pathname: string): string {
  const rel = normalizeRelativePath(pathname)
  return rel ? `/${rel}` : '/'
}

async function readJsonFromBackend<T>(pathname: string): Promise<T | null> {
  try {
    const res = await fetch(backendApiUrl(normalizeApiPath(pathname)), { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function readJsonFromFile<T>(candidate: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(candidate, 'utf-8')) as T
  } catch {
    return null
  }
}

async function loadDataManifest(): Promise<DataManifest | null> {
  if (dataManifestCache !== undefined) {
    return dataManifestCache
  }

  if (!dataManifestPromise) {
    dataManifestPromise = (async () => {
      const remoteCandidates = [
        '/api/data/cache/data_manifest.json',
        '/api/data/data_manifest.json',
      ]

      for (const candidate of remoteCandidates) {
        const remote = await readJsonFromBackend<DataManifest>(candidate)
        if (remote && typeof remote === 'object') {
          return remote
        }
      }

      for (const candidate of LOCAL_MANIFEST_CANDIDATES) {
        const local = await readJsonFromFile<DataManifest>(candidate)
        if (local && typeof local === 'object') {
          return local
        }
      }

      return null
    })()
  }

  dataManifestCache = await dataManifestPromise
  return dataManifestCache
}

function buildLocalCandidates(relativePath: string): string[] {
  const rel = normalizeRelativePath(relativePath)
  if (!rel) return []

  const base = path.basename(rel)
  const candidates = [
    path.resolve(process.cwd(), '..', 'backend', 'output', rel),
    path.resolve(process.cwd(), 'backend', 'output', rel),
    path.resolve(process.cwd(), '..', 'backend', 'output', 'cache', rel),
    path.resolve(process.cwd(), 'backend', 'output', 'cache', rel),
    path.resolve(process.cwd(), '..', 'output', rel),
    path.resolve(process.cwd(), 'output', rel),
  ]

  if (base === rel) {
    candidates.push(path.resolve(process.cwd(), '..', 'backend', 'output', 'cache', base))
    candidates.push(path.resolve(process.cwd(), 'backend', 'output', 'cache', base))
  } else {
    candidates.push(path.resolve(process.cwd(), '..', 'backend', 'output', base))
    candidates.push(path.resolve(process.cwd(), 'backend', 'output', base))
    candidates.push(path.resolve(process.cwd(), '..', 'backend', 'output', 'cache', base))
    candidates.push(path.resolve(process.cwd(), 'backend', 'output', 'cache', base))
    candidates.push(path.resolve(process.cwd(), '..', 'output', base))
    candidates.push(path.resolve(process.cwd(), 'output', base))
  }

  return dedupePaths(candidates)
}

function manifestRelativeCandidates(filename: string, manifest: DataManifest | null): string[] {
  const artifacts = manifest?.artifacts
  if (!artifacts || typeof artifacts !== 'object') {
    return []
  }

  const target = normalizeRelativePath(filename)
  if (!target) {
    return []
  }

  const targetBase = path.basename(target)
  const candidates: string[] = []

  for (const [key, artifact] of Object.entries(artifacts)) {
    const keyPath = normalizeRelativePath(key)
    const keyBase = path.basename(keyPath)
    const relativePath = normalizeRelativePath(
      artifact && typeof artifact === 'object' && artifact.relative_path ? artifact.relative_path : keyPath,
    )

    if (!relativePath) continue

    if (keyPath === target || keyBase === targetBase || keyPath === targetBase) {
      candidates.push(relativePath)
    }
  }

  if (candidates.length === 0) {
    candidates.push(target)
  }

  return dedupePaths(candidates)
}

async function buildArtifactCandidates(filename: string): Promise<string[]> {
  const manifest = await loadDataManifest()
  const manifestRelative = manifestRelativeCandidates(filename, manifest)
  const candidates = manifestRelative.flatMap((relativePath) => buildLocalCandidates(relativePath))
  candidates.push(...buildLocalCandidates(filename))
  return dedupePaths(candidates)
}

async function readJsonFromLocalCandidates<T>(filename: string): Promise<T | null> {
  const candidates = await buildArtifactCandidates(filename)
  for (const candidate of candidates) {
    try {
      return JSON.parse(await fs.readFile(candidate, 'utf-8')) as T
    } catch {
      // try next
    }
  }
  return null
}

async function readArtifactJson<T>(filename: string): Promise<T | null> {
  const remote = await readJsonFromBackend<T>(`/api/data/${normalizeRelativePath(filename)}`)
  if (remote !== null) {
    return remote
  }

  return readJsonFromLocalCandidates<T>(filename)
}

export async function readCacheJson<T>(filename: string, fallback: T): Promise<T> {
  const remote = await readArtifactJson<T>(filename)
  return remote !== null ? remote : fallback
}

export async function readCacheJsonOrNull<T>(filename: string): Promise<T | null> {
  return readArtifactJson<T>(filename)
}
