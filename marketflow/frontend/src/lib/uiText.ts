import { UI_TEXT as BASE_UI_TEXT, uiText, type UiCopy } from '@/i18n/resources'

export const UI_TEXT = {
  ...BASE_UI_TEXT,
  nav: {
    ...BASE_UI_TEXT.nav,
    news: (BASE_UI_TEXT.nav as Record<string, UiCopy>).news ?? { ko: '뉴스', en: 'News' },
  },
} as const

export { uiText, type UiCopy }
