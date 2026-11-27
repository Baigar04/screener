#!/usr/bin/env python3
"""Probabilidad de acierto (hoja de ruta definitiva, fase 5) → data/prob.json y campos «prob» en universe.json.

Pregunta: ¿qué probabilidad hay de que el valor bata a su propio índice, con dividendos, en los próximos 12 meses?

Diseño decidido ANTES de examinarlo (27-nov-2026); no se retoca después de ver el examen:
  · Datos: precios semanales de Yahoo con dividendos desde 2007 (los mismos que los stress tests). Índice de referencia con
    dividendos: un ETF que lo replica (SPY, QQQ, EXW1, ISF, 1321, 2800, EEM, 0050, 069500…) o el índice si es de rentabilidad
    total (DAX). Si no hay ETF, el índice de precios y se avisa.
  · Muestras: cada fin de mes, cada valor con ≥ 2 años de historia y un mercado con ≥ 20 valores ese mes.
  · Objetivo: 1 si la rentabilidad del valor a 12 meses supera la de su índice (las dos con dividendos, en moneda local).
  · Factores (todos con datos de esa fecha): momento 12-1 frente al índice, último mes frente al índice (reversión),
    volatilidad de 1 año, beta de 3 años, distancia al máximo de 52 semanas, distancia a la media de 40 semanas;
    del mercado: tendencia (índice frente a su media de 40 semanas) y volatilidad de 26 semanas del índice.
    Los seis primeros se pasan a rango dentro de su mercado y mes (−0,5 a +0,5); los dos de mercado, estandarizados.
  · Modelo: una regresión logística común con constante por mercado y penalización L2 = 10.
  · Examen único: modelo reajustado cada enero desde 2016 solo con muestras cuyo resultado ya se conocía (embargo de 12 meses);
    previsiones de 2016 en adelante. Referencia: la tasa base de su mercado con los mismos datos. Validado por mercado si
    mejora el Brier en ≥ 3 % y la calibración (ECE) es < 10 pp con ≥ 60 meses. Si no: «sin ventaja demostrada».
  · Hoy: modelo con todas las muestras con resultado; intervalo del 90 % remuestreando años completos (40 veces).
Sesgo conocido: el universo es el de hoy (empresas que siguen en los índices), así que el pasado tiene sesgo de
supervivencia; la tasa base histórica sale algo más alta de lo real. Se dice en la web.
"""
import json
import math
import os
import pickle
import sys
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_risk import MERCADOS, log  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
NOW = datetime.now(timezone.utc)
ERRORS = []
EXAMEN = 2016
L2 = 10.0
MIN_SKILL, MAX_ECE, MIN_MESES = 3.0, 10.0, 60
MIN_POR_MES = 20
FACTORES = [("mom", "Momento 12-1 frente al índice"), ("rev", "Último mes frente al índice"), ("vol", "Volatilidad de 1 año"),
            ("beta", "Beta de 3 años"), ("dd", "Distancia al máximo de 52 semanas"), ("tend", "Distancia a la media de 40 semanas"),
            ("mtend", "Tendencia de su mercado"), ("mvol", "Volatilidad de su mercado")]
RANGO = ["mom", "rev", "vol", "beta", "dd", "tend"]
# índice de referencia con dividendos: candidatos por orden (el primero con ≥ 10 años de historia); tr = rentabilidad total
BENCH = {"sp500": [("SPY", True)], "ndx": [("QQQ", True)], "sx5e": [("EXW1.DE", True), ("^STOXX50E", False)],
         "dax": [("^GDAXI", True)], "cac": [("CAC.PA", True), ("^FCHI", False)], "ibex": [("BBVAI.MC", True), ("^IBEX", False)],
         "ftse": [("ISF.L", True), ("^FTSE", False)], "mib": [("IMIB.MI", True), ("FTSEMIB.MI", False)],
         "n225": [("1321.T", True), ("^N225", False)], "hsi": [("2800.HK", True), ("^HSI", False)], "eem": [("EEM", True)],
         "tw": [("0050.TW", True), ("^TWII", False)], "kr": [("069500.KS", True), ("^KS11", False)]}
