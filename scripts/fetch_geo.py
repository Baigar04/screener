#!/usr/bin/env python3
"""Geopolítica (hoja de ruta definitiva, fase 2) → data/geo.json.

Qué calcula, todo con datos públicos y reglas explícitas:
  1. Índice de riesgo geopolítico (GPR) de Caldara e Iacoviello (Fed): global mensual desde 1985 (amenazas y actos),
     diario reciente y por país (44 países).
  2. Sensibilidad de cada bolsa y de cada valor del universo a los sobresaltos del GPR (regresión de rentabilidades
     mensuales sobre el cambio del GPR; en los valores, descontando el movimiento de su bolsa).
  3. Estudio de eventos: qué hicieron las bolsas y la cesta de defensa europea alrededor de las escaladas y relajaciones del GPR diario.
  4. Rearme europeo: cesta de defensa (precio, caída desde máximos y precedentes) y cifras oficiales con su fuente.
  5. Pistas activas (señal → precedente → efecto → qué hacer) y lectura conjunta, por reglas.
Si una fuente falla se registra el error; nunca se inventa un dato.
"""
import io
import json
import math
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_risk import MERCADOS, UA_WEB, log  # noqa: E402


def sf(x, d=1):
    """Número con signo y coma decimal."""
    return f"{x:+.{d}f}".replace(".", ",")

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
NOW = datetime.now(timezone.utc)
ERRORS = []
URL_M = "https://www.matteoiacoviello.com/gpr_files/data_gpr_export.xls"
URL_D = "https://www.matteoiacoviello.com/gpr_files/data_gpr_daily_recent.xls"
FUENTE = "Caldara e Iacoviello (2022), «Measuring Geopolitical Risk», American Economic Review · matteoiacoviello.com/gpr.htm"

PAISES = {"USA": "EE. UU.", "RUS": "Rusia", "UKR": "Ucrania", "CHN": "China", "TWN": "Taiwán", "ISR": "Israel", "SAU": "Arabia Saudí",
          "TUR": "Turquía", "DEU": "Alemania", "FRA": "Francia", "GBR": "Reino Unido", "ESP": "España", "ITA": "Italia", "POL": "Polonia",
          "JPN": "Japón", "KOR": "Corea del Sur", "IND": "India", "BRA": "Brasil", "MEX": "México", "HKG": "Hong Kong", "EGY": "Egipto",
          "FIN": "Finlandia", "SWE": "Suecia", "NOR": "Noruega", "NLD": "Países Bajos", "BEL": "Bélgica", "CHE": "Suiza", "DNK": "Dinamarca",
          "PRT": "Portugal", "HUN": "Hungría", "CAN": "Canadá", "AUS": "Australia", "ARG": "Argentina", "CHL": "Chile", "COL": "Colombia",
          "PER": "Perú", "VEN": "Venezuela", "ZAF": "Sudáfrica", "IDN": "Indonesia", "MYS": "Malasia", "PHL": "Filipinas", "THA": "Tailandia",
          "VNM": "Vietnam", "TUN": "Túnez"}
# A qué bolsas afecta más un aumento del riesgo en cada país (exposición directa o vía energía y cadenas de suministro)
EXPOSICION = {"RUS": ["sx5e", "dax", "cac", "mib", "ibex"], "UKR": ["sx5e", "dax", "cac", "mib", "ibex"], "POL": ["sx5e", "dax"],
              "DEU": ["dax", "sx5e"], "CHN": ["hsi", "eem", "ndx"], "TWN": ["ndx", "hsi", "eem", "n225"], "HKG": ["hsi"],
              "ISR": ["sp500", "eem"], "SAU": ["eem", "sp500"], "TUR": ["eem", "ibex"], "USA": ["sp500", "ndx"], "JPN": ["n225"],
              "KOR": ["n225", "eem"], "IND": ["eem"], "GBR": ["ftse"], "ESP": ["ibex"], "ITA": ["mib"], "FRA": ["cac"]}
DEFENSA = [("RHM.DE", "Rheinmetall"), ("LDO.MI", "Leonardo"), ("HO.PA", "Thales"), ("SAAB-B.ST", "Saab"), ("BA.L", "BAE Systems"),
           ("HAG.DE", "Hensoldt"), ("R3NK.DE", "Renk"), ("IDR.MC", "Indra"), ("KOG.OL", "Kongsberg")]
