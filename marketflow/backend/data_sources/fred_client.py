from __future__ import annotations

from typing import Dict

import pandas as pd

try:
    from backend.utils.fred_client import FREDClient as _BaseFREDClient
except ModuleNotFoundError:
    from utils.fred_client import FREDClient as _BaseFREDClient


class FREDClient(_BaseFREDClient):
    """
    V2 datasource wrapper.
    Keeps compatibility with existing backend.utils.fred_client while exposing
    dataframe-first helpers used by macro snapshot jobs.
    """

    def series_df(self, series_id: str, start_date: str, end_date: str) -> pd.DataFrame:
        df = self.get_series(series_id, start_date, end_date)
        if df.empty:
            return pd.DataFrame(columns=[series_id]).set_index(pd.DatetimeIndex([]))
        out = df.rename(columns={"value": series_id}).set_index("date")
        return out.sort_index()

    def many_df(self, series_map: Dict[str, str], start_date: str, end_date: str) -> pd.DataFrame:
        return self.get_multiple_series(series_map, start_date, end_date).sort_index()
