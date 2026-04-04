from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from typing import Iterable, Sequence

from db_utils import canonical_symbol


def _dedupe(symbols: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for symbol in symbols:
        clean = canonical_symbol(symbol)
        if clean in seen:
            continue
        seen.add(clean)
        out.append(clean)
    return out


# -----------------------------------------------------------------------------
# Standard universe lists
# -----------------------------------------------------------------------------

NASDAQ_100_STOCKS = [
    "AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "GOOG", "META", "AMZN", "NFLX", "QCOM",
    "ASML", "AVGO", "CMCSA", "CSCO", "COST", "CRWD", "DXCM", "FANG", "FAST", "ILMN",
    "INTC", "INTU", "ISRG", "JD", "KDP", "LRCX", "LULU", "MCHP", "MDLZ", "MELI",
    "MRNA", "MRVL", "MSCI", "MSTR", "MTCH", "NFLX", "NXPI", "ODFL", "OKTA", "ORLY",
    "PANW", "PAYX", "PCAR", "PSTG", "PYPL", "QCOM", "REGN", "ROST", "SGEN", "SIRI",
    "SKYW", "SNPS", "SPLK", "STLD", "TEAM", "TCOM", "TECH", "TMDX", "TRIP", "TSLA",
    "TTD", "TTWO", "TWLO", "TWST", "TXNM", "UBER", "ULTI", "VEEV", "VRSN", "VRSK",
    "VRTX", "WDAY", "WERN", "WFM", "WKME", "XMTR", "YELP", "ZETA", "ZMBK", "ZM",
    "ZS", "ZSCL", "ADBE", "AMAT", "AMD", "ANET", "ANSS", "ARM", "BCPC", "CPRT",
    "CTSH", "DASH", "DDOG", "DOCN", "EBAY", "ENPH", "FLEX", "FTNT", "GDDY", "GLPI",
]

SP500_TOP200 = [
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "META", "TSLA", "BRK.B", "JNJ",
    "JPM", "V", "WMT", "INTC", "NFLX", "AVGO", "CMCSA", "XOM", "QCOM", "HON",
    "CSCO", "ASML", "LLY", "CRM", "ACN", "COST", "AMD", "KO", "MCD", "ABT",
    "BAC", "GE", "AXP", "DIS", "DHR", "CVX", "PEP", "MRK", "PG", "ADBE",
    "ORCL", "NOW", "CAT", "BA", "UPS", "TXN", "INTU", "AMAT", "ISRG", "MMM",
    "IBM", "CB", "LOW", "REGN", "MA", "BLK", "VRTX", "KLAC", "IRM", "GE",
    "SNPS", "ELV", "ROST", "SPG", "MDLZ", "SLB", "SPLK", "TSM", "CRWD", "PAYX",
    "MU", "WBA", "PCAR", "FAST", "WFC", "ILMN", "AZO", "LRCX", "SIRI", "MCO",
    "TEAM", "MSTR", "ORLY", "ULTI", "TJX", "TTM", "AFL", "CTSH", "SBUX", "PPG",
    "MSCI", "GS", "TECH", "GILD", "LULU", "CPRT", "FANG", "EBAY", "NXPI", "ADSK",
    "OKTA", "KKR", "ZTS", "MELI", "VRSN", "DASH", "ENPH", "ZM", "PSTG", "FTNT",
    "MNST", "CME", "CSGP", "SGEN", "VRSK", "MCHP", "RMD", "MAR", "ODFL", "CDNS",
    "LULU", "SSRM", "TWLO", "MTCH", "RBLX", "VEEV", "SLAB", "DDOG", "TPL", "SPLK",
    "FICO", "FANG", "ANSS", "PAYC", "GDDY", "IDXX", "XMTR", "JKHY", "WFM", "ZTS",
    "YELP", "HUBS", "APA", "MRO", "LYG", "CC", "PFE", "MRVL", "ANET", "CYBR",
    "ACGL", "MTD", "SQ", "CCI", "CTRA", "CMS", "DPZ", "PLUG", "DXCM", "ZMBK",
    "TYL", "COIN", "NTAP", "PTC", "ROP", "WDAY", "ROKU", "CHWY", "DE", "EWBC",
    "BLDR", "FOXA", "FSLR", "ECOL", "NDAQ", "ALGN", "APH", "ROG", "VRX", "PLAN",
    "QRVO", "LITE", "FLR", "TPR", "CMS", "KNSL", "OMC", "EQIX", "IPG", "QVAL",
    "DLTR", "CPRI", "NKE", "DKNG", "PZZA", "NKTR", "ZEN", "ATUS", "TENB", "PTON",
]

DOW_30 = [
    "AAPL", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DHR", "DIS", "GE",
    "GS", "HD", "HON", "IBM", "INTC", "JNJ", "JPM", "KO", "LLY", "MCD",
    "MMM", "MRK", "MSFT", "NKE", "PG", "TRV", "UNH", "V", "VZ", "WMT",
]

MAJOR_ETFS = [
    "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "VEA", "VXUS", "SCHB", "SCHC",
    "VUG", "VTV", "VLV", "VB", "VO", "VBK", "VBR",
    "VYM", "VYMI", "VLUE", "VOOV", "VOOV", "QQQE", "QQQM",
    "VGT", "VFV", "VHV", "VPU", "VDC", "VHC", "VIS", "VAW", "VNQ", "VCIT",
    "VXUS", "VEA", "VWO", "IEFA", "IEMG", "EWJ", "EWG", "EWU", "EWL", "EWH",
    "BND", "AGG", "BSV", "VGIT", "VGLT", "VCIT", "VCLT", "ANGL", "HYG", "LQD",
    "SPXL", "TQQQ", "SQQQ", "SPXS", "SOXL", "SOXS", "TECL", "TECS", "UDOW", "SDOW",
    "SCHX", "SCHA", "SCHD", "SCHY", "ITOT", "ITAP", "IUSV", "IUSG", "IJR", "IJK",
    "VTSAX", "MGK", "VTSEX", "OIL", "USO", "GLD", "SLV", "DBC", "DBB",
]


def standard_universe_symbols() -> list[str]:
    return _dedupe(NASDAQ_100_STOCKS + SP500_TOP200 + DOW_30 + MAJOR_ETFS)


def standard_universe_counts() -> dict[str, int]:
    return {
        "NASDAQ-100": len(_dedupe(NASDAQ_100_STOCKS)),
        "S&P500 Top200": len(_dedupe(SP500_TOP200)),
        "Dow Jones 30": len(_dedupe(DOW_30)),
        "Major ETFs": len(_dedupe(MAJOR_ETFS)),
        "TOTAL": len(standard_universe_symbols()),
    }


# -----------------------------------------------------------------------------
# ETF catalog / room groups
# -----------------------------------------------------------------------------

ETF_NAMES: dict[str, str] = {
    "SPY": "SPDR S&P 500 ETF Trust",
    "QQQ": "Invesco QQQ Trust",
    "IWM": "iShares Russell 2000 ETF",
    "DIA": "SPDR Dow Jones Industrial Average ETF Trust",
    "VTI": "Vanguard Total Stock Market ETF",
    "VOO": "Vanguard S&P 500 ETF",
    "QQQM": "Invesco NASDAQ 100 ETF",
    "SCHB": "Schwab U.S. Broad Market ETF",
    "SCHC": "Schwab International Small-Cap Equity ETF",
    "SCHX": "Schwab U.S. Large-Cap ETF",
    "SCHA": "Schwab U.S. Small-Cap ETF",
    "ITOT": "iShares Core S&P Total U.S. Stock Market ETF",
    "VO": "Vanguard Mid-Cap ETF",
    "VB": "Vanguard Small-Cap ETF",
    "VUG": "Vanguard Growth ETF",
    "VTV": "Vanguard Value ETF",
    "VBK": "Vanguard Small-Cap Growth ETF",
    "VBR": "Vanguard Small-Cap Value ETF",
    "MGK": "Vanguard Mega Cap Growth ETF",
    "IJR": "iShares Core S&P Small-Cap ETF",
    "IUSV": "iShares Core S&P U.S. Value ETF",
    "IUSG": "iShares Core S&P U.S. Growth ETF",
    "VFV": "Vanguard S&P 500 Index ETF",
    "VLV": "Vanguard Value ETF",
    "VTSAX": "Vanguard Total Stock Market Index Fund",
    "VTSEX": "Vanguard Total Stock Market Index Fund",
    "XLK": "Technology Select Sector SPDR Fund",
    "XLF": "Financial Select Sector SPDR Fund",
    "XLE": "Energy Select Sector SPDR Fund",
    "XLI": "Industrial Select Sector SPDR Fund",
    "XLV": "Health Care Select Sector SPDR Fund",
    "XLY": "Consumer Discretionary Select Sector SPDR Fund",
    "XLP": "Consumer Staples Select Sector SPDR Fund",
    "XLU": "Utilities Select Sector SPDR Fund",
    "XLB": "Materials Select Sector SPDR Fund",
    "XLC": "Communication Services Select Sector SPDR Fund",
    "XLRE": "Real Estate Select Sector SPDR Fund",
    "SMH": "VanEck Semiconductor ETF",
    "SOXX": "iShares Semiconductor ETF",
    "KRE": "SPDR S&P Regional Banking ETF",
    "IBB": "iShares Biotechnology ETF",
    "XBI": "SPDR S&P Biotech ETF",
    "TQQQ": "ProShares UltraPro QQQ",
    "SOXL": "Direxion Daily Semiconductor Bull 3X Shares",
    "SPXL": "Direxion Daily S&P 500 Bull 3X Shares",
    "TECL": "Direxion Daily Technology Bull 3X Shares",
    "FNGU": "MicroSectors FANG+ Index 3X Leveraged ETN",
    "UPRO": "ProShares UltraPro S&P500",
    "UDOW": "ProShares UltraPro Dow30",
    "TNA": "Direxion Daily Small Cap Bull 3X Shares",
    "LABU": "Direxion Daily S&P Biotech Bull 3X Shares",
    "UYG": "ProShares Ultra Financials",
    "SQQQ": "ProShares UltraPro Short QQQ",
    "SOXS": "Direxion Daily Semiconductor Bear 3X Shares",
    "SPXS": "Direxion Daily S&P 500 Bear 3X Shares",
    "TECS": "Direxion Daily Technology Bear 3X Shares",
    "SDOW": "ProShares UltraPro Short Dow30",
    "SPXU": "ProShares UltraPro Short S&P500",
    "SDS": "ProShares UltraShort S&P500",
    "TZA": "Direxion Daily Small Cap Bear 3X Shares",
    "PSQ": "ProShares Short QQQ",
    "SH": "ProShares Short S&P500",
    "RWM": "ProShares Short Russell2000",
    "ARKK": "ARK Innovation ETF",
    "ARKQ": "ARK Autonomous Technology & Robotics ETF",
    "ARKW": "ARK Next Generation Internet ETF",
    "ARKG": "ARK Genomic Revolution ETF",
    "ARKF": "ARK Fintech Innovation ETF",
    "ARKX": "ARK Space Exploration & Innovation ETF",
    "SCHD": "Schwab U.S. Dividend Equity ETF",
    "VYM": "Vanguard High Dividend Yield ETF",
    "VYMI": "Vanguard International High Dividend Yield ETF",
    "DGRO": "iShares Core Dividend Growth ETF",
    "JEPI": "JPMorgan Equity Premium Income ETF",
    "JEPQ": "JPMorgan Nasdaq Equity Premium Income ETF",
    "HDV": "iShares Core High Dividend ETF",
    "NOBL": "ProShares S&P 500 Dividend Aristocrats ETF",
    "SPYD": "SPDR Portfolio S&P 500 High Dividend ETF",
    "VIG": "Vanguard Dividend Appreciation ETF",
    "DIVO": "Amplify CWP Enhanced Dividend Income ETF",
    "DGRW": "WisdomTree U.S. Quality Dividend Growth Fund",
    "IBIT": "iShares Bitcoin Trust ETF",
    "FBTC": "Fidelity Wise Origin Bitcoin Fund",
    "ARKB": "ARK 21Shares Bitcoin ETF",
    "BITO": "ProShares Bitcoin Strategy ETF",
    "GBTC": "Grayscale Bitcoin Trust ETF",
    "AIQ": "Global X Artificial Intelligence & Technology ETF",
    "BOTZ": "Global X Robotics & Artificial Intelligence ETF",
    "ICLN": "iShares Global Clean Energy ETF",
    "ITAP": "iShares Future AI and Tech ETF",
    "BND": "Vanguard Total Bond Market ETF",
    "AGG": "iShares Core U.S. Aggregate Bond ETF",
    "BSV": "Vanguard Short-Term Bond ETF",
    "VGIT": "Vanguard Intermediate-Term Treasury ETF",
    "VGLT": "Vanguard Long-Term Treasury ETF",
    "VCIT": "Vanguard Intermediate-Term Corporate Bond ETF",
    "VCLT": "Vanguard Long-Term Corporate Bond ETF",
    "ANGL": "VanEck Fallen Angel High Yield Bond ETF",
    "HYG": "iShares iBoxx $ High Yield Corporate Bond ETF",
    "LQD": "iShares iBoxx $ Investment Grade Corporate Bond ETF",
    "SRLN": "SPDR Blackstone Senior Loan ETF",
    "BKLN": "Invesco Senior Loan ETF",
    "TLT": "iShares 20+ Year Treasury Bond ETF",
    "IEF": "iShares 7-10 Year Treasury Bond ETF",
    "SHY": "iShares 1-3 Year Treasury Bond ETF",
    "IEI": "iShares 3-7 Year Treasury Bond ETF",
    "TIP": "iShares TIPS Bond ETF",
    "GLD": "SPDR Gold Shares",
    "SLV": "iShares Silver Trust",
    "DBC": "Invesco DB Commodity Index Tracking Fund",
    "DBB": "Invesco DB Base Metals Fund",
    "USO": "United States Oil Fund",
    "OIL": "iPath Series B S&P GSCI Crude Oil Total Return ETN",
    "BNO": "United States Brent Oil Fund",
    "UNG": "United States Natural Gas Fund",
}


HOT_SYMBOLS = _dedupe([
    "SPY", "QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "XLI", "SMH", "TQQQ", "SQQQ", "SCHD",
])

INDEX_SYMBOLS = _dedupe([
    "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "QQQM", "SCHB", "SCHC", "SCHX",
    "SCHA", "ITOT", "VO", "VB", "VUG", "VTV", "VBK", "VBR", "MGK", "IJR",
    "IUSV", "IUSG", "VFV", "VLV", "VTSAX", "VTSEX", "QVAL",
])

SECTOR_SYMBOLS = _dedupe([
    "XLK", "XLF", "XLE", "XLI", "XLV", "XLY", "XLP", "XLU", "XLB", "XLC",
    "XLRE", "SMH", "SOXX", "KRE", "IBB", "XBI",
])

LEVERAGE_SYMBOLS = _dedupe([
    "TQQQ", "SOXL", "SPXL", "TECL", "FNGU", "UPRO", "UDOW", "TNA", "LABU", "UYG",
])

REVERSE_SYMBOLS = _dedupe([
    "SQQQ", "SOXS", "SPXS", "TECS", "SDOW", "SPXU", "SDS", "TZA", "PSQ", "SH", "RWM",
])

ARK_SYMBOLS = _dedupe([
    "ARKK", "ARKQ", "ARKW", "ARKG", "ARKF", "ARKX",
])

DIVIDEND_SYMBOLS = _dedupe([
    "SCHD", "VYM", "VYMI", "DGRO", "JEPI", "JEPQ", "HDV", "NOBL", "SPYD", "VIG", "DIVO", "DGRW",
])

CRYPTO_SYMBOLS = _dedupe([
    "IBIT", "FBTC", "ARKB", "BITO", "GBTC",
])

THEME_SYMBOLS = _dedupe([
    "AIQ", "BOTZ", "ICLN", "ITAP",
])

FIXED_INCOME_SYMBOLS = _dedupe([
    "BND", "AGG", "BSV", "VGIT", "VGLT", "VCIT", "VCLT", "ANGL", "HYG", "LQD",
    "SRLN", "BKLN", "TLT", "IEF", "SHY", "IEI", "TIP",
])

COMMODITY_SYMBOLS = _dedupe([
    "GLD", "SLV", "DBC", "DBB", "USO", "OIL", "BNO", "UNG",
])

ROOM_SECTION_META: dict[str, dict[str, str]] = {
    "hot": {"title": "Hot ETFs", "dot": "#22c55e", "sort": "ret_5d desc"},
    "index": {"title": "Index ETFs", "dot": "#00D9FF", "sort": "ret_5d desc"},
    "sector": {"title": "Sector ETFs", "dot": "#10b981", "sort": "ret_5d desc"},
    "leverage": {"title": "Leverage ETFs", "dot": "#ef4444", "sort": "ret_5d desc"},
    "reverse": {"title": "Reverse ETFs", "dot": "#f97316", "sort": "ret_5d desc"},
    "ark": {"title": "ARK ETFs", "dot": "#a78bfa", "sort": "ret_5d desc"},
    "dividend": {"title": "Dividend ETFs", "dot": "#fbbf24", "sort": "ret_20d desc"},
    "crypto": {"title": "Crypto ETFs", "dot": "#8b5cf6", "sort": "ret_5d desc"},
    "theme": {"title": "Theme ETFs", "dot": "#60a5fa", "sort": "ret_5d desc"},
    "fixed_income": {"title": "Fixed Income ETFs", "dot": "#64748b", "sort": "ret_20d desc"},
    "commodity": {"title": "Commodity ETFs", "dot": "#f59e0b", "sort": "ret_20d desc"},
}

ROOM_SECTIONS: "OrderedDict[str, list[str]]" = OrderedDict(
    [
        ("hot", HOT_SYMBOLS),
        ("index", INDEX_SYMBOLS),
        ("sector", SECTOR_SYMBOLS),
        ("leverage", LEVERAGE_SYMBOLS),
        ("reverse", REVERSE_SYMBOLS),
        ("ark", ARK_SYMBOLS),
        ("dividend", DIVIDEND_SYMBOLS),
        ("crypto", CRYPTO_SYMBOLS),
        ("theme", THEME_SYMBOLS),
        ("fixed_income", FIXED_INCOME_SYMBOLS),
        ("commodity", COMMODITY_SYMBOLS),
    ]
)

CATALOG_GROUPS = [
    ("index", INDEX_SYMBOLS, "core_index", "core", "long", None, 10, "Broad market and style core"),
    ("sector", SECTOR_SYMBOLS, "sector_rotation", "tactical", "long", None, 20, "Sector and industry exposure"),
    ("leverage", LEVERAGE_SYMBOLS, "leveraged_long", "tactical", "long", 3.0, 30, "Leveraged upside exposure"),
    ("reverse", REVERSE_SYMBOLS, "leveraged_inverse", "hedge", "inverse", 3.0, 40, "Leveraged inverse exposure"),
    ("ark", ARK_SYMBOLS, "innovation", "tactical", "long", None, 50, "ARK innovation sleeve"),
    ("dividend", DIVIDEND_SYMBOLS, "income", "income", "long", None, 60, "Dividend and income ETFs"),
    ("crypto", CRYPTO_SYMBOLS, "digital_asset", "satellite", "long", None, 65, "Bitcoin and crypto proxies"),
    ("theme", THEME_SYMBOLS, "theme", "satellite", "long", None, 70, "Thematic growth ETFs"),
    ("fixed_income", FIXED_INCOME_SYMBOLS, "bond", "defensive", "long", None, 80, "Fixed income and credit"),
    ("commodity", COMMODITY_SYMBOLS, "real_assets", "defensive", "long", None, 90, "Commodity and real assets"),
]


@dataclass(frozen=True)
class EtfCatalogRow:
    symbol: str
    display_name: str
    category: str
    subcategory: str
    strategy_tier: str
    direction: str = "long"
    leverage_factor: float | None = None
    priority: int = 100
    source: str = "manual"
    notes: str = ""


def get_etf_display_name(symbol: str) -> str:
    clean = canonical_symbol(symbol)
    return ETF_NAMES.get(clean, clean)


def standard_universe_sets() -> dict[str, list[str]]:
    return {
        "NASDAQ-100": _dedupe(NASDAQ_100_STOCKS),
        "S&P500 Top200": _dedupe(SP500_TOP200),
        "Dow Jones 30": _dedupe(DOW_30),
        "Major ETFs": _dedupe(MAJOR_ETFS),
    }


def room_symbols(section: str | None = None) -> list[str]:
    if section is None:
        return _dedupe([symbol for symbols in ROOM_SECTIONS.values() for symbol in symbols])
    return list(ROOM_SECTIONS.get(section, []))


def catalog_symbols(categories: Sequence[str] | None = None) -> list[str]:
    if not categories:
        return _dedupe([symbol for _, symbols, *_ in CATALOG_GROUPS for symbol in symbols])

    wanted = {str(category).strip().lower() for category in categories if category}
    out: list[str] = []
    for category, symbols, *_ in CATALOG_GROUPS:
        if category not in wanted:
            continue
        out.extend(symbols)
    return _dedupe(out)


def resolve_requested_symbols(items: Sequence[str] | None = None) -> list[str]:
    """
    Resolve a mixed list of category names and/or individual symbols.

    Examples:
      ["index", "sector"]
      ["SPY", "QQQ", "leverage"]
    """
    if not items:
        return catalog_symbols()

    resolved: list[str] = []
    for item in items:
        if not item:
            continue
        raw = str(item).strip()
        key = raw.lower()
        if key in ROOM_SECTIONS:
            resolved.extend(room_symbols(key))
            continue
        if any(key == category for category, *_ in CATALOG_GROUPS):
            resolved.extend(catalog_symbols([key]))
            continue
        resolved.append(canonical_symbol(raw))
    return _dedupe(resolved)


def build_etf_catalog_rows(categories: Sequence[str] | None = None) -> list[EtfCatalogRow]:
    selected = set(catalog_symbols(categories))
    rows: list[EtfCatalogRow] = []
    seen: set[str] = set()

    for category, symbols, subcategory, strategy_tier, direction, leverage_factor, priority, notes in CATALOG_GROUPS:
        for symbol in symbols:
            clean = canonical_symbol(symbol)
            if clean in seen or clean not in selected:
                continue
            seen.add(clean)
            rows.append(
                EtfCatalogRow(
                    symbol=clean,
                    display_name=get_etf_display_name(clean),
                    category=category,
                    subcategory=subcategory,
                    strategy_tier=strategy_tier,
                    direction=direction,
                    leverage_factor=leverage_factor,
                    priority=priority,
                    source="manual",
                    notes=notes,
                )
            )
    return rows
