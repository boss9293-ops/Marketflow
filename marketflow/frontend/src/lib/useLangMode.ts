'use client'

import { useEffect, useState } from 'react'

export type LangMode = 'ko' | 'en'

export function useLangMode(): LangMode {
  const [mode, setMode] = useState<LangMode>('ko')

  useEffect(() => {
    const apply = () => {
      const v = document.documentElement.getAttribute('data-lang-mode')
      setMode(v === 'en' ? 'en' : 'ko')
    }
    apply()

    const mo = new MutationObserver(() => apply())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-lang-mode'] })
    return () => mo.disconnect()
  }, [])

  return mode
}

export function pickLang(mode: LangMode, ko: string, en: string): string {
  return mode === 'ko' ? ko : en
}
