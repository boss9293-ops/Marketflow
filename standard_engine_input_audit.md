# Standard Engine Input Audit

## Audit Basis
- Standard engine audited: `marketflow/backend/scripts/build_risk_v1.py`
- Output checked: `marketflow/backend/output/risk_v1.json`
- Live file checked for structure/output presence: run_id `20260320_223449`, data_as_of `2026-03-19`
- Adjacent files searched only to classify indirect/missing signals: `marketflow/backend/validation_engine.py`, `marketflow/backend/jobs/build_macro_snapshot.py`, `marketflow/backend/config/macro_policy_v1.json`, `marketflow/backend/collectors/collect_fred.py`, `marketflow/backend/scripts/update_market_daily.py`
- No engine logic, thresholds, indicators, or UI were changed

## Engine Definition Used For This Audit
For this work order, "Standard Risk Engine" means the live `risk_v1` build path inside `build_risk_v1.py`:

- MSS / `current`
- 12-layer `total_risk`
- Track A / Track A Early / Track B / Track C
- `master_signal`

Signals that exist elsewhere in the repo but do not feed `build_risk_v1.py` are marked `currently_used = N`.

## Core Structure / Context
| signal_name | source_file | source_series | currently_used | usage_location | purpose | output_impact | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QQQ_MSS_core | `build_risk_v1.py` | `ticker_history_daily.QQQ.close` | Y | `main MSS`; `detect_event_type`; `compute_track_a` equity filter; `compute_track_b_velocity` | Core MSS input for trend, drawdown, MA state, and exposure logic | HIGH | Primary Standard anchor; also creates realized-vol percentile and event-type classification |
| SPY_DIA_context | `build_risk_v1.py` | `ohlcv_daily.SPY.close`; `ohlcv_daily.DIA.close` | Y | `_struct_score`; `build_final_risk`; `build_context_history` | Broad-market confirmation/moderation of Nasdaq signal | MED | Affects `final_risk`/`final_exposure` context; does not change `total_risk.total` |
| Market_breadth_universe | `build_risk_v1.py` | `ohlcv_daily` universe breadth query | Y | `compute_breadth_metrics`; `_layer2_breadth`; `classify_risk_scenario` | Participation and internal-weakness check | HIGH | Falls back to QQQ/SPY rotation if breadth query is unavailable |
| QQQ_SPY_relative_rotation | `build_risk_v1.py` | derived `QQQ/SPY` relative return | Y | `_rotation_filter`; `build_final_risk`; `_layer2_breadth` fallback; `_layer8_shock` | Tech-vs-broad-market rotation context | MED | Used for context/fallback and shock divergence; not a direct macro/rates signal |

## A. Rates / Yields
| signal_name | source_file | source_series | currently_used | usage_location | purpose | output_impact | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MOVE_TLT_bond_stress_proxies | `build_risk_v1.py`; `build_replay_v1.py` | `market_daily.move`; `ohlcv_daily.TLT.close` | Y | `_layer11_liquidity_shock` | Rate-volatility / bond-stress proxy | MED | Only live bond-stress block; live build uses `market_daily.move` while replay loads `cache.MOVE` |
| US10Y | `update_market_daily.py`; `collect_fred.py`; `build_macro_snapshot.py` | `market_daily.us10y` / FRED `DGS10` | N | not wired to `build_risk_v1.py` | Available rates data outside Standard engine | NONE | Clear gap: no 10Y level/change/momentum logic in Standard |
| US2Y | `update_market_daily.py`; `collect_fred.py`; `build_macro_snapshot.py` | `market_daily.us2y` / FRED `DGS2` | N | not wired to `build_risk_v1.py` | Available rates data outside Standard engine | NONE | Clear gap: no 2Y input in Standard |
| Yield_curve_10Y_2Y | `build_macro_snapshot.py` | `DGS10 - DGS2` (fallback `DGS10 - EFFR`) | N | macro snapshot only; not wired to `build_risk_v1.py` | Macro yield-curve measure outside Standard engine | NONE | Treasury curve logic is absent from Standard even though the repo computes it elsewhere |

