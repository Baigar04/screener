"""Laboratorio de la puntuación: ¿predicen los factores la rentabilidad del mes siguiente?

Prueba mensual sobre ~5 años de precios del universo actual:
  · IC (coeficiente de información): correlación de rangos (Spearman) entre el factor a fin de mes
    y la rentabilidad del mes siguiente. Por encima de 0,03 de media y estable, el factor aporta.
  · Quintiles: rentabilidad mensual de cada quinto del universo frente a la media (Q5 = mejor nota).
  · Cartera Q5 − Q1: rentabilidad anual y Sharpe de comprar el mejor quinto y vender el peor.
  · Pesos sugeridos según el IC, comprobados fuera de muestra (primera mitad → segunda mitad).

Fiabilidad:
  · Momentum y técnicos: completa (solo usa precios conocidos en cada fecha).
  · Calidad, valor y crecimiento: aproximada. Se usan las cuentas anuales de Yahoo (4-5 ejercicios)
    suponiendo que cada ejercicio se conoce el 1 de abril del año siguiente, y la capitalización
    se reconstruye con el precio (acciones constantes). Cobertura más corta.
  · Todo: sesgo de supervivencia (solo valores que hoy siguen en los índices).
  · Smart money y encaje macro: no evaluables (no hay historial fechado gratuito).
"""
import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
H = 21                      # sesiones hasta el siguiente rebalanceo (≈ 1 mes)
MIN_N = 40                  # valores mínimos con dato para contar un mes
FACT = [
    # clave, nombre, categoría, fiabilidad, explicación
    ("r3", "Rentabilidad 3 meses", "momentum", "completa", "Subida de los últimos 3 meses."),
    ("r6", "Rentabilidad 6 meses", "momentum", "completa", "Subida de los últimos 6 meses."),
    ("tr", "Distancia a la media de 200", "momentum", "completa", "Precio frente a su media de 200 sesiones (tendencia)."),
    ("m12", "Momentum 12-1", "extra", "completa", "Subida de 12 meses sin el último: el momentum clásico de la literatura académica. No está en la puntuación."),
    ("lv", "Baja volatilidad", "extra", "completa", "Menor volatilidad de 3 meses = mejor nota. No está en la puntuación."),
    ("rv", "Reversión 1 mes", "extra", "completa", "Lo que más cayó el último mes = mejor nota. No está en la puntuación."),
    ("roe", "ROE", "calidad", "aproximada", "Beneficio neto entre patrimonio del último ejercicio publicado."),
    ("mg", "Margen EBITDA", "calidad", "aproximada", "EBITDA entre ventas (sustituye al margen operativo, que no tiene historial)."),
    ("dp", "Deuda / patrimonio (menor)", "calidad", "aproximada", "Menos apalancamiento = mejor nota."),
    ("ep", "Rentabilidad por beneficio (E/P)", "valor", "aproximada", "Inverso del PER: más alto = más barato."),
    ("bp", "Valor contable / precio", "valor", "aproximada", "Inverso del P/VC."),
    ("fy", "Rentabilidad por flujo de caja libre", "valor", "aproximada", "Flujo de caja libre entre capitalización. No está en la puntuación."),
    ("cv", "Crecimiento de ventas", "crecimiento", "aproximada", "Ventas del último ejercicio frente al anterior."),
    ("cb", "Crecimiento del beneficio", "crecimiento", "aproximada", "Beneficio neto del último ejercicio frente al anterior (si el anterior fue positivo)."),
]
CATS = {"calidad": ["roe", "mg", "dp"], "valor": ["ep", "bp"], "crecimiento": ["cv", "cb"], "momentum": ["r3", "r6", "tr"]}
CAT_NAME = {"calidad": "Calidad", "valor": "Valor", "crecimiento": "Crecimiento", "momentum": "Momentum"}
SECTOR_WISE = {"roe", "mg", "dp", "ep", "bp", "fy", "cv", "cb"}


