"""
engine/monte_carlo/report_export.py
=====================================
Research report exporter for the VR Leveraged ETF Survival Lab.

Runs the full suite (regime MC + strategy comparison) and writes a
Markdown research report to docs/LEVERAGE_SURVIVAL_LAB_REPORT_V1.md.

Primary entry point
-------------------
generate_report(n_paths, years, output_path) -> str

CLI usage
---------
python -m engine.monte_carlo.report_export
python -m engine.monte_carlo.report_export 1000 5 docs/my_report.md
"""
from __future__ import annotations

import os
import time
import datetime
from typing import Optional

import numpy as np

from .runner             import run_monte_carlo, MonteCarloResult, format_result
from .comparison_runner  import compare_strategies, ComparisonResult, format_comparison
from .regime_engine      import DEFAULT_REGIME_CONFIGS, Regime
from .benchmarks         import DEFAULT_STRATEGIES


# ---------------------------------------------------------------------------
# Markdown helpers
# ---------------------------------------------------------------------------

def _h1(text: str) -> str: return f"# {text}\n"
def _h2(text: str) -> str: return f"## {text}\n"
def _h3(text: str) -> str: return f"### {text}\n"
def _p(text: str) -> str:  return f"{text}\n"
def _code(text: str, lang: str = "") -> str:
    return f"```{lang}\n{text}\n```\n"
def _table_row(cells: list[str]) -> str:
    return "| " + " | ".join(cells) + " |"
def _table_sep(n: int) -> str:
    return "| " + " | ".join(["---"] * n) + " |"

def _pct(v: float, decimals: int = 1) -> str:
    if v != v:
        return "n/a"
    return f"{v*100:.{decimals}f}%"

def _f(v: float, decimals: int = 3) -> str:
    if v != v:
        return "n/a"
    return f"{v:.{decimals}f}"

def _fpct(v: float, decimals: int = 1) -> str:
    """Format as signed percentage (+12.3%)."""
    if v != v:
        return "n/a"
    return f"{v*100:+.{decimals}f}%"


# ---------------------------------------------------------------------------
# Report sections
# ---------------------------------------------------------------------------

def _section_overview(mc: MonteCarloResult) -> str:
    lines = [
        _h2("1. Executive Summary"),
        _p(
            "This report summarises a Monte Carlo analysis of the **VR Leveraged ETF "
            "Survival Strategy** applied to a simulated 3x-leveraged ETF (TQQQ-class). "
            f"The simulation ran **{mc.n_paths:,} independent paths** over a "
            f"**{mc.years:.0f}-year horizon** using a Markov regime chain "
            "(NORMAL / CORRECTION / CRISIS) with GARCH(1,1) + Student-t innovations "
            "and Poisson-sampled crash events per regime segment."
        ),
        _p(
            "Paths ending mid-crash (drawdown < -10% or recent crash event) "
            f"received a 252-day NORMAL-regime recovery tail to remove endpoint bias "
            f"({_pct(mc.tail_extension_rate)} of paths extended)."
        ),
        _p("**Key findings:**"),
        _p(f"- Survival rate: {_pct(mc.survival_rate)}"),
        _p(f"- Pool exhaustion rate: {_pct(mc.pool_exhaustion_rate)}"),
        _p(f"- Bottom-capture rate: {_pct(mc.bottom_capture_rate)}"),
        _p(f"- Median terminal NAV: {_f(mc.terminal_nav_median)} (base 1.0)"),
        _p(f"- Median max drawdown: {_pct(mc.max_dd_median)}"),
        _p(f"- Censored path rate: {_pct(mc.censored_path_rate)} "
           f"(recovery window too short at horizon)"),
        "",
    ]
    return "\n".join(lines)


