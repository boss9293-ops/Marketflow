import path from 'path'
import type { PriceBar, VolBar } from '../types/market_state'

type BetterSqlite3Statement = {
  all: (...args: unknown[]) => unknown[]
  get: (...args: unknown[]) => unknown
}

type BetterSqlite3Database = {
  prepare: (sql: string) => BetterSqlite3Statement
  close: () => void
}

function getDatabaseCtor() {
  const runtimeRequire = eval('require') as (name: string) => unknown
  return runtimeRequire('better-sqlite3') as new (
    filename: string,
    options: { readonly?: boolean; fileMustExist?: boolean }
  ) => BetterSqlite3Database
}

export type LoadedMarketSeries = {
  as_of_date: string
  qqq_series: PriceBar[]
  tqqq_series: PriceBar[]
  vol_series?: VolBar[]
}

function resolveDbPath(rootDir = process.cwd()) {
  return path.join(rootDir, 'marketflow', 'data', 'marketflow.db')
}

function mapPriceBars(rows: unknown[]): PriceBar[] {
  return rows
    .map((row) => row as { date?: string; close?: number; sma50?: number | null; sma200?: number | null; atr14?: number | null })
    .filter((row) => typeof row.date === 'string' && typeof row.close === 'number' && Number.isFinite(row.close))
    .map((row) => ({
      date: row.date as string,
      close: row.close as number,
      sma50: typeof row.sma50 === 'number' ? row.sma50 : null,
      sma200: typeof row.sma200 === 'number' ? row.sma200 : null,
      atr14: typeof row.atr14 === 'number' ? row.atr14 : null,
    }))
}

function mapVolBars(rows: unknown[]): VolBar[] {
  return rows
    .map((row) => row as { date?: string; value?: number })
    .filter((row) => typeof row.date === 'string' && typeof row.value === 'number' && Number.isFinite(row.value))
    .map((row) => ({
      date: row.date as string,
      value: row.value as number,
    }))
}

export function loadMarketSeries(params?: {
  rootDir?: string
  asOfDate?: string
  historyDays?: number
}): LoadedMarketSeries {
  const DatabaseCtor = getDatabaseCtor()
  const db = new DatabaseCtor(resolveDbPath(params?.rootDir), { readonly: true, fileMustExist: true })

  try {
    const resolvedAsOf =
      params?.asOfDate ??
      ((db.prepare("SELECT MAX(date) AS date FROM ohlcv_daily WHERE symbol = 'QQQ'").get() as { date?: string | null } | undefined)?.date ?? null)

    if (!resolvedAsOf) {
      throw new Error('Could not resolve as_of_date from internal DB')
    }

    const historyDays = params?.historyDays ?? 320
    const qqqRows = db.prepare(`
      SELECT o.date, o.close, i.sma50, i.sma200, i.atr14
      FROM ohlcv_daily o
      LEFT JOIN indicators_daily i
        ON o.symbol = i.symbol AND o.date = i.date
      WHERE o.symbol = 'QQQ' AND o.date <= ?
      ORDER BY o.date DESC
      LIMIT ?
    `).all(resolvedAsOf, historyDays)

    const tqqqRows = db.prepare(`
      SELECT o.date, o.close, i.sma50, i.sma200, i.atr14
      FROM ohlcv_daily o
      LEFT JOIN indicators_daily i
        ON o.symbol = i.symbol AND o.date = i.date
      WHERE o.symbol = 'TQQQ' AND o.date <= ?
      ORDER BY o.date DESC
      LIMIT ?
    `).all(resolvedAsOf, historyDays)

    const vixRows = db.prepare(`
      SELECT date, vix AS value
      FROM market_daily
      WHERE date <= ? AND vix IS NOT NULL
      ORDER BY date DESC
      LIMIT ?
    `).all(resolvedAsOf, historyDays)

    const qqqSeries = mapPriceBars(qqqRows).reverse()
    const tqqqSeries = mapPriceBars(tqqqRows).reverse()
    const volSeries = mapVolBars(vixRows).reverse()

    if (!qqqSeries.length) {
      throw new Error('QQQ series is missing from internal DB')
    }
    if (!tqqqSeries.length) {
      throw new Error('TQQQ series is missing from internal DB')
    }

    return {
      as_of_date: resolvedAsOf,
      qqq_series: qqqSeries,
      tqqq_series: tqqqSeries,
      vol_series: volSeries.length ? volSeries : undefined,
    }
  } finally {
    db.close()
  }
}
