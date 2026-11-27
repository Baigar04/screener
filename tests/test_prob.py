import os
import sys
from datetime import date, timedelta

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import fetch_prob as P  # noqa: E402


def _synthetic(n=120, weeks=1040, seed=0, efecto=0.004):
    """Mercado con momento: la tendencia de cada valor persiste (deriva propia lenta)."""
    rng = np.random.default_rng(seed)
    d0 = date(2006, 12, 4)
    dates = [d0 + timedelta(weeks=i) for i in range(weeks)]
    bench = np.cumsum(rng.normal(0.001, 0.02, weeks))
    W = {"SPY": list(zip(dates, np.exp(bench) * 100))}
    U = []
    for i in range(n):
        drift = np.zeros(weeks)
        a = 0.0
        for t in range(weeks):
            a = 0.995 * a + rng.normal(0, efecto * 0.1)
            drift[t] = a
        lp = bench + np.cumsum(drift + rng.normal(0, 0.03, weeks))
        s = f"S{i:03d}"
        W[s] = list(zip(dates, np.exp(lp) * 50))
        U.append({"sym": s, "pais": "United States", "region": "EE. UU.", "indices": ["S&P 500"]})
    return W, U


def test_rank_within_centrado():
    r = P.rank_within(np.array([1.0, 2.0, 3.0, np.nan, 10.0, 20.0]), np.array(["a", "a", "a", "a", "b", "b"]))
    assert np.isnan(r[3]) and abs(r[:3].mean()) < 1e-9 and r[0] < r[1] < r[2] and r[4] < r[5]


def test_logit_recupera_signo():
    rng = np.random.default_rng(1)
    x = rng.normal(0, 1, (20000, len(P.FACTORES)))
    y = (rng.random(20000) < 1 / (1 + np.exp(-(0.8 * x[:, 0] - 0.5 * x[:, 2])))).astype(float)
    X = np.column_stack([np.ones(20000), x])
    b = P.logit_fit(X, y)
    assert b[1] > 0.6 and b[3] < -0.35


def test_ece_y_auc():
    p = np.linspace(0.05, 0.95, 1000)
    y = (np.random.default_rng(2).random(1000) < p).astype(float)
    assert P.ece(p, y) < 6 and P.auc(p, y) > 0.7


def test_clean_jumps_anula_historia_anterior():
    idx = pd.date_range("2020-01-03", periods=10, freq="W-FRI")
    df = pd.DataFrame({"A": [1, 1, 1, 100, 100, 101, 102, 103, 104, 105.0], "B": np.arange(1, 11, dtype=float)}, index=idx)
    out = P.clean_jumps(df.copy())
    assert out["A"].iloc[:3].isna().all() and out["A"].iloc[3:].notna().all() and out["B"].notna().all()


def test_examen_sin_mirar_el_futuro_y_detecta_momento():
    W, U = _synthetic()
    D, binfo, last = P.build(W, U)
    assert binfo["sp500"]["ticker"] == "SPY" and D["y"].isna().any()
    mks = sorted(D["mk"].unique())
    E = P.examen(D, mks)
    assert not E.empty and E["mes"].min() >= "2016-01"
    # cada año se ajusta solo con muestras cuyo resultado ya se conocía: ninguna previsión usa su propio resultado
    R = P.resumen_mercado(E)
    assert R["meses"] >= 60 and R["auc"] > 0.5 and len(R["deciles"]) == 10


def test_semanas_con_festivo_se_alinean_al_viernes():
    d0 = date(2020, 1, 6)
    W = {"A": [(d0 + timedelta(weeks=i), 1.0 + i) for i in range(10)],
         "B": [(d0 + timedelta(weeks=i, days=1 if i == 3 else 0), 2.0 + i) for i in range(10)]}   # semana 4 empieza en martes
    F = P.weekly_frame(W, ["A", "B"])
    assert len(F) == 10 and F.notna().all().all()
