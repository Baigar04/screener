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
from statistics import NormalDist

import numpy as np
import pandas as pd

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
H = 21                      # sesiones hasta el siguiente rebalanceo (≈ 1 mes)
HZ = {"1m": 21, "3m": 63, "6m": 126, "12m": 252}   # horizontes evaluados
COST = 0.0015               # coste por operación y lado (15 pb: comisión + horquilla, mezcla de grandes y medianas)
IC_MIN = 0.02               # IC mínimo para considerar útil un factor
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
    ics, qs, ls, dates, turn = [], [], [], [], []
    prev = None
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
        top, bot = set(q.index[q == 4]), set(q.index[q == 0])
        # rotación: parte de cada pata que se renueva respecto al mes anterior
        turn.append(1.0 if prev is None else (len(top - prev[0]) / max(len(top), 1) + len(bot - prev[1]) / max(len(bot), 1)) / 2)
        prev = (top, bot)
        dates.append(d)
    if len(ics) < 6:
        return None
    ic = np.array(ics)
    ls = np.array(ls)
    q = np.nanmean(np.array(qs), axis=0)
    cum = np.cumsum(np.nan_to_num(ls)) * 100
    tv = np.array(turn[1:]) if len(turn) > 1 else np.array([1.0])
    # coste mensual: cada pata vende y compra la parte renovada → 2 × rotación × coste por pata, 2 patas
    net = ls - np.concatenate([[0.0], 4 * np.array(turn[1:]) * COST]) if len(turn) > 1 else ls
    return {
        "rotacion": round(float(tv.mean() * 100), 1),
        "ls_neto_anual": round(float(np.nanmean(net) * 12 * 100), 2),
        "ls_neto_sharpe": round(float(np.nanmean(net) / np.nanstd(net, ddof=1) * np.sqrt(12)), 2) if np.nanstd(net, ddof=1) > 0 else None,
        "meses": len(ic), "ic": round(float(ic.mean()), 4), "ic_t": round(float(ic.mean() / ic.std(ddof=1) * np.sqrt(len(ic))), 2) if ic.std(ddof=1) > 0 else None,
        "ic_pos": round(float((ic > 0).mean() * 100), 1),
        "q": [round(float(v) * 100, 3) for v in q],
        "ls_anual": round(float(np.nanmean(ls) * 12 * 100), 2),
        "ls_sharpe": round(float(np.nanmean(ls) / np.nanstd(ls, ddof=1) * np.sqrt(12)), 2) if np.nanstd(ls, ddof=1) > 0 else None,
        "curva": [[d.strftime("%Y-%m-%d"), round(float(c), 2)] for d, c in zip(dates, cum)],
        "ic_serie": [[d.strftime("%Y-%m-%d"), round(float(v), 3)] for d, v in zip(dates, ic)],
        "desde": dates[0].strftime("%Y-%m-%d"), "hasta": dates[-1].strftime("%Y-%m-%d"),
    }


def ic_series(sig, fwd):
    out = {}
    for d in sig.index:
        if d not in fwd.index:
            continue
        x, y = sig.loc[d], fwd.loc[d]
        m = x.notna() & y.notna()
        if m.sum() >= MIN_N:
            out[d] = x[m].rank().corr(y[m].rank())
    return pd.Series(out, dtype=float)


def nw_t(x, lag):
    """Estadístico t de la media con errores de Newey-West: corrige el solapamiento de horizontes > 1 mes."""
    x = np.asarray(x, float)
    x = x[~np.isnan(x)]
    n = len(x)
    if n < 8:
        return None
    e = x - x.mean()
    v = e @ e / n
    for k in range(1, min(lag, n - 1) + 1):
        v += 2 * (1 - k / (lag + 1)) * (e[k:] @ e[:-k]) / n
    return float(x.mean() / np.sqrt(v / n)) if v > 0 else None


