"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSimulationStartDate = getSimulationStartDate;
const default_event_state_1 = require("./default_event_state");
function getSimulationStartDate(input) {
    const options = input.availableStartOptions;
    if (!options.length) {
        return {
            simulationStartDate: null,
            effectiveWarmupTradingDays: 0,
        };
    }
    if (input.overrideDate) {
        const exact = options.find((option) => option.date === input.overrideDate) ?? null;
        if (exact) {
            const index = options.findIndex((option) => option.date === exact.date);
            return {
                simulationStartDate: exact.date,
                effectiveWarmupTradingDays: options.length - index,
            };
        }
    }
    const defaultIndex = Math.max(0, options.length - default_event_state_1.EVENT_INITIAL_STATE_DEFAULTS.warmupTradingDays);
    return {
        simulationStartDate: options[defaultIndex].date,
        effectiveWarmupTradingDays: options.length - defaultIndex,
    };
}
