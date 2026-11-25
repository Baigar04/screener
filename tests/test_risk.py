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
    out = R.thermometer(raw, daily, "Índice de prueba")
    a = out["actual"]
    assert 0 <= a["p"] <= 100 and a["regimen"] in ("Normal", "Tensión", "Alerta")
    assert out["precision"]["caidas_total"] >= 3
    w = {s["k"]: s["peso"] for s in out["senales"]}
    assert w["s0"] == max(w.values())     # la señal informativa es la que más pesa
    assert abs(sum(w.values()) - 100) < 1
    assert months[-1] == a["mes"]


def test_ambito_de_las_senales():
    assert R.usa_senal("vix", "asia") and R.usa_senal("ebp", "us")
    assert R.usa_senal("ciss", "es") and R.usa_senal("ciss", "europa") and not R.usa_senal("ciss", "us")
    assert R.usa_senal("prima_es", "es") and not R.usa_senal("prima_es", "it")
    assert R.usa_senal("prima_it", "it") and not R.usa_senal("prima_it", "europa")
    assert len({m[0] for m in R.MERCADOS}) == 11


def _T(p, base, validado=True, pct_cred=20, tend=5.0):
    sen = [{"k": "ebp", "nombre": "Prima de exceso de bonos (EBP)", "modelo": True, "pct": pct_cred, "peso": 30, "aporta": -0.3, "ultimo": {"valor": -0.2}},
           {"k": "baa", "nombre": "Diferencial Baa", "modelo": True, "pct": pct_cred, "peso": 20, "aporta": -0.1, "ultimo": {"valor": 1.5}},
           {"k": "vix", "nombre": "VIX", "modelo": True, "pct": 88, "peso": 10, "aporta": 0.2, "ultimo": {"valor": 26}},
           {"k": "cap_pib", "nombre": "Capitalización / PIB", "modelo": True, "pct": 99, "peso": 1, "aporta": 0.0, "ultimo": {"valor": 250}},
           {"k": "tendencia", "nombre": "Índice frente a su media", "modelo": True, "pct": 40, "peso": 8, "aporta": 0.0, "ultimo": {"valor": tend}},
           {"k": "ebp_6m", "nombre": "Cambio del EBP", "modelo": True, "pct": 50, "peso": 5, "aporta": 0.0, "ultimo": {"valor": 0.0}}]
    return {"actual": {"mes": "2026-11", "p": p, "lo": p - 8, "hi": p + 8, "base": base, "validado": validado, "motivo": "No mejora a la tasa base fuera de muestra"},
            "umbrales": {"alerta": base + 12}, "senales": sen,
            "precision": {"brier": 0.23, "brier_base": 0.25, "avisadas": 5, "caidas": 11, "desde": "2001-01", "falsas": ["2002", "2011"],
                          "examen_desde": "2016-01", "examen": {"skill": 6.2, "ece": 4.0, "meses": 119}}}


def test_lectura_del_termometro_y_conjunta():
    ia = {"fase": "Digestión", "g_capex": 87.0, "g_fcf": -70.0}
    L = R.interpret(_T(25, 36), ia, "S&P 500", "sp500")
    t = L["termometro"]
    assert len(t) == 3 and "menor de lo habitual" in t[0] and "validado" in t[1]
    assert "VIX" in t[2] and "EBP" in t[2]                     # empuja: VIX; contiene: EBP
    c = L["conjunta"]
    assert "por debajo de lo habitual" in c["conclusion"] and "crédito tranquilo" in c["conclusion"]
    assert any("Digestión" in b for b in c["bloques"]) and "Pesa mucho" in " ".join(c["bloques"])
    assert c["vigilar"] and c["cambiaria"]
    # alerta y modelo sin ventaja
    L2 = R.interpret(_T(60, 36, validado=False, pct_cred=80, tend=-6), ia, "IBEX 35", "ibex")
    assert "zona de alerta" in L2["termometro"][0] and "no demuestra ventaja" in L2["termometro"][1]
    assert "crédito tenso" in L2["conjunta"]["conclusion"] and "media histórica" in L2["conjunta"]["conclusion"]
    assert "indirecta" in " ".join(L2["conjunta"]["bloques"])


def test_plazo_corto_cambia_horizonte_y_caida():
    assert (R.HORIZONTE, R.CAIDA) == (12, 0.15)
    with R.plazo(*R.CORTO):
        assert (R.HORIZONTE, R.CAIDA) == (3, 0.10)
    assert (R.HORIZONTE, R.CAIDA) == (12, 0.15)
    T = _T(12, 10)
    T.update({"horizonte": 3, "caida": 0.10})
    L = R.interpret(T, None, "DAX", "dax")
    assert "más del 10 %" in L["termometro"][0] and "próximos 3 meses" in L["termometro"][0]
    assert L["conjunta"]["conclusion"].startswith("Riesgo a 3 meses")


def test_examen_decide_la_validacion():
    rng = np.random.default_rng(7)
    n = 34 * 260
    ret = rng.normal(0.0003, 0.012, n)
    daily = _daily(list(100 * np.exp(np.cumsum(ret))))
    meta = lambda k: {"k": k, "nombre": k, "vel": "media", "fuente": "x", "url": "", "frec": "diario", "retraso": 0, "sentido": 1,
                      "modelo": True, "desde": "1993-01", "ultimo": {"fecha": "2026-01-01", "valor": 1}}
    raw = {f"s{i}": (meta(f"s{i}"), [(d, float(rng.normal())) for d, _ in daily[::20]]) for i in range(5)}
    T = R.thermometer(raw, daily, "Ruido")
    P = T["precision"]
    assert P["examen_desde"] == R.EXAMEN and "examen" in P and "diseno" in P
    assert T["actual"]["validado"] is False      # señales de puro ruido no pueden aprobar