## B. Inflation / Macro Event Proxies
| signal_name | source_file | source_series | currently_used | usage_location | purpose | output_impact | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| XLF_XLU_defensive_rotation | `build_risk_v1.py` | `ohlcv_daily.XLF.close`; `ohlcv_daily.XLU.close`; SPY benchmark | Y | `_layer7_macro` | Macro/defensive rotation proxy | HIGH | Main Standard macro proxy in place of direct macro-release series |
| XLF_KRE_financial_transmission | `build_risk_v1.py` | `ohlcv_daily.XLF.close`; `ohlcv_daily.KRE.close`; SPY benchmark | Y | `_layer12_financial_stress`; `compute_track_a_early` | Bank/broker transmission proxy | HIGH | Models financial propagation through equities, not bank funding spreads |
| IWM_SPY_risk_appetite | `build_risk_v1.py` | derived `IWM/SPY` relative return | Y | `_layer9_cross_asset`; `classify_risk_scenario` | Small-cap risk-appetite proxy | LOW | Secondary confirmation only |
| EFFR_WALCL_RRP_macro_liquidity | `validation_engine.py`; `macro_policy_v1.json`; `build_macro_snapshot.py` | FRED `EFFR`; `WALCL`; `RRPONTSYD` | N | validation/macro snapshot only; not wired to `build_risk_v1.py` | Separate validation/macro-engine inputs for RPI/LPI/MPS | NONE | Present elsewhere in repo, but they do not move Standard outputs today |
| CPI_release_handling | `build_macro_snapshot.py`; `macro_policy_v1.json` | FRED `CPIAUCSL` | N | macro snapshot real-rate proxy only; no `build_risk_v1.py` consumer | Inflation series exists outside Standard only | NONE | No CPI release-date/event handling or direct Standard wiring found |
| PPI_release_handling | not found | none | N | not found | Not implemented | NONE | No PPI series, threshold, or release logic found in searched Standard/macro backend paths |
| Jobless_claims_release_handling | not found | none | N | not found | Not implemented | NONE | No jobless claims / labor-release logic found in searched Standard/macro backend paths |

## C. Risk / Volatility
| signal_name | source_file | source_series | currently_used | usage_location | purpose | output_impact | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VIX_implied_vol_family | `build_risk_v1.py` | `cache.VIX` or `market_daily.vix` | Y | `_layer5_liquidity`; `_layer6_funding`; `_layer8_shock`; `_layer11_liquidity_shock`; `compute_track_c` | Primary implied-vol / fear input | HIGH | Standard uses VIX only; broader vol-family term structure is not implemented |
| PUT_CALL_ratio | `build_risk_v1.py` | `cache.PUT_CALL` | Y | `_layer6_funding`; `_layer8_shock`; `_layer10_credit_spread`; `compute_master_signal` escalation conditions | Hedging-demand / funding-friction proxy | HIGH | Collector can proxy PUT/CALL from VIX if direct CBOE series fails |
| QQQ_realized_vol_component | `build_risk_v1.py` | derived 20d realized vol percentile from QQQ returns | Y | `main MSS block` | Realized-vol penalty inside MSS | HIGH | Realized vol is present through MSS even though the implied-vol block is VIX-centric |

