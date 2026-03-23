"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePriorityEventTags = void 0;
exports.resolveVREventInterpretation = resolveVREventInterpretation;
const attach_vr_event_tags_1 = require("./attach_vr_event_tags");
const load_priority_event_tags_1 = require("./load_priority_event_tags");
Object.defineProperty(exports, "validatePriorityEventTags", { enumerable: true, get: function () { return load_priority_event_tags_1.validatePriorityEventTags; } });
function resolveVREventInterpretation(input) {
    const attached = (0, attach_vr_event_tags_1.attachPriorityEventVRTag)({
        rootDir: input.rootDir,
        eventId: input.eventName.slice(0, 7),
        supportStatus: input.supportStatus,
        syntheticProxy: input.syntheticProxy,
        patternMatches: input.patternMatches,
        ma200Status: input.ma200Status,
        tqqqDrawdownPct: input.tqqqDrawdownPct,
        reboundStrengthPct: input.reboundStrengthPct,
    });
    return {
        ...attached.tag,
        source: attached.source,
    };
}
