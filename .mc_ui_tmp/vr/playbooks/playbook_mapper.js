"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapScenarioPlaybook = mapScenarioPlaybook;
exports.runScenarioPlaybookExamples = runScenarioPlaybookExamples;
const scenario_mapper_1 = require("./scenario_mapper");
function mapScenarioPlaybook(detectionResult, options) {
    const primaryPattern = detectionResult.top_matches[0] ?? null;
    if (!primaryPattern) {
        return {
            primary_pattern: null,
            scenarios: [],
        };
    }
    const maxScenarios = options?.maxScenarios ?? 3;
    const scenarios = (0, scenario_mapper_1.mapPatternToScenarios)(primaryPattern, options).slice(0, maxScenarios);
    return {
        primary_pattern: {
            pattern_id: primaryPattern.pattern_id,
            pattern_name: primaryPattern.pattern_name,
            score: primaryPattern.score,
        },
        scenarios,
    };
}
function runScenarioPlaybookExamples(rootDir = process.cwd()) {
    const cases = [
        {
            name: 'Geopolitical shock range',
            input: {
                top_matches: [
                    { pattern_id: 'geopolitical_shock_range', pattern_name: 'Geopolitical Shock Range', score: 0.81 },
                ],
                evaluated_count: 10,
            },
            expectedScenarioIds: ['range_continuation', 'support_breakdown', 'relief_rally_breakout'],
        },
        {
            name: 'Seasonal correction',
            input: {
                top_matches: [
                    { pattern_id: 'seasonal_correction', pattern_name: 'Seasonal Correction', score: 0.72 },
                ],
                evaluated_count: 10,
            },
            expectedScenarioIds: ['A', 'B', 'C'],
        },
        {
            name: 'Crash cascade',
            input: {
                top_matches: [
                    { pattern_id: 'crash_cascade', pattern_name: 'Crash Cascade', score: 0.91 },
                ],
                evaluated_count: 10,
            },
            expectedScenarioIds: ['A', 'B', 'C'],
        },
    ];
    return cases.map((testCase) => {
        const result = mapScenarioPlaybook(testCase.input, { rootDir });
        const scenarioIds = result.scenarios.map((scenario) => scenario.scenario_id);
        const passed = result.primary_pattern?.pattern_id === testCase.input.top_matches[0]?.pattern_id &&
            testCase.expectedScenarioIds.every((id) => scenarioIds.includes(id)) &&
            result.scenarios.every((scenario) => scenario.posture_guidance.length > 0) &&
            result.scenarios.length <= 3;
        return {
            name: testCase.name,
            passed,
            scenario_ids: scenarioIds,
            result,
        };
    });
}