## D. Liquidity / Credit
| signal_name | source_file | source_series | currently_used | usage_location | purpose | output_impact | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HYG_credit_proxy | `build_risk_v1.py` | `ohlcv_daily.HYG.close` or `cache.HYG` | Y | `_layer3_credit`; `_layer4_leveraged_loan`; `_layer5_liquidity`; `_layer6_funding`; `_layer9_cross_asset`; `compute_track_a` | High-yield price stress proxy | HIGH | One of the most reused market-credit inputs in the Standard engine |
| LQD_credit_proxy | `build_risk_v1.py` | `ohlcv_daily.LQD.close` or `cache.LQD` | Y | `_layer3_credit`; `_layer5_liquidity` | Investment-grade benchmark against HYG | MED | Mostly used as denominator/benchmark rather than as a standalone signal |
| HYG_LQD_relative_spread_proxy | `build_risk_v1.py` | derived HYG/LQD relative move | Y | `_layer3_credit`; `_layer5_liquidity` | ETF credit-spread / liquidity-preference proxy | HIGH | Core liquid-market credit proxy inside L3 and L5 |
| Private_credit_manager_basket_BX_KKR_APO_ARES | `build_risk_v1.py` | `ohlcv_daily.BX/APO/KKR/ARES.close` | Y | `_layer3_credit` | Private-credit transmission proxy | MED | Public-equity stand-in for alt-manager stress rather than direct credit spreads |
| Leveraged_loan_ETFs_BKLN_SRLN | `build_risk_v1.py` | `ohlcv_daily.BKLN.close`; `ohlcv_daily.SRLN.close` | Y | `_layer4_leveraged_loan` | Direct leveraged-loan stress proxy | HIGH | ETF drawdown proxy; no direct loan-spread series used |
| BKLN_HYG_relative_loan_stress | `build_risk_v1.py` | derived `BKLN/HYG` relative return | Y | `_layer4_leveraged_loan`; `compute_track_a`; `compute_track_a_early` | Loan-market weakness vs HY | HIGH | Important early-transmission input in Layer 4 and Track A |
| BDC_basket_vs_SPY | `build_risk_v1.py` | derived mean(`ARCC`,`OBDC`,`BXSL`) / `SPY` | Y | `compute_track_a`; `compute_track_a_early` | Early private-credit weakening proxy | MED | Track-only input; changes Track A / master_signal, not `total_risk.total` |
| DXY_dollar_liquidity_stress | `build_risk_v1.py` | `cache.DXY` with `market_daily.dxy` fallback | Y | `_load_preferred_series`; `_layer5_liquidity`; `_layer11_liquidity_shock` | Dollar liquidity drain / global tightening proxy | HIGH | This is the explicit dollar-stress input; current live output uses `market_daily` fallback |
| Credit_spreads_HY_OAS_IG_OAS | `build_risk_v1.py` | `cache.HY_OAS`; `cache.IG_OAS` | Y | `_layer10_credit_spread`; `compute_track_a` | Direct cash credit-spread monitor | HIGH | HY_OAS is more influential than IG_OAS; both also feed Track A |
| HY_IG_OAS_spread | `build_risk_v1.py` | derived `HY_OAS - IG_OAS` | Y | `_layer10_credit_spread` | Credit risk-premium widening | HIGH | Explicit spread signal, but it is credit spread logic rather than Treasury curve logic |
| FSI_st_louis_financial_stress | `build_risk_v1.py` | `cache.FSI (STLFSI4)` | Y | `_layer10_credit_spread` | Weekly system-wide stress overlay | MED | Weekly cadence makes it slower than ETF/VIX inputs |

## E. Shock / Commodity
| signal_name | source_file | source_series | currently_used | usage_location | purpose | output_impact | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| USDJPY_yen_carry_unwind | `build_risk_v1.py` | `ohlcv_daily.JPY=X.close` | Y | `compute_track_c` | Exogenous yen-carry shock sensor | MED | Track C only; changes Track C state and master_signal, not `total_risk.total` |
| Oil_energy_shock | `build_risk_v1.py` | `market_daily.oil` | Y | `compute_track_c` | Energy/geopolitical shock sensor | MED | Present only as 1-day z-score in Track C; not integrated into 12-layer `total_risk` |
| GLD_safe_haven_vs_SPY | `build_risk_v1.py` | `ohlcv_daily.GLD.close` vs `SPY` close | Y | `compute_track_c` | Flight-to-safety confirmation | MED | Track C only |

