import { buildSyntheticPricePath } from './buildSyntheticPath'
import type { MonteCarloConfig, MonteCarloPath } from './types'

function createSeededRandom(seed?: number) {
  let state = (seed ?? Date.now()) >>> 0
  return function seededRandom() {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

export function generateBlockBootstrapPaths(
  historicalReturns: number[],
  config: MonteCarloConfig
): MonteCarloPath[] {
  if (historicalReturns.length <= config.blockSize) {
    throw new Error('Historical return history is shorter than the requested block size.')
  }

  const random = createSeededRandom(config.randomSeed)
  const paths: MonteCarloPath[] = []

  for (let pathIndex = 0; pathIndex < config.nPaths; pathIndex += 1) {
    const sampledReturns: number[] = []
    const sampledBlockStarts: number[] = []

    while (sampledReturns.length < config.horizonDays) {
      const maxStart = historicalReturns.length - config.blockSize
      const blockStart = Math.floor(random() * (maxStart + 1))
      sampledBlockStarts.push(blockStart)
      sampledReturns.push(...historicalReturns.slice(blockStart, blockStart + config.blockSize))
    }

    const returns = sampledReturns.slice(0, config.horizonDays).map((value) => Number(value.toFixed(8)))
    const prices = buildSyntheticPricePath(returns, config.startPrice)

    paths.push({
      pathId: `mc-${String(pathIndex + 1).padStart(4, '0')}`,
      blockSize: config.blockSize,
      horizonDays: config.horizonDays,
      sampledBlockStarts,
      returns,
      prices,
    })
  }

  return paths
}
