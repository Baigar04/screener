"""Fase 2: liquidez neta de la Fed = balance − TGA − repos inversos."""
from datetime import date

import fetch_macro as fm


def test_liquidez_neta(monkeypatch):
    W = [(date(2026, 10, d), 6_600_000.0 + d * 1000) for d in (1, 8, 15, 22, 29)]        # millones
    T = [(date(2026, 10, d), 800_000.0) for d in (1, 8, 15, 22, 29)]                     # millones
    R = [(date(2026, 9, 30), 100.0), (date(2026, 10, 20), 50.0)]                          # miles de millones
    data = {"WALCL": W, "WTREGEN": T, "RRPONTSYD": R}

    def fake(code):
        if code in data:
            return data[code], "https://fred/" + code
        raise RuntimeError("sin red")
    monkeypatch.setattr(fm, "fred", fake)
    monkeypatch.setattr(fm, "ecb", fake)
    monkeypatch.setattr(fm, "CAT", [c for c in fm.CAT if c[0] in ("walcl", "tga", "rrp")])
    S = fm.build_series()
    assert S["walcl"]["valor"] == 6629.0 and S["walcl"]["unidad"] == "bn $"
    L = S["liq_neta"]
    assert L["valor"] == 6629.0 - 800.0 - 50.0                                            # 29-oct: RRP del 20-oct
    assert dict((d.isoformat(), v) for d, v in L["_obs"])["2026-10-08"] == 6608.0 - 800.0 - 100.0
