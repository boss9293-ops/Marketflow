"""
build_tqqq_dca.py — DCA 전략 Python 백테스터 (임의 종목, 일봉 close)
DB: ohlcv_daily (symbol, date, close/high/low)
CSV 폴백: tqqq_history.csv (TQQQ 전용)
"""
import json, os, sys, argparse, csv, sqlite3
from datetime import datetime, date

ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH  = os.path.join(os.path.dirname(ROOT), 'data', 'marketflow.db')
CSV_PATH = os.path.join(os.path.dirname(ROOT), 'data', 'tqqq_history.csv')
BT_DIR   = os.path.join(os.path.dirname(ROOT), 'data', 'backtests')
os.makedirs(BT_DIR, exist_ok=True)

DEFAULT_PARAMS = {
    "ticker": "TQQQ",
    "buy_frequency": "Weekly", "buy_day": "Wednesday",
    "buy_type": "amount",   "buy_amount": 100.0, "buy_quantity": 1.0,
    "start_date": "2023-01-01", "end_date": None,
    "use_take_profit": True,  "take_profit_pct": 20.0,
    "use_stop_loss":   True,  "stop_loss_pct":   -10.0,
    "use_partial_sell": True, "sell_ratio_pct":  10.0,
    "use_rsi_buy": False, "use_rsi_sell": False,
    "rsi_length": 14, "rsi_buy_level": 30, "rsi_sell_level": 70,
    "use_macd_buy": False, "use_macd_sell": False,
    "macd_fast": 12, "macd_slow": 26, "macd_signal": 9,
    "use_ma_buy": False, "ma_buy_len": 50,  "ma_buy_pct": 10.0,
    "use_ma_dip_buy": False,
    "ma_dip_steps": [{"len": 50, "pct": 10}, {"len": 20, "pct": 15}, {"len": 10, "pct": 20}],
    "use_ma_sell": False, "ma_sell_len": 200, "ma_sell_pct": 10.0,
    "use_v_buy": False, "v_buy_ma_len": 10, "v_buy_drop_pct": -5.0, "v_buy_pct": 10.0,
}
DAY_MAP = {"Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3, "Friday": 4}


def _norm_date(s: str) -> str:
    """Normalize M/D/YYYY or YYYY-MM-DD -> YYYY-MM-DD."""
    s = s.strip()
    if len(s) == 10 and s[4] == '-':
        return s
    parts = s.split('/')
    if len(parts) == 3:
        return f'{parts[2]}-{int(parts[0]):02d}-{int(parts[1]):02d}'
    return s


def calc_rsi(closes, length):
    rsi = [None] * len(closes)
    if len(closes) < length + 1:
        return rsi
    gains  = [max(closes[i] - closes[i-1], 0) for i in range(1, length+1)]
    losses = [max(closes[i-1] - closes[i], 0) for i in range(1, length+1)]
    ag, al = sum(gains)/length, sum(losses)/length
    for i in range(length, len(closes)):
        if i == length:
            rsi[i] = 100 - 100/(1 + ag/al) if al else 100.0
        else:
            d = closes[i] - closes[i-1]
            ag = (ag*(length-1) + max(d, 0)) / length
            al = (al*(length-1) + max(-d, 0)) / length
            rsi[i] = 100 - 100/(1 + ag/al) if al else 100.0
    return rsi


def ema_calc(data, period):
    res = [None] * len(data)
    k = 2 / (period + 1)
    for i, v in enumerate(data):
        if v is None:
            continue
        res[i] = v if (i == 0 or res[i-1] is None) else v*k + res[i-1]*(1-k)
    return res


def calc_macd(closes, fast, slow, sig):
    ef = ema_calc(closes, fast)
    es = ema_calc(closes, slow)
    ml = [f - s if f is not None and s is not None else None for f, s in zip(ef, es)]
    sig_vals = ema_calc([v for v in ml if v is not None], sig)
    sl = [None] * len(closes)
    j = 0
    for i, v in enumerate(ml):
        if v is not None:
            sl[i] = sig_vals[j]
            j += 1
    return ml, sl


def calc_sma(closes, length):
    sma = [None] * len(closes)
    for i in range(length - 1, len(closes)):
        sma[i] = sum(closes[i-length+1:i+1]) / length
    return sma


def xover(a, b, ap, bp):
    return None not in (a, b, ap, bp) and ap <= bp and a > b


def xunder(a, b, ap, bp):
    return None not in (a, b, ap, bp) and ap >= bp and a < b


def load_prices(ticker: str):
    """Load all OHLC rows for ticker from DB; fallback to CSV for TQQQ."""
    rows = []
    # Try DB first
    if os.path.exists(DB_PATH):
        try:
            con = sqlite3.connect(DB_PATH)
            raw = con.execute(
                "SELECT date, close, high, low FROM ohlcv_daily WHERE symbol=? ORDER BY date",
                (ticker,)
            ).fetchall()
            con.close()
            if raw:
                seen = set()
                for date_s, close, high, low in raw:
                    nd = _norm_date(date_s)
                    if nd in seen:
                        continue
                    seen.add(nd)
                    try:
                        rows.append({'date': nd, 'close': float(close),
                                     'high': float(high or close), 'low': float(low or close)})
                    except Exception:
                        pass
                rows.sort(key=lambda x: x['date'])
                return rows
        except Exception:
            pass
    # CSV fallback (TQQQ only)
    if ticker.upper() == 'TQQQ' and os.path.exists(CSV_PATH):
        with open(CSV_PATH, encoding='utf-8') as f:
            for r in csv.DictReader(f):
                try:
                    rows.append({
                        'date':  r['Date'].strip(),
                        'close': float(r['Close']),
                        'high':  float(r['High']),
                        'low':   float(r['Low']),
                    })
                except Exception:
                    pass
        return sorted(rows, key=lambda x: x['date'])
    return rows


def run_backtest(params=None):
    p = {**DEFAULT_PARAMS, **(params or {})}
    ticker    = p.get('ticker', 'TQQQ').upper()
    start_dt  = p['start_date']
    end_dt    = p['end_date'] or date.today().strftime('%Y-%m-%d')
    buy_day_n = DAY_MAP.get(p['buy_day'], 2)

    rows   = load_prices(ticker)
    if not rows:
        return {'error': f'No price data found for {ticker}'}

    closes = [r['close'] for r in rows]

    rsi_a      = calc_rsi(closes, p['rsi_length'])
    ml, sl     = calc_macd(closes, p['macd_fast'], p['macd_slow'], p['macd_signal'])
    mab        = calc_sma(closes, p['ma_buy_len'])
    # 하방매수 단계별 SMA 사전 계산 (중복 len 방지)
    _dip_lens  = {s["len"] for s in p.get("ma_dip_steps", [])} if p["use_ma_dip_buy"] else set()
    dip_smas   = {ln: calc_sma(closes, ln) for ln in _dip_lens}
    mas        = calc_sma(closes, p['ma_sell_len'])
    mav        = calc_sma(closes, p['v_buy_ma_len'])   # V자 회복 기준 MA
    ma50       = calc_sma(closes, 50)
    ma200      = calc_sma(closes, 200)

    total_cost = invested_cost = cash_realized = total_shares = 0.0
    bh_shares  = bh_cost = realized_pnl = 0.0
    buy_count  = sell_count = 0
    otb          = False
    equity_curve: list = []
    signals: list      = []

    for i, row in enumerate(rows):
        d = row['date']
        c = row['close']
        if d < start_dt or d > end_dt:
            continue
        dow = datetime.strptime(d, '%Y-%m-%d').weekday()

        # ── prev_close (이전봉 종가, MA 크로스 판정용) ───────────────────────
        prev_c = rows[i-1]['close'] if i > 0 else c

        # ── Buy ──────────────────────────────────────────────────────────────
        is_daily   = p['buy_frequency'] == 'Daily'
        is_weekly  = p['buy_frequency'] == 'Weekly'  and dow == buy_day_n
        is_onetime = p['buy_frequency'] == 'One Time' and not otb

        if is_daily or is_weekly or is_onetime:
            rsi_ok  = (not p['use_rsi_buy'])  or (rsi_a[i] is not None and rsi_a[i] < p['rsi_buy_level'])
            macd_ok = (not p['use_macd_buy']) or (i > 0 and xover(ml[i], sl[i], ml[i-1], sl[i-1]))
            ma_ok   = (not p['use_ma_buy'])   or (mab[i] is not None and c > mab[i])

            if rsi_ok and macd_ok and ma_ok:
                # 금액 or 수량 방식
                if p['buy_type'] == 'quantity':
                    sh    = p['buy_quantity']
                    spend = sh * c
                else:                          # 'amount' (default)
                    sh    = p['buy_amount'] / c
                    spend = p['buy_amount']
                total_cost    += spend
                invested_cost += spend
                total_shares  += sh
                buy_count     += 1
                bh_shares     += sh
                bh_cost       += spend
                if p['buy_frequency'] == 'One Time':
                    otb = True
                signals.append({'d': d, 'type': 'buy', 'price': round(c, 4),
                                 'shares': round(sh, 4), 'amount': round(spend, 2),
                                 'reason': 'DCA'})

        # ── MA 회복 재매수 (MA 상향 돌파 · 전체 보유량의 ma_buy_pct%) ────────
        if (p['use_ma_buy'] and p['use_ma_sell'] and total_shares > 0 and i > 0
                and mab[i] is not None and mab[i-1] is not None
                and xover(c, mab[i], prev_c, mab[i-1])):
            sh_rb          = total_shares * p['ma_buy_pct'] / 100.0
            spend_rb       = sh_rb * c
            total_cost    += spend_rb
            invested_cost += spend_rb
            total_shares  += sh_rb
            bh_shares     += sh_rb
            bh_cost       += spend_rb
            buy_count     += 1
            signals.append({'d': d, 'type': 'buy', 'price': round(c, 4),
                             'shares': round(sh_rb, 4), 'amount': round(spend_rb, 2),
                             'reason': 'MA_BUY'})

        # ── MA 하방 매수 (단계별 · 각 MA 하향 돌파시 해당 % 매수) ─────────────
        # MA 하방매수 — mas(매도 MA선) 아래에 있을 때만 각 단계 발동
        _below_ma_sell = (not p['use_ma_sell']) or (mas[i] is not None and c < mas[i])
        if p['use_ma_dip_buy'] and i > 0 and _below_ma_sell:
            for _step in p.get("ma_dip_steps", []):
                _sma = dip_smas.get(_step["len"])
                if _sma is None or _sma[i] is None or _sma[i-1] is None:
                    continue
                if xunder(c, _sma[i], prev_c, _sma[i-1]):
                    sh_dip         = total_shares * _step["pct"] / 100.0 if total_shares > 0 else p['buy_amount'] / c
                    spend_dip      = sh_dip * c
                    total_cost    += spend_dip
                    invested_cost += spend_dip
                    total_shares  += sh_dip
                    bh_shares     += sh_dip
                    bh_cost       += spend_dip
                    buy_count     += 1
                    signals.append({'d': d, 'type': 'buy', 'price': round(c, 4),
                                     'shares': round(sh_dip, 4), 'amount': round(spend_dip, 2),
                                     'reason': f'DIP{_step["len"]}'})

        # ── V자 회복 매수 (MA200 하방 + 3일 낙폭 둔화 + MAv 상향 돌파) ────────
        if p['use_v_buy'] and i >= 3 and ma200[i] is not None and c < ma200[i]:
            avg_3d = sum((closes[j] - closes[j-1]) / closes[j-1] * 100
                         for j in range(i-2, i+1)) / 3
            if (avg_3d >= p['v_buy_drop_pct']
                    and mav[i] is not None and mav[i-1] is not None
                    and xover(c, mav[i], prev_c, mav[i-1])):
                sh_v          = total_shares * p['v_buy_pct'] / 100.0 if total_shares > 0 else p['buy_amount'] / c
                spend_v       = sh_v * c
                total_cost   += spend_v
                invested_cost += spend_v
                total_shares += sh_v
                bh_shares    += sh_v
                bh_cost      += spend_v
                buy_count    += 1
                signals.append({'d': d, 'type': 'buy', 'price': round(c, 4),
                                'shares': round(sh_v, 4), 'amount': round(spend_v, 2),
                                'reason': f'V{p["v_buy_ma_len"]}'})

        # ── Eval ─────────────────────────────────────────────────────────────
        cur_val    = total_shares * c
        profit_pct = (cur_val - invested_cost) / invested_cost * 100 if invested_cost > 0 else 0.0

        # ── Sell ─────────────────────────────────────────────────────────────
        if total_shares > 0 and invested_cost > 0:
            # RSI / MACD 시그널 (상태 기반)
            rs       = (not p['use_rsi_sell'])  or (rsi_a[i] is not None and rsi_a[i] > p['rsi_sell_level'])
            ms       = (not p['use_macd_sell']) or (i > 0 and xunder(ml[i], sl[i], ml[i-1], sl[i-1]))
            any_rsi_macd = p['use_rsi_sell'] or p['use_macd_sell']
            sig_     = any_rsi_macd and rs and ms
            # TP / SL
            tp       = p['use_take_profit'] and profit_pct >= p['take_profit_pct']
            sl_      = p['use_stop_loss']   and profit_pct <= p['stop_loss_pct']
            # MA 하향 돌파 매도 (이벤트 기반 — 크로스언더 1회)
            ma_cross_dn = (p['use_ma_sell'] and i > 0
                           and mas[i] is not None and mas[i-1] is not None
                           and xunder(c, mas[i], prev_c, mas[i-1]))

            reason = ('TP'      if tp          else
                      'SL'      if sl_         else
                      'MA_SELL' if ma_cross_dn else
                      'SIGNAL'  if sig_        else None)

            if reason:
                if reason == 'MA_SELL':
                    ratio = p['ma_sell_pct'] / 100.0
                else:
                    ratio = p['sell_ratio_pct'] / 100.0 if p['use_partial_sell'] else 1.0
                ss_cnt   = total_shares * ratio
                avg      = invested_cost / total_shares
                rpnl     = (c - avg) * ss_cnt
                sell_amt = ss_cnt * c
                realized_pnl  += rpnl
                invested_cost -= avg * ss_cnt
                total_shares  -= ss_cnt
                cash_realized += sell_amt
                sell_count    += 1
                signals.append({'d': d, 'type': 'sell', 'price': round(c, 4),
                                 'shares': round(ss_cnt, 4),
                                 'amount': round(sell_amt, 2),
                                 'reason': reason, 'pnl': round(rpnl, 2)})

        # ── 매도 후 cur_val 재계산 (팔린 주식 제외) ─────────────────────────
        cur_val = total_shares * c

        equity_curve.append({
            'd':             d,
            'close':         round(c, 4),
            'current_value': round(cur_val, 2),
            'cash_realized': round(cash_realized, 2),
            'total_value':   round(cur_val + cash_realized, 2),
            'invested_cost': round(invested_cost, 2),
            'total_shares':  round(total_shares, 4),
            'profit_pct':    round(profit_pct, 2),
            'total_cost':    round(total_cost, 2),
            'bh_value':      round(bh_shares * c, 2),
            'ma50':          round(ma50[i], 4)  if ma50[i]  is not None else None,
            'ma200':         round(ma200[i], 4) if ma200[i] is not None else None,
        })

    if not equity_curve:
        return {'error': 'No data in range'}

    last  = equity_curve[-1]
    first = equity_curve[0]
    days  = (datetime.strptime(last['d'], '%Y-%m-%d') -
             datetime.strptime(first['d'], '%Y-%m-%d')).days
    yrs   = days / 365.25
    final    = last['total_value']
    bh_final = last['bh_value']
    cagr    = ((final    / total_cost) ** (1/yrs) - 1) * 100 if yrs > 0 and total_cost > 0 else 0.0
    bh_cagr = ((bh_final / bh_cost)   ** (1/yrs) - 1) * 100 if yrs > 0 and bh_cost   > 0 else 0.0

    peak = bh_peak = mdd = bh_mdd = 0.0
    dd_curve = []
    for pt in equity_curve:
        tv = pt['total_value']
        bv = pt['bh_value']
        peak    = max(peak,    tv)
        bh_peak = max(bh_peak, bv)
        dd   = ((tv - peak)    / peak    * 100) if peak    > 0 else 0.0
        b_dd = ((bv - bh_peak) / bh_peak * 100) if bh_peak > 0 else 0.0
        mdd    = min(mdd,    dd)
        bh_mdd = min(bh_mdd, b_dd)
        dd_curve.append({'d': pt['d'], 'dd': round(dd, 2), 'bh_dd': round(b_dd, 2)})

    summary = {
        'ticker':            ticker,
        'params':            p,
        'period':            {'start': first['d'], 'end': last['d'], 'days': days},
        'total_invested':    round(total_cost, 2),
        'final_value':       round(final, 2),
        'total_return_pct':  round((final / total_cost - 1) * 100, 2) if total_cost else 0,
        'cagr_pct':          round(cagr, 2),
        'mdd_pct':           round(mdd, 2),
        'realized_pnl':      round(realized_pnl, 2),
        'unrealized_pnl':    round(last['current_value'] - last['invested_cost'], 2),
        'cash_realized':     round(cash_realized, 2),
        'buy_count':         buy_count,
        'sell_count':        sell_count,
        'bh': {
            'total_invested':    round(bh_cost, 2),
            'final_value':       round(bh_final, 2),
            'total_return_pct':  round((bh_final / bh_cost - 1) * 100, 2) if bh_cost else 0,
            'cagr_pct':          round(bh_cagr, 2),
            'mdd_pct':           round(bh_mdd, 2),
        },
        'generated': datetime.now().strftime('%Y-%m-%d %H:%M'),
    }

    return {
        'summary':      summary,
        'equity_curve': equity_curve,
        'dd_curve':     dd_curve,
        'signals':      signals,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--params', type=str, default='{}')
    args = parser.parse_args()
    result = run_backtest(json.loads(args.params))

    if 'error' in result:
        print('ERROR:', result['error'])
        sys.exit(1)

    s = result['summary']
    json.dump({'summary': s, 'signals': result['signals'][:20]},
              open(os.path.join(BT_DIR, 'tqqq_dca_summary.json'), 'w', encoding='utf-8'),
              ensure_ascii=False)
    json.dump({'equity_curve': result['equity_curve'],
               'dd_curve': result['dd_curve'],
               'signals': result['signals']},
              open(os.path.join(BT_DIR, 'tqqq_dca_curve.json'), 'w', encoding='utf-8'),
              ensure_ascii=False)

    print(f"Ticker : {s['ticker']}")
    print(f"Period : {s['period']['start']} -> {s['period']['end']} ({s['period']['days']}d)")
    print(f"Strat  : ${s['final_value']:,.0f}  ({s['total_return_pct']:+.1f}%)  CAGR {s['cagr_pct']:+.1f}%  MDD {s['mdd_pct']:.1f}%")
    print(f"B&H    : ${s['bh']['final_value']:,.0f}  ({s['bh']['total_return_pct']:+.1f}%)  CAGR {s['bh']['cagr_pct']:+.1f}%  MDD {s['bh']['mdd_pct']:.1f}%")
    print(f"Buys:{s['buy_count']}  Sells:{s['sell_count']}  Realized:${s['realized_pnl']:+,.0f}")
    print(f"Saved -> {BT_DIR}")
