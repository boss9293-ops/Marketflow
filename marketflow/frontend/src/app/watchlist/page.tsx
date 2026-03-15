import { Inter, JetBrains_Mono } from 'next/font/google'
import styles from '@/components/watchlist_mvp/watchlistMvp.module.css'
import AppShell from '@/components/watchlist_mvp/AppShell'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-terminal-ui',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-terminal-mono',
  display: 'swap',
})

export default function WatchlistPage() {
  return (
    <div
      className={`${styles.terminalPageScope} ${styles.terminalTheme} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <AppShell />
    </div>
  )
}
