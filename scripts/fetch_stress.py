#!/usr/bin/env python3
"""Stress tests y riesgo de divisas (hoja de ruta definitiva, fase 3) → data/stress.json.

No predice: mide cuánto perdería cada valor, cada bolsa y (en la web) cada cartera si se repite un escenario.
  1. Crisis históricas (2008, 2011, 2020, 2022): lo que hizo de verdad cada valor entre el máximo y el mínimo de la
     crisis (precios semanales de Yahoo con dividendos). Si el valor no cotizaba, estimación = beta frente a su bolsa ×
     caída de su bolsa (marcado como «estimado»).
  2. Choques de un mes, todos de la misma talla (2 desviaciones típicas del cambio mensual del factor desde 2007):
     tipos a 10 años, petróleo Brent, crédito (Baa), dólar, escalada y distensión rusa (GPR de Rusia), tensión
     China-Taiwán (GPR de Taiwán) y un recorte del capex en IA (semiconductores −30 %). Regresión de la rentabilidad
     mensual del valor sobre el factor; el R² dice cuánto explica el factor.
  3. Divisas para un inversor en euros: cambio de cada divisa frente al euro en cada crisis, volatilidad, serie semanal
     y coste anual de cubrirla (diferencial de tipos a 3 meses, OCDE vía FRED).
Las reglas de veredicto (Aguanta, Tensión, Rompe) se fijaron antes de ver los resultados. Si una fuente falla se
registra el error; nunca se inventa un dato.
"""
import json
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_risk import MERCADOS, ecb, fred, log  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
NOW = datetime.now(timezone.utc)
ERRORS = []
INICIO = "2006-12-01"
MIN_MESES = 36

CRISIS = [  # (id, nombre, inicio, fin, descripción): máximo y mínimo del S&P 500 en cada episodio
    ("c2008", "2008 · crisis financiera", "2007-10-09", "2009-03-09", "Quiebra de Lehman y crisis bancaria global"),
    ("c2011", "2011 · crisis del euro", "2011-04-29", "2011-10-03", "Deuda soberana europea y rebaja de EE. UU."),
    ("c2020", "2020 · COVID", "2020-02-19", "2020-03-23", "Confinamientos"),
    ("c2022", "2022 · Ucrania, inflación y tipos", "2022-01-03", "2022-10-12", "Invasión de Ucrania y subidas de tipos"),
]
CHOQUES = [  # (id, nombre, factor, signo del choque, descripción)
    ("tipos", "Tipos a 10 años", "tipos", +1, "Subida del bono a 10 años de su zona"),
    ("petroleo", "Petróleo Brent", "brent", +1, "Subida del Brent"),
    ("credito", "Crédito", "baa", +1, "Ampliación del diferencial Baa − bono a 10 años (EE. UU.)"),
    ("dolar", "Dólar", "dolar", +1, "Apreciación del dólar frente al euro"),
    ("rusia", "Escalada rusa", "gpr_rus+", +1, "Sobresalto del índice de riesgo geopolítico de Rusia"),
    ("paz", "Distensión Rusia-Ucrania", "gpr_rus-", -1, "Caída brusca del índice de riesgo geopolítico de Rusia"),
    ("taiwan", "Tensión China-Taiwán", "gpr_twn", +1, "Sobresalto del índice de riesgo geopolítico de Taiwán"),
    ("capex", "Capex IA −30 %", "semis", -1, "Semiconductores −30 % (SOXX), referencia de un recorte de la inversión en IA"),
]
ZONA_TIPOS = {"sp500": "US", "ndx": "US", "eem": "US", "hsi": "US", "sx5e": "DE", "dax": "DE", "cac": "DE", "ibex": "DE", "mib": "DE",
              "ftse": "GB", "n225": "JP"}
TIPOS_FRED = {"US": "IRLTLT01USM156N", "DE": "IRLTLT01DEM156N", "GB": "IRLTLT01GBM156N", "JP": "IRLTLT01JPM156N"}
TIPOS_NOMBRE = {"US": "EE. UU.", "DE": "Alemania", "GB": "Reino Unido", "JP": "Japón"}
PAIS_MERCADO = {"United States": "sp500", "Spain": "ibex", "United Kingdom": "ftse", "Germany": "dax", "France": "cac", "Italy": "mib",
                "Japan": "n225", "Hong Kong": "hsi", "China": "hsi"}
