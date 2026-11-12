#!/usr/bin/env python3
"""Prueba real del respaldo de precios (Fase 1.5), sin tocar los datos publicados.

1. Simula que Yahoo falla para 20 valores → los precios deben llegar de Stooq.
2. Compara el último cierre común de Stooq con el de Yahoo: diferencia < 0,5 % en los 20.
Termina con error si alguna de las dos cosas no se cumple.
"""
import os
import sys

os.environ["YAHOO_FALLO_SIMULADO"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_equities as fe  # noqa: E402

SYMS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "XOM", "JNJ", "PG",
        "KO", "PEP", "WMT", "HD", "V", "MA", "UNH", "CVX", "BRK-B", "SAP.DE"]


def main():
    frames, raw = fe.prices(SYMS)
    from_stooq = [s for s in SYMS if s in fe.STOOQ_USED]
    print(f"Fallo simulado de Yahoo: {len(from_stooq)} de {len(SYMS)} con precios de Stooq", flush=True)
    fe._SIM = ""                       # ahora Yahoo «funciona» para comparar
    fe.STOOQ_USED.clear()
    y, _ = fe.prices(SYMS)
    worst, rows = 0.0, []
    for s in SYMS:
        if s not in raw or s not in y:
            rows.append((s, None, None, None, "sin dato"))
            continue
        st, ya = raw[s]["Close"], fe.yf.download(s, period="1mo", auto_adjust=False, progress=False)["Close"]
        ya = ya.iloc[:, 0] if hasattr(ya, "columns") else ya
        common = st.index.intersection(ya.dropna().index)
        if not len(common):
            rows.append((s, None, None, None, "sin fechas comunes"))
            continue
        d = common[-1]
        diff = abs(st[d] / ya[d] - 1) * 100
        worst = max(worst, diff)
        rows.append((s, d.strftime("%Y-%m-%d"), round(float(st[d]), 2), round(float(ya[d]), 2), f"{diff:.3f} %"))
    for r in rows:
        print("  ", *r, flush=True)
    ok_sim = len(from_stooq) == len(SYMS)
    ok_diff = all(r[1] for r in rows) and worst < 0.5
    print(f"Resultado: respaldo {'OK' if ok_sim else 'FALLA'} · diferencia máxima {worst:.3f} % ({'OK' if ok_diff else 'FALLA'})", flush=True)
    return 0 if ok_sim and ok_diff else 1


if __name__ == "__main__":
    sys.exit(main())
