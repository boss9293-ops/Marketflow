import { runBacktest } from '@/lib/backtest/engine'
import {
  BacktestEngineHooks,
  BacktestResult,
  DailyBar,
  EngineStepResult,
  StrategyInputs,
  TradeAction,
} from '@/lib/backtest/types'

export const VR_G_VALUE_DEFAULTS: StrategyInputs = {
  symbol: 'TQQQ',
  startDate: '2022-12-31',
  initialCapital: 1000,
  rebalanceDays: 14,
  growthRate: 2,
  fixedAdd: 25,
  upperMult: 1.2,
  lowerMult: 0.8,
  initialGValue: 1,
  gAnnualIncrement: 0.1,
  periodsPerYear: 26,
  minimumOrderCash: 50,
  initialBuyPercent: 90,
  targetCapMultiple: 5,
  allowFractionalShares: true,
}

function growTargetValue(previousTarget: number, inputs: StrategyInputs, periodsToAdvance: number) {
  const targetCap = inputs.initialCapital * inputs.targetCapMultiple
  let nextTarget = previousTarget

  for (let step = 0; step < periodsToAdvance; step += 1) {
    nextTarget = nextTarget * (1 + inputs.growthRate / 100) + inputs.fixedAdd
    nextTarget = Math.min(nextTarget, targetCap)
  }

  return nextTarget
}

function buildStatePatch(inputs: StrategyInputs, totalDays: number, currentPeriod: number, previousTarget: number) {
  const periodsToAdvance = Math.max(currentPeriod - Math.floor((totalDays - 1) / inputs.rebalanceDays), 0)
  const targetValue = growTargetValue(previousTarget, inputs, periodsToAdvance)
  const upperBand = targetValue * inputs.upperMult
  const lowerBand = targetValue * inputs.lowerMult
  const currentGValue =
    inputs.initialGValue + Math.floor(currentPeriod / inputs.periodsPerYear) * inputs.gAnnualIncrement

  return {
    totalDays,
    currentPeriod,
    currentGValue,
    targetValue,
    upperBand,
    lowerBand,
  }
}

function createStartStep(inputs: StrategyInputs): EngineStepResult {
  const targetValue = inputs.initialCapital

  return {
    statePatch: {
      totalDays: 0,
      currentPeriod: 0,
      currentGValue: inputs.initialGValue,
      targetValue,
      upperBand: targetValue * inputs.upperMult,
      lowerBand: targetValue * inputs.lowerMult,
    },
    trade: {
      action: 'INIT_BUY',
      amount: inputs.initialCapital * (inputs.initialBuyPercent / 100),
      reason: 'Initial 90% allocation',
    },
  }
}

function createTrade(action: TradeAction, amount: number, reason: string) {
  return { action, amount, reason }
}

function createBarStep(
  inputs: StrategyInputs,
  state: { totalDays: number; targetValue: number; cash: number; shares: number; marketValue: number; portfolioValue: number },
): EngineStepResult {
  const totalDays = state.totalDays
  const currentPeriod = Math.floor(totalDays / inputs.rebalanceDays)
  const previousPeriod = Math.floor(Math.max(totalDays - 1, 0) / inputs.rebalanceDays)
  const periodsToAdvance = Math.max(currentPeriod - previousPeriod, 0)
  const targetValue = growTargetValue(state.targetValue, inputs, periodsToAdvance)
  const upperBand = targetValue * inputs.upperMult
  const lowerBand = targetValue * inputs.lowerMult
  const currentGValue =
    inputs.initialGValue + Math.floor(currentPeriod / inputs.periodsPerYear) * inputs.gAnnualIncrement

  const statePatch = {
    currentPeriod,
    currentGValue,
    targetValue,
    upperBand,
    lowerBand,
  }

  if (state.portfolioValue < lowerBand && state.cash > inputs.minimumOrderCash) {
    const desiredBuy = lowerBand - state.portfolioValue
    const actualBuy = Math.min(desiredBuy, state.cash)
    if (actualBuy > inputs.minimumOrderCash) {
      return {
        statePatch,
        trade: createTrade('BUY', actualBuy, 'Portfolio below lower band'),
      }
    }
  }

  if (state.portfolioValue > upperBand && state.shares > 0) {
    const desiredSell = state.portfolioValue - upperBand
    const actualSell = Math.min(desiredSell, state.marketValue)
    if (actualSell > 0) {
      return {
        statePatch,
        trade: createTrade('SELL', actualSell, 'Portfolio above upper band'),
      }
    }
  }

  return {
    statePatch,
  }
}

export function createVrGValueHooks(inputs: StrategyInputs): BacktestEngineHooks {
  return {
    onStart() {
      return createStartStep(inputs)
    },
    onBar(context) {
      return createBarStep(inputs, {
        totalDays: context.state.totalDays,
        targetValue: context.state.targetValue,
        cash: context.state.cash,
        shares: context.state.shares,
        marketValue: context.state.marketValue,
        portfolioValue: context.state.portfolioValue,
      })
    },
  }
}

export function runVrGValueBacktest(bars: DailyBar[], inputs: StrategyInputs = VR_G_VALUE_DEFAULTS): BacktestResult {
  return runBacktest(bars, inputs, createVrGValueHooks(inputs))
}
