"""Laboratorio: percentiles por fecha, sec_at, suggest y neutralize."""
import numpy as np
import pandas as pd
import pytest

import lab


def test_pct_rank_sector_y_grupo_pequeno():
    s = pd.Series({f"A{i}": float(i) for i in range(8)} | {"B0": -1.0, "B1": 99.0})
    g = pd.Series({k: k[0] for k in s.index})
    r = lab.pct_rank(s, g)
    assert r["A7"] == 100 and r["A0"] == pytest.approx(12.5)     # dentro del sector (8 valores)
    glob = s.rank(pct=True) * 100
    assert r["B0"] == glob["B0"] and r["B1"] == glob["B1"]      # sector de 2: universo


def test_pct_rank_empates():
    r = lab.pct_rank(pd.Series({"a": 1.0, "b": 1.0, "c": 2.0}))
    assert r["a"] == r["b"] < r["c"]


FY = [  # [fin, presentado, ventas, bn, ebit, patrimonio, deuda, cfo, capex, acciones]
    ["2021-12-31", "2022-02-20", 100, 10, 12, 50, 20, 15, 5, 1e6],
    ["2022-12-31", "2023-02-21", 110, 11, 13, 55, 20, 16, 5, 1e6],
    ["2023-12-31", "2024-02-22", 121, 12, 14, 60, 20, 17, 5, 1e6],
]


def test_sec_at_solo_lo_presentado_antes():
    cur, prev = lab.sec_at(FY, pd.Timestamp("2023-02-21"))   # el mismo día de la presentación aún no se conoce
    assert cur[0] == "2021-12-31" and prev is None
    cur, prev = lab.sec_at(FY, pd.Timestamp("2023-02-22"))
    assert cur[0] == "2022-12-31" and prev[0] == "2021-12-31"
    assert lab.sec_at(FY, pd.Timestamp("2022-01-01")) == (None, None)


def test_sec_at_anterior_debe_ser_un_ano_antes():
    fy = [FY[0], FY[2]]                                       # falta 2022: no hay «anterior» comparable
    cur, prev = lab.sec_at(fy, pd.Timestamp("2025-01-01"))
    assert cur[0] == "2023-12-31" and prev is None


BASE = {"calidad": 20, "valor": 20, "crecimiento": 15, "momentum": 20}


def test_suggest_sin_evidencia_no_cambia():
    w = lab.suggest({k: 0.05 for k in BASE}, BASE, {k: 0.5 for k in BASE})
    assert w == BASE


def test_suggest_conserva_total_y_tope():
    w = lab.suggest({"calidad": 0.2, "valor": 0.0, "crecimiento": 0.0, "momentum": 0.0}, BASE,
                    {"calidad": 5, "valor": 0, "crecimiento": 0, "momentum": 0})
    assert abs(sum(w.values()) - sum(BASE.values())) <= 2
    assert max(w.values()) <= 40 and w["calidad"] > BASE["calidad"]


def test_suggest_penaliza_factor_que_resta():
    w = lab.suggest({"calidad": -0.05, "valor": 0.0, "crecimiento": 0.0, "momentum": 0.0}, BASE,
                    {"calidad": -3, "valor": 0, "crecimiento": 0, "momentum": 0})
    assert w["calidad"] == 10 and abs(sum(w.values()) - 75) <= 1


def test_neutralize_quita_exposiciones():
    rng = np.random.default_rng(0)
    cols = [f"S{i}" for i in range(60)]
    d = pd.Timestamp("2024-01-31")
    X = pd.DataFrame({"sec_a": [1.0] * 30 + [0.0] * 30, "sec_b": [0.0] * 30 + [1.0] * 30,
                      "_size": rng.normal(size=60), "_beta": rng.normal(size=60)}, index=cols)
    y = 3 * X["sec_a"] + 2 * X["_size"] - X["_beta"] + rng.normal(scale=0.01, size=60)
    out = lab.neutralize(pd.DataFrame([y], index=[d]), {d: X})
    res = out.loc[d].astype(float)
    assert res.abs().max() < 0.05                              # todo lo explicable se ha quitado
    for c in X.columns:
        assert abs(np.dot(res, X[c])) < 1e-6                   # residuo ortogonal a cada exposición


def test_neutralize_pocos_datos_no_inventa():
    cols = [f"S{i}" for i in range(10)]
    d = pd.Timestamp("2024-01-31")
    X = pd.DataFrame({"a": 1.0}, index=cols)
    out = lab.neutralize(pd.DataFrame([pd.Series(1.0, index=cols)], index=[d]), {d: X})
    assert out.loc[d].isna().all()                             # menos de MIN_N valores: sin dato