def _section_regime_model() -> str:
    cfgs = DEFAULT_REGIME_CONFIGS
    rows = [
        _table_row(["Regime", "Drift/yr", "Vol/yr", "Crashes/yr", "Vol mult", "Crash types"]),
        _table_sep(6),
    ]
    for regime, cfg in cfgs.items():
        rows.append(_table_row([
            regime.value,
            _pct(cfg.drift_annual),
            _pct(cfg.vol_annual),
            f"{cfg.crash_prob_annual:.1f}",
            f"{cfg.volume_multiplier:.1f}x",
            ", ".join(cfg.allowed_crash_types),
        ]))

    lines = [
        _h2("2. Simulation Model"),
        _h3("2.1 Market Regime Engine"),
        _p(
            "Market regimes evolve via a daily Markov chain with three states. "
            "Each day's drift, volatility, and crash probability are drawn from "
            "the active regime's parameters."
        ),
        "\n".join(rows),
        "",
        _h3("2.2 Transition Matrix (default)"),
        _code(
            "         NORMAL  CORRECTION  CRISIS\n"
            "NORMAL     0.90        0.09    0.01\n"
            "CORRECTION 0.40        0.50    0.10\n"
            "CRISIS     0.30        0.40    0.30",
            "text",
        ),
        _h3("2.3 Return Process"),
        _p(
            "Each regime segment uses GARCH(1,1) with Student-t(nu=8) innovations. "
            "omega is set so that the unconditional volatility equals the regime "
            "base_vol: `omega = (1 - alpha - beta) * vol_daily^2`. "
            "CORRECTION and CRISIS regimes produce meaningfully higher realised "
            "volatility than NORMAL."
        ),
        _h3("2.4 Crash Injection"),
        _p(
            "For each regime segment a Poisson draw determines crash count. "
            "Crash type (FAST_PANIC, SLOW_BEAR, FLASH_CRASH, DOUBLE_DIP), depth, "
            "and duration are sampled from regime-specific distributions. "
            "NORMAL segments produce only shallow FLASH_CRASH events; "
            "CRISIS segments use full depth across all crash types."
        ),
        _h3("2.5 Recovery Tail Extension"),
        _p(
            "When a path ends with drawdown < -10% OR a crash event within the "
            "final 252 trading days, a 252-day NORMAL-regime extension is appended. "
            "The tail uses: no crash injection, NORMAL drift (+0.40/yr), "
            "NORMAL volatility (+0.60/yr). This removes endpoint bias from "
            "recovery metrics."
        ),
        "",
    ]
    return "\n".join(lines)


def _section_strategy() -> str:
    lines = [
        _h2("3. VR Survival Strategy"),
        _h3("3.1 State Machine"),
        _p("The strategy runs a 6-state machine on each daily observation:"),
        _code(
            "S0_NORMAL      -- hold, harvest time-value to pool\n"
            "S1_CRASH_ALERT -- crash signal detected (Speed4 <= -10%, DD <= -15%)\n"
            "S2_CRASH_HOLD  -- in crash, waiting for bottom confirmation\n"
            "S3_BOTTOM_ZONE -- bottom signal (DD <= -20%, Volume >= 2x AvgVol20)\n"
            "S4_RECOVERY    -- ladder buys executed; riding recovery\n"
            "S5_REBUILD     -- price above pre-crash level; rebuilding pool",
            "text",
        ),
        _h3("3.2 Pool Management"),
        _p(
            "- 10% of NAV held as initial crash pool reserve  \n"
            "- Pool capped at 50% of NAV  \n"
            "- Harvest rate: 0.1% of NAV per day in S0_NORMAL  \n"
            "- Pool deployed via ladder at S3_BOTTOM_ZONE"
        ),
        _h3("3.3 Ladder Configuration"),
        _p(
            "Ladder buys trigger at drawdown levels: -20%, -25%, -30%, -35%, -40%  \n"
            "Each level deploys 20% of available crash pool."
        ),
        "",
    ]
    return "\n".join(lines)