DIVISAS = ["USD", "GBP", "CHF", "SEK", "NOK", "DKK", "JPY", "HKD", "TWD", "KRW"]
TIPO3M = {"EUR": "IR3TIB01EZM156N", "USD": "IR3TIB01USM156N", "GBP": "IR3TIB01GBM156N", "CHF": "IR3TIB01CHM156N",
          "SEK": "IR3TIB01SEM156N", "NOK": "IR3TIB01NOM156N", "DKK": "IR3TIB01DKM156N", "JPY": "IR3TIB01JPM156N",
          "KRW": "IR3TIB01KRM156N"}
# Veredictos frente a su bolsa (clasificación para leer la tabla, no un modelo de previsión): «Rompe» si empeora mucho a su
# bolsa o sufre una caída catastrófica; «Tensión» si empeora claramente a su bolsa. Crisis (varios meses) y choques (un mes).
UMBRAL = {"crisis": {"rompe": (-60, -15), "tension": (None, -5)}, "choque": {"rompe": (-20, -8), "tension": (None, -3)}}


# ---------------------------------------------------------------- utilidades puras (con tests)
def mercado_de(r):
    """Bolsa de referencia de un valor del universo (clave de MERCADOS)."""
    ind = set(r.get("indices") or [])
    if ind & {"IBEX 35", "Mercado Continuo"}:
        return "ibex"
    if ind & {"FTSE 100", "FTSE 250"}:
        return "ftse"
    if "Nasdaq 100" in ind and not ind & {"S&P 500", "S&P 400", "S&P 600"}:
        return "ndx"
    p = PAIS_MERCADO.get(r.get("pais") or "")
    if p:
        return p
    reg = r.get("region")
    if reg == "EE. UU.":
        return "sp500"
    if reg == "Europa":
        return "sx5e"
    return "eem"


def bar_end(d):
    """Las barras semanales de Yahoo llevan la fecha del lunes; el cierre es el del viernes."""
    return d + timedelta(days=4)


def at_date(weekly, d, tol=8):
    """Cierre de la barra semanal que termina más cerca de d (± tol días)."""
    best, bd = None, None
    for t, v in weekly:
        dd = abs((bar_end(t) - d).days)
        if dd <= tol and (bd is None or dd < bd):
            best, bd = v, dd
    return best


def crisis_return(weekly, d0, d1):
    a, b = at_date(weekly, d0), at_date(weekly, d1)
    if not a or not b or a <= 0 or b <= 0:
        return None
    r = (b / a - 1) * 100
    return round(r, 1) if -99 < r < 400 else None   # saltos imposibles: dato erróneo


def monthly_from_weekly(weekly):
    m = {}
    for t, v in weekly:
        e = bar_end(t)
        m[f"{e.year:04d}-{e.month:02d}"] = v
    return m


def mlogret(mc, last_complete):
    """Rentabilidades mensuales logarítmicas en %, solo meses completos y consecutivos."""
    ms = sorted(k for k in mc if k <= last_complete)
    out = {}
    for i in range(1, len(ms)):
        a, b = mc[ms[i - 1]], mc[ms[i]]
        y0, m0 = map(int, ms[i - 1].split("-"))
        y1, m1 = map(int, ms[i].split("-"))
        if (y1 * 12 + m1) - (y0 * 12 + m0) == 1 and a > 0 and b > 0:
            r = math.log(b / a) * 100
            if abs(r) <= 100:   # saltos de más del 170 % / −63 % en un mes: cambio de unidad o error de datos
                out[ms[i]] = r
    return out


def ols(y, X):
    X = np.column_stack([np.ones(len(y)), X])
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    res = y - X @ b
    s2 = res @ res / max(1, len(y) - X.shape[1])
    se = np.sqrt(np.diag(s2 * np.linalg.pinv(X.T @ X)))
    r2 = 1 - (res @ res) / (((y - y.mean()) ** 2).sum() or 1)
    return b, se, float(r2)


def simple(logpct):
    return (math.exp(logpct / 100) - 1) * 100


def effect(ret, fac, shock, min_n=MIN_MESES):
    """Efecto (en %) de un choque de tamaño `shock` en el factor, por regresión mensual. Devuelve (efecto, R², n)."""
    ms = sorted(set(ret) & set(fac))
    if len(ms) < min_n:
        return None
    y = np.array([ret[m] for m in ms])
    x = np.array([fac[m] for m in ms])
    if x.std() == 0:
        return None
    b, _, r2 = ols(y, x)
    e = simple(b[1] * shock)
    return (round(e, 1), round(r2, 3), len(ms)) if -90 < e < 300 else None


