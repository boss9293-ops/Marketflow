#!/usr/bin/env python3
"""
Upload selected NASDAQ-100, S&P500 Top200, Dow30, and major ETFs from Spooq ZIP
to marketflow.db OHLCV table
"""

import sqlite3
import zipfile
import os
from pathlib import Path
from datetime import datetime
from collections import defaultdict

from db_utils import canonical_symbol, core_db_path
from symbol_registry import standard_universe_symbols

# ============================================================================
# STANDARD SYMBOL LISTS
# ============================================================================

NASDAQ_100 = [
    'AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'GOOG', 'META', 'AMZN', 'NFLX', 'QCOM',
    'ASML', 'AVGO', 'CMCSA', 'CSCO', 'COST', 'CRWD', 'DXCM', 'FANG', 'FAST', 'ILMN',
    'INTC', 'INTU', 'ISRG', 'JD', 'KDP', 'LRCX', 'LULU', 'MCHP', 'MDLZ', 'MELI',
    'MRNA', 'MRVL', 'MSCI', 'MSTR', 'MTCH', 'NFLX', 'NXPI', 'ODFL', 'OKTA', 'ORLY',
    'PANW', 'PAYX', 'PCAR', 'PSTG', 'PYPL', 'QCOM', 'REGN', 'ROST', 'SGEN', 'SIRI',
    'SKYW', 'SNPS', 'SPLK', 'STLD', 'TEAM', 'TCOM', 'TECH', 'TMDX', 'TRIP', 'TSLA',
    'TTD', 'TTWO', 'TWLO', 'TWST', 'TXNM', 'UBER', 'ULTI', 'VEEV', 'VRSN', 'VRSK',
    'VRTX', 'WDAY', 'WERN', 'WFM', 'WKME', 'XMTR', 'YELP', 'ZETA', 'ZMBK', 'ZM',
    'ZS', 'ZSCL', 'ADBE', 'AMAT', 'AMD', 'ANET', 'ANSS', 'ARM', 'BCPC', 'CPRT',
    'CTSH', 'DASH', 'DDOG', 'DOCN', 'EBAY', 'ENPH', 'FLEX', 'FTNT', 'GDDY', 'GLPI'
]

# S&P500 Top 200 (시가총액 기준 상위 200)
SP500_TOP200 = [
    # Top 50
    'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'JNJ',
    'JPM', 'V', 'WMT', 'INTC', 'NFLX', 'AVGO', 'CMCSA', 'XOM', 'QCOM', 'HON',
    'CSCO', 'ASML', 'LLY', 'CRM', 'ACN', 'COST', 'AMD', 'KO', 'MCD', 'ABT',
    'BAC', 'GE', 'AXP', 'DIS', 'DHR', 'CVX', 'PEP', 'MRK', 'PG', 'ADBE',
    'ORCL', 'NOW', 'CAT', 'BA', 'UPS', 'TXN', 'INTU', 'AMAT', 'ISRG', 'MMM',

    # 51-100
    'IBM', 'CB', 'LOW', 'REGN', 'MA', 'BLK', 'VRTX', 'KLAC', 'IRM', 'GE',
    'SNPS', 'ELV', 'ROST', 'SPG', 'MDLZ', 'SLB', 'SPLK', 'TSM', 'CRWD', 'PAYX',
    'MU', 'WBA', 'PCAR', 'FAST', 'WFC', 'ILMN', 'AZO', 'LRCX', 'SIRI', 'MCO',
    'TEAM', 'MSTR', 'ORLY', 'ULTI', 'TJX', 'TTM', 'AFL', 'CTSH', 'SBUX', 'PPG',
    'MSCI', 'GS', 'TECH', 'GILD', 'LULU', 'CPRT', 'FANG', 'EBAY', 'NXPI', 'ADSK',

    # 101-150
    'OKTA', 'KKR', 'ZTS', 'MELI', 'VRSN', 'DASH', 'ENPH', 'ZM', 'PSTG', 'FTNT',
    'MNST', 'CME', 'CSGP', 'SGEN', 'VRSK', 'MCHP', 'RMD', 'MAR', 'ODFL', 'CDNS',
    'LULU', 'SSRM', 'TWLO', 'MTCH', 'RBLX', 'VEEV', 'SLAB', 'DDOG', 'TPL', 'SPLK',
    'FICO', 'FANG', 'ANSS', 'PAYC', 'GDDY', 'IDXX', 'XMTR', 'JKHY', 'WFM', 'ZTS',
    'YELP', 'HUBS', 'APA', 'MRO', 'LYG', 'CC', 'PFE', 'MRVL', 'ANET', 'CYBR',

    # 151-200
    'ACGL', 'MTD', 'SQ', 'CCI', 'CTRA', 'CMS', 'DPZ', 'PLUG', 'DXCM', 'ZMBK',
    'TYL', 'COIN', 'NTAP', 'PTC', 'ROP', 'WDAY', 'ROKU', 'CHWY', 'DE', 'EWBC',
    'BLDR', 'FOXA', 'FSLR', 'ECOL', 'NDAQ', 'ALGN', 'APH', 'ROG', 'VRX', 'PLAN',
    'QRVO', 'LITE', 'FLR', 'TPR', 'CMS', 'KNSL', 'OMC', 'EQIX', 'IPG', 'QVAL',
    'DLTR', 'CPRI', 'NKE', 'DKNG', 'PZZA', 'NKTR', 'ZEN', 'ATUS', 'TENB', 'PTON'
]

