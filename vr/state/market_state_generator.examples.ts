import type { PriceBar, VolBar } from '../types/market_state'
import { generateMarketState, generateMarketStateFromSeries } from './market_state_generator'

function makeSeries(values: number[], baseSma200: number, baseSma50: number): PriceBar[] {
  return values.map((close, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    close,
    sma50: baseSma50,
    sma200: baseSma200,
  }))
}

function makeVol(values: number[]): VolBar[] {
  return values.map((value, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    value,
  }))
}

export async function runMarketStateExamples(rootDir = process.cwd()) {
  const cases = [
    {
      name: 'Seasonal correction style',
      qqq: makeSeries([100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 91, 90, 89], 92, 95),
      tqqq: makeSeries([100, 97, 95, 92, 89, 86, 83, 80, 77, 75, 73, 75, 74, 72], 82, 88),
      vol: makeVol([17, 18, 18, 19, 19, 20, 20, 21, 22, 22, 23, 22, 23, 24]),
      expect: { ma200: ['test', 'breach'], structure: ['slow_bleed', 'range_market'] },
    },
    {
      name: 'Crash cascade style',
      qqq: makeSeries([100, 99, 97, 94, 90, 85, 81, 79], 92, 95),
      tqqq: makeSeries([100, 96, 90, 82, 72, 62, 55, 49], 70, 80),
      vol: makeVol([18, 20, 24, 28, 34, 39, 42, 46]),
      expect: { ma200: ['breach', 'sustained_below'], structure: ['vertical_drop'] },
    },
    {
      name: 'Event-driven box style',
      qqq: makeSeries([100, 96, 93, 91, 94, 92, 95, 93, 94, 92, 93, 95], 94, 96),
      tqqq: makeSeries([100, 90, 82, 77, 84, 79, 86, 80, 83, 78, 81, 85], 82, 88),
      vol: makeVol([18, 22, 26, 24, 27, 25, 24, 26, 23, 24, 22, 23]),
      expect: { ma200: ['test', 'breach'], structure: ['range_market'], trend: ['persistent_range'] },
    },
  ]

  const mocked = await Promise.all(
    cases.map(async (testCase) => {
      const result = await generateMarketStateFromSeries({
        qqqSeries: testCase.qqq,
        tqqqSeries: testCase.tqqq,
        volSeries: testCase.vol,
      })
      return {
        name: testCase.name,
        passed:
          testCase.expect.ma200.includes(result.ma200_relation) &&
          testCase.expect.structure.includes(result.price_structure) &&
          (!testCase.expect.trend || testCase.expect.trend.includes(result.trend_persistence)),
        result,
      }
    })
  )

  const live = await generateMarketState().then((result) => ({ name: 'Live DB example', passed: Boolean(result), result }))

  return [...mocked, live]
}
