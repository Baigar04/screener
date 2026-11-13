#!/usr/bin/env python3
"""Universo de acciones, precios, técnico, fundamentales, estadísticas sectoriales y rotación (RRG).

Salidas (en data/):
  universe.json  · una fila por valor con múltiplos, crecimiento, calidad, momentum, técnico y comparación con su sector
  sectors.json   · medianas por sector e industria (Todos / EE. UU. / Europa) y rotación sectorial
  t/<SYM>.json   · ficha: precio diario 1 año con MM50/MM200, semanal 2 años y fundamentales anuales
  fund_cache.json· caché de fundamentales (se refresca 1/5 del universo cada día)

Fuentes: Wikipedia (composición S&P 500 y Nasdaq-100), Yahoo Finance vía yfinance (precios y fundamentales).
Nunca se inventan datos: si falta un campo queda null y la web muestra «sin datos».
"""
import io
import json
import re
import math
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data")
SITE = os.environ.get("SITE_URL", "https://baigar04.github.io/screener/")
NOW = datetime.now(timezone.utc)
UA = {"User-Agent": "Mozilla/5.0 (screener personal; github.com/Baigar04)"}
ERRORS = []
REFRESH_SHARE = 5  # cada valor se refresca una vez por semana laborable
MAX_NEW = 400      # valores nuevos sin fundamentales que se descargan por ejecución (el resto, en las siguientes)

IBEX = ["ACS", "ACX", "AENA", "AMS", "ANA", "ANE", "BBVA", "BKT", "CABK", "CLNX", "COL", "ELE", "ENG", "FDR", "FER",
        "GRF", "IAG", "IBE", "IDR", "ITX", "LOG", "MAP", "MRL", "MTS", "NTGY", "PUIG", "RED", "REP", "ROVI", "SAB",
        "SAN", "SCYR", "SLR", "TEF", "UNI"]
STOXX50 = ["ADS.DE", "ADYEN.AS", "AD.AS", "AI.PA", "AIR.PA", "ALV.DE", "ABI.BR", "ARGX.BR", "ASML.AS", "CS.PA",
           "BAS.DE", "BAYN.DE", "BBVA.MC", "SAN.MC", "BMW.DE", "BNP.PA", "BN.PA", "DB1.DE", "DHL.DE", "DTE.DE",
           "ENEL.MI", "ENI.MI", "EL.PA", "RACE.MI", "RMS.PA", "IBE.MC", "ITX.MC", "IFX.DE", "INGA.AS", "ISP.MI",
           "OR.PA", "MC.PA", "MBG.DE", "MUV2.DE", "NDA-FI.HE", "PRX.AS", "SAF.PA", "SAN.PA", "SAP.DE", "SU.PA",
           "SIE.DE", "STLAM.MI", "TTE.PA", "DG.PA", "UCG.MI", "VOW3.DE", "WKL.AS", "ENR.DE", "RHM.DE", "SGO.PA"]


def log(*a):
    print(*a, flush=True)


def get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def jnum(v, nd=4):
    """Número JSON seguro (sin NaN/inf)."""
    try:
        if v is None:
            return None
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, nd)
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ universo
LISTING_SFX = [("london", ".L"), ("italiana", ".MI"), ("milan", ".MI"), ("stockholm", ".ST"), ("copenhagen", ".CO"), ("helsinki", ".HE"),
               ("swiss", ".SW"), ("six", ".SW"), ("madrid", ".MC"), ("bme", ".MC"), ("xetra", ".DE"), ("frankfurt", ".DE"), ("deutsche", ".DE"),
               ("wiener", ".VI"), ("vienna", ".VI"), ("oslo", ".OL"), ("warsaw", ".WA"), ("athens", ".AT"), ("dublin", ".IR"), ("lisbon", ".LS"),
               ("amsterdam", ".AS"), ("paris", ".PA"), ("brussels", ".BR")]
COUNTRY_SFX = {"Netherlands": ".AS", "Belgium": ".BR", "France": ".PA", "Portugal": ".LS", "Ireland": ".IR", "Norway": ".OL", "Italy": ".MI",
               "Germany": ".DE", "Austria": ".VI", "Switzerland": ".SW", "Sweden": ".ST", "Denmark": ".CO", "Finland": ".HE", "United Kingdom": ".L",
               "Spain": ".MC", "Poland": ".WA", "Greece": ".AT", "Luxembourg": ".AS", "Jersey": ".L", "Guernsey": ".L", "Isle of Man": ".L"}


def stoxx_symbol(tk, listing, country):
    """Ticker de Wikipedia (STOXX Europe 600) → ticker de Yahoo Finance según la bolsa principal y el país."""
    tk = str(tk or "").strip()
    if not tk or tk.lower() == "nan":
        return None
    lst = str(listing or "").lower()
    sfx = next((x for k, x in LISTING_SFX if k in lst), None) if "euronext" not in lst or any(k in lst for k in ("paris", "amsterdam", "brussels", "lisbon", "dublin", "milan", "oslo")) else None
    sfx = sfx or COUNTRY_SFX.get(str(country or "").strip())
    if not sfx:
        return None
    tk = tk.rstrip(".").replace(" ", "-").replace("/", "-")
    if sfx in (".L", ".ST", ".CO", ".HE", ".OL"):
        tk = tk.replace(".", "-")
    return tk.upper() + sfx
