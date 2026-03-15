import path from 'path'
import type { EventCycleStartScenario, EventInitialState, SimulationStartOption } from '../types/event_cycle_start'

type BetterSqlite3Statement = {
  all: (...args: unknown[]) => unknown[]
}

type BetterSqlite3Database = {
  prepare: (sql: string) => BetterSqlite3Statement
  close: () => void
}

type MarketRow = {
  date: string
  close: number
}

export const EVENT_CYCLE_START_DEFAULTS = {
  initialCapital: 10000,
  stockAllocationPct: 0.8,
  poolAllocationPct: 0.2,
  warmupTradingDays: 150,
  startOptionHistoryCap: 220,
} as const

function getDatabaseCtor() {
  const runtimeRequire = eval('require') as (name: string) => unknown
  return runtimeRequire('better-sqlite3') as new (
    filename: string,
    options: { readonly?: boolean; fileMustExist?: boolean }
  ) => BetterSqlite3Database
}

function resolveDbPath(rootDir = process.cwd()) {
  return path.join(rootDir, 'marketflow', 'data', 'marketflow.db')
}

function mapRows(rows: unknown[]) {
  return rows
    .map((row) => row as Partial<MarketRow>)
    .filter((row) => typeof row.date === 'string' && typeof row.close === 'number' && Number.isFinite(row.close))
    .map((row) => ({
      date: row.date as string,
      close: row.close as number,
    }))
}

function buildSyntheticSeries(qqqRows: MarketRow[]) {
  let synthetic = 100
  return qqqRows.map((row, index) => {
    if (index === 0) {
      return { date: row.date, close: Number(synthetic.toFixed(2)) }
    }
    const prev = qqqRows[index - 1]
    const qqqReturn = prev.close > 0 ? (row.close - prev.close) / prev.close : 0
    synthetic = Math.max(1, synthetic * (1 + qqqReturn * 3))
    return { date: row.date, close: Number(synthetic.toFixed(2)) }
  })
}

function buildInitialState(input: {
  initialCapital?: number
  stockAllocationPct?: number
  poolAllocationPct?: number
  startPrice: number
}): EventInitialState {
  const initialCapital = input.initialCapital ?? EVENT_CYCLE_START_DEFAULTS.initialCapital
  const stockAllocationPct = input.stockAllocationPct ?? EVENT_CYCLE_START_DEFAULTS.stockAllocationPct
  const poolAllocationPct = input.poolAllocationPct ?? EVENT_CYCLE_START_DEFAULTS.poolAllocationPct
  const initialShareCount = Math.floor((initialCapital * stockAllocationPct) / input.startPrice)
  const initialStockCost = Number((initialShareCount * input.startPrice).toFixed(2))
  const initialPoolCash = Number((initialCapital - initialStockCost).toFixed(2))

  return {
    initial_capital: initialCapital,
    stock_allocation_pct: stockAllocationPct,
    pool_allocation_pct: poolAllocationPct,
    start_price: Number(input.startPrice.toFixed(2)),
    initial_share_count: initialShareCount,
    initial_average_price: Number(input.startPrice.toFixed(2)),
    initial_stock_cost: initialStockCost,
    initial_pool_cash: initialPoolCash,
  }
}

export function buildEventCycleStartScenario(input: {
  rootDir: string
  eventStartDate: string
  eventEndDate: string
  eventId: string
}): EventCycleStartScenario | null {
  const DatabaseCtor = getDatabaseCtor()
  const db = new DatabaseCtor(resolveDbPath(input.rootDir), { readonly: true, fileMustExist: true })

  try {
    const qqqRows = mapRows(
      db.prepare(`
        SELECT date, close
        FROM ohlcv_daily
        WHERE symbol = 'QQQ' AND date < ?
        ORDER BY date DESC
        LIMIT ?
      `).all(input.eventStartDate, EVENT_CYCLE_START_DEFAULTS.startOptionHistoryCap)
    ).reverse()

    if (!qqqRows.length) {
      return null
    }

    const earliestDate = qqqRows[0].date
    const tqqqRows = mapRows(
      db.prepare(`
        SELECT date, close
        FROM ohlcv_daily
        WHERE symbol = 'TQQQ' AND date >= ? AND date < ?
        ORDER BY date ASC
      `).all(earliestDate, input.eventStartDate)
    )

    const realTqqqByDate = new Map(tqqqRows.map((row) => [row.date, row.close]))
    const syntheticRows = buildSyntheticSeries(qqqRows)
    const syntheticByDate = new Map(syntheticRows.map((row) => [row.date, row.close]))

    const availableStartOptions: SimulationStartOption[] = qqqRows
      .map((row) => {
        const realTqqq = realTqqqByDate.get(row.date)
        const synthetic = syntheticByDate.get(row.date)
        if (typeof realTqqq === 'number') {
          return {
            date: row.date,
            start_price: Number(realTqqq.toFixed(2)),
            price_source: 'real_tqqq' as const,
          }
        }
        if (typeof synthetic === 'number') {
          return {
            date: row.date,
            start_price: Number(synthetic.toFixed(2)),
            price_source: 'synthetic_tqqq_3x' as const,
          }
        }
        return null
      })
      .filter((row): row is SimulationStartOption => Boolean(row))

    if (!availableStartOptions.length) {
      return null
    }

    const defaultIndex = Math.max(0, availableStartOptions.length - EVENT_CYCLE_START_DEFAULTS.warmupTradingDays)
    const defaultStart = availableStartOptions[defaultIndex]

    return {
      event_id: input.eventId,
      ticker: 'TQQQ',
      event_start_date: input.eventStartDate,
      event_end_date: input.eventEndDate,
      simulation_start_date: defaultStart.date,
      default_warmup_trading_days: availableStartOptions.length - defaultIndex,
      requested_warmup_trading_days: EVENT_CYCLE_START_DEFAULTS.warmupTradingDays,
      initial_state: buildInitialState({
        startPrice: defaultStart.start_price,
      }),
      available_start_options: availableStartOptions,
    }
  } finally {
    db.close()
  }
}

export function runEventCycleStartExamples(rootDir: string) {
  const cases = [
    { eventId: '2020-02', eventStartDate: '2020-02-25', eventEndDate: '2020-05-14' },
    { eventId: '2018-10', eventStartDate: '2018-10-10', eventEndDate: '2019-03-08' },
    { eventId: '2007-07', eventStartDate: '2007-07-31', eventEndDate: '2009-07-10' },
  ] as const

  return cases.map((testCase) => {
    const scenario = buildEventCycleStartScenario({
      rootDir,
      eventId: testCase.eventId,
      eventStartDate: testCase.eventStartDate,
      eventEndDate: testCase.eventEndDate,
    })
    return {
      event_id: testCase.eventId,
      passed:
        Boolean(scenario) &&
        (scenario?.initial_state.stock_allocation_pct ?? 0) === 0.8 &&
        (scenario?.initial_state.pool_allocation_pct ?? 0) === 0.2 &&
        (scenario?.available_start_options.length ?? 0) > 0,
      simulation_start_date: scenario?.simulation_start_date ?? null,
      start_price: scenario?.initial_state.start_price ?? null,
    }
  })
}