def effect_asym(ret, z, min_n=MIN_MESES):
    """Escalada y distensión con pendientes distintas: r = a + b⁺·max(z,0) + b⁻·min(z,0). Devuelve ((esc, R², n), (paz, R², n))."""
    ms = sorted(set(ret) & set(z))
    if len(ms) < min_n:
        return None, None
    y = np.array([ret[m] for m in ms])
    zz = np.array([z[m] for m in ms])
    X = np.column_stack([np.maximum(zz, 0), np.minimum(zz, 0)])
    if X[:, 0].std() == 0 or X[:, 1].std() == 0:
        return None, None
    b, _, r2 = ols(y, X)
    ok = lambda e: (round(e, 1), round(r2, 3), len(ms)) if -90 < e < 300 else None  # noqa: E731
    return ok(simple(b[1] * 2)), ok(simple(b[2] * -2))


def beta(ret, idx, min_n=24):
    ms = sorted(set(ret) & set(idx))
    if len(ms) < min_n:
        return None
    b, _, _ = ols(np.array([ret[m] for m in ms]), np.array([idx[m] for m in ms]))
    return float(b[1])


def veredicto(v, ref, tipo):
    """Aguanta / Tensión / Rompe según la caída del valor y lo que empeora frente a su bolsa."""
    if v is None:
        return None
    d = v - ref if ref is not None else 0
    u = UMBRAL[tipo]
    if v <= u["rompe"][0] or d <= u["rompe"][1]:
        return "Rompe"
    if (u["tension"][0] is not None and v <= u["tension"][0]) or d <= u["tension"][1]:
        return "Tensión"
    return "Aguanta"


def zscore(series):
    a = np.array(list(series.values()))
    mu, sd = a.mean(), a.std()
    return {k: (v - mu) / sd for k, v in series.items()} if sd else {}


def gpr_z(ser):
    """Sobresalto del GPR de un país: cambio logarítmico mensual estandarizado."""
    v = [(m, math.log(x)) for m, x in ser if x > 0]
    return zscore({v[i][0]: v[i][1] - v[i - 1][1] for i in range(1, len(v))})


def month_last(obs):
    m = {}
    for d, v in obs:
        m[f"{d.year:04d}-{d.month:02d}"] = v
    return m


def mdiff(m, mult=1.0):
    ks = sorted(m)
    return {ks[i]: (m[ks[i]] - m[ks[i - 1]]) * mult for i in range(1, len(ks))}


def last_complete_month(today):
    first = today.replace(day=1)
    p = first - timedelta(days=1)
    return f"{p.year:04d}-{p.month:02d}"


# ---------------------------------------------------------------- descargas
def weekly(tickers, chunk=150):
    import yfinance as yf
    out = {}
    for i in range(0, len(tickers), chunk):
        part = tickers[i:i + chunk]
        try:
            df = yf.download(part, start=INICIO, interval="1wk", auto_adjust=True, group_by="ticker", threads=True, progress=False)
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "Yahoo Finance", "serie": f"lote {i // chunk + 1}", "motivo": str(e)[:150]})
            continue
        for t in part:
            try:
                c = df[t]["Close"] if len(part) > 1 else df["Close"]
                if hasattr(c, "columns"):
                    c = c.iloc[:, 0]
                s = [(d.date(), float(v)) for d, v in c.dropna().items() if v > 0]
                if len(s) >= 30:
                    out[t] = s
            except Exception:  # noqa: BLE001
                pass
        log(f"  semanal: {min(i + chunk, len(tickers))}/{len(tickers)} · {len(out)} con datos")
    return out