def universe():
    rows = {}
    try:
        html = get("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies").decode()
        df = pd.read_html(io.StringIO(html), attrs={"id": "constituents"})[0]
        for _, r in df.iterrows():
            s = str(r["Symbol"]).replace(".", "-")
            rows[s] = {"indices": ["S&P 500"], "gics_sector": r.get("GICS Sector"), "gics_industry": r.get("GICS Sub-Industry")}
    except Exception as e:  # noqa: BLE001
        ERRORS.append({"fuente": "Wikipedia", "serie": "S&P 500", "motivo": str(e)[:200]})
    try:
        html = get("https://en.wikipedia.org/wiki/Nasdaq-100").decode()
        for t in pd.read_html(io.StringIO(html)):
            cols = [str(c) for c in t.columns]
            tc = next((c for c in cols if c.lower() in ("ticker", "symbol")), None)
            if tc and len(t) > 80:
                for s in t[tc].astype(str):
                    s = s.replace(".", "-")
                    rows.setdefault(s, {"indices": []})["indices"].append("Nasdaq-100")
                break
    except Exception as e:  # noqa: BLE001
        ERRORS.append({"fuente": "Wikipedia", "serie": "Nasdaq-100", "motivo": str(e)[:200]})
    try:
        html = get("https://en.wikipedia.org/wiki/List_of_S%26P_400_companies").decode()
        df = pd.read_html(io.StringIO(html), attrs={"id": "constituents"})[0] if 'id="constituents"' in html else \
            next(t for t in pd.read_html(io.StringIO(html)) if "Symbol" in t.columns and len(t) > 300)
        for _, r in df.iterrows():
            s = str(r["Symbol"]).replace(".", "-")
            d = rows.setdefault(s, {"indices": [], "gics_sector": r.get("GICS Sector"), "gics_industry": r.get("GICS Sub-Industry")})
            d["indices"].append("S&P 400")
    except Exception as e:  # noqa: BLE001
        ERRORS.append({"fuente": "Wikipedia", "serie": "S&P 400", "motivo": str(e)[:200]})
    try:
        html = get("https://en.wikipedia.org/wiki/STOXX_Europe_600").decode()
        df = next(t for t in pd.read_html(io.StringIO(html)) if "Ticker" in t.columns and len(t) > 500)
        n0 = 0
        for _, r in df.iterrows():
            y = stoxx_symbol(r.get("Ticker"), r.get("Main listing"), r.get("Country"))
            if y:
                rows.setdefault(y, {"indices": []})["indices"].append("STOXX 600")
                n0 += 1
        log("STOXX 600: tickers traducidos", n0, "de", len(df))
    except Exception as e:  # noqa: BLE001
        ERRORS.append({"fuente": "Wikipedia", "serie": "STOXX Europe 600", "motivo": str(e)[:200]})
    for s in STOXX50:
        rows.setdefault(s, {"indices": []})["indices"].append("Euro Stoxx 50")
    for s in IBEX:
        rows.setdefault(s + ".MC", {"indices": []})["indices"].append("IBEX 35")
    # Valores añadidos a mano: un ticker de Yahoo Finance por línea en universo_extra.txt (# para comentarios)
    extra = os.path.join(ROOT, "universo_extra.txt")
    if os.path.exists(extra):
        for line in open(extra, encoding="utf-8"):
            t = line.split("#")[0].strip().upper()
            if t:
                rows.setdefault(t, {"indices": []})["indices"].append("Mi lista")
    return rows


# ------------------------------------------------------------------ precios y técnico
EU_SUFFIX = (".MC", ".DE", ".PA", ".AS", ".MI", ".BR", ".HE", ".LS", ".IR", ".SW", ".L", ".ST", ".CO", ".OL", ".VI", ".WA", ".AT")


def drop_open_session(sym, df):
    """Quita la vela de hoy si su mercado aún no ha cerrado: una sesión a medias falsea volumen, técnico y Konkorde."""
    if df.empty or df.index[-1].date() != NOW.date():
        return df
    close_utc = (16, 45) if sym.endswith(EU_SUFFIX) else (21, 15)
    if (NOW.hour, NOW.minute) < close_utc:
        return df.iloc[:-1]
    return df


# ------------------------------------------------------------------ respaldo de precios: Tiingo
# Plan gratuito: 50 peticiones/hora, 1.000/día, 500 símbolos distintos/mes; solo bolsas de EE. UU.
TIINGO_KEY = os.environ.get("TIINGO_KEY", "").strip()
TIINGO_USED = set()
TIINGO_MAX = int(os.environ.get("TIINGO_MAX", "40"))   # peticiones por ejecución (deja margen al límite horario)
# Prueba: YAHOO_FALLO_SIMULADO=1 (todos) o lista de tickers separados por comas → Yahoo «falla» para ellos
_SIM = os.environ.get("YAHOO_FALLO_SIMULADO", "").strip()


def yahoo_fails(sym):
    return bool(_SIM) and (_SIM == "1" or sym in {x.strip() for x in _SIM.split(",")})


def tiingo_symbol(sym):
    """Ticker de Yahoo → ticker de Tiingo (None si no es de EE. UU.: el plan gratuito no cubre Europa)."""
    if sym.startswith("^") or "." in sym:
        return None
    return sym.lower()