## Direct Answer To The Requested Check
- CPI / PPI / jobless-related release handling: not present in `build_risk_v1.py`
- US10Y / US2Y / 10Y-2Y spread: data exists elsewhere in repo, but none of it is wired into the Standard engine
- Rate volatility / bond-market stress proxy: present through `MOVE` and `TLT`, but only in Layer 11
- VIX / volatility family: VIX is heavily used; broader vol-family term structure is absent
- Oil / energy shock sensitivity: present, but Track C only
- Dollar / liquidity / credit stress: strongly present

## Special Question Answers
| item | is it already present? | materially affects engine output? | if missing, should it be... | note |
| --- | --- | --- | --- | --- |
| CPI | INDIRECT | NONE | reserved for Smart Analyzer layer | CPIAUCSL exists in macro snapshot code, but Standard never reads it and has no release-event logic |
| PPI | NO | NONE | reserved for Smart Analyzer layer | No PPI series or release logic found |
| Jobless claims | NO | NONE | reserved for Smart Analyzer layer | No jobless/labor-release logic found |
| US10Y | INDIRECT | NONE | added to Standard Engine later | Data is collected/stored, but not consumed by Standard |
| US2Y | INDIRECT | NONE | added to Standard Engine later | Data is collected/stored, but not consumed by Standard |
| rate volatility | YES | MED | n/a | Present through `MOVE`, `TLT`, and supporting VIX stress blocks |
| oil shock | YES | MED | n/a | Present in Track C only |
| dollar stress | YES | HIGH | n/a | Present through DXY in Layer 5 and Layer 11 |
| credit stress | YES | HIGH | n/a | One of the strongest Standard-engine coverage areas |

## Final Summary Section

### 1. Signals already strong in Standard Engine
- Credit stress and transmission are strong: `HYG/LQD`, `HY_OAS/IG_OAS`, `HY-IG spread`, `BKLN/SRLN`, `BKLN/HYG`, `BX/KKR/APO/ARES`, and `BDC/SPY` are all live.
- Liquidity/funding stress is strong: `DXY`, `VIX`, `PUT_CALL`, `FSI`, plus dedicated Liquidity/Funding layers are already active.
- Market structure and participation are strong: QQQ MSS, breadth metrics, SPY/DIA context, and QQQ/SPY rotation are already wired.
- Defensive macro proxies are solid: `XLF/XLU` rotation and `XLF/KRE` transmission give the engine meaningful macro-financial context even without release data.

### 2. Signals present but weak / underused
- Rate-vol / bond stress is present only through `MOVE` and `TLT` in Layer 11, so bond-market intelligence is materially lighter than credit/liquidity intelligence.
- `oil`, `USDJPY`, and `GLD` are live only in Track C, so they can change `track_c` and `master_signal` but do not enter `total_risk.total`.
- `FSI` is useful but weekly and slower than the ETF/VIX blocks.
- SPY/DIA context is useful for `final_risk` moderation, but it is not part of the 12-layer total-risk score.

### 3. Signals missing
- Direct `US10Y` level/change/momentum.
- Direct `US2Y` level/change/momentum.
- Direct Treasury `10Y-2Y` yield-curve logic inside Standard.
- CPI/PPI/jobless release handling.
- PPI and jobless-claims series in the searched Standard/macro backend path.

### 4. Signals better handled by Smart Analyzer instead of core engine
- CPI/PPI/jobless release interpretation and post-release context.
- News filtering and headline triage.
- Event-vs-structural classification on top of existing Track C sensors.
- War/geopolitical attribution, because the Standard engine already has market-reaction sensors but not narrative interpretation.

### 5. Recommendation: proceed to WO-SA1 or not
Proceed to WO-SA1.

Reason:

- The Standard engine already has strong market-based intelligence in credit, liquidity, volatility, dollar stress, defensive rotation, and exogenous-shock sensing.
- The biggest remaining core-market-data gap is explicit Treasury/yield input (`US10Y`, `US2Y`, `10Y-2Y`), not broad lack of market awareness.
- Smart Analyzer should therefore focus first on macro-event interpretation, news filtering, and event-vs-structural classification.
- In parallel, a later Standard-engine work order should add direct Treasury/yield-curve factors so the core engine is no longer blind to front-end/back-end rate moves.
