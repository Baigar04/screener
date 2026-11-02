#!/usr/bin/env python3
"""Descarga datos macro públicos (FRED, BCE, Banco Mundial, FMI) y genera data/macro.json.

Reglas: cada dato lleva fuente, url, fecha_dato y fecha_actualizacion. Si una fuente falla,
se registra estado="error" con el motivo; nunca se inventa un valor.
Solo usa la biblioteca estándar de Python.
"""
import csv
import io
import json
import math
import os
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

UA = "Mozilla/5.0 (screener personal; contacto: github.com/Baigar04)"
NOW = datetime.now(timezone.utc)
TODAY = NOW.date()
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "macro.json")
ERRORS = []


# ---------------------------------------------------------------- utilidades
def http_get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"{type(last).__name__}: {last}")


def pdate(s):
    s = s.strip()
    if len(s) == 7:  # 2026-09
        s += "-01"
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def value_at(obs, d):
    """Último valor con fecha <= d."""
    best = None
    for od, v in obs:
        if od <= d:
            best = v
        else:
            break
    return best


def yoy(obs):
    """Variación interanual (%) de una serie mensual de niveles."""
    out = []
    idx = {(od.year, od.month): v for od, v in obs}
    for od, v in obs:
        prev = idx.get((od.year - 1, od.month))
        if prev:
            out.append((od, round((v / prev - 1) * 100, 2)))
    return out


def downsample(obs, freq):
    """Diario/semanal -> último dato de cada semana, 5 años. Mensual -> 10 años."""
    if freq == "M":
        cut = TODAY - timedelta(days=3660)
        return [(d, v) for d, v in obs if d >= cut]
    cut = TODAY - timedelta(days=1830)
    weeks = {}
    for d, v in obs:
        if d >= cut:
            weeks[d.isocalendar()[:2]] = (d, v)
    res = sorted(weeks.values())
    if obs and (not res or res[-1][0] != obs[-1][0]):
        res.append(obs[-1])
    return res


# ---------------------------------------------------------------- fuentes
def fred(sid):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2014-01-01"
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
    return obs, f"https://fred.stlouisfed.org/series/{sid}"


def ecb(key):
    flow, rest = key.split(".", 1)
    url = f"https://data-api.ecb.europa.eu/service/data/{flow}/{rest}?format=csvdata&startPeriod=2014-01-01"
    rdr = csv.DictReader(io.StringIO(http_get(url)))
    obs = []
    for r in rdr:
        v = r.get("OBS_VALUE", "")
        if v not in ("", "NaN"):
            obs.append((pdate(r["TIME_PERIOD"]), float(v)))
    obs.sort()
    if not obs:
        raise RuntimeError("Respuesta sin observaciones")
    return obs, f"https://data.ecb.europa.eu/data/datasets/{flow}/{key}"