REARME = [
    {"dato": "Objetivo de la OTAN: 5 % del PIB en defensa en 2035 (3,5 % defensa básica y 1,5 % gasto relacionado)",
     "fuente": "Parlamento Europeo, servicio de estudios (EPRS), mar-2026", "url": "https://epthinktank.eu/2026/03/09/eu-member-states-defence-budgets-2/"},
    {"dato": "ReArm Europe / Readiness 2030: movilizar 800.000 M€ en defensa hasta 2029, incluidos 150.000 M€ en préstamos SAFE",
     "fuente": "Parlamento Europeo, servicio de estudios (EPRS), mar-2026", "url": "https://epthinktank.eu/2026/03/09/eu-member-states-defence-budgets-2/"},
    {"dato": "Gasto en defensa de los Estados de la UE: 2,4 % del PIB, impulsado por SAFE y la cláusula de escape nacional",
     "fuente": "Agencia Europea de Defensa, Defence Data 2025-2026", "url": "https://eda.europa.eu/docs/default-source/eda-publications/2026-eda_defencedata_webpublic.pdf"},
]
# Índice de referencia de cada valor según su país (para descontar el movimiento de su bolsa)
REF_PAIS = {"United States": "^GSPC", "Spain": "^IBEX", "United Kingdom": "^FTSE", "Germany": "^GDAXI", "France": "^FCHI",
            "Italy": "FTSEMIB.MI", "Japan": "^N225", "Hong Kong": "^HSI", "China": "^HSI"}


def http_bytes(url, tries=3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA_WEB}), timeout=90) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{type(last).__name__}: {last}")


def _col(df, *names):
    low = {str(c).strip().lower(): c for c in df.columns}
    for n in names:
        if n.lower() in low:
            return low[n.lower()]
    return None


def gpr_monthly():
    import pandas as pd
    df = pd.read_excel(io.BytesIO(http_bytes(URL_M)), engine="xlrd")
    cm = _col(df, "month", "date")
    out = {"global": [], "amenazas": [], "actos": [], "paises": {}}
    for _, r in df.iterrows():
        d = r[cm]
        if not hasattr(d, "year") or d.year < 1985:
            continue
        m = f"{d.year:04d}-{d.month:02d}"
        for key, col in (("global", "GPR"), ("amenazas", "GPRT"), ("actos", "GPRA")):
            c = _col(df, col)
            if c is not None and r[c] == r[c]:
                out[key].append([m, float(r[c])])
        for col in df.columns:
            s = str(col)
            if s.startswith("GPRC_") and r[col] == r[col]:
                out["paises"].setdefault(s[5:], []).append([m, float(r[col])])
    if len(out["global"]) < 300:
        raise RuntimeError("GPR mensual incompleto")
    return out


def gpr_daily():
    import pandas as pd
    df = pd.read_excel(io.BytesIO(http_bytes(URL_D)), engine="xlrd")
    cd = _col(df, "date", "day")
    cg = _col(df, "GPRD")
    ca, ct = _col(df, "GPRD_ACT"), _col(df, "GPRD_THREAT")
    ce = _col(df, "event")
    out = []
    for _, r in df.iterrows():
        d = r[cd]
        if not hasattr(d, "year"):
            try:
                d = datetime.strptime(str(int(d)), "%Y%m%d")
            except (ValueError, TypeError):
                continue
        if r[cg] != r[cg]:
            continue
        out.append([d.date().isoformat() if hasattr(d, "date") else str(d)[:10], float(r[cg]),
                    float(r[ca]) if ca is not None and r[ca] == r[ca] else None,
                    float(r[ct]) if ct is not None and r[ct] == r[ct] else None,
                    str(r[ce]).strip()[:140] if ce is not None and r[ce] == r[ce] and str(r[ce]).strip() not in ("", "nan") else None])
    if len(out) < 1000:
        raise RuntimeError("GPR diario incompleto")
    return sorted(out)


