#!/usr/bin/env python3
"""Puntuación de oportunidad: seis factores de 0 a 100 por percentil dentro de su sector.

Entradas: data/universe.json, data/smart.json, data/macro.json.
Salidas: data/score.json (factores por valor) y data/score_hist.json (top 20 semanal y su resultado posterior).
La nota final se combina en la web con los pesos que elija el usuario; aquí se guarda también con los pesos por defecto.
"""
import json
import os
from datetime import datetime, timezone

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
SITE = os.environ.get("SITE_URL", "https://baigar04.github.io/screener/")
NOW = datetime.now(timezone.utc)
DEFAULT_W = {"calidad": 20, "valor": 20, "crecimiento": 15, "momentum": 20, "smart": 15, "macro": 10}

# Comportamiento típico de cada sector según la fase del ciclo (0-100). Heurística de rotación sectorial, no estimación estadística.
CYCLE = {
    "Expansión": {"Technology": 80, "Industrials": 75, "Consumer Cyclical": 75, "Financial Services": 70, "Basic Materials": 70, "Energy": 60,
                  "Communication Services": 65, "Healthcare": 50, "Real Estate": 55, "Consumer Defensive": 40, "Utilities": 35},
    "Desaceleración": {"Healthcare": 75, "Consumer Defensive": 75, "Utilities": 70, "Technology": 55, "Energy": 60, "Financial Services": 45,
                       "Industrials": 45, "Consumer Cyclical": 40, "Basic Materials": 45, "Communication Services": 55, "Real Estate": 50},
    "Recesión": {"Utilities": 80, "Consumer Defensive": 80, "Healthcare": 75, "Communication Services": 50, "Technology": 40, "Real Estate": 45,
                 "Financial Services": 30, "Industrials": 30, "Consumer Cyclical": 30, "Basic Materials": 30, "Energy": 35},
    "Recuperación": {"Consumer Cyclical": 80, "Financial Services": 75, "Industrials": 75, "Basic Materials": 75, "Technology": 70, "Real Estate": 65,
                     "Energy": 55, "Communication Services": 60, "Healthcare": 45, "Consumer Defensive": 35, "Utilities": 35},
}


def load(name, required=True):
    p = os.path.join(DATA, name)
    if os.path.exists(p):
        return json.load(open(p))
    if required:
        raise SystemExit(f"Falta {name}")
    return None


def remote(name):
    import urllib.request
    try:
        with urllib.request.urlopen(SITE + "data/" + name, timeout=30) as r:
            return json.loads(r.read())
    except Exception:  # noqa: BLE001
        return None


def pct_ranks(pairs):
    """pairs: [(clave, valor)] → {clave: percentil 0-100}, empates con rango medio."""
    vals = sorted((v, k) for k, v in pairs if v is not None)
    n = len(vals)
    out = {}
    if n == 0:
        return out
    i = 0
    while i < n:
        j = i
        while j + 1 < n and vals[j + 1][0] == vals[i][0]:
            j += 1
        r = (i + j) / 2
        for t in range(i, j + 1):
            out[vals[t][1]] = 100.0 if n == 1 else round(100 * r / (n - 1), 1)
        i = j + 1
    return out


def by_group(rows, key, fn):
    """Percentil de fn(row) dentro de su sector (o del universo si el sector tiene menos de 8 valores con dato)."""
    allp = pct_ranks([(r["sym"], fn(r)) for r in rows])
    groups = {}
    for r in rows:
        groups.setdefault(r.get(key) or "-", []).append(r)
    out = {}
    for g, rs in groups.items():
        vals = [(r["sym"], fn(r)) for r in rs]
        if sum(1 for _, v in vals if v is not None) >= 8:
            out.update(pct_ranks(vals))
        else:
            out.update({s: allp[s] for s, v in vals if s in allp})
    return out


def neg(x):
    return None if x is None else -x


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 1) if xs else None


