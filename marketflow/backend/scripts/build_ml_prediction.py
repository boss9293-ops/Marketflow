"""
ML Prediction v2.1: multi-horizon(2/5/10), tail-risk, recent strip, action mapping.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import traceback
import warnings
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore", message="Skipping features without any observed values", category=UserWarning)

MODEL_VERSION = "ml_pred_v2.1"
DATA_VERSION = "ml_prediction_v2.1"
SYMBOLS = ["SPY", "QQQ"]
HORIZONS = [2, 5, 10]
TAIL_TH = 0.45
RECENT_WIN = 60


def rr() -> str: return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
def db_path() -> str: return os.path.join(rr(), "data", "marketflow.db")
def now() -> str: return datetime.now().isoformat(timespec="seconds")
def cp() -> List[str]:
    return [os.path.join(rr(), "output", "cache", "ml_prediction.json"), os.path.join(rr(), "backend", "output", "cache", "ml_prediction.json")]


def write_json(path: str, data: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def tc(conn: sqlite3.Connection, t: str) -> List[str]:
    return [str(r[1]) for r in conn.execute(f"PRAGMA table_info({t})").fetchall()]


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ml_predictions_daily (
            date TEXT NOT NULL, symbol TEXT NOT NULL, horizon_days INTEGER NOT NULL DEFAULT 5,
            up_prob REAL, down3_prob REAL, down5_prob REAL, vol_high_prob REAL,
            pred_up_2d REAL, pred_up_5d REAL, pred_up_10d REAL,
            prob_mdd_le_3_5d REAL, prob_mdd_le_5_5d REAL,
            confidence_label TEXT, model_version TEXT, top_features_json TEXT, metrics_json TEXT,
            recent_metrics_json TEXT, action_mode TEXT, action_text_ko TEXT, action_reasons_json TEXT,
            generated_at TEXT, PRIMARY KEY (date, symbol, horizon_days)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ml_predictions_date ON ml_predictions_daily(date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ml_predictions_symbol ON ml_predictions_daily(symbol)")
    req = {
        "pred_up_2d": "REAL", "pred_up_5d": "REAL", "pred_up_10d": "REAL",
        "prob_mdd_le_3_5d": "REAL", "prob_mdd_le_5_5d": "REAL",
        "recent_metrics_json": "TEXT", "action_mode": "TEXT",
        "action_text_ko": "TEXT", "action_reasons_json": "TEXT",
    }
    cols = set(tc(conn, "ml_predictions_daily"))
    for k, v in req.items():
        if k not in cols:
            conn.execute(f"ALTER TABLE ml_predictions_daily ADD COLUMN {k} {v}")
    conn.commit()


def lmd(conn: sqlite3.Connection) -> pd.DataFrame:
    df = pd.read_sql_query("SELECT date, spy, qqq, iwm, vix, dxy, us10y, us2y, oil, gold, btc FROM market_daily ORDER BY date", conn)
    if not df.empty: df["date"] = pd.to_datetime(df["date"], format="mixed")
    return df


def lid(conn: sqlite3.Connection, symbol: str) -> pd.DataFrame:
    q = """
    SELECT date, sma20, sma50, sma200, ema8, ema21, rsi14, macd, macd_signal, atr14, vol20, ret1d, ret5d
    FROM indicators_daily WHERE symbol=? ORDER BY date
    """
    df = pd.read_sql_query(q, conn, params=[symbol])
    if not df.empty: df["date"] = pd.to_datetime(df["date"], format="mixed")
    return df


def lds(conn: sqlite3.Connection) -> pd.DataFrame:
    cols = tc(conn, "daily_snapshots")
    keep = [c for c in ["date", "gate_score", "vcp_count", "rotation_count", "risk_trend", "market_phase"] if c in cols]
    if not keep: return pd.DataFrame()
    df = pd.read_sql_query(f"SELECT {', '.join(keep)} FROM daily_snapshots ORDER BY date", conn)
    if not df.empty: df["date"] = pd.to_datetime(df["date"], format="mixed")
    return df


def pr(s: pd.Series, n: int) -> pd.Series: return s.pct_change(n, fill_method=None)


def frame(symbol: str, md: pd.DataFrame, ind: pd.DataFrame, ds: pd.DataFrame) -> pd.DataFrame:
    c = symbol.lower()
    if c not in md.columns: return pd.DataFrame()
    df = md.copy(); df["price"] = df[c]
    base = [x for x in ["date", "price", "spy", "qqq", "iwm", "vix", "dxy", "us10y", "us2y", "oil", "gold", "btc"] if x in df.columns]
    df = df[base]
    df["ret1d"], df["ret5d"], df["ret10d"], df["ret20d"] = pr(df["price"], 1), pr(df["price"], 5), pr(df["price"], 10), pr(df["price"], 20)
    df["vol20_std"] = df["ret1d"].rolling(20).std()
    if "vix" in df: df["vix_ret1d"] = pr(df["vix"], 1)
    if "dxy" in df: df["dxy_ret1d"] = pr(df["dxy"], 1)
    if "us10y" in df: df["us10y_chg"] = df["us10y"].diff(1)
    if "us10y" in df and "us2y" in df: df["term_spread"] = df["us10y"] - df["us2y"]
    if "qqq" in df and "spy" in df: df["qqq_spy_spread_5d"] = pr(df["qqq"], 5) - pr(df["spy"], 5)
    for nm in ["iwm", "oil", "gold", "btc"]:
        if nm in df: df[f"{nm}_ret5d"] = pr(df[nm], 5)
    if not ind.empty:
        ind2 = ind.rename(columns={"ret1d": "ind_ret1d", "ret5d": "ind_ret5d", "vol20": "ind_vol20"})
        df = df.merge(ind2, on="date", how="left")
        if "macd" in df and "macd_signal" in df: df["macd_diff"] = df["macd"] - df["macd_signal"]
        for ma in ["sma20", "sma50", "sma200", "ema8", "ema21"]:
            if ma in df: df[f"{ma}_gap"] = (df["price"] - df[ma]) / df[ma]
    if not ds.empty:
        x = ds.copy()
        if "risk_trend" in x: x["risk_trend_score"] = x["risk_trend"].map({"Improving": 1.0, "Stable": 0.0, "Deteriorating": -1.0})
        if "market_phase" in x: x["phase_score"] = x["market_phase"].map({"BULL": 1.0, "NEUTRAL": 0.0, "BEAR": -1.0})
        keep = [k for k in ["date", "gate_score", "vcp_count", "rotation_count", "risk_trend_score", "phase_score"] if k in x.columns]
        df = df.merge(x[keep], on="date", how="left")
    for h in HORIZONS:
        fr = df["price"].shift(-h) / df["price"] - 1.0
        df[f"label_up_{h}d"] = np.where(fr.notna(), (fr > 0).astype(int), np.nan)
    nxt = pd.concat([df["price"].shift(-i) for i in range(1, 6)], axis=1)
    mdd5 = nxt.min(axis=1) / df["price"] - 1.0
    r5 = pd.concat([(df["price"].shift(-i) / df["price"].shift(-(i - 1)) - 1.0) for i in range(1, 6)], axis=1).std(axis=1)
    cut = r5.shift(1).rolling(120, min_periods=40).median().fillna(r5.quantile(0.65) if r5.notna().any() else np.nan)
    df["label_mdd_le_3_5d"] = np.where(mdd5.notna(), (mdd5 <= -0.03).astype(int), np.nan)
    df["label_mdd_le_5_5d"] = np.where(mdd5.notna(), (mdd5 <= -0.05).astype(int), np.nan)
    df["label_vol_high_5d"] = np.where(r5.notna() & cut.notna(), (r5 > cut).astype(int), np.nan)
    return df.sort_values("date").reset_index(drop=True)


def fcols(df: pd.DataFrame) -> List[str]:
    ex = {"date", "price", "label_up_2d", "label_up_5d", "label_up_10d", "label_mdd_le_3_5d", "label_mdd_le_5_5d", "label_vol_high_5d"}
    out: List[str] = []
    for c in df.columns:
        if c in ex or not pd.api.types.is_numeric_dtype(df[c]): continue
        if df[c].notna().sum() < 80 or df[c].dropna().nunique() <= 5: continue
        out.append(c)
    return out


def model() -> Pipeline:
    return Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler()), ("clf", LogisticRegression(max_iter=400, class_weight="balanced", random_state=42))])


def fitc(X: pd.DataFrame, y: pd.Series):
    if len(y) < 120 or y.nunique() < 2: return None
    b = model()
    if int(y.value_counts().min()) < 10:
        b.fit(X, y); return b
    try:
        c = CalibratedClassifierCV(estimator=b, method="sigmoid", cv=3); c.fit(X, y); return c
    except Exception:
        b.fit(X, y); return b


def p1(m, X: pd.DataFrame) -> np.ndarray:
    if m is None: return np.full((len(X),), 0.5)
    try:
        p = m.predict_proba(X); return p[:, 1] if p.ndim == 2 and p.shape[1] > 1 else np.full((len(X),), 0.5)
    except Exception:
        return np.full((len(X),), 0.5)


def wfm(X: pd.DataFrame, y: pd.Series) -> Dict[str, Any]:
    if len(y) < 150 or y.nunique() < 2: return {"folds": 0, "samples": int(len(y)), "auc": None, "acc": None, "brier": None}
    sp = 5 if len(y) >= 280 else 3
    auc, acc, br = [], [], []
    for tr, te in TimeSeriesSplit(n_splits=sp).split(X):
        Xtr, Xte, ytr, yte = X.iloc[tr], X.iloc[te], y.iloc[tr], y.iloc[te]
        if ytr.nunique() < 2 or yte.nunique() < 2: continue
        m = fitc(Xtr, ytr); prb = p1(m, Xte); pdn = (prb >= 0.5).astype(int)
        try: auc.append(float(roc_auc_score(yte, prb)))
        except Exception: pass
        try: acc.append(float(accuracy_score(yte, pdn)))
        except Exception: pass
        try: br.append(float(brier_score_loss(yte, prb)))
        except Exception: pass
    return {"folds": sp, "samples": int(len(y)), "auc": round(float(np.mean(auc)), 4) if auc else None, "acc": round(float(np.mean(acc)), 4) if acc else None, "brier": round(float(np.mean(br)), 4) if br else None}


def rstrip(X: pd.DataFrame, y: pd.Series) -> Dict[str, Any]:
    mn = 160
    if len(y) < mn + 10 or y.nunique() < 2:
        return {"n_60d": 0, "acc_60d": None, "auc_60d": None, "brier_60d": None, "n_20d": 0, "acc_20d": None, "tail_signal_threshold": TAIL_TH, "tail_signal_count_60d": 0, "tail_signal_hit_rate_60d": None}
    idx = list(range(mn, len(y)))[-RECENT_WIN:]
    probs, truth, hits = [], [], []
    for i in idx:
        ytr = y.iloc[:i]
        if ytr.nunique() < 2: continue
        m = model(); m.fit(X.iloc[:i], ytr)
        p = float(p1(m, X.iloc[[i]])[0]); t = int(y.iloc[i])
        probs.append(p); truth.append(t); hits.append(int((p >= 0.5) == bool(t)))
    if not probs:
        return {"n_60d": 0, "acc_60d": None, "auc_60d": None, "brier_60d": None, "n_20d": 0, "acc_20d": None, "tail_signal_threshold": TAIL_TH, "tail_signal_count_60d": 0, "tail_signal_hit_rate_60d": None}
    n = len(probs); n20 = min(20, n); tidx = [i for i, p in enumerate(probs) if p >= TAIL_TH]
    th = [truth[i] for i in tidx]
    auc = float(roc_auc_score(truth, probs)) if len(set(truth)) >= 2 else None
    return {"n_60d": n, "acc_60d": round(float(np.mean(hits)), 4), "auc_60d": round(auc, 4) if auc is not None else None, "brier_60d": round(float(brier_score_loss(truth, probs)), 4), "n_20d": n20, "acc_20d": round(float(np.mean(hits[-n20:])), 4) if n20 else None, "tail_signal_threshold": TAIL_TH, "tail_signal_count_60d": len(tidx), "tail_signal_hit_rate_60d": round(float(np.mean(th)), 4) if th else None}


def dlab(p: float) -> str: return "Bullish" if p >= 0.55 else ("Bearish" if p <= 0.45 else "Neutral")
def clab(p: float, m: Dict[str, Any]) -> str:
    e = abs(p - 0.5); a = m.get("acc_60d"); b = m.get("brier_60d")
    if e >= 0.16 and (a is None or a >= 0.56) and (b is None or b <= 0.24): return "HIGH"
    return "MEDIUM" if e >= 0.09 else "LOW"


def pred_date(df: pd.DataFrame, req: Optional[str]) -> Optional[pd.Timestamp]:
    if df.empty: return None
    if not req: return df["date"].max()
    try: t = pd.to_datetime(req)
    except Exception: return df["date"].max()
    v = df[df["date"] <= t]["date"]; return v.max() if not v.empty else None


def train_target(df: pd.DataFrame, feats: List[str], ycol: str, pdte: pd.Timestamp) -> Dict[str, Any]:
    tr = df[(df["date"] < pdte) & df[ycol].notna()]; prw = df[df["date"] == pdte]
    d = {"prob": 0.5, "model": None, "ufeat": [], "cv": {"folds": 0, "samples": 0, "auc": None, "acc": None, "brier": None}, "recent": {"n_60d": 0, "acc_60d": None, "auc_60d": None, "brier_60d": None, "n_20d": 0, "acc_20d": None, "tail_signal_threshold": TAIL_TH, "tail_signal_count_60d": 0, "tail_signal_hit_rate_60d": None}}
    if tr.empty or prw.empty: return d
    uf = [f for f in feats if tr[f].notna().sum() > 30]
    if len(uf) < 5: return d
    X, y = tr[uf], tr[ycol].astype(int); m = fitc(X, y)
    d["prob"], d["model"], d["ufeat"], d["cv"], d["recent"] = float(p1(m, prw[uf])[0]), m, uf, wfm(X, y), rstrip(X, y)
    return d


def drivers(m, uf: List[str], row: pd.DataFrame) -> List[Dict[str, Any]]:
    pipe = m if isinstance(m, Pipeline) else (getattr(getattr(m, "calibrated_classifiers_", [None])[0], "estimator", None) if m is not None else None)
    if pipe is None or row.empty or not uf: return []
    try:
        xi = pipe.named_steps["imp"].transform(row[uf]); xs = pipe.named_steps["sc"].transform(xi); c = np.asarray(pipe.named_steps["clf"].coef_)[0]
        p = sorted(zip(uf, c * xs[0]), key=lambda kv: abs(kv[1]), reverse=True)[:5]
        return [{"feature": f, "contribution": round(float(v), 4), "direction": "UP" if v >= 0 else "DOWN"} for f, v in p]
    except Exception:
        return []


def predict_symbol(symbol: str, df: pd.DataFrame, pdte: pd.Timestamp) -> Optional[Dict[str, Any]]:
    feats = fcols(df); row = df[df["date"] == pdte]
    if len(feats) < 6 or row.empty: return None
    t = {"up2": "label_up_2d", "up5": "label_up_5d", "up10": "label_up_10d", "d3": "label_mdd_le_3_5d", "d5": "label_mdd_le_5_5d", "vh": "label_vol_high_5d"}
    r = {k: train_target(df, feats, c, pdte) for k, c in t.items()}
    up2, up5, up10, d3, d5, vh = [float(r[k]["prob"]) for k in ["up2", "up5", "up10", "d3", "d5", "vh"]]
    return {
        "symbol": symbol, "date": pdte.strftime("%Y-%m-%d"),
        "preds": {"pred_up_2d": up2, "pred_up_5d": up5, "pred_up_10d": up10, "label_2d": dlab(up2), "label_5d": dlab(up5), "label_10d": dlab(up10), "confidence_label": clab(up5, r["up5"]["recent"])},
        "tail": {"prob_mdd_le_3_5d": d3, "prob_mdd_le_5_5d": d5, "prob_vol_high_5d": vh},
        "drivers": drivers(r["up5"]["model"], r["up5"]["ufeat"], row[r["up5"]["ufeat"]] if r["up5"]["ufeat"] else pd.DataFrame()),
        "recent_metrics": {"up_2d": r["up2"]["recent"], "up_5d": r["up5"]["recent"], "up_10d": r["up10"]["recent"], "mdd_le_3_5d": r["d3"]["recent"], "mdd_le_5_5d": r["d5"]["recent"], "vol_high_5d": r["vh"]["recent"]},
        "cv_metrics": {"up_2d": r["up2"]["cv"], "up_5d": r["up5"]["cv"], "up_10d": r["up10"]["cv"], "mdd_le_3_5d": r["d3"]["cv"], "mdd_le_5_5d": r["d5"]["cv"], "vol_high_5d": r["vh"]["cv"]},
    }


def action(spy: Dict[str, Any], qqq: Dict[str, Any]) -> Dict[str, Any]:
    u5 = np.mean([spy["preds"]["pred_up_5d"], qqq["preds"]["pred_up_5d"]]); u10 = np.mean([spy["preds"]["pred_up_10d"], qqq["preds"]["pred_up_10d"]])
    t5 = np.mean([spy["tail"]["prob_mdd_le_5_5d"], qqq["tail"]["prob_mdd_le_5_5d"]]); vh = np.mean([spy["tail"]["prob_vol_high_5d"], qqq["tail"]["prob_vol_high_5d"]])
    rs = [f"5일 상승확률 평균 {u5*100:.1f}%", f"10일 상승확률 평균 {u10*100:.1f}%", f"5일 -5% 낙폭위험 평균 {t5*100:.1f}%", f"고변동성 확률 평균 {vh*100:.1f}%"]
    if t5 >= 0.45 or vh >= 0.55 or u5 <= 0.45: return {"mode": "DEFENSIVE", "text_ko": "하방 리스크가 높아 방어적 운영이 유리합니다.\n신규 진입은 축소하고 현금/헷지 비중을 유지하세요.", "reasons": rs}
    if u5 >= 0.58 and u10 >= 0.56 and t5 < 0.35: return {"mode": "OFFENSIVE", "text_ko": "상승 우위가 확인되어 공격적 비중 확대가 가능합니다.\n추세 종목 중심으로 분할 매수를 고려하세요.", "reasons": rs}
    return {"mode": "NEUTRAL", "text_ko": "방향 우위가 뚜렷하지 않아 중립적 운영이 적절합니다.\n선별 진입과 분할 대응을 유지하세요.", "reasons": rs}


def upsert(conn: sqlite3.Connection, s: Dict[str, Any], a: Dict[str, Any], ts: str) -> None:
    p, t = s["preds"], s["tail"]
    rows = [(2, p["pred_up_2d"], None, None, None), (5, p["pred_up_5d"], t["prob_mdd_le_3_5d"], t["prob_mdd_le_5_5d"], t["prob_vol_high_5d"]), (10, p["pred_up_10d"], None, None, None)]
    for h, up, d3, d5, vh in rows:
        conn.execute(
            """
            INSERT OR REPLACE INTO ml_predictions_daily (
              date, symbol, horizon_days, up_prob, down3_prob, down5_prob, vol_high_prob,
              pred_up_2d, pred_up_5d, pred_up_10d, prob_mdd_le_3_5d, prob_mdd_le_5_5d,
              confidence_label, model_version, top_features_json, metrics_json, recent_metrics_json,
              action_mode, action_text_ko, action_reasons_json, generated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                s["date"], s["symbol"], h, float(up) if up is not None else None, float(d3) if d3 is not None else None, float(d5) if d5 is not None else None, float(vh) if vh is not None else None,
                float(p["pred_up_2d"]), float(p["pred_up_5d"]), float(p["pred_up_10d"]), float(t["prob_mdd_le_3_5d"]), float(t["prob_mdd_le_5_5d"]),
                p["confidence_label"], MODEL_VERSION, json.dumps({"label_up_5d": s["drivers"]}, ensure_ascii=False),
                json.dumps({"cv": s["cv_metrics"], "recent": s["recent_metrics"]}, ensure_ascii=False),
                json.dumps(s["recent_metrics"], ensure_ascii=False), a["mode"], a["text_ko"], json.dumps(a["reasons"], ensure_ascii=False), ts
            ),
        )