def factores(today):
    F, meta = {}, {}
    for z, sid in TIPOS_FRED.items():
        try:
            F["tipos_" + z] = mdiff({k: v for k, v in month_last(fred(sid)).items() if k >= "2006-12"}, 100)   # puntos básicos
            meta["tipos_" + z] = {"fuente": "OCDE vía FRED", "url": f"https://fred.stlouisfed.org/series/{sid}", "unidad": "pb"}
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "FRED", "serie": sid, "motivo": str(e)[:150]})
    for key, sid, kind, fuente in (("brent", "DCOILBRENTEU", "log", "EIA vía FRED"), ("baa", "BAA10Y", "diff", "Moody's vía FRED"),
                                   ("dolar", "DEXUSEU", "inv", "Fed vía FRED")):
        try:
            m = {k: v for k, v in month_last(fred(sid)).items() if k >= "2006-12" and v > 0}
            ks = sorted(m)
            if kind == "log":
                F[key] = {ks[i]: math.log(m[ks[i]] / m[ks[i - 1]]) * 100 for i in range(1, len(ks))}
            elif kind == "diff":
                F[key] = mdiff(m, 100)
            else:   # dólares por euro → apreciación del dólar en %
                F[key] = {ks[i]: -math.log(m[ks[i]] / m[ks[i - 1]]) * 100 for i in range(1, len(ks))}
            meta[key] = {"fuente": fuente, "url": f"https://fred.stlouisfed.org/series/{sid}", "unidad": "pb" if kind == "diff" else "%"}
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "FRED", "serie": sid, "motivo": str(e)[:150]})
    try:
        from fetch_geo import gpr_monthly
        G = gpr_monthly()
        for code, key in (("RUS", "gpr_rus"), ("TWN", "gpr_twn")):
            if code in G["paises"]:
                F[key] = {m: v for m, v in gpr_z(G["paises"][code]).items() if m >= "2007-01"}
                meta[key] = {"fuente": "Caldara e Iacoviello (GPR por país)", "url": "https://www.matteoiacoviello.com/gpr.htm", "unidad": "σ"}
    except Exception as e:  # noqa: BLE001
        ERRORS.append({"fuente": "Caldara-Iacoviello", "serie": "GPR por país", "motivo": str(e)[:150]})
    lc = last_complete_month(today)
    return {k: {m: v for m, v in s.items() if m <= lc} for k, s in F.items()}, meta


# si la serie de la OCDE va con más de 3 meses de retraso, una fuente más fresca del mismo plazo o del día
TIPO3M_ALT = {"EUR": ("ecb", "FM.M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA", "Euríbor a 3 meses (BCE)",
                      "https://data.ecb.europa.eu/data/datasets/FM/FM.M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA"),
              "GBP": ("fred", "IUDSOIA", "SONIA (Banco de Inglaterra vía FRED)", "https://fred.stlouisfed.org/series/IUDSOIA")}


def tipos_cortos(today=None):
    today = today or NOW.date()
    out = {}
    for c, sid in TIPO3M.items():
        try:
            o = fred(sid)
            out[c] = {"valor": round(o[-1][1], 2), "fecha": o[-1][0].isoformat()[:7], "url": f"https://fred.stlouisfed.org/series/{sid}",
                      "fuente": "OCDE, interbancario a 3 meses (FRED)"}
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "FRED", "serie": sid, "motivo": str(e)[:150]})
        cur = out.get(c)
        if c in TIPO3M_ALT and (cur is None or (today - date.fromisoformat(cur["fecha"] + "-01")).days > 100):
            kind, key, nom, url = TIPO3M_ALT[c]
            try:
                o = ecb(key) if kind == "ecb" else fred(key)
                out[c] = {"valor": round(o[-1][1], 2), "fecha": o[-1][0].isoformat()[:7], "url": url, "fuente": nom}
            except Exception as e:  # noqa: BLE001
                ERRORS.append({"fuente": nom, "serie": key, "motivo": str(e)[:150]})
    return out


# ---------------------------------------------------------------- cálculo
def scenario_values(wk, fac, sig, idx_ret, idx_crisis, mkey):
    """Valores (%), calidad (1 = dato real, 0,5 = estimado; R² en choques) y n por escenario para una serie semanal."""
    lc = last_complete_month(NOW.date())
    ret = mlogret(monthly_from_weekly(wk), lc)
    v, q = [], []
    b = beta(ret, idx_ret) if idx_ret is not None else None
    for i, (_, _, d0, d1, _) in enumerate(CRISIS):
        r = crisis_return(wk, date.fromisoformat(d0), date.fromisoformat(d1))
        if r is not None:
            v.append(r)
            q.append(1)
        elif b is not None and idx_crisis and idx_crisis[i] is not None:
            est = simple(b * math.log(1 + idx_crisis[i] / 100) * 100)
            v.append(round(est, 1) if -99 < est < 400 else None)
            q.append(0.5 if -99 < est < 400 else None)
        else:
            v.append(None)
            q.append(None)
    rus = effect_asym(ret, fac.get("gpr_rus", {})) if fac.get("gpr_rus") else (None, None)
    for cid, _, f, sgn, _ in CHOQUES:
        if cid == "rusia":
            e = rus[0]
        elif cid == "paz":
            e = rus[1]
        else:
            key = "tipos_" + ZONA_TIPOS.get(mkey, "US") if f == "tipos" else f
            if key not in fac or key not in sig:
                e = None
            else:
                shock = math.log(0.70) * 100 if cid == "capex" else sgn * 2 * sig[key]
                e = effect(ret, fac[key], shock)
        v.append(e[0] if e else None)
        q.append(e[1] if e else None)
    return v, q, ret, b


