import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Capital OS Design System ─────────────────────────────────────────
        'capital-black': '#000000',
        'capital-gray': {
          800: '#1a1a1a',
          700: '#2a2a2a',
          600: '#3a3a3a',
          500: '#6b7280',
          400: '#9ca3af',
        },
        'capital-lime':  '#c4ff0d',
        'capital-green': '#22c55e',
        'capital-red':   '#ef4444',
        'capital-amber': '#f59e0b',

        // ── Legacy aliases (backward compat) ─────────────────────────────────
        background: '#000000',
        sidebar:    '#1a1a1a',
        card:       '#1a1a1a',
      },
    },
  },
  plugins: [],
}
export default config