def upd_snap(conn: sqlite3.Connection, d: str, spy_u5: float, qqq_u5: float) -> None:
    cols = tc(conn, "daily_snapshots")
    if "ml_spy_prob" in cols and "ml_qqq_prob" in cols:
        conn.execute("UPDATE daily_snapshots SET ml_spy_prob=?, ml_qqq_prob=? WHERE date=?", (float(spy_u5), float(qqq_u5), d))


def recent_strip(spy: Dict[str, Any], qqq: Dict[str, Any]) -> Dict[str, Any]:
    def one(x: Dict[str, Any]) -> Dict[str, Any]:
        m = x["recent_metrics"]
        return {"direction_hit_rate_60d": {"2d": m["up_2d"]["acc_60d"], "5d": m["up_5d"]["acc_60d"], "10d": m["up_10d"]["acc_60d"]}, "direction_hit_rate_20d": {"2d": m["up_2d"]["acc_20d"], "5d": m["up_5d"]["acc_20d"], "10d": m["up_10d"]["acc_20d"]}, "tail_risk_5d": {"threshold": m["mdd_le_5_5d"]["tail_signal_threshold"], "signal_count_60d": m["mdd_le_5_5d"]["tail_signal_count_60d"], "hit_rate_60d": m["mdd_le_5_5d"]["tail_signal_hit_rate_60d"]}}
    sp, qq = one(spy), one(qqq)
    def av(a, b): 
        v = [x for x in [a, b] if x is not None]
        return round(float(np.mean(v)), 4) if v else None
    return {"window_days": RECENT_WIN, "symbols": {"SPY": sp, "QQQ": qq}, "overall": {"direction_hit_rate_60d": {"2d": av(sp["direction_hit_rate_60d"]["2d"], qq["direction_hit_rate_60d"]["2d"]), "5d": av(sp["direction_hit_rate_60d"]["5d"], qq["direction_hit_rate_60d"]["5d"]), "10d": av(sp["direction_hit_rate_60d"]["10d"], qq["direction_hit_rate_60d"]["10d"])}}}