def _section_mc_results(mc: MonteCarloResult) -> str:
    r = mc
    lines = [
        _h2("4. Monte Carlo Results"),
        _h3("4.1 Regime Distribution"),
        _table_row(["Regime", "Mean fraction of days"]),
        _table_sep(2),
        _table_row(["NORMAL",     _pct(r.mean_frac_normal)]),
        _table_row(["CORRECTION", _pct(r.mean_frac_correction)]),
        _table_row(["CRISIS",     _pct(r.mean_frac_crisis)]),
        "",
        _h3("4.2 Survival Metrics"),
        _table_row(["Metric", "Value"]),
        _table_sep(2),
        _table_row(["Survival rate",        _pct(r.survival_rate)]),
        _table_row(["Pool exhaustion rate",  _pct(r.pool_exhaustion_rate)]),
        _table_row(["Bottom capture rate",   _pct(r.bottom_capture_rate)]),
        _table_row(["Tail extension rate",   _pct(r.tail_extension_rate)]),
        "",
        _h3("4.3 Terminal NAV Distribution (base 1.0)"),
        _table_row(["Statistic", "Value"]),
        _table_sep(2),
        _table_row(["Mean",   _f(r.terminal_nav_mean)]),
        _table_row(["Median", _f(r.terminal_nav_median)]),
        _table_row(["p10",    _f(r.terminal_nav_p10)]),
        _table_row(["p25",    _f(r.terminal_nav_p25)]),
        _table_row(["p75",    _f(r.terminal_nav_p75)]),
        _table_row(["p90",    _f(r.terminal_nav_p90)]),
        "",
        _h3("4.4 Max Drawdown (NAV)"),
        _table_row(["Statistic", "Value"]),
        _table_sep(2),
        _table_row(["Mean",               _pct(r.max_dd_mean)]),
        _table_row(["Median",             _pct(r.max_dd_median)]),
        _table_row(["Worst decile (p10)", _pct(r.max_dd_p10)]),
        "",
        _h3("4.5 NAV Recovery (back to starting value)"),
        _table_row(["Metric", "Value"]),
        _table_sep(2),
        _table_row(["Recovery rate",      _pct(r.recovery_rate)]),
        _table_row(["Mean recovery days", _f(r.recovery_days_mean, 1)
                    if r.recovery_days_mean == r.recovery_days_mean else "n/a"]),
        "",
        _h3("4.6 Crash and Ladder Activity"),
        _table_row(["Metric", "Value"]),
        _table_sep(2),
        _table_row(["Mean crash events / path", _f(r.mean_crash_events, 2)]),
        _table_row(["Mean ladder steps / path",  _f(r.mean_ladder_steps, 2)]),
        "",
    ]
    return "\n".join(lines)


