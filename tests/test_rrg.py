"""Rotación sectorial (diseño A): por región, normalizada en torno a 100, cola de 8 semanas."""
import sys
import types

import numpy as np
import pandas as pd

try:
    import yfinance  # noqa: F401
except ImportError:
    sys.modules["yfinance"] = types.ModuleType("yfinance")
import fetch_equities as fe  # noqa: E402


def test_rrg_por_region_y_cola():
    rng = np.random.default_rng(1)
    idx = pd.bdate_range("2023-01-02", periods=800)
    frames, rows = {}, []
    for i in range(60):
        sym = f"U{i}" if i < 40 else f"E{i}.MC"
        drift = 0.0012 if i % 4 == 0 else 0.0
        c = 100 * np.cumprod(1 + rng.normal(drift, 0.01, len(idx)))
        frames[sym] = pd.DataFrame({"Close": c}, index=idx)
        rows.append({"sym": sym, "sector": ["Tech", "Energy", "Health", "Utilities"][i % 4]})
    out = fe.rrg(frames, rows)
    assert set(out) == {"EE. UU.", "Europa"}
    t = out["EE. UU."]["medio"]["Tech"]
    assert len(t["cola"]) == fe.RRG_COLA and t["cuadrante"] in ("Liderando", "Debilitándose", "Rezagado", "Mejorando")
    xs = [p[1] for r in out["EE. UU."]["medio"].values() for p in r["cola"]]
    assert 90 < min(xs) and max(xs) < 110          # escala tipificada: ningún sector se dispara
    assert t["semanas"] >= 1 and "antes" in t