# DOW JONES 30
DOW_30 = [
    'AAPL', 'AXP', 'BA', 'CAT', 'CRM', 'CSCO', 'CVX', 'DHR', 'DIS', 'GE',
    'GS', 'HD', 'HON', 'IBM', 'INTC', 'JNJ', 'JPM', 'KO', 'LLY', 'MCD',
    'MMM', 'MRK', 'MSFT', 'NKE', 'PG', 'TRV', 'UNH', 'V', 'VZ', 'WMT'
]

# MAJOR ETFs
MAJOR_ETFS = [
    # Broad Market
    'SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO', 'VEA', 'VXUS', 'SCHB', 'SCHC',

    # Large-cap Value/Growth
    'VUG', 'VTV', 'VLV', 'VB', 'VO', 'VBK', 'VBR',

    # Factor/Quality
    'VYM', 'VYMI', 'VLUE', 'VOOV', 'VOOV', 'QQQE', 'QQQM',

    # Sector
    'VGT', 'VFV', 'VHV', 'VPU', 'VDC', 'VHC', 'VIS', 'VAW', 'VNQ', 'VCIT',

    # International
    'VXUS', 'VEA', 'VWO', 'IEFA', 'IEMG', 'EWJ', 'EWG', 'EWU', 'EWL', 'EWH',

    # Fixed Income
    'BND', 'AGG', 'BSV', 'VGIT', 'VGLT', 'VCIT', 'VCLT', 'ANGL', 'HYG', 'LQD',

    # Leveraged/Inverse
    'SPXL', 'TQQQ', 'SQQQ', 'SPXS', 'SOXL', 'SOXS', 'TECL', 'TECS', 'UDOW', 'SDOW',

    # Other Popular
    'SCHX', 'SCHA', 'SCHD', 'SCHY', 'ITOT', 'ITAP', 'IUSV', 'IUSG', 'IJR', 'IJK',
    'VTSAX', 'MGK', 'VTSEX', 'OIL', 'USO', 'GLD', 'SLV', 'DBC', 'DBB'
]

# Canonical DB symbols. The .us suffix is only used for file/feed lookup.
TARGET_SYMBOLS = sorted({canonical_symbol(s) for s in standard_universe_symbols()})

print(f"Total unique symbols: {len(TARGET_SYMBOLS)}")

# ============================================================================
# FUNCTIONS
# ============================================================================

def parse_spooq_line(line):
    """Parse Spooq format: <TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>"""
    parts = line.strip().split(',')
    if len(parts) < 9:
        return None

    try:
        symbol = canonical_symbol(parts[0])
        # per = parts[1]  # D for daily
        date = parts[2]  # YYYYMMDD
        # time = parts[3]
        open_price = float(parts[4])
        high = float(parts[5])
        low = float(parts[6])
        close = float(parts[7])
        volume = int(float(parts[8]))  # May be in scientific notation

        # Convert YYYYMMDD to YYYY-MM-DD
        date_formatted = f"{date[:4]}-{date[4:6]}-{date[6:8]}"

        return {
            'symbol': symbol,
            'date': date_formatted,
            'open': open_price,
            'high': high,
            'low': low,
            'close': close,
            'adj_close': close,  # Adjusted close = close for now
            'volume': volume,
            'source': 'spooq',
            'updated_at': datetime.now().isoformat()
        }
    except (ValueError, IndexError) as e:
        return None


