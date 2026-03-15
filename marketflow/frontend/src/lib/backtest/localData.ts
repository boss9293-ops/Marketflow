import 'server-only'

import { promises as fs } from 'fs'
import path from 'path'
import { DEFAULT_VR_SYMBOL, LOCAL_VR_DATA_SOURCES, LocalVrDataSource } from '@/data/sampleData'
import { DailyBar } from '@/lib/backtest/types'

function normalizeDate(rawDate: string) {
  if (rawDate.includes('-')) {
    return rawDate
  }

  const [month, day, year] = rawDate.split('/')
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function parseCsv(content: string): DailyBar[] {
  const [headerLine, ...lines] = content.trim().split(/\r?\n/)
  const headers = headerLine.split(',').map((header) => header.trim().toLowerCase())
  const indexOf = (column: string) => headers.findIndex((header) => header === column)

  const dateIndex = indexOf('date')
  const openIndex = indexOf('open')
  const highIndex = indexOf('high')
  const lowIndex = indexOf('low')
  const closeIndex = indexOf('close')
  const volumeIndex = indexOf('volume')

  return lines
    .map((line) => {
      const columns = line.split(',')
      const close = Number(columns[closeIndex] ?? 0)
      if (!Number.isFinite(close) || close <= 0) {
        return null
      }

      return {
        date: normalizeDate(columns[dateIndex]),
        open: Number(columns[openIndex] ?? close),
        high: Number(columns[highIndex] ?? close),
        low: Number(columns[lowIndex] ?? close),
        close,
        volume: Number(columns[volumeIndex] ?? 0),
      }
    })
    .filter((bar): bar is DailyBar => bar !== null)
}

function resolveDataPath(source: LocalVrDataSource) {
  return path.resolve(process.cwd(), ...source.relativePath)
}

export function listLocalVrDataSources() {
  return LOCAL_VR_DATA_SOURCES
}

export function getDefaultVrSymbol() {
  return DEFAULT_VR_SYMBOL
}

export async function loadLocalVrBars(symbol: string): Promise<DailyBar[]> {
  const source = LOCAL_VR_DATA_SOURCES.find((entry) => entry.symbol === symbol)
  if (!source) {
    throw new Error(`Unknown local VR symbol: ${symbol}`)
  }

  const content = await fs.readFile(resolveDataPath(source), 'utf-8')
  return parseCsv(content)
}

export async function loadLocalVrDataMap(): Promise<Record<string, DailyBar[]>> {
  const entries = await Promise.all(
    LOCAL_VR_DATA_SOURCES.map(async (source) => {
      const content = await fs.readFile(resolveDataPath(source), 'utf-8')
      return [source.symbol, parseCsv(content)] as const
    }),
  )

  return Object.fromEntries(entries)
}
