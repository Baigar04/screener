"""Factores académicos a partir de las cuentas de la SEC (sec_cache.json), «a fecha» de presentación.

Filas anuales (fy): [fin, presentado, ventas, bn, ebit, patrimonio, deuda, cfo, capex, acciones, activos, bruto, ac, pc,
 caja+inv. cp, pagos con acciones, intereses, vencimientos 12 m, vencimientos año 2, recompras, acciones diluidas medias]
Filas trimestrales (q): [fin, presentado, ventas_3m, bn_3m, ebit_3m, bruto_3m, activos, patrimonio]

Factores (referencia):
  · gp   Rentabilidad bruta = beneficio bruto / activos (Novy-Marx, 2013). Más alto, mejor.
  · ag   Crecimiento de activos (Cooper, Gulen y Schill, 2008). Más bajo, mejor.
  · acr  Devengos = (beneficio neto − flujo de caja operativo) / activos medios (Sloan, 1996). Más bajo, mejor.
  · nsi  Emisión neta de acciones en un año (Pontiff y Woodgate, 2008). Más bajo, mejor.
  · fs   F-score de Piotroski (2000), 0-9, reescalado si falta alguna de las 9 señales (mínimo 7). Más alto, mejor.
  · sue  Sorpresa de beneficios estandarizada: (BN trimestral − BN del mismo trimestre del año anterior) / desviación
         de esas diferencias en los 8 trimestres previos (Foster, Olsen y Shevlin, 1984). Más alto, mejor.
"""

# índices de las filas anuales
VE, BN, EB, EQ, DE, CFO, CPX, SH, AS, GR, AC, PC = 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13


def unsplit(r):
    """Cociente de acciones sin el efecto de un split (fase 9): un salto ≥1,8× (o ≤0,55×) a menos de un 5 % de una
    proporción entera es un split o contrasplit, no emisión; se divide por esa proporción."""
    for n in (2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50):
        if r >= 1.8 and abs(r / n - 1) < 0.05:
            return r / n
        if r <= 0.55 and abs(r * n - 1) < 0.05:
            return r * n
    return r


def _g(row, i):
    if row is None or len(row) <= i:
        return None
    v = row[i]
    return v if isinstance(v, (int, float)) and v == v else None


def _ratio(a, b):
    return a / b if a is not None and b not in (None, 0) else None


def annual_factors(cur, prev):
    """Factores de un ejercicio (cur) frente al anterior (prev). Devuelve un dict con None donde falta dato."""
    out = {"gp": None, "ag": None, "acr": None, "nsi": None, "fs": None}
    a1, a0 = _g(cur, AS), _g(prev, AS)
    if a1 and a1 > 0:
        out["gp"] = _ratio(_g(cur, GR), a1)
    if a1 and a0 and a0 > 0:
        out["ag"] = a1 / a0 - 1
    bn, cfo = _g(cur, BN), _g(cur, CFO)
    avg = (a1 + a0) / 2 if a1 and a0 else a1
    if bn is not None and cfo is not None and avg and avg > 0:
        out["acr"] = (bn - cfo) / avg
    s1, s0 = _g(cur, SH), _g(prev, SH)
    if s1 and s0 and s0 > 0:
        out["nsi"] = unsplit(s1 / s0) - 1
    out["fs"] = fscore(cur, prev)
    return out


def fscore(cur, prev):
    """F-score de Piotroski con las señales disponibles (al menos 7 de 9), reescalado a 0-9."""
    if prev is None:
        return None
    a1, a0 = _g(cur, AS), _g(prev, AS)
    if not a1 or not a0 or a1 <= 0 or a0 <= 0:
        return None
    sig = []
    roa1, roa0 = _ratio(_g(cur, BN), a1), _ratio(_g(prev, BN), a0)
    cfo = _g(cur, CFO)
    if roa1 is not None:
        sig.append(roa1 > 0)
    if cfo is not None:
        sig.append(cfo > 0)
    if roa1 is not None and roa0 is not None:
        sig.append(roa1 > roa0)
    if cfo is not None and _g(cur, BN) is not None:
        sig.append(cfo > _g(cur, BN))
    l1, l0 = _ratio(_g(cur, DE), a1), _ratio(_g(prev, DE), a0)
    if l1 is not None and l0 is not None:
        sig.append(l1 <= l0)
    c1, c0 = _ratio(_g(cur, AC), _g(cur, PC)), _ratio(_g(prev, AC), _g(prev, PC))
    if c1 is not None and c0 is not None:
        sig.append(c1 > c0)
    s1, s0 = _g(cur, SH), _g(prev, SH)
    if s1 and s0:
        sig.append(s1 <= s0 * 1.005)
    m1, m0 = _ratio(_g(cur, GR), _g(cur, VE)), _ratio(_g(prev, GR), _g(prev, VE))
    if m1 is not None and m0 is not None:
        sig.append(m1 > m0)
    t1, t0 = _ratio(_g(cur, VE), a1), _ratio(_g(prev, VE), a0)
    if t1 is not None and t0 is not None:
        sig.append(t1 > t0)
    if len(sig) < 7:
        return None
    return round(9 * sum(sig) / len(sig), 1)


def q_known(q, lim):
    """Trimestres presentados en o antes de lim (AAAA-MM-DD), ordenados por fin de trimestre."""
    return sorted((r for r in q or [] if r[1] and r[1] <= lim), key=lambda r: r[0])


def sue(qrows):
    """Sorpresa estandarizada del último trimestre conocido (lista ordenada de filas trimestrales)."""
    by_end = {r[0]: r for r in qrows}
    ends = [r[0] for r in qrows]

    def yoy_diff(e):
        r = by_end[e]
        y, m = int(e[:4]), e[5:7]
        prior = next((by_end[k] for k in ends if k[:4] == str(y - 1) and abs(int(k[5:7]) - int(m)) <= 1), None)
        if prior is None or r[3] is None or prior[3] is None:
            return None
        return r[3] - prior[3]
    diffs = [(e, yoy_diff(e)) for e in ends]
    diffs = [(e, d) for e, d in diffs if d is not None]
    if len(diffs) < 7:
        return None
    last = diffs[-1][1]
    hist = [d for _, d in diffs[-9:-1]]
    if len(hist) < 6:
        return None
    m = sum(hist) / len(hist)
    sd = (sum((x - m) ** 2 for x in hist) / (len(hist) - 1)) ** 0.5
    return last / sd if sd > 0 else None


def current(entry):
    """Factores actuales de una empresa (para la web): anuales del último 10-K, y rentabilidad bruta y SUE con los
    últimos trimestres si existen (más recientes)."""
    fy = sorted((entry or {}).get("fy") or [], key=lambda r: r[0])
    q = sorted((entry or {}).get("q") or [], key=lambda r: r[0])
    res = {"gp": None, "ag": None, "acr": None, "nsi": None, "fs": None, "sue": None, "fecha": None}
    if len(fy) >= 2:
        res.update(annual_factors(fy[-1], fy[-2]))
        res["fecha"] = fy[-1][0]
    if len(q) >= 4:
        last4 = q[-4:]
        gr = [r[5] for r in last4]
        if all(v is not None for v in gr) and last4[-1][6]:
            res["gp"] = sum(gr) / last4[-1][6]
            res["fecha"] = max(res["fecha"] or "", q[-1][0])
        res["sue"] = sue(q)
    return res
