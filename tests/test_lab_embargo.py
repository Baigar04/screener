"""Fase 1.3: embargo sin solapes y veredicto «ordenación» con datos aleatorios."""
import numpy as np
import pandas as pd
import pytest

import lab
import os
SEED = int(os.environ.get("LAB_SEED", "42"))


def test_entrenamiento_sin_solapes_con_la_prueba():
    idx = pd.bdate_range("2015-01-01", periods=2600)
    me = list(pd.Series(range(len(idx)), index=idx).groupby([idx.year, idx.month]).max().values)
    me = [i for i in me if i >= 252 and i + 63 < len(idx)]
    D = idx[me]
    for h in (21, 63, 126, 252):
        for test_k in (len(D) // 2, 30, len(D) - 1):
            tr = lab.train_dates(D, me, test_k, h)
            assert len(tr)
            for d in tr:   # la rentabilidad futura de cada fecha de entrenamiento termina antes de empezar la prueba
                k = D.get_loc(d)
                assert me[k] + h <= me[test_k]
            # y el embargo no es excesivo: la última fecha excluida sí se solapaba
            excl = [k for k in range(test_k) if D[k] not in tr]
            assert all(me[k] + h > me[test_k] for k in excl)


@pytest.fixture
def random_market(tmp_path, monkeypatch):
    rng = np.random.default_rng(SEED)
    n, days = 120, 2600
    idx = pd.bdate_range(end="2026-10-30", periods=days)
    syms = [f"S{i:03d}" for i in range(n)]
    P = pd.DataFrame(100 * np.exp(np.cumsum(rng.normal(0.0003, 0.02, size=(days, n)), axis=0)), index=idx, columns=syms)
    sectors = ["Tech", "Energy", "Healthcare", "Industrials"]
    # capitalización actual = acciones (aleatorias, constantes) × último precio, como en Yahoo
    rows = [{"sym": s, "sector": sectors[i % 4], "mcap": float(rng.uniform(1e7, 1e9) * P[s].iloc[-1])} for i, s in enumerate(syms)]
    cache = {s: {"anual": {str(y): {"beneficio_neto": float(rng.normal(1, 1)), "patrimonio": float(rng.uniform(5, 15)),
                                    "ventas": float(rng.uniform(10, 30)), "ebitda": float(rng.uniform(1, 5)),
                                    "deuda_total": float(rng.uniform(0, 10)), "fcf": float(rng.normal(1, 1))} for y in range(2014, 2026)}}
             for s in syms}
    monkeypatch.setattr(lab, "DATA", str(tmp_path))
    monkeypatch.setattr(lab, "sp_removed", lambda: {})
    monkeypatch.setattr(lab, "prices_10y", lambda syms: (P[[s for s in syms if s in P]], P[[s for s in syms if s in P]]))
    return rows, cache


def test_datos_aleatorios_veredicto_ordenacion(random_market):
    rows, cache = random_market
    res = lab.run({}, rows, cache, {"calidad": 20, "valor": 20, "crecimiento": 15, "momentum": 20, "smart": 15, "macro": 10})
    assert res["veredicto"]["etiqueta"] == "ordenación"
    assert res["embargo_sesiones"] == lab.H
    wf = res["walk_forward"]
    assert wf and wf["anios"]
    for a in wf["anios"]:   # el entrenamiento de cada año termina antes de que empiece el año de prueba
        assert pd.Timestamp(a["fin_entrenamiento"]) < pd.Timestamp(a["anio"], 1, 1)
    oos = res["fuera_muestra"]   # y en la prueba de mitades, el último mes de entrenamiento queda al menos un mes antes del corte
    assert oos and pd.Timestamp(oos["fin_entrenamiento"]) <= pd.Timestamp(oos["corte"]) - pd.Timedelta(days=28)
