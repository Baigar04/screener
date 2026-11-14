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
# Cifras publicadas por las propias empresas (notas de resultados y 10-Q/10-K), revisadas a mano el 14-nov-2026.
# (símbolo, "q" o "fy", fecha de cierre, campo, valor real, fuente). Tolerancia: 0,5 % en importes; 0,02 $ en BPA.
REALES = [
    ("AAPL", "q", "2026-09-26", "ventas", 114477e6, "Apple, resultados T4 FY26 (2-nov-2026)"),
    ("AAPL", "q", "2026-09-26", "bn", 30711e6, "Apple, resultados T4 FY26"),
    ("AAPL", "q", "2026-09-26", "bpa", 2.10, "Apple, resultados T4 FY26 (T4 deducido: aproximado)"),
    ("AAPL", "fy", "2026-09-26", "ventas", 478834e6, "Apple, ejercicio 2026"),
    ("AAPL", "fy", "2026-09-26", "bn", 132175e6, "Apple, ejercicio 2026"),
    ("AAPL", "q", "2025-09-27", "ventas", 102466e6, "Apple, T4 FY25 (comparativo)"),
    ("MSFT", "q", "2026-09-30", "ventas", 92.3e9, "Microsoft, resultados T1 FY27 (28-oct-2026)"),
    ("MSFT", "q", "2026-09-30", "bn", 36629e6, "Microsoft, resultados T1 FY27"),
    ("MSFT", "q", "2026-09-30", "bpa", 4.92, "Microsoft, resultados T1 FY27"),
    ("NVDA", "q", "2026-07-26", "ventas", 96.2e9, "NVIDIA, resultados T2 FY27"),
    ("NVDA", "q", "2026-07-26", "bn", 59.7e9, "NVIDIA, resultados T2 FY27"),
    ("NVDA", "q", "2026-07-26", "bpa", 2.46, "NVIDIA, resultados T2 FY27"),
    ("JPM", "q", "2026-09-30", "bn", 15.3e9, "JPMorgan, 10-Q T3 2026"),
    ("JPM", "q", "2026-09-30", "bpa", 5.57, "JPMorgan, 10-Q T3 2026"),
    ("FN", "q", "2026-09-25", "ventas", 1474.5e6, "Fabrinet, resultados T1 FY27 (2-nov-2026)"),
    ("FN", "q", "2026-09-25", "bn", 103.5e6, "Fabrinet, resultados T1 FY27"),
    ("FN", "q", "2026-09-25", "bpa", 2.86, "Fabrinet, resultados T1 FY27"),
    ("FN", "q", "2026-06-26", "ventas", 1316e6, "Fabrinet, resultados T4 FY26 (T4 deducido)"),
    ("FN", "q", "2026-06-26", "bpa", 3.83, "Fabrinet, resultados T4 FY26 (T4 deducido)"),
    ("FN", "fy", "2026-06-26", "ventas", 4.64e9, "Fabrinet, ejercicio 2026"),
    ("FN", "fy", "2026-06-26", "bn", 473.0e6, "Fabrinet, ejercicio 2026"),
]
COL = {"q": {"ventas": 2, "bn": 3, "bpa": 8}, "fy": {"ventas": 2, "bn": 3}}


def check_reales(sec):
    """Compara la caché con las cifras reales publicadas. Devuelve (correctas, total, fallos)."""
    bad, ok = [], 0
    for sym, kind, end, field, real, src in REALES:
        rows = (sec.get(sym) or {}).get(kind) or []
        row = next((r for r in rows if r[0] == end), None)
        got = row[COL[kind][field]] if row and len(row) > COL[kind][field] else None
        good = got is not None and (abs(got - real) <= 0.02 if field == "bpa" else abs(got / real - 1) <= 0.005)
        if good:
            ok += 1
        else:
            bad.append([sym, kind, end, field, got, real, src])
    return ok, len(REALES), bad
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
    ok, tot, bad = check_reales(sec)
    resumen["casos_reales_ok"] = f"{ok}/{tot}"
    if bad:
        print("::warning::Cifras que no cuadran con lo publicado:", json.dumps(bad, ensure_ascii=False))
    out = {"generado": today, "resumen": resumen, "listas": listas, "casos": casos, "casos_reales_fallos": bad}
    json.dump(out, open(os.path.join(DATA, "auditoria.json"), "w"), separators=(",", ":"))
    print("Auditoría:", json.dumps(resumen, ensure_ascii=False))


if __name__ == "__main__":
    main()