# ---------------------------------------------------------------- catálogo
# id, nombre, unidad, región, grupo, frecuencia, fuente, código, transformación, definición, por qué importa
CAT = [
    ("fed_upper", "Tipo Fed (límite superior)", "%", "US", "Bancos centrales", "D", "FRED", "DFEDTARU", None,
     "Límite superior del rango objetivo de los fondos federales.",
     "Fija el coste del dinero en dólares: condiciona valoraciones, crédito y dólar."),
    ("ecb_dfr", "Tipo de depósito BCE", "%", "EZ", "Bancos centrales", "D", "BCE", "FM.D.U2.EUR.4F.KR.DFR.LEV", None,
     "Tipo que el BCE remunera a los depósitos bancarios a un día.",
     "Es el tipo de referencia efectivo del euro: guía euríbor, hipotecas y bancos."),
    ("us10y", "Bono EE. UU. 10 años", "%", "US", "Tipos y curva", "D", "FRED", "DGS10", None,
     "Rentabilidad del bono del Tesoro a 10 años.",
     "Tasa de descuento de referencia mundial: si sube, presiona a las acciones de crecimiento."),
    ("us2y", "Bono EE. UU. 2 años", "%", "US", "Tipos y curva", "D", "FRED", "DGS2", None,
     "Rentabilidad del bono del Tesoro a 2 años.",
     "Recoge lo que el mercado espera de la Fed en los próximos dos años."),
    ("t10y2y", "Curva EE. UU. 10a−2a", "pp", "US", "Tipos y curva", "D", "FRED", "T10Y2Y", None,
     "Diferencia entre el bono a 10 y a 2 años.",
     "Invertida (negativa) ha precedido a las recesiones; su vuelta a positivo suele coincidir con la debilidad."),
    ("t10y3m", "Curva EE. UU. 10a−3m", "pp", "US", "Tipos y curva", "D", "FRED", "T10Y3M", None,
     "Diferencia entre el bono a 10 años y la letra a 3 meses.",
     "Es el indicador de curva con mejor historial para anticipar recesiones en EE. UU."),
    ("ez10y", "Curva AAA zona euro 10 años", "%", "EZ", "Tipos y curva", "D", "BCE", "YC.B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y", None,
     "Tipo cupón cero a 10 años de la curva AAA del área euro.",
     "Referencia del coste de financiación a largo plazo en euros."),
    ("ez2y", "Curva AAA zona euro 2 años", "%", "EZ", "Tipos y curva", "D", "BCE", "YC.B.U2.EUR.4F.G_N_A.SV_C_YM.SR_2Y", None,
     "Tipo cupón cero a 2 años de la curva AAA del área euro.",
     "Recoge las expectativas sobre el BCE."),
    ("euribor3m", "Euríbor 3 meses", "%", "EZ", "Tipos y curva", "M", "BCE", "FM.M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA", None,
     "Tipo interbancario a 3 meses en euros (media mensual).",
     "Traslada la política del BCE a préstamos y márgenes bancarios."),
    ("cpi_us", "IPC EE. UU. (interanual)", "%", "US", "Inflación y empleo", "M", "FRED", "CPIAUCSL", "yoy",
     "Variación interanual del índice de precios al consumo.",
     "Determina el margen de la Fed para bajar tipos."),
    ("pce_core", "PCE subyacente EE. UU. (interanual)", "%", "US", "Inflación y empleo", "M", "FRED", "PCEPILFE", "yoy",
     "Inflación sin energía ni alimentos medida por el deflactor del consumo.",
     "Es la medida de inflación que la Fed vigila con su objetivo del 2 %."),
    ("hicp_ez", "IPCA zona euro (interanual)", "%", "EZ", "Inflación y empleo", "M", "BCE", "ICP.M.U2.N.000000.4.ANR", None,
     "Inflación armonizada del área euro.",
     "Guía al BCE; su objetivo es el 2 % a medio plazo."),
    ("unrate", "Paro EE. UU.", "%", "US", "Inflación y empleo", "M", "FRED", "UNRATE", None,
     "Tasa de desempleo.",
     "Su subida rápida es una de las señales más fiables de recesión."),
    ("sahm", "Regla de Sahm", "pp", "US", "Inflación y empleo", "M", "FRED", "SAHMREALTIME", None,
     "Subida de la media de 3 meses del paro frente a su mínimo de 12 meses.",
     "Un valor ≥ 0,5 ha coincidido con el inicio de todas las recesiones desde 1970."),
    ("indpro", "Producción industrial EE. UU. (interanual)", "%", "US", "Actividad", "M", "FRED", "INDPRO", "yoy",
     "Variación interanual de la producción industrial.",
     "Termómetro del ciclo manufacturero y de los beneficios cíclicos."),
    ("nfci", "Condiciones financieras (NFCI)", "índice", "US", "Riesgo", "W", "FRED", "NFCI", None,
     "Índice de condiciones financieras de la Fed de Chicago; negativo = más laxas que la media.",
     "Condiciones que se endurecen suelen anticipar menor crecimiento y caídas de bolsa."),
    ("hy_oas", "Diferencial high yield EE. UU.", "pp", "US", "Riesgo", "D", "FRED", "BAMLH0A0HYM2", None,
     "Prima de los bonos corporativos de alto rendimiento sobre el Tesoro.",
     "Si se amplía, el mercado de crédito descuenta más impagos: suele adelantarse a la bolsa."),
    ("ig_oas", "Diferencial grado de inversión EE. UU.", "pp", "US", "Riesgo", "D", "FRED", "BAMLC0A0CM", None,
     "Prima de los bonos corporativos de calidad sobre el Tesoro.",
     "Mide el estrés en el crédito de las grandes empresas."),
    ("vix", "VIX", "puntos", "GL", "Riesgo", "D", "FRED", "VIXCLS", None,
     "Volatilidad implícita a 30 días del S&P 500.",
     "Termómetro del miedo: por encima de 30 suele indicar estrés y por debajo de 15, complacencia."),
    ("brent", "Brent", "$/barril", "GL", "Materias primas y divisas", "D", "FRED", "DCOILBRENTEU", None,
     "Precio spot del crudo Brent.",
     "Mueve inflación, energéticas, aerolíneas y balanzas de los importadores como Europa."),
    ("wti", "WTI", "$/barril", "GL", "Materias primas y divisas", "D", "FRED", "DCOILWTICO", None,
     "Precio spot del crudo West Texas Intermediate.",
     "Referencia del petróleo en EE. UU."),
    ("usd_broad", "Dólar (índice amplio)", "índice", "GL", "Materias primas y divisas", "D", "FRED", "DTWEXBGS", None,
     "Índice del dólar ponderado por comercio.",
     "Un dólar fuerte presiona a emergentes y materias primas y resta a las multinacionales de EE. UU."),
    ("eurusd", "EUR/USD", "$", "GL", "Materias primas y divisas", "D", "FRED", "DEXUSEU", None,
     "Dólares por euro.",
     "Afecta a la rentabilidad en euros de las inversiones en EE. UU."),
]