def prices(tickers):
    import yfinance as yf
    out = {}
    for t in tickers:
        try:
            df = yf.download(t, period="max", interval="1d", auto_adjust=True, progress=False)
            c = df["Close"]
            if hasattr(c, "columns"):
                c = c.iloc[:, 0]
            s = [(d.date(), float(v)) for d, v in c.dropna().items() if v > 0 and d.year >= 1985]
            if len(s) > 250:
                out[t] = s
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "Yahoo", "serie": t, "motivo": str(e)[:150]})
    return out


def monthly_close(s):
    m = {}
    for d, v in s:
        m[f"{d.year:04d}-{d.month:02d}"] = v
    return m


def pctile(hist, v):
    a = np.asarray(hist)
    return round(float((np.sum(a < v) + 0.5 * np.sum(a == v)) / len(a) * 100)) if len(a) else None


def gpr_shocks(glob):
    """Sobresalto del GPR: cambio logarítmico mensual estandarizado (z)."""
    v = [(m, math.log(x)) for m, x in glob if x > 0]
    d = [(v[i][0], v[i][1] - v[i - 1][1]) for i in range(1, len(v))]
    arr = np.array([x for _, x in d])
    mu, sd = arr.mean(), arr.std()
    return {m: (x - mu) / sd for m, x in d}


def ols(y, X):
    X = np.column_stack([np.ones(len(y)), X])
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    res = y - X @ b
    s2 = res @ res / max(1, len(y) - X.shape[1])
    cov = s2 * np.linalg.pinv(X.T @ X)
    se = np.sqrt(np.diag(cov))
    r2 = 1 - (res @ res) / (((y - y.mean()) ** 2).sum() or 1)
    return b, se, r2


def sens_bolsas(px, z):
    out = {}
    for clave, nombre, ticker, _ in MERCADOS:
        s = px.get(ticker)
        if not s:
            continue
        mc = monthly_close(s)
        ms = sorted(mc)
        rows = [(m, math.log(mc[m] / mc[ms[i - 1]])) for i, m in enumerate(ms) if i and m in z and m >= "2000-01"]
        if len(rows) < 60:
            continue
        y = np.array([r[1] for r in rows]) * 100
        x = np.array([z[r[0]] for r in rows])
        b, se, r2 = ols(y, x)
        out[clave] = {"nombre": nombre, "beta2": round(float(b[1] * 2), 2), "t": round(float(b[1] / se[1]), 1), "r2": round(float(r2), 3),
                      "n": len(rows), "desde": rows[0][0]}
    return out


def sens_valores(z, idx_px):
    """Sensibilidad de cada valor del universo al GPR descontando su bolsa: r_i = a + b_m·r_bolsa + b_g·z (5 años mensuales)."""
    try:
        U = json.load(open(os.path.join(DATA, "universe.json")))
    except (OSError, ValueError):
        return {}, {}
    idx_m = {t: monthly_close(s) for t, s in idx_px.items()}
    vals, por_sector = {}, {}
    for r in U.get("filas", []):
        sym = r["sym"]
        ref = REF_PAIS.get(r.get("pais") or "", "^STOXX50E" if r.get("region") not in ("EE. UU.", "Latinoamérica") else ("^GSPC" if r.get("region") == "EE. UU." else "EEM"))
        f = os.path.join(DATA, "p", f"{sym}.json")
        if ref not in idx_m or not os.path.exists(f):
            continue
        try:
            P = json.load(open(f))
        except (OSError, ValueError):
            continue
        mc = {}
        for t, c in zip(P.get("t", []), P.get("c", [])):
            if c:
                mc[t[:7]] = c
        ms = sorted(mc)
        im = idx_m[ref]
        rows = []
        for i in range(1, len(ms)):
            m, m0 = ms[i], ms[i - 1]
            if m in z and m in im and m0 in im and mc[m0] > 0:
                rows.append((math.log(mc[m] / mc[m0]) * 100, math.log(im[m] / im[m0]) * 100, z[m]))
        if len(rows) < 36:
            continue
        a = np.array(rows)
        b, se, _ = ols(a[:, 0], a[:, 1:])
        bg, tg = float(b[2]) * 2, float(b[2] / se[2]) if se[2] > 0 else 0.0
        vals[sym] = [round(bg, 2), round(tg, 1)]
        por_sector.setdefault(r.get("sector") or "Sin sector", []).append((bg, tg))
    sect = {}
    for s, xs in por_sector.items():
        if len(xs) < 8:
            continue
        bs = np.array([x[0] for x in xs])
        sect[s] = {"mediana": round(float(np.median(bs)), 2), "n": len(xs), "positivos": round(float(np.mean(bs > 0) * 100)),
                   "significativos": int(sum(1 for x in xs if abs(x[1]) >= 2))}
    return vals, sect


