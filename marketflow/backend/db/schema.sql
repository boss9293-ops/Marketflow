-- MarketFlow DB Schema
-- Source of truth for all table definitions.
-- Run against a blank SQLite file to bootstrap a new DB.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Core price data ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ohlcv_daily (
    symbol      TEXT    NOT NULL,
    date        TEXT    NOT NULL,   -- ISO 8601: YYYY-MM-DD
    open        REAL,
    high        REAL,
    low         REAL,
    close       REAL,
    adj_close   REAL,               -- = close when source is spooq (no split-adj available)
    volume      INTEGER,
    source      TEXT,               -- 'spooq' | 'yfinance' | 'stooq' | 'fmp'
    updated_at  TEXT,
    PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol ON ohlcv_daily (symbol);
CREATE INDEX IF NOT EXISTS idx_ohlcv_date   ON ohlcv_daily (date);

CREATE TABLE IF NOT EXISTS ticker_history_daily (
    symbol  TEXT    NOT NULL,
    date    TEXT    NOT NULL,
    open    REAL,
    high    REAL,
    low     REAL,
    close   REAL,
    volume  INTEGER,
    PRIMARY KEY (symbol, date)
);

-- ── Universe ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS universe_symbols (
    symbol       TEXT    NOT NULL PRIMARY KEY,
    name         TEXT    NOT NULL,
    sector       TEXT,
    industry     TEXT,
    exchange     TEXT,
    market_cap   REAL,
    is_active    INTEGER NOT NULL DEFAULT 1,
    is_top100    INTEGER NOT NULL DEFAULT 0,
    last_updated TEXT
);

-- ── ETF Catalog ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS etf_catalog (
    symbol          TEXT    NOT NULL PRIMARY KEY,
    display_name    TEXT    NOT NULL,
    category        TEXT    NOT NULL,   -- index | sector | leverage | reverse | ark | dividend | crypto | fixed_income | commodity
    subcategory     TEXT,
    strategy_tier   TEXT    NOT NULL,   -- core | satellite | tactical
    direction       TEXT    NOT NULL DEFAULT 'long',
    leverage_factor REAL,
    priority        INTEGER NOT NULL DEFAULT 100,
    source          TEXT    NOT NULL DEFAULT 'manual',
    notes           TEXT,
    last_updated    TEXT    NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_etf_catalog_category ON etf_catalog (category);

-- ── Market indicators ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market_daily (
    date        TEXT    NOT NULL PRIMARY KEY,
    spy         REAL,
    qqq         REAL,
    iwm         REAL,
    vix         REAL,
    dxy         REAL,
    us10y       REAL,
    us2y        REAL,
    oil         REAL,
    gold        REAL,
    btc         REAL,
    move        REAL,
    updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS indicators_daily (
    symbol      TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    sma20       REAL,
    sma50       REAL,
    sma200      REAL,
    ema8        REAL,
    ema21       REAL,
    rsi14       REAL,
    macd        REAL,
    macd_signal REAL,
    atr14       REAL,
    vol20       REAL,
    ret1d       REAL,
    ret5d       REAL,
    updated_at  TEXT,
    PRIMARY KEY (symbol, date)
);

-- ── Signals & snapshots ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signals (
    id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    date         TEXT    NOT NULL,
    symbol       TEXT,
    signal_type  TEXT    NOT NULL,
    score        REAL,
    status       TEXT,
    payload_json TEXT,
    created_at   TEXT    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_snapshots (
    date               TEXT    NOT NULL PRIMARY KEY,
    total_stocks       INTEGER,
    vcp_count          INTEGER,
    rotation_count     INTEGER,
    market_phase       TEXT,
    gate_score         REAL,
    risk_level         TEXT,
    ml_spy_prob        REAL,
    ml_qqq_prob        REAL,
    data_version       TEXT,
    generated_at       TEXT,
    gate_score_10d_avg REAL,
    gate_score_30d_avg REAL,
    gate_delta_5d      REAL,
    risk_trend         TEXT,
    phase_shift_flag   INTEGER
);

-- ── Strategy & backtest ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_daily (
    strategy_name   TEXT    NOT NULL,
    date            TEXT    NOT NULL,
    symbol          TEXT    NOT NULL,
    action          TEXT,
    target_exposure REAL,
    next_buy_level  REAL,
    next_sell_level REAL,
    notes_json      TEXT,
    generated_at    TEXT,
    PRIMARY KEY (strategy_name, date)
);

CREATE TABLE IF NOT EXISTS backtest_runs (
    run_id          TEXT    NOT NULL PRIMARY KEY,
    strategy_name   TEXT    NOT NULL,
    symbol          TEXT,
    start_date      TEXT,
    end_date        TEXT,
    params_json     TEXT,
    created_at      TEXT    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS backtest_equity (
    run_id      TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    equity      REAL,
    cash        REAL,
    exposure    REAL,
    drawdown    REAL,
    PRIMARY KEY (run_id, date)
);

CREATE TABLE IF NOT EXISTS backtest_trades (
    trade_id    INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    symbol      TEXT,
    action      TEXT    NOT NULL,
    qty         REAL,
    price       REAL,
    fee         REAL,
    pnl         REAL,
    note        TEXT
);

-- ── ML predictions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ml_predictions_daily (
    date                TEXT    NOT NULL,
    symbol              TEXT    NOT NULL,
    horizon_days        INTEGER NOT NULL DEFAULT 5,
    up_prob             REAL,
    down3_prob          REAL,
    down5_prob          REAL,
    vol_high_prob       REAL,
    confidence_label    TEXT,
    model_version       TEXT,
    top_features_json   TEXT,
    metrics_json        TEXT,
    generated_at        TEXT,
    pred_up_2d          REAL,
    pred_up_5d          REAL,
    pred_up_10d         REAL,
    prob_mdd_le_3_5d    REAL,
    prob_mdd_le_5_5d    REAL,
    recent_metrics_json TEXT,
    action_mode         TEXT,
    action_text_ko      TEXT,
    action_reasons_json TEXT,
    PRIMARY KEY (date, symbol, horizon_days)
);

-- ── Fundamental & consensus cache ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_fundamentals_cache (
    symbol      TEXT    NOT NULL PRIMARY KEY,
    source      TEXT    NOT NULL,
    metrics_json TEXT,
    stats_json  TEXT,
    captured_at TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS fmp_consensus_snapshot (
    ticker                  TEXT    NOT NULL PRIMARY KEY,
    source                  TEXT    NOT NULL DEFAULT 'fmp',
    captured_at             TEXT    NOT NULL,
    source_asof             TEXT,
    eps_estimate_fy1        REAL,
    eps_estimate_fy2        REAL,
    target_mean             REAL,
    target_high             REAL,
    target_low              REAL,
    analyst_count           INTEGER,
    target_analyst_count    INTEGER,
    raw_estimates_json      TEXT,
    raw_price_target_json   TEXT,
    payload_json            TEXT    NOT NULL,
    eps_ladder_json         TEXT,
    created_at              TEXT    NOT NULL,
    updated_at              TEXT    NOT NULL
);

-- ── Watchlist ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watchlist_symbols (
    id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    symbol      TEXT    NOT NULL,
    label       TEXT,
    created_at  TEXT    DEFAULT CURRENT_TIMESTAMP
);
