import { applyRecoveryShape } from './applyRecoveryShape'
import { resolveCrashTemplateReturns } from './crashTemplates'
import type { CrashInjectionConfig, InjectedScenarioMeta } from './types'

function createSeededRandom(seed?: number) {
  let state = (seed ?? Date.now()) >>> 0
  return function seededRandom() {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function resolveInjectAtDay(args: {
  horizonDays: number
  crashConfig: CrashInjectionConfig
  randomSeed?: number
}) {
  const maxStart = Math.max(
    0,
    args.horizonDays - args.crashConfig.crashLengthDays - args.crashConfig.recoveryLengthDays
  )

  if (typeof args.crashConfig.injectAtDay === 'number') {
    return Math.min(maxStart, Math.max(0, Math.floor(args.crashConfig.injectAtDay)))
  }

  const random = createSeededRandom(args.randomSeed)
  const minAutoStart = Math.min(maxStart, Math.floor(args.horizonDays * 0.25))
  const maxAutoStart = Math.max(minAutoStart, Math.min(maxStart, Math.floor(args.horizonDays * 0.6)))
  return minAutoStart + Math.floor(random() * (maxAutoStart - minAutoStart + 1))
}

export function injectCrashEpisode(args: {
  pathId: string
  baseReturns: number[]
  crashConfig?: CrashInjectionConfig
  randomSeed?: number
}) {
  const crashConfig = args.crashConfig

  if (!crashConfig?.enabled) {
    const meta: InjectedScenarioMeta = {
      pathId: args.pathId,
      injectionApplied: false,
      injectAtDay: null,
      crashLengthDays: null,
      recoveryLengthDays: null,
      severity: null,
      recoveryShape: null,
      episodeTemplateKey: null,
    }
    return { returns: [...args.baseReturns], meta }
  }

  const injectAtDay = resolveInjectAtDay({
    horizonDays: args.baseReturns.length,
    crashConfig,
    randomSeed: args.randomSeed,
  })

  const { template, crashReturns } = resolveCrashTemplateReturns({
    severity: crashConfig.severity,
    crashLengthDays: crashConfig.crashLengthDays,
    useHistoricalEpisodeTemplate: crashConfig.useHistoricalEpisodeTemplate,
    episodeTemplateKey: crashConfig.episodeTemplateKey,
  })

  const nextReturns = [...args.baseReturns]
  for (let index = 0; index < crashReturns.length; index += 1) {
    const targetIndex = injectAtDay + index
    if (targetIndex >= nextReturns.length) break
    nextReturns[targetIndex] = crashReturns[index]
  }

  const recoveryStart = Math.min(nextReturns.length, injectAtDay + crashReturns.length)
  const baseRecoveryReturns = args.baseReturns.slice(
    recoveryStart,
    recoveryStart + crashConfig.recoveryLengthDays
  )
  const shapedReturns = applyRecoveryShape({
    returns: nextReturns,
    crashEndIndex: recoveryStart,
    recoveryLengthDays: crashConfig.recoveryLengthDays,
    recoveryShape: crashConfig.recoveryShape,
    severity: crashConfig.severity,
    crashReturns,
    baseRecoveryReturns,
  })

  const meta: InjectedScenarioMeta = {
    pathId: args.pathId,
    injectionApplied: true,
    injectAtDay,
    crashLengthDays: crashConfig.crashLengthDays,
    recoveryLengthDays: crashConfig.recoveryLengthDays,
    severity: crashConfig.severity,
    recoveryShape: crashConfig.recoveryShape,
    episodeTemplateKey: template?.key ?? crashConfig.episodeTemplateKey ?? null,
  }

  return {
    returns: shapedReturns,
    meta,
  }
}