def event_days(daily, kind):
    """Escaladas: días en que el GPR diario (media de 7 días) supera el percentil 98 de los 3 años previos, separados 60 días.
    Relajaciones: días en que la media de 30 días cae por debajo del 70 % de su máximo de 120 días tras un pico (≥ p95), separados 120 días."""
    ds = [date.fromisoformat(d[0]) for d in daily]
    g = np.array([d[1] for d in daily])
    ma7 = np.convolve(g, np.ones(7) / 7, mode="full")[:len(g)]
    ma30 = np.convolve(g, np.ones(30) / 30, mode="full")[:len(g)]
    ev, last = [], None
    for i in range(1100, len(g)):
        if last is not None and (ds[i] - last).days < (60 if kind == "escalada" else 120):
            continue
        if kind == "escalada":
            ok = ma7[i] >= np.percentile(ma7[i - 1095:i], 98) and ma7[i - 1] < np.percentile(ma7[i - 1096:i - 1], 98)
        else:
            w = ma30[i - 120:i]
            ok = w.max() >= np.percentile(ma30[i - 1095:i], 95) and ma30[i] < 0.7 * w.max() and ma30[i - 1] >= 0.7 * w.max()
        if ok:
            ev.append(ds[i])
            last = ds[i]
    return ev


def event_study(events, s, pre=5, post=20):
    """Rentabilidad media acumulada desde 5 sesiones antes hasta 20 después de cada evento."""
    ds = [d for d, _ in s]
    import bisect
    res = []
    for e in events:
        i = bisect.bisect_left(ds, e)
        if i - pre < 0 or i + post >= len(s):
            continue
        b = s[i - pre][1]
        res.append([(s[i + k][1] / b - 1) * 100 for k in (-1, 0, 5, 20)])
    if len(res) < 3:
        return None
    a = np.array(res)
    return {"n": len(res), "m1": round(float(a[:, 0].mean()), 1), "dia": round(float(a[:, 1].mean()), 1),
            "m5": round(float(a[:, 2].mean()), 1), "m20": round(float(a[:, 3].mean()), 1), "pos20": round(float(np.mean(a[:, 3] > 0) * 100))}


def basket(px):
    """Cesta de defensa europea equiponderada (rentabilidades diarias medias de los valores con dato)."""
    ser = {t: dict(px[t]) for t, _ in DEFENSA if t in px}
    days = sorted({d for s in ser.values() for d in s})
    # empieza cuando hay al menos 5 valores con cotización (antes, la «cesta» sería uno o dos valores)
    first = {t: min(s) for t, s in ser.items()}
    start = next((d for d in days if sum(1 for t in ser if first[t] <= d) >= 5), None)
    days = [d for d in days if start and d >= start]
    lv, val, prev = [], 100.0, {}
    for d in days:
        rs = [ser[t][d] / prev[t] - 1 for t in ser if d in ser[t] and t in prev]
        rs = [r for r in rs if abs(r) < 0.4]   # saltos imposibles en un día = error de datos
        for t in ser:
            if d in ser[t]:
                prev[t] = ser[t][d]
        if rs:
            val *= 1 + float(np.mean(rs))
            lv.append((d, val))
    return lv, sorted(ser)


def basket_precedent(lv):
    """Veces que la cesta cayó ≥10 % desde su máximo de 3 meses (separadas 60 sesiones): rentabilidad a 6 meses."""
    out, last = [], -999
    v = [x[1] for x in lv]
    for i in range(63, len(v) - 126):
        mx = max(v[i - 63:i + 1])
        if v[i] <= 0.9 * mx and v[i - 1] > 0.9 * max(v[i - 64:i]) and i - last > 60:
            out.append((lv[i][0].isoformat(), (v[i + 126] / v[i] - 1) * 100))
            last = i
    if not out:
        return None
    r = np.array([x[1] for x in out])
    return {"n": len(out), "media6m": round(float(r.mean()), 1), "positivos": round(float(np.mean(r > 0) * 100)), "fechas": [x[0] for x in out]}


