#!/usr/bin/env python3
"""Validación previa a publicar: ningún JSON roto o incompleto sustituye a la última versión publicada.

Para cada fichero de data/ comprueba estructura, número de filas (≥ 95 % de la versión publicada), rangos,
monedas y fechas. Si un fichero no pasa, se sustituye por la última versión publicada (que pasó esta misma
validación al publicarse). Si no se puede recuperar, el script termina con error y el workflow no despliega:
la web sigue mostrando la última versión válida.

Uso: python scripts/validate.py   (variables opcionales: SITE_URL, VALIDATE_PREV_DIR para pruebas sin red)
Salida: data/validacion.json con el resultado de cada fichero.
"""
import json
import math
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

DATA = os.environ.get("VALIDATE_DATA_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
SITE = os.environ.get("SITE_URL", "https://baigar04.github.io/screener/")
PREV_DIR = os.environ.get("VALIDATE_PREV_DIR")  # carpeta con la «versión publicada» (pruebas locales)
MIN_RATIO = 0.95
MAX_AGE_DAYS = 5          # «generado» no puede ser más antiguo (fin de semana + festivo)
PRICE_STALE_DAYS = 10     # un precio con más días se considera desfasado
MIN_FRESH_SHARE = 0.80    # al menos el 80 % de los precios deben estar al día
CURRENCY = re.compile(r"^[A-Z]{3}$")
CURRENCY_MINOR = {"GBp", "GBX", "ZAc", "ILA"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


class Invalid(Exception):
    pass


def now():
    return datetime.now(timezone.utc)


def check(cond, msg):
    if not cond:
        raise Invalid(msg)


def finite(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def num_or_none(x):
    return x is None or finite(x)


def parse_dt(s):
    d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def check_generado(d, name):
    check(isinstance(d, dict), f"{name}: no es un objeto JSON")
    check("generado" in d, f"{name}: falta «generado»")
    try:
        g = parse_dt(d["generado"])
    except Exception:  # noqa: BLE001
        raise Invalid(f"{name}: «generado» no es una fecha ISO ({d['generado']!r})") from None
    check(g <= now() + timedelta(hours=1), f"{name}: «generado» está en el futuro ({d['generado']})")
    check(now() - g <= timedelta(days=MAX_AGE_DAYS), f"{name}: «generado» tiene más de {MAX_AGE_DAYS} días ({d['generado']})")
    return g


def check_ratio(n, prev_n, what):
    if prev_n:
        check(n >= MIN_RATIO * prev_n, f"{what}: {n} filas frente a {prev_n} publicadas (< {int(MIN_RATIO * 100)} %)")


def check_date(s, what, ref, fut_days=1):
    check(isinstance(s, str) and DATE.match(s), f"{what}: fecha no válida ({s!r})")
    check(s[:10] <= (ref + timedelta(days=fut_days)).strftime("%Y-%m-%d"), f"{what}: fecha en el futuro ({s})")


# ------------------------------------------------------------------ reglas por fichero
def v_macro(d, prev):
    check_generado(d, "macro.json")
    S = d.get("series")
    check(isinstance(S, dict) and S, "macro.json: sin series")
    ok = [s for s in S.values() if isinstance(s, dict) and s.get("estado") == "ok"]
    check(len(ok) >= 1, "macro.json: ninguna serie al día")
    for s in ok:
        check(finite(s.get("valor")), f"macro.json: {s.get('id')} con valor no numérico ({s.get('valor')!r})")
        check_date(s.get("fecha_dato"), f"macro.json: {s.get('id')}", now(), fut_days=40)  # algunos datos llevan fecha de fin de periodo
    if prev:
        pok = sum(1 for s in (prev.get("series") or {}).values() if isinstance(s, dict) and s.get("estado") == "ok")
        check_ratio(len(ok), pok, "macro.json (series al día)")
    R = d.get("regimen") or {}
    if R.get("estado") == "ok":
        p = R.get("probabilidades") or {}
        check(p and all(finite(v) and 0 <= v <= 100 for v in p.values()), "macro.json: pesos del régimen fuera de 0-100")
    return f"{len(ok)}/{len(S)} series al día"


def v_universe(d, prev):
    g = check_generado(d, "universe.json")
    F = d.get("filas")
    check(isinstance(F, list) and F, "universe.json: sin filas")
    syms = [r.get("sym") for r in F if isinstance(r, dict)]
    check(len(syms) == len(F) and all(isinstance(s, str) and s for s in syms), "universe.json: filas sin símbolo")
    check(len(set(syms)) == len(syms), "universe.json: símbolos duplicados")
    if prev:
        check_ratio(len(F), len(prev.get("filas") or []), "universe.json")
    fresh = with_px = 0
    for r in F:
        s = r["sym"]
        px = r.get("precio")
        check(px is None or (finite(px) and px > 0), f"universe.json: {s} con precio no válido ({px!r})")
        for k in ("mcap", "mcap_usd", "acciones"):
            v = r.get(k)
            check(v is None or (finite(v) and 0 <= v < 1e14), f"universe.json: {s} con {k} fuera de rango ({v!r})")
        for k in ("per", "pb", "ev_ebitda", "roe", "margen_op", "crec_ventas", "r1d", "r1m", "r3m", "r6m", "r1a", "sma50", "sma200", "deuda_neta_ebitda"):
            check(num_or_none(r.get(k)), f"universe.json: {s} con {k} no numérico ({r.get(k)!r})")
        v = r.get("rsi")
        check(v is None or (finite(v) and 0 <= v <= 100), f"universe.json: {s} con RSI fuera de 0-100 ({v!r})")
        v = r.get("vol3m")
        check(v is None or (finite(v) and 0 <= v <= 1000), f"universe.json: {s} con volatilidad fuera de rango ({v!r})")
        m = r.get("moneda")
        check(m is None or (isinstance(m, str) and (CURRENCY.match(m) or m in CURRENCY_MINOR)), f"universe.json: {s} con moneda no válida ({m!r})")
        if px is not None:
            with_px += 1
            fp = r.get("fecha_precio")
            check_date(fp, f"universe.json: {s} fecha_precio", g)
            if (g.date() - datetime.fromisoformat(fp[:10]).date()).days <= PRICE_STALE_DAYS:
                fresh += 1
    check(with_px > 0, "universe.json: ningún valor con precio")
    check(fresh >= MIN_FRESH_SHARE * with_px, f"universe.json: solo {fresh} de {with_px} precios con menos de {PRICE_STALE_DAYS} días")
    return f"{len(F)} valores · {fresh}/{with_px} precios al día"


def v_sectors(d, prev):
    check_generado(d, "sectors.json")
    st = (d.get("stats") or {}).get("Todos") or {}
    check(isinstance(st.get("sector"), dict) and st["sector"], "sectors.json: sin estadísticas por sector")
    if prev:
        check_ratio(len(st["sector"]), len(((prev.get("stats") or {}).get("Todos") or {}).get("sector") or {}), "sectors.json (sectores)")
    return f"{len(st['sector'])} sectores"


def v_score(d, prev):
    check_generado(d, "score.json")
    F, T = d.get("factores"), d.get("total_defecto")
    check(isinstance(F, dict) and F and isinstance(T, dict), "score.json: sin factores")
    if prev:
        check_ratio(len(F), len(prev.get("factores") or {}), "score.json")
    for s, f in F.items():
        check(isinstance(f, dict), f"score.json: {s} sin factores")
        for k, v in f.items():
            check(v is None or (finite(v) and 0 <= v <= 100), f"score.json: {s}.{k} fuera de 0-100 ({v!r})")
        t = T.get(s)
        check(t is None or (finite(t) and 0 <= t <= 100), f"score.json: nota de {s} fuera de 0-100 ({t!r})")
    return f"{len(F)} valores puntuados"


def v_score_hist(d, prev):
    W = d.get("semanas") if isinstance(d, dict) else None
    check(isinstance(W, list), "score_hist.json: sin «semanas»")
    if prev:
        check(len(W) >= min(len(prev.get("semanas") or []), 104) - 1, "score_hist.json: ha perdido semanas registradas")
    for w in W:
        check_date(w.get("fecha"), "score_hist.json: semana", now())
    return f"{len(W)} semanas"


def v_score_daily(d, prev):
    W = d.get("dias") if isinstance(d, dict) else None
    check(isinstance(W, list) and W, "score_diario.json: sin «dias»")
    if prev:
        check(len(W) >= len(prev.get("dias") or []) - 1, "score_diario.json: ha perdido fotos diarias")
    for w in W:
        check_date(w.get("fecha"), "score_diario.json: foto", now())
        check(isinstance(w.get("nota"), dict), "score_diario.json: foto sin notas")
    return f"{len(W)} fotos diarias"


def v_smart(d, prev):
    check_generado(d, "smart.json")
    G, P = d.get("gestores"), d.get("por_valor")
    check(isinstance(G, list) and isinstance(P, dict) and isinstance(d.get("congreso"), list), "smart.json: estructura incompleta")
    if prev:
        check_ratio(len(G), len(prev.get("gestores") or []), "smart.json (gestores)")
        check_ratio(len(P), len(prev.get("por_valor") or {}), "smart.json (valores)")
    return f"{len(G)} gestores · {len(P)} valores"


def v_lab(d, prev):
    check_generado(d, "lab.json")
    v = (d.get("veredicto") or {}).get("etiqueta")
    check(v in ("oportunidad", "ordenación"), f"lab.json: veredicto no válido ({v!r})")
    check(isinstance(d.get("categorias"), list) and d["categorias"], "lab.json: sin categorías")
    for c in d["categorias"]:
        check(num_or_none(c.get("ic")) and (c.get("ic") is None or -1 <= c["ic"] <= 1), f"lab.json: IC fuera de rango en {c.get('k')}")
    return f"veredicto «{v}» · {d.get('meses')} meses"


def v_dict(name, min_ratio=True):
    def f(d, prev):
        check(isinstance(d, dict), f"{name}: no es un objeto JSON")
        body = d.get("sim") if name == "sec_cache.json" else d
        check(isinstance(body, dict), f"{name}: estructura incompleta")
        if prev and min_ratio:
            pb = prev.get("sim") if name == "sec_cache.json" else prev
            check_ratio(len(body), len(pb or {}), name)
        return f"{len(body)} entradas"
    return f


RULES = {
    "macro.json": v_macro,
    "universe.json": v_universe,
    "sectors.json": v_sectors,
    "score.json": v_score,
    "score_hist.json": v_score_hist,
    "score_diario.json": v_score_daily,
    "smart.json": v_smart,
    "lab.json": v_lab,
    "fund_cache.json": v_dict("fund_cache.json"),
    "news_cache.json": v_dict("news_cache.json", min_ratio=False),
    "sec_cache.json": v_dict("sec_cache.json"),
    "smart_cache.json": v_dict("smart_cache.json", min_ratio=False),
    "lab_extra.json": v_dict("lab_extra.json", min_ratio=False),
}
# si se recupera un fichero, también los que se calculan a partir de él (para que la web sea coherente)
DERIVED = {"universe.json": ["sectors.json", "score.json"]}


# ------------------------------------------------------------------ versión publicada
def published_bytes(name):
    if PREV_DIR:
        p = os.path.join(PREV_DIR, name)
        return open(p, "rb").read() if os.path.exists(p) else None
    try:
        req = urllib.request.Request(SITE + "data/" + name, headers={"User-Agent": "screener-personal"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    except Exception:  # noqa: BLE001
        return None


def load_json_bytes(b):
    try:
        return json.loads(b)
    except Exception:  # noqa: BLE001
        return None


def main():
    report, failed = {}, []
    restore = set()
    prev_cache = {}

    def prev_of(name):
        if name not in prev_cache:
            b = published_bytes(name)
            prev_cache[name] = (b, load_json_bytes(b) if b else None)
        return prev_cache[name]

    for name, rule in RULES.items():
        p = os.path.join(DATA, name)
        if not os.path.exists(p):
            report[name] = {"estado": "ausente"}
            continue
        try:
            try:
                d = json.load(open(p, encoding="utf-8"))
            except Exception as e:  # noqa: BLE001
                raise Invalid(f"{name}: JSON no válido ({str(e)[:120]})") from None
            prev = prev_of(name)[1]
            msg = rule(d, prev if isinstance(prev, dict) else None)
            report[name] = {"estado": "ok", "detalle": msg}
            print(f"OK   {name}: {msg}", flush=True)
        except Invalid as e:
            report[name] = {"estado": "no válido", "motivo": str(e)}
            print(f"FALLA {e}", flush=True)
            restore.add(name)
            restore.update(DERIVED.get(name, []))

    for name in sorted(restore):
        b, j = prev_of(name)
        p = os.path.join(DATA, name)
        if b is None or j is None:
            if os.path.exists(os.path.join(DATA, name)) and report.get(name, {}).get("estado") == "ok":
                # derivado válido sin versión publicada: se conserva
                continue
            failed.append(name)
            print(f"ERROR {name}: no válido y sin versión publicada que recuperar", flush=True)
            continue
        open(p, "wb").write(b)
        report.setdefault(name, {})["recuperado"] = "última versión publicada"
        print(f"RECUPERADO {name}: se publica la última versión válida", flush=True)

    os.makedirs(DATA, exist_ok=True)
    json.dump({"generado": now().isoformat(timespec="seconds"), "ficheros": report, "recuperados": sorted(restore), "sin_recuperar": failed},
              open(os.path.join(DATA, "validacion.json"), "w"), ensure_ascii=False, indent=1)
    if failed:
        print("Validación: hay ficheros no válidos sin versión anterior; no se publica nada nuevo.", flush=True)
        return 1
    print(f"Validación: {sum(1 for r in report.values() if r.get('estado') == 'ok')} ficheros correctos · recuperados: {sorted(restore) or 'ninguno'}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