def neutralize(sig, expo):
    """Residuo de la nota tras quitar, cada mes, lo que explican sector, tamaño y beta (regresión transversal)."""
    out = pd.DataFrame(index=sig.index, columns=sig.columns, dtype=float)
    for d in sig.index:
        X = expo.get(d)
        if X is None:
            continue
        y = sig.loc[d]
        m = y.notna() & X.notna().all(axis=1)
        if m.sum() < MIN_N:
            continue
        A = X[m].values
        b, *_ = np.linalg.lstsq(A, y[m].values, rcond=None)
        out.loc[d, m[m].index] = y[m].values - A @ b
    return out


def hz_stats(sig, sig_n, fwdH):
    r = {}
    for h, n in HZ.items():
        a, b = ic_series(sig, fwdH[h]), ic_series(sig_n, fwdH[h])
        if len(a) < 8:
            continue
        lag = max(0, n // 21 - 1)
        r[h] = {"n": int(len(a)), "ic": round(float(a.mean()), 4), "t": None if nw_t(a, lag) is None else round(nw_t(a, lag), 2),
                "ic_pos": round(float((a > 0).mean() * 100), 1),
                "ic_n": round(float(b.mean()), 4) if len(b) >= 8 else None,
                "t_n": None if len(b) < 8 or nw_t(b, lag) is None else round(nw_t(b, lag), 2)}
    return r


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


def sp_removed():
    """Valores que salieron del S&P 500 / S&P 400 desde 2015, con la fecha de salida (Wikipedia)."""
    import io
    import urllib.request
    out = {}
    for u in ("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", "https://en.wikipedia.org/wiki/List_of_S%26P_400_companies"):
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (screener personal; github.com/Baigar04)"})
            html = urllib.request.urlopen(req, timeout=60).read().decode()
            for t in pd.read_html(io.StringIO(html)):
                cols = [" ".join(map(str, c)) if isinstance(c, tuple) else str(c) for c in t.columns]
                rc = [i for i, c in enumerate(cols) if "Removed" in c]
                dc = [i for i, c in enumerate(cols) if "Date" in c]
                if not rc or not dc:
                    continue
                tc = next((i for i in rc if "Ticker" in cols[i] or "Symbol" in cols[i]), rc[0])
                for _, r in t.iterrows():
                    d = pd.to_datetime(str(r.iloc[dc[0]]), errors="coerce")
                    tk = str(r.iloc[tc]).strip().upper().replace(".", "-")
                    if pd.isna(d) or d < pd.Timestamp(2015, 1, 1) or not tk or tk == "NAN" or len(tk) > 6:
                        continue
                    out[tk] = min(out.get(tk, d), d)
        except Exception as e:  # noqa: BLE001
            print("lab: sin historial de cambios", u[-30:], e)
    return out


def prices_10y(syms):
    """Precios ajustados (Adj Close) y sin ajustar por dividendos (Close) a 10 años, por lotes."""
    import yfinance as yf
    adj, cls = {}, {}
    for i in range(0, len(syms), 200):
        ch = syms[i:i + 200]
        try:
            df = yf.download(ch, period="10y", interval="1d", auto_adjust=False, progress=False, threads=True, group_by="column")
        except Exception as e:  # noqa: BLE001
            print("lab: lote sin precios", i, e)
            continue
        for k, dst in (("Adj Close", adj), ("Close", cls)):
            if k not in df:
                continue
            x = df[k]
            if isinstance(x, pd.Series):
                x = x.to_frame(ch[0])
            for c in x.columns:
                v = x[c].dropna()
                if len(v) > 300:
                    dst[c] = v
    return pd.DataFrame(adj).sort_index(), pd.DataFrame(cls).sort_index()


def train_dates(D, me, test_k, h):
    """Fechas de entrenamiento con embargo igual al horizonte: solo las anteriores a la prueba cuya rentabilidad futura
    (h sesiones) termina, como tarde, el día en que empieza la prueba. Así ningún dato de la prueba entra en el entrenamiento.
    D: fechas de rebalanceo; me: su posición en el calendario de sesiones; test_k: índice en D de la primera fecha de prueba."""
    start = me[test_k]
    return D[[k for k in range(test_k) if me[k] + h <= start]]


def sec_at(fy, d):
    """Último 10-K presentado antes de d y el del ejercicio anterior (datos SEC «a fecha»)."""
    lim = (d - pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    known = [r for r in fy if r[1] <= lim]
    if not known:
        return None, None
    cur = max(known, key=lambda r: r[0])
    ce = pd.Timestamp(cur[0])
    prev = next((r for r in sorted(known, key=lambda r: r[0], reverse=True)
                 if 300 <= (ce - pd.Timestamp(r[0])).days <= 430), None)
    return cur, prev


def run(frames, rows, cache, default_w):
    # ---- datos: 10 años de precios + ex miembros del S&P que siguen cotizando + fundamentales SEC «a fecha»
    syms = [r["sym"] for r in rows]
    removed = {k: v for k, v in sp_removed().items() if k not in set(syms)}
    try:
        sec = json.load(open(os.path.join(DATA, "sec_cache.json"))).get("sim", {})
    except Exception:  # noqa: BLE001
        sec = {}
    P, C = prices_10y(syms + sorted(removed))
    if P.shape[1] < 0.5 * len(syms):  # si falla la descarga larga, se usan los 5 años de la web
        P = pd.DataFrame({s: f["Close"] for s, f in frames.items()}).sort_index()
        C = P.copy()
        removed = {}
    P = P[P.index >= P.index[-1] - pd.Timedelta(days=3660)].ffill(limit=5)
    extra = sorted(k for k in removed if k in P.columns)
    for k in extra:  # un ex miembro solo cuenta hasta su salida del índice
        P.loc[P.index > removed[k], k] = np.nan
    json.dump({"generado": datetime.now(timezone.utc).isoformat(timespec="seconds"), "extra": extra},
              open(os.path.join(DATA, "lab_extra.json"), "w"))
    P = P.loc[:, P.notna().sum() > 300]
    rets = P.pct_change(fill_method=None)
    sector = pd.Series({r["sym"]: r.get("sector") for r in rows}).reindex(P.columns)
    mcap_now = pd.Series({r["sym"]: _f(r.get("mcap")) for r in rows}).reindex(P.columns)
    last_px = P.ffill().iloc[-1]
    # capitalización de referencia de los ex miembros: acciones del último 10-K × precio de ese día
    for k in extra:
        fy = (sec.get(k) or {}).get("fy") or []
        f = next((r for r in sorted(fy, key=lambda r: r[1], reverse=True) if r[9]), None)
        if not f or k not in C.columns or k not in P.columns:
            continue
        dd = C.index[C.index <= pd.Timestamp(f[1])]
        if len(dd) and C.at[dd[-1], k] == C.at[dd[-1], k] and P.at[dd[-1], k] == P.at[dd[-1], k]:
            mcap_now[k] = f[9] * C.at[dd[-1], k] * last_px[k] / P.at[dd[-1], k]
    us_cols = [c for c in P.columns if "." not in c]

    # fechas de rebalanceo: último día de cada mes con 12 meses de historia detrás y 1 mes por delante
    idx = P.index
    me = pd.Series(range(len(idx)), index=idx).groupby([idx.year, idx.month]).max().values
    me = [i for i in me if i >= 252 and i + H < len(idx)]
    D = idx[me]
    fwd = pd.DataFrame({d: P.iloc[i + H] / P.iloc[i] - 1 for d, i in zip(D, me)}).T
    fwd = fwd.clip(-0.9, 3)
    fwdH = {h: pd.DataFrame({d: (P.iloc[i + n] / P.iloc[i] - 1) if i + n < len(idx) else pd.Series(np.nan, index=P.columns)
                             for d, i in zip(D, me)}).T.clip(-0.95, 5) for h, n in HZ.items()}

    # exposiciones para neutralizar: sector (dummies), tamaño (log capitalización) y beta de 1 año frente al universo
    mkt = rets.mean(axis=1)
    dums = pd.get_dummies(sector.fillna("Otros"), dtype=float)
    expo = {}
    for d, i in zip(D, me):
        R = rets.iloc[i - 251:i + 1]
        mk = mkt.iloc[i - 251:i + 1]
        mc = mk - mk.mean()
        beta = (R - R.mean()).mul(mc, axis=0).sum() / (mc @ mc) if (mc @ mc) > 0 else pd.Series(np.nan, index=P.columns)
        beta = beta.where(R.notna().sum() > 200)
        size = np.log((mcap_now * P.iloc[i] / last_px).where(lambda x: x > 0))
        X = pd.concat([dums, size.rename("_size"), beta.rename("_beta")], axis=1)
        X["_size"] = (X["_size"] - X["_size"].mean()) / X["_size"].std()
        X["_beta"] = (X["_beta"] - X["_beta"].mean()) / X["_beta"].std()
        expo[d] = X

    sma200 = P.rolling(200, min_periods=150).mean()
    vol63 = rets.rolling(63, min_periods=50).std()
    raw = {
        "r3": (P / P.shift(63) - 1).loc[D], "r6": (P / P.shift(126) - 1).loc[D], "tr": (P / sma200 - 1).loc[D],
        "m12": (P.shift(21) / P.shift(252) - 1).loc[D], "lv": -vol63.loc[D], "rv": -(P / P.shift(21) - 1).loc[D],
    }
    # fundamentales «a fecha»
    fund = {k: pd.DataFrame(index=D, columns=P.columns, dtype=float) for k in ("roe", "mg", "dp", "ep", "bp", "fy", "cv", "cb")}
    n_sec = 0
    for s in P.columns:
        fy = (sec.get(s) or {}).get("fy") or []
        if len(fy) >= 2 and mcap_now.get(s):
            n_sec += 1
            for d in D:
                cur, prev = sec_at(fy, d)
                if not cur:
                    continue
                px = P.at[d, s]
                if not (px == px):
                    continue
                mc = mcap_now[s] * px / last_px[s]
                ve, bn, eb, eq, de, cfo, cpx = cur[2:9]
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
                    if cfo is not None:
                        fund["fy"].at[d, s] = (cfo - (cpx or 0)) / mc
                if prev:
                    pv, pb = prev[2], prev[3]
                    if ve is not None and pv and pv > 0:
                        fund["cv"].at[d, s] = ve / pv - 1
                    if bn is not None and pb and pb > 0:
                        fund["cb"].at[d, s] = bn / pb - 1
            continue
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
            out_f.append({"k": k, "nombre": name, "categoria": cat, "fiabilidad": "sec" if fia == "aproximada" else fia, "explica": txt, **st,
                          "hz": hz_stats(sig[k], neutralize(sig[k], expo), fwdH)})
    out_c = []
    for c in CATS:
        st = stats(cat_sig[c], fwd)
        if st:
            us = cat_sig[c][us_cols]
            out_c.append({"k": c, "nombre": CAT_NAME[c], "fiabilidad": "completa" if c == "momentum" else "sec", **st,
                          "hz": hz_stats(cat_sig[c], neutralize(cat_sig[c], expo), fwdH),
                          "hz_us": hz_stats(us, neutralize(us, {d: x.loc[us_cols] for d, x in expo.items()}), {h: f[us_cols] for h, f in fwdH.items()})})
    ic_cat = {c["k"]: c["ic"] for c in out_c}
    t_cat = {c["k"]: c["ic_t"] for c in out_c}

    base = {k: default_w[k] for k in CATS}
    sug = suggest(ic_cat, base, t_cat)
    comp_now = stats(composite(cat_sig, base), fwd)
    comp_sug = stats(composite(cat_sig, sug), fwd)

    # fuera de muestra: pesos estimados con la primera mitad, medidos en la segunda
    # embargo igual al horizonte: un mes de entrenamiento solo cuenta si su rentabilidad futura ya se conocía al empezar la prueba
    oos = None
    hk = len(D) // 2
    half, train = D[hk], train_dates(D, me, hk, H)
    first = {c: stats(cat_sig[c].loc[train], fwd.loc[train]) for c in CATS}
    if all(first.values()):
        w1 = suggest({c: first[c]["ic"] for c in CATS}, base, {c: first[c]["ic_t"] for c in CATS})
        a = stats(composite(cat_sig, base).loc[half:], fwd.loc[half:])
        b = stats(composite(cat_sig, w1).loc[half:], fwd.loc[half:])
        if a and b:
            oos = {"corte": half.strftime("%Y-%m-%d"), "fin_entrenamiento": train[-1].strftime("%Y-%m-%d") if len(train) else None,
                   "embargo_sesiones": H, "pesos_primera_mitad": w1,
                   "actual": {k: a[k] for k in ("meses", "ic", "ic_t", "ls_anual", "ls_sharpe")},
                   "sugerido": {k: b[k] for k in ("meses", "ic", "ic_t", "ls_anual", "ls_sharpe")}}

    # walk-forward: cada año, pesos calculados solo con los meses anteriores y aplicados a ese año
    wf_rows, ic_a, ic_w = [], [], []
    comp_base = composite(cat_sig, base)
    for y in sorted(set(D.year)):
        cur = D[D.year == y]
        if not len(cur):
            continue
        past = train_dates(D, me, D.get_loc(cur[0]), H)   # con embargo: sin solapes con el año de prueba
        if len(past) < 12:
            continue
        st = {c: stats(cat_sig[c].loc[past], fwd.loc[past]) for c in CATS}
        if not all(st.values()):
            continue
        wy = suggest({c: st[c]["ic"] for c in CATS}, base, {c: st[c]["ic_t"] for c in CATS})
        a = ic_series(comp_base.loc[cur], fwd.loc[cur])
        b = ic_series(composite(cat_sig, wy).loc[cur], fwd.loc[cur])
        if len(a) and len(b):
            ic_a += list(a.values)
            ic_w += list(b.values)
            wf_rows.append({"anio": int(y), "meses": int(len(b)), "fin_entrenamiento": past[-1].strftime("%Y-%m-%d"), "pesos": wy, "ic_actual": round(float(a.mean()), 4), "ic_wf": round(float(b.mean()), 4)})
    wf = None
    if wf_rows:
        ia, iw = np.array(ic_a), np.array(ic_w)
        wf = {"anios": wf_rows, "meses": len(iw), "ic_actual": round(float(ia.mean()), 4), "ic_wf": round(float(iw.mean()), 4),
              "t_actual": None if nw_t(ia, 0) is None else round(nw_t(ia, 0), 2), "t_wf": None if nw_t(iw, 0) is None else round(nw_t(iw, 0), 2)}

    # pruebas múltiples: umbral de t con corrección de Bonferroni (5 %, bilateral) para todas las pruebas hechas
    n_tests = (len(out_f) + len(out_c)) * len(HZ)
    t_crit = round(NormalDist().inv_cdf(1 - 0.05 / (2 * max(n_tests, 1))), 2)
    passing = []
    for x in out_c + [f for f in out_f if f["categoria"] in CATS]:
        for h, v in (x.get("hz") or {}).items():
            # además debe sobrevivir a la neutralización (t ≥ 2): si no, era un efecto de sector, tamaño, beta o región
            if v["ic"] >= IC_MIN and (v["t"] or 0) >= t_crit and (v["t_n"] or 0) >= 2:
                passing.append({"k": x["k"], "nombre": x["nombre"], "horizonte": h, "ic": v["ic"], "t": v["t"], "t_n": v["t_n"]})
    veredicto = {
        "etiqueta": "oportunidad" if passing else "ordenación",
        "supera": passing, "t_umbral": t_crit, "pruebas": n_tests, "ic_min": IC_MIN,
        "texto": (f"{len(passing)} factor(es) de la puntuación superan IC ≥ {IC_MIN} con t ≥ {t_crit} y siguen siendo significativos tras neutralizar (t ≥ 2): la nota tiene evidencia como «puntuación de oportunidad»."
                  if passing else
                  f"Ningún factor de la puntuación alcanza IC ≥ {IC_MIN} con t ≥ {t_crit} (umbral corregido por {n_tests} pruebas) y t ≥ 2 tras neutralizar. "
                  "La nota sirve para ordenar valores según sus características, no como señal de rentabilidad futura: pasa a llamarse «puntuación de ordenación»."),
    }

    res = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "universo": int(P.shape[1]), "meses": len(D), "desde": D[0].strftime("%Y-%m-%d"), "hasta": D[-1].strftime("%Y-%m-%d"),
        "horizonte": "1 mes (21 sesiones), rebalanceo a fin de mes",
        "factores": out_f, "categorias": out_c,
        "compuesto": {"actual": comp_now, "sugerido": comp_sug},
        "pesos": {"actual": default_w, "sugerido": {**default_w, **sug}},
        "fuera_muestra": oos,
        "walk_forward": wf, "veredicto": veredicto, "embargo_sesiones": H,
        "fuentes": {"sec": n_sec, "ex_miembros": len([k for k in extra if k in P.columns]), "anios_precio": round((P.index[-1] - P.index[0]).days / 365.25, 1)}, "horizontes": list(HZ), "coste_pb": COST * 1e4,
        "no_evaluables": [
            {"k": "smart", "nombre": "Smart money", "motivo": "Dataroma y las declaraciones del Congreso no ofrecen gratis un historial fechado de cuándo se conoció cada dato. Mantiene su peso, sin evidencia a favor ni en contra."},
            {"k": "macro", "nombre": "Encaje macro", "motivo": "El modelo de régimen no guarda historial de probabilidades; se podrá medir cuando acumule meses."},
        ],
        "sesgos": [
            f"Supervivencia, reducida: entran {len([k for k in extra if k in P.columns])} ex miembros del S&P 500/400 que siguen cotizando, cada uno hasta su fecha de salida. Siguen fuera las empresas que dejaron de cotizar (compradas o quebradas), porque Yahoo no guarda sus precios, y los miembros actuales cuentan también antes de entrar en el índice.",
            f"Fundamentales de EE. UU. ({n_sec} empresas): cuentas del 10-K original de la SEC con su fecha real de presentación, sin reexpresiones. Europa: cuentas anuales de Yahoo (4-5 ejercicios) supuestas conocidas el 1 de abril siguiente.",
            "Capitalización pasada reconstruida con el precio (acciones constantes); en ex miembros, con las acciones del último 10-K.",
            "Costes: 15 pb por operación y lado aplicados a la rotación mensual de la cartera Q5 − Q1; sin impuestos, sin coste de préstamo de títulos para las posiciones cortas ni impacto en precio.",
            "Horizontes de 3, 6 y 12 meses: las ventanas se solapan; el estadístico t usa la corrección de Newey-West.",
            f"Pruebas fuera de muestra (mitades y walk-forward) con embargo de {H} sesiones: el entrenamiento termina cuando su rentabilidad futura ya se conocía, sin solaparse con el periodo de prueba.",
        ],
    }
    with open(os.path.join(DATA, "lab.json"), "w") as fh:
        json.dump(res, fh, ensure_ascii=False, separators=(",", ":"))
    return res