def lectura_y_pistas(G):
    gl = G["global"]
    pistas = []
    B = G.get("defensa") or {}
    pre = B.get("precedente")
    if B.get("dd3m") is not None and B["dd3m"] <= -10:
        op = bool(pre and pre["media6m"] > 0 and pre["positivos"] >= 60)
        pistas.append({"id": "defensa", "titulo": "Defensa: titulares frente a presupuestos", "estado": "Oportunidad" if op else "Vigilar",
                       "senal": f"La cesta de defensa europea cae un {abs(B['dd3m']):.0f} % desde su máximo de 3 meses, mientras los presupuestos siguen al alza (OTAN 3,5 % + 1,5 % en 2035; SAFE 150.000 M€).",
                       "precedente": (f"{pre['n']} caídas así desde {pre['fechas'][0][:4]}: a 6 meses, {sf(pre['media6m'])} % de media; {pre['positivos']} % en positivo." if pre else "Sin precedentes suficientes en la cesta."),
                       "accion": "Revisar entrada escalonada en los valores de defensa que sigas. Invalida: recortes de presupuesto o retrasos de SAFE." if op else "Vigilar: el precedente no es concluyente.",
                       "syms": B.get("valores", []), "bolsas": []})
    P = G.get("paises") or []
    sub = sorted([p for p in P if p["code"] in EXPOSICION and p.get("pct") is not None and p["pct"] >= 80 and (p.get("d3") or 0) > 0],
                 key=lambda p: (-(p["pct"] or 0), -(p.get("d3") or 0)))[:2]
    E = G.get("eventos", {}).get("escalada", {})
    for p in sub:
        bol = EXPOSICION.get(p["code"], [])
        ev = [f"{E[b]['nombre']} {sf(E[b]['m5'])} % a 5 días y {sf(E[b]['m20'])} % a 20" for b in bol if b in E][:2]
        pistas.append({"id": f"pais-{p['code']}", "titulo": f"{p['nombre']}: riesgo al alza", "estado": "Riesgo",
                       "senal": f"El GPR de {p['nombre']} está en el percentil {p['pct']} de su historia y sube en los últimos 3 meses.",
                       "precedente": ("En las escaladas globales desde 1988: " + "; ".join(ev) + ".") if ev else "Sin estudio de eventos para sus bolsas.",
                       "accion": "Revisa tus posiciones en las bolsas más expuestas y su sensibilidad al GPR (tabla inferior).",
                       "syms": [], "bolsas": bol})
    nivel = gl.get("pct7")
    if nivel is not None and nivel >= 90 and E:
        m = [x for x in E.values()][:4]
        pistas.append({"id": "nivel", "titulo": "Riesgo geopolítico global alto", "estado": "Riesgo",
                       "senal": f"El GPR diario (media de 7 días) está en el percentil {nivel} desde 1985.",
                       "precedente": "Tras las escaladas, la media de las bolsas: " + "; ".join(f"{x['nombre']} {sf(x['m5'])} % a 5 días y {sf(x['m20'])} % a 20" for x in m) + ".",
                       "accion": "Históricamente el golpe suele ser corto: vender en el pico rara vez compensa. Revisa el stress test de tu cartera.",
                       "syms": [], "bolsas": []})
    R = G.get("eventos", {}).get("relajacion", {})
    if gl.get("tendencia") == "baja" and R:
        best = sorted(R.values(), key=lambda x: -x["m20"])[:2]
        pistas.append({"id": "relajacion", "titulo": "El riesgo geopolítico se relaja", "estado": "Vigilar",
                       "senal": "La media de 30 días del GPR baja con fuerza desde su último pico.",
                       "precedente": "Tras relajaciones anteriores, lo que mejor lo hizo a 20 días: " + "; ".join(f"{x['nombre']} {sf(x['m20'])} %" for x in best) + ".",
                       "accion": "Sin acción: comprobar si tu cartera está equilibrada frente a un escenario de distensión.",
                       "syms": [], "bolsas": [k for k, x in R.items() if x in best]})
    # lectura conjunta
    t, a = gl.get("amenazas"), gl.get("actos")
    niv = gl.get("pct") or 0
    concl = ("El riesgo geopolítico global está " + ("muy alto" if niv >= 90 else "alto" if niv >= 70 else "en niveles normales" if niv >= 30 else "bajo") +
             f" (percentil {niv} desde 1985)" + (" y bajando" if gl.get("tendencia") == "baja" else " y subiendo" if gl.get("tendencia") == "sube" else "") + ".")
    if t and a:
        concl += (" Pesan más las amenazas que los hechos: históricamente es la parte que más mueve las bolsas." if t > a * 1.15 else
                  " Pesan más los hechos que las amenazas." if a > t * 1.15 else "")
    bloques = []
    if sub:
        bloques.append("Países con el riesgo al alza: " + ", ".join(f"{p['nombre']} (percentil {p['pct']})" for p in sub) + ".")
    SB = G.get("sens_bolsas") or {}
    if SB:
        neg = sorted(SB.values(), key=lambda x: x["beta2"])[:2]
        bloques.append("Las bolsas que más sufren con un sobresalto del GPR (+2 desviaciones): " +
                       "; ".join(f"{x['nombre']} {sf(x['beta2'])} % en el mes" for x in neg) + ". El efecto medio es pequeño y se diluye en semanas.")
    if B.get("dd3m") is not None:
        bloques.append(f"Cesta de defensa europea: {sf(B['dd3m'], 0)} % desde su máximo de 3 meses" + (f" y {sf(B['r1a'], 0)} % en un año." if B.get("r1a") is not None else "."))
    ST = G.get("sectores") or {}
    if ST:
        top = sorted(ST.items(), key=lambda x: -x[1]["mediana"])
        bloques.append(f"Por sectores, el que mejor aguanta un sobresalto es {top[0][0]} ({sf(top[0][1]['mediana'])} % de mediana) y el que peor, {top[-1][0]} ({sf(top[-1][1]['mediana'])} %).")
    nm = {c: n for c, n, _, _ in MERCADOS}
    vig = [f"{p['nombre']}: si su GPR " + ("sigue por encima del percentil 95" if p["pct"] >= 95 else "supera el percentil 95") +
           f", revisar las bolsas expuestas ({', '.join(nm.get(b, b) for b in EXPOSICION[p['code']])})." for p in sub][:2]
    vig.append("Titulares de paz o escalada en Ucrania: mueven la defensa europea más que los presupuestos.")
    camb = ["Una escalada (GPR diario por encima del percentil 98 de 3 años) activaría la pista de riesgo global.",
            "Un recorte de los presupuestos de defensa invalidaría la pista de defensa."]
    return pistas, {"conclusion": concl, "bloques": bloques, "vigilar": vig, "cambiaria": camb}


