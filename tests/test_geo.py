"""Fase 2 · Geopolítica (scripts/fetch_geo.py)."""
import os
import sys
from datetime import date, timedelta

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import fetch_geo as G  # noqa: E402


def test_ols_y_sobresaltos():
    rng = np.random.default_rng(1)
    x = rng.normal(size=200)
    y = 2 + 3 * x + rng.normal(scale=0.1, size=200)
    b, se, r2 = G.ols(y, x)
    assert abs(b[1] - 3) < 0.05 and r2 > 0.99
    z = G.gpr_shocks([[f"2000-{m:02d}", 100 + m] for m in range(1, 13)])
    assert len(z) == 11 and abs(np.mean(list(z.values()))) < 1e-9


def test_estudio_de_eventos():
    d0 = date(2000, 1, 3)
    s = [(d0 + timedelta(days=i), 100.0 + i * 0.1) for i in range(400)]
    evs = [d0 + timedelta(days=k) for k in (50, 150, 250)]
    r = G.event_study(evs, s)
    assert r["n"] == 3 and r["m20"] > 0 and r["pos20"] == 100


def test_precedente_de_la_cesta():
    d0 = date(2015, 1, 1)
    v = [100.0] * 100 + list(np.linspace(100, 85, 20)) + list(np.linspace(85, 110, 200)) + [110.0] * 100
    lv = [(d0 + timedelta(days=i), x) for i, x in enumerate(v)]
    p = G.basket_precedent(lv)
    assert p and p["n"] == 1 and p["media6m"] > 0


def test_pistas_y_lectura():
    Gd = {"global": {"pct": 92, "pct7": 95, "tendencia": "sube", "amenazas": 180, "actos": 120},
          "defensa": {"dd3m": -16.0, "r1a": 20.0, "valores": ["IDR.MC"], "precedente": {"n": 6, "media6m": 14.2, "positivos": 83, "fechas": ["2022-03-01"]}},
          "paises": [{"code": "TWN", "nombre": "Taiwán", "pct": 96, "d3": 25}, {"code": "ESP", "nombre": "España", "pct": 40, "d3": 5}],
          "eventos": {"escalada": {"ndx": {"nombre": "Nasdaq 100", "m5": -1.2, "m20": 0.8, "pos20": 60}, "hsi": {"nombre": "Hang Seng", "m5": -2.0, "m20": -0.5, "pos20": 45}},
                      "relajacion": {}},
          "sens_bolsas": {"dax": {"nombre": "DAX", "beta2": -1.1}, "sp500": {"nombre": "S&P 500", "beta2": -0.4}},
          "sectores": {"Industrials": {"mediana": 0.6}, "Consumer Cyclical": {"mediana": -0.9}}}
    pistas, L = G.lectura_y_pistas(Gd)
    ids = [p["id"] for p in pistas]
    assert ids[0] == "defensa" and pistas[0]["estado"] == "Oportunidad" and "+14,2 %" in pistas[0]["precedente"]
    assert "pais-TWN" in ids and "nivel" in ids and "pais-ESP" not in ids
    assert "muy alto" in L["conclusion"] and "amenazas" in L["conclusion"]
    assert any("Taiwán" in b for b in L["bloques"]) and L["vigilar"] and L["cambiaria"]
