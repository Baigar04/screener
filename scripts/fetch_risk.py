#!/usr/bin/env python3
"""Riesgo de mercado y ciclo IA (hoja de ruta definitiva, fase 1) → data/risk.json.

Qué calcula
  1. Termómetro: probabilidad de que el IBEX 35 caiga más de un 15 % en los 12 meses siguientes.
     Señales públicas con historia larga (Fed, FRED, BCE, Shiller) → percentil «a fecha» de cada una
     (solo con lo publicado hasta ese mes, con el retraso real de publicación) → regresión logística
     con penalización, estimada «walk-forward» (en cada mes solo con meses cuyo resultado a 12 m ya se conocía).
     Precisión: Brier frente a la tasa base, error de calibración, caídas avisadas, falsas alarmas e intervalo
     por remuestreo de bloques de 12 meses.
  2. Ciclo IA: inversión (capex), flujo de caja libre y deuda trimestrales de Microsoft, Alphabet, Amazon y Meta
     desde la SEC (XBRL companyfacts) y fase del ciclo con reglas explícitas.

Reglas: cada señal lleva fuente, url, frecuencia, fecha del último dato e inicio de su historia. Si una fuente falla,
se registra el error y la señal queda fuera (nunca se inventa). La probabilidad solo se publica como «validada» si
mejora a la tasa base fuera de muestra y está calibrada; si no, se dice «sin ventaja demostrada».
"""
import csv
import io
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

import numpy as np

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
UA_WEB = "Mozilla/5.0 (screener personal; contacto: github.com/Baigar04)"
UA_SEC = os.environ.get("SEC_UA", "").strip()
NOW = datetime.now(timezone.utc)
ERRORS = []

CAIDA = 0.15          # caída que define el «evento»
HORIZONTE = 12        # meses
INICIO_WF = "2001-01"  # primer mes con previsión fuera de muestra
MIN_HIST = 36         # meses mínimos de historia de una señal para dar percentil
L2 = 10.0             # penalización de la logística (fuerte: solo ~18 caídas independientes desde 1993)
N_BOOT = 60           # remuestreos para el intervalo
MIN_SKILL = 0.03      # mejora mínima del Brier sobre la tasa base para darlo por validado (3 %)
EXAMEN = "2016-01"    # examen único (fase 1d): solo cuentan las previsiones desde este mes, que no se usaron para diseñar nada


def log(*a):
    print(*a, flush=True)


def http_get(url, ua=UA_WEB, tries=3, timeout=60):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"{type(last).__name__}: {last}")


def pdate(s):
    s = s.strip()
    for f in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m", "%b %d, %Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s[:12] if f == "%b %d, %Y" else s[:10], f).date()
        except ValueError:
            continue
    raise ValueError(s)


# ---------------------------------------------------------------- utilidades de meses
def ym(d):
    return f"{d.year:04d}-{d.month:02d}"


def ym_add(s, n):
    y, m = int(s[:4]), int(s[5:7]) - 1 + n
    return f"{y + m // 12:04d}-{m % 12 + 1:02d}"


def months_between(a, b):
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def monthly(obs, lag=0):
    """Serie diaria/semanal/mensual/trimestral → último valor de cada mes, desplazado `lag` meses
    (retraso de publicación: el dato de un mes se conoce `lag` meses después)."""
    out = {}
    for d, v in sorted(obs):
        out[ym(d)] = v
    if lag:
        out = {ym_add(k, lag): v for k, v in out.items()}
    return out


def ffill(series, months):
    """Rellena hacia delante (máx. 6 meses: datos trimestrales con retraso)."""
    out, last, age = {}, None, 99
    for m in months:
        if m in series:
            last, age = series[m], 0
        else:
            age += 1
        out[m] = last if last is not None and age <= 6 else None
    return out


# ---------------------------------------------------------------- fuentes
def fred(sid):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=1950-01-01"
    rows = list(csv.reader(io.StringIO(http_get(url))))
    obs = []
    for r in rows[1:]:
        if len(r) >= 2 and r[1] not in (".", ""):
            try:
                obs.append((pdate(r[0]), float(r[1])))
            except ValueError:
                pass
    if not obs:
        raise RuntimeError("CSV sin observaciones")
    return obs


def ecb(key):
    flow, rest = key.split(".", 1)
    url = f"https://data-api.ecb.europa.eu/service/data/{flow}/{rest}?format=csvdata&startPeriod=1980-01-01"
    rdr = csv.DictReader(io.StringIO(http_get(url)))
    obs = []
    for r in rdr:
        v = r.get("OBS_VALUE", "")
        if v not in ("", "NaN"):
            obs.append((pdate(r["TIME_PERIOD"]), float(v)))
    if not obs:
        raise RuntimeError("Respuesta sin observaciones")
    return sorted(obs)


def fed_ebp():
    txt = http_get("https://www.federalreserve.gov/econres/notes/feds-notes/ebp_csv.csv")
    rdr = csv.DictReader(io.StringIO(txt))
    obs = []
    for r in rdr:
        k = {x.lower().strip(): x for x in r}
        d, v = r.get(k.get("date", ""), ""), r.get(k.get("ebp", ""), "")
        if d and v not in ("", "NA", "NaN"):
            obs.append((pdate(d), float(v)))
    if not obs:
        raise RuntimeError("CSV del EBP sin observaciones (¿cambió el formato?)")
    return sorted(obs)