def extract_and_insert(zip_path, db_path, symbols_to_load):
    """Extract from ZIP and insert into DB"""

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    conn.execute("PRAGMA foreign_keys = ON")

    # Create table if not exists (should exist)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_daily (
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            adj_close REAL,
            volume INTEGER,
            source TEXT,
            updated_at TEXT,
            PRIMARY KEY (symbol, date),
            FOREIGN KEY (symbol) REFERENCES universe_symbols(symbol)
        )
    """)

    # Pre-seed the universe table so the FK on ohlcv_daily stays valid.
    now = datetime.now().isoformat()
    canonical_targets = sorted({canonical_symbol(s) for s in symbols_to_load})
    for symbol in canonical_targets:
        cursor.execute("""
            INSERT OR IGNORE INTO universe_symbols
            (symbol, name, sector, industry, exchange, market_cap, is_active, is_top100, last_updated)
            VALUES (?, ?, NULL, NULL, NULL, NULL, 1, 0, ?)
        """, (symbol, symbol, now))

    # Symbol lookup for fast searching
    symbols_lower = {canonical_symbol(s).lower() for s in symbols_to_load}

    # Stats
    stats = defaultdict(lambda: {'count': 0, 'errors': 0, 'inserted': 0})
    total_inserted = 0

    print(f"\nReading from {zip_path}")
    print(f"Looking for {len(symbols_lower)} symbols\n")

    # Extract from ZIP
    with zipfile.ZipFile(zip_path, 'r') as zf:
        file_list = [f for f in zf.namelist() if f.endswith('.txt')]
        print(f"Total files in ZIP: {len(file_list)}")

        matched_files = 0

        for file_idx, zfile in enumerate(file_list, 1):
            # Extract ticker from path: data/daily/us/nasdaq etfs/aapl.us.txt
            ticker = canonical_symbol(zfile.split('/')[-1].replace('.txt', '')).lower()

            if ticker not in symbols_lower:
                continue

            matched_files += 1
            if matched_files % 50 == 0:
                print(f"  Processing file {matched_files}...")

            try:
                with zf.open(zfile) as f:
                    for line in f:
                        line = line.decode('utf-8', errors='ignore').strip()
                        if not line or line.startswith('<'):  # Skip header
                            continue

                        data = parse_spooq_line(line)
                        if not data:
                            stats[ticker]['errors'] += 1
                            continue

                        # Insert or replace
                        try:
                            cursor.execute("""
                                INSERT OR REPLACE INTO ohlcv_daily
                                (symbol, date, open, high, low, close, adj_close, volume, source, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, (
                                data['symbol'],
                                data['date'],
                                data['open'],
                                data['high'],
                                data['low'],
                                data['close'],
                                data['adj_close'],
                                data['volume'],
                                data['source'],
                                data['updated_at']
                            ))
                            stats[ticker]['inserted'] += 1
                            total_inserted += 1
                        except sqlite3.Error as e:
                            stats[ticker]['errors'] += 1

                        stats[ticker]['count'] += 1

            except Exception as e:
                print(f"  ERROR reading {zfile}: {e}")

        # Commit all inserts
        conn.commit()

        # Summary
        print(f"\n{'='*80}")
        print(f"[SUMMARY]")
        print(f"{'='*80}")
        print(f"Matched files: {matched_files}")
        print(f"Total rows inserted: {total_inserted}")

        symbols_with_data = [s for s in stats if stats[s]['inserted'] > 0]
        print(f"Symbols with data: {len(symbols_with_data)}")

        if len(symbols_with_data) > 0:
            print(f"\nTop 10 symbols by record count:")
            top_symbols = sorted(symbols_with_data, key=lambda s: stats[s]['inserted'], reverse=True)[:10]
            for sym in top_symbols:
                print(f"  {sym.upper():15} | {stats[sym]['inserted']:6,} records")

    conn.close()
    print(f"\nDatabase update complete: {db_path}")


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    # Paths
    dirname = b'\xec\xa3\xbc\xec\x8b\x9d\xeb\xb6\x84\xec\x84\x9d'.decode('utf-8')

    # Use direct absolute paths (avoid relative path issues)
    zip_path = f'd:/Youtube_pro/000-Code_develop/{dirname}/us_stock_db/d_us_txt.zip'
    db_path = core_db_path()

    print(f"ZIP file: {zip_path}")
    print(f"DB file: {db_path}")

    if not os.path.exists(zip_path):
        print(f"ERROR: ZIP not found: {zip_path}")
        exit(1)

    if not os.path.exists(db_path):
        print(f"ERROR: DB not found: {db_path}")
        exit(1)

    print(f"\n[UPLOAD CONFIGURATION]")
    print(f"  NASDAQ-100: {len(NASDAQ_100)} symbols")
    print(f"  S&P500 Top200: {len(SP500_TOP200)} symbols")
    print(f"  Dow Jones 30: {len(DOW_30)} symbols")
    print(f"  Major ETFs: {len(MAJOR_ETFS)} symbols")
    print(f"  TOTAL (unique): {len(TARGET_SYMBOLS)} symbols")

    # Extract and insert
    extract_and_insert(zip_path, db_path, TARGET_SYMBOLS)