FRESH_DAYS = {"D": 7, "W": 14, "M": 60, "Q": 120}


def build_series():
    out = {}
    for sid, nombre, unidad, region, grupo, freq, fuente, code, transf, dfn, por in CAT:
        rec = {"id": sid, "nombre": nombre, "unidad": unidad, "region": region, "grupo": grupo,
               "frecuencia": freq, "fuente": fuente, "codigo": code, "def": dfn, "por": por,
               "fecha_actualizacion": NOW.isoformat(timespec="seconds"),
               "umbral_frescura_dias": FRESH_DAYS[freq]}
        try:
            obs, url = fred(code) if fuente == "FRED" else ecb(code)
            if transf == "yoy":
                obs = yoy(obs)
            last_d, last_v = obs[-1]
            rec.update({
                "estado": "ok", "url": url, "fecha_dato": last_d.isoformat(), "valor": round(last_v, 3),
                "cambio_1m": _chg(obs, 31), "cambio_3m": _chg(obs, 92), "cambio_1a": _chg(obs, 365),
                "hist": [[d.isoformat(), round(v, 3)] for d, v in downsample(obs, freq)],
            })
            rec["_obs"] = obs
        except Exception as e:  # noqa: BLE001
            rec.update({"estado": "error", "motivo": str(e)[:200]})
            ERRORS.append({"fuente": fuente, "serie": code, "motivo": str(e)[:200]})
        out[sid] = rec
    # Derivada: curva euro 10a-2a
    a, b = out.get("ez10y"), out.get("ez2y")
    if a and b and a.get("estado") == "ok" and b.get("estado") == "ok":
        m = dict(b["_obs"])
        obs = [(d, round(v - m[d], 3)) for d, v in a["_obs"] if d in m]
        if obs:
            out["ez_curve"] = {
                "id": "ez_curve", "nombre": "Curva zona euro 10a−2a", "unidad": "pp", "region": "EZ",
                "grupo": "Tipos y curva", "frecuencia": "D", "fuente": "BCE (cálculo propio)",
                "codigo": "SR_10Y − SR_2Y", "url": a["url"],
                "def": "Diferencia entre los tipos AAA a 10 y 2 años del área euro.",
                "por": "Pendiente de la curva europea: positiva y creciente suele acompañar a la recuperación.",
                "fecha_actualizacion": NOW.isoformat(timespec="seconds"), "umbral_frescura_dias": 7,
                "estado": "ok", "fecha_dato": obs[-1][0].isoformat(), "valor": obs[-1][1],
                "cambio_1m": _chg(obs, 31), "cambio_3m": _chg(obs, 92), "cambio_1a": _chg(obs, 365),
                "hist": [[d.isoformat(), v] for d, v in downsample(obs, "D")], "_obs": obs,
            }
    return out


def _chg(obs, days):
    ref = value_at(obs, obs[-1][0] - timedelta(days=days))
    return None if ref is None else round(obs[-1][1] - ref, 3)


# ---------------------------------------------------------------- régimen macro (heurístico)
def _sig(obs, d, fn):
    if not obs:
        return None
    v = value_at(obs, d)
    return None if v is None else fn(v)