def main():
    S = {"generado": NOW.isoformat(timespec="seconds"), "errores": ERRORS,
         "fuentes": ["Yahoo Finance (precios semanales con dividendos desde 2007)", "FRED: OCDE (tipos), EIA (Brent), Moody's (Baa), Fed (dólar)",
                     "Caldara e Iacoviello (GPR de Rusia y Taiwán)", "iShares Semiconductor ETF (SOXX) en Yahoo"],
         "umbral": UMBRAL}
    fac, fmeta = factores(NOW.date())
    try:
        U = json.load(open(os.path.join(DATA, "universe.json")))["filas"]
    except (OSError, ValueError, KeyError):
        U = []
        ERRORS.append({"fuente": "universo", "serie": "universe.json", "motivo": "no disponible"})
    idx_t = {k: t for k, _, t, _ in MERCADOS}
    fx_t = {c: f"EUR{c}=X" for c in DIVISAS}
    tick = list(idx_t.values()) + ["SOXX"] + list(fx_t.values()) + [r["sym"] for r in U]
    W = weekly(list(dict.fromkeys(tick)))
    try:   # la fase 5 (fetch_prob.py) reutiliza estos precios semanales en el mismo job: no se publica
        import pickle
        with open(os.environ.get("SEMANAL", "/tmp/screener_semanal.pkl"), "wb") as fh:
            pickle.dump(W, fh)
    except Exception as e:  # noqa: BLE001
        log("No se pudo guardar la copia semanal:", e)
    lc = last_complete_month(NOW.date())
    if "SOXX" in W:
        fac["semis"] = mlogret(monthly_from_weekly(W["SOXX"]), lc)
        fmeta["semis"] = {"fuente": "Yahoo (SOXX)", "url": "https://finance.yahoo.com/quote/SOXX", "unidad": "%"}
    sig = {k: float(np.std(list(s.values()))) for k, s in fac.items() if s}
    # escenarios con su magnitud
    esc = [{"id": c[0], "nombre": c[1], "tipo": "crisis", "desde": c[2], "hasta": c[3], "desc": c[4],
            "base": "Lo que hizo el valor entre el máximo y el mínimo del S&P 500 (Yahoo, semanal, con dividendos)"} for c in CRISIS]
    for cid, nom, f, sgn, desc in CHOQUES:
        e = {"id": cid, "nombre": nom, "tipo": "choque", "desc": desc,
             "base": "Regresión de la rentabilidad mensual sobre el factor desde 2007; efecto del choque y R²"}
        if f == "tipos":
            e["magnitud"] = {TIPOS_NOMBRE[z]: f"+{2 * sig['tipos_' + z]:.0f} pb" for z in TIPOS_FRED if "tipos_" + z in sig}
            e["etiqueta"] = "Tipos a 10 años +2σ"
            e["fuente"] = fmeta.get("tipos_US")
        elif cid == "capex":
            e["etiqueta"] = "Capex IA −30 %"
            e["magnitud"] = "semiconductores −30 %"
            e["fuente"] = fmeta.get("semis")
        else:
            k = "gpr_rus" if f.startswith("gpr_rus") else f
            if k in sig:
                u = fmeta[k]["unidad"]
                mag = 2 * sig[k] if u != "σ" else 2
                e["magnitud"] = f"{'+' if sgn > 0 else '−'}{mag:.0f} {u}" if u != "σ" else f"{'+' if sgn > 0 else '−'}2σ"
            e["etiqueta"] = {"petroleo": "Petróleo +2σ", "credito": "Crédito +2σ", "dolar": "Dólar +2σ", "rusia": "Escalada rusa",
                             "paz": "Paz en Ucrania", "taiwan": "China-Taiwán"}[cid]
            e["fuente"] = fmeta.get(k)
        esc.append(e)
    S["escenarios"] = esc
    # bolsas
    idx_ret, idx_cri, I = {}, {}, {}
    for k, nombre, t, _ in MERCADOS:
        if t not in W:
            ERRORS.append({"fuente": "Yahoo Finance", "serie": nombre, "motivo": "sin precios semanales"})
            continue
        v, q, ret, _ = scenario_values(W[t], fac, sig, None, None, k)
        idx_ret[k], idx_cri[k] = ret, v[:len(CRISIS)]
        I[k] = {"nombre": nombre, "v": v, "q": q}
    S["indices"] = I
    log("Bolsas:", ", ".join(f"{x['nombre']} 2008 {x['v'][0]}" for x in I.values()))
    # valores
    V, cnt = {}, {"real": 0, "est": 0}
    for r in U:
        s = r["sym"]
        if s not in W:
            continue
        mk = mercado_de(r)
        v, q, _, b = scenario_values(W[s], fac, sig, idx_ret.get(mk), idx_cri.get(mk), mk)
        for j, x in enumerate(v):   # última barrera: nada fuera de lo posible llega a la web
            if x is not None and not -99 < x < 400:
                v[j], q[j] = None, None
        if all(x is None for x in v):
            continue
        V[s] = {"m": mk, "v": v, "q": q, "b": round(b, 2) if b is not None else None}
        cnt["real"] += sum(1 for x in q[:len(CRISIS)] if x == 1)
        cnt["est"] += sum(1 for x in q[:len(CRISIS)] if x == 0.5)
    S["valores"] = V
    log(f"Valores: {len(V)} de {len(U)} · crisis con dato real {cnt['real']}, estimadas {cnt['est']}")
    # divisas
    FX = {}
    for c, t in fx_t.items():
        if t not in W:
            ERRORS.append({"fuente": "Yahoo Finance", "serie": t, "motivo": "sin cambio semanal"})
            continue
        wk = W[t]
        inv = [(d, 1 / x) for d, x in wk]   # euros por unidad de la divisa
        cri = [crisis_return(inv, date.fromisoformat(a), date.fromisoformat(b)) for _, _, a, b, _ in CRISIS]
        rr = np.diff(np.log([x for _, x in inv[-53:]])) if len(inv) > 53 else np.array([])
        FX[c] = {"crisis": cri, "vol1a": round(float(rr.std() * math.sqrt(52) * 100), 1) if len(rr) else None,
                 "serie": [[d.isoformat(), round(x, 6)] for d, x in inv if d >= (NOW.date() - timedelta(days=5 * 366))],
                 "fuente": f"Yahoo ({t})"}
    FX["GBp"] = dict(FX["GBP"]) if "GBP" in FX else None
    if FX.get("GBp"):
        FX["GBp"]["centimos"] = True
    T = tipos_cortos()
    for c, x in FX.items():
        if x and c.upper()[:3] in T and "EUR" in T:
            x["tipo3m"] = T[c.upper()[:3]]["valor"]
            x["cubrir"] = round(T[c.upper()[:3]]["valor"] - T["EUR"]["valor"], 2)
    dol = next((e for e in esc if e["id"] == "dolar"), None)
    S["divisas"] = {"fx": {k: v for k, v in FX.items() if v}, "tipos3m": T, "dolar_choque": round(simple(2 * sig["dolar"]), 1) if "dolar" in sig else None,
                    "nota": "Cubrir una divisa cuesta (o rinde) aproximadamente la diferencia entre su tipo a 3 meses y el del euro, al año."}
    if dol is not None and "dolar" in sig:
        dol["traslacion"] = S["divisas"]["dolar_choque"]
    log(f"Divisas: {len(FX)} · tipos a 3 m: " + ", ".join(f"{k} {v['valor']}" for k, v in T.items()))
    S["sigma"] = {k: round(v, 3) for k, v in sig.items()}
    out = os.path.join(DATA, "stress.json")
    with open(out, "w") as f:
        json.dump(S, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    log(f"stress.json escrito · {len(I)} bolsas · {len(V)} valores · {len(ERRORS)} errores")


if __name__ == "__main__":
    main()
