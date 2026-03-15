import { readFileSync } from 'fs'
import { join } from 'path'
import { detectPatternMatches, type MarketState } from './pattern_detector'

type FixtureCase = {
  name: string
  market_state: MarketState
  expected_top_patterns: string[]
}

type FixtureFile = {
  cases: FixtureCase[]
}

export function runPatternDetectorExamples(rootDir = process.cwd()) {
  const fixturePath = join(rootDir, 'engine', 'pattern_detector.fixtures.json')
  const raw = readFileSync(fixturePath, 'utf-8')
  const fixtures = JSON.parse(raw) as FixtureFile

  return fixtures.cases.map((fixture) => {
    const result = detectPatternMatches(fixture.market_state, { rootDir })
    const topPatternIds = result.top_matches.map((item) => item.pattern_id)
    const passed = fixture.expected_top_patterns.every((patternId) => topPatternIds.includes(patternId))

    return {
      name: fixture.name,
      passed,
      expected_top_patterns: fixture.expected_top_patterns,
      actual_top_patterns: topPatternIds,
      result,
    }
  })
}
