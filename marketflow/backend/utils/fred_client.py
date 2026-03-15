import os
import requests
import pandas as pd
from typing import Optional, Dict, Any
from dotenv import load_dotenv

load_dotenv()

class FREDClient:
    BASE_URL = "https://api.stlouisfed.org/fred/"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("FRED_API_KEY")
        if not self.api_key:
            raise ValueError("FRED_API_KEY not found in environment or provided.")

    def get_series(self, series_id: str, start_date: str, end_date: str) -> pd.DataFrame:
        """
        Fetches historical data for a given series_id.
        Returns a DataFrame with 'date' and 'value'.
        """
        params = {
            "series_id": series_id,
            "api_key": self.api_key,
            "file_type": "json",
            "observation_start": start_date,
            "observation_end": end_date,
        }
        resp = requests.get(f"{self.BASE_URL}series/observations", params=params)
        resp.raise_for_status()
        data = resp.json()

        observations = data.get("observations", [])
        df = pd.DataFrame(observations)
        if df.empty:
            return pd.DataFrame(columns=["date", "value"])

        df["date"] = pd.to_datetime(df["date"])
        df["value"] = pd.to_numeric(df["value"], errors="coerce")
        return df[["date", "value"]].sort_values("date")

    def get_multiple_series(self, series_ids: Dict[str, str], start_date: str, end_date: str) -> pd.DataFrame:
        """
        series_ids: {InternalName: FredID} e.g. {"WALCL": "WALCL"}
        Returns a merged daily DataFrame.
        """
        all_dfs = []
        for name, sid in series_ids.items():
            df = self.get_series(sid, start_date, end_date)
            df = df.rename(columns={"value": name})
            df = df.set_index("date")
            all_dfs.append(df)

        if not all_dfs:
            return pd.DataFrame()

        # Merge all on date
        merged = pd.concat(all_dfs, axis=1)
        return merged
