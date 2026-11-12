"""Fundamentales «a fecha» de EE. UU. desde la SEC (EDGAR, XBRL companyfacts) para el laboratorio.

Por cada empresa guarda, ejercicio a ejercicio, las cifras del 10-K ORIGINAL con su fecha real de presentación
(sin reexpresiones posteriores): así el laboratorio solo usa lo que se sabía en cada fecha.

Salida: data/sec_cache.json  {"generado", "n", "sim": {SYM: {"cik", "act", "fy": [[fin, presentado, ventas, bn, ebit, patrimonio, deuda, cfo, capex, acciones], ...]}}}
Requiere la variable SEC_UA ("nombre correo"), como exige la SEC para el acceso automatizado.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
SITE = os.environ.get("SITE_URL", "https://baigar04.github.io/screener/")
UA = os.environ.get("SEC_UA", "").strip()
NOW = datetime.now(timezone.utc)
REFRESH_DAYS = 30      # se vuelve a pedir una empresa como muy pronto cada 30 días…
MAX_PER_RUN = 1200     # …y nunca más de estas por ejecución (límite de la SEC: 10 peticiones/s)

TAGS = {
    "ventas": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
               "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet"],
    "bn": ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
    "ebit": ["OperatingIncomeLoss"],
    "patrimonio": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "deuda": ["LongTermDebt", "LongTermDebtNoncurrent", "DebtInstrumentCarryingAmount"],
    "deuda_cp": ["DebtCurrent", "LongTermDebtCurrent", "ShortTermBorrowings"],
    "cfo": ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
}
FLOW = {"ventas", "bn", "ebit", "cfo", "capex"}


def log(*a):
    print(datetime.now(timezone.utc).strftime("%H:%M:%S"), *a, flush=True)


def get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def days(a, b):
    return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).days


def annual(facts, key):
    """{fin_de_ejercicio: (valor, fecha_presentación)} del 10-K original (el primero presentado para ese ejercicio)."""
    gaap = facts.get("facts", {}).get("us-gaap", {})
    for tag in TAGS[key]:
        units = gaap.get(tag, {}).get("units", {}).get("USD")
        if not units:
            continue
        out = {}
        for f in units:
            if not str(f.get("form", "")).startswith("10-K") or not f.get("filed") or not f.get("end"):
                continue
            if key in FLOW:
                if not f.get("start") or not 330 <= days(f["start"], f["end"]) <= 400:
                    continue
            prev = out.get(f["end"])
            if prev is None or f["filed"] < prev[1]:
                out[f["end"]] = (f["val"], f["filed"])
        if len(out) >= 2:
            return out
    return {}


def shares(facts):
    """{fecha_presentación: acciones en circulación} de la portada de cada 10-K."""
    u = facts.get("facts", {}).get("dei", {}).get("EntityCommonStockSharesOutstanding", {}).get("units", {}).get("shares") or []
    return {f["filed"]: f["val"] for f in u if str(f.get("form", "")).startswith("10-K") and f.get("filed")}


def parse(facts):
    cols = {k: annual(facts, k) for k in TAGS}
    sh = shares(facts)
    ends = sorted(set(cols["ventas"]) | set(cols["bn"]))
    rows = []
    for e in ends:
        filed = min((cols[k][e][1] for k in ("ventas", "bn") if e in cols[k]), default=None)
        if not filed or e < "2008-01-01":
            continue
        v = lambda k: cols[k][e][0] if e in cols[k] else None  # noqa: E731
        debt = None if v("deuda") is None and v("deuda_cp") is None else (v("deuda") or 0) + (v("deuda_cp") or 0)
        rows.append([e, filed, v("ventas"), v("bn"), v("ebit"), v("patrimonio"), debt, v("cfo"), v("capex"), sh.get(filed)])
    return rows


def main():
    if not UA or "@" not in UA:
        log("SEC_UA no definido: la SEC exige nombre y correo; se omite.")
        return 0
    os.makedirs(DATA, exist_ok=True)
    try:
        cache = json.loads(get_site("data/sec_cache.json"))
    except Exception:  # noqa: BLE001
        p = os.path.join(DATA, "sec_cache.json")
        cache = json.load(open(p)) if os.path.exists(p) else {"sim": {}}
    sim = cache.get("sim", {})

    # símbolos de EE. UU.: universo actual + extras del laboratorio (ex miembros del S&P que siguen cotizando)
    want = set()
    for f in ("universe.json", "lab_extra.json"):
        try:
            d = json.loads(get_site("data/" + f))
            want |= {r["sym"] if isinstance(r, dict) else r for r in (d.get("filas") or d.get("extra") or [])}
        except Exception as e:  # noqa: BLE001
            log("sin", f, e)
    want = sorted(s for s in want if "." not in s and not s.startswith("IDX_"))
    tick = json.loads(get("https://www.sec.gov/files/company_tickers.json"))
    cik = {v["ticker"].upper().replace(".", "-"): int(v["cik_str"]) for v in tick.values()}
    log("Símbolos de EE. UU.:", len(want), "· con CIK:", sum(s in cik for s in want))

    def stale(s):
        x = sim.get(s)
        return not x or (NOW - datetime.fromisoformat(x["act"])).days >= REFRESH_DAYS
    todo = [s for s in want if s in cik and stale(s)]
    todo.sort(key=lambda s: s in sim)  # primero los que no están
    todo = todo[:MAX_PER_RUN]
    ok = err = 0
    t0 = time.time()
    for i, s in enumerate(todo):
        try:
            facts = json.loads(get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik[s]:010d}.json"))
            sim[s] = {"cik": cik[s], "act": NOW.date().isoformat(), "fy": parse(facts)}
            ok += 1
        except Exception as e:  # noqa: BLE001
            err += 1
            if err <= 5:
                log("  error", s, str(e)[:120])
        time.sleep(0.12)
        if time.time() - t0 > 25 * 60:
            log("  tiempo máximo alcanzado; el resto en la próxima ejecución")
            break
        if i and i % 200 == 0:
            log("  …", i, "de", len(todo))
    out = {"generado": NOW.isoformat(timespec="seconds"), "n": len(sim), "sim": sim}
    json.dump(out, open(os.path.join(DATA, "sec_cache.json"), "w"), separators=(",", ":"))
    with_data = sum(1 for x in sim.values() if len(x["fy"]) >= 3)
    log(f"SEC: pedidas {ok} (errores {err}) · en caché {len(sim)} · con ≥3 ejercicios {with_data}")
    return 0


def get_site(path):
    req = urllib.request.Request(SITE + path, headers={"User-Agent": "screener-personal"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


if __name__ == "__main__":
    sys.exit(main())
