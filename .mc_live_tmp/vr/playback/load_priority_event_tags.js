"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPriorityEventVRTagValid = isPriorityEventVRTagValid;
exports.loadPriorityEventTags = loadPriorityEventTags;
exports.validatePriorityEventTags = validatePriorityEventTags;
const fs_1 = require("fs");
const path_1 = require("path");
const ALLOWED_SUPPORT_STATUS = new Set(['ready', 'partial', 'pending_synthetic']);
const ALLOWED_MA200_STATUS = new Set(['above', 'tested', 'breached', 'sustained_below']);
const ALLOWED_LEVERAGE_STRESS = new Set(['low', 'medium', 'high', 'extreme']);
const ALLOWED_RECOVERY_QUALITY = new Set(['weak', 'mixed', 'improving', 'strong']);
let cachedPriorityEventTags = null;
function toStandardEventIdSet(rootDir) {
    try {
        const rawStandard = (0, fs_1.readFileSync)((0, path_1.join)(rootDir, 'marketflow', 'backend', 'output', 'risk_v1_playback.json'), 'utf-8');
        const standard = JSON.parse(rawStandard);
        return new Set((standard.events ?? [])
            .map((event) => (typeof event.name === 'string' ? event.name.slice(0, 7) : null))
            .filter((name) => typeof name === 'string'));
    }
    catch {
        return undefined;
    }
}
function isPriorityEventVRTagValid(event, standardEventIds) {
    const analysis = event?.vr_analysis;
    return (typeof event?.event_id === 'string' &&
        event.event_id.length > 0 &&
        (!standardEventIds || standardEventIds.has(event.event_id)) &&
        ALLOWED_SUPPORT_STATUS.has(event.vr_support_status) &&
        typeof analysis?.pattern_type === 'string' &&
        analysis.pattern_type.length > 0 &&
        typeof analysis?.ma200_status === 'string' &&
        ALLOWED_MA200_STATUS.has(analysis.ma200_status) &&
        typeof analysis?.leverage_stress === 'string' &&
        ALLOWED_LEVERAGE_STRESS.has(analysis.leverage_stress) &&
        typeof analysis?.recovery_quality === 'string' &&
        ALLOWED_RECOVERY_QUALITY.has(analysis.recovery_quality) &&
        Array.isArray(analysis?.tags) &&
        analysis.tags.length >= 2 &&
        analysis.tags.length <= 4 &&
        typeof analysis?.lesson === 'string' &&
        analysis.lesson.trim().length > 0 &&
        Array.isArray(analysis?.scenario_bias) &&
        analysis.scenario_bias.length >= 1 &&
        analysis.scenario_bias.length <= 3 &&
        Array.isArray(analysis?.playbook_bias) &&
        analysis.playbook_bias.length >= 1 &&
        analysis.playbook_bias.length <= 3);
}
function loadPriorityEventTags(rootDir) {
    if (cachedPriorityEventTags)
        return cachedPriorityEventTags;
    try {
        const raw = (0, fs_1.readFileSync)((0, path_1.join)(rootDir, 'vr', 'playback', 'priority_event_vr_tags.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        const standardEventIds = toStandardEventIdSet(rootDir);
        cachedPriorityEventTags = (parsed.events ?? []).reduce((acc, event) => {
            if (isPriorityEventVRTagValid(event, standardEventIds)) {
                acc[event.event_id] = event;
            }
            return acc;
        }, {});
    }
    catch {
        cachedPriorityEventTags = {};
    }
    return cachedPriorityEventTags;
}
function validatePriorityEventTags(rootDir) {
    const result = {
        valid_count: 0,
        invalid_count: 0,
        missing_standard_events: [],
        invalid_event_ids: [],
    };
    try {
        const raw = (0, fs_1.readFileSync)((0, path_1.join)(rootDir, 'vr', 'playback', 'priority_event_vr_tags.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        const standardEventIds = toStandardEventIdSet(rootDir);
        for (const event of parsed.events ?? []) {
            if (typeof event?.event_id === 'string' && standardEventIds && !standardEventIds.has(event.event_id)) {
                result.missing_standard_events.push(event.event_id);
            }
            if (isPriorityEventVRTagValid(event, standardEventIds)) {
                result.valid_count += 1;
            }
            else {
                result.invalid_count += 1;
                if (typeof event?.event_id === 'string') {
                    result.invalid_event_ids.push(event.event_id);
                }
            }
        }
    }
    catch {
        result.invalid_count += 1;
    }
    return result;
}
