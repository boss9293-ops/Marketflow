export type InterpretBlock = {
  headline: string
  explanation: string
  context: string
}

const BLOCKED_TERMS = [
  /\bwill rise\b/gi,
  /\bcrash\b/gi,
  /\bguarantee\b/gi,
  /\bstrong upside\b/gi,
  /\bbuy\b/gi,
  /\bsell\b/gi,
]

export function enforceNeutralTone(text: string): string {
  let out = text || ''
  let hit = false
  for (const rx of BLOCKED_TERMS) {
    if (rx.test(out)) {
      hit = true
      out = out.replace(rx, 'neutral context')
    }
  }
  if (hit && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn('[macro-interpret] blocked predictive/hype term detected and replaced')
  }
  return out
}

export function interpretLiquidity(
  LPI_band: 'Easy' | 'Neutral' | 'Tight' | 'NA',
  percentile?: number | null,
  _components?: Record<string, number | null>
): InterpretBlock {
  if (LPI_band === 'Tight') {
    return {
      headline: 'Liquidity Conditions Tightening',
      explanation: 'Liquidity buffers (balance sheet trend, RRP dynamics, money supply trend) are in upper historical pressure range.',
      context: 'In similar historical environments, leverage sensitivity tends to increase.',
    }
  }
  if (LPI_band === 'Easy') {
    return {
      headline: 'Liquidity Supportive',
      explanation: 'Liquidity inputs are in lower historical pressure range.',
      context: 'Risk assets historically show higher tolerance to volatility in such regimes.',
    }
  }
  if (LPI_band === 'Neutral') {
    return {
      headline: 'Liquidity Neutral',
      explanation: 'Liquidity inputs are within historical middle range.',
      context: 'No extreme funding pressure signal.',
    }
  }
  return {
    headline: 'Liquidity Data Limited',
    explanation: `Liquidity signal is not fully available${typeof percentile === 'number' ? ` (current percentile ${percentile.toFixed(1)}).` : '.'}`,
    context: 'Interpret with other macro layers before applying pressure context.',
  }
}

export function interpretRates(RPI_band: 'Easing' | 'Stable' | 'Restrictive' | 'NA'): InterpretBlock {
  if (RPI_band === 'Restrictive') {
    return {
      headline: 'Rates Pressure Elevated',
      explanation: 'Real rate and policy rate pressure elevated.',
      context: 'Duration-sensitive assets historically show higher sensitivity.',
    }
  }
  if (RPI_band === 'Easing') {
    return {
      headline: 'Rates Pressure Low',
      explanation: 'Rate pressure historically low.',
      context: 'Financing pressure is less dominant in the current band.',
    }
  }
  if (RPI_band === 'Stable') {
    return {
      headline: 'Rates Environment Stable',
      explanation: 'Rate environment stable within historical band.',
      context: 'No extreme rate pressure condition.',
    }
  }
  return {
    headline: 'Rates Data Limited',
    explanation: 'Rates interpretation unavailable due to limited inputs.',
    context: 'Use companion metrics as primary context.',
  }
}

export function interpretVol(VRI_band: 'Compressed' | 'Normal' | 'Expanding' | 'NA'): InterpretBlock {
  if (VRI_band === 'Expanding') {
    return {
      headline: 'Volatility Regime Expanding',
      explanation: 'Volatility regime expanding relative to 3Y history.',
      context: 'Position sizing stability tends to weaken in expanding regimes.',
    }
  }
  if (VRI_band === 'Compressed') {
    return {
      headline: 'Volatility Compressed',
      explanation: 'Volatility compressed relative to history.',
      context: 'Volatility pressure is currently not in an extreme zone.',
    }
  }
  if (VRI_band === 'Normal') {
    return {
      headline: 'Volatility Normal',
      explanation: 'Volatility regime is within historical middle range.',
      context: 'No structural volatility extreme detected.',
    }
  }
  return {
    headline: 'Volatility Data Limited',
    explanation: 'Volatility interpretation unavailable due to limited inputs.',
    context: 'Use recent quality and revision status for confidence.',
  }
}

export function interpretXCONF(label?: string | null): InterpretBlock {
  if (label === 'Align') {
    return {
      headline: 'Confirmation Aligned',
      explanation: 'Risk asset behavior aligned with liquidity trend.',
      context: 'Cross-asset confirmation supports consistency of macro context.',
    }
  }
  if (label === 'Stress') {
    return {
      headline: 'Confirmation Under Stress',
      explanation: 'Risk asset and liquidity weakening together.',
      context: 'Cross-asset consistency points to higher pressure sensitivity.',
    }
  }
  return {
    headline: 'Confirmation Mixed',
    explanation: 'Liquidity signals and risk behavior diverging. Confirmation incomplete.',
    context: 'Cross-asset confirmation is limited in this state.',
  }
}

export function interpretGHEDGE(label?: string | null): InterpretBlock {
  if (label === 'HedgeDemand') {
    return {
      headline: 'Hedge Demand Elevated',
      explanation: 'Gold strength alongside rising real rates may indicate defensive allocation pressure.',
      context: 'Defensive demand context is elevated versus normal relationship.',
    }
  }
  if (label === 'Mixed') {
    return {
      headline: 'Gold/Real Rate Mixed',
      explanation: 'Gold/real rate relationship inconclusive.',
      context: 'Hedge pressure confirmation is incomplete.',
    }
  }
  return {
    headline: 'Gold/Real Rate Normal',
    explanation: 'Gold and real rate relationship within historical pattern.',
    context: 'No additional hedge-pressure signal beyond baseline relationship.',
  }
}

export function resolveMacroTone(params: {
  lpiBand: 'Easy' | 'Neutral' | 'Tight' | 'NA'
  rpiBand: 'Easing' | 'Stable' | 'Restrictive' | 'NA'
  vriBand: 'Compressed' | 'Normal' | 'Expanding' | 'NA'
  xconf?: string | null
  ghedge?: string | null
}): 'Normal' | 'Confirm' | 'Defensive' {
  if (
    params.vriBand === 'Expanding' ||
    params.lpiBand === 'Tight' ||
    params.rpiBand === 'Restrictive' ||
    params.xconf === 'Stress' ||
    params.ghedge === 'HedgeDemand'
  ) {
    return 'Defensive'
  }
  if (params.xconf === 'Mixed' || params.ghedge === 'Mixed' || params.lpiBand === 'NA' || params.rpiBand === 'NA' || params.vriBand === 'NA') {
    return 'Confirm'
  }
  return 'Normal'
}

export function buildStandardWhyMattersTooltip(directionText: string): string {
  return `Why this matters: Based on 3-year percentile ranking. Risk band represents upper 15% of historical readings. Direction logic: ${directionText}. This is a structural pressure indicator, not a timing signal.`
}
