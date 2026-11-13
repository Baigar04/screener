"""Fundamentales «a fecha» de EE. UU. desde la SEC (EDGAR, XBRL companyfacts) para el laboratorio.

Por cada empresa guarda, ejercicio a ejercicio, las cifras del 10-K ORIGINAL con su fecha real de presentación
(sin reexpresiones posteriores): así el laboratorio solo usa lo que se sabía en cada fecha.

Salida: data/sec_cache.json  {"generado", "n", "sim": {SYM: {"cik", "act", "v",
    "fy": [[fin, presentado, ventas, bn, ebit, patrimonio, deuda, cfo, capex, acciones, activos, bruto, activo_corriente, pasivo_corriente], ...],
    "q":  [[fin, presentado, ventas_3m, bn_3m, ebit_3m, bruto_3m, activos, patrimonio, bpa_diluido_3m, periodo, forma, cfo_ytd], ...]}}}
    (trimestres: 10-Q y 4.º trimestre deducido del 10-K; periodo = "FY2027Q1" con el ejercicio fiscal de la empresa;
     forma = "10-Q" o "10-K" (4.º trimestre deducido); cfo_ytd = flujo de caja operativo acumulado del ejercicio)
Requiere la variable SEC_UA ("nombre correo"), como exige la SEC para el acceso automatizado.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
SITE = os.environ.get("SITE_URL", "https://baigar04.github.io/screener/")
UA = os.environ.get("SEC_UA", "").strip()
NOW = datetime.now(timezone.utc)
REFRESH_DAYS = 30      # se vuelve a pedir una empresa como muy pronto cada 30 días…
VERSION = 3            # al cambiar el formato se vuelven a pedir todas
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
    "activos": ["Assets"],
    "bruto": ["GrossProfit"],
    "coste_ventas": ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
    "ac": ["AssetsCurrent"],
    "pc": ["LiabilitiesCurrent"],
    "bpa": ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
}
UNIT = {"bpa": "USD/shares"}
FLOW = {"ventas", "bn", "ebit", "cfo", "capex", "bruto", "coste_ventas"}
QFLOW = ("ventas", "bn", "ebit", "bruto", "coste_ventas", "bpa")


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
        units = gaap.get(tag, {}).get("units", {}).get(UNIT.get(key, "USD"))
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


def quarterly(facts, key):
    """{fin_de_trimestre: (valor_3_meses, fecha_presentación, ejercicio_fiscal, periodo, forma)} de los 10-Q originales;
    el 4.º trimestre se deduce del ejercicio del 10-K menos los tres trimestres anteriores (si están los tres).
    En el BPA, el 4.º trimestre deducido es aproximado (el número de acciones cambia entre trimestres)."""
    gaap = facts.get("facts", {}).get("us-gaap", {})
    for tag in TAGS[key]:
        units = gaap.get(tag, {}).get("units", {}).get(UNIT.get(key, "USD"))
        if not units:
            continue
        q, fy = {}, {}
        for f in units:
            form, fl, e, s = str(f.get("form", "")), f.get("filed"), f.get("end"), f.get("start")
            if not fl or not e or not s:
                continue
            dur = days(s, e)
            if form.startswith("10-Q") and 80 <= dur <= 100:
                if e not in q or fl < q[e][1]:
                    q[e] = (f["val"], fl, f.get("fy"), f.get("fp"), "10-Q")
            elif form.startswith("10-K") and 330 <= dur <= 400:
                if e not in fy or fl < fy[e][1]:
                    fy[e] = (f["val"], fl, s, f.get("fy"))
        for e, (v, fl, s, fyr) in fy.items():
            prior = [k for k in q if s < k < e and days(s, k) < 300]
            if len(prior) == 3 and e not in q:
                q[e] = (v - sum(q[k][0] for k in prior), fl, fyr, "Q4", "10-K")
        if len(q) >= 4:
            return q
    return {}


def ytd_cfo(facts):
    """{fin: (flujo de caja operativo acumulado del ejercicio, presentado)} de 10-Q y 10-K originales (la SEC lo publica acumulado)."""
    gaap = facts.get("facts", {}).get("us-gaap", {})
    for tag in TAGS["cfo"]:
        units = gaap.get(tag, {}).get("units", {}).get("USD")
        if not units:
            continue
        out = {}
        for f in units:
            form, fl, e, s = str(f.get("form", "")), f.get("filed"), f.get("end"), f.get("start")
            if not fl or not e or not s or not form.startswith(("10-Q", "10-K")):
                continue
            dur = days(s, e)
            # el acumulado del ejercicio en curso: el de mayor duración presentado en el propio documento
            if 80 <= dur <= 400 and (e not in out or fl < out[e][1] or (fl == out[e][1] and dur > out[e][2])):
                out[e] = (f["val"], fl, dur)
        if out:
            return out
    return {}


def label(fyr, fp, end):
    """«FY2027Q1»; si la SEC no trae el ejercicio fiscal, se usa el trimestre natural del cierre («CY2026Q3»)."""
    if fyr and fp in ("Q1", "Q2", "Q3", "Q4"):
        return f"FY{fyr}{fp}"
    y, m = int(end[:4]), int(end[5:7])
    return f"CY{y}Q{(m - 1) // 3 + 1}"


def instant(facts, key, forms=("10-Q", "10-K")):
    """{fecha: (valor, presentado)} de un dato de balance en 10-Q y 10-K originales."""
    gaap = facts.get("facts", {}).get("us-gaap", {})
    for tag in TAGS[key]:
        units = gaap.get(tag, {}).get("units", {}).get("USD")
        if not units:
            continue
        out = {}
        for f in units:
            if not str(f.get("form", "")).startswith(forms) or not f.get("filed") or not f.get("end") or f.get("start"):
                continue
            if f["end"] not in out or f["filed"] < out[f["end"]][1]:
                out[f["end"]] = (f["val"], f["filed"])
        if out:
            return out
    return {}


def shares(facts):
    """{fecha_presentación: acciones en circulación} de la portada de cada 10-K."""
    u = facts.get("facts", {}).get("dei", {}).get("EntityCommonStockSharesOutstanding", {}).get("units", {}).get("shares") or []
    return {f["filed"]: f["val"] for f in u if str(f.get("form", "")).startswith("10-K") and f.get("filed")}


def parse(facts):
    cols = {k: annual(facts, k) for k in TAGS}
    for k in ("activos", "patrimonio", "ac", "pc"):   # balances: dato «instantáneo» del 10-K (sin duración)
        if not cols[k]:
            cols[k] = {e: v for e, v in instant(facts, k, ("10-K",)).items()}
    sh = shares(facts)
    ends = sorted(set(cols["ventas"]) | set(cols["bn"]))
    rows = []
    for e in ends:
        filed = min((cols[k][e][1] for k in ("ventas", "bn") if e in cols[k]), default=None)
        if not filed or e < "2008-01-01":
            continue
        v = lambda k: cols[k][e][0] if e in cols[k] else None  # noqa: E731
        debt = None if v("deuda") is None and v("deuda_cp") is None else (v("deuda") or 0) + (v("deuda_cp") or 0)
        gross = v("bruto") if v("bruto") is not None else (v("ventas") - v("coste_ventas") if v("ventas") is not None and v("coste_ventas") is not None else None)
        rows.append([e, filed, v("ventas"), v("bn"), v("ebit"), v("patrimonio"), debt, v("cfo"), v("capex"), sh.get(filed),
                     v("activos"), gross, v("ac"), v("pc")])
    return rows


def parse_q(facts):
    """Trimestres desde 2015: flujos de 3 meses y balance al cierre, con la fecha real de presentación,
    el BPA diluido, la etiqueta del trimestre fiscal, el formulario y el flujo de caja operativo acumulado."""
    cols = {k: quarterly(facts, k) for k in QFLOW}
    bal = {k: instant(facts, k) for k in ("activos", "patrimonio")}
    cfo = ytd_cfo(facts)
    out = []
    for e in sorted(set(cols["ventas"]) | set(cols["bn"])):
        if e < "2015-01-01":
            continue
        filed = min((cols[k][e][1] for k in ("ventas", "bn") if e in cols[k]), default=None)
        v = lambda k: cols[k][e][0] if e in cols[k] else None  # noqa: E731
        b = lambda k: bal[k][e][0] if e in bal[k] else None  # noqa: E731
        gross = v("bruto") if v("bruto") is not None else (v("ventas") - v("coste_ventas") if v("ventas") is not None and v("coste_ventas") is not None else None)
        src = cols["ventas"].get(e) or cols["bn"].get(e)
        eps = v("bpa")
        out.append([e, filed, v("ventas"), v("bn"), v("ebit"), gross, b("activos"), b("patrimonio"),
                    None if eps is None else round(eps, 4), label(src[2], src[3], e), src[4], cfo[e][0] if e in cfo else None])
    return out


def main():
    os.makedirs(DATA, exist_ok=True)
    if not UA or "@" not in UA:
        log("SEC_UA no definido (secreto de Actions): la SEC exige nombre y correo; no se piden datos nuevos.")
        # el laboratorio corre antes de restaurar los ficheros publicados: se deja ya la última caché publicada
        try:
            open(os.path.join(DATA, "sec_cache.json"), "wb").write(get_site("data/sec_cache.json"))
            log("Se usa la caché SEC publicada.")
        except Exception as e:  # noqa: BLE001
            log("Sin caché SEC publicada:", e)
        return 0
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
        # «act» es una fecha sin hora: se compara con la fecha de hoy (antes fallaba al restar con zona horaria)
        return not x or x.get("v") != VERSION or (NOW.date() - date.fromisoformat(x["act"][:10])).days >= REFRESH_DAYS
    todo = [s for s in want if s in cik and stale(s)]
    todo.sort(key=lambda s: s in sim)  # primero los que no están
    todo = todo[:MAX_PER_RUN]
    ok = err = 0
    t0 = time.time()
    for i, s in enumerate(todo):
        try:
            facts = json.loads(get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik[s]:010d}.json"))
            sim[s] = {"cik": cik[s], "act": NOW.date().isoformat(), "v": VERSION, "fy": parse(facts), "q": parse_q(facts)}
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
    with_q = sum(1 for x in sim.values() if len(x.get("q") or []) >= 8)
    log(f"SEC: pedidas {ok} (errores {err}) · en caché {len(sim)} · con ≥3 ejercicios {with_data} · con ≥8 trimestres {with_q} · formato v{VERSION}: {sum(1 for x in sim.values() if x.get('v') == VERSION)}")
    return 0


def get_site(path):
    req = urllib.request.Request(SITE + path, headers={"User-Agent": "screener-personal"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


if __name__ == "__main__":
    sys.exit(main())
