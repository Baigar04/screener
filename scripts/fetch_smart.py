#!/usr/bin/env python3
"""Smart money: carteras de superinversores (Dataroma, a partir de sus 13F) y operaciones declaradas por
congresistas de EE. UU. (informes PTR oficiales de la Cámara de Representantes).

Salida: data/smart.json y data/smart_cache.json (caché de gestores y de PDF ya leídos).
Nunca se inventan datos: lo que no se puede leer queda fuera y se registra en «errores».
"""
import html as H
import io
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data")
SITE = os.environ.get("SITE_URL", "https://baigar04.github.io/screener/")
NOW = datetime.now(timezone.utc)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
ERRORS = []
CLERK = "https://disclosures-clerk.house.gov/public_disc"


def log(*a):
    print(*a, flush=True)


def get(url, timeout=60, tries=3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"{type(last).__name__}: {last}")


def text(b):
    return b.decode("utf-8", "replace")


def clean(s):
    return H.unescape(re.sub(r"<[^>]+>", " ", s or "")).replace("\xa0", " ").strip()


def num(s):
    s = clean(s).replace("$", "").replace(",", "").replace("%", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def ysym(s):
    """Ticker de Dataroma o del Congreso al formato de Yahoo (BRK.B → BRK-B)."""
    return s.strip().upper().replace(".", "-")


def load_cache():
    try:
        return json.loads(get(SITE + "data/smart_cache.json", 30, 1))
    except Exception:  # noqa: BLE001
        p = os.path.join(DATA, "smart_cache.json")
        return json.load(open(p)) if os.path.exists(p) else {}


# ------------------------------------------------------------------ Dataroma
def dataroma(cache):
    home = text(get("https://www.dataroma.com/m/home.php"))
    managers, quarter = [], None
    for m in re.finditer(r'<p[^>]*>\s*(Q[1-4] \d{4})\s*</p>|<a href="/m/holdings\.php\?m=([^"]+)">(.*?)</a>', home, re.S):
        if m.group(1):
            quarter = m.group(1)
            continue
        code, inner = m.group(2), m.group(3)
        upd = re.search(r"Updated\s+([^<]+)", inner)
        name = clean(re.sub(r'<span class="portb">.*?</span>', "", inner, flags=re.S))
        if code not in [x["code"] for x in managers]:
            managers.append({"code": code, "nombre": name, "actualizado": upd.group(1).strip() if upd else None, "trimestre": quarter})
    log("Dataroma gestores:", len(managers))
    old = cache.get("dataroma", {})
    fresh = 0
    for m in managers:
        prev = old.get(m["code"])
        if prev and prev.get("actualizado") == m["actualizado"] and prev.get("pos"):
            m["pos"] = prev["pos"]
            continue
        try:
            page = text(get(f"https://www.dataroma.com/m/holdings.php?m={m['code']}"))
            pos = []
            for row in re.findall(r"<tr>(.*?)</tr>", page, re.S):
                sm = re.search(r'stock\.php\?sym=([^"]+)">([^<]+)<span>\s*-\s*([^<]*)</span>', row)
                if not sm:
                    continue
                tds = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
                if len(tds) < 7:
                    continue
                pos.append([ysym(sm.group(1)), clean(sm.group(3)), num(tds[2]), clean(tds[3]) or None, num(tds[4]), num(tds[6])])
            m["pos"] = pos
            fresh += 1
            time.sleep(1.0)
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "Dataroma", "serie": m["code"], "motivo": str(e)[:150]})
            if prev:
                m["pos"] = prev.get("pos", [])
    log("Dataroma carteras descargadas:", fresh, "· reutilizadas:", len(managers) - fresh)
    # actividad del último trimestre declarado (compras y ventas, incluidas salidas completas)
    act = []
    try:
        page = text(get("https://www.dataroma.com/m/allact.php?typ=a"))
        for row in re.findall(r"<tr>(.*?)</tr>", page, re.S):
            fm = re.search(r'm_activity\.php\?m=([^&"]+)[^>]*>([^<]+)</a>', row)
            pm = re.search(r'class="period">([^<]+)<', row)
            if not fm:
                continue
            for a in re.finditer(r'<a class="(buy|sell)" href="/m/activity\.php\?sym=([^&"]+)[^>]*>[^<]+</a>\s*<div>(.*?)<br/>(.*?)<br/>Change to portfolio:\s*([-\d.]+)%', row, re.S):
                act.append({"code": fm.group(1), "firma": clean(fm.group(2)), "periodo": clean(pm.group(1)) if pm else None, "tipo": a.group(1),
                            "sym": ysym(a.group(2)), "nombre": clean(a.group(3)), "accion": clean(a.group(4)), "cambio": float(a.group(5))})
    except Exception as e:  # noqa: BLE001
        ERRORS.append({"fuente": "Dataroma", "serie": "actividad", "motivo": str(e)[:150]})
    log("Dataroma movimientos:", len(act))
    return managers, act