def growth_score(S, d):
    """Media de señales de crecimiento en [-1, 1] en la fecha d."""
    def o(k):
        s = S.get(k)
        return s.get("_obs") if s and s.get("estado") == "ok" else None
    sigs = {}
    sigs["Regla de Sahm"] = _sig(o("sahm"), d, lambda v: 1 if v < 0.3 else (0 if v < 0.5 else -1))
    sigs["Producción industrial"] = _sig(o("indpro"), d, lambda v: 1 if v > 1 else (0 if v > -1 else -1))
    sigs["Diferencial high yield"] = _sig(o("hy_oas"), d, lambda v: 1 if v < 3.5 else (0 if v < 5 else -1))
    sigs["Condiciones financieras"] = _sig(o("nfci"), d, lambda v: 1 if v < -0.3 else (0 if v < 0 else -1))
    u = o("unrate")
    if u:
        now, past = value_at(u, d), value_at(u, d - timedelta(days=183))
        if now is not None and past is not None:
            ch = now - past
            sigs["Paro (6 meses)"] = 1 if ch <= 0 else (0 if ch <= 0.3 else -1)
    vals = [v for v in sigs.values() if v is not None]
    return (sum(vals) / len(vals) if vals else None), sigs


def regime(S):
    g_now, sigs = growth_score(S, TODAY)
    g_past, _ = growth_score(S, TODAY - timedelta(days=92))
    if g_now is None or g_past is None:
        return {"estado": "error", "motivo": "Faltan series para calcular el régimen"}
    dirn = g_now - g_past
    centers = {"Expansión": (0.6, 0.15), "Desaceleración": (0.25, -0.3),
               "Recesión": (-0.6, -0.15), "Recuperación": (-0.25, 0.3)}
    w = {k: math.exp(-((g_now - c[0]) ** 2 + (dirn - c[1]) ** 2) / 0.35) for k, c in centers.items()}
    tot = sum(w.values())
    probs = {k: round(v / tot * 100) for k, v in w.items()}
    pce = S.get("pce_core", {})
    infl = None
    if pce.get("estado") == "ok":
        v = pce["valor"]
        infl = "por encima del objetivo" if v > 2.5 else ("cerca del objetivo" if v >= 1.5 else "por debajo del objetivo")
    return {
        "estado": "ok", "region": "US", "dominante": max(probs, key=probs.get), "probabilidades": probs,
        "nivel_crecimiento": round(g_now, 2), "direccion_3m": round(dirn, 2),
        "senales": {k: v for k, v in sigs.items() if v is not None},
        "inflacion": infl,
        "metodo": "Heurístico y transparente: 5 señales de crecimiento (−1/0/+1), su nivel actual y su cambio en 3 meses. "
                  "Las probabilidades salen de la distancia a cada régimen; no están calibradas estadísticamente.",
    }


# ---------------------------------------------------------------- visiones por horizonte
def _v(S, k, f="valor"):
    s = S.get(k)
    return s.get(f) if s and s.get("estado") == "ok" else None


def view(score, motivos, invalid, n):
    senal = "Favorable" if score >= 1 else ("Defensivo" if score <= -1 else "Neutral")
    conf = "alta" if abs(score) >= 2 and n >= 3 else ("media" if abs(score) >= 1 else "baja")
    motivos = [re.sub(r"(\d)\.(\d)", r"\1,\2", m) for m in motivos]
    return {"senal": senal, "confianza": conf, "motivos": motivos, "invalidacion": invalid}


