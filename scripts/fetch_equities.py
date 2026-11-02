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
import math
import os
import sys
import time
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
    for s in STOXX50:
        rows.setdefault(s, {"indices": []})["indices"].append("Euro Stoxx 50")
    for s in IBEX:
        rows.setdefault(s + ".MC", {"indices": []})["indices"].append("IBEX 35")
    return rows


# ------------------------------------------------------------------ precios y técnico
def prices(symbols):
    frames = {}
    for i in range(0, len(symbols), 150):
        chunk = symbols[i:i + 150]
        for attempt in range(3):
            try:
                df = yf.download(chunk, period="5y", interval="1d", group_by="ticker", auto_adjust=True,
                                 threads=True, progress=False)
                for s in chunk:
                    try:
                        sub = df[s].dropna(subset=["Close"]) if isinstance(df.columns, pd.MultiIndex) else df.dropna(subset=["Close"])
                        if len(sub) > 30:
                            frames[s] = sub
                    except KeyError:
                        pass
                break
            except Exception as e:  # noqa: BLE001
                log("download error", e)
                time.sleep(10 * (attempt + 1))
    return frames


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
    return {
        "nombre": info.get("longName") or info.get("shortName"), "pais": info.get("country"),
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
        "fecha_fund": NOW.strftime("%Y-%m-%d"),
    }


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


def rrg(frames, rows):
    """Rotación sectorial: índice equiponderado por sector frente al universo. Aproximación propia al gráfico RRG."""
    rets = {s: f["Close"].pct_change() for s, f in frames.items()}
    allr = pd.DataFrame(rets).iloc[-260:]
    bench = (1 + allr.mean(axis=1).fillna(0)).cumprod()
    sec = {}
    for r in rows:
        if r.get("sector") and r["sym"] in allr.columns:
            sec.setdefault(r["sector"], []).append(r["sym"])
    out = {}
    for s, syms in sec.items():
        idx = (1 + allr[syms].mean(axis=1).fillna(0)).cumprod()
        rs = idx / bench
        ratio = 100 * rs / rs.rolling(50).mean()
        mom = 100 * ratio / ratio.shift(10)
        pts = []
        for i in range(-26, 1, 5):
            j = len(ratio) - 1 + i
            if j >= 0 and not math.isnan(ratio.iloc[j]) and not math.isnan(mom.iloc[j]):
                pts.append([ratio.index[j].strftime("%Y-%m-%d"), round(ratio.iloc[j], 2), round(mom.iloc[j], 2)])
        if pts:
            x, y = pts[-1][1], pts[-1][2]
            quad = "Liderando" if x >= 100 and y >= 100 else "Debilitándose" if x >= 100 else "Rezagado" if y < 100 else "Mejorando"
            out[s] = {"cola": pts, "cuadrante": quad, "n": len(syms)}
    return out


# ------------------------------------------------------------------ main
def main():
    os.makedirs(os.path.join(DATA, "t"), exist_ok=True)
    os.makedirs(os.path.join(DATA, "p"), exist_ok=True)
    U = universe()
    syms = sorted(U)
    log("Universo:", len(syms))
    frames = prices(syms)
    log("Precios:", len(frames))
    for s in syms:
        if s not in frames:
            ERRORS.append({"fuente": "Yahoo Finance", "serie": s, "motivo": "sin precios"})

    cache = load_cache()
    day = NOW.toordinal()
    todo = [s for i, s in enumerate(syms) if s not in cache or i % REFRESH_SHARE == day % REFRESH_SHARE]
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

    rows = []
    for s in syms:
        f = cache.get(s, {})
        if s not in frames and not f:
            continue
        r = {"sym": s, "indices": U[s].get("indices", [])}
        r.update({k: v for k, v in f.items() if k != "anual"})
        if not r.get("sector") and U[s].get("gics_sector"):
            r["sector"] = U[s]["gics_sector"]
        r["region"] = "EE. UU." if (r.get("pais") == "United States" or "." not in s) else "Europa"
        detail = {"sym": s, "anual": f.get("anual", {})}
        if s in frames:
            tec, s50, s200 = technical(frames[s])
            r.update(tec)
            c = frames[s]["Close"]
            tail = c.iloc[-252:]
            detail["diario"] = [[d.strftime("%Y-%m-%d"), jnum(v, 2), jnum(a, 2), jnum(b, 2)]
                                for d, v, a, b in zip(tail.index, tail, s50.iloc[-252:], s200.iloc[-252:])]
            fr = frames[s]
            ohlcv = {"t": [d.strftime("%Y-%m-%d") for d in fr.index],
                     "o": [jnum(x, 3) for x in fr["Open"]], "h": [jnum(x, 3) for x in fr["High"]],
                     "l": [jnum(x, 3) for x in fr["Low"]], "c": [jnum(x, 3) for x in fr["Close"]],
                     "v": [int(x) if x == x else None for x in fr["Volume"]]}
            with open(os.path.join(DATA, "p", s.replace("/", "_") + ".json"), "w") as fh:
                json.dump({"sym": s, "fuente": "Yahoo Finance (precios ajustados)", **ohlcv}, fh, separators=(",", ":"))
        with open(os.path.join(DATA, "t", s.replace("/", "_") + ".json"), "w") as fh:
            json.dump(detail, fh, separators=(",", ":"))
        rows.append(r)

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

    try:
        rot = rrg(frames, rows)
    except Exception as e:  # noqa: BLE001
        rot = {}
        ERRORS.append({"fuente": "Cálculo", "serie": "RRG", "motivo": str(e)[:200]})

    meta = {"generado": NOW.isoformat(timespec="seconds"), "n": len(rows), "errores": ERRORS[:200], "n_errores": len(ERRORS),
            "fuentes": ["Wikipedia (composición S&P 500 y Nasdaq-100)", "Yahoo Finance vía yfinance (precios y fundamentales)"],
            "notas": "Fundamentales refrescados por rotación (cada valor, una vez por semana). Revisiones de beneficios: sin fuente pública fiable."}
    json.dump({**meta, "filas": rows}, open(os.path.join(DATA, "universe.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump({**meta, "stats": stats, "rrg": rot}, open(os.path.join(DATA, "sectors.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump(cache, open(os.path.join(DATA, "fund_cache.json"), "w"), ensure_ascii=False, separators=(",", ":"))
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
