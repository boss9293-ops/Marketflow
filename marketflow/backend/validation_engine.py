import os
import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from pathlib import Path

try:
    from backend.utils.fred_client import FREDClient
    import backend.utils.macro_calc as mc
except ModuleNotFoundError:
    # Support running from `backend/` cwd via `python app.py`.
    from utils.fred_client import FREDClient
    import utils.macro_calc as mc

# Absolute paths for imports to work if run as script or from app
# validation_engine.py lives inside backend/ both locally and on server (/app/)
BACKEND_DIR = Path(__file__).resolve().parent
CONFIG_DIR = BACKEND_DIR / "config"
DB_PATH = BACKEND_DIR.parent / "data" / "marketflow.db"

class ValidationEngine:
    WINDOWS = {
        "2020": ("2020-01-01", "2020-06-30"),
        "2022": ("2022-01-01", "2022-12-31"),
        "2024": ("2024-01-01", "2024-12-31"),
        "2025": ("2025-01-01", "2025-12-31"),
        "2026": ("2026-01-01", None),   # end_date=None → resolved to today at runtime
        "2024_2025": ("2024-01-01", "2025-12-31"),
        "baseline": ("2017-01-01", "2019-12-31"),
        "crisis_2020": ("2020-01-01", "2020-06-30"),
        "crisis_2022": ("2022-01-01", "2022-12-31"),
    }

    def __init__(self, policy_path: Optional[Path] = None):
        self.policy = self._load_policy(policy_path)
        self.fred = FREDClient()

    @staticmethod
    def _json_safe_value(v: Any) -> Any:
        if isinstance(v, (np.floating, float)):
            fv = float(v)
            if np.isnan(fv) or np.isinf(fv):
                return None
            return fv
        if isinstance(v, (np.integer, int)):
            return int(v)
        if isinstance(v, dict):
            return {k: ValidationEngine._json_safe_value(val) for k, val in v.items()}
        if isinstance(v, list):
            return [ValidationEngine._json_safe_value(x) for x in v]
        return v

    def _load_policy(self, path: Optional[Path]) -> Dict[str, Any]:
        p = path or (CONFIG_DIR / "macro_policy_v1.json")
        # Fallback: try path relative to THIS file if CONFIG_DIR resolves incorrectly
        if not p.exists():
            alt = Path(__file__).resolve().parent / "config" / "macro_policy_v1.json"
            if alt.exists():
                p = alt
        with p.open("r", encoding="utf-8") as f:
            return json.load(f)

    def _load_market_proxy_from_db(self, ticker: str, start_date: str, end_date: str) -> Optional[pd.Series]:
        """
        Load market proxy price from local SQLite DB.

        Priority (highest wins on overlapping dates):
          1. ticker_history_daily — long history from CSV import (e.g. QQQ from 1999-03-10)
          2. ohlcv_daily          — maintained daily by update_ohlcv.py (DB-first accumulation)
          3. market_daily         — most recent, highest quality for QQQ/SPY (2021-02-16~)

        All sources are merged so later sources override earlier ones on overlapping dates.
        Returns a pd.Series indexed by date, or None if no data found.
        """
        if not DB_PATH.exists():
            return None
        col = ticker.lower()
        try:
            con = sqlite3.connect(str(DB_PATH))

            # --- Source 1: ticker_history_daily (long history) ---
            df_hist = pd.read_sql_query(
                "SELECT date, close FROM ticker_history_daily "
                "WHERE symbol = ? AND close IS NOT NULL AND date >= ? AND date <= ? "
                "ORDER BY date ASC",
                con, params=(ticker.upper(), start_date, end_date),
            )

            # --- Source 2: ohlcv_daily (DB-maintained, most up-to-date) ---
            df_ohlcv = pd.read_sql_query(
                "SELECT date, close FROM ohlcv_daily "
                "WHERE symbol = ? AND close IS NOT NULL AND date >= ? AND date <= ? "
                "ORDER BY date ASC",
                con, params=(ticker.upper(), start_date, end_date),
            )

            # --- Source 3: market_daily (recent, highest quality for QQQ/SPY) ---
            df_md = pd.DataFrame()
            if col in ("qqq", "spy"):
                df_md = pd.read_sql_query(
                    f"SELECT date, {col} AS close FROM market_daily "
                    f"WHERE {col} IS NOT NULL AND date >= ? AND date <= ? "
                    f"ORDER BY date ASC",
                    con, params=(start_date, end_date),
                )

            con.close()

            def _to_series(df: pd.DataFrame) -> Optional[pd.Series]:
                if df.empty:
                    return None
                df["date"] = pd.to_datetime(df["date"])
                return df.set_index("date")["close"]

            s1 = _to_series(df_hist)
            s2 = _to_series(df_ohlcv)
            s3 = _to_series(df_md)

            # Layer merge: start with base, apply each higher-priority source
            combined: Optional[pd.Series] = None
            for s in (s1, s2, s3):
                if s is None:
                    continue
                if combined is None:
                    combined = s.copy()
                else:
                    extra = s[~s.index.isin(combined.index)]
                    combined = pd.concat([combined, extra]).sort_index()
                    combined.update(s)

            return combined.rename(ticker) if combined is not None else None

        except Exception:
            return None

    def _fetch_data_bundle(self, start_date: str, end_date: str, market_proxy: str = "QQQ") -> Dict[str, Any]:
        """
        Fetches all necessary data for the validation range.
        Includes a 5Y lookback buffer for accurate percentile calculation.

        Market proxy strategy (DB-first):
          1. Load QQQ from local DB (ticker_history_daily + ohlcv_daily + market_daily).
          2. FRED SP500 is used ONLY for dates before the DB series starts (e.g. pre-1999
             if QQQ CSV import didn't cover that far). Scaled to match QQQ at first overlap.
          3. Recent gaps use the DB series directly — never SP500 for modern dates.
        """
        s_dt = pd.to_datetime(start_date)

        # 5.5 years lookback to be safe (1260 trading days is ~5 years)
        fetch_start = (s_dt - timedelta(days=365 * 6)).strftime("%Y-%m-%d")
        fetch_end = end_date

        # All FRED macro series (avoids Yahoo Finance rate limits)
        fred_map = {
            "WALCL": "WALCL",
            "RRP": "RRPONTSYD",
            "EFFR": "EFFR",
            "VIX": "VIXCLS",   # CBOE VIX Close (same as ^VIX)
            "SP500": "SP500",  # S&P 500 used only for pre-DB-start dates
        }
        df_fred = self.fred.get_multiple_series(fred_map, fetch_start, fetch_end)

        # --- Build market proxy column (DB-first: QQQ from local DB) ---
        db_series = self._load_market_proxy_from_db(market_proxy, fetch_start, fetch_end)

        sp500_series = df_fred["SP500"].dropna() if "SP500" in df_fred.columns else None

        if db_series is not None and not db_series.empty:
            # DB-first: use QQQ directly from DB.
            # Prepend scaled SP500 ONLY for dates before DB coverage starts.
            if sp500_series is not None and not sp500_series.empty:
                overlap = db_series.index.intersection(sp500_series.index)
                if len(overlap) > 0:
                    scale = (
                        float(db_series.loc[overlap[0]]) / float(sp500_series.loc[overlap[0]])
                        if float(sp500_series.loc[overlap[0]]) != 0 else 1.0
                    )
                    sp500_scaled = sp500_series * scale
                    # Only pre-pend SP500 for dates strictly before DB data begins
                    pre_db = sp500_scaled[sp500_scaled.index < db_series.index[0]]
                    if not pre_db.empty:
                        market_series = pd.concat([pre_db, db_series]).rename(market_proxy)
                    else:
                        market_series = db_series.rename(market_proxy)
                else:
                    market_series = db_series.rename(market_proxy)
            else:
                market_series = db_series.rename(market_proxy)
        elif sp500_series is not None and not sp500_series.empty:
            # No DB data at all — fall back to FRED SP500
            market_series = sp500_series.rename(market_proxy)
        else:
            market_series = pd.Series(dtype=float, name=market_proxy)

        # Drop SP500 from fred df and inject the hybrid market proxy instead
        df_combined = df_fred.drop(columns=["SP500"], errors="ignore")
        df_combined = df_combined.join(market_series, how="outer")

        # Always include TQQQ as a secondary price series (for drawdown visualization)
        if market_proxy != "TQQQ":
            tqqq_series = self._load_market_proxy_from_db("TQQQ", fetch_start, fetch_end)
            if tqqq_series is not None and not tqqq_series.empty:
                df_combined = df_combined.join(tqqq_series, how="outer")

        df = df_combined.copy()
        df.index.name = "date"

        # Forward fill weekly WALCL and any gaps
        df = df.sort_index()
        df = df[~df.index.duplicated(keep="last")]
        full_idx = pd.date_range(start=df.index.min(), end=df.index.max(), freq="B")
        df = df.reindex(full_idx)
        df = df.ffill()

        # data_asof: report last valid date for each series
        market_series_nonan = market_series.dropna() if not market_series.empty else market_series
        data_asof = {
            "WALCL": self._last_valid_date_str(df_fred.get("WALCL")),
            "RRP": self._last_valid_date_str(df_fred.get("RRP")),
            "EFFR": self._last_valid_date_str(df_fred.get("EFFR")),
            "VIX": self._last_valid_date_str(df_fred.get("VIX")),
            "MARKET_PROXY": (
                market_series_nonan.index[-1].strftime("%Y-%m-%d")
                if not market_series_nonan.empty else None
            ),
        }
        fred_probe = self._build_fred_probe(df_fred)
        return {
            "df": df,
            "data_asof": data_asof,
            "fred_probe": fred_probe,
            "market_proxy": market_proxy,
        }

    def fetch_data(self, start_date: str, end_date: str) -> pd.DataFrame:
        bundle = self._fetch_data_bundle(start_date, end_date)
        return bundle["df"]

    def _last_valid_date_str(self, series: Optional[pd.Series]) -> Optional[str]:
        if series is None:
            return None
        non_null = series.dropna()
        if non_null.empty:
            return None
        return pd.to_datetime(non_null.index[-1]).strftime("%Y-%m-%d")

    def _build_fred_probe(self, df_fred: pd.DataFrame) -> Dict[str, Dict[str, float]]:
        probe: Dict[str, Dict[str, float]] = {}
        for col in ["WALCL", "RRP", "EFFR"]:
            if col not in df_fred.columns:
                probe[col] = {}
                continue
            ser = df_fred[col].dropna()
            probe[col] = {
                pd.to_datetime(idx).strftime("%Y-%m-%d"): float(val)
                for idx, val in ser.items()
            }
        return probe

    def compute_macro_series(self, df: pd.DataFrame, start_date: str, market_proxy: str = "QQQ") -> pd.DataFrame:
        """
        Computes LPI, RPI, VRI, MPS series for the dataframe.
        Only returns the section from start_date onwards.
        """
        # Feature Transformations
        # Note: We apply transforms on the full series including lookback
        
        # VRI components
        vix_level = df["VIX"]
        vix_5d_chg = mc.pct_change(df["VIX"].tolist(), 5)
        
        # RPI components
        effr_level = df["EFFR"]
        effr_1m_chg = mc.bp_change(df["EFFR"].tolist(), 21)
        
        # LPI components
        walcl_8w_chg = mc.pct_change(df["WALCL"].tolist(), 40) # 8 weeks ~ 40 trading days
        rrp_20d_chg = mc.pct_change(df["RRP"].tolist(), 20)
        
        # Feature Percentiles (Rolling)
        # We need to compute rank percentile for each day
        # Optimized window calculation would be better, but let's use a sliding window for now if feasible
        # Given we have ~2000 days, it's manageable.
        
        # Policy lookbacks
        daily_lb = self.policy["lookback"]["daily_points"] # 1260
        
        def compute_rolling_pct(series, window_size):
            out = []
            vals = series.tolist()
            for i in range(len(vals)):
                if i < 20: # Start buffer
                    out.append(None)
                    continue
                window = [v for v in vals[max(0, i - window_size + 1): i + 1] if v is not None]
                out.append(mc.empirical_rank_percentile(window, vals[i]))
            return out

        # Apply Winsorize first if policy says so
        wz_cfg = self.policy.get("winsorize", {"low_pct": 1, "high_pct": 99})
        def apply_wz_and_pct(data, direction=1):
            data_adj = [v * direction if v is not None else None for v in data]
            # Winsorize on the whole history or rolling? Production usually does it on the available series.
            # Here we follow production logic as much as possible.
            data_wz = mc.winsorize(data_adj, wz_cfg["low_pct"], wz_cfg["high_pct"])
            return compute_rolling_pct(pd.Series(data_wz), daily_lb)

        # VRI features
        vri_f1 = apply_wz_and_pct(vix_level, 1)
        vri_f2 = apply_wz_and_pct(vix_5d_chg, 1)
        # RPI features
        rpi_f1 = apply_wz_and_pct(effr_level, 1)
        rpi_f2 = apply_wz_and_pct(effr_1m_chg, 1)
        # LPI features
        lpi_f1 = apply_wz_and_pct(walcl_8w_chg, -1)
        lpi_f2 = apply_wz_and_pct(rrp_20d_chg, -1)
        
        # Compute Indexes
        vri = [mc.calculate_weighted_score([(v1, 0.6), (v2, 0.4)]) for v1, v2 in zip(vri_f1, vri_f2)]
        rpi = [mc.calculate_weighted_score([(v1, 0.6), (v2, 0.4)]) for v1, v2 in zip(rpi_f1, rpi_f2)]
        lpi = [mc.calculate_weighted_score([(v1, 0.55), (v2, 0.45)]) for v1, v2 in zip(lpi_f1, lpi_f2)]
        
        # Compute MPS
        mps_parts = []
        for v, r, l in zip(vri, rpi, lpi):
            mps_parts.append(mc.calculate_weighted_score([(l, 0.4), (r, 0.3), (v, 0.3)]))
            
        # Drawdown calculation (market proxy — QQQ)
        if market_proxy not in df.columns:
            raise KeyError(f"Missing market proxy column: {market_proxy}")
        df["peak"] = df[market_proxy].rolling(window=252, min_periods=1).max()
        df["drawdown"] = (df[market_proxy] / df["peak"]) - 1.0

        # TQQQ drawdown (secondary visualization, 3x leveraged)
        if "TQQQ" in df.columns:
            df["tqqq_peak"] = df["TQQQ"].rolling(window=252, min_periods=1).max()
            df["tqqq_drawdown"] = (df["TQQQ"] / df["tqqq_peak"]) - 1.0

        # YTD returns (calendar year baseline) for display
        def _calc_ytd(series: pd.Series) -> pd.Series:
            if series is None or series.empty:
                return series
            ytd = series.copy()
            for year, idxs in series.groupby(series.index.year).groups.items():
                base = series.loc[idxs].iloc[0]
                if pd.isna(base) or base == 0:
                    ytd.loc[idxs] = np.nan
                else:
                    ytd.loc[idxs] = series.loc[idxs] / base - 1.0
            return ytd

        df["ytd_return"] = _calc_ytd(df[market_proxy])
        if "TQQQ" in df.columns:
            df["tqqq_ytd_return"] = _calc_ytd(df["TQQQ"])

        res = df.copy()
        res["VRI"] = vri
        res["RPI"] = rpi
        res["LPI"] = lpi
        res["MPS"] = mps_parts

        # Filter to requested window
        res = res[res.index >= pd.to_datetime(start_date)]

        # Calibrate drawdown to window-start = 0%
        # The 252-day rolling peak includes pre-window history, so the first day of a window
        # can already show a non-zero drawdown (e.g. 2026 starts -3.4% from 2025 ATH).
        # Subtracting the first-day offset makes each window read as
        # "how much has the market moved since the start of this period."
        if not res.empty:
            dd0 = float(res["drawdown"].iloc[0]) if pd.notna(res["drawdown"].iloc[0]) else 0.0
            res["drawdown"] = res["drawdown"] - dd0
            if "tqqq_drawdown" in res.columns:
                tqqq_dd0 = float(res["tqqq_drawdown"].iloc[0]) if pd.notna(res["tqqq_drawdown"].iloc[0]) else 0.0
                res["tqqq_drawdown"] = res["tqqq_drawdown"] - tqqq_dd0

        return res

    def detect_events(self, df: pd.DataFrame) -> Dict[str, List[Dict[str, Any]]]:
        """
        Detects MacroPressure, VIX Stress, and Drawdown events.
        """
        def get_runs(series, threshold, op="ge"):
            runs = []
            active_run = None
            for dt, val in series.items():
                is_active = False
                if val is not None:
                    if op == "ge": is_active = val >= threshold
                    else: is_active = val <= threshold
                
                if is_active:
                    if active_run is None:
                        active_run = {"start_date": dt.strftime("%Y-%m-%d"), "peak": val, "sum": val, "count": 1}
                    else:
                        active_run["peak"] = max(active_run["peak"], val) if op == "ge" else min(active_run["peak"], val)
                        active_run["sum"] += val
                        active_run["count"] += 1
                else:
                    if active_run:
                        active_run["end_date"] = dt.strftime("%Y-%m-%d")
                        active_run["avg"] = active_run["sum"] / active_run["count"]
                        runs.append(active_run)
                        active_run = None
            if active_run:
                active_run["end_date"] = series.index[-1].strftime("%Y-%m-%d")
                active_run["avg"] = active_run["sum"] / active_run["count"]
                runs.append(active_run)
            return runs

        macro_events = get_runs(df["MPS"], 70)
        vix_events = get_runs(df["VIX"], 25)
        dd_events = get_runs(df["drawdown"], -0.10, "le")
        
        return {
            "macro_events": macro_events,
            "vix_events": vix_events,
            "dd_events": dd_events
        }

    def compute_metrics(self, df: pd.DataFrame, events: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
        """
        Calculates Lead Time, False Alarm Rate, Coverage, and Stability.
        """
        # Lead Time to VIX >= 25
        lead_times_vix = []
        for ve in events["vix_events"]:
            v_start = pd.to_datetime(ve["start_date"])
            # Find closest prior Macro event
            prior_m = [me for me in events["macro_events"] if pd.to_datetime(me["start_date"]) <= v_start]
            if prior_m:
                closest_m = max(prior_m, key=lambda x: pd.to_datetime(x["start_date"]))
                m_start = pd.to_datetime(closest_m["start_date"])
                # business days
                days = len(pd.date_range(m_start, v_start, freq="B")) - 1
                lead_times_vix.append(days)
            else:
                lead_times_vix.append(None)
                
        # Lead Time to DD <= -10%
        lead_times_dd = []
        for de in events["dd_events"]:
            d_start = pd.to_datetime(de["start_date"])
            prior_m = [me for me in events["macro_events"] if pd.to_datetime(me["start_date"]) <= d_start]
            if prior_m:
                closest_m = max(prior_m, key=lambda x: pd.to_datetime(x["start_date"]))
                m_start = pd.to_datetime(closest_m["start_date"])
                days = len(pd.date_range(m_start, d_start, freq="B")) - 1
                lead_times_dd.append(days)
            else:
                lead_times_dd.append(None)

        # False Alarm Rate
        # Macro event with no stress event within 20 trading days
        false_alarms = 0
        stress_starts = [pd.to_datetime(e["start_date"]) for e in events["vix_events"] + events["dd_events"]]
        for me in events["macro_events"]:
            m_start = pd.to_datetime(me["start_date"])
            m_plus_20 = m_start + pd.offsets.BusinessDay(20)
            hit = any(m_start <= s <= m_plus_20 for s in stress_starts)
            if not hit:
                false_alarms += 1
        
        fa_rate = false_alarms / len(events["macro_events"]) if events["macro_events"] else 0

        # Coverage (overall + per stress type)
        vix_mask = (df["VIX"] >= 25)
        dd_mask = (df["drawdown"] <= -0.10)
        stress_mask = vix_mask | dd_mask
        stress_days = int(stress_mask.sum())
        covered_days = int((stress_mask & (df["MPS"] >= 70)).sum())
        coverage = covered_days / stress_days if stress_days > 0 else 0
        vix_days = int(vix_mask.sum())
        dd_days = int(dd_mask.sum())
        coverage_vix25 = int((vix_mask & (df["MPS"] >= 70)).sum()) / vix_days if vix_days > 0 else 0
        coverage_dd10 = int((dd_mask & (df["MPS"] >= 70)).sum()) / dd_days if dd_days > 0 else 0

        # Stability
        # MPS daily change 절대값의 95퍼센타일
        mps_diff = df["MPS"].diff().abs().dropna()
        stability_95 = np.percentile(mps_diff, 95) if not mps_diff.empty else 0

        # Confidence proxy: component availability ratio per day (0~100)
        comp_avail = df[["LPI", "RPI", "VRI"]].notna().sum(axis=1) / 3.0
        avg_mps_conf = float(comp_avail.mean() * 100.0) if not comp_avail.empty else 0.0

        valid_lead_times_vix = [l for l in lead_times_vix if l is not None]
        valid_lead_times_dd = [l for l in lead_times_dd if l is not None]

        return {
            "avg_lead_time_vix": float(np.mean(valid_lead_times_vix)) if valid_lead_times_vix else None,
            "avg_lead_time_dd": float(np.mean(valid_lead_times_dd)) if valid_lead_times_dd else None,
            "false_alarm_rate": fa_rate,
            "coverage": coverage,
            "coverage_vix25": coverage_vix25,
            "coverage_dd10": coverage_dd10,
            "stability_95": float(stability_95) if stability_95 is not None else None,
            "stability_mps_abschg95": float(stability_95) if stability_95 is not None else None,
            "avg_mps_conf": avg_mps_conf,
            "counts": {
                "macro": len(events["macro_events"]),
                "vix": len(events["vix_events"]),
                "dd": len(events["dd_events"]),
                "false_alarms": false_alarms
            }
        }

    def run_validation_window(
        self,
        window_key: str,
        start_date: str,
        end_date: str,
        market_proxy: str = "QQQ",
        include_timeseries: bool = True,
    ) -> Dict[str, Any]:
        bundle = self._fetch_data_bundle(start_date, end_date, market_proxy=market_proxy)
        df_raw = bundle["df"]
        df_computed = self.compute_macro_series(df_raw, start_date, market_proxy=market_proxy)
        events = self.detect_events(df_computed)
        metrics = self.compute_metrics(df_computed, events)

        timeseries = None
        if include_timeseries:
            has_tqqq = "tqqq_drawdown" in df_computed.columns
            timeseries = {
                "date": [d.strftime("%Y-%m-%d") for d in df_computed.index],
                "MPS": df_computed["MPS"].tolist(),
                "LPI": df_computed["LPI"].tolist(),
                "RPI": df_computed["RPI"].tolist(),
                "VRI": df_computed["VRI"].tolist(),
                "VIX": df_computed["VIX"].tolist(),
                market_proxy: df_computed[market_proxy].tolist(),
                "QQQ": df_computed[market_proxy].tolist() if market_proxy == "QQQ" else None,
                "drawdown": df_computed["drawdown"].tolist(),
                "tqqq_drawdown": df_computed["tqqq_drawdown"].tolist() if has_tqqq else None,
                "ytd_return": df_computed["ytd_return"].tolist() if "ytd_return" in df_computed.columns else None,
                "tqqq_ytd_return": df_computed["tqqq_ytd_return"].tolist() if "tqqq_ytd_return" in df_computed.columns else None,
                "is_mps_ge_70": (df_computed["MPS"] >= 70).tolist(),
                "is_vix_ge_25": (df_computed["VIX"] >= 25).tolist(),
                "is_dd_le_neg10": (df_computed["drawdown"] <= -0.10).tolist(),
                "is_tqqq_dd_le_neg30": (df_computed["tqqq_drawdown"] <= -0.30).tolist() if has_tqqq else None,
            }

        out = {
            "policy_version": self.policy.get("version", "v1"),
            "window": window_key,
            "start_date": start_date,
            "end_date": end_date,
            "market_proxy": market_proxy,
            "data_asof": bundle["data_asof"],
            "fred_probe": bundle["fred_probe"],
            "metrics": metrics,
            "events": events,
        }
        if timeseries is not None:
            out["timeseries"] = timeseries
        return self._json_safe_value(out)

    def run_validation(self, range_key: str) -> Dict[str, Any]:
        """
        Main entry point for a validation run.
        range_key: "2020", "2022", "2024", "2025", "2026", "2024_2025", or "baseline"
        """
        if range_key not in self.WINDOWS:
            raise ValueError(f"Invalid window key: {range_key}")
        start_date, end_date = self.WINDOWS[range_key]
        # "2026" window: end_date=None means live (today)
        if end_date is None:
            end_date = datetime.today().strftime("%Y-%m-%d")
        return self.run_validation_window(range_key, start_date, end_date, market_proxy="QQQ", include_timeseries=True)

if __name__ == "__main__":
    # Quick CLI test
    engine = ValidationEngine()
    # Use baseline or a small window for testing
    res = engine.run_validation("2020")
    print(f"Validation for {res['window']} complete.")
    print(f"Metrics: {res['metrics']}")