def _section_recovery(mc: MonteCarloResult) -> str:
    """Three sub-sections: Recovery Metrics, Post-Crash Performance, Censored Paths."""
    r = mc
    lines = [
        _h2("5. Recovery Analysis"),

        # --- 5.1 Recovery Metrics ---
        _h3("5.1 Recovery Metrics"),
        _p(
            "Recovery metrics are measured from the path's NAV bottom (minimum NAV day). "
            "Medians are reported over paths where the metric was reached within the "
            "observation window (original path + any 252-day tail extension)."
        ),
        _table_row(["Metric", "Median", "Reach rate"]),
        _table_sep(3),
        _table_row([
            "recovery_6m_return (+126d from bottom)",
            _fpct(r.recovery_6m_return_median),
            "all paths with 126d+ after bottom",
        ]),
        _table_row([
            "recovery_12m_return (+252d from bottom)",
            _fpct(r.recovery_12m_return_median),
            "all paths with 252d+ after bottom",
        ]),
        _table_row([
            "days_to_recover_50pct (NAV +50% from bottom)",
            f"{_f(r.days_to_recover_50pct_median, 0)} days" if r.days_to_recover_50pct_median == r.days_to_recover_50pct_median else "n/a",
            _pct(r.recovery_50pct_rate),
        ]),
        _table_row([
            "days_to_recover_peak (NAV new all-time high)",
            f"{_f(r.days_to_recover_peak_median, 0)} days" if r.days_to_recover_peak_median == r.days_to_recover_peak_median else "n/a",
            _pct(r.recovery_peak_rate),
        ]),
        "",

        # --- 5.2 Post-Crash Performance ---
        _h3("5.2 Post-Crash Performance"),
        _p(
            "Recovery metrics quantify how quickly and how strongly the leveraged "
            "ETF (and the VR strategy NAV) rebounds after reaching its worst point. "
            "A positive `recovery_6m_return` means the strategy NAV was above the "
            "bottom level 6 months later; a negative value means it continued "
            "deteriorating (or path ended before 6 months elapsed after the bottom)."
        ),
        _p(
            f"**Tail extension impact**: {_pct(r.tail_extension_rate)} of paths received "
            "a 252-day recovery observation window beyond the original horizon. "
            "Without tail extension, recovery metrics for those paths would have been "
            "unmeasurable (right-censored), creating a bias toward underestimating "
            "recovery speed."
        ),
        "",

        # --- 5.3 Censored Path Analysis ---
        _h3("5.3 Censored Path Analysis"),
        _p(
            "A path is classified as **right-censored** if the drawdown at the end "
            "of the *original* horizon (before any tail extension) was below -20%. "
            "This means the crash recovery had not completed by the observation window, "
            "and the recovery metrics for that path are based on the tail extension "
            "period only."
        ),
        _table_row(["Metric", "Value"]),
        _table_sep(2),
        _table_row(["Censored path rate",
                    _pct(r.censored_path_rate)]),
        _table_row(["Meaning",
                    "crash recovery incomplete at original horizon"]),
        _table_row(["Tail extension applied",
                    _pct(r.tail_extension_rate)]),
        "",
        _p(
            f"> **Interpretation**: {_pct(r.censored_path_rate)} of the {r.n_paths:,} paths "
            "ended their original horizon while still in a significant drawdown (>20%). "
            "For these paths, any reported recovery metrics are measured within the "
            "tail extension window and should be interpreted as partial recovery "
            "observations rather than complete recovery episodes."
        ),
        "",
    ]
    return "\n".join(lines)


def _section_comparison(cmp: ComparisonResult) -> str:
    stats  = cmp.stats
    labels = [s.name for s in stats]

    def metrics_table(rows_spec):
        header = _table_row(["Metric"] + labels)
        sep    = _table_sep(1 + len(labels))
        rows   = [header, sep]
        for (label, getter) in rows_spec:
            cells = [label] + [getter(s) for s in stats]
            rows.append(_table_row(cells))
        return "\n".join(rows)

    lines = [
        _h2("6. Strategy Comparison"),
        _p(
            f"All four strategies were tested on the same **{cmp.n_paths:,} paths** "
            f"over **{cmp.years:.0f} years**."
        ),
        metrics_table([
            ("Survival rate",         lambda s: _pct(s.survival_rate)),
            ("Terminal NAV (median)", lambda s: _f(s.terminal_nav_median)),
            ("Terminal NAV (mean)",   lambda s: _f(s.terminal_nav_mean)),
            ("Terminal NAV p10",      lambda s: _f(s.terminal_nav_p10)),
            ("Terminal NAV p90",      lambda s: _f(s.terminal_nav_p90)),
            ("Max DD (median)",       lambda s: _pct(s.max_dd_median)),
            ("Max DD worst decile",   lambda s: _pct(s.max_dd_p10)),
            ("Recovery rate",         lambda s: _pct(s.recovery_rate)),
            ("Recovery days (mean)",  lambda s: _f(s.recovery_days_mean, 1)
                                        if s.recovery_days_mean == s.recovery_days_mean
                                        else "n/a"),
            ("Mean ladder steps",     lambda s: _f(s.mean_ladder_steps, 2)),
        ]),
        "",
        _h3("6.1 Strategy Descriptions"),
    ]
    for s in stats:
        lines.append(_p(f"**{s.name}**: {s.description}"))
    lines.append("")
    return "\n".join(lines)