def _f(x):
    try:
        x = float(x)
        return x if np.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def fundamentals_at(anual, d):
    """Último ejercicio publicado a fecha d (se supone conocido el 1 de abril del año siguiente) y el anterior."""
    ys = sorted(int(y) for y in anual if y.isdigit() and pd.Timestamp(int(y) + 1, 4, 1) <= d)
    if not ys:
        return None, None
    y = ys[-1]
    return anual.get(str(y)), anual.get(str(y - 1))


def pct_rank(s, groups=None):
    if groups is None:
        return s.rank(pct=True) * 100
    out = s.groupby(groups).rank(pct=True) * 100
    n = s.groupby(groups).transform("count")
    glob = s.rank(pct=True) * 100
    return out.where(n >= 8, glob)


def stats(sig, fwd):
    """sig, fwd: DataFrames (fechas × valores). Devuelve IC, quintiles y cartera Q5−Q1."""
    ics, qs, ls, dates = [], [], [], []
    for d in sig.index:
        x, y = sig.loc[d], fwd.loc[d]
        m = x.notna() & y.notna()
        if m.sum() < MIN_N:
            continue
        x, y = x[m], y[m]
        ics.append(x.rank().corr(y.rank()))
        q = pd.qcut(x.rank(method="first"), 5, labels=False)
        g = y.groupby(q).mean() - y.mean()
        qs.append(g.reindex(range(5)).values)
        ls.append(g.get(4, np.nan) - g.get(0, np.nan))
        dates.append(d)
    if len(ics) < 6:
        return None
    ic = np.array(ics)
    ls = np.array(ls)
    q = np.nanmean(np.array(qs), axis=0)
    cum = np.cumsum(np.nan_to_num(ls)) * 100
    return {
        "meses": len(ic), "ic": round(float(ic.mean()), 4), "ic_t": round(float(ic.mean() / ic.std(ddof=1) * np.sqrt(len(ic))), 2) if ic.std(ddof=1) > 0 else None,
        "ic_pos": round(float((ic > 0).mean() * 100), 1),
        "q": [round(float(v) * 100, 3) for v in q],
        "ls_anual": round(float(np.nanmean(ls) * 12 * 100), 2),
        "ls_sharpe": round(float(np.nanmean(ls) / np.nanstd(ls, ddof=1) * np.sqrt(12)), 2) if np.nanstd(ls, ddof=1) > 0 else None,
        "curva": [[d.strftime("%Y-%m-%d"), round(float(c), 2)] for d, c in zip(dates, cum)],
        "ic_serie": [[d.strftime("%Y-%m-%d"), round(float(v), 3)] for d, v in zip(dates, ic)],
        "desde": dates[0].strftime("%Y-%m-%d"), "hasta": dates[-1].strftime("%Y-%m-%d"),
    }


def composite(cat_sig, w):
    num = sum(cat_sig[k].fillna(0) * w[k] for k in w if w[k])
    den = sum(cat_sig[k].notna().astype(float) * w[k] for k in w if w[k])
    return (num / den.replace(0, np.nan))


def suggest(ic_by_cat, base, t_by_cat=None):
    """Pesos según la evidencia, sin perseguir ruido:
    · Confianza de cada factor = t − 1 acotada a [0, 1] (t ≤ 1 no cuenta; t ≥ 2 cuenta entera).
    · La parte «por evidencia» reparte el total entre los factores con IC positivo, en proporción a IC × confianza.
    · Se mezcla con los pesos actuales con un peso de 0,5 × la mayor confianza: con evidencia débil, casi no cambia nada.
    · Un factor que resta con claridad (t ≤ −2) pierde la mitad de su peso, que se reparte entre los demás.
    · Máximo de 40 por factor."""
    t_by_cat = t_by_cat or {}
    tot = sum(base[k] for k in ic_by_cat)
    conf = {k: min(1, max((t_by_cat.get(k) or 0) - 1, 0)) for k in ic_by_cat}
    pos = {k: max(ic_by_cat[k] or 0, 0) * conf[k] for k in ic_by_cat}
    s = sum(pos.values())
    w = {k: float(base[k]) for k in ic_by_cat}
    if s:
        a = 0.5 * max(conf[k] for k in pos if pos[k] > 0)
        w = {k: (1 - a) * base[k] + a * pos[k] / s * tot for k in w}
    neg = [k for k in w if (ic_by_cat[k] or 0) < 0 and (t_by_cat.get(k) or 0) <= -2]
    if neg and len(neg) < len(w):
        cut = sum(w[k] / 2 for k in neg)
        for k in neg:
            w[k] /= 2
        rest = [k for k in w if k not in neg]
        rs = sum(w[k] for k in rest)
        for k in rest:
            w[k] += cut * w[k] / rs
    for _ in range(5):  # tope de 40 y reparto del exceso
        over = sum(v - 40 for v in w.values() if v > 40)
        if not over:
            break
        free = [k for k in w if w[k] < 40]
        for k in w:
            w[k] = min(w[k], 40)
        for k in free:
            w[k] += over / len(free)
    return {k: int(round(v)) for k, v in w.items()}


