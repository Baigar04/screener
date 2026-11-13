"""Fase 2: amplitud del mercado (fetch_equities.breadth)."""
import sys
import types

import numpy as np
import pandas as pd
import pytest

try:
    import yfinance  # noqa: F401
except ImportError:
    sys.modules["yfinance"] = types.ModuleType("yfinance")
import fetch_equities as fe  # noqa: E402


def frames_up_down(n_up=30, n_down=10, days=600):
    idx = pd.bdate_range(end="2026-11-12", periods=days)
    fr, rows = {}, []
    for i in range(n_up + n_down):
        up = i < n_up
        c = np.linspace(50, 100, days) if up else np.linspace(100, 50, days)
        fr[f"S{i}"] = pd.DataFrame({"Close": c}, index=idx)
        rows.append({"sym": f"S{i}", "region": "EE. UU."})
    return fr, rows


def test_amplitud_tendencias_puras():
    fr, rows = frames_up_down()
    a = fe.breadth(fr, rows)["EE. UU."]
    assert a["n"] == 40
    assert a["sobre_sma50"] == pytest.approx(75.0) and a["sobre_sma200"] == pytest.approx(75.0)   # 30 de 40 suben
    assert a["avances"] == 30 and a["descensos"] == 10
    assert a["max52"] == 30 and a["min52"] == 10
    assert len(a["hist"]) == 260 and a["hist"][-1][3] == 20                 # máximos − mínimos
    assert a["hist"][-1][4] - a["hist"][-2][4] == 20                       # línea A/D: +30 −10 cada día


def test_region_pequena_se_omite():
    fr, rows = frames_up_down(10, 5)
    assert fe.breadth(fr, rows) == {}
