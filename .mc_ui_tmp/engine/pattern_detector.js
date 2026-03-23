"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPatternMatches = detectPatternMatches;
exports.listPatternSeeds = listPatternSeeds;
const fs_1 = require("fs");
const path_1 = require("path");
const CORE_WEIGHTS = {
    duration: 0.25,
    drawdown: 0.4,
    volatility: 0.2,
    ma200_relation: 0.15,
};
const CONTEXT_WEIGHT = 0.1;
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function normalizeRange(range) {
    if (!range)
        return null;
    if (Array.isArray(range) && range.length === 2) {
        return {
            min: Math.min(range[0], range[1]),
            max: Math.max(range[0], range[1]),
        };
    }
    if (!Array.isArray(range) && isFiniteNumber(range.min) && isFiniteNumber(range.max)) {
        return {
            min: Math.min(range.min, range.max),
            max: Math.max(range.min, range.max),
        };
    }
    return null;
}
function normalizePctRange(range) {
    if (!range)
        return null;
    if (!isFiniteNumber(range.min) || !isFiniteNumber(range.max))
        return null;
    const scale = Math.max(Math.abs(range.min), Math.abs(range.max)) > 1 ? 100 : 1;
    return {
        min: Math.min(range.min / scale, range.max / scale),
        max: Math.max(range.min / scale, range.max / scale),
    };
}
function boundedScore(value, target) {
    if (!isFiniteNumber(value) || !isFiniteNumber(target.min) || !isFiniteNumber(target.max)) {
        return 0;
    }
    if (value >= target.min && value <= target.max) {
        return 1;
    }
    const width = Math.max(Math.abs(target.max - target.min), 0.0001);
    const nearest = value < target.min ? target.min : target.max;
    const gap = Math.abs(value - nearest);
    return Math.max(0, 1 - gap / width);
}
function durationScore(durationDays, signature) {
    const range = normalizeRange(signature.duration_days);
    return range ? boundedScore(durationDays, range) : 0.5;
}
function drawdownScore(marketState, signature) {
    const nasdaqRange = normalizePctRange(signature.nasdaq_drawdown_range) ??
        normalizePctRange(signature.nasdaq_drawdown_pct);
    const tqqqRange = normalizePctRange(signature.tqqq_drawdown_range) ??
        normalizePctRange(signature.tqqq_drawdown_pct);
    const nasdaqReboundRange = normalizePctRange(signature.nasdaq_rebound_range);
    const tqqqReboundRange = normalizePctRange(signature.tqqq_rebound_range);
    const scores = [];
    if (nasdaqRange) {
        scores.push(boundedScore(marketState.nasdaq_drawdown, nasdaqRange));
    }
    if (tqqqRange) {
        scores.push(boundedScore(marketState.tqqq_drawdown, tqqqRange));
    }
    if (nasdaqReboundRange) {
        scores.push(boundedScore(Math.abs(marketState.nasdaq_drawdown), nasdaqReboundRange));
    }
    if (tqqqReboundRange) {
        scores.push(boundedScore(Math.abs(marketState.tqqq_drawdown), tqqqReboundRange));
    }
    if (!scores.length) {
        return 0.5;
    }
    return scores.reduce((sum, item) => sum + item, 0) / scores.length;
}
function volatilityScore(volatilityRegime, signature) {
    const target = signature.volatility_profile ?? signature.volatility_level;
    if (!target)
        return 0.5;
    const order = ['low', 'moderate', 'medium', 'elevated', 'high', 'extreme'];
    const targetIndex = order.indexOf(target);
    const currentIndex = order.indexOf(volatilityRegime);
    if (targetIndex === -1 || currentIndex === -1) {
        return 0.5;
    }
    const diff = Math.abs(targetIndex - currentIndex);
    return Math.max(0, 1 - diff / 4);
}
function ma200RelationScore(ma200Relation, signature) {
    const target = signature.ma200_behavior ?? signature.ma200_status;
    if (!target)
        return 0.5;
    const normalizedTarget = target === 'breached' ? 'breach'
        : target === 'test_or_breach' ? 'tested'
            : target === 'above_or_near' ? 'near'
                : target === 'sustained_below' ? 'below'
                    : target === 'held' ? 'above'
                        : target;
    if (normalizedTarget === 'irrelevant') {
        return 1;
    }
    if (normalizedTarget === ma200Relation) {
        return 1;
    }
    const order = ['above', 'near', 'tested', 'breach', 'below'];
    const targetIndex = order.indexOf(normalizedTarget);
    const currentIndex = order.indexOf(ma200Relation);
    if (targetIndex === -1 || currentIndex === -1) {
        return 0.5;
    }
    const diff = Math.abs(targetIndex - currentIndex);
    return Math.max(0, 1 - diff / 3);
}
function contextScore(marketState, signature) {
    const checks = [];
    if (marketState.price_structure && signature.trend_structure) {
        checks.push(marketState.price_structure === signature.trend_structure ? 1 : 0);
    }
    if (marketState.catalyst_type) {
        const target = signature.catalyst_type ?? signature.event_catalyst;
        if (target) {
            checks.push(marketState.catalyst_type === target ? 1 : 0);
        }
    }
    if (marketState.trend_persistence && signature.trend_direction) {
        checks.push(marketState.trend_persistence === signature.trend_direction ? 1 : 0);
    }
    if (!checks.length) {
        return 0.5;
    }
    return checks.reduce((sum, item) => sum + item, 0) / checks.length;
}
function toPatternName(patternId) {
    return patternId
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
function pushExplanation(explanations, score, strong, partial) {
    if (score >= 0.95) {
        explanations.push(strong);
        return;
    }
    if (score >= 0.6) {
        explanations.push(partial);
    }
}
function buildExplanation(marketState, signature, componentScores) {
    const explanations = [];
    pushExplanation(explanations, componentScores.drawdown, 'drawdown profile fits', 'drawdown depth partially fits');
    pushExplanation(explanations, componentScores.duration, 'duration is consistent with this structure', 'duration partially fits');
    pushExplanation(explanations, componentScores.volatility, 'volatility regime matches', 'volatility profile only partially matches');
    pushExplanation(explanations, componentScores.ma200, 'MA200 breach matches', 'MA200 relation partially matches');
    if (marketState.price_structure && signature.trend_structure) {
        pushExplanation(explanations, marketState.price_structure === signature.trend_structure ? 1 : 0, `${marketState.price_structure.replaceAll('_', '-')} structure matches`, 'structure partially overlaps');
    }
    if (marketState.catalyst_type) {
        const target = signature.catalyst_type ?? signature.event_catalyst;
        if (target) {
            pushExplanation(explanations, marketState.catalyst_type === target ? 1 : 0, `${target.replaceAll('_', ' ')} catalyst matches`, 'catalyst partially overlaps');
        }
    }
    if (marketState.rebound_behavior && signature.nasdaq_rebound_range) {
        explanations.push('rebound behavior overlap only');
    }
    if (!explanations.length) {
        explanations.push('limited overlap across core pattern inputs');
    }
    return explanations.slice(0, 4);
}
function loadJson(filePath) {
    try {
        return JSON.parse((0, fs_1.readFileSync)(filePath, 'utf-8'));
    }
    catch {
        return null;
    }
}
function loadPatternDefinition(patternDir, patternId) {
    const loaded = loadJson((0, path_1.join)(patternDir, `${patternId}.json`));
    if (!loaded || typeof loaded.pattern_id !== 'string') {
        return null;
    }
    return loaded;
}
function detectPatternMatches(marketState, options) {
    const rootDir = options?.rootDir ?? process.cwd();
    const patternDir = (0, path_1.join)(rootDir, 'vr', 'patterns');
    const index = loadJson((0, path_1.join)(patternDir, 'pattern_index.json'));
    if (!index || !Array.isArray(index.patterns)) {
        return {
            top_matches: [],
            evaluated_count: 0,
        };
    }
    const ranked = index.patterns
        .map((patternId) => {
        const pattern = loadPatternDefinition(patternDir, patternId);
        if (!pattern) {
            return null;
        }
        const signature = pattern.signature ?? {};
        const duration = durationScore(marketState.duration_days, signature);
        const drawdown = drawdownScore(marketState, signature);
        const volatility = volatilityScore(marketState.volatility_regime, signature);
        const ma200 = ma200RelationScore(marketState.ma200_relation, signature);
        const context = contextScore(marketState, signature);
        const coreScore = duration * CORE_WEIGHTS.duration +
            drawdown * CORE_WEIGHTS.drawdown +
            volatility * CORE_WEIGHTS.volatility +
            ma200 * CORE_WEIGHTS.ma200_relation;
        const score = coreScore * (1 - CONTEXT_WEIGHT) + context * CONTEXT_WEIGHT;
        return {
            pattern_id: pattern.pattern_id,
            pattern_name: toPatternName(pattern.pattern_id),
            score: Number(score.toFixed(2)),
            explanation: buildExplanation(marketState, signature, {
                duration,
                drawdown,
                volatility,
                ma200,
                context,
            }),
        };
    })
        .filter((item) => item !== null)
        .sort((a, b) => b.score - a.score);
    const limit = options?.limit ?? 3;
    return {
        top_matches: ranked.slice(0, limit),
        evaluated_count: ranked.length,
    };
}
function listPatternSeeds(options) {
    const rootDir = options?.rootDir ?? process.cwd();
    const patternDir = (0, path_1.join)(rootDir, 'vr', 'patterns');
    const index = loadJson((0, path_1.join)(patternDir, 'pattern_index.json'));
    return index?.patterns ?? [];
}
