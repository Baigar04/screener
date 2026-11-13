#!/usr/bin/env python3
"""Compras y ventas de directivos (formulario 4 de la SEC) de los valores de EE. UU. del universo.

Fuente: índices diarios de EDGAR (form.AAAAMMDD.idx) → solo los formularios 4 cuyo emisor está en el universo →
documento XML original. Se guardan solo las operaciones en mercado abierto: compra (código P) y venta (código S),
con la fecha de la operación, la de presentación y si la venta estaba programada (plan 10b5-1).

Se avanza por días, del más reciente al más antiguo, hasta cubrir la ventana. Cada ejecución procesa como mucho
MAX_DOCS documentos (límite de la SEC: 10 peticiones por segundo); lo que falte se completa en las siguientes.

Salida: data/insiders.json. Requiere SEC_UA ("nombre correo").
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
SITE = os.environ.get("SITE_URL", "https://baigar04.github.io/screener/")
UA = os.environ.get("SEC_UA", "").strip()
NOW = datetime.now(timezone.utc)
WINDOW = int(os.environ.get("INSIDERS_DIAS", "90"))      # días naturales que se cubren
MAX_DOCS = int(os.environ.get("INSIDERS_MAX", "2500"))    # documentos por ejecución
MAX_MIN = float(os.environ.get("INSIDERS_MIN", "14"))     # minutos por ejecución
IDX_LINE = re.compile(r"^(\S+)\s+(.+?)\s+(\d{1,10})\s+(\d{8}|\d{4}-\d{2}-\d{2})\s+(edgar/\S+)\s*$")


def log(*a):
    print(datetime.now(timezone.utc).strftime("%H:%M:%S"), *a, flush=True)


def get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_site(path):
    req = urllib.request.Request(SITE + path, headers={"User-Agent": "screener-personal"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def parse_index(txt, ciks):
    """Formularios 4 (sin enmiendas) cuyo CIK está en el universo: [(cik, fichero)] sin repetir fichero."""
    out, seen = [], set()
    for line in txt.splitlines():
        m = IDX_LINE.match(line)
        if not m or m.group(1) != "4":
            continue
        cik, path = int(m.group(3)), m.group(5)
        if cik in ciks and path not in seen:
            seen.add(path)
            out.append((cik, path))
    return out


def _t(node, path):
    x = node.find(path)
    return (x.text or "").strip() if x is not None and x.text else None


def _f(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def parse_form4(raw):
    """Operaciones en mercado abierto (P/S) de un formulario 4. Devuelve (cik_emisor, [operaciones])."""
    m = re.search(rb"<ownershipDocument>.*?</ownershipDocument>", raw, re.S)
    if not m:
        return None, []
    root = ET.fromstring(m.group(0))
    icik = _t(root, "issuer/issuerCik")
    owners = root.findall("reportingOwner")
    names, roles = [], set()
    for o in owners:
        n = _t(o, "reportingOwnerId/rptOwnerName")
        if n:
            names.append(n)
        rel = o.find("reportingOwnerRelationship")
        if rel is not None:
            if (_t(rel, "isDirector") or "").lower() in ("1", "true"):
                roles.add("Consejero")
            if (_t(rel, "isOfficer") or "").lower() in ("1", "true"):
                roles.add(_t(rel, "officerTitle") or "Directivo")
            if (_t(rel, "isTenPercentOwner") or "").lower() in ("1", "true"):
                roles.add("Accionista >10 %")
    plan = (_t(root, "aff10b5One") or "").lower() in ("1", "true")
    ops = []
    for tr in root.findall("nonDerivativeTable/nonDerivativeTransaction"):
        code = _t(tr, "transactionCoding/transactionCode")
        if code not in ("P", "S"):
            continue
        sh = _f(_t(tr, "transactionAmounts/transactionShares/value"))
        px = _f(_t(tr, "transactionAmounts/transactionPricePerShare/value"))
        d = _t(tr, "transactionDate/value")
        if not sh or not d:
            continue
        foot = " ".join(x.text or "" for x in tr.iter() if x.tag == "footnoteId")
        ops.append({"fecha_op": d[:10], "codigo": code, "acciones": sh, "precio": px, "importe": round(sh * px, 0) if px else None,
                    "nombre": " / ".join(names)[:80], "cargo": ", ".join(sorted(roles))[:80], "plan": plan, "_f": foot})
    for o in ops:
        o.pop("_f", None)
    return int(icik) if icik and icik.isdigit() else None, ops


def summarize(ops, today, days=90):
    """Resumen por valor de los últimos «days» días: compras y ventas en dólares, compradores distintos y racimo
    de compras (3 o más directivos distintos comprando en 30 días, una de las señales más estudiadas)."""
    lim = (today - timedelta(days=days)).isoformat()
    out = {}
    for o in ops:
        if o["fecha_op"] < lim:
            continue
        s = out.setdefault(o["sym"], {"compras": 0.0, "ventas": 0.0, "ventas_plan": 0.0, "n_compras": 0, "n_ventas": 0, "compradores": set(), "ultima": "", "fechas_compra": []})
        v = o.get("importe") or 0.0
        if o["codigo"] == "P":
            s["compras"] += v
            s["n_compras"] += 1
            s["compradores"].add(o["nombre"])
            s["fechas_compra"].append((o["fecha_op"], o["nombre"]))
        else:
            s["ventas"] += v
            s["n_ventas"] += 1
            if o.get("plan"):
                s["ventas_plan"] += v
        s["ultima"] = max(s["ultima"], o["fecha_op"])
    res = {}
    for sym, s in out.items():
        fc = sorted(s["fechas_compra"])
        cluster = any(len({n for d2, n in fc if d1 <= d2 <= (date.fromisoformat(d1) + timedelta(days=30)).isoformat()}) >= 3 for d1, _ in fc)
        res[sym] = {"compras": round(s["compras"]), "ventas": round(s["ventas"]), "ventas_plan": round(s["ventas_plan"]),
                    "n_compras": s["n_compras"], "n_ventas": s["n_ventas"], "compradores": len(s["compradores"]),
                    "racimo": cluster, "ultima": s["ultima"]}
    return res


def main():
    os.makedirs(DATA, exist_ok=True)
    try:
        cache = json.loads(get_site("data/insiders.json"))
    except Exception:  # noqa: BLE001
        p = os.path.join(DATA, "insiders.json")
        cache = json.load(open(p)) if os.path.exists(p) else {}
    done = set(cache.get("dias", []))
    ops = cache.get("ops", [])
    if not UA or "@" not in UA:
        log("SEC_UA no definido: no se piden formularios 4 nuevos.")
        if cache:
            json.dump(cache, open(os.path.join(DATA, "insiders.json"), "w"), ensure_ascii=False, separators=(",", ":"))
        return 0
    try:
        uni = json.loads(get_site("data/universe.json"))["filas"]
    except Exception:  # noqa: BLE001
        uni = json.load(open(os.path.join(DATA, "universe.json")))["filas"]
    want = {r["sym"] for r in uni if "." not in r["sym"]}
    tick = json.loads(get("https://www.sec.gov/files/company_tickers.json"))
    cik2sym = {}
    for v in tick.values():
        s = v["ticker"].upper().replace(".", "-")
        if s in want:
            cik2sym.setdefault(int(v["cik_str"]), s)
    log("Emisores de EE. UU. del universo con CIK:", len(cik2sym))

    today = NOW.date()
    days = [today - timedelta(days=i) for i in range(1, WINDOW + 1)]
    days = [d for d in days if d.weekday() < 5 and d.isoformat() not in done]
    seen = {o["acc"] for o in ops}
    n_docs = n_new = err = 0
    t0 = time.time()
    for d in days:   # del más reciente al más antiguo
        if n_docs >= MAX_DOCS or time.time() - t0 > MAX_MIN * 60:
            break
        q = (d.month - 1) // 3 + 1
        url = f"https://www.sec.gov/Archives/edgar/daily-index/{d.year}/QTR{q}/form.{d:%Y%m%d}.idx"
        try:
            idx = get(url).decode("latin-1")
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):   # festivo o índice aún no publicado
                if e.code == 404 and (today - d).days > 3:
                    done.add(d.isoformat())
                continue
            log("índice", d, e)
            continue
        except Exception as e:  # noqa: BLE001
            log("índice", d, e)
            continue
        time.sleep(0.12)
        items = parse_index(idx, cik2sym)
        complete = True
        for cik, path in items:
            acc = path.rsplit("/", 1)[-1].replace(".txt", "")
            if acc in seen:
                continue
            if n_docs >= MAX_DOCS or time.time() - t0 > MAX_MIN * 60:
                complete = False
                break
            try:
                icik, found = parse_form4(get("https://www.sec.gov/Archives/" + path))
                n_docs += 1
                seen.add(acc)
                sym = cik2sym.get(icik) or cik2sym.get(cik)
                for o in found:
                    if sym:
                        ops.append({**o, "sym": sym, "fecha_pres": d.isoformat(), "acc": acc})
                        n_new += 1
            except Exception as e:  # noqa: BLE001
                err += 1
                if err <= 5:
                    log("  error", path, str(e)[:120])
            time.sleep(0.11)
        if complete:
            done.add(d.isoformat())
    lim = (today - timedelta(days=WINDOW + 30)).isoformat()
    ops = sorted((o for o in ops if o["fecha_pres"] >= lim), key=lambda o: (o["fecha_pres"], o["fecha_op"]), reverse=True)
    pending = [d.isoformat() for d in (today - timedelta(days=i) for i in range(1, WINDOW + 1)) if d.weekday() < 5 and d.isoformat() not in done]
    out = {"generado": NOW.isoformat(timespec="seconds"), "ventana_dias": WINDOW, "dias": sorted(x for x in done if x >= lim),
           "pendientes": len(pending), "desde": min((x for x in done if x >= lim), default=None),
           "ops": ops, "por_valor": summarize(ops, today),
           "fuente": "SEC EDGAR, formulario 4 (operaciones en mercado abierto: compras P y ventas S)"}
    json.dump(out, open(os.path.join(DATA, "insiders.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    log(f"Formulario 4: {n_docs} documentos leídos ({err} errores) · {n_new} operaciones nuevas · {len(ops)} en total · "
        f"días pendientes de la ventana: {len(pending)} · valores con compras: {sum(1 for v in out['por_valor'].values() if v['n_compras'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