def run(frames, rows, cache, default_w):
    P = pd.DataFrame({s: f["Close"] for s, f in frames.items()}).sort_index().ffill(limit=5)
    P = P.loc[:, P.notna().sum() > 300]
    rets = P.pct_change(fill_method=None)
    sector = pd.Series({r["sym"]: r.get("sector") for r in rows}).reindex(P.columns)
    mcap_now = pd.Series({r["sym"]: _f(r.get("mcap")) for r in rows}).reindex(P.columns)
    last_px = P.ffill().iloc[-1]

    # fechas de rebalanceo: último día de cada mes con 12 meses de historia detrás y 1 mes por delante
    idx = P.index
    me = pd.Series(range(len(idx)), index=idx).groupby([idx.year, idx.month]).max().values
    me = [i for i in me if i >= 252 and i + H < len(idx)]
    D = idx[me]
    fwd = pd.DataFrame({d: P.iloc[i + H] / P.iloc[i] - 1 for d, i in zip(D, me)}).T
    fwd = fwd.clip(-0.9, 3)

    sma200 = P.rolling(200, min_periods=150).mean()
    vol63 = rets.rolling(63, min_periods=50).std()
    raw = {
        "r3": (P / P.shift(63) - 1).loc[D], "r6": (P / P.shift(126) - 1).loc[D], "tr": (P / sma200 - 1).loc[D],
        "m12": (P.shift(21) / P.shift(252) - 1).loc[D], "lv": -vol63.loc[D], "rv": -(P / P.shift(21) - 1).loc[D],
    }
    # fundamentales «a fecha»
    fund = {k: pd.DataFrame(index=D, columns=P.columns, dtype=float) for k in ("roe", "mg", "dp", "ep", "bp", "fy", "cv", "cb")}
    for s in P.columns:
        an = (cache.get(s) or {}).get("anual") or {}
        if not an or not mcap_now.get(s):
            continue
        for d in D:
            cur, prev = fundamentals_at(an, d)
            if not cur:
                continue
            px = P.at[d, s]
            if not (px == px) or not last_px[s]:
                continue
            mc = mcap_now[s] * px / last_px[s]
            bn, eq, ve, eb, de, fc = (_f(cur.get(k)) for k in ("beneficio_neto", "patrimonio", "ventas", "ebitda", "deuda_total", "fcf"))
            if bn is not None and eq and eq > 0:
                fund["roe"].at[d, s] = bn / eq
            if eb is not None and ve and ve > 0:
                fund["mg"].at[d, s] = eb / ve
            if de is not None and eq and eq > 0:
                fund["dp"].at[d, s] = -de / eq
            if mc and mc > 0:
                if bn is not None:
                    fund["ep"].at[d, s] = bn / mc
                if eq is not None:
                    fund["bp"].at[d, s] = eq / mc
                if fc is not None:
                    fund["fy"].at[d, s] = fc / mc
            if prev:
                pv, pb = _f(prev.get("ventas")), _f(prev.get("beneficio_neto"))
                if ve is not None and pv and pv > 0:
                    fund["cv"].at[d, s] = ve / pv - 1
                if bn is not None and pb and pb > 0:
                    fund["cb"].at[d, s] = bn / pb - 1
    raw.update(fund)

    # percentiles por fecha: fundamentales dentro del sector, precio en todo el universo (como la puntuación)
    sig = {}
    for k, df in raw.items():
        sig[k] = df.apply(lambda row: pct_rank(row, sector if k in SECTOR_WISE else None), axis=1)
    cat_sig = {}
    for c in CATS:  # media de subfactores disponibles (como la web)
        cat_sig[c] = sum(sig[k].fillna(0) for k in CATS[c]) / sum(sig[k].notna().astype(float) for k in CATS[c]).replace(0, np.nan)

    out_f = []
    for k, name, cat, fia, txt in FACT:
        st = stats(sig[k], fwd)
        if st:
            out_f.append({"k": k, "nombre": name, "categoria": cat, "fiabilidad": fia, "explica": txt, **st})
    out_c = []
    for c in CATS:
        st = stats(cat_sig[c], fwd)
        if st:
            out_c.append({"k": c, "nombre": CAT_NAME[c], "fiabilidad": "completa" if c == "momentum" else "aproximada", **st})
    ic_cat = {c["k"]: c["ic"] for c in out_c}
    t_cat = {c["k"]: c["ic_t"] for c in out_c}

    base = {k: default_w[k] for k in CATS}
    sug = suggest(ic_cat, base, t_cat)
    comp_now = stats(composite(cat_sig, base), fwd)
    comp_sug = stats(composite(cat_sig, sug), fwd)

    # fuera de muestra: pesos estimados con la primera mitad, medidos en la segunda
    oos = None
    half = D[len(D) // 2]
    first = {c: stats(cat_sig[c].loc[:half], fwd.loc[:half]) for c in CATS}
    if all(first.values()):
        w1 = suggest({c: first[c]["ic"] for c in CATS}, base, {c: first[c]["ic_t"] for c in CATS})
        a = stats(composite(cat_sig, base).loc[half:], fwd.loc[half:])
        b = stats(composite(cat_sig, w1).loc[half:], fwd.loc[half:])
        if a and b:
            oos = {"corte": half.strftime("%Y-%m-%d"), "pesos_primera_mitad": w1,
                   "actual": {k: a[k] for k in ("meses", "ic", "ic_t", "ls_anual", "ls_sharpe")},
                   "sugerido": {k: b[k] for k in ("meses", "ic", "ic_t", "ls_anual", "ls_sharpe")}}

    res = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "universo": int(P.shape[1]), "meses": len(D), "desde": D[0].strftime("%Y-%m-%d"), "hasta": D[-1].strftime("%Y-%m-%d"),
        "horizonte": "1 mes (21 sesiones), rebalanceo a fin de mes",
        "factores": out_f, "categorias": out_c,
        "compuesto": {"actual": comp_now, "sugerido": comp_sug},
        "pesos": {"actual": default_w, "sugerido": {**default_w, **sug}},
        "fuera_muestra": oos,
        "no_evaluables": [
            {"k": "smart", "nombre": "Smart money", "motivo": "Dataroma y las declaraciones del Congreso no ofrecen gratis un historial fechado de cuándo se conoció cada dato. Mantiene su peso, sin evidencia a favor ni en contra."},
            {"k": "macro", "nombre": "Encaje macro", "motivo": "El modelo de régimen no guarda historial de probabilidades; se podrá medir cuando acumule meses."},
        ],
        "sesgos": [
            "Supervivencia: solo entran los valores que hoy están en los índices; los que quebraron o salieron no cuentan. Infla algo los resultados, sobre todo de valor y reversión.",
            "Fundamentales aproximados: cuentas anuales de Yahoo (4-5 ejercicios), supuestas conocidas el 1 de abril del año siguiente; la capitalización pasada se reconstruye con el precio. Cobertura más corta que la de precios.",
            "Sin costes de transacción ni impuestos. La cartera Q5 − Q1 es teórica (incluye posiciones cortas).",
            "Muestra corta (unos 4 años de meses evaluables): un IC medio necesita t > 2 para ser fiable.",
        ],
    }
    with open(os.path.join(DATA, "lab.json"), "w") as fh:
        json.dump(res, fh, ensure_ascii=False, separators=(",", ":"))
    return res
