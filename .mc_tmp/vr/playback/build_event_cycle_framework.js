"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEventCycleFramework = buildEventCycleFramework;
exports.runCycleFrameworkExamples = runCycleFrameworkExamples;
const select_active_cycle_1 = require("./select_active_cycle");
const CYCLE_WINDOW_DAYS = 10;
function formatToken(value) {
    if (!value)
        return 'Pending';
    return value
        .split('_')
        .map((part) => (part.toLowerCase() === 'ma200' ? 'MA200' : part.charAt(0).toUpperCase() + part.slice(1)))
        .join(' ');
}
function daysBetween(left, right) {
    const start = new Date(`${left}T00:00:00Z`).getTime();
    const end = new Date(`${right}T00:00:00Z`).getTime();
    return Math.round((end - start) / 86400000);
}
function buildGridLevels(input) {
    if (typeof input.anchor !== 'number')
        return [];
    return input.offsets.map((offset, index) => ({
        level_no: index + 1,
        price: Number((input.anchor * (1 + offset)).toFixed(2)),
        weight: Number((1 / input.offsets.length).toFixed(2)),
        status: input.status,
        touched: false,
        executed: false,
        note: input.label === 'buy' ? 'Representative cycle buy level placeholder' : 'Representative cycle sell level placeholder',
    }));
}
function buildCycleRows(event, replayDate, selectedCycleNo) {
    const replayStartDate = event.cycle_start.simulation_start_date ?? event.start;
    const eventEndDate = event.end;
    const rangePoints = event.chart_data.filter((point) => point.date >= replayStartDate && point.date <= eventEndDate);
    if (!rangePoints.length)
        return [];
    const cycleSeeds = [];
    for (let index = 0; index < rangePoints.length; index += CYCLE_WINDOW_DAYS) {
        const slice = rangePoints.slice(index, index + CYCLE_WINDOW_DAYS);
        const first = slice[0];
        const last = slice[slice.length - 1];
        const cycleNo = cycleSeeds.length + 1;
        const anchor = typeof first.qqq_n === 'number' ? first.qqq_n : null;
        const eventActive = (replayDate && replayDate >= first.date && replayDate <= last.date) || (!replayDate && event.start >= first.date && event.start <= last.date);
        const leverageStress = event.vr_tagged_event.vr_analysis.leverage_stress ?? null;
        const recoveryQuality = event.vr_tagged_event.vr_analysis.recovery_quality ?? null;
        cycleSeeds.push({
            cycle_no: cycleNo,
            cycle_start_date: first.date,
            cycle_end_date: last.date,
            event_id: event.event_id,
            event_date: event.start,
            is_active_cycle: eventActive,
            days_from_event_start: daysBetween(event.start, first.date),
            days_to_event_end: daysBetween(last.date, eventEndDate),
            vref: anchor != null ? Number(anchor.toFixed(2)) : null,
            vmin: anchor != null ? Number((anchor * 0.85).toFixed(2)) : null,
            vmax: anchor != null ? Number((anchor * 1.15).toFixed(2)) : null,
            ma200_status: event.vr_tagged_event.vr_analysis.ma200_status ?? event.pattern_matches.top_matches[0]?.pattern_name ?? null,
            leverage_stress: leverageStress,
            recovery_quality: recoveryQuality,
            pattern_type: event.vr_tagged_event.vr_analysis.pattern_type ?? event.pattern_matches.top_matches[0]?.pattern_id ?? null,
            scenario_bias: event.vr_tagged_event.vr_analysis.scenario_bias ?? [],
            playbook_bias: event.vr_tagged_event.vr_analysis.playbook_bias ?? [],
            buy_permission_state: leverageStress === 'extreme' || leverageStress === 'high'
                ? 'paused'
                : recoveryQuality === 'improving' || recoveryQuality === 'strong'
                    ? 'allowed'
                    : 'pending',
            defense_state: leverageStress === 'extreme' || event.vr_support_status === 'pending_synthetic'
                ? 'active'
                : leverageStress === 'high'
                    ? 'monitoring'
                    : 'pending',
            theoretical_buy_grid: buildGridLevels({ anchor, offsets: [-0.02, -0.04, -0.06, -0.08, -0.1], status: 'pending', label: 'buy' }),
            theoretical_sell_grid: buildGridLevels({ anchor, offsets: [0.02, 0.04, 0.06, 0.08, 0.1], status: 'pending', label: 'sell' }),
            representative_buy_grid: buildGridLevels({ anchor, offsets: [-0.03, -0.07, -0.11], status: 'watch', label: 'buy' }),
            representative_sell_grid: buildGridLevels({ anchor, offsets: [0.03, 0.07, 0.11], status: 'watch', label: 'sell' }),
        });
    }
    const activeSelection = (0, select_active_cycle_1.selectActiveCycle)({
        cycles: cycleSeeds,
        replayDate,
        selectedCycleNo,
    });
    return cycleSeeds.map((cycle, index) => ({
        ...cycle,
        is_active_cycle: index === activeSelection.active_cycle_index,
    }));
}
function buildTriggerLog(cycles) {
    const items = [];
    cycles.forEach((cycle) => {
        items.push({
            timestamp: cycle.cycle_start_date,
            cycle_no: cycle.cycle_no,
            event_type: 'cycle_reset',
            severity: 'info',
            title: `Cycle ${cycle.cycle_no} Reset`,
            message: 'Two-week replay cycle initialized.',
            source: 'cycle_engine_placeholder',
            related_metric: 'cycle_window',
            related_value: `${cycle.cycle_start_date} to ${cycle.cycle_end_date}`,
            note: 'Framework placeholder for future VR cycle reset logic.',
        });
        if (cycle.ma200_status?.toLowerCase().includes('breach')) {
            items.push({
                timestamp: cycle.cycle_start_date,
                cycle_no: cycle.cycle_no,
                event_type: 'ma200_breach',
                severity: 'warning',
                title: 'MA200 Breach Active',
                message: 'Cycle opened with a breached MA200 interpretation.',
                source: 'vr_tag_bridge',
                related_metric: 'ma200_status',
                related_value: cycle.ma200_status,
                note: null,
            });
        }
    });
    return items;
}
function buildSnapshot(activeCycle, triggerLog) {
    if (!activeCycle)
        return null;
    const cycleTriggers = triggerLog.filter((item) => item.cycle_no === activeCycle.cycle_no).map((item) => item.title);
    return {
        cycle_no: activeCycle.cycle_no,
        cycle_window: `${activeCycle.cycle_start_date} - ${activeCycle.cycle_end_date}`,
        vref: activeCycle.vref == null ? 'Pending' : activeCycle.vref.toFixed(2),
        vmin: activeCycle.vmin == null ? 'Pending' : activeCycle.vmin.toFixed(2),
        vmax: activeCycle.vmax == null ? 'Pending' : activeCycle.vmax.toFixed(2),
        pattern_type: formatToken(activeCycle.pattern_type),
        ma200_status: formatToken(activeCycle.ma200_status),
        leverage_stress: formatToken(activeCycle.leverage_stress),
        recovery_quality: formatToken(activeCycle.recovery_quality),
        buy_permission: formatToken(activeCycle.buy_permission_state),
        defense_state: formatToken(activeCycle.defense_state),
        scenario_bias: activeCycle.scenario_bias.map(formatToken),
        playbook_bias: activeCycle.playbook_bias.map(formatToken),
        representative_buy_levels: activeCycle.representative_buy_grid.map((level) => `${level.level_no}: ${level.price.toFixed(2)}`),
        representative_sell_levels: activeCycle.representative_sell_grid.map((level) => `${level.level_no}: ${level.price.toFixed(2)}`),
        key_trigger_notes: cycleTriggers,
    };
}
function buildChartOverlay(cycles, triggerLog) {
    const activeCycle = cycles.find((cycle) => cycle.is_active_cycle) ?? null;
    return {
        cycle_boundary_markers: cycles.map((cycle) => ({
            date: cycle.cycle_start_date,
            cycle_no: cycle.cycle_no,
            label: `C${cycle.cycle_no}`,
        })),
        active_cycle_highlight: activeCycle
            ? {
                start_date: activeCycle.cycle_start_date,
                end_date: activeCycle.cycle_end_date,
            }
            : null,
        reference_lines: cycles.flatMap((cycle) => [
            { line_type: 'vref', cycle_no: cycle.cycle_no, value: cycle.vref, start_date: cycle.cycle_start_date, end_date: cycle.cycle_end_date },
            { line_type: 'vmin', cycle_no: cycle.cycle_no, value: cycle.vmin, start_date: cycle.cycle_start_date, end_date: cycle.cycle_end_date },
            { line_type: 'vmax', cycle_no: cycle.cycle_no, value: cycle.vmax, start_date: cycle.cycle_start_date, end_date: cycle.cycle_end_date },
        ]),
        representative_buy_markers: cycles.flatMap((cycle) => cycle.representative_buy_grid.map((level) => ({
            date: cycle.cycle_start_date,
            cycle_no: cycle.cycle_no,
            level_no: level.level_no,
            price: level.price,
        }))),
        representative_sell_markers: cycles.flatMap((cycle) => cycle.representative_sell_grid.map((level) => ({
            date: cycle.cycle_start_date,
            cycle_no: cycle.cycle_no,
            level_no: level.level_no,
            price: level.price,
        }))),
        trigger_flags: triggerLog.map((item) => ({
            date: item.timestamp,
            cycle_no: item.cycle_no,
            title: item.title,
            severity: item.severity,
        })),
    };
}
function buildEventCycleFramework(input) {
    const cycles = buildCycleRows(input.event, input.replayDate, input.selectedCycleNo);
    const activeSelection = (0, select_active_cycle_1.selectActiveCycle)({
        cycles,
        replayDate: input.replayDate,
        selectedCycleNo: input.selectedCycleNo,
    });
    const triggerLog = buildTriggerLog(cycles);
    const snapshot = buildSnapshot(activeSelection.active_cycle, triggerLog);
    const chartOverlay = buildChartOverlay(cycles, triggerLog);
    return {
        cycles,
        active_selection: activeSelection,
        snapshot,
        trigger_log: triggerLog,
        chart_overlay: chartOverlay,
    };
}
function runCycleFrameworkExamples(events) {
    const cases = ['2026-02', '2020-02', '2018-10'];
    return cases.map((eventId) => {
        const event = events.find((item) => item.event_id === eventId);
        const framework = event ? buildEventCycleFramework({ event }) : null;
        return {
            event_id: eventId,
            passed: Boolean(framework) &&
                (framework?.cycles.length ?? 0) > 0 &&
                Boolean(framework?.snapshot) &&
                Array.isArray(framework?.trigger_log) &&
                Array.isArray(framework?.chart_overlay.cycle_boundary_markers),
            cycle_count: framework?.cycles.length ?? 0,
            active_cycle_no: framework?.snapshot?.cycle_no ?? null,
        };
    });
}
