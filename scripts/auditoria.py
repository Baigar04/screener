"""Auditoría de exactitud de las cuentas (punto 1 de la hoja de ruta, 14-nov-2026).

Comprueba con los datos de cada ejecución, sin descargar nada:
  A. SEC frente a Yahoo: ventas y beneficio neto de los últimos ejercicios (mismo año de cierre).
  B. Cobertura y frescura de las cuentas SEC.
  C. Síntoma de cambio de etiqueta contable: el último ejercicio o trimestre sin ventas teniendo beneficio.
  D. Trimestres anómalos: ventas negativas, 4.º trimestre deducido fuera de rango, saltos bruscos.
  E. BPA frente a beneficio: acciones implícitas (beneficio/BPA) frente a las de la portada del 10-K.
  F. Huecos: trimestres que faltan en los últimos 8.
Escribe data/auditoria.json (resumen, listas por problema y filas en bruto de los casos de control).
"""
import json
import os
import sys
from datetime import date

DATA = sys.argv[1] if len(sys.argv) > 1 else "data"
CASOS = ["AAPL", "MSFT", "NVDA", "JPM", "FN"]
TOP = 60


def load(name):
    try:
        return json.load(open(os.path.join(DATA, name)))
    except Exception:  # noqa: BLE001
        return {}


def days(a, b):
    return (date.fromisoformat(b[:10]) - date.fromisoformat(a[:10])).days


def pct(a, b):
    return None if a is None or b is None or not b else round(100 * (a / b - 1), 2)


def audit(sec, fund, us_syms, today):
    res = {k: [] for k in ("yahoo_ventas", "yahoo_bn", "sin_sec", "pocos_datos", "desfasadas", "etiqueta", "trim_negativo",
                           "t4_raro", "salto", "bpa_acciones", "hueco", "etiqueta_natural")}
    cmp_v, cmp_b = [], []
    for s in us_syms:
        e = sec.get(s)
        if not e:
            res["sin_sec"].append(s)
            continue
        fy, q = e.get("fy") or [], e.get("q") or []
        if len(fy) < 3 or len(q) < 8:
            res["pocos_datos"].append([s, len(fy), len(q)])
        if q and days(q[-1][1] or q[-1][0], today) > 135:
            res["desfasadas"].append([s, q[-1][0], q[-1][1]])
        # C. cambio de etiqueta: ventas que dejan de llegar con el beneficio presente
        if fy and fy[-1][2] is None and fy[-1][3] is not None and any(r[2] for r in fy[:-1]):
            res["etiqueta"].append([s, "ejercicio", fy[-1][0], max(r[0] for r in fy if r[2] is not None)])
        if q and q[-1][2] is None and q[-1][3] is not None and any(r[2] for r in q[:-1]):
            res["etiqueta"].append([s, "trimestre", q[-1][0], max(r[0] for r in q if r[2] is not None)])
        # A. SEC frente a Yahoo (ejercicios por año de cierre)
        an = (fund.get(s) or {}).get("anual") or {}
        for r in fy[-3:]:
            y = r[0][:4]
            ya = an.get(y) or {}
            dv, db = pct(ya.get("ventas"), r[2]), pct(ya.get("beneficio_neto"), r[3])
            if dv is not None:
                cmp_v.append(abs(dv))
                if abs(dv) > 5:
                    res["yahoo_ventas"].append([s, y, r[2], ya.get("ventas"), dv])
            if db is not None and abs(r[3] or 0) > 1e7:
                cmp_b.append(abs(db))
                if abs(db) > 5:
                    res["yahoo_bn"].append([s, y, r[3], ya.get("beneficio_neto"), db])
        # D, E, F. trimestres (últimos 12)
        qq = q[-12:]
        for i, r in enumerate(qq):
            v = r[2]
            if v is not None and v < 0:
                res["trim_negativo"].append([s, r[0], r[9] if len(r) > 9 else None, v])
            if len(r) > 10 and r[10] == "10-K" and v is not None:
                prev = [x[2] for x in qq[max(0, i - 3):i] if x[2] is not None]
                if len(prev) == 3:
                    m = sum(prev) / 3
                    if m > 0 and not 0.4 <= v / m <= 2.5:
                        res["t4_raro"].append([s, r[0], v, round(m), round(v / m, 2)])
            if i and v and qq[i - 1][2] and qq[i - 1][2] > 0 and v > 0:
                ratio = v / qq[i - 1][2]
                if ratio > 3 or ratio < 1 / 3:
                    res["salto"].append([s, qq[i - 1][0], r[0], qq[i - 1][2], v, round(ratio, 2)])
            if i and days(qq[i - 1][0], r[0]) > 100:
                res["hueco"].append([s, qq[i - 1][0], r[0]])
            if len(r) > 9 and r[9] and str(r[9]).startswith("CY"):
                res["etiqueta_natural"].append([s, r[0]])
        # E. BPA frente a beneficio, con las acciones de la portada del último 10-K
        sh = next((r[9] for r in reversed(fy) if r[9]), None)
        for r in qq[-4:]:
            if len(r) > 8 and r[8] and abs(r[8]) > 0.05 and r[3] and r[3] > 0 and sh:
                impl = r[3] / r[8]
                if impl > 0 and not 0.6 <= impl / sh <= 1.6:
                    res["bpa_acciones"].append([s, r[0], r[3], r[8], round(impl), sh, round(impl / sh, 2)])
                    break
    dedupe = {"etiqueta_natural": True, "hueco": True, "salto": True}
    for k in dedupe:   # una entrada por empresa
        seen, out = set(), []
        for x in res[k]:
            if x[0] not in seen:
                seen.add(x[0])
                out.append(x)
        res[k] = out
    med = lambda v: sorted(v)[len(v) // 2] if v else None  # noqa: E731
    resumen = {"empresas_eeuu": len(us_syms), "con_sec": len(us_syms) - len(res["sin_sec"]),
               "comparaciones_ventas": len(cmp_v), "dif_mediana_ventas_pct": med(cmp_v),
               "ventas_dif_5pct": len(res["yahoo_ventas"]), "ventas_dif_1pct": sum(1 for x in cmp_v if x > 1),
               "comparaciones_bn": len(cmp_b), "dif_mediana_bn_pct": med(cmp_b), "bn_dif_5pct": len(res["yahoo_bn"])}
    resumen.update({f"n_{k}": len(v) for k, v in res.items() if k not in ("yahoo_ventas", "yahoo_bn")})
    for k in ("yahoo_ventas", "yahoo_bn"):
        res[k].sort(key=lambda x: -abs(x[-1]))
    return resumen, {k: v[:TOP] for k, v in res.items()}


def main():
    sec = load("sec_cache.json").get("sim", {})
    fund = load("fund_cache.json")
    uni = load("universe.json").get("filas", [])
    us = [r["sym"] for r in uni if r.get("region") == "EE. UU." or ("." not in r["sym"] and r.get("pais") == "United States")]
    today = date.today().isoformat()
    resumen, listas = audit(sec, fund, us, today)
    casos = {s: {"fy": (sec.get(s) or {}).get("fy", [])[-4:], "q": (sec.get(s) or {}).get("q", [])[-6:],
                 "yahoo": {y: v for y, v in ((fund.get(s) or {}).get("anual") or {}).items() if y >= "2022"}} for s in CASOS}
    out = {"generado": today, "resumen": resumen, "listas": listas, "casos": casos}
    json.dump(out, open(os.path.join(DATA, "auditoria.json"), "w"), separators=(",", ":"))
    print("Auditoría:", json.dumps(resumen, ensure_ascii=False))


if __name__ == "__main__":
    main()