# ------------------------------------------------------------------ Congreso (Cámara de Representantes)
TX = re.compile(r"\b(P|S \(partial\)|S|E)\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})")
AMT = re.compile(r"(Over \$[\d,]+|\$[\d,]+\s*-\s*\$[\d,]+|\$[\d,]+\s*-)")
TICK = re.compile(r"\(([A-Z][A-Z0-9.\-]{0,6})\)\s*\[([A-Z]{2,3})\]")


def parse_ptr(txt):
    """Extrae operaciones de un PTR en texto. Empareja cada «(TICKER) [TIPO]» con la línea de operación adyacente
    (antes si el nombre del activo ocupa dos líneas, después si ocupa una)."""
    t = re.sub(r"\s+", " ", txt)
    toks = [("T", m.start(), m) for m in TICK.finditer(t)] + [("X", m.start(), m) for m in TX.finditer(t)]
    toks.sort(key=lambda x: x[1])
    pairs, i = [], 0
    while i < len(toks) - 1:
        a, b = toks[i], toks[i + 1]
        if a[0] != b[0]:
            pairs.append((a[2], b[2]) if a[0] == "T" else (b[2], a[2]))
            i += 2
        else:
            i += 1
    out, seen = [], set()
    for tk, x in pairs:
        sym, kind = tk.group(1), tk.group(2)
        if kind not in ("ST", "OP", "EF", "ET"):
            continue
        after = t[x.end(): x.end() + 160]
        am = AMT.search(after)
        amount = am.group(1) if am else None
        if amount and amount.endswith("-"):
            nxt = re.search(r"\$[\d,]+", after[am.end():])
            amount = amount + " " + nxt.group(0) if nxt else amount
        typ = {"P": "Compra", "S": "Venta", "S (partial)": "Venta parcial", "E": "Canje"}[x.group(1)]
        o = {"sym": ysym(sym), "clase": "Opción" if kind == "OP" else "Acción", "tipo": typ,
             "fecha_op": datetime.strptime(x.group(2), "%m/%d/%Y").strftime("%Y-%m-%d"),
             "fecha_notif": datetime.strptime(x.group(3), "%m/%d/%Y").strftime("%Y-%m-%d"), "importe": amount}
        k = (o["sym"], o["tipo"], o["fecha_op"], o["importe"])
        if k not in seen:
            seen.add(k)
            out.append(o)
    return out


def congress(cache):
    pc = cache.get("ptr", {})
    filings = []
    cutoff = (NOW - timedelta(days=380)).date()
    for yr in (NOW.year - 1, NOW.year):
        try:
            z = zipfile.ZipFile(io.BytesIO(get(f"{CLERK}/financial-pdfs/{yr}FD.zip")))
            x = text(z.read([n for n in z.namelist() if n.endswith(".xml")][0]))
            for mem in re.findall(r"<Member>(.*?)</Member>", x, re.S):
                g = lambda tag: (re.search(rf"<{tag}>(.*?)</{tag}>", mem, re.S) or [None, ""])[1].strip()
                if g("FilingType") != "P":
                    continue
                fd = datetime.strptime(g("FilingDate"), "%m/%d/%Y").date()
                if fd < cutoff:
                    continue
                filings.append({"doc": g("DocID"), "year": g("Year"), "nombre": f"{g('First')} {g('Last')}".strip(), "distrito": g("StateDst"), "fecha_decl": fd.isoformat()})
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "House Clerk", "serie": f"índice {yr}", "motivo": str(e)[:150]})
    log("PTR en los últimos 12 meses:", len(filings))
    new = 0
    for f in filings:
        if f["doc"] in pc:
            continue
        try:
            pdf = get(f"{CLERK}/ptr-pdfs/{f['year']}/{f['doc']}.pdf", 45, 2)
            with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
                tmp.write(pdf)
                tmp.flush()
                txt = subprocess.run(["pdftotext", "-layout", tmp.name, "-"], capture_output=True, text=True, timeout=30).stdout
            pc[f["doc"]] = parse_ptr(txt) if txt.strip() else []
            new += 1
            time.sleep(0.3)
        except Exception as e:  # noqa: BLE001
            ERRORS.append({"fuente": "House Clerk", "serie": f["doc"], "motivo": str(e)[:120]})
    log("PTR leídos ahora:", new)
    trades = []
    for f in filings:
        for o in pc.get(f["doc"], []):
            trades.append({**o, "nombre": f["nombre"], "distrito": f["distrito"], "fecha_decl": f["fecha_decl"], "doc": f["doc"],
                           "url": f"{CLERK}/ptr-pdfs/{f['year']}/{f['doc']}.pdf"})
    trades.sort(key=lambda o: o["fecha_op"], reverse=True)
    return trades, pc