def main():
    G = {"generado": NOW.isoformat(timespec="seconds"), "fuente": FUENTE, "url": "https://www.matteoiacoviello.com/gpr.htm", "errores": ERRORS, "rearme": REARME}
    try:
        M = gpr_monthly()
        gl = [x[1] for x in M["global"]]
        G["mensual"] = {"global": M["global"], "amenazas": M["amenazas"], "actos": M["actos"]}
        G["global"] = {"ultimo_mes": M["global"][-1][0], "valor": round(gl[-1], 1), "pct": pctile(gl, gl[-1]),
                       "amenazas": round(M["amenazas"][-1][1], 1) if M["amenazas"] else None, "actos": round(M["actos"][-1][1], 1) if M["actos"] else None}
        P = []
        for code, ser in M["paises"].items():
            v = [x[1] for x in ser]
            if len(v) < 120:
                continue
            P.append({"code": code, "nombre": PAISES.get(code, code), "ultimo": ser[-1][0], "valor": v[-1], "pct": pctile(v, v[-1]),
                      "d3": round((v[-1] / np.mean(v[-4:-1]) - 1) * 100) if np.mean(v[-4:-1]) > 0 else None,
                      "ult4": [[m, round(pctile(v, x))] for m, x in ser[-4:]]})
        G["paises"] = sorted(P, key=lambda p: -(p["pct"] or 0))
        log(f"GPR mensual: {len(gl)} meses hasta {M['global'][-1][0]} · {gl[-1]:.0f} (p{G['global']['pct']}) · {len(P)} países")
    except Exception as e:  # noqa: BLE001
        ERRORS.append({"fuente": "Caldara-Iacoviello", "serie": "GPR mensual", "motivo": str(e)[:200]})
        log("ERROR GPR mensual:", e)
        M = None
    try:
        D = gpr_daily()
        g = np.array([x[1] for x in D])
        ma7 = float(g[-7:].mean())
        ma30, ma30p = float(g[-30:].mean()), float(g[-60:-30].mean())
        G["diario"] = [[x[0], round(x[1], 1)] for x in D[-400:]]
        G["eventos_texto"] = [[x[0], x[4]] for x in D[-120:] if x[4]][-12:]
        G.setdefault("global", {}).update({"ultimo_dia": D[-1][0], "media7": round(ma7, 1),
                                           "pct7": pctile(np.convolve(g, np.ones(7) / 7, mode="valid"), ma7),
                                           "tendencia": "baja" if ma30 < ma30p * 0.9 else "sube" if ma30 > ma30p * 1.1 else "estable",
                                           "amenazas_d": round(float(np.mean([x[3] for x in D[-30:] if x[3] is not None] or [0])), 1),
                                           "actos_d": round(float(np.mean([x[2] for x in D[-30:] if x[2] is not None] or [0])), 1)})
        log(f"GPR diario: {len(D)} días hasta {D[-1][0]} · media 7 d {ma7:.0f} (p{G['global']['pct7']}) · tendencia {G['global']['tendencia']}")
    except Exception as e:  # noqa: BLE001
        ERRORS.append({"fuente": "Caldara-Iacoviello", "serie": "GPR diario", "motivo": str(e)[:200]})
        log("ERROR GPR diario:", e)
        D = None
    tick = [t for _, _, t, _ in MERCADOS] + [t for t, _ in DEFENSA] + list(set(REF_PAIS.values()) - {t for _, _, t, _ in MERCADOS})
    px = prices(tick)
    log(f"Precios: {len(px)} de {len(tick)} series")
    if M:
        z = gpr_shocks(M["global"])
        G["sens_bolsas"] = sens_bolsas(px, z)
        vals, sect = sens_valores(z, {t: s for t, s in px.items()})
        G["sens_valores"], G["sectores"] = vals, sect
        log(f"Sensibilidad: {len(G['sens_bolsas'])} bolsas · {len(vals)} valores · {len(sect)} sectores")
    lv, miembros = basket(px)
    if len(lv) > 300:
        v = [x[1] for x in lv]
        G["defensa"] = {"valores": miembros, "nombres": {t: n for t, n in DEFENSA if t in miembros}, "desde": lv[0][0].isoformat(),
                        "dd3m": round((v[-1] / max(v[-63:]) - 1) * 100, 1), "r1a": round((v[-1] / v[-253] - 1) * 100, 1) if len(v) > 253 else None,
                        "r3a": round((v[-1] / v[-757] - 1) * 100, 1) if len(v) > 757 else None,
                        "serie": [[lv[i][0].isoformat(), round(lv[i][1], 2)] for i in range(0, len(lv), 5)],
                        "precedente": basket_precedent(lv)}
    if D:
        G["eventos"] = {}
        for kind in ("escalada", "relajacion"):
            evs = event_days(D, kind)
            res = {}
            for clave, nombre, ticker, _ in MERCADOS:
                if ticker in px:
                    r = event_study(evs, px[ticker])
                    if r:
                        res[clave] = r | {"nombre": nombre}
            if len(lv) > 300:
                r = event_study(evs, lv)
                if r:
                    res["defensa"] = r | {"nombre": "Defensa Europa"}
            G["eventos"][kind] = res
            G.setdefault("fechas_eventos", {})[kind] = [e.isoformat() for e in evs]
            log(f"Eventos {kind}: {len(evs)} · {len(res)} series")
    if "global" in G:
        G["pistas"], G["lectura"] = lectura_y_pistas(G)
    if not G.get("mensual"):
        log("Sin GPR: no se escribe geo.json")
        sys.exit(0)
    json.dump(G, open(os.path.join(DATA, "geo.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    log("geo.json escrito ·", len(G.get("pistas", [])), "pistas ·", len(ERRORS), "errores")


if __name__ == "__main__":
    main()
