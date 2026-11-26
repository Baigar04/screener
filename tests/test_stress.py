import math
import os
import sys
from datetime import date, timedelta

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import fetch_stress as S  # noqa: E402


def _weekly(start, vals):
    d = date.fromisoformat(start)
    d -= timedelta(days=d.weekday())
    return [(d + timedelta(weeks=i), v) for i, v in enumerate(vals)]


def test_mercado_de():
    assert S.mercado_de({"indices": ["Mercado Continuo"], "pais": "Spain"}) == "ibex"
    assert S.mercado_de({"indices": ["FTSE 250"], "pais": "United Kingdom"}) == "ftse"
    assert S.mercado_de({"indices": ["Nasdaq 100"], "pais": "United States", "region": "EE. UU."}) == "ndx"
    assert S.mercado_de({"indices": ["Nasdaq 100", "S&P 500"], "pais": "United States", "region": "EE. UU."}) == "sp500"
    assert S.mercado_de({"indices": [], "pais": "Netherlands", "region": "Europa"}) == "sx5e"
    assert S.mercado_de({"indices": [], "pais": "Brazil", "region": "Latinoamérica"}) == "eem"


def test_crisis_return_usa_barra_mas_cercana_y_descarta_saltos():
    w = _weekly("2007-09-03", [100 + i for i in range(100)])
    r = S.crisis_return(w, date(2007, 10, 9), date(2008, 3, 12))
    a, b = S.at_date(w, date(2007, 10, 9)), S.at_date(w, date(2008, 3, 12))
    assert r == round((b / a - 1) * 100, 1) and r > 0
    assert S.crisis_return(w, date(2001, 1, 1), date(2008, 3, 12)) is None      # no cotizaba
    w2 = [(d, v if i < 10 else v * 100) for i, (d, v) in enumerate(w)]
    assert S.crisis_return(w2, date(2007, 9, 10), date(2008, 3, 12)) is None    # salto de datos imposible


def test_mlogret_solo_meses_consecutivos():
    r = S.mlogret({"2020-01": 100, "2020-02": 110, "2020-04": 121, "2020-05": 121}, "2020-05")
    assert set(r) == {"2020-02", "2020-05"} and abs(r["2020-02"] - math.log(1.1) * 100) < 1e-9


def test_effect_recupera_la_pendiente():
    rng = np.random.default_rng(1)
    ms = [f"{2007 + i // 12}-{i % 12 + 1:02d}" for i in range(120)]
    x = rng.normal(0, 1, 120)
    y = 2.0 * x + rng.normal(0, 0.5, 120)
    e, r2, n = S.effect(dict(zip(ms, y)), dict(zip(ms, x)), 2.0)
    assert n == 120 and r2 > 0.8 and abs(e - S.simple(4.0)) < 0.6
    assert S.effect(dict(zip(ms[:20], y)), dict(zip(ms, x)), 2.0) is None    # menos de 36 meses


def test_effect_asym_distingue_escalada_y_distension():
    rng = np.random.default_rng(2)
    ms = [f"{2007 + i // 12}-{i % 12 + 1:02d}" for i in range(200)]
    z = rng.normal(0, 1, 200)
    y = -3 * np.maximum(z, 0) + 0.5 * np.minimum(z, 0) + rng.normal(0, 0.3, 200)
    esc, paz = S.effect_asym(dict(zip(ms, y)), dict(zip(ms, z)))
    assert esc[0] < -4 and abs(paz[0] - S.simple(-1.0)) < 0.5   # distensión: −2σ × 0,5 = −1 %


def test_veredicto_reglas_fijas():
    assert S.veredicto(-40, -45, "crisis") == "Aguanta"          # cae, pero menos que su bolsa
    assert S.veredicto(-62, -65, "crisis") == "Rompe"            # caída catastrófica
    assert S.veredicto(-30, -10, "crisis") == "Rompe"            # 20 pp peor que su bolsa
    assert S.veredicto(-26, -20, "crisis") == "Tensión"
    assert S.veredicto(-5, -10, "crisis") == "Aguanta"
    assert S.veredicto(-4, -1, "choque") == "Tensión"
    assert S.veredicto(-21, -25, "choque") == "Rompe"
    assert S.veredicto(2, -3, "choque") == "Aguanta"
    assert S.veredicto(None, -3, "choque") is None


def test_scenario_values_estima_crisis_sin_cotizacion_con_beta():
    rng = np.random.default_rng(3)
    n = 1000
    idx = np.exp(np.cumsum(rng.normal(0.001, 0.02, n))) * 100
    w_idx = _weekly("2006-12-04", list(idx))
    # valor que empieza a cotizar en 2013 con beta ≈ 1,5
    st = 520
    sv = [(d, v) for d, v in _weekly("2006-12-04", list(np.exp(np.cumsum(rng.normal(0, 0.01, n) + 1.5 * np.diff(np.log(np.r_[100, idx])))) * 50))][st:]
    lc = S.last_complete_month(date(2026, 11, 26))
    iret = S.mlogret(S.monthly_from_weekly(w_idx), lc)
    icri = [S.crisis_return(w_idx, date.fromisoformat(a), date.fromisoformat(b)) for _, _, a, b, _ in S.CRISIS]
    v, q, _, b = S.scenario_values(sv, {}, {}, iret, icri, "sp500")
    assert q[0] == 0.5 and q[1] == 0.5 and q[2] == 1 and q[3] == 1
    assert 1.2 < b < 1.8
    assert (v[0] < 0) == (icri[0] < 0)