def tiingo_prices(sym, years=5):
    """OHLCV diario de Tiingo. Devuelve (sin ajustar, ajustado) como Yahoo: el primero con dividendos."""
    t = tiingo_symbol(sym)
    if not t or not TIINGO_KEY:
        return None
    start = (NOW - pd.Timedelta(days=int(365.25 * years))).strftime("%Y-%m-%d")
    req = urllib.request.Request(f"https://api.tiingo.com/tiingo/daily/{t}/prices?startDate={start}",
                                 headers={**UA, "Authorization": "Token " + TIINGO_KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise RuntimeError("Tiingo: límite de peticiones alcanzado") from None
        if e.code in (401, 403):
            raise RuntimeError(f"Tiingo: clave rechazada ({e.code})") from None
        return None
    if not isinstance(data, list) or len(data) < 30:
        return None
    df = pd.DataFrame(data)
    df.index = pd.to_datetime(df["date"].str[:10])
    raw = df[["open", "high", "low", "close", "volume", "divCash"]].astype(float)
    raw.columns = ["Open", "High", "Low", "Close", "Volume", "Dividends"]
    adj = df[["adjOpen", "adjHigh", "adjLow", "adjClose", "adjVolume"]].astype(float)
    adj.columns = ["Open", "High", "Low", "Close", "Volume"]
    return raw.sort_index(), adj.sort_index()


def tiingo_fallback(missing, frames, raw):
    """Rellena con Tiingo los valores sin precios de Yahoo. Devuelve cuántos ha recuperado."""
    if not TIINGO_KEY:
        log("Respaldo Tiingo: falta el secreto TIINGO_KEY; no se usa.")
        return 0
    got, tried = 0, 0
    for s in missing:
        if not tiingo_symbol(s):
            continue
        if tried >= TIINGO_MAX:
            log("Tiingo: máximo de peticiones por ejecución alcanzado")
            break
        tried += 1
        try:
            res = tiingo_prices(s)
        except RuntimeError as e:
            log(str(e))
            break
        except Exception as e:  # noqa: BLE001
            if tried <= 3:
                log("tiingo", s, str(e)[:120])
            continue
        if res is None:
            continue
        r_, a_ = res
        raw[s] = drop_open_session(s, r_)
        frames[s] = drop_open_session(s, a_)
        TIINGO_USED.add(s)
        got += 1
    return got


def prices(symbols):
    frames, raw = {}, {}
    for i in range(0, len(symbols), 150):
        chunk = symbols[i:i + 150]
        for attempt in range(3):
            try:
                df = yf.download(chunk, period="5y", interval="1d", group_by="ticker", auto_adjust=False,
                                 actions=True, threads=True, progress=False)
                for s in chunk:
                    if yahoo_fails(s):
                        continue
                    try:
                        sub = df[s].dropna(subset=["Close"]) if isinstance(df.columns, pd.MultiIndex) else df.dropna(subset=["Close"])
                        sub = drop_open_session(s, sub)
                        if len(sub) > 30:
                            raw[s] = sub[[c for c in ("Open", "High", "Low", "Close", "Volume", "Dividends") if c in sub]]
                            adj = sub.copy()
                            if "Adj Close" in sub:
                                ratio = (sub["Adj Close"] / sub["Close"]).fillna(1.0)
                                for col in ("Open", "High", "Low"):
                                    adj[col] = sub[col] * ratio
                                adj["Close"] = sub["Adj Close"]
                            frames[s] = adj[["Open", "High", "Low", "Close", "Volume"]]
                    except KeyError:
                        pass
                break
            except Exception as e:  # noqa: BLE001
                log("download error", e)
                time.sleep(10 * (attempt + 1))
    missing = [s for s in symbols if s not in frames]
    if missing:
        n = tiingo_fallback(missing, frames, raw)
        log(f"Respaldo Tiingo: {n} de {len(missing)} valores sin precios de Yahoo recuperados (solo EE. UU.)")
    return frames, raw


def rsi(c, n=14):
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)


def technical(df):
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    sma50, sma200 = c.rolling(50).mean(), c.rolling(200).mean()
    ema12, ema26 = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    sig = macd.ewm(span=9, adjust=False).mean()
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.rolling(14).mean()
    last = c.iloc[-1]
    s50, s200 = sma50.iloc[-1], sma200.iloc[-1]
    hist = (macd - sig).iloc[-1]
    r = rsi(c).iloc[-1]
    lo20, hi20 = l.tail(20).min(), h.tail(20).max()
    lo60, hi60 = l.tail(60).min(), h.tail(60).max()
    relvol = v.tail(5).mean() / v.tail(60).mean() if v.tail(60).mean() else None

    def ret(days):
        return (last / c.iloc[-days - 1] - 1) * 100 if len(c) > days else None
    vol3m = c.pct_change().tail(63).std() * math.sqrt(252) * 100
    has200 = not math.isnan(s200) if s200 is not None else False
    if has200 and last > s50 > s200 and hist > 0:
        verdict, inval = "Alcista", max(s50, lo20)
        why = "precio sobre MM50 y MM200, medias ordenadas al alza y MACD positivo"
    elif has200 and last < s50 < s200 and hist < 0:
        verdict, inval = "Bajista", min(s50, hi20)
        why = "precio bajo MM50 y MM200, medias ordenadas a la baja y MACD negativo"
    else:
        verdict, inval = "Neutral", None
        parts = []
        if has200:
            parts.append("sobre" if last > s200 else "bajo")
            parts[-1] = f"precio {parts[-1]} MM200"
        parts.append("MACD " + ("positivo" if hist > 0 else "negativo"))
        why = "señales mixtas: " + ", ".join(parts)
    if r > 70:
        why += "; RSI en sobrecompra"
    elif r < 30:
        why += "; RSI en sobreventa"
    return {
        "precio": jnum(last, 2), "r1d": jnum(ret(1), 2), "r1m": jnum(ret(21), 2), "r3m": jnum(ret(63), 2),
        "r6m": jnum(ret(126), 2), "r1a": jnum(ret(252), 2), "vol3m": jnum(vol3m, 1),
        "sma50": jnum(s50, 2), "sma200": jnum(s200, 2), "sobre_mm200": bool(has200 and last > s200) if has200 else None,
        "rsi": jnum(r, 1), "macd_hist": jnum(hist, 3), "atr_pct": jnum(atr.iloc[-1] / last * 100, 2),
        "vol_rel": jnum(relvol, 2), "soporte": jnum(lo60, 2), "resistencia": jnum(hi60, 2),
        "soporte_corto": jnum(lo20, 2), "resistencia_corta": jnum(hi20, 2),
        "veredicto": verdict, "invalidacion": jnum(inval, 2), "motivo_tec": why, "horizonte_tec": "1-3 meses",
        "fecha_precio": c.index[-1].strftime("%Y-%m-%d"),
    }, sma50, sma200


# ------------------------------------------------------------------ fundamentales (con caché rotativa)
def load_cache():
    try:
        return json.loads(get(SITE + "data/fund_cache.json", 30))
    except Exception:  # noqa: BLE001
        p = os.path.join(DATA, "fund_cache.json")
        return json.load(open(p)) if os.path.exists(p) else {}


def _row(df, names):
    for n in names:
        if df is not None and n in df.index:
            return df.loc[n]
    return None


def fundamentals(sym):
    t = yf.Ticker(sym)
    info = t.info or {}
    if not info.get("longName") and not info.get("shortName"):
        raise RuntimeError("sin ficha en Yahoo")
    annual = {}
    try:
        inc, cf, bs = t.income_stmt, t.cashflow, t.balance_sheet
        series = {
            "ventas": _row(inc, ["Total Revenue", "Operating Revenue"]),
            "ebitda": _row(inc, ["EBITDA", "Normalized EBITDA"]),
            "beneficio_neto": _row(inc, ["Net Income", "Net Income Common Stockholders"]),
            "bpa": _row(inc, ["Diluted EPS", "Basic EPS"]),
            "fcf": _row(cf, ["Free Cash Flow"]),
            "deuda_total": _row(bs, ["Total Debt"]),
            "patrimonio": _row(bs, ["Stockholders Equity", "Common Stock Equity"]),
        }
        for k, s in series.items():
            if s is not None:
                for d, v in s.items():
                    y = str(pd.Timestamp(d).year)
                    if jnum(v) is not None:
                        annual.setdefault(y, {})[k] = jnum(v, 2)
    except Exception as e:  # noqa: BLE001
        log("financials", sym, e)
    dy = info.get("trailingAnnualDividendYield")
    dy = dy * 100 if dy is not None else info.get("dividendYield")
    ts = info.get("earningsTimestampStart") or info.get("earningsTimestamp")
    nd = None
    if info.get("totalDebt") is not None and info.get("totalCash") is not None and info.get("ebitda"):
        nd = (info["totalDebt"] - info["totalCash"]) / info["ebitda"]
    exd = info.get("exDividendDate")
    desc = (info.get("longBusinessSummary") or "").strip()
    if len(desc) > 700:   # primeras frases: lo que hace la empresa (la ficha no necesita el texto entero)
        cut = desc[:700].rfind(". ")
        desc = desc[: cut + 1] if cut > 200 else desc[:700] + "…"
    return {
        "nombre": info.get("longName") or info.get("shortName"), "pais": info.get("country"), "web": info.get("website"),
        "bolsa": info.get("fullExchangeName") or info.get("exchange"), "desc": desc or None,
        "exdiv": datetime.fromtimestamp(exd, timezone.utc).strftime("%Y-%m-%d") if isinstance(exd, (int, float)) and exd > 0 else None,
        "margen_bruto": jnum(_pct(info.get("grossMargins")), 1), "empleados": info.get("fullTimeEmployees"),
        "sector": info.get("sector"), "industria": info.get("industry"), "moneda": info.get("currency"),
        "mcap": jnum(info.get("marketCap"), 0), "per": jnum(info.get("trailingPE"), 2),
        "per_fwd": jnum(info.get("forwardPE"), 2), "ev_ebitda": jnum(info.get("enterpriseToEbitda"), 2),
        "pb": jnum(info.get("priceToBook"), 2), "ps": jnum(info.get("priceToSalesTrailing12Months"), 2),
        "div": jnum(dy, 2), "payout": jnum(_pct(info.get("payoutRatio")), 1),
        "roe": jnum(_pct(info.get("returnOnEquity")), 1), "roa": jnum(_pct(info.get("returnOnAssets")), 1),
        "margen_op": jnum(_pct(info.get("operatingMargins")), 1), "margen_neto": jnum(_pct(info.get("profitMargins")), 1),
        "crec_ventas": jnum(_pct(info.get("revenueGrowth")), 1), "crec_bpa": jnum(_pct(info.get("earningsGrowth")), 1),
        "deuda_patrimonio": jnum(info.get("debtToEquity") / 100 if info.get("debtToEquity") is not None else None, 2),
        "deuda_neta_ebitda": jnum(nd, 2), "beta": jnum(info.get("beta"), 2),
        "precio_objetivo": jnum(info.get("targetMeanPrice"), 2), "n_analistas": info.get("numberOfAnalystOpinions"),
        "resultados": datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d") if ts else None,
        "anual": dict(sorted(annual.items())[-5:]),
        "ern": earnings_hist(t),
        "fecha_fund": NOW.strftime("%Y-%m-%d"),
        # para el DCF inverso de la ficha de tesis
        "moneda_fin": info.get("financialCurrency"), "acciones": jnum(info.get("sharesOutstanding"), 0),
        "caja": jnum(info.get("totalCash"), 0), "deuda": jnum(info.get("totalDebt"), 0), "fcf_ttm": jnum(info.get("freeCashflow"), 0),
    }


def earnings_hist(t):
    """Fechas de resultados (últimas 8 y la próxima) con BPA estimado, real y sorpresa (%)."""
    try:
        ed = t.get_earnings_dates(limit=12)
        out = []
        for d, row in ed.iterrows():
            out.append([pd.Timestamp(d).strftime("%Y-%m-%d"), jnum(row.get("EPS Estimate"), 3), jnum(row.get("Reported EPS"), 3), jnum(row.get("Surprise(%)"), 2)])
        return sorted(out)[-9:]
    except Exception:  # noqa: BLE001
        return []


NEWS_CAT = [
    ("legal", r"lawsuit|\bsues?\b|\bsued\b|litigation|probe|investigat|antitrust|\bfined?\b|settle|court|regulator|class action|subpoena|recall|demanda|juicio|multa|sanci[oó]n|tribunal|investigaci[oó]n|cnmv|competencia abre"),
    ("expansion", r"acqui|merger|\bmerge|buyout|takeover|expan|new (plant|factory|facility|store)|opens|partnership|joint venture|\bdeal\b|contract|agreement|stake|adquiere|adquisici[oó]n|fusi[oó]n|\bopa\b|expansi[oó]n|alianza|acuerdo|contrato|participaci[oó]n|abre (una|un|su)"),
    ("producto", r"launch|unveil|introduc|new product|\brelease[sd]?\b|fda|approval|approves|patent|breakthrough|lanza (un|una|su) nuev|presenta (un|una|su) nuev|nuevo producto|aprobaci[oó]n|patente"),
    ("resultados", r"earnings|results|guidance|outlook|forecast|revenue|profit|quarter|beats|misses|beneficio|resultados|ingresos|facturaci[oó]n|trimestre"),
    ("analistas", r"upgrade|downgrade|price target|\brating\b|initiat|recomienda|eleva|rebaja|precio objetivo"),
    ("directivos", r"\bceo\b|\bcfo\b|chairman|resign|appoint|steps down|succession|layoff|job cuts|consejero delegado|presidente|dimite|nombra|despidos|\bere\b"),
]


def _rss(url):
    import email.utils
    b = get(url, 30).decode("utf-8", "replace")
    out = []
    for it in re.findall(r"<item>(.*?)</item>", b, re.S):
        g = lambda tag: (re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", it, re.S) or [None, ""])[1].strip()
        title = re.sub(r"<!\[CDATA\[|\]\]>", "", g("title"))
        title = title.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"')
        src = re.sub(r"<!\[CDATA\[|\]\]>", "", g("source"))
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        try:
            d = email.utils.parsedate_to_datetime(g("pubDate")).strftime("%Y-%m-%d")
        except Exception:  # noqa: BLE001
            continue
        out.append((d, title, g("link"), src or None))
    return out


def news_items(sym, name=None):
    """Titulares recientes (Yahoo Finance RSS; si hay pocos, Google Noticias por nombre), clasificados por palabras clave."""
    import urllib.parse
    items = []
    try:
        items = [(d, t, l, p or "Yahoo Finance") for d, t, l, p in _rss(f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={urllib.parse.quote(sym)}&region=US&lang=en-US")]
    except Exception:  # noqa: BLE001
        items = []
    if len(items) < 3 and name:
        es = sym.endswith(".MC")
        q = urllib.parse.quote(f'"{re.sub(r",? (Inc|Corp|Corporation|S\.A\.|SA|N\.V\.|AG|SE|plc|Ltd)\.?$", "", name)}" when:30d')
        try:
            items += _rss(f"https://news.google.com/rss/search?q={q}&hl={'es' if es else 'en-US'}&gl={'ES' if es else 'US'}&ceid={'ES:es' if es else 'US:en'}")[:20]
        except Exception:  # noqa: BLE001
            pass
    out = []
    for d, title, link, prov in items[:25]:
        low = title.lower()
        cat = next((k for k, rx in NEWS_CAT if re.search(rx, low)), "otras")
        out.append([d, cat, title[:220], link, prov])
    return out


def _pct(v):
    return v * 100 if v is not None else None


# ------------------------------------------------------------------ estadísticas sectoriales
MED_FIELDS = ["per", "per_fwd", "ev_ebitda", "pb", "ps", "div", "roe", "margen_op", "crec_ventas", "crec_bpa",
              "r1m", "r3m", "r6m", "r1a", "vol3m", "deuda_neta_ebitda"]


def med(vals, positive=False):
    v = [x for x in vals if x is not None and (x > 0 if positive else True)]
    return round(float(np.median(v)), 2) if v else None


def group_stats(rows, key):
    g = {}
    for r in rows:
        k = r.get(key)
        if k:
            g.setdefault(k, []).append(r)
    out = {}
    for k, rs in g.items():
        d = {"n": len(rs)}
        for f in MED_FIELDS:
            d[f] = med([r.get(f) for r in rs], positive=f in ("per", "per_fwd", "ev_ebitda", "pb", "ps"))
        above = [r["sobre_mm200"] for r in rs if r.get("sobre_mm200") is not None]
        d["pct_sobre_mm200"] = round(100 * sum(above) / len(above)) if above else None
        d["vol_rel"] = med([r.get("vol_rel") for r in rs])
        d["moda"] = round(d["r1m"] * 3 - d["r6m"] / 2, 2) if d["r1m"] is not None and d["r6m"] is not None else None
        if key == "industria":
            d["sector"] = rs[0].get("sector")
        out[k] = d
    return out


RRG_H = {  # horizonte: (semanas de cola, ventana de la fuerza relativa en sesiones, retardo del impulso en sesiones)
    "corto": (10, 50, 10),
    "medio": (40, 130, 20),
    "largo": (100, 260, 40),
}


def breadth(frames, rows, days=260):
    """Amplitud del mercado por región con los cierres ajustados: % de valores sobre su media de 50 y 200 sesiones,
    avances/descensos, línea avance-descenso acumulada y nuevos máximos/mínimos de 52 semanas. Solo cuenta un valor
    en una fecha si tiene historia suficiente para esa medida."""
    out = {}
    reg = {r["sym"]: r.get("region") for r in rows}
    for name in ("EE. UU.", "Europa"):
        cols = {s: f["Close"] for s, f in frames.items() if reg.get(s) == name and "Close" in f and len(f) > 260}
        if len(cols) < 30:
            continue
        C = pd.DataFrame(cols).sort_index().ffill(limit=3)
        C = C[C.index >= C.index[-1] - pd.Timedelta(days=int(days * 1.6) + 400)]
        s50, s200 = C.rolling(50).mean(), C.rolling(200).mean()
        hi, lo = C.rolling(252, min_periods=252).max(), C.rolling(252, min_periods=252).min()
        ret = C.pct_change(fill_method=None)
        a50 = (C > s50).where(s50.notna()).mean(axis=1) * 100
        a200 = (C > s200).where(s200.notna()).mean(axis=1) * 100
        adv, dec = (ret > 0).sum(axis=1), (ret < 0).sum(axis=1)
        nh = ((C >= hi) & hi.notna()).sum(axis=1)
        nl = ((C <= lo) & lo.notna()).sum(axis=1)
        n = C.notna().sum(axis=1)
        idx = C.index[-days:]
        adl = (adv - dec).loc[idx].cumsum()
        rd = lambda x: None if pd.isna(x) else round(float(x), 1)  # noqa: E731
        last = idx[-1]
        out[name] = {
            "fecha": last.strftime("%Y-%m-%d"), "n": int(n.loc[last]),
            "sobre_sma50": rd(a50.loc[last]), "sobre_sma200": rd(a200.loc[last]),
            "avances": int(adv.loc[last]), "descensos": int(dec.loc[last]),
            "max52": int(nh.loc[last]), "min52": int(nl.loc[last]),
            "sobre_sma50_1m": rd(a50.loc[idx[-22]]) if len(idx) > 22 else None,
            "sobre_sma200_1m": rd(a200.loc[idx[-22]]) if len(idx) > 22 else None,
            "hist": [[d.strftime("%Y-%m-%d"), rd(a50.loc[d]), rd(a200.loc[d]), int(nh.loc[d]) - int(nl.loc[d]), int(adl.loc[d])] for d in idx],
        }
    return out


def rrg(frames, rows):
    """Rotación sectorial: índice equiponderado por sector frente al universo, en tres horizontes. Aproximación propia al gráfico RRG."""
    rets = {s: f["Close"].pct_change() for s, f in frames.items()}
    allr = pd.DataFrame(rets).sort_index()
    allr = allr[allr.notna().sum(axis=1) > len(rets) * 0.5]  # sesiones con datos de la mayoría
    bench = (1 + allr.mean(axis=1).fillna(0)).cumprod()
    sec = {}
    for r in rows:
        if r.get("sector") and r["sym"] in allr.columns:
            sec.setdefault(r["sector"], []).append(r["sym"])
    out = {h: {} for h in RRG_H}
    for s, syms in sec.items():
        if len(syms) < 2:
            continue
        idx = (1 + allr[syms].mean(axis=1).fillna(0)).cumprod()
        rs = idx / bench
        for h, (weeks, win, lag) in RRG_H.items():
            ratio = 100 * rs / rs.rolling(win).mean()
            mom = 100 * ratio / ratio.shift(lag)
            pts = []
            for k in range(weeks - 1, -1, -1):
                j = len(ratio) - 1 - 5 * k
                if j >= 0 and not math.isnan(ratio.iloc[j]) and not math.isnan(mom.iloc[j]):
                    pts.append([ratio.index[j].strftime("%Y-%m-%d"), round(ratio.iloc[j], 2), round(mom.iloc[j], 2)])
            if pts:
                x, y = pts[-1][1], pts[-1][2]
                quad = "Liderando" if x >= 100 and y >= 100 else "Debilitándose" if x >= 100 else "Rezagado" if y < 100 else "Mejorando"
                out[h][s] = {"cola": pts, "cuadrante": quad, "n": len(syms)}
    return out


# ------------------------------------------------------------------ main
def val_hist(c, anual, mcap):
    """Múltiplos mensuales a 5 años: cada ejercicio se usa desde el 1 de abril del año siguiente; la capitalización
    pasada se reconstruye con el precio ajustado (acciones constantes)."""
    if not anual or not mcap or c.empty:
        return None
    m = c.groupby([c.index.year, c.index.month]).tail(1)
    last = float(c.iloc[-1])
    out = {"t": [], "per": [], "pvc": [], "ps": [], "fcfy": []}
    for d, px in m.items():
        ys = [int(y) for y in anual if y.isdigit() and pd.Timestamp(int(y) + 1, 4, 1) <= d]
        if not ys or not (px == px):
            continue
        a = anual[str(max(ys))]
        mc = mcap * float(px) / last
        bn, eq, ve, fc = (a.get(k) for k in ("beneficio_neto", "patrimonio", "ventas", "fcf"))
        out["t"].append(d.strftime("%Y-%m"))
        out["per"].append(jnum(mc / bn, 1) if bn and bn > 0 else None)
        out["pvc"].append(jnum(mc / eq, 2) if eq and eq > 0 else None)
        out["ps"].append(jnum(mc / ve, 2) if ve and ve > 0 else None)
        out["fcfy"].append(jnum(fc / mc * 100, 2) if fc is not None and mc else None)
    return out if len(out["t"]) >= 6 else None


NVH = [0]


def main():
    os.makedirs(os.path.join(DATA, "t"), exist_ok=True)
    os.makedirs(os.path.join(DATA, "p"), exist_ok=True)
    U = universe()
    syms = sorted(U)
    log("Universo:", len(syms))
    frames, raw = prices(syms)
    log("Precios:", len(frames))
    for s in syms:
        if s not in frames:
            ERRORS.append({"fuente": "Yahoo Finance", "serie": s, "motivo": "sin precios"})

    cache = load_cache()
    try:
        ncache = json.loads(get(SITE + "data/news_cache.json", 30))
    except Exception:  # noqa: BLE001
        ncache = {}
    ncut = (NOW - pd.Timedelta(days=60)).strftime("%Y-%m-%d")
    for k, sym_ in enumerate(syms):
        try:
            got = news_items(sym_, (cache.get(sym_) or {}).get("nombre"))
            old = {x[2]: x for x in ncache.get(sym_, [])}
            for x in got:
                old[x[2]] = x
            ncache[sym_] = sorted([x for x in old.values() if x[0] >= ncut], key=lambda x: x[0], reverse=True)[:40]
        except Exception as e:  # noqa: BLE001
            if k < 3:
                log("noticias", sym_, e)
        time.sleep(0.08)
    log("Noticias: valores con titulares", sum(1 for v in ncache.values() if v))
    day = NOW.toordinal()
    new = [s for s in syms if s not in cache]
    todo = new[:MAX_NEW] + [s for i, s in enumerate(syms) if s in cache and i % REFRESH_SHARE == day % REFRESH_SHARE]
    if len(new) > MAX_NEW:
        log("Fundamentales nuevos pendientes para próximas ejecuciones:", len(new) - MAX_NEW)
    log("Fundamentales a refrescar:", len(todo), "· en caché:", len(cache))
    for n, s in enumerate(todo):
        try:
            cache[s] = fundamentals(s)
        except Exception as e:  # noqa: BLE001
            if s not in cache:
                ERRORS.append({"fuente": "Yahoo Finance", "serie": s, "motivo": "fundamentales: " + str(e)[:150]})
        if n % 50 == 0:
            log("  fund", n, "/", len(todo))
        time.sleep(0.4)

    try:
        SECD = json.load(open(os.path.join(DATA, "sec_cache.json"))).get("sim", {})
    except Exception as e:  # noqa: BLE001
        SECD = {}
        log("Ficha: sin cuentas SEC", e)
    rows = []
    for s in syms:
        f = cache.get(s, {})
        if s not in frames and not f:
            continue
        r = {"sym": s, "indices": U[s].get("indices", [])}
        r.update({k: v for k, v in f.items() if k not in ("anual", "ern", "web", "desc")})
        if not r.get("sector") and U[s].get("gics_sector"):
            r["sector"] = U[s]["gics_sector"]
        r["region"] = "EE. UU." if (r.get("pais") == "United States" or "." not in s) else "Europa"
        detail = {"sym": s, "anual": f.get("anual", {}), "desc": f.get("desc"), "web": f.get("web")}
        if s in SECD:   # cuentas de la SEC para la ficha (EE. UU.): 12 trimestres y 6 ejercicios con su fecha de presentación
            e = SECD[s]
            detail["sec"] = {"cik": e.get("cik"), "act": e.get("act"), "v": e.get("v"), "nq": len(e.get("q") or []), "nfy": len(e.get("fy") or []),
                             "q": (e.get("q") or [])[-12:], "fy": (e.get("fy") or [])[-6:]}
        if s in frames:
            tec, s50, s200 = technical(frames[s])
            r.update(tec)
            r["fuente_precio"] = "Tiingo" if s in TIINGO_USED else "Yahoo"
            c = frames[s]["Close"]
            tail = c.iloc[-252:]
            try:
                detail["val_hist"] = val_hist(c, f.get("anual") or {}, f.get("mcap"))
            except Exception as e:  # noqa: BLE001
                log("val_hist", s, e)
            detail["diario"] = [[d.strftime("%Y-%m-%d"), jnum(v, 2), jnum(a, 2), jnum(b, 2)]
                                for d, v, a, b in zip(tail.index, tail, s50.iloc[-252:], s200.iloc[-252:])]
            fr = raw.get(s, frames[s])
            divs = [[d.strftime("%Y-%m-%d"), jnum(v, 4)] for d, v in fr["Dividends"].items() if v and v == v and v > 0] if "Dividends" in fr else []
            ev = {"div": divs[-24:], "ern": f.get("ern", []), "news": ncache.get(s, [])}
            ohlcv = {"t": [d.strftime("%Y-%m-%d") for d in fr.index],
                     "o": [jnum(x, 3) for x in fr["Open"]], "h": [jnum(x, 3) for x in fr["High"]],
                     "l": [jnum(x, 3) for x in fr["Low"]], "c": [jnum(x, 3) for x in fr["Close"]],
                     "v": [int(x) if x == x else None for x in fr["Volume"]]}
            fuente = "Tiingo (respaldo: Yahoo sin datos; precios sin ajustar)" if s in TIINGO_USED else "Yahoo Finance (precios sin ajustar, como TradingView)"
            with open(os.path.join(DATA, "p", s.replace("/", "_") + ".json"), "w") as fh:
                json.dump({"sym": s, "fuente": fuente, **ohlcv, "ev": ev}, fh, separators=(",", ":"))
        with open(os.path.join(DATA, "t", s.replace("/", "_") + ".json"), "w") as fh:
            json.dump(detail, fh, separators=(",", ":"))
        rows.append(r)
        if detail.get("val_hist"):
            NVH[0] += 1

    # factores académicos con las cuentas de la SEC (solo EE. UU.)
    try:
        import academic
        secd = SECD
        n_ac = 0
        for r in rows:
            e = secd.get(r["sym"])
            if not e:
                continue
            f = academic.current(e)
            pc = lambda x: None if x is None else round(100 * x, 2)  # noqa: E731
            r.update({"f_gp": pc(f["gp"]), "f_ag": pc(f["ag"]), "f_acr": pc(f["acr"]), "f_nsi": pc(f["nsi"]), "f_fs": f["fs"],
                      "f_sue": None if f["sue"] is None else round(f["sue"], 2), "f_fecha": f["fecha"]})
            n_ac += any(f[k] is not None for k in ("gp", "ag", "acr", "nsi", "fs", "sue"))
        log("Factores académicos (SEC):", n_ac, "valores")
    except Exception as e:  # noqa: BLE001
        log("Factores académicos: sin datos SEC", e)

    # capitalización en dólares para comparar valores de distintas monedas (filtros, orden y comparables)
    curs = sorted({(r.get("moneda") or "USD") for r in rows} - {"USD"})
    fx = {"USD": 1.0}
    for c in curs:
        base = "GBP" if c in ("GBp", "GBX") else "ZAR" if c == "ZAc" else "ILS" if c == "ILA" else c
        try:
            q = yf.download(f"{base}USD=X", period="5d", interval="1d", auto_adjust=False, progress=False)["Close"].dropna()
            v = float(q.iloc[-1].iloc[0] if hasattr(q.iloc[-1], "iloc") else q.iloc[-1])
            fx[c] = v / 100 if c in ("GBp", "GBX", "ZAc", "ILA") else v
            fx["_mc_" + c] = v  # la capitalización de Yahoo viene en la moneda principal (GBP, no peniques)
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "Yahoo Finance", "serie": f"{base}USD", "motivo": str(e)[:120]})
    for r in rows:
        c = r.get("moneda") or "USD"
        if r.get("acciones") and r.get("precio") and c in fx:
            r["mcap_usd"] = jnum(r["acciones"] * r["precio"] * fx[c], 0)
        elif r.get("mcap") and ("_mc_" + c in fx or c == "USD"):
            r["mcap_usd"] = jnum(r["mcap"] * fx.get("_mc_" + c, 1.0), 0)
    uk = next((r for r in rows if r.get("moneda") == "GBp" and r.get("acciones") and r.get("precio") and r.get("mcap")), None)
    if uk:
        log("  Control GBp", uk["sym"], "mcap Yahoo", uk["mcap"], "· acciones×precio/100", round(uk["acciones"] * uk["precio"] / 100))
    log("Monedas:", {c: round(v, 4) for c, v in fx.items() if not c.startswith("_")}, "· con mcap_usd:", sum(1 for r in rows if r.get("mcap_usd")))
    log("Historial de múltiplos (ficha de tesis):", NVH[0], "valores · con datos para DCF:", sum(1 for x in rows if x.get("acciones")))
    stats = {}
    for reg, sub in (("Todos", rows), ("EE. UU.", [r for r in rows if r["region"] == "EE. UU."]),
                     ("Europa", [r for r in rows if r["region"] == "Europa"])):
        stats[reg] = {"sector": group_stats(sub, "sector"), "industria": group_stats(sub, "industria"),
                      "mercado": {f: med([r.get(f) for r in sub], f in ("per", "per_fwd", "ev_ebitda", "pb", "ps")) for f in MED_FIELDS}}
    for r in rows:
        st = stats["Todos"]
        for f, lab in (("per", "per"), ("ev_ebitda", "ev_ebitda"), ("pb", "pb")):
            for grp in ("sector", "industria"):
                m = st[grp].get(r.get(grp) or "", {}).get(f)
                v = r.get(f)
                r[f"{lab}_vs_{grp}"] = round((v / m - 1) * 100, 1) if v and m and v > 0 else None
        r["med_per_sector"] = st["sector"].get(r.get("sector") or "", {}).get("per")
        r["med_per_industria"] = st["industria"].get(r.get("industria") or "", {}).get("per")

    # índices de referencia para carteras y comparaciones (no entran en el screener)
    for ysym_, fname in (("^GSPC", "IDX_SP500"), ("^STOXX50E", "IDX_STOXX50"), ("^IBEX", "IDX_IBEX")):
        try:
            idf = yf.download(ysym_, period="5y", interval="1d", auto_adjust=False, progress=False)
            if isinstance(idf.columns, pd.MultiIndex):
                idf.columns = idf.columns.get_level_values(0)
            idf = drop_open_session(".MC" if ysym_ != "^GSPC" else "X", idf.dropna(subset=["Close"]))
            json.dump({"sym": fname, "fuente": "Yahoo Finance", "t": [d.strftime("%Y-%m-%d") for d in idf.index],
                       "o": [jnum(x, 2) for x in idf["Open"]], "h": [jnum(x, 2) for x in idf["High"]], "l": [jnum(x, 2) for x in idf["Low"]],
                       "c": [jnum(x, 2) for x in idf["Close"]], "v": [int(x) if x == x else None for x in idf["Volume"]]},
                      open(os.path.join(DATA, "p", fname + ".json"), "w"), separators=(",", ":"))
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "Yahoo Finance", "serie": ysym_, "motivo": str(e)[:150]})
    try:
        rot = rrg(frames, rows)
    except Exception as e:  # noqa: BLE001
        rot = {}
        ERRORS.append({"fuente": "Cálculo", "serie": "RRG", "motivo": str(e)[:200]})

    try:
        import lab
        from score import DEFAULT_W
        L = lab.run(frames, rows, cache, DEFAULT_W)
        log("Laboratorio:", L["meses"], "meses ·", {c["k"]: (c["ic"], c["ic_t"]) for c in L["categorias"]},
            "· compuesto", (L["compuesto"]["actual"] or {}).get("ic"), "→", (L["compuesto"]["sugerido"] or {}).get("ic"), "· pesos", L["pesos"]["sugerido"])
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        ERRORS.append({"fuente": "Cálculo", "serie": "Laboratorio", "motivo": str(e)[:200]})

    meta = {"generado": NOW.isoformat(timespec="seconds"), "n": len(rows), "errores": ERRORS[:200], "n_errores": len(ERRORS),
            "fuentes": ["Wikipedia (composición S&P 500 y Nasdaq-100)", "Yahoo Finance vía yfinance (precios y fundamentales)", "Tiingo (respaldo de precios de EE. UU. si Yahoo falla)"],
            "n_respaldo": len(TIINGO_USED),
            "notas": "Fundamentales refrescados por rotación (cada valor, una vez por semana). Revisiones de beneficios: sin fuente pública fiable."}
    json.dump({**meta, "filas": rows}, open(os.path.join(DATA, "universe.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump({**meta, "stats": stats, "rrg": rot}, open(os.path.join(DATA, "sectors.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    try:
        amp = breadth(frames, rows)
        json.dump({"generado": meta["generado"], "regiones": amp,
                   "metodo": "Cierres ajustados del universo del screener. % sobre media = valores por encima de su media de 50/200 sesiones entre los que tienen historia suficiente; máximos/mínimos de 52 semanas con cierres."},
                  open(os.path.join(DATA, "amplitud.json"), "w"), ensure_ascii=False, separators=(",", ":"))
        log("Amplitud:", {k: (v["sobre_sma50"], v["sobre_sma200"], v["max52"], v["min52"]) for k, v in amp.items()})
    except Exception as e:  # noqa: BLE001
        log("Amplitud: error", e)
    json.dump(cache, open(os.path.join(DATA, "fund_cache.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump(ncache, open(os.path.join(DATA, "news_cache.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    log(f"Filas: {len(rows)} · errores: {len(ERRORS)}")
    for e in ERRORS[:20]:
        log("  ERROR", e)
    keys = ["nombre", "precio", "fecha_precio", "per", "mcap", "sector", "per_vs_sector", "veredicto", "resultados", "div"]
    by = {r["sym"]: r for r in rows}
    for t in ("AAPL", "MSFT", "NVDA", "SAN.MC", "ITX.MC", "ASML.AS"):
        log("  MUESTRA", t, {k: by.get(t, {}).get(k) for k in keys})
    log("  NULOS", {k: sum(1 for r in rows if r.get(k) is None) for k in ("sector", "per", "ev_ebitda", "roe", "crec_ventas", "precio", "resultados")})
    log("  SECTORES", {k: (v["n"], v["per"], v["r3m"]) for k, v in stats["Todos"]["sector"].items()})
    if len(rows) < 50:
        sys.exit(1)


if __name__ == "__main__":
    main()
