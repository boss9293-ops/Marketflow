export function buildSyntheticPricePath(
  returns: number[],
  startPrice = 100
): number[] {
  if (!(startPrice > 0)) {
    throw new Error('Synthetic path startPrice must be positive.')
  }

  const prices = [Number(startPrice.toFixed(6))]
  let currentPrice = startPrice

  for (let index = 0; index < returns.length; index += 1) {
    const dailyReturn = returns[index]
    if (!Number.isFinite(dailyReturn) || dailyReturn <= -0.999) {
      throw new Error(`Synthetic path received an invalid return at index ${index}: ${dailyReturn}`)
    }
    currentPrice *= 1 + dailyReturn
    if (!(currentPrice > 0)) {
      throw new Error(`Synthetic path produced a non-positive price at index ${index}.`)
    }
    prices.push(Number(currentPrice.toFixed(6)))
  }

  return prices
}