# ------------------------------------------------------------------ main
def main():
    os.makedirs(DATA, exist_ok=True)
    cache = load_cache()
    try:
        managers, act = dataroma(cache)
    except Exception as e:  # noqa: BLE001
        ERRORS.append({"fuente": "Dataroma", "serie": "portada", "motivo": str(e)[:150]})
        managers, act = [], []
    try:
        trades, pc = congress(cache)
    except Exception as e:  # noqa: BLE001
        ERRORS.append({"fuente": "House Clerk", "serie": "general", "motivo": str(e)[:150]})
        trades, pc = [], cache.get("ptr", {})

    por = {}
    for m in managers:
        for sym, nom, pct, a, sh, val in m.get("pos", []):
            por.setdefault(sym, {"n": nom, "f": [], "c": []})["f"].append([m["code"], pct, a, val])
    for o in trades:
        por.setdefault(o["sym"], {"n": None, "f": [], "c": []})["c"].append([o["nombre"], o["tipo"], o["fecha_op"], o["fecha_decl"], o["importe"], o["clase"]])
    for v in por.values():
        v["f"].sort(key=lambda x: -(x[1] or 0))
    cons = []
    for sym, v in por.items():
        if len(v["f"]) >= 2:
            buys = sum(1 for x in v["f"] if x[2] and (x[2].startswith("Add") or x[2].startswith("Buy")))
            sells = sum(1 for x in v["f"] if x[2] and x[2].startswith("Reduce"))
            cons.append([sym, v["n"], len(v["f"]), round(sum(x[1] or 0 for x in v["f"]) / len(v["f"]), 2), buys, sells])
    cons.sort(key=lambda x: (-x[2], -x[3]))
    out = {
        "generado": NOW.isoformat(timespec="seconds"),
        "gestores": [{k: m.get(k) for k in ("code", "nombre", "actualizado", "trimestre")} | {"n": len(m.get("pos", [])), "pos": m.get("pos", [])} for m in managers],
        "actividad": act, "consenso": cons[:300], "congreso": trades, "por_valor": por,
        "errores": ERRORS[:100], "n_errores": len(ERRORS),
        "fuentes": ["Dataroma (carteras 13F de superinversores)", "Cámara de Representantes de EE. UU. (informes PTR oficiales)"],
        "notas": "13F: se publican hasta 45 días después del cierre de cada trimestre. PTR: hasta 45 días después de la operación; importes en rangos. "
                 "Las operaciones del Congreso se extraen automáticamente del PDF oficial: comprobar en el documento enlazado. "
                 "Senado y otras figuras (p. ej. Trump, declaración anual OGE) no incluidos: sin fuente periódica descargable.",
    }
    json.dump(out, open(os.path.join(DATA, "smart.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"dataroma": {m["code"]: {"actualizado": m["actualizado"], "pos": m.get("pos", [])} for m in managers}, "ptr": pc},
              open(os.path.join(DATA, "smart_cache.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    log(f"Gestores: {len(managers)} · posiciones: {sum(len(m.get('pos', [])) for m in managers)} · movimientos: {len(act)} · operaciones Congreso: {len(trades)} · errores: {len(ERRORS)}")
    for e in ERRORS[:10]:
        log("  ERROR", e)
    for t in ("AAPL", "NVDA", "FN", "GOOGL"):
        v = por.get(t)
        log("  MUESTRA", t, (len(v["f"]), v["f"][:3], v["c"][:2]) if v else None)
    pel = [o for o in trades if "Pelosi" in o["nombre"]][:5]
    log("  PELOSI", pel)


if __name__ == "__main__":
    main()