def shiller_cape():
    """CAPE mensual de Shiller: hoja pública de Yale (ie_data.xls); si falla, tabla de multpl.com."""
    import pandas as pd
    try:
        req = urllib.request.Request("http://www.econ.yale.edu/~shiller/data/ie_data.xls", headers={"User-Agent": UA_WEB})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
        t = pd.read_excel(io.BytesIO(raw), sheet_name="Data", header=7, engine="xlrd")
        obs = []
        for d, v in zip(t["Date"], t["CAPE"]):
            try:
                y, m = str(d).split(".")
                m = int(round(float("0." + m) * 100)) if len(m) <= 2 else int(m[:2])
                obs.append((date(int(y), max(1, min(12, m)), 1), float(v)))
            except (ValueError, TypeError):
                continue
        if len(obs) > 100:
            return sorted(obs)
    except Exception as e:  # noqa: BLE001
        log("CAPE: Yale no disponible:", str(e)[:120])
    html = http_get("https://www.multpl.com/shiller-pe/table/by-month", ua="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
    t = pd.read_html(io.StringIO(html))[0]
    obs = []
    for d, v in zip(t.iloc[:, 0], t.iloc[:, 1]):
        try:
            num = float(str(v).replace("estimate", "").replace("†", "").strip().split()[0])
            obs.append((pdate(str(d)), num))
        except (ValueError, IndexError):
            continue
    if len(obs) < 100:
        raise RuntimeError("Tabla del CAPE incompleta")
    return sorted(obs)


def ratio(a, b, k=1.0):
    bm = dict(b)
    out = []
    for d, v in a:
        if d in bm and bm[d]:
            out.append((d, k * v / bm[d]))
    if not out:
        raise RuntimeError("sin fechas comunes")
    return out


def diff(a, b):
    bm = {ym(d): v for d, v in b}
    return [(d, v - bm[ym(d)]) for d, v in a if ym(d) in bm]


# Catálogo: clave, nombre, velocidad, fuente, url, frecuencia, retraso (meses), sentido (+1 = más alto, más riesgo),
#           en_modelo, función de descarga. Ámbito (AMBITO): «global» entra en todas las bolsas; «europa», «es» e «it» solo donde aplican.
AMBITO = {"ciss": "europa", "prima_es": "es", "prima_it": "it"}

# Bolsas: clave, nombre, ticker de Yahoo, región (para las señales propias), sesiones mínimas
MERCADOS = [
    ("sp500", "S&P 500", "^GSPC", "us"),
    ("ndx", "Nasdaq 100", "^NDX", "us"),
    ("sx5e", "Euro Stoxx 50", "^STOXX50E", "europa"),
    ("dax", "DAX", "^GDAXI", "europa"),
    ("cac", "CAC 40", "^FCHI", "europa"),
    ("ftse", "FTSE 100", "^FTSE", "uk"),
    ("ibex", "IBEX 35", "^IBEX", "es"),
    ("mib", "FTSE MIB", "FTSEMIB.MI", "it"),
    ("n225", "Nikkei 225", "^N225", "asia"),
    ("hsi", "Hang Seng", "^HSI", "asia"),
    ("eem", "MSCI Emergentes (EEM)", "EEM", "em"),
]


def usa_senal(k, region):
    a = AMBITO.get(k, "global")
    if a == "global":
        return True
    if a == "europa":
        return region in ("europa", "es", "it")
    return a == region
def catalogo():
    return [
        ("cape", "CAPE de Shiller (EE. UU.)", "lenta", "Robert Shiller, Yale (vía multpl.com)", "https://shillerdata.com/", "mensual", 1, +1, True,
         shiller_cape),
        ("cap_pib", "Capitalización / PIB (EE. UU.)", "lenta", "Fed, cuentas financieras Z.1 + BEA (FRED)", "https://fred.stlouisfed.org/series/NCBEILQ027S", "trimestral", 3, +1, True,
         lambda: ratio(fred("NCBEILQ027S"), fred("GDP"), 1 / 10)),
        ("ebp", "Prima de exceso de bonos (EBP)", "media", "Fed · Gilchrist-Zakrajšek", "https://www.federalreserve.gov/econres/notes/feds-notes/updating-the-recession-risk-and-the-excess-bond-premium-20161006.html", "mensual", 1, +1, True,
         fed_ebp),
        ("baa", "Diferencial Baa − bono 10 a (EE. UU.)", "media", "Moody's vía FRED", "https://fred.stlouisfed.org/series/BAA10Y", "diario", 0, +1, True,
         lambda: fred("BAA10Y")),
        ("hy", "Diferencial high yield EE. UU.", "media", "ICE BofA vía FRED", "https://fred.stlouisfed.org/series/BAMLH0A0HYM2", "diario", 0, +1, False,
         lambda: fred("BAMLH0A0HYM2")),
        ("ciss", "Estrés sistémico zona euro (CISS)", "media", "BCE", "https://data.ecb.europa.eu/data/datasets/CISS/CISS.D.U2.Z0Z.4F.EC.SS_CIN.IDX", "diario", 0, +1, True,
         lambda: ecb("CISS.D.U2.Z0Z.4F.EC.SS_CIN.IDX")),
        ("prima_es", "Prima de riesgo España (10 a − Bund)", "media", "BCE (rendimientos de convergencia)", "https://data.ecb.europa.eu/data/datasets/IRS", "mensual", 1, +1, True,
         lambda: [(d, v * 100) for d, v in diff(ecb("IRS.M.ES.L.L40.CI.0000.EUR.N.Z"), ecb("IRS.M.DE.L.L40.CI.0000.EUR.N.Z"))]),
        ("prima_it", "Prima de riesgo Italia (10 a − Bund)", "media", "BCE (rendimientos de convergencia)", "https://data.ecb.europa.eu/data/datasets/IRS", "mensual", 1, +1, True,
         lambda: [(d, v * 100) for d, v in diff(ecb("IRS.M.IT.L.L40.CI.0000.EUR.N.Z"), ecb("IRS.M.DE.L.L40.CI.0000.EUR.N.Z"))]),
        ("margen", "Crédito de margen / capitalización", "media", "Fed, cuentas financieras Z.1 (FRED)", "https://fred.stlouisfed.org/series/BOGZ1FL663067003Q", "trimestral", 3, +1, True,
         lambda: ratio(fred("BOGZ1FL663067003Q"), fred("NCBEILQ027S"), 100)),
        ("curva", "Curva 10 a − 3 m (EE. UU.)", "media", "Tesoro de EE. UU. vía FRED", "https://fred.stlouisfed.org/series/T10Y3M", "diario", 0, -1, True,
         lambda: fred("T10Y3M")),
        ("sahm", "Regla de Sahm (paro EE. UU.)", "media", "FRED", "https://fred.stlouisfed.org/series/SAHMREALTIME", "mensual", 1, +1, True,
         lambda: fred("SAHMREALTIME")),
        ("vix", "VIX", "rapida", "Cboe vía FRED", "https://fred.stlouisfed.org/series/VIXCLS", "diario", 0, +1, True,
         lambda: fred("VIXCLS")),
        ("nfci", "Condiciones financieras (NFCI)", "rapida", "Fed de Chicago (FRED)", "https://fred.stlouisfed.org/series/NFCI", "semanal", 0, +1, True,
         lambda: fred("NFCI")),
    ]


# ---------------------------------------------------------------- cálculo
def pct_point_in_time(series, months, sentido):
    """Percentil «a fecha» (0-1) orientado a riesgo: en cada mes, posición del valor frente a toda su historia
    publicada hasta ese mes. None si hay menos de MIN_HIST meses."""
    out, hist = {}, []
    for m in months:
        v = series.get(m)
        if v is None:
            out[m] = None
            continue
        hist.append(v)
        if len(hist) < MIN_HIST:
            out[m] = None
            continue
        arr = np.asarray(hist)
        p = (np.sum(arr < v) + 0.5 * np.sum(arr == v)) / len(arr)
        out[m] = float(p if sentido > 0 else 1 - p)
    return out


class plazo:
    """Fija temporalmente el horizonte (meses) y la caída del «evento»: 12 meses y 15 % por defecto; 3 meses y 10 % para el corto plazo."""
    def __init__(self, meses, caida):
        self.v = (meses, caida)

    def __enter__(self):
        global HORIZONTE, CAIDA
        self.old = (HORIZONTE, CAIDA)
        HORIZONTE, CAIDA = self.v

    def __exit__(self, *a):
        global HORIZONTE, CAIDA
        HORIZONTE, CAIDA = self.old


# Plazo corto (fase 1d, fijado antes del examen): caída >10 % en 3 meses con volatilidad, crédito y tendencia.
CORTO = (3, 0.10)
SENALES_CORTO = ("vix", "vol_idx", "tendencia", "nfci", "ebp", "ebp_6m", "baa", "ciss")


def labels(daily, months):
    """1 si el IBEX cae más de CAIDA desde el cierre del mes en algún momento de los HORIZONTE meses siguientes."""
    by_m = {}
    for d, c in daily:
        by_m.setdefault(ym(d), []).append(c)
    last = max(by_m) if by_m else None
    out = {}
    for m in months:
        if m not in by_m or last is None or months_between(m, last) < HORIZONTE:
            out[m] = None
            continue
        c0 = by_m[m][-1]
        mn = min(min(by_m.get(ym_add(m, k), [c0])) for k in range(1, HORIZONTE + 1))
        out[m] = 1 if mn <= c0 * (1 - CAIDA) else 0
    return out


def episodes(daily):
    """Caídas de más de CAIDA desde el máximo de los 12 meses anteriores: [(mes del máximo, mes del mínimo, caída)].
    Un episodio nuevo solo cuenta si han pasado 12 meses desde el anterior (si no, es la misma caída)."""
    from collections import deque
    dias = int(HORIZONTE * 30.44)
    eps, win, last_trig = [], deque(), None
    for i, (d, c) in enumerate(daily):
        while win and (d - daily[win[0]][0]).days > dias:
            win.popleft()
        while win and daily[win[-1]][1] <= c:
            win.pop()
        win.append(i)
        pk = win[0]
        if c <= daily[pk][1] * (1 - CAIDA) and (last_trig is None or (d - last_trig).days > dias):
            last_trig = d
            tr = min(range(i, len(daily)), key=lambda k: daily[k][1] if (daily[k][0] - d).days <= dias else float("inf"))
            eps.append((ym(daily[pk][0]), ym(daily[tr][0]), round(daily[tr][1] / daily[pk][1] - 1, 3)))
    return eps


def logit_fit(X, y, l2=L2, iters=50):
    """Regresión logística con penalización L2 (sin penalizar la constante), por Newton."""
    n, k = X.shape
    Xb = np.hstack([np.ones((n, 1)), X])
    w = np.zeros(k + 1)
    P = np.eye(k + 1) * l2
    P[0, 0] = 0
    for _ in range(iters):
        z = np.clip(Xb @ w, -30, 30)
        p = 1 / (1 + np.exp(-z))
        g = Xb.T @ (p - y) + P @ w
        Hs = (Xb * (p * (1 - p))[:, None]).T @ Xb + P + 1e-9 * np.eye(k + 1)
        step = np.linalg.solve(Hs, g)
        w -= step
        if np.max(np.abs(step)) < 1e-8:
            break
    return w


def logit_pred(w, X):
    z = np.clip(np.hstack([np.ones((X.shape[0], 1)), X]) @ w, -30, 30)
    return 1 / (1 + np.exp(-z))


def boot_interval(X, y, xnow, rng, reps=N_BOOT, block=12):
    n = len(y)
    if n < 2 * block:
        return None, None
    starts = np.arange(0, n - block + 1)
    preds = []
    for _ in range(reps):
        idx = np.concatenate([np.arange(s, s + block) for s in rng.choice(starts, size=n // block)])
        yb = y[idx]
        if yb.sum() < 2 or yb.sum() > len(yb) - 2:
            continue
        preds.append(float(logit_pred(logit_fit(X[idx], yb), xnow[None, :])[0]))
    if len(preds) < 10:
        return None, None
    return float(np.percentile(preds, 5)), float(np.percentile(preds, 95))


def _metrics(p, y, base):
    p, y, base = np.asarray(p), np.asarray(y), np.asarray(base)
    if len(p) == 0:
        return None
    b, bb = float(np.mean((p - y) ** 2)), float(np.mean((base - y) ** 2))
    ece, tabla = calib_error(p, y)
    return {"brier": round(b, 3), "brier_base": round(bb, 3), "skill": round((1 - b / bb) * 100, 1) if bb else 0.0,
            "ece": round(ece * 100, 1), "meses": int(len(p)), "eventos": int(np.sum(y)), "calibracion": tabla}


def calib_error(p, y, bins=10):
    p, y = np.asarray(p), np.asarray(y)
    idx = np.minimum((p * bins).astype(int), bins - 1)
    err, tab = 0.0, []
    for b in range(bins):
        m = idx == b
        if m.sum() == 0:
            continue
        err += m.sum() / len(p) * abs(p[m].mean() - y[m].mean())
        tab.append([round(float(p[m].mean()) * 100, 1), round(float(y[m].mean()) * 100, 1), int(m.sum())])
    return err, tab


def signal_track(pcts, eps, months, thr=0.8):
    """Historial de una señal sola: aviso = percentil de riesgo ≥ thr. Caída avisada si hubo aviso entre 12 y 1 meses
    antes del máximo previo a la caída. Falsa alarma = tramo de aviso sin caída que empiece en los 12 meses siguientes."""
    first = next((m for m in months if pcts.get(m) is not None), None)
    if first is None:
        return None
    ev = [e for e in eps if e[0] >= ym_add(first, 12)]
    avisadas, leads = 0, []
    for pk, _, _ in ev:
        win = [m for m in months if 1 <= months_between(m, pk) <= HORIZONTE and (pcts.get(m) or 0) >= thr]
        if win:
            avisadas += 1
            leads.append(months_between(win[0], pk))
    tramos, cur = [], None
    for m in months:
        on = (pcts.get(m) or 0) >= thr
        if on and cur is None:
            cur = m
        if not on and cur is not None:
            tramos.append(cur)
            cur = None
    if cur:
        tramos.append(cur)
    last = months[-1]
    falsas = [t for t in tramos if months_between(t, last) >= HORIZONTE and not any(0 <= months_between(t, pk) <= HORIZONTE for pk, _, _ in eps)]
    return {"n": len(ev), "avisadas": avisadas, "avisos": len(tramos), "falsas": len(falsas),
            "antelacion": round(float(np.median(leads)), 0) if leads else None}


def lectura(p, sentido):
    if p is None:
        return "Sin historia suficiente"
    q = p * 100
    if q >= 90:
        return "Extremo"
    if q >= 70:
        return "Alto"
    if q >= 30:
        return "Normal"
    return "Bajo"


def index_daily(ticker, nombre):
    import yfinance as yf
    df = yf.download(ticker, period="max", interval="1d", auto_adjust=False, progress=False)
    if df is None or df.empty:
        raise RuntimeError(f"Yahoo sin datos de {nombre}")
    c = df["Close"]
    if hasattr(c, "columns"):
        c = c.iloc[:, 0]
    out = [(d.date(), float(v)) for d, v in c.dropna().items() if v > 0 and d.year >= 1960]
    if len(out) < 2000:
        raise RuntimeError(f"historia corta de {nombre} ({len(out)} sesiones)")
    return out


def thermometer(raw, daily, nombre="IBEX 35", solo=None):
    """raw: {clave: (meta, obs)}; daily: [(fecha, cierre)] del índice. solo: claves de señales permitidas en el modelo."""
    last_m = ym(daily[-1][0])
    first_m = max("1990-01", ym(daily[0][0]))
    inicio_wf = max(INICIO_WF, ym_add(first_m, 96))   # al menos 8 años de historia antes de la primera previsión
    months = []
    m = "1990-01"
    while m <= last_m:
        months.append(m)
        m = ym_add(m, 1)
    feats, metas = [], []
    for k, (meta, obs) in raw.items():
        if solo is not None and k not in solo:
            continue
        meta = dict(meta)
        ser = ffill(monthly(obs, meta["retraso"]), months)
        meta["pcts"] = pct_point_in_time(ser, months, meta["sentido"])
        metas.append(meta)
        if meta["modelo"]:
            feats.append(meta)
    y = labels(daily, months)
    eps = [e for e in episodes(daily) if e[0] >= first_m]

    def xrow(mo):
        return np.array([(f["pcts"].get(mo) if f["pcts"].get(mo) is not None else 0.5) - 0.5 for f in feats])

    rng = np.random.default_rng(20261125)
    hist = []
    wf_p, wf_y, wf_base, wf_m = [], [], [], []
    for mo in months:
        if mo < inicio_wf:
            continue
        train = [s for s in months if s < mo and y.get(s) is not None and months_between(s, mo) >= HORIZONTE]
        ys = np.array([y[s] for s in train], dtype=float)
        if len(train) < 60 or ys.sum() < 6:
            continue
        X = np.array([xrow(s) for s in train])
        w = logit_fit(X, ys)
        p = float(logit_pred(w, xrow(mo)[None, :])[0])
        base = float(ys.mean())
        lo = hi = None
        if mo[5:7] in ("01", "04", "07", "10") or mo == last_m:
            lo, hi = boot_interval(X, ys, xrow(mo), rng, reps=25 if mo != last_m else N_BOOT)
        hist.append([mo, round(p * 100, 1), None if lo is None else round(lo * 100, 1), None if hi is None else round(hi * 100, 1), round(base * 100, 1)])
        if y.get(mo) is not None:
            wf_p.append(p)
            wf_y.append(y[mo])
            wf_base.append(base)
            wf_m.append(mo)
    if not hist:
        raise RuntimeError("sin meses suficientes para estimar")
    # modelo final con todos los meses etiquetados (pesos y aportaciones de hoy)
    train = [s for s in months if y.get(s) is not None]
    X = np.array([xrow(s) for s in train])
    ys = np.array([y[s] for s in train], dtype=float)
    w = logit_fit(X, ys)
    sd = X.std(axis=0)
    imp = np.abs(w[1:]) * sd
    pesos = imp / imp.sum() if imp.sum() > 0 else imp
    xnow = xrow(last_m)
    p_now, base_now = hist[-1][1], round(float(ys.mean()) * 100, 1)
    lo_now, hi_now = hist[-1][2], hist[-1][3]

    wf_p, wf_y, wf_base = np.array(wf_p), np.array(wf_y), np.array(wf_base)
    brier = float(np.mean((wf_p - wf_y) ** 2))
    brier_b = float(np.mean((wf_base - wf_y) ** 2))
    ece, tabla = calib_error(wf_p, wf_y)
    t_alert = round(base_now + max(10.0, 0.4 * base_now))   # alerta: claramente por encima de la frecuencia histórica
    t_tens = base_now
    # avisos del termómetro (fuera de muestra)
    hp = {h[0]: h[1] / 100 for h in hist}
    trk = signal_track(hp, eps, months, thr=t_alert / 100)
    falsas_y = []
    if trk:
        cur = None
        for mo in months:
            on = hp.get(mo, 0) >= t_alert / 100
            if on and cur is None:
                cur = mo
            if not on and cur is not None:
                if months_between(cur, last_m) >= HORIZONTE and not any(0 <= months_between(cur, pk) <= HORIZONTE for pk, _, _ in eps):
                    falsas_y.append(cur[:4])
                cur = None
    ex = [i for i, m in enumerate(wf_m) if m >= EXAMEN]
    ds = [i for i, m in enumerate(wf_m) if m < EXAMEN]
    E = _metrics(wf_p[ex], wf_y[ex], wf_base[ex]) if ex else None
    Dd = _metrics(wf_p[ds], wf_y[ds], wf_base[ds]) if ds else None
    validado = bool(E and E["skill"] >= MIN_SKILL * 100 and E["ece"] < 10 and E["meses"] >= 60)
    fin = last_m[:4]
    if validado:
        motivo = f"En el examen {EXAMEN[:4]}-{fin} mejora a la media un {E['skill']:.1f} % y está calibrada".replace(".", ",")
    elif not E or E["meses"] < 60:
        motivo = "Sin meses suficientes en el examen"
    elif E["skill"] <= 0:
        motivo = f"En el examen {EXAMEN[:4]}-{fin} no mejora a la media histórica"
    elif E["skill"] < MIN_SKILL * 100:
        motivo = f"En el examen {EXAMEN[:4]}-{fin} mejora a la media solo un {E['skill']:.1f} % (mínimo exigido: {MIN_SKILL * 100:.0f} %)".replace(".", ",")
    else:
        motivo = f"Descalibrada en el examen (error medio {E['ece']:.1f} pp)".replace(".", ",")
    regimen = "Alerta" if p_now >= t_alert else "Tensión" if p_now >= t_tens else "Normal"
    since = next((m for m in months if hist and m == hist[0][0]), None)
    senales = []
    for i, f in enumerate(metas):
        cur = f["pcts"].get(last_m)
        j = feats.index(f) if f in feats else None
        senales.append({k: f[k] for k in ("k", "nombre", "vel", "fuente", "url", "frec", "sentido", "modelo")} | {
            "ultimo": f["ultimo"], "desde": f["desde"],
            "pct": None if cur is None else round(cur * 100),
            "peso": None if j is None else round(float(pesos[j]) * 100, 1),
            "signo": None if j is None else (1 if w[1 + j] > 0 else -1),
            "aporta": None if j is None else round(float(w[1 + j] * xnow[j]), 3),
            "lectura": lectura(cur, f["sentido"]) if cur is not None or f["modelo"] else "Dato desactualizado",
            "historial": signal_track(f["pcts"], eps, months) if f["modelo"] else None,
        })
    ibex_m = {}
    for d, c in daily:
        ibex_m[ym(d)] = c
    return {
        "objetivo": f"Probabilidad de que el {nombre} caiga más de un {int(CAIDA * 100)} % en algún momento de los {HORIZONTE} meses siguientes",
        "actual": {"mes": last_m, "p": p_now, "lo": lo_now, "hi": hi_now, "base": base_now, "regimen": regimen,
                   "validado": validado, "motivo": motivo},
        "horizonte": HORIZONTE, "caida": CAIDA,
        "umbrales": {"tension": t_tens, "alerta": t_alert},
        "precision": {"brier": E["brier"] if E else None, "brier_base": E["brier_base"] if E else None, "ece": E["ece"] if E else None,
                      "calibracion": E["calibracion"] if E else [], "meses_fuera_muestra": E["meses"] if E else 0,
                      "desde": hist[0][0], "examen_desde": EXAMEN, "examen": E, "diseno": Dd,
                      "caidas": trk["n"] if trk else None, "avisadas": trk["avisadas"] if trk else None,
                      "antelacion": trk["antelacion"] if trk else None, "falsas": sorted(set(falsas_y)),
                      "caidas_total": len(eps)},
        "hist": hist,
        "indice": [[k, round(v, 1)] for k, v in sorted(ibex_m.items()) if k >= first_m],
        "caidas": [[a, b, c] for a, b, c in eps],
        "senales": senales,
        "metodo": ("Percentil «a fecha» de cada señal (con su retraso de publicación) → regresión logística con penalización L2. "
                   f"Estimación «walk-forward» desde {inicio_wf[:4]}: cada mes solo usa meses cuyo resultado a {HORIZONTE} meses ya se conocía. "
                   f"Validación: examen único con las previsiones desde {EXAMEN[:4]}. Intervalo del 90 % por remuestreo de bloques de 12 meses. "
                   "Señales sin dato en un mes cuentan como neutras."),
    }


# ---------------------------------------------------------------- ciclo IA (SEC)
HYPER = {"MSFT": 789019, "GOOGL": 1652044, "AMZN": 1018724, "META": 1326801}
CAPEX_TAGS = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]
CFO_TAGS = ["NetCashProvidedByUsedInOperatingActivities"]


def facts_dur(facts, tags):
    """Valores de flujo trimestrales a partir de acumulados del ejercicio (10-Q/10-K): {fin: valor 3 meses}."""
    best = None
    for t in tags:
        u = facts.get("us-gaap", {}).get(t, {}).get("units", {}).get("USD", [])
        if u and (best is None or max(x["end"] for x in u) > max(x["end"] for x in best)):
            best = u
    if not best:
        return {}
    dd = {}
    for x in best:
        if x.get("form") not in ("10-Q", "10-K", "10-Q/A", "10-K/A") or "start" not in x:
            continue
        key = (x["start"], x["end"])
        if key not in dd or x.get("filed", "") > dd[key].get("filed", ""):
            dd[key] = x
    by_start = {}
    for (s, e), x in dd.items():
        by_start.setdefault(s, []).append((e, x["val"]))
    q = {}
    for s, lst in by_start.items():
        lst.sort()
        prev_e, prev_v = s, 0.0
        for e, v in lst:
            dur = (date.fromisoformat(e) - date.fromisoformat(prev_e)).days
            if 80 <= dur <= 100:
                q.setdefault(e, v - prev_v)
            prev_e, prev_v = e, v
    return q


def facts_debt(facts):
    g = facts.get("us-gaap", {})

    def inst(t):
        out = {}
        for x in g.get(t, {}).get("units", {}).get("USD", []):
            if x.get("form", "").startswith("10-") and "start" not in x:
                if x["end"] not in out or x.get("filed", "") > out[x["end"]][1]:
                    out[x["end"]] = (x["val"], x.get("filed", ""))
        return {k: v[0] for k, v in out.items()}
    ltd, nc, cur, cp = inst("LongTermDebt"), inst("LongTermDebtNoncurrent"), inst("LongTermDebtCurrent"), inst("CommercialPaper")
    ends = set(ltd) | set(nc)
    out = {}
    for e in ends:
        v = ltd.get(e)
        if v is None:
            v = nc.get(e, 0) + cur.get(e, 0)
        out[e] = v + cp.get(e, 0)
    return out


def qlabel(e):
    d = date.fromisoformat(e)
    return f"{(d.month - 1) // 3 + 1}T{str(d.year)[2:]}"


def qkey(e):
    d = date.fromisoformat(e)
    return f"{d.year}Q{(d.month - 1) // 3 + 1}"


def fase_ia(g_capex, g_fcf):
    if g_capex is None or g_fcf is None:
        return None
    if g_capex < 0:
        return "Contracción"
    if g_fcf < 0:
        return "Digestión"
    if g_capex > 25:
        return "Euforia"
    return "Expansión"


def ai_cycle():
    if not UA_SEC:
        raise RuntimeError("falta SEC_UA")
    per = {}
    for sym, cik in HYPER.items():
        j = json.loads(http_get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", ua=UA_SEC))
        f = j.get("facts", {})
        cap, cfo, debt = facts_dur(f, CAPEX_TAGS), facts_dur(f, CFO_TAGS), facts_debt(f)
        rows = {}
        for e in set(cap) & set(cfo):
            rows[qkey(e)] = {"fin": e, "capex": cap[e] / 1e9, "cfo": cfo[e] / 1e9, "deuda": (debt.get(e) or 0) / 1e9}
        per[sym] = rows
        time.sleep(0.3)
    keys = sorted(set.intersection(*[set(v) for v in per.values()]))[-12:]
    tri = []
    for k in keys:
        cx = sum(per[s][k]["capex"] for s in per)
        cf = sum(per[s][k]["cfo"] for s in per)
        dt = sum(per[s][k]["deuda"] for s in per)
        tri.append({"q": k, "etq": qlabel(per["MSFT"][k]["fin"]), "capex": round(cx, 1), "fcf": round(cf - cx, 1), "cfo": round(cf, 1), "deuda": round(dt, 1)})
    if len(tri) < 8:
        raise RuntimeError(f"solo {len(tri)} trimestres comunes")
    s4 = lambda a, i: sum(t[a] for t in tri[i - 3:i + 1])
    n = len(tri) - 1
    g_capex = (s4("capex", n) / s4("capex", n - 4) - 1) * 100
    fcf_now, fcf_prev = s4("fcf", n), s4("fcf", n - 4)
    g_fcf = (fcf_now / fcf_prev - 1) * 100 if fcf_prev > 0 else None
    fase = fase_ia(g_capex, g_fcf)
    return {"empresas": list(HYPER), "trimestres": tri,
            "capex_12m": round(s4("capex", n), 1), "g_capex": round(g_capex, 1),
            "fcf_12m": round(fcf_now, 1), "g_fcf": None if g_fcf is None else round(g_fcf, 1),
            "capex_cfo": round(s4("capex", n) / s4("cfo", n) * 100, 1),
            "deuda": tri[-1]["deuda"], "deuda_12m": round(tri[-1]["deuda"] - tri[-5]["deuda"], 1),
            "fase": fase,
            "reglas": "Contracción: capex de 12 meses cae frente al año anterior. Digestión: capex sube pero el flujo de caja libre cae. "
                      "Euforia: capex sube más de un 25 % y el flujo de caja libre también sube. Expansión: el resto (capex y caja suben con moderación).",
            "fuente": "SEC, XBRL companyfacts de los 10-Q y 10-K (cálculo propio). Deuda financiera sin arrendamientos.",
            "trimestre": tri[-1]["etq"]}


def concentration():
    """Peso de los 10 mayores del S&P 500 y del bloque IA (Nvidia + 4 hiperescaladores) con el universo del screener."""
    try:
        u = json.load(open(os.path.join(DATA, "universe.json")))
    except (OSError, ValueError):
        return None
    sp = [r for r in u.get("filas", []) if "S&P 500" in (r.get("indices") or []) and r.get("mcap")]
    if len(sp) < 400:
        return None
    tot = sum(r["mcap"] for r in sp)
    top = sorted(sp, key=lambda r: -r["mcap"])[:10]
    ia = sum(r["mcap"] for r in sp if r["sym"] in ("NVDA", "MSFT", "GOOGL", "GOOG", "AMZN", "META"))
    return {"top10": round(sum(r["mcap"] for r in top) / tot * 100, 1), "ia": round(ia / tot * 100, 1),
            "top10_sym": [r["sym"] for r in top], "fecha": u.get("generado", "")[:10], "n": len(sp)}


def amplitude():
    try:
        a = json.load(open(os.path.join(DATA, "amplitud.json")))
    except (OSError, ValueError):
        return None
    out = {}
    for reg, x in (a.get("regiones") or {}).items():
        h = [r[2] for r in x.get("hist", []) if r[2] is not None]
        v = x.get("sobre_sma200")
        out[reg] = {"valor": v, "fecha": x.get("fecha"), "pct": round(sum(1 for z in h if z < v) / len(h) * 100) if h and v is not None else None}
    return out


def derivadas(daily, nombre, ticker):
    """Señales del propio índice: tendencia (frente a su media de 200 sesiones) y volatilidad de 3 meses,
    clásicas en la literatura de riesgo de caídas."""
    c = np.array([x[1] for x in daily])
    dts = [x[0] for x in daily]
    tend = [(dts[i], (c[i] / c[i - 200:i].mean() - 1) * 100) for i in range(200, len(c))]
    r = np.diff(np.log(c))
    vol = [(dts[i + 1], float(r[i - 62:i + 1].std() * math.sqrt(252) * 100)) for i in range(62, len(r))]
    url = f"https://finance.yahoo.com/quote/{urllib.parse.quote(ticker)}/"
    meta = lambda k, n, s, o: {"k": k, "nombre": n, "vel": "rapida", "fuente": f"Cálculo propio · {nombre} de Yahoo", "url": url, "frec": "diario",
                               "retraso": 0, "sentido": s, "modelo": True, "desde": o[0][0].isoformat()[:7],
                               "ultimo": {"fecha": o[-1][0].isoformat(), "valor": round(o[-1][1], 3)}}
    return {"tendencia": (meta("tendencia", f"{nombre} frente a su media de 200 sesiones", -1, tend), tend),
            "vol_idx": (meta("vol_idx", f"Volatilidad del {nombre} (3 meses)", +1, vol), vol)}


def ebp_change(raw):
    if "ebp" not in raw:
        return None
    o = raw["ebp"][1]
    ch = [(o[i][0], o[i][1] - o[i - 6][1]) for i in range(6, len(o))]
    m = dict(raw["ebp"][0])
    m.update({"k": "ebp_6m", "nombre": "Cambio del EBP en 6 meses", "fuente": "Cálculo propio · EBP de la Fed", "desde": ch[0][0].isoformat()[:7],
              "ultimo": {"fecha": ch[-1][0].isoformat(), "valor": round(ch[-1][1], 3)}})
    return m, ch


# ---------------------------------------------------------------- interpretación (reglas explícitas sobre los datos)
CREDITO = ("ebp", "ebp_6m", "baa", "ciss", "prima_es", "prima_it", "margen")
TECNO = ("sp500", "ndx", "n225", "hsi", "eem")


def _pct(T, k):
    s = next((x for x in T["senales"] if x["k"] == k), None)
    return None if s is None else s.get("pct")


def _val(T, k):
    s = next((x for x in T["senales"] if x["k"] == k), None)
    return None if s is None else s["ultimo"]["valor"]


def _f(x, d=0):
    return f"{x:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def interpret(T, ia, nombre, clave):
    """Lectura del termómetro (3 frases) y lectura conjunta de la página para una bolsa. Solo usa los datos de T e ia."""
    a, P = T["actual"], T["precision"]
    p, base, alerta = a["p"], a["base"], T["umbrales"]["alerta"]
    hz, cd = T.get("horizonte", 12), int(round(T.get("caida", 0.15) * 100))
    que = f"una caída de más del {cd} % en el {nombre} en los próximos {hz} meses"
    # 1 · nivel
    if p >= alerta:
        nivel = f"El riesgo de {que} está en zona de alerta: {_f(p)} % frente al {_f(base)} % habitual en este índice."
    elif p > base * 1.2:
        nivel = f"El riesgo de {que} es mayor de lo habitual: {_f(p)} % frente al {_f(base)} % de media histórica."
    elif p >= base * 0.8:
        nivel = f"El riesgo de {que} es similar al habitual: {_f(p)} % frente al {_f(base)} % de media histórica."
    else:
        nivel = f"El riesgo de {que} es menor de lo habitual: {_f(p)} % frente al {_f(base)} % de media histórica."
    # 2 · confianza
    E = P.get("examen") or {}
    if a["validado"]:
        conf = (f"El modelo está validado en este índice: en el examen {P.get('examen_desde', '2016')[:4]}-{a['mes'][:4]}, con datos que no se usaron para diseñarlo, "
                f"mejora a la media un {_f(E.get('skill', 0), 1)} % y está calibrado. "
                + (f"Desde {P['desde'][:4]} avisó de {P['avisadas']} de {P['caidas']} caídas con {len(P['falsas'])} falsas alarmas. " if P.get("caidas") else "")
                + f"Aun así, el intervalo va del {_f(a['lo'] or p)} % al {_f(a['hi'] or p)} %: es una orientación, no una certeza.")
    else:
        m = a["motivo"]
        conf = (f"En este índice el modelo no demuestra ventaja ({m[0].lower() + m[1:]}), así que la referencia fiable es la media histórica: {_f(base)} %. "
                f"La cifra del modelo es solo orientativa.")
    # 3 · qué la mueve
    contr = [s for s in T["senales"] if s.get("modelo") and s.get("aporta") is not None]
    up = sorted([s for s in contr if s["aporta"] > 0.02], key=lambda s: -s["aporta"])[:2]
    dn = sorted([s for s in contr if s["aporta"] < -0.02], key=lambda s: s["aporta"])[:2]
    nm = lambda s: f"{s['nombre']}, percentil {s['pct']}" if s.get("pct") is not None else s["nombre"]
    mueve = []
    if up:
        mueve.append("Lo que más empuja el riesgo al alza: " + " y ".join(nm(s) for s in up) + ".")
    if dn:
        mueve.append("Lo que más lo contiene: " + " y ".join(nm(s) for s in dn) + ".")
    termo = [nivel, conf, " ".join(mueve) or "Ninguna señal se aparta lo bastante de lo normal como para mover la cifra."]

    # lectura conjunta
    cred = [_pct(T, k) for k in CREDITO if k != "ebp_6m" and _pct(T, k) is not None]
    cm = sum(cred) / len(cred) if cred else None
    d_ebp = _val(T, "ebp_6m")
    if cm is None:
        c_txt, c_est = "Sin datos de crédito.", None
    elif cm >= 70:
        c_txt, c_est = f"El crédito está tenso (percentil medio {_f(cm)}): financiarse es caro para las empresas, la señal que más ha anticipado caídas.", "tenso"
    elif cm >= 45:
        c_txt, c_est = f"El crédito está en niveles normales (percentil medio {_f(cm)}).", "normal"
    else:
        c_txt, c_est = f"El crédito está tranquilo (percentil medio {_f(cm)}): las empresas se financian sin tensión.", "tranquilo"
    if d_ebp is not None and cm is not None:
        c_txt += " El EBP sube en los últimos 6 meses: conviene vigilarlo." if d_ebp > 0.1 else (" El EBP baja en los últimos 6 meses." if d_ebp < -0.1 else "")
    vp = _pct(T, "cap_pib")
    v_txt = (f"La valoración de la bolsa de EE. UU. está en el percentil {vp} de su historia: " + ("muy cara. " if vp >= 85 else "cara. " if vp >= 65 else "en niveles normales. ") +
             "Esto predice rentabilidades más bajas a varios años, pero casi no anticipa el momento de una caída.") if vp is not None else ""
    tend, vol = _val(T, "tendencia"), _pct(T, "vol_idx")
    m_txt = ""
    if tend is not None:
        m_txt = (f"El {nombre} cotiza un {_f(abs(tend), 1)} % " + ("por encima" if tend >= 0 else "por debajo") + " de su media de 200 sesiones (" +
                 ("tendencia alcista" if tend >= 2 else "tendencia bajista" if tend <= -2 else "sin tendencia clara") + ")")
        if vol is not None:
            m_txt += f" y su volatilidad está en el percentil {vol}" + (" (alta)" if vol >= 70 else " (baja)" if vol < 30 else "")
        m_txt += "."
    i_txt = ""
    if ia and ia.get("fase"):
        i_txt = f"Ciclo IA en {ia['fase']}: los grandes de la nube invierten un {_f(ia['g_capex'])} % más que hace un año"
        if ia.get("g_fcf") is not None:
            i_txt += f" y su flujo de caja libre cambia un {_f(ia['g_fcf'])} %"
        i_txt += "." + (" Pesa mucho en este índice por su exposición a tecnología." if clave in TECNO else " Afecta a este índice de forma indirecta (energía, industria, semiconductores europeos).")
    # conclusión
    riesgo_txt = ("en alerta" if p >= alerta else "por encima de lo habitual" if p > base * 1.2 else "en línea con lo habitual" if p >= base * 0.8 else "por debajo de lo habitual")
    puntos = []
    if c_est == "tenso":
        puntos.append("el crédito tenso")
    if vp is not None and vp >= 85:
        puntos.append("la valoración muy alta")
    if ia and ia.get("fase") in ("Digestión", "Contracción") and clave in TECNO:
        puntos.append(f"la fase de {ia['fase']} del ciclo IA")
    if tend is not None and tend <= -2:
        puntos.append("la tendencia bajista")
    concl = f"Riesgo a {hz} meses {riesgo_txt}" + (", sostenido por un crédito tranquilo" if c_est == "tranquilo" else "") + "."
    if puntos:
        lista = ", ".join(puntos[:-1]) + (" y " if len(puntos) > 1 else "") + puntos[-1]
        concl += (" Los puntos débiles son " if len(puntos) > 1 else " El punto débil es ") + lista
        lento = [x for x, c in (("la valoración", any("valoración" in p for p in puntos)), ("el ciclo IA", any("ciclo" in p for p in puntos))) if c]
        concl += (f"; {' y '.join(lento)} " + ("pesan" if len(lento) > 1 else "pesa") + f" más a varios años que en los próximos {hz} meses.") if lento else "."
    if not a["validado"]:
        concl += f" Como el modelo no está validado aquí, apóyate más en la media histórica ({_f(base)} %) que en la cifra del termómetro."
    vig = []
    for s in sorted([s for s in T["senales"] if s.get("modelo") and s.get("pct") is not None], key=lambda s: -(s.get("peso") or 0)):
        if 60 <= s["pct"] < 80 and (s.get("peso") or 0) >= 5:
            vig.append(f"{s['nombre']}: percentil {s['pct']}, cerca de zona de aviso (80).")
        if len(vig) >= 2:
            break
    if d_ebp is not None and d_ebp > 0.1:
        vig.append("El EBP sube: si pasa del percentil 70, el crédito empezaría a avisar.")
    if tend is not None and abs(tend) < 3:
        vig.append(f"El {nombre} está a menos de un 3 % de su media de 200 sesiones: un cruce a la baja cambiaría la tendencia.")
    if ia and ia.get("fase") == "Digestión":
        vig.append("Resultados de los grandes de la nube: un recorte de inversión llevaría el ciclo IA a Contracción.")
    if not vig:
        vig.append("Ninguna señal está cerca de su zona de aviso.")
    camb = [f"La lectura pasaría a «Tensión» si la probabilidad supera la media histórica ({_f(base)} %) y a «Alerta» por encima del {_f(alerta)} %."]
    top = sorted([s for s in T["senales"] if s.get("modelo") and s.get("peso")], key=lambda s: -s["peso"])[:2]
    if top:
        camb.append("Las señales que más mueven el termómetro de este índice son " + " y ".join(f"{s['nombre']} ({_f(s['peso'])} % del peso)" for s in top) + ".")
    return {"termometro": termo, "conjunta": {"conclusion": concl, "bloques": [x for x in (c_txt, v_txt, m_txt, i_txt) if x],
                                              "vigilar": vig[:4], "cambiaria": camb}}


def main():
    raw = {}
    for k, nombre, vel, fuente, url, frec, lag, sentido, modelo, fn in catalogo():
        try:
            obs = fn()
            edad = (NOW.date() - obs[-1][0]).days
            if edad > 270:   # dato desactualizado: se muestra, pero no entra en el modelo
                log(f"{k}: último dato {obs[-1][0]} ({edad} días): fuera del modelo por desactualizado")
                ERRORS.append({"fuente": fuente, "serie": nombre, "motivo": f"Dato desactualizado: el último es de {obs[-1][0].isoformat()[:7]}; no entra en el modelo"})
                modelo = False
            raw[k] = ({"k": k, "nombre": nombre, "vel": vel, "fuente": fuente, "url": url, "frec": frec, "retraso": lag,
                       "sentido": sentido, "modelo": modelo, "desde": obs[0][0].isoformat()[:7],
                       "ultimo": {"fecha": obs[-1][0].isoformat(), "valor": round(obs[-1][1], 3)}}, obs)
            log(f"{k}: {len(obs)} obs · {obs[0][0]} → {obs[-1][0]} = {obs[-1][1]:.3f}")
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": fuente, "serie": nombre, "motivo": str(e)[:200]})
            log(f"ERROR {k}: {e}")
    e6 = ebp_change(raw)
    if e6:
        raw["ebp_6m"] = e6
    out = {"generado": NOW.isoformat(timespec="seconds"), "errores": ERRORS}
    try:
        out["ia"] = ai_cycle()
        log("Ciclo IA:", out["ia"]["fase"], out["ia"]["trimestre"], "capex 12m", out["ia"]["capex_12m"], "g", out["ia"]["g_capex"], "FCF", out["ia"]["fcf_12m"], out["ia"]["g_fcf"])
    except Exception as e:  # noqa: BLE001
        ERRORS.append({"fuente": "SEC", "serie": "Ciclo IA", "motivo": str(e)[:200]})
        log("ERROR ciclo IA:", e)
    gpr_obs = None
    try:   # candidato de la fase 2: ¿mejora el GPR el examen del termómetro? Solo se informa; no entra en producción sin decisión.
        from fetch_geo import gpr_monthly
        gpr_obs = [(date(int(m[:4]), int(m[5:7]), 1), v) for m, v in gpr_monthly()["global"]]
    except Exception as e:  # noqa: BLE001
        log("GPR no disponible para la prueba:", e)
    mercados, orden = {}, []
    for clave, nombre, ticker, region in MERCADOS:
        t0 = time.time()
        try:
            daily = index_daily(ticker, nombre)
            sub = {k: v for k, v in raw.items() if usa_senal(k, region)}
            sub.update(derivadas(daily, nombre, ticker))
            if sum(1 for v in sub.values() if v[0]["modelo"]) < 5:
                raise RuntimeError("menos de 5 señales disponibles")
            T = thermometer(sub, daily, nombre)
            T.update({"clave": clave, "nombre": nombre, "ticker": ticker, "region": region, "inicio": daily[0][0].isoformat()})
            T["lectura"] = interpret(T, out.get("ia"), nombre, clave)
            if gpr_obs:
                try:
                    g = dict(sub)
                    g["gpr"] = ({"k": "gpr", "nombre": "Riesgo geopolítico (GPR)", "vel": "media", "fuente": "Caldara-Iacoviello", "url": "https://www.matteoiacoviello.com/gpr.htm",
                                 "frec": "mensual", "retraso": 1, "sentido": 1, "modelo": True, "desde": gpr_obs[0][0].isoformat()[:7],
                                 "ultimo": {"fecha": gpr_obs[-1][0].isoformat(), "valor": round(gpr_obs[-1][1], 1)}}, gpr_obs)
                    Tg = thermometer(g, daily, nombre)
                    Eg, E0 = Tg["precision"]["examen"] or {}, T["precision"]["examen"] or {}
                    T["prueba_gpr"] = {"sin": E0.get("skill"), "con": Eg.get("skill"), "ece_con": Eg.get("ece"), "valida_con": Tg["actual"]["validado"]}
                    log(f"   con GPR: examen {Eg.get('skill')} % (sin GPR {E0.get('skill')} %) · {'validaría' if Tg['actual']['validado'] else 'no validaría'}")
                except Exception as e:  # noqa: BLE001
                    log("   prueba GPR falló:", e)
            try:
                with plazo(*CORTO):
                    T3 = thermometer(sub, daily, nombre, solo=SENALES_CORTO)
                    T3.update({"clave": clave, "nombre": nombre})
                    T3["lectura"] = interpret(T3, out.get("ia"), nombre, clave)
                T["h3"] = {k: T3[k] for k in ("objetivo", "actual", "horizonte", "caida", "umbrales", "precision", "hist", "caidas", "senales", "metodo", "lectura")}
                a3, E3 = T3["actual"], T3["precision"]["examen"] or {}
                log(f"   3 meses: {a3['p']} % base {a3['base']} · {'VALIDADO' if a3['validado'] else 'sin ventaja'} · examen {E3.get('skill')} % · ECE {E3.get('ece')}")
            except Exception as e:  # noqa: BLE001
                ERRORS.append({"fuente": "Cálculo", "serie": f"Plazo de 3 meses {nombre}", "motivo": str(e)[:200]})
            mercados[clave] = T
            orden.append(clave)
            a, P = T["actual"], T["precision"]
            E, Dd = P.get("examen") or {}, P.get("diseno") or {}
            log(f"{nombre}: {a['p']} % [{a['lo']}-{a['hi']}] base {a['base']} · {a['regimen']} · {'VALIDADO' if a['validado'] else 'sin ventaja'} · "
                f"examen {E.get('skill')} % ECE {E.get('ece')} · diseño {Dd.get('skill')} % · avisadas {P['avisadas']}/{P['caidas']} · {time.time() - t0:.0f} s")
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            ERRORS.append({"fuente": "Yahoo / cálculo", "serie": f"Termómetro {nombre}", "motivo": str(e)[:200]})
    out["mercados"], out["orden"] = mercados, orden
    out["concentracion"] = concentration()
    out["amplitud"] = amplitude()
    if not mercados:
        log("Sin termómetros: no se escribe risk.json (se conserva el publicado)")
        sys.exit(0)
    os.makedirs(DATA, exist_ok=True)
    json.dump(out, open(os.path.join(DATA, "risk.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    log("risk.json escrito ·", len(mercados), "bolsas ·", len(ERRORS), "errores")


if __name__ == "__main__":
    main()