NOMBRE = {k: n for k, n, _, _ in MERCADOS} | {"tw": "Taiwán (TAIEX)", "kr": "Corea (KOSPI 200)"}


def mercado_prob(r):
    from fetch_stress import mercado_de
    p = r.get("pais") or ""
    s = r.get("sym", "")
    if p == "Taiwan" or s.endswith((".TW", ".TWO")):
        return "tw"
    if p in ("South Korea", "Korea") or s.endswith((".KS", ".KQ")):
        return "kr"
    if s.endswith(".T"):
        return "n225"
    return mercado_de(r)


# ---------------------------------------------------------------- piezas puras (con tests)
def weekly_frame(W, syms):
    """DataFrame semanal (fecha de cierre del viernes × símbolo) con los cierres ajustados."""
    cols = {}
    for s in syms:
        if s in W and W[s]:
            # cada barra a su viernes: Yahoo fecha la semana por su primer día de sesión (martes si el lunes es festivo)
            d = pd.Series({t + timedelta(days=(4 - t.weekday()) % 7): v for t, v in W[s]})
            cols[s] = d[~d.index.duplicated(keep="last")]
    df = pd.DataFrame(cols).sort_index()
    df.index = pd.to_datetime(df.index)
    return df


def clean_jumps(P, lim=1.2):
    """Precios con saltos imposibles en una semana (|Δlog| > lim): se anula la historia anterior al salto."""
    lr = np.log(P).diff()
    bad = lr.abs() > lim
    for s in P.columns[bad.any().values]:
        pos = int(np.flatnonzero(bad[s].values)[-1])
        P.iloc[:pos, P.columns.get_loc(s)] = np.nan
    return P


def month_ends(idx):
    """Posiciones de la última semana de cada mes."""
    m = pd.Series(range(len(idx)), index=idx).groupby([idx.year, idx.month]).last()
    return m.values, [f"{y:04d}-{mm:02d}" for y, mm in m.index]


def features(P, B, mk_of):
    """Factores por semana (DataFrames semana × símbolo). P: cierres de los valores; B: cierres de cada índice (columna = mercado)."""
    lp = np.log(P)
    lr = lp.diff()
    bench = pd.DataFrame({s: B[mk_of[s]] for s in P.columns if mk_of.get(s) in B}, index=P.index)
    lb = np.log(bench)
    lbr = lb.diff()
    F = {}
    F["mom"] = (lp.shift(4) - lp.shift(52)) - (lb.shift(4) - lb.shift(52))
    F["rev"] = (lp - lp.shift(4)) - (lb - lb.shift(4))
    F["vol"] = lr.rolling(52, min_periods=40).std() * math.sqrt(52)
    mx, my = lr.rolling(156, min_periods=104).mean(), lbr.rolling(156, min_periods=104).mean()
    cov = (lr * lbr).rolling(156, min_periods=104).mean() - mx * my
    var = (lbr ** 2).rolling(156, min_periods=104).mean() - my ** 2
    F["beta"] = cov / var
    F["dd"] = P / P.rolling(52, min_periods=40).max() - 1
    F["tend"] = P / P.rolling(40, min_periods=30).mean() - 1
    F["mtend"] = bench / bench.rolling(40, min_periods=30).mean() - 1
    F["mvol"] = lbr.rolling(26, min_periods=20).std() * math.sqrt(52)
    y12 = (lp.shift(-52) - lp) - (lb.shift(-52) - lb)
    return F, y12


def rank_within(df_vals, groups):
    """Rango (−0,5 a +0,5) dentro de cada grupo; NaN se queda en NaN."""
    out = np.full(len(df_vals), np.nan)
    s = pd.Series(df_vals)
    g = pd.Series(groups)
    ok = s.notna()
    r = s[ok].groupby(g[ok]).rank(pct=True)
    n = s[ok].groupby(g[ok]).transform("count")
    out[ok.values] = ((r - 0.5 / n) - 0.5).values
    return out


