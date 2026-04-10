import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import './globals.css'
import ClientLayout from '@/components/ClientLayout'
import { CONTENT_LANG_COOKIE, UI_LANG_COOKIE, normalizeUiLang } from '@/lib/uiLang'

export const metadata: Metadata = {
  title: 'MarketFlow - Investment Dashboard',
  description: 'Professional US Market Analysis Platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const initialUiLang = normalizeUiLang(cookies().get(UI_LANG_COOKIE)?.value)
  const rawContentLang = cookies().get(CONTENT_LANG_COOKIE)?.value
  const initialContentLang = rawContentLang === 'ko' || rawContentLang === 'en' ? rawContentLang : initialUiLang

  return (
    <html lang={initialUiLang} data-lang-mode={initialUiLang} data-content-lang={initialContentLang}>
      <body>
        <ClientLayout initialUiLang={initialUiLang} initialContentLang={initialContentLang}>
          {children}
        </ClientLayout>
      </body>
    </html>
  )
}
