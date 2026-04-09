'use client'

import { resolveBackendBaseUrl } from '@/lib/backendApi'

const LOCAL_BACKEND_URL = 'http://localhost:5001'

type FetchBridgeWindow = Window & {
  __marketflowBackendFetchBridgeInstalled?: boolean
}

function installBackendFetchBridge() {
  if (typeof window === 'undefined') return

  const bridgeWindow = window as FetchBridgeWindow
  if (bridgeWindow.__marketflowBackendFetchBridgeInstalled) return

  const backendBaseUrl = resolveBackendBaseUrl()
  if (!backendBaseUrl || backendBaseUrl === LOCAL_BACKEND_URL) return

  const originalFetch = window.fetch.bind(window)
  const rewriteInput = (input: RequestInfo | URL): RequestInfo | URL => {
    if (typeof input === 'string') {
      return input.startsWith(LOCAL_BACKEND_URL)
        ? input.replace(LOCAL_BACKEND_URL, backendBaseUrl)
        : input
    }

    if (typeof URL !== 'undefined' && input instanceof URL) {
      return input.href.startsWith(LOCAL_BACKEND_URL)
        ? new URL(input.href.replace(LOCAL_BACKEND_URL, backendBaseUrl))
        : input
    }

    if (typeof Request !== 'undefined' && input instanceof Request && input.url.startsWith(LOCAL_BACKEND_URL)) {
      return new Request(input.url.replace(LOCAL_BACKEND_URL, backendBaseUrl), input)
    }

    return input
  }

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => originalFetch(rewriteInput(input), init)) as typeof window.fetch
  bridgeWindow.__marketflowBackendFetchBridgeInstalled = true
}

installBackendFetchBridge()

export default function BackendFetchBridge() {
  return null
}