def logit_fit(X, y, l2=L2, w=None, iters=25):
    """Logística con L2 (sin penalizar la constante por mercado: las primeras k columnas son dummies). IRLS."""
    n, k = X.shape
    b = np.zeros(k)
    w = np.ones(n) if w is None else w
    pen = np.full(k, l2)
    pen[: X.shape[1] - len(FACTORES)] = 0.0
    for _ in range(iters):
        z = X @ b
        p = 1 / (1 + np.exp(-np.clip(z, -30, 30)))
        g = X.T @ (w * (y - p)) - pen * b
        Hm = (X * (w * p * (1 - p))[:, None]).T @ X + np.diag(pen) + 1e-9 * np.eye(k)
        step = np.linalg.solve(Hm, g)
        b += step
        if np.abs(step).max() < 1e-7:
            break
    return b


def predict(X, b):
    return 1 / (1 + np.exp(-np.clip(X @ b, -30, 30)))


def brier(p, y):
    return float(np.mean((p - y) ** 2))


def ece(p, y, bins=10):
    edges = np.quantile(p, np.linspace(0, 1, bins + 1))
    idx = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, bins - 1)
    e = 0.0
    for b in range(bins):
        m = idx == b
        if m.any():
            e += m.mean() * abs(p[m].mean() - y[m].mean())
    return e * 100


def auc(p, y):
    o = np.argsort(p)
    r = np.empty(len(p))
    r[o] = np.arange(1, len(p) + 1)
    n1 = y.sum()
    n0 = len(y) - n1
    return float((r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)) if n1 and n0 else None


# ---------------------------------------------------------------- datos
def load_weekly(tickers):
    W = {}
    try:
        W = pickle.load(open(os.environ.get("SEMANAL", "/tmp/screener_semanal.pkl"), "rb"))
        log(f"Precios semanales reutilizados de los stress tests: {len(W)}")
    except Exception:  # noqa: BLE001
        log("Sin copia semanal: se descargan")
    miss = [t for t in tickers if t not in W]
    if miss:
        from fetch_stress import weekly
        W.update(weekly(miss))
    return W


def build(W, U):
    """Tabla de muestras mensuales con factores, objetivo y exceso de rentabilidad."""
    mk_of, bench_t, bench_info = {}, {}, {}
    for k, cands in BENCH.items():
        for t, tr in cands:
            s = W.get(t)
            if s and (s[-1][0] - s[0][0]).days > 3650:
                bench_t[k] = t
                bench_info[k] = {"ticker": t, "dividendos": tr}
                break
        if k not in bench_t:
            ERRORS.append({"fuente": "Yahoo Finance", "serie": f"índice de {k}", "motivo": "sin historia suficiente"})
    for r in U:
        mk = mercado_prob(r)
        if mk in bench_t:
            mk_of[r["sym"]] = mk
    syms = [s for s in mk_of if s in W]
    P = clean_jumps(weekly_frame(W, syms))
    Bw = weekly_frame(W, list(set(bench_t.values())))
    Bw = Bw.reindex(P.index).ffill(limit=2)
    B = pd.DataFrame({k: Bw[t] for k, t in bench_t.items()}, index=P.index)
    F, y12 = features(P, B, mk_of)
    pos, months = month_ends(P.index)
    rows = []
    for t, m in zip(pos, months):
        vals = {k: F[k].iloc[t] for k in F}
        df = pd.DataFrame(vals)
        df["y12"] = y12.iloc[t]
        df["sym"] = df.index
        df["mes"] = m
        df["mk"] = df["sym"].map(mk_of)
        rows.append(df)
    D = pd.concat(rows, ignore_index=True)
    D = D.dropna(subset=[k for k, _ in FACTORES])
    cnt = D.groupby(["mes", "mk"])["sym"].transform("count")
    D = D[cnt >= MIN_POR_MES].copy()
    grp = D["mes"] + "|" + D["mk"]
    for k in RANGO:
        D[k] = rank_within(D[k].values, grp.values)
    D["y"] = (D["y12"] > 0).astype(float)
    D.loc[D["y12"].isna(), "y"] = np.nan
    return D, bench_info, P.index[-1].date()


