#!/usr/bin/env python3
"""Prueba real del respaldo de precios (Fase 1.5, Tiingo), sin tocar los datos publicados.

1. Simula que Yahoo falla para 20 valores de EE. UU. → los precios deben llegar de Tiingo.
2. Compara el último cierre común de Tiingo con el de Yahoo (ambos sin ajustar): diferencia < 0,5 % en los 20.
Termina con error si alguna de las dos cosas no se cumple. Usa 20 de las 50 peticiones por hora del plan gratuito.
"""
import os
import sys

os.environ["YAHOO_FALLO_SIMULADO"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_equities as fe  # noqa: E402

SYMS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "XOM", "JNJ", "PG",
        "KO", "PEP", "WMT", "HD", "V", "MA", "UNH", "CVX", "BRK-B", "AVGO"]


def main():
    if not fe.TIINGO_KEY:
        print("FALLA: no hay secreto TIINGO_KEY", flush=True)
        return 1
    _, raw = fe.prices(SYMS)
    got = [s for s in SYMS if s in fe.TIINGO_USED]
    print(f"Fallo simulado de Yahoo: {len(got)} de {len(SYMS)} con precios de Tiingo", flush=True)
    fe._SIM = ""
    worst, rows = 0.0, []
    ya = fe.yf.download(SYMS, period="1mo", auto_adjust=False, progress=False, group_by="ticker", threads=True)
    for s in SYMS:
        try:
            yc = ya[s]["Close"].dropna()
        except Exception:  # noqa: BLE001
            yc = None
        if s not in raw or yc is None or not len(yc):
            rows.append((s, "sin dato"))
            continue
        tc = raw[s]["Close"]
        common = tc.index.intersection(yc.index)
        if not len(common):
            rows.append((s, "sin fechas comunes"))
            continue
        d = common[-1]
        diff = abs(tc[d] / yc[d] - 1) * 100
        worst = max(worst, diff)
        rows.append((s, d.strftime("%Y-%m-%d"), round(float(tc[d]), 2), round(float(yc[d]), 2), f"{diff:.3f} %"))
    for r in rows:
        print("  ", *r, flush=True)
    ok_sim = len(got) == len(SYMS)
    ok_diff = all(len(r) == 5 for r in rows) and worst < 0.5
    print(f"Resultado: respaldo {'OK' if ok_sim else 'FALLA'} · diferencia máxima {worst:.3f} % ({'OK' if ok_diff else 'FALLA'})", flush=True)
    return 0 if ok_sim and ok_diff else 1


if __name__ == "__main__":
    sys.exit(main())
