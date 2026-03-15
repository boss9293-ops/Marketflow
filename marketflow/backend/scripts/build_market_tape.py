"""
build_market_tape.py  v1.0
Generates backend/output/cache/market_tape.json.
Schema:
  { data_date, generated_at,
    items: [{symbol, name, last, chg, chg_pct, spark_1d}, ...] }
Sources:
  - market_data.json  -> current price, chg_pct (fresh from yfinance)
  - ohlcv_daily table -> last 12 daily closes for sparkline
  - VIX from market_data.json[volatility] (no DB history)
"""
from __future__ import annotations
import json, os, sqlite3, sys
from datetime import datetime

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


def _find_root() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in [os.path.join(here, "..", ".."), os.path.join(here, "..")]:
        cand = os.path.realpath(cand)
        if os.path.exists(os.path.join(cand, "data", "marketflow.db")):
            return cand
    _dev = r"d:\Youtube_pro\000-Code_develop"
    try:
        for _item in os.listdir(_dev):
            _full = os.path.join(_dev, _item, "us_market_complete", "marketflow")
            if os.path.exists(os.path.join(_full, "data", "marketflow.db")):
                return _full
    except Exception:
        pass
    raise RuntimeError("Cannot locate project root")


ROOT = _find_root()
OUTPUT_DIR = os.path.join(ROOT, "backend", "output")
CACHE_DIR = os.path.join(OUTPUT_DIR, "cache")
DB_PATH = os.path.join(ROOT, "data", "marketflow.db")

TAPE_SYMBOLS = [
    ("SPY", "S&P 500",      "indices"),
    ("QQQ", "Nasdaq 100",   "indices"),
    ("DIA", "Dow Jones",    "indices"),
    ("IWM", "Russell 2000", "indices"),
    ("VIX", "Volatility",   "volatility"),
]

# Macro symbols — no DB sparkline history, sourced entirely from market_data.json
# (frontend_symbol, default_name, section_key, data_key)
MACRO_SYMBOLS = [
    ("US10Y",  "US 10Y",       "bonds",       "^TNX"),
    ("US5Y",   "US 5Y",        "bonds",       "^FVX"),
    ("DXY",    "Dollar Index",  "currencies",  "DX-Y.NYB"),
    ("BTCUSD", "Bitcoin",       "commodities", "BTC-USD"),
    ("GOLD",   "Gold",          "commodities", "GC=F"),
]

SPARK_N = 12


def load_market_data() -> dict:
    p = os.path.join(OUTPUT_DIR, "market_data.json")
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def fetch_spark(conn: sqlite3.Connection, symbol: str) -> list:
    try:
        cur = conn.execute(
            "SELECT close FROM ohlcv_daily WHERE symbol=? ORDER BY date DESC LIMIT ?",
            (symbol, SPARK_N),
        )
        rows = cur.fetchall()
        return [round(float(r[0]), 4) for r in reversed(rows)]
    except Exception:
        return []


