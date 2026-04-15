export type UiLang = 'ko' | 'en'
export type ContentLang = UiLang

export const UI_LANG_COOKIE = 'mf_ui_lang'
export const UI_LANG_STORAGE_KEY = 'mf_ui_lang'
export const LEGACY_UI_LANG_STORAGE_KEY = 'mf_lang_mode'
export const CONTENT_LANG_COOKIE = 'mf_content_lang'
export const CONTENT_LANG_STORAGE_KEY = 'mf_content_lang'
export const LEGACY_CONTENT_LANG_STORAGE_KEY = 'mf_output_lang'

export function normalizeUiLang(value: unknown): UiLang {
  return value === 'ko' ? 'ko' : 'en'
}

export function normalizeContentLang(value: unknown): ContentLang {
  return normalizeUiLang(value)
}

export function pickLang<T>(uiLang: UiLang, ko: T, en: T): T {
  return uiLang === 'ko' ? ko : en
}

export function readStoredUiLang(fallback: UiLang = 'en'): UiLang {
  if (typeof window === 'undefined') return fallback

  try {
    const stored =
      window.localStorage.getItem(UI_LANG_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_UI_LANG_STORAGE_KEY)
    return normalizeUiLang(stored)
  } catch {
    return fallback
  }
}

export function persistUiLang(uiLang: UiLang) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(UI_LANG_STORAGE_KEY, uiLang)
    window.localStorage.setItem(LEGACY_UI_LANG_STORAGE_KEY, uiLang)
    document.cookie = `${UI_LANG_COOKIE}=${uiLang}; path=/; max-age=31536000; samesite=lax`
  } catch {
    // ignore persistence failures
  }
}

export function readStoredContentLang(fallback: ContentLang = 'ko'): ContentLang {
  if (typeof window === 'undefined') return fallback

  try {
    const stored =
      window.localStorage.getItem(CONTENT_LANG_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_CONTENT_LANG_STORAGE_KEY)
    return normalizeContentLang(stored)
  } catch {
    return fallback
  }
}

export function persistContentLang(contentLang: ContentLang) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(CONTENT_LANG_STORAGE_KEY, contentLang)
    window.localStorage.setItem(LEGACY_CONTENT_LANG_STORAGE_KEY, contentLang)
    document.cookie = `${CONTENT_LANG_COOKIE}=${contentLang}; path=/; max-age=31536000; samesite=lax`
  } catch {
    // ignore persistence failures
  }
}

export function applyUiLangToDocument(uiLang: UiLang) {
  if (typeof document === 'undefined') return

  document.documentElement.setAttribute('data-lang-mode', uiLang)
  document.documentElement.setAttribute('lang', uiLang)
}

export function applyContentLangToDocument(contentLang: ContentLang) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-content-lang', contentLang)
}
