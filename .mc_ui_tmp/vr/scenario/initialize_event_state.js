"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeEventState = initializeEventState;
exports.runInitialStateExamples = runInitialStateExamples;
const path_1 = __importDefault(require("path"));
const default_event_state_1 = require("./default_event_state");
const derive_initial_position_1 = require("./derive_initial_position");
const get_simulation_start_date_1 = require("./get_simulation_start_date");
const validate_initial_state_1 = require("./validate_initial_state");
function getDatabaseCtor() {
    const runtimeRequire = eval('require');
    return runtimeRequire('better-sqlite3');
}
function resolveDbPath(rootDir = process.cwd()) {
    return path_1.default.join(rootDir, 'marketflow', 'data', 'marketflow.db');
}
function mapRows(rows) {
    return rows
        .map((row) => row)
        .filter((row) => typeof row.date === 'string' && typeof row.close === 'number' && Number.isFinite(row.close))
        .map((row) => ({
        date: row.date,
        close: row.close,
    }));
}
function buildSyntheticSeries(qqqRows) {
    let synthetic = 100;
    return qqqRows.map((row, index) => {
        if (index === 0) {
            return { date: row.date, close: Number(synthetic.toFixed(2)) };
        }
        const prev = qqqRows[index - 1];
        const qqqReturn = prev.close > 0 ? (row.close - prev.close) / prev.close : 0;
        synthetic = Math.max(1, synthetic * (1 + qqqReturn * 3));
        return { date: row.date, close: Number(synthetic.toFixed(2)) };
    });
}
function buildStartOptions(input) {
    const realTqqqByDate = new Map(input.tqqqRows.map((row) => [row.date, row.close]));
    const syntheticByDate = new Map(buildSyntheticSeries(input.qqqRows).map((row) => [row.date, row.close]));
    return input.qqqRows
        .map((row) => {
        const realTqqq = realTqqqByDate.get(row.date);
        const synthetic = syntheticByDate.get(row.date);
        if (typeof realTqqq === 'number') {
            return {
                date: row.date,
                start_price: Number(realTqqq.toFixed(2)),
                price_source: 'real_tqqq',
            };
        }
        if (typeof synthetic === 'number') {
            return {
                date: row.date,
                start_price: Number(synthetic.toFixed(2)),
                price_source: 'synthetic_tqqq_3x',
            };
        }
        return null;
    })
        .filter((row) => Boolean(row));
}
function initializeEventState(input) {
    const DatabaseCtor = getDatabaseCtor();
    const db = new DatabaseCtor(resolveDbPath(input.rootDir), { readonly: true, fileMustExist: true });
    try {
        const qqqRows = mapRows(db.prepare(`
        SELECT date, close
        FROM ohlcv_daily
        WHERE symbol = 'QQQ' AND date < ?
        ORDER BY date DESC
        LIMIT ?
      `).all(input.eventStartDate, default_event_state_1.EVENT_INITIAL_STATE_DEFAULTS.startOptionHistoryCap)).reverse();
        const earliestDate = qqqRows[0]?.date ?? input.eventStartDate;
        const tqqqRows = mapRows(db.prepare(`
        SELECT date, close
        FROM ohlcv_daily
        WHERE symbol = 'TQQQ' AND date >= ? AND date < ?
        ORDER BY date ASC
      `).all(earliestDate, input.eventStartDate));
        const availableStartOptions = qqqRows.length ? buildStartOptions({ qqqRows, tqqqRows }) : [];
        const startSelection = (0, get_simulation_start_date_1.getSimulationStartDate)({
            availableStartOptions,
            overrideDate: input.overrides?.simulation_start_date,
        });
        const selectedStartOption = availableStartOptions.find((option) => option.date === startSelection.simulationStartDate) ?? null;
        const derivedInitialState = selectedStartOption || typeof input.overrides?.start_price_override === 'number'
            ? (0, derive_initial_position_1.deriveInitialPosition)({
                startPrice: selectedStartOption?.start_price ?? input.overrides?.start_price_override,
                overrides: input.overrides,
            })
            : null;
        const validation = (0, validate_initial_state_1.validateInitialState)({
            simulationStartDate: startSelection.simulationStartDate,
            initialState: derivedInitialState,
            overrides: input.overrides,
        });
        const lookupError = !availableStartOptions.length
            ? 'Start price lookup failed for the derived simulation window. Use a manual start price override if needed.'
            : undefined;
        return {
            event_id: input.eventId,
            ticker: 'TQQQ',
            event_start_date: input.eventStartDate,
            event_end_date: input.eventEndDate,
            simulation_start_date: startSelection.simulationStartDate,
            default_warmup_trading_days: startSelection.effectiveWarmupTradingDays,
            requested_warmup_trading_days: default_event_state_1.EVENT_INITIAL_STATE_DEFAULTS.warmupTradingDays,
            initial_state: derivedInitialState,
            available_start_options: availableStartOptions,
            validation,
            lookup_error: lookupError,
            manual_start_price_override_allowed: true,
            cycle_placeholders: {
                vref: null,
                vmin: null,
                vmax: null,
                cycle_no: null,
                cycle_start_date: null,
                cycle_end_date: null,
            },
        };
    }
    finally {
        db.close();
    }
}
function runInitialStateExamples(rootDir) {
    const defaultCase = initializeEventState({
        rootDir,
        eventId: '2020-02',
        eventStartDate: '2020-02-25',
        eventEndDate: '2020-05-14',
    });
    const manualCase = initializeEventState({
        rootDir,
        eventId: '2020-02',
        eventStartDate: '2020-02-25',
        eventEndDate: '2020-05-14',
        overrides: {
            advanced_mode: true,
            initial_capital: 25000,
            initial_share_count: 180,
            initial_average_price: 55,
            initial_pool_cash: 15100,
            stock_allocation_pct: 0.8,
            pool_allocation_pct: 0.2,
        },
    });
    const missingPriceCase = initializeEventState({
        rootDir,
        eventId: '1990-01',
        eventStartDate: '1990-01-10',
        eventEndDate: '1990-02-10',
        overrides: {
            start_price_override: 42,
        },
    });
    return [
        {
            case: 'default',
            passed: defaultCase.validation.valid &&
                defaultCase.initial_state?.stock_allocation_pct === 0.8 &&
                defaultCase.initial_state?.pool_allocation_pct === 0.2 &&
                Boolean(defaultCase.simulation_start_date),
        },
        {
            case: 'manual_override',
            passed: manualCase.validation.valid &&
                manualCase.initial_state?.initial_share_count === 180 &&
                manualCase.initial_state?.initial_average_price === 55,
        },
        {
            case: 'missing_start_price',
            passed: missingPriceCase.manual_start_price_override_allowed &&
                Boolean(missingPriceCase.lookup_error) &&
                missingPriceCase.initial_state?.start_price === 42,
        },
    ];
}