def main() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    md = load_market_data()
    indices = md.get("indices", {})
    volatility = md.get("volatility", {})
    data_date = None

    conn = sqlite3.connect(DB_PATH)
    items = []

    for symbol, default_name, section in TAPE_SYMBOLS:
        if section == "volatility":
            raw = volatility.get("^VIX", volatility.get("VIX", {}))
        else:
            raw = indices.get(symbol, {})

        last = raw.get("price")
        chg_pct = raw.get("change_pct")
        name = raw.get("name") or default_name

        # Fallback: if price is None, use most recent close from ohlcv_daily DB
        if last is None and symbol != "VIX":
            try:
                cur_fb = conn.execute(
                    "SELECT close, date FROM ohlcv_daily WHERE symbol=? ORDER BY date DESC LIMIT 2",
                    (symbol,),
                )
                fb_rows = cur_fb.fetchall()
                if fb_rows:
                    last = round(float(fb_rows[0][0]), 4)
                    # Compute chg_pct from prev close
                    if len(fb_rows) >= 2 and fb_rows[1][0] is not None:
                        prev_close = float(fb_rows[1][0])
                        if prev_close > 0:
                            chg_pct = round((float(last) / prev_close - 1.0) * 100.0, 4)
            except Exception:
                pass

        # Compute absolute change
        chg = None
        if last is not None and chg_pct is not None:
            try:
                denom = 1.0 + float(chg_pct) / 100.0
                if abs(denom) > 1e-9:
                    prev = float(last) / denom
                    chg = round(float(last) - prev, 4)
            except (TypeError, ZeroDivisionError):
                pass

        # VIX fallback from market_daily if market_data is null
        if last is None and symbol == "VIX":
            try:
                cur_vix = conn.execute(
                    "SELECT vix FROM market_daily WHERE vix IS NOT NULL ORDER BY date DESC LIMIT 2"
                )
                vix_rows = cur_vix.fetchall()
                if vix_rows:
                    last = round(float(vix_rows[0][0]), 2)
                    if len(vix_rows) >= 2 and vix_rows[1][0] is not None:
                        prev_vix = float(vix_rows[1][0])
                        if prev_vix > 0:
                            chg_pct = round((float(last) / prev_vix - 1.0) * 100.0, 4)
            except Exception:
                pass

        # Sparkline from DB (ETFs only)
        if symbol != "VIX":
            spark = fetch_spark(conn, symbol)
            # Append live price if it differs from last DB close
            if spark and last is not None and abs(float(last) - spark[-1]) > 0.001:
                spark.append(round(float(last), 4))
                spark = spark[-SPARK_N:]
        else:
            spark = []

        # Set data_date from DB
        if not data_date and symbol != "VIX":
            try:
                cur2 = conn.execute(
                    "SELECT MAX(date) FROM ohlcv_daily WHERE symbol=?", (symbol,)
                )
                row = cur2.fetchone()
                if row and row[0]:
                    data_date = row[0]
            except Exception:
                pass

        items.append({
            "symbol": symbol,
            "name": name,
            "last": round(float(last), 4) if last is not None else None,
            "chg": round(chg, 4) if chg is not None else None,
            "chg_pct": round(float(chg_pct), 4) if chg_pct is not None else None,
            "spark_1d": spark,
        })

    conn.close()

    # --- Macro symbols (no DB sparkline) ---
    bonds      = md.get("bonds", {})
    currencies = md.get("currencies", {})
    commodities = md.get("commodities", {})
    _macro_sections = {"bonds": bonds, "currencies": currencies, "commodities": commodities}

    for m_sym, m_name, m_section, m_key in MACRO_SYMBOLS:
        raw = _macro_sections.get(m_section, {}).get(m_key, {})
        m_last   = raw.get("price")
        m_chg_pct = raw.get("change_pct")
        m_disp_name = raw.get("name") or m_name
        m_chg = None
        if m_last is not None and m_chg_pct is not None:
            try:
                _d = 1.0 + float(m_chg_pct) / 100.0
                if abs(_d) > 1e-9:
                    m_chg = round(float(m_last) - float(m_last) / _d, 4)
            except Exception:
                pass
        if m_last is None:
            continue  # skip missing macro data silently
        items.append({
            "symbol":   m_sym,
            "name":     m_disp_name,
            "last":     round(float(m_last), 4),
            "chg":      round(m_chg, 4) if m_chg is not None else None,
            "chg_pct":  round(float(m_chg_pct), 4) if m_chg_pct is not None else None,
            "spark_1d": [],
        })

    if not data_date:
        data_date = datetime.now().strftime("%Y-%m-%d")

    output = {
        "generated_at": datetime.now().isoformat(),
        "data_date": data_date,
        "items": items,
    }

    out_path = os.path.join(CACHE_DIR, "market_tape.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    symbols_ok = [it["symbol"] for it in items if it["last"] is not None]
    print(
        f"OK  market_tape.json | {len(symbols_ok)} symbols: {' '.join(symbols_ok)}"
        f" | data_date={data_date}"
    )


if __name__ == "__main__":
    main()
