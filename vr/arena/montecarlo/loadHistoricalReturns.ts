import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { MonteCarloSourceSeries } from './types'

function parseCsvReturns(csvText: string) {
  const lines = csvText.trim().split(/\r?\n/)
  if (lines.length < 3) return []
  const rows = lines.slice(1).map((line) => line.split(','))
  const closes = rows
    .map((columns) => Number(columns[4]))
    .filter((value) => Number.isFinite(value) && value > 0)

  const returns: number[] = []
  for (let index = 1; index < closes.length; index += 1) {
    returns.push(Number(((closes[index] / closes[index - 1]) - 1).toFixed(8)))
  }
  return returns
}

function buildSynthetic3xReturns(baseReturns: number[]) {
  return baseReturns.map((value) => {
    const leveraged = value * 3
    const clamped = Math.max(-0.95, Math.min(1.5, leveraged))
    return Number(clamped.toFixed(8))
  })
}

export async function loadHistoricalReturnsForMonteCarlo(
  source: MonteCarloSourceSeries
): Promise<number[]> {
  const priceDir = join(process.cwd(), 'marketflow_data', 'prices', 'raw_csv')
  const qqqCsv = await readFile(join(priceDir, 'qqq.us.csv'), 'utf-8')
  const qqqReturns = parseCsvReturns(qqqCsv)

  if (source === 'QQQ' || source === 'NDX') {
    return qqqReturns
  }
  if (source === 'SYNTH_3X') {
    return buildSynthetic3xReturns(qqqReturns)
  }

  const tqqqCsv = await readFile(join(priceDir, 'tqqq.us.csv'), 'utf-8')
  return parseCsvReturns(tqqqCsv)
}
