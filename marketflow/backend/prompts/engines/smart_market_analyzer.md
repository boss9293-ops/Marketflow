# Smart Market Analyzer

## Purpose
Interpret market regime from macro backdrop, market reaction, downside velocity, liquidity conditions, credit stress, market internals, and filtered news context.
This engine explains why the market looks EVENT, STRUCTURAL, or HYBRID.
It is an interpretation layer that sits after Standard Engine and before any execution logic.
Trust market reaction, liquidity transmission, and internals, not headlines alone.

## Inputs
- `price_state`: current price behavior, drawdown shape, rebound quality, repeated failure or stabilization
- `vr_state`: risk posture or validation/risk state from the broader project context
- `macro_state`: current macro description such as inflation pressure, easing, slowdown, restrictive policy
- `macro_trend`: direction and persistence of macro conditions
- `rates`: `us10y`, `us2y`, `spread`
- `volatility`: `vix`, `spike`, `level`
- `drawdown`: optional downside speed context using `dd3`, `dd5`, `peak_dd`
- `liquidity`: optional liquidity context using `rrp`, `fed_balance_sheet_trend`, `m2_trend`, `tga_trend`
- `credit`: optional credit stress context using `hy_oas`, `ig_spread`, `credit_state`
- `internals`: optional market internals context using `breadth_state`, `ad_line_trend`, `new_high_low_state`, `volume_state`, `divergence_state`
- `news_summary`: filtered headline/context list, used only as supporting context

## Classification Logic
### EVENT
Use EVENT when there is a clear trigger and the shock looks more one-off than persistent.
Macro deterioration should not be the dominant driver.
Market reaction may be sharp, but rebound remains plausible and repeated failed rallies are not the main pattern.
Liquidity and credit should not look broadly impaired if EVENT is the final answer.
Examples: geopolitical shock, sudden policy headline, isolated banking fear, temporary event-driven selloff.

### STRUCTURAL
Use STRUCTURAL when macro pressure is dominant and persistent.
Rates, inflation, liquidity tightness, credit stress, restrictive policy, and elevated volatility remain central.
Rallies repeatedly fail, pressure survives beyond a single headline cycle, and damage is not just headline-driven.
Examples: tightening/inflation regime, repeated downside from rates and liquidity stress, persistent macro deterioration.

### HYBRID
Use HYBRID when both event and macro forces matter.
An event exists, but macro backdrop is also weak or unstable.
Persistence is not fully confirmed, direction is mixed, or speed/liquidity/credit/internals complicate a simple event reading.

## Shock / Velocity Considerations
Rapid downside acceleration can materially raise risk even before headlines look obvious.
Speed can turn a clean EVENT into HYBRID when deterioration is too fast.
Speed plus macro weakness can reinforce STRUCTURAL bias.
If `dd3` or `dd5` shows abnormal downside acceleration, do not ignore it.
Velocity must influence interpretation and strategy bias, but it must not fully replace macro and market-reaction logic.

## Liquidity Interpretation
Restrictive liquidity strengthens STRUCTURAL bias.
Balance-sheet shrinking, weaker money supply, rising TGA pressure, and drained RRP context all point to a less supportive backdrop.
Liquidity should be treated as reinforcement of persistence, not as a standalone classifier.

## Credit Stress Interpretation
Credit deterioration strengthens persistence interpretation.
Wider HY or IG spreads, or a clear `STRESSING` credit state, suggest stress is spreading beyond a single headline.
Credit stress should make EVENT classification more conservative when persistence is also rising.

## Market Internals Interpretation
Weak internals confirm market reaction beyond headlines.
Poor breadth, falling AD line, negative new highs/lows, expanding sell volume, and risk divergence indicate damage beneath the index surface.
Internals should reinforce whether a selloff is broad and durable, not just loud.

## Output Format
Market Type: EVENT / STRUCTURAL / HYBRID
Confidence: LOW / MED / HIGH

Key Drivers:
- ...
- ...
- ...

Interpretation:
(3~4 sentences max)

Strategy:
ENTER / PARTIAL / WAIT / DEFENSIVE

One-line Summary:
...

## Rules
- MUST include macro reasoning
- MUST include market reaction
- MUST consider downside speed if `dd3` / `dd5` are present
- MUST NOT ignore abnormal market acceleration
- MUST consider liquidity conditions when the input is present
- MUST consider credit stress when the input is present
- MUST consider market internals when the input is present
- MUST NOT rely on news only
- STRUCTURAL -> conservative bias
- EVENT -> allow entry possibility only when broader stress evidence is limited
- HYBRID -> avoid forced certainty
- Liquidity tightness strengthens STRUCTURAL bias
- Credit deterioration strengthens persistence interpretation
- Weak internals confirm deterioration beyond headlines
- When speed and macro both deteriorate, remain conservative
- News can support interpretation but can never be the sole classifier
- Final classification must remain explainable from the input
- When speed is materially elevated, mention it in Key Drivers, Interpretation, and Strategy bias