def _section_methodology() -> str:
    lines = [
        _h2("7. Methodology Notes"),
        _p(
            "**Path generation**: Each path starts at price=100 on day 0. "
            "GARCH variance resets at each regime transition. "
            "Crash events override returns (not additive) to keep prices positive."
        ),
        _p(
            "**Recovery tail**: A 252-day NORMAL-regime GBM tail (no GARCH, no crashes) "
            "is appended when needed. The tail seed is offset by 9,999,999 from the "
            "main path seed to ensure independence."
        ),
        _p(
            "**Censoring definition**: drawdown < -20% at the original path end "
            "(before tail). Censored paths contribute to all reported metrics but "
            "their recovery metrics are partial observations."
        ),
        _p(
            "**Survival definition**: final NAV > 0 and pool never fully exhausted. "
            "This is a weak definition; a hard NAV floor (e.g. 0.10) is planned."
        ),
        _p(
            "**Benchmark strategies**: DCA and DD_LADDER_ONLY use simplified NAV "
            "accounting. No transaction costs or margin calls are modelled."
        ),
        "",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Full report assembly
# ---------------------------------------------------------------------------

def generate_report(
    n_paths:     int   = 200,
    years:       float = 5.0,
    output_path: Optional[str] = None,
) -> str:
    """
    Run simulations and produce a Markdown research report.

    Parameters
    ----------
    n_paths     : Monte Carlo path count (shared between runner and comparison)
    years       : simulation horizon in years
    output_path : if given, write the report to this path; else return only

    Returns
    -------
    Full Markdown report as a string
    """
    print(f"[report_export] Generating report: {n_paths} paths x {years:.0f}yr")

    # ---- run regime MC (VR strategy only, with recovery tail) ----
    print("[report_export] Phase 1: regime Monte Carlo (recovery-aware) ...")
    mc = run_monte_carlo(n_paths=n_paths, years=years, seed_offset=0,
                         recovery_tail_days=252)

    # ---- run strategy comparison ----
    print("[report_export] Phase 2: strategy comparison ...")
    cmp = compare_strategies(n_paths=n_paths, years=years, seed_offset=0)

    # ---- assemble report ----
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    parts = [
        _h1("VR Leveraged ETF Survival Lab -- Research Report V1"),
        _p(f"*Generated: {now} | Paths: {n_paths:,} | Horizon: {years:.0f}yr*"),
        "",
        _section_overview(mc),
        _section_regime_model(),
        _section_strategy(),
        _section_mc_results(mc),
        _section_recovery(mc),
        _section_comparison(cmp),
        _section_methodology(),
        _h2("8. Raw Output"),
        _h3("8.1 Regime Monte Carlo Summary"),
        _code(format_result(mc), "text"),
        _h3("8.2 Strategy Comparison Table"),
        _code(format_comparison(cmp), "text"),
        _p("---"),
        _p("*VR Leveraged ETF Survival Lab -- MarketFlow Research Framework*"),
    ]

    report = "\n".join(parts)

    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"[report_export] Report written to: {output_path}")

    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    n_paths     = int(sys.argv[1])   if len(sys.argv) > 1 else 200
    years       = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
    output_path = sys.argv[3]        if len(sys.argv) > 3 else None

    if output_path is None:
        here = os.path.dirname(os.path.abspath(__file__))
        docs = os.path.normpath(os.path.join(here, "..", "..", "docs"))
        output_path = os.path.join(docs, "LEVERAGE_SURVIVAL_LAB_REPORT_V1.md")

    report = generate_report(n_paths=n_paths, years=years, output_path=output_path)
    print(f"\nReport length: {len(report):,} chars")
    print("Done.")
