"""Fase 1.3: señales a horizontes cerrados y foto diaria de la nota (score.py)."""
import json

import pytest

import score


def write_p(folder, sym, closes, start="2026-01-01"):
    import pandas as pd
    t = [d.strftime("%Y-%m-%d") for d in pd.bdate_range(start, periods=len(closes))]
    (folder / f"{sym}.json").write_text(json.dumps({"sym": sym, "t": t, "c": closes}))
    return t


def test_split_safe_como_en_la_web():
    assert score.split_safe(0.5) == 1.0 and score.split_safe(0.1) == 1.0 and score.split_safe(3.01) == 1.0
    assert score.split_safe(1.08) == 1.08 and score.split_safe(0.45) == 0.45


def test_horizonte_cerrado_y_split(tmp_path):
    closes = [100.0 * 1.01 ** i for i in range(30)]
    closes[10:] = [c / 2 for c in closes[10:]]                 # split 2:1 el día 10
    t = write_p(tmp_path, "AAA", closes)
    C = score.Closes(str(tmp_path))
    # el día del split cuenta como día sin cambio (se pierde ese 1 %), nunca como una caída del 50 %
    assert C.fwd("AAA", t[0], 21) == pytest.approx(1.01 ** 20 - 1)
    assert C.fwd("AAA", t[5], 21) == pytest.approx(1.01 ** 20 - 1)
    assert C.fwd("AAA", t[10], 19) == pytest.approx(1.01 ** 19 - 1)
    assert C.fwd("AAA", t[9], 21) is None                    # 9 + 21 = 30 sesiones: aún no se ha cerrado
    assert C.fwd("AAA", "2025-12-01", 21) is None            # antes del primer dato
    assert C.fwd("NOEXISTE", t[0], 21) is None


def test_senales_solo_con_horizonte_cerrado(tmp_path):
    t = None
    for i in range(30):                                      # universo: 30 valores; 5 alcistas suben más
        g = 1.02 if i < 5 else 1.0
        t = write_p(tmp_path, f"S{i}", [100.0 * g ** k for k in range(40)])
    C = score.Closes(str(tmp_path))
    week = {"fecha": t[2] + "T21:50:00+00:00", "precios": {f"S{i}": 100.0 for i in range(30)},
            "senales": {**{f"S{i}": ["Alcista", 100.0] for i in range(5)}, "S20": ["Bajista", 100.0]}}
    out = score.eval_signals([week], C)
    assert {x["horizonte"] for x in out} == {"1m"}           # 3m/6m/12m aún abiertos
    al = next(x for x in out if x["tipo"] == "Alcista")
    assert al["aciertos"] == 100.0 and al["sesiones"] == 21 and al["rent_media"] == pytest.approx(100 * (1.02 ** 21 - 1), abs=0.01)
    ba = next(x for x in out if x["tipo"] == "Bajista")
    assert ba["aciertos"] == 100.0                           # subió menos que el universo


def test_foto_diaria_evaluada_tal_cual(tmp_path):
    t = None
    for i in range(50):
        t = write_p(tmp_path, f"S{i}", [100.0 * (1 + i / 1000) ** k for k in range(30)])
    C = score.Closes(str(tmp_path))
    days = [{"fecha": t[0], "nota": {f"S{i}": float(i) for i in range(50)}},      # la nota ordena igual que la rentabilidad
            {"fecha": t[20], "nota": {f"S{i}": float(i) for i in range(50)}}]     # horizonte aún abierto
    r = score.eval_daily(days, C)
    assert r["1m"]["dias"] == 1 and r["1m"]["ic"] == pytest.approx(1.0)
    assert r["1m"]["q5_vs_universo"] > 0
    assert r["3m"]["dias"] == 0 and r["3m"]["ic"] is None
