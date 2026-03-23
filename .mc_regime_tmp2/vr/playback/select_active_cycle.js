"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectActiveCycle = selectActiveCycle;
function inCycle(date, cycle) {
    return date >= cycle.cycle_start_date && date <= cycle.cycle_end_date;
}
function selectActiveCycle(input) {
    const cycles = input.cycles;
    if (!cycles.length) {
        return {
            active_cycle: null,
            previous_cycle: null,
            next_cycle: null,
            active_cycle_index: -1,
        };
    }
    let activeIndex = 0;
    if (typeof input.selectedCycleNo === 'number') {
        activeIndex = Math.max(0, cycles.findIndex((cycle) => cycle.cycle_no === input.selectedCycleNo));
    }
    else if (input.replayDate) {
        const byDate = cycles.findIndex((cycle) => inCycle(input.replayDate, cycle));
        if (byDate >= 0)
            activeIndex = byDate;
    }
    else {
        const flagged = cycles.findIndex((cycle) => cycle.is_active_cycle);
        if (flagged >= 0)
            activeIndex = flagged;
    }
    const activeCycle = cycles[activeIndex] ?? null;
    return {
        active_cycle: activeCycle,
        previous_cycle: activeIndex > 0
            ? {
                cycle_no: cycles[activeIndex - 1].cycle_no,
                cycle_start_date: cycles[activeIndex - 1].cycle_start_date,
                cycle_end_date: cycles[activeIndex - 1].cycle_end_date,
            }
            : null,
        next_cycle: activeIndex < cycles.length - 1
            ? {
                cycle_no: cycles[activeIndex + 1].cycle_no,
                cycle_start_date: cycles[activeIndex + 1].cycle_start_date,
                cycle_end_date: cycles[activeIndex + 1].cycle_end_date,
            }
            : null,
        active_cycle_index: activeIndex,
    };
}