def main():
    U = load("universe.json")
    smart = load("smart.json", False) or {}
    macro = load("macro.json", False) or {}
    rows = U["filas"]
    por = smart.get("por_valor", {})
    for r in rows:
        p = por.get(r["sym"], {"f": [], "c": []})
        buys = sum(1 for x in p["f"] if (x[2] or "").startswith(("Add", "Buy")))
        sells = sum(1 for x in p["f"] if (x[2] or "").startswith("Reduce"))
        cb = sum(1 for x in p["c"] if x[1] == "Compra")
        cs = sum(1 for x in p["c"] if x[1].startswith("Venta"))
        r["_smart"] = len(p["f"]) + 2 * buys - sells + 1.5 * cb - 0.5 * cs if (p["f"] or p["c"]) else 0
        r["_trend"] = (r["precio"] / r["sma200"] - 1) * 100 if r.get("precio") and r.get("sma200") else None
        r["_per_vs"] = r.get("per_vs_sector") if (r.get("per") or 0) > 0 else None

    sub = {
        "roe": by_group(rows, "sector", lambda r: r.get("roe")),
        "mop": by_group(rows, "sector", lambda r: r.get("margen_op")),
        "deu": by_group(rows, "sector", lambda r: neg(r.get("deuda_neta_ebitda"))),
        "per": by_group(rows, "sector", lambda r: neg(r.get("_per_vs"))),
        "ev": by_group(rows, "sector", lambda r: neg(r.get("ev_ebitda_vs_sector"))),
        "pb": by_group(rows, "sector", lambda r: neg(r.get("pb_vs_sector"))),
        "cv": by_group(rows, "sector", lambda r: r.get("crec_ventas")),
        "cb": by_group(rows, "sector", lambda r: r.get("crec_bpa")),
        "r3": pct_ranks([(r["sym"], r.get("r3m")) for r in rows]),
        "r6": pct_ranks([(r["sym"], r.get("r6m")) for r in rows]),
        "tr": pct_ranks([(r["sym"], r.get("_trend")) for r in rows]),
        "sm": pct_ranks([(r["sym"], r["_smart"]) for r in rows]),
    }
    R = macro.get("regimen", {})
    probs = R.get("probabilidades") if R.get("estado") == "ok" else None

    out = {}
    for r in rows:
        s = r["sym"]
        g = lambda k: sub[k].get(s)
        f = {
            "calidad": mean([g("roe"), g("mop"), g("deu")]),
            "valor": mean([g("per"), g("ev"), g("pb")]),
            "crecimiento": mean([g("cv"), g("cb")]),
            "momentum": mean([g("r3"), g("r6"), g("tr")]),
            "smart": g("sm") if r["_smart"] else 0.0,
            "macro": round(sum(probs[k] / 100 * CYCLE[k].get(r.get("sector"), 50) for k in probs), 1) if probs and r.get("sector") else None,
        }
        out[s] = f
    # nota con pesos por defecto (la web la recalcula con los del usuario)
    def total(sym, w=DEFAULT_W):
        f, r = out[sym], next(x for x in rows if x["sym"] == sym)
        num = sum(w[k] * f[k] for k in w if f[k] is not None)
        den = sum(w[k] for k in w if f[k] is not None)
        if not den:
            return None
        t = num / den
        if r.get("veredicto") == "Bajista":
            t = min(t, 60)
        return round(t, 1)
    tot = {s: total(s) for s in out}
    top = sorted([s for s in tot if tot[s] is not None], key=lambda s: -tot[s])[:20]

    # registro semanal del top 20 y su resultado posterior
    hist = remote("score_hist.json") or load("score_hist.json", False) or {"semanas": []}
    price = {r["sym"]: r.get("precio") for r in rows}
    last = hist["semanas"][-1]["fecha"] if hist["semanas"] else None
    if not last or (NOW - datetime.fromisoformat(last)).days >= 7:
        hist["semanas"].append({"fecha": NOW.isoformat(timespec="seconds"), "top": [[s, tot[s], price[s]] for s in top],
                                "precios": {k: v for k, v in price.items() if v}})
        hist["semanas"] = hist["semanas"][-104:]
    res = []
    for w in hist["semanas"]:
        tr = [price[s] / p0 - 1 for s, _, p0 in w["top"] if price.get(s) and p0]
        ur = [price[s] / p0 - 1 for s, p0 in w["precios"].items() if price.get(s) and p0]
        res.append({"fecha": w["fecha"], "dias": (NOW - datetime.fromisoformat(w["fecha"])).days, "n": len(tr),
                    "top": round(100 * sum(tr) / len(tr), 2) if tr else None, "universo": round(100 * sum(ur) / len(ur), 2) if ur else None,
                    "valores": [s for s, _, _ in w["top"]]})
    json.dump({"generado": NOW.isoformat(timespec="seconds"), "pesos_defecto": DEFAULT_W, "factores": out, "total_defecto": tot,
               "regimen": R.get("dominante"), "ciclo": CYCLE, "historial": res,
               "metodo": "Cada factor es el percentil (0-100) del valor dentro de su sector; momentum y smart money, dentro de todo el universo. "
                         "Un veredicto técnico bajista limita la nota a 60. El encaje macro es una heurística de rotación sectorial según el régimen de EE. UU."},
              open(os.path.join(DATA, "score.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump(hist, open(os.path.join(DATA, "score_hist.json"), "w"), separators=(",", ":"))
    print("Puntuación: valores", len(out), "· top 5:", [(s, tot[s]) for s in top[:5]], "· semanas registradas:", len(hist["semanas"]))
    print("  muestra", {s: (out[s], tot[s]) for s in ("AAPL", "FN", "SAN.MC") if s in out})


if __name__ == "__main__":
    main()
