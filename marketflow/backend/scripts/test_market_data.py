import json
import os
import yfinance as yf
from datetime import datetime
from pathlib import Path
import tempfile


# yfinance가 기본 캐시 경로에서 SQLite 파일을 못 열 때가 있어,
# 쓰기 가능한 temp 폴더로 캐시 위치를 고정한다.
YF_CACHE_DIR = Path(tempfile.gettempdir()) / "marketflow_yfinance_cache"
YF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
yf.set_tz_cache_location(str(YF_CACHE_DIR))


def get_pct_change(ticker):
    try:
        data = yf.Ticker(ticker).history(period="2d")
        if len(data) < 2:
            return None

        prev = data["Close"].iloc[-2]
        curr = data["Close"].iloc[-1]

        return round((curr / prev - 1) * 100, 2)

    except Exception as e:
        print(f"Error fetching {ticker}: {e}")
        return None


def get_last_price(ticker):
    try:
        data = yf.Ticker(ticker).history(period="1d")
        if len(data) == 0:
            return None
        return round(data["Close"].iloc[-1], 2)

    except Exception as e:
        print(f"Error fetching {ticker}: {e}")
        return None


def save_result(result):
    out_dir = "marketflow/backend/output/market_data_test"
    os.makedirs(out_dir, exist_ok=True)

    date_str = result["date"]
    out_path = os.path.join(out_dir, f"market_data_{date_str}.json")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\nSaved: {out_path}")


def run_test():
    result = {
        "date": datetime.utcnow().strftime("%Y-%m-%d"),
        "sp500_pct": get_pct_change("SPY"),
        "nasdaq_pct": get_pct_change("QQQ"),
        "xlk_pct": get_pct_change("XLK"),
        "nvda_pct": get_pct_change("NVDA"),
        "us10y": get_last_price("^TNX"),
        "oil": get_last_price("CL=F"),
    }

    print("\n=== Market Data Test ===")
    for k, v in result.items():
        print(f"{k}: {v}")

    # 간단 검증
    success_count = sum(1 for v in result.values() if v is not None)
    print(f"\nSuccess: {success_count}/7 fields")

    save_result(result)

    return result


if __name__ == "__main__":
    run_test()