def views(S, R, imf):
    out = {}
    # ---- EE. UU.
    sc, mot, n = 0, [], 0
    vix, vix1m, hy1m, nf = _v(S, "vix"), _v(S, "vix", "cambio_1m"), _v(S, "hy_oas", "cambio_1m"), _v(S, "nfci")
    if vix is not None:
        n += 1
        if vix < 16: sc += 1; mot.append(f"VIX bajo ({vix:.1f})")
        elif vix > 25: sc -= 1; mot.append(f"VIX en zona de estrés ({vix:.1f})")
        else: mot.append(f"VIX intermedio ({vix:.1f})")
    if hy1m is not None:
        n += 1
        if hy1m < -0.15: sc += 1; mot.append("el diferencial high yield se estrecha en el último mes")
        elif hy1m > 0.3: sc -= 1; mot.append("el diferencial high yield se amplía en el último mes")
    if nf is not None:
        n += 1
        if nf < -0.3: sc += 1; mot.append("condiciones financieras laxas")
        elif nf > 0: sc -= 1; mot.append("condiciones financieras más duras que la media")
    if vix1m is not None and vix1m > 5:
        sc -= 1; mot.append(f"VIX +{vix1m:.1f} puntos en un mes")
    us = {"corto": view(sc, mot, "VIX por encima de 25 o diferencial high yield +0,5 pp en un mes", n)}
    sc, mot, n = 0, [], 0
    if R.get("estado") == "ok":
        n += 1
        d = R["dominante"]
        sc += {"Expansión": 1, "Recuperación": 1, "Desaceleración": -1, "Recesión": -2}[d]
        mot.append(f"régimen dominante: {d} ({R['probabilidades'][d]} %)")
    c3m = _v(S, "t10y3m")
    if c3m is not None:
        n += 1
        if c3m < 0: sc -= 1; mot.append(f"curva 10a−3m invertida ({c3m:+.2f} pp)")
        else: mot.append(f"curva 10a−3m positiva ({c3m:+.2f} pp)")
    fed3m = _v(S, "fed_upper", "cambio_3m")
    if fed3m is not None:
        n += 1
        if fed3m < 0: sc += 1; mot.append(f"la Fed ha bajado tipos {abs(fed3m):.2f} pp en 3 meses")
        elif fed3m > 0: sc -= 1; mot.append(f"la Fed ha subido tipos {fed3m:.2f} pp en 3 meses")
    us["medio"] = view(sc, mot, "Regla de Sahm ≥ 0,5 o PCE subyacente al alza por encima del 3 %", n)
    us["largo"] = _long_view(imf, "USA", _v(S, "pce_core"))
    out["US"] = us
    # ---- Zona euro
    ez = {}
    sc, mot, n = 0, [], 0
    if vix is not None:
        n += 1
        if vix < 16: sc += 1
        elif vix > 25: sc -= 1
        mot.append(f"sentimiento global de riesgo: VIX {vix:.1f}")
    ec = _v(S, "ez_curve")
    if ec is not None:
        n += 1
        if ec > 0.5: sc += 1; mot.append(f"curva euro con pendiente positiva ({ec:+.2f} pp)")
        elif ec < 0: sc -= 1; mot.append(f"curva euro invertida ({ec:+.2f} pp)")
        else: mot.append(f"curva euro plana ({ec:+.2f} pp)")
    ez["corto"] = view(sc, mot, "VIX por encima de 25 o fuerte ampliación de primas de riesgo periféricas", n)
    sc, mot, n = 0, [], 0
    dfr3m, h = _v(S, "ecb_dfr", "cambio_3m"), _v(S, "hicp_ez")
    if dfr3m is not None:
        n += 1
        if dfr3m < 0: sc += 1; mot.append(f"el BCE ha bajado tipos {abs(dfr3m):.2f} pp en 3 meses")
        elif dfr3m > 0: sc -= 1; mot.append(f"el BCE ha subido tipos {dfr3m:.2f} pp en 3 meses")
        else: mot.append("BCE sin cambios en 3 meses")
    if h is not None:
        n += 1
        if h <= 2.3: sc += 1; mot.append(f"inflación cerca del objetivo ({h:.1f} %)")
        elif h > 3: sc -= 1; mot.append(f"inflación por encima del objetivo ({h:.1f} %)")
        else: mot.append(f"inflación algo por encima del objetivo ({h:.1f} %)")
    ez["medio"] = view(sc, mot, "IPCA por encima del 3 % que obligue al BCE a endurecer", n)
    ez["largo"] = _long_view(imf, "EURO", h)
    out["EZ"] = ez
    return out


