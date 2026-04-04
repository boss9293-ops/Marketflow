'use client'

import { useEffect, useState } from 'react'
import { normalizeContentLang, normalizeUiLang, pickLang, type ContentLang, type UiLang } from '@/lib/uiLang'

export type LangMode = UiLang

export function useUiLang(initialUiLang: UiLang = 'ko'): UiLang {
  // Keep SSR and initial client render identical to avoid hydration mismatches.
  const [mode, setMode] = useState<UiLang>(initialUiLang)

  useEffect(() => {
    const sync = () => {
      setMode(normalizeUiLang(document.documentElement.getAttribute('data-lang-mode')))
    }

    sync()

    const mo = new MutationObserver(sync)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-lang-mode'] })
    return () => mo.disconnect()
  }, [])

  return mode
}

export function useLangMode(): UiLang {
  return useUiLang()
}

export function useContentLang(initialContentLang: ContentLang = 'ko'): ContentLang {
  // Keep SSR and initial client render identical to avoid hydration mismatches.
  const [mode, setMode] = useState<ContentLang>(initialContentLang)

  useEffect(() => {
    const sync = () => {
      setMode(normalizeContentLang(document.documentElement.getAttribute('data-content-lang')))
    }

    sync()

    const mo = new MutationObserver(sync)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-content-lang'] })
    return () => mo.disconnect()
  }, [])

  return mode
}

export { pickLang }
