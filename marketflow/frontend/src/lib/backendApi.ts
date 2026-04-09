const LOCAL_BACKEND_URL = 'http://localhost:5001'
const DEFAULT_PRODUCTION_BACKEND_URL = 'https://marketflow-production-09df.up.railway.app'

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

export function resolveBackendBaseUrl(): string {
  const candidates = [
    process.env.FLASK_API_URL,
    process.env.BACKEND_URL,
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.NEXT_PUBLIC_BACKEND_API,
    process.env.NEXT_PUBLIC_API_URL,
    process.env.NEXT_PUBLIC_RAILWAY_BACKEND_URL,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return normalizeBaseUrl(candidate.trim())
    }
  }

  if (process.env.NODE_ENV === 'production') {
    return DEFAULT_PRODUCTION_BACKEND_URL
  }

  return LOCAL_BACKEND_URL
}

export function backendApiUrl(pathname: string): string {
  const baseUrl = resolveBackendBaseUrl()
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${baseUrl}${normalizedPath}`
}

export function isLocalBackendUrl(value: string | null | undefined): boolean {
  if (!value) return false
  return normalizeBaseUrl(value) === LOCAL_BACKEND_URL
}