def cache_obj(date: str, spy: Dict[str, Any], qqq: Dict[str, Any], a: Dict[str, Any]) -> Dict[str, Any]:
    return {"date": date, "spy": {"preds": spy["preds"], "tail": spy["tail"], "metrics": spy["recent_metrics"], "drivers": spy["drivers"][:5]}, "qqq": {"preds": qqq["preds"], "tail": qqq["tail"], "metrics": qqq["recent_metrics"], "drivers": qqq["drivers"][:5]}, "recent_strip": recent_strip(spy, qqq), "action": a, "data_version": DATA_VERSION, "generated_at": now(), "rerun_hint": "python backend/scripts/build_ml_prediction.py"}


def run(req_date: Optional[str]) -> int:
    path = db_path()
    if not os.path.exists(path):
        print(f"[ERROR] DB not found: {path}"); return 1
    conn = sqlite3.connect(path)
    try:
        ensure_table(conn); md = lmd(conn)
        if md.empty:
            print("[ERROR] market_daily empty"); return 1
        ds = lds(conn); out: Dict[str, Dict[str, Any]] = {}
        for s in SYMBOLS:
            f = frame(s, md, lid(conn, s), ds); pdte = pred_date(f, req_date)
            if pdte is None: continue
            r = predict_symbol(s, f, pdte)
            if r is not None:
                out[s] = r
                print(f"[OK] {s} {r['date']} up2={r['preds']['pred_up_2d']:.3f} up5={r['preds']['pred_up_5d']:.3f} up10={r['preds']['pred_up_10d']:.3f} mdd5={r['tail']['prob_mdd_le_5_5d']:.3f}")
        if "SPY" not in out or "QQQ" not in out:
            print("[ERROR] both SPY/QQQ required"); return 1
        spy, qqq = out["SPY"], out["QQQ"]; a = action(spy, qqq); ts = now()
        upsert(conn, spy, a, ts); upsert(conn, qqq, a, ts); upd_snap(conn, spy["date"], spy["preds"]["pred_up_5d"], qqq["preds"]["pred_up_5d"]); conn.commit()
        c = cache_obj(spy["date"], spy, qqq, a)
        for p in cp():
            os.makedirs(os.path.dirname(p), exist_ok=True); write_json(p, c); print(f"[OK] {p}")
        print("[VERIFY_SQL] SELECT COUNT(*) FROM ml_predictions_daily;")
        print("[VERIFY_SQL] SELECT date,symbol,horizon_days,pred_up_2d,pred_up_5d,pred_up_10d,prob_mdd_le_3_5d,prob_mdd_le_5_5d,confidence_label FROM ml_predictions_daily ORDER BY date DESC,symbol,horizon_days;")
        sample = {"date": c["date"], "spy": {"preds": c["spy"]["preds"], "tail": c["spy"]["tail"], "drivers": c["spy"]["drivers"][:3]}, "action": c["action"], "data_version": c["data_version"]}
        print("[SAMPLE_JSON]"); print(json.dumps(sample, ensure_ascii=False, indent=2)[:1200])
        return 0
    except Exception as e:
        print(f"[FATAL] build_ml_prediction failed: {type(e).__name__}: {e}"); print(traceback.format_exc()); return 1
    finally:
        conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", type=str, default=None)
    args = ap.parse_args()
    raise SystemExit(run(args.date))
