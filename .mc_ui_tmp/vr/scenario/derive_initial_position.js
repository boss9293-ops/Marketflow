"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveInitialPosition = deriveInitialPosition;
const default_event_state_1 = require("./default_event_state");
function deriveInitialPosition(input) {
    const overrides = input.overrides ?? {};
    const initialCapital = overrides.initial_capital ?? default_event_state_1.EVENT_INITIAL_STATE_DEFAULTS.initialCapital;
    const stockAllocationPct = overrides.stock_allocation_pct ?? default_event_state_1.EVENT_INITIAL_STATE_DEFAULTS.stockAllocationPct;
    const poolAllocationPct = overrides.pool_allocation_pct ?? default_event_state_1.EVENT_INITIAL_STATE_DEFAULTS.poolAllocationPct;
    const startPrice = overrides.start_price_override ?? input.startPrice;
    if (overrides.advanced_mode) {
        const initialShareCount = Math.max(0, Math.floor(overrides.initial_share_count ?? 0));
        const initialAveragePrice = overrides.initial_average_price ?? startPrice;
        const initialStockCost = Number((initialShareCount * initialAveragePrice).toFixed(2));
        const initialPoolCash = Number((overrides.initial_pool_cash ?? Math.max(0, initialCapital - initialStockCost)).toFixed(2));
        return {
            initial_capital: initialCapital,
            stock_allocation_pct: stockAllocationPct,
            pool_allocation_pct: poolAllocationPct,
            start_price: Number(startPrice.toFixed(2)),
            initial_share_count: initialShareCount,
            initial_average_price: Number(initialAveragePrice.toFixed(2)),
            initial_stock_cost: initialStockCost,
            initial_pool_cash: initialPoolCash,
        };
    }
    const initialShareCount = Math.floor((initialCapital * stockAllocationPct) / startPrice);
    const initialStockCost = Number((initialShareCount * startPrice).toFixed(2));
    const initialPoolCash = Number((initialCapital - initialStockCost).toFixed(2));
    return {
        initial_capital: initialCapital,
        stock_allocation_pct: stockAllocationPct,
        pool_allocation_pct: poolAllocationPct,
        start_price: Number(startPrice.toFixed(2)),
        initial_share_count: initialShareCount,
        initial_average_price: Number(startPrice.toFixed(2)),
        initial_stock_cost: initialStockCost,
        initial_pool_cash: initialPoolCash,
    };
}
