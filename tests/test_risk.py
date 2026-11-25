"""Fase 1 · Riesgo de mercado y ciclo IA (scripts/fetch_risk.py)."""
import os
import sys
from datetime import date, timedelta

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import fetch_risk as R  # noqa: E402


def _daily(path):
    d0 = date(1993, 1, 4)
    return [(d0 + timedelta(days=i), float(v)) for i, v in enumerate(path)]


def test_ym_helpers():
    assert R.ym_add("2026-11", 2) == "2027-01"
    assert R.ym_add("2026-01", -1) == "2025-12"
    assert R.months_between("2025-11", "2026-11") == 12


def test_monthly_lag_and_ffill():
    obs = [(date(2020, 1, 15), 1.0), (date(2020, 1, 31), 2.0), (date(2020, 3, 31), 3.0)]
    m = R.monthly(obs, lag=1)
    assert m == {"2020-02": 2.0, "2020-04": 3.0}
    f = R.ffill(m, ["2020-01", "2020-02", "2020-03", "2020-04"])
    assert f == {"2020-01": None, "2020-02": 2.0, "2020-03": 2.0, "2020-04": 3.0}


def test_percentil_a_fecha_sin_mirar_el_futuro():
    months = [R.ym_add("2000-01", i) for i in range(60)]
    ser = {m: float(i) for i, m in enumerate(months)}       # siempre sube: cada mes es el máximo hasta la fecha
    p = R.pct_point_in_time(ser, months, +1)
    assert p[months[10]] is None                              # menos de MIN_HIST meses
    assert p[months[-1]] > 0.98
    q = R.pct_point_in_time(ser, months, -1)                  # sentido inverso (curva): alto = poco riesgo
    assert q[months[-1]] < 0.02


def test_etiqueta_y_episodios():
    path = [100.0] * 400 + list(np.linspace(100, 80, 60)) + list(np.linspace(80, 101, 200)) + [101.0] * 500
    daily = _daily(path)
    months = sorted({R.ym(d) for d, _ in daily})
    y = R.labels(daily, months)
    assert y[months[3]] == 1             # en los 12 meses siguientes cae un 20 %
    assert y[R.ym(daily[700][0])] == 0   # ya recuperado, sin caída después
    assert y[months[-1]] is None         # aún no se conoce el resultado
    eps = R.episodes(daily)
    assert len(eps) == 1 and eps[0][2] <= -0.19


def test_logistica_aprende_y_penaliza():
    rng = np.random.default_rng(1)
    X = rng.normal(size=(400, 2))
    y = (X[:, 0] + 0.3 * rng.normal(size=400) > 0).astype(float)
    w = R.logit_fit(X, y)
    assert w[1] > 1 and abs(w[2]) < 0.5
    p = R.logit_pred(w, np.array([[2.0, 0.0], [-2.0, 0.0]]))
    assert p[0] > 0.9 and p[1] < 0.1


def test_calibracion():
    err, tab = R.calib_error([0.1] * 10 + [0.9] * 10, [0] * 9 + [1] + [1] * 9 + [0])
    assert abs(err) < 1e-9 and len(tab) == 2


def test_flujo_trimestral_desde_acumulados():
    def f(s, e, v, filed="2026-01-01", form="10-Q"):
        return {"start": s, "end": e, "val": v, "form": form, "filed": filed}
    facts = {"us-gaap": {"PaymentsToAcquirePropertyPlantAndEquipment": {"units": {"USD": [
        f("2025-07-01", "2025-09-30", 10), f("2025-07-01", "2025-12-31", 25), f("2025-07-01", "2026-03-31", 45),
        f("2025-07-01", "2026-06-30", 70, form="10-K")]}}}}
    q = R.facts_dur(facts, R.CAPEX_TAGS)
    assert q == {"2025-09-30": 10, "2025-12-31": 15, "2026-03-31": 20, "2026-06-30": 25}


def test_fase_ia():
    assert R.fase_ia(-5, 10) == "Contracción"
    assert R.fase_ia(40, -20) == "Digestión"
    assert R.fase_ia(40, 5) == "Euforia"
    assert R.fase_ia(10, 5) == "Expansión"
    assert R.fase_ia(None, 5) is None


def test_termometro_con_datos_sinteticos():
    rng = np.random.default_rng(7)
    n = 34 * 260
    ret = rng.normal(0.0003, 0.012, n)
    for k in range(5):                    # cinco crisis
        s = 900 + k * 1500
        ret[s:s + 120] -= 0.003
        ret[s + 120:s + 360] += 0.0025
    daily = _daily(list(100 * np.exp(np.cumsum(ret))))
    months = sorted({R.ym(d) for d, _ in daily})
    # señal informativa: sube antes de las crisis
    stress = {}
    for i, (d, _) in enumerate(daily):
        near = any(0 <= (900 + k * 1500) - i <= 200 for k in range(5))
        stress[d] = (2.0 if near else 0.0) + rng.normal(0, 0.5)
    obs_a = sorted(stress.items())
    obs_b = [(d, float(rng.normal())) for d, _ in daily[::20]]
    meta = lambda k, m: {"k": k, "nombre": k, "vel": "media", "fuente": "x", "url": "", "frec": "diario", "retraso": 0, "sentido": 1,
                         "modelo": m, "desde": "1993-01", "ultimo": {"fecha": "2026-01-01", "valor": 1}}
    raw = {f"s{i}": (meta(f"s{i}", True), obs_a if i == 0 else obs_b) for i in range(5)}
    out = R.thermometer(raw, daily)
    a = out["actual"]
    assert 0 <= a["p"] <= 100 and a["regimen"] in ("Normal", "Tensión", "Alerta")
    assert out["precision"]["caidas_total"] >= 3
    w = {s["k"]: s["peso"] for s in out["senales"]}
    assert w["s0"] == max(w.values())     # la señal informativa es la que más pesa
    assert abs(sum(w.values()) - 100) < 1
    assert months[-1] == a["mes"]