def design(D, mks, mu=None, sd=None):
    dm = np.column_stack([(D["mk"].values == k).astype(float) for k in mks])
    Z = D[[k for k, _ in FACTORES]].values.astype(float).copy()
    if mu is None:
        mu, sd = np.zeros(Z.shape[1]), np.ones(Z.shape[1])
        for j, (k, _) in enumerate(FACTORES):
            if k not in RANGO:
                mu[j], sd[j] = np.nanmean(Z[:, j]), np.nanstd(Z[:, j]) or 1.0
    Z = (Z - mu) / sd
    return np.column_stack([dm, Z]), mu, sd


# ---------------------------------------------------------------- examen y previsión
def examen(D, mks):
    L = D[D["y"].notna()].copy()
    years = sorted({int(m[:4]) for m in L["mes"]})
    out = []
    for Y in [y for y in years if y >= EXAMEN]:
        cut = f"{Y - 1:04d}-12"   # se conoce el resultado de las muestras hasta 12 meses antes del ajuste
        lim = (pd.Period(cut, "M") - 12).strftime("%Y-%m")
        tr = L[L["mes"] <= lim]
        te = L[(L["mes"] >= f"{Y:04d}-01") & (L["mes"] <= f"{Y:04d}-12")]
        if len(tr) < 5000 or te.empty:
            continue
        X, mu, sd = design(tr, mks)
        b = logit_fit(X, tr["y"].values)
        Xt, _, _ = design(te, mks, mu, sd)
        base = tr.groupby("mk")["y"].mean()
        out.append(pd.DataFrame({"mes": te["mes"].values, "mk": te["mk"].values, "p": predict(Xt, b),
                                 "base": te["mk"].map(base).fillna(tr["y"].mean()).values, "y": te["y"].values, "y12": te["y12"].values}))
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


def resumen_mercado(E):
    p, y, base = E["p"].values, E["y"].values, E["base"].values
    bm, bb = brier(p, y), brier(base, y)
    skill = (1 - bm / bb) * 100 if bb else 0.0
    e = ece(p, y)
    meses = E["mes"].nunique()
    ok = bool(skill >= MIN_SKILL and e < MAX_ECE and meses >= MIN_MESES)
    q = np.quantile(p, np.linspace(0, 1, 11))
    idx = np.clip(np.searchsorted(q, p, side="right") - 1, 0, 9)
    dec = []
    for d in range(10):
        m = idx == d
        if not m.any():
            continue
        ex = (np.exp(E["y12"].values[m]) - 1) * 100
        dec.append({"p_de": round(float(q[d]) * 100, 1), "p_a": round(float(q[d + 1]) * 100, 1), "p_media": round(float(p[m].mean()) * 100, 1),
                    "acierto": round(float(y[m].mean()) * 100, 1), "n": int(m.sum()),
                    "exceso": [round(float(np.percentile(ex, k)), 1) for k in (10, 25, 50, 75, 90)]})
    return {"skill": round(skill, 1), "ece": round(e, 1), "auc": round(auc(p, y), 3) if auc(p, y) else None, "meses": int(meses), "n": int(len(E)),
            "brier": round(bm, 4), "brier_base": round(bb, 4), "acierto_base": round(float(y.mean()) * 100, 1), "validado": ok,
            "desde": E["mes"].min(), "hasta": E["mes"].max(), "deciles": dec}


