from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "vr_backtest" / "results" / "false_bottom_guard_phase1"


def load_json(name: str):
    return json.loads((OUTPUT_DIR / name).read_text(encoding="utf-8"))


def load_frame(name: str) -> pd.DataFrame:
    return pd.read_csv(OUTPUT_DIR / name)


def ensure_output_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def chart_pool_balance(comparisons: list[dict]) -> None:
    episodes = comparisons
    fig, axes = plt.subplots(len(episodes), 1, figsize=(12, 2.8 * len(episodes)), sharex=False)
    if len(episodes) == 1:
        axes = [axes]

    for ax, episode in zip(axes, episodes):
        baseline = pd.DataFrame(episode["baseline"]["pool_series"])
        guard_on = pd.DataFrame(episode["guard_on"]["pool_series"])
        ax.plot(baseline["date"], baseline["pool_cash"], label="Baseline", color="#7f8c8d", linewidth=1.6)
        ax.plot(guard_on["date"], guard_on["pool_cash"], label="Guard-On", color="#1f77b4", linewidth=1.8)
        ax.set_title(episode["event_label"], loc="left", fontsize=10, fontweight="bold")
        ax.set_ylabel("Pool")
        ax.grid(alpha=0.25, linewidth=0.5)
        ax.tick_params(axis="x", labelrotation=45, labelsize=7)
        ax.tick_params(axis="y", labelsize=8)

    axes[0].legend(loc="upper right", fontsize=8)
    fig.suptitle("Episode Pool Balance Comparison", fontsize=13, fontweight="bold", y=0.995)
    fig.tight_layout()
    fig.savefig(OUTPUT_DIR / "chart_pool_balance_comparison.png", dpi=180, bbox_inches="tight")
    plt.close(fig)


def chart_buy_execution_difference(trade_behavior: pd.DataFrame) -> None:
    episodes = trade_behavior["event_label"].tolist()
    x = range(len(episodes))
    width = 0.18

    fig, ax = plt.subplots(figsize=(12, 5.5))
    ax.bar([i - 1.5 * width for i in x], trade_behavior["baseline_executed_vmin_buys"], width=width, label="Baseline Executed", color="#95a5a6")
    ax.bar([i - 0.5 * width for i in x], trade_behavior["guard_on_executed_vmin_buys"], width=width, label="Guard Executed", color="#2ecc71")
    ax.bar([i + 0.5 * width for i in x], trade_behavior["guard_on_delayed_buys_count"], width=width, label="Guard Delayed", color="#f1c40f")
    ax.bar([i + 1.5 * width for i in x], trade_behavior["guard_on_blocked_buys_count"], width=width, label="Guard Blocked", color="#e67e22")

    ax.set_xticks(list(x))
    ax.set_xticklabels(episodes, rotation=20, ha="right")
    ax.set_ylabel("Count")
    ax.set_title("Episode Buy Execution Difference", loc="left", fontsize=13, fontweight="bold")
    ax.grid(axis="y", alpha=0.25, linewidth=0.5)
    ax.legend(fontsize=8, ncols=2)
    fig.tight_layout()
    fig.savefig(OUTPUT_DIR / "chart_buy_execution_difference.png", dpi=180, bbox_inches="tight")
    plt.close(fig)


def chart_recovery_path(comparisons: list[dict]) -> None:
    episodes = comparisons
    fig, axes = plt.subplots(len(episodes), 1, figsize=(12, 2.8 * len(episodes)), sharex=False)
    if len(episodes) == 1:
        axes = [axes]

    for ax, episode in zip(axes, episodes):
        baseline = pd.DataFrame(episode["baseline"]["portfolio_series"])
        guard_on = pd.DataFrame(episode["guard_on"]["portfolio_series"])
        baseline["normalized"] = baseline["portfolio_value"] / baseline["portfolio_value"].iloc[0] * 100
        guard_on["normalized"] = guard_on["portfolio_value"] / guard_on["portfolio_value"].iloc[0] * 100
        ax.plot(baseline["date"], baseline["normalized"], label="Baseline", color="#7f8c8d", linewidth=1.6)
        ax.plot(guard_on["date"], guard_on["normalized"], label="Guard-On", color="#8e44ad", linewidth=1.8)
        ax.set_title(episode["event_label"], loc="left", fontsize=10, fontweight="bold")
        ax.set_ylabel("Start=100")
        ax.grid(alpha=0.25, linewidth=0.5)
        ax.tick_params(axis="x", labelrotation=45, labelsize=7)
        ax.tick_params(axis="y", labelsize=8)

    axes[0].legend(loc="upper right", fontsize=8)
    fig.suptitle("Episode Recovery Path Comparison", fontsize=13, fontweight="bold", y=0.995)
    fig.tight_layout()
    fig.savefig(OUTPUT_DIR / "chart_recovery_path_comparison.png", dpi=180, bbox_inches="tight")
    plt.close(fig)


def chart_guard_miss_cost(events: list[dict]) -> None:
    frame = pd.DataFrame(events)
    if frame.empty:
      fig, ax = plt.subplots(figsize=(10, 4))
      ax.text(0.5, 0.5, "No delayed or blocked guard events found.", ha="center", va="center")
      ax.axis("off")
      fig.savefig(OUTPUT_DIR / "chart_guard_miss_cost_scatter.png", dpi=180, bbox_inches="tight")
      plt.close(fig)
      return

    palette = {"delayed": "#f1c40f", "blocked": "#e67e22"}
    markers = {"forward_return_5d_pct": "o", "forward_return_10d_pct": "s", "forward_return_20d_pct": "^"}

    frame["x"] = frame["event_label"] + " | " + frame["kind"]
    order = list(dict.fromkeys(frame["x"].tolist()))
    xmap = {label: idx for idx, label in enumerate(order)}

    fig, ax = plt.subplots(figsize=(13, 6))
    for horizon, marker in markers.items():
        subset = frame[["x", "kind", horizon]].dropna()
        ax.scatter(
            subset["x"].map(xmap),
            subset[horizon],
            c=subset["kind"].map(palette),
            marker=marker,
            s=55,
            alpha=0.8,
            label=horizon.replace("forward_return_", "").replace("_pct", ""),
        )

    ax.axhline(0, color="#555", linewidth=0.8, alpha=0.7)
    ax.set_xticks(list(xmap.values()))
    ax.set_xticklabels(order, rotation=35, ha="right")
    ax.set_ylabel("Forward return %")
    ax.set_title("Guard Miss Cost Scatter (Delayed / Blocked Buys)", loc="left", fontsize=13, fontweight="bold")
    ax.grid(axis="y", alpha=0.25, linewidth=0.5)
    handles, labels = ax.get_legend_handles_labels()
    seen = set()
    deduped = [(h, l) for h, l in zip(handles, labels) if not (l in seen or seen.add(l))]
    ax.legend([h for h, _ in deduped], [l for _, l in deduped], fontsize=8, title="Horizon")
    fig.tight_layout()
    fig.savefig(OUTPUT_DIR / "chart_guard_miss_cost_scatter.png", dpi=180, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    ensure_output_dir()
    comparisons = load_json("episode_comparison_full.json")
    trade_behavior = load_frame("trade_behavior_summary.csv")
    guard_events = load_json("guard_signal_events.json")

    chart_pool_balance(comparisons)
    chart_buy_execution_difference(trade_behavior)
    chart_recovery_path(comparisons)
    chart_guard_miss_cost(guard_events)

    print(f"[false-bottom-guard] charts written to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