def _long_view(imf, code, infl):
    g = imf.get("NGDP_RPCH", {}).get(code, {})
    yrs = [str(TODAY.year + 1), str(TODAY.year + 2)]
    vals = [g.get(y) for y in yrs if g.get(y) is not None]
    if not vals:
        return {"senal": "Sin datos", "confianza": "—", "motivos": ["Previsiones del FMI no disponibles"], "invalidacion": "—"}
    avg = sum(vals) / len(vals)
    sc, mot = 0, [f"FMI: crecimiento previsto medio {avg:.1f} % en {yrs[0]}-{yrs[-1]}"]
    pot = 1.8 if code == "USA" else 1.0
    if avg > pot + 0.3: sc += 1
    elif avg < pot - 0.5: sc -= 1
    if infl is not None:
        if infl > 3: sc -= 1; mot.append(f"inflación actual {infl:.1f} % (riesgo de tipos altos más tiempo)")
        elif infl <= 2.5: sc += 1; mot.append(f"inflación actual {infl:.1f} %")
    d = imf.get("GGXWDG_NGDP", {}).get(code, {}).get(yrs[0])
    if d is not None:
        mot.append(f"deuda pública prevista {d:.0f} % del PIB")
        if d > 110: sc -= 1
    return view(sc, mot, "Revisión del FMI de más de 0,5 pp a la baja o cambio estructural de política fiscal/comercial", 3)


# ---------------------------------------------------------------- países
COUNTRIES = {"USA": "EE. UU.", "CHN": "China", "JPN": "Japón", "DEU": "Alemania", "IND": "India", "GBR": "Reino Unido",
             "FRA": "Francia", "ITA": "Italia", "CAN": "Canadá", "BRA": "Brasil", "ESP": "España", "MEX": "México",
             "KOR": "Corea del Sur", "AUS": "Australia", "IDN": "Indonesia", "NLD": "Países Bajos", "SAU": "Arabia Saudí",
             "TUR": "Turquía", "CHE": "Suiza", "ZAF": "Sudáfrica"}
WB_IND = {"NY.GDP.MKTP.KD.ZG": "pib", "FP.CPI.TOTL.ZG": "inflacion", "SL.UEM.TOTL.ZS": "paro", "BN.CAB.XOKA.GD.ZS": "cuenta_corriente"}
IMF_IND = ["NGDP_RPCH", "PCPIPCH", "GGXWDG_NGDP"]


def imf_data():
    out = {}
    codes = "/".join(list(COUNTRIES) + ["EURO"])
    for ind in IMF_IND:
        url = f"https://www.imf.org/external/datamapper/api/v1/{ind}/{codes}"
        try:
            j = json.loads(http_get(url))
            out[ind] = j.get("values", {}).get(ind, {})
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "FMI", "serie": ind, "motivo": str(e)[:200]})
    return out


def countries(imf):
    res = {c: {"nombre": n} for c, n in COUNTRIES.items()}
    codes = ";".join(COUNTRIES)
    for ind, key in WB_IND.items():
        url = f"https://api.worldbank.org/v2/country/{codes}/indicator/{ind}?format=json&mrv=3&per_page=500"
        try:
            j = json.loads(http_get(url))
            for r in (j[1] if len(j) > 1 and j[1] else []):
                c = r.get("countryiso3code")
                if c in res and r.get("value") is not None and key not in res[c]:
                    res[c][key] = {"valor": round(r["value"], 2), "año": r["date"], "fuente": "Banco Mundial",
                                   "url": f"https://data.worldbank.org/indicator/{ind}?locations={c}"}
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "Banco Mundial", "serie": ind, "motivo": str(e)[:200]})
    y1 = str(TODAY.year + 1)
    for c in res:
        for ind, key in (("NGDP_RPCH", "pib_prev"), ("PCPIPCH", "inflacion_prev"), ("GGXWDG_NGDP", "deuda")):
            v = imf.get(ind, {}).get(c, {}).get(y1 if key != "deuda" else str(TODAY.year))
            if v is not None:
                res[c][key] = {"valor": round(v, 2), "año": y1 if key != "deuda" else str(TODAY.year), "fuente": "FMI (WEO)",
                               "url": f"https://www.imf.org/external/datamapper/{ind}@WEO/{c}"}
    return res


# ---------------------------------------------------------------- main
def main():
    S = build_series()
    R = regime(S)
    imf = imf_data()
    data = {
        "generado": NOW.isoformat(timespec="seconds"),
        "series": {k: {kk: vv for kk, vv in v.items() if kk != "_obs"} for k, v in S.items()},
        "regimen": R,
        "visiones": views(S, R, imf),
        "paises": countries(imf),
        "errores": ERRORS,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    ok = sum(1 for s in S.values() if s.get("estado") == "ok")
    print(f"Series OK: {ok}/{len(S)} · errores: {len(ERRORS)}")
    for e in ERRORS:
        print("  ERROR", e)
    if ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