def main():
    try:
        U = json.load(open(os.path.join(DATA, "universe.json")))["filas"]
    except (OSError, ValueError, KeyError):
        log("prob: sin universe.json")
        return
    tick = sorted({r["sym"] for r in U} | {t for c in BENCH.values() for t, _ in c})
    W = load_weekly(tick)
    D, binfo, last_week = build(W, U)
    mks = sorted(D["mk"].unique())
    if D.empty or D["y"].notna().sum() < 5000:
        ERRORS.append({"fuente": "cálculo", "serie": "muestras", "motivo": f"solo {len(D)} muestras"})
        log(f"prob: muestras insuficientes ({len(D)}); no se escribe prob.json")
        return
    log(f"Muestras: {len(D):,} · con resultado {int(D['y'].notna().sum()):,} · mercados {mks} · última semana {last_week}")
    E = examen(D, mks)
    MK = {}
    for k in mks:
        Ek = E[E["mk"] == k] if not E.empty else E
        if Ek.empty:
            continue
        MK[k] = {"nombre": NOMBRE.get(k, k), "indice": binfo.get(k), "examen": resumen_mercado(Ek)}
        x = MK[k]["examen"]
        log(f"  {MK[k]['nombre']:22s} examen {x['desde']}–{x['hasta']}: mejora {x['skill']:+.1f} % · ECE {x['ece']:.1f} pp · AUC {x['auc']} · "
            f"{x['meses']} meses · acierto base {x['acierto_base']} % · {'VALIDADO' if x['validado'] else 'sin ventaja'}")
    if not E.empty:
        tot = resumen_mercado(E)
        log(f"  TODOS: mejora {tot['skill']:+.1f} % · ECE {tot['ece']:.1f} pp · AUC {tot['auc']}")
    # modelo de hoy
    L = D[D["y"].notna()]
    X, mu, sd = design(L, mks)
    b = logit_fit(X, L["y"].values)
    lastm = D["mes"].max()
    now = D[D["mes"] == lastm].copy()
    Xn, _, _ = design(now, mks, mu, sd)
    p = predict(Xn, b)
    rng = np.random.default_rng(7)
    yrs = np.array(sorted({m[:4] for m in L["mes"]}))
    ly = L["mes"].str[:4].values
    boots = []
    for _ in range(40):
        pick = rng.choice(yrs, len(yrs), replace=True)
        cnt = pd.Series(pick).value_counts()
        w = pd.Series(ly).map(cnt).fillna(0).values
        bb = logit_fit(X, L["y"].values, w=w)
        boots.append(predict(Xn, bb))
    Bt = np.array(boots)
    lo, hi = np.percentile(Bt, 5, axis=0), np.percentile(Bt, 95, axis=0)
    nm = len(mks)
    contrib = []
    for j in range(len(FACTORES)):
        X0 = Xn.copy()
        X0[:, nm + j] = 0.0
        contrib.append((p - predict(X0, b)) * 100)
    contrib = np.array(contrib).T
    base_now = L.groupby("mk")["y"].mean()
    V = {}
    for i, (s, k) in enumerate(zip(now["sym"].values, now["mk"].values)):
        dec = MK.get(k, {}).get("examen", {}).get("deciles") or []
        d = next((j for j, x in enumerate(dec) if p[i] * 100 <= x["p_a"]), len(dec) - 1) if dec else None
        V[s] = [round(float(p[i]) * 100, 1), round(float(lo[i]) * 100, 1), round(float(hi[i]) * 100, 1), [round(float(c), 1) for c in contrib[i]], d, k]
    for k in MK:
        bv = base_now.get(k)
        MK[k]["base_hoy"] = round(float(bv) * 100, 1) if bv is not None and bv == bv else None
    coef = {f: round(float(b[nm + j]), 3) for j, (f, _) in enumerate(FACTORES)}
    log(f"Hoy ({lastm}): {len(V)} valores · coeficientes {coef}")
    out = {"generado": NOW.isoformat(timespec="seconds"), "errores": ERRORS, "mes": lastm, "semana": last_week.isoformat(),
           "factores": [{"k": k, "nombre": n} for k, n in FACTORES], "coef": coef,
           "criterio": {"examen_desde": EXAMEN, "mejora_min": MIN_SKILL, "ece_max": MAX_ECE, "meses_min": MIN_MESES},
           "metodo": __doc__.split("Diseño decidido")[1].strip() if "Diseño decidido" in __doc__ else "",
           "mercados": MK, "valores": V}
    with open(os.path.join(DATA, "prob.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    # campos para el screener y «Hoy»
    path = os.path.join(DATA, "universe.json")
    Ufull = json.load(open(path))
    for r in Ufull["filas"]:
        v = V.get(r["sym"])
        r["prob"] = v[0] if v else None
        r["prob_ok"] = bool(v and MK.get(v[5], {}).get("examen", {}).get("validado"))
    json.dump(Ufull, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    log(f"prob.json escrito · {len(MK)} mercados · {sum(1 for x in MK.values() if x['examen']['validado'])} validados · {len(V)} valores · {len(ERRORS)} errores")


if __name__ == "__main__":
    main()
