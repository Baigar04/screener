"""Fase 2 · tanda 2: SEC trimestral y factores académicos."""
from datetime import date

import pytest

import academic
import fetch_sec


def fy_row(e, filed, ve, bn, eq, de, cfo, sh, assets, gross, ac, pc):
    return [e, filed, ve, bn, None, eq, de, cfo, 0, sh, assets, gross, ac, pc]


PREV = fy_row("2024-12-31", "2025-02-20", 100, 5, 50, 30, 6, 1000, 200, 40, 60, 50)
CUR = fy_row("2025-12-31", "2026-02-20", 120, 9, 55, 25, 14, 980, 210, 54, 70, 50)


def test_factores_anuales():
    f = academic.annual_factors(CUR, PREV)
    assert f["gp"] == pytest.approx(54 / 210)
    assert f["ag"] == pytest.approx(210 / 200 - 1)
    assert f["acr"] == pytest.approx((9 - 14) / 205)
    assert f["nsi"] == pytest.approx(980 / 1000 - 1)
    assert f["fs"] == 9.0                                     # las 9 señales positivas


def test_fscore_con_senales_negativas_y_faltantes():
    bad = fy_row("2025-12-31", "2026-02-20", 90, -3, 40, 60, -5, 1100, 210, 20, 50, 60)
    assert academic.fscore(bad, PREV) == 0.0
    sparse = [*CUR[:12], None, None]                          # sin activo/pasivo corriente: 8 señales, reescalado
    assert academic.fscore(sparse, PREV) == 9.0
    assert academic.fscore(CUR, None) is None


def q(e, filed, bn):
    return [e, filed, 100, bn, None, 40, 1000, 500]


def test_sue_y_conocido_a_fecha():
    ends = ["2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31", "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31",
            "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"]
    bns = [10, 11, 12, 13, 11, 12.5, 12.6, 14.2, 12.1, 13.3, 13.8, 25]   # diferencias de ~1 y salto final
    rows = [q(e, e[:8] + "28", b) for e, b in zip(ends, bns)]
    known = academic.q_known(rows, "2025-11-30")
    assert known[-1][0] == "2025-09-30"                           # el último aún no estaba presentado
    s_all = academic.sue(academic.q_known(rows, "2026-12-31"))
    assert s_all is not None and s_all > 5                        # sorpresa grande y positiva
    assert academic.sue(rows[:5]) is None                         # pocos trimestres


def test_current_usa_trimestres_si_hay():
    e = {"fy": [PREV, CUR], "q": [q(f"2025-{m}", "2025-12-01", 3) for m in ("03-31", "06-30", "09-30", "12-31")]}
    c = academic.current(e)
    assert c["gp"] == pytest.approx(160 / 1000)                  # 4 trimestres de bruto (40) / activos del último
    assert c["fs"] == 9.0 and c["fecha"] == "2025-12-31"


def fact(val, end, filed, form, start=None):
    d = {"val": val, "end": end, "filed": filed, "form": form}
    if start:
        d["start"] = start
    return d


def test_trimestres_desde_xbrl_y_cuarto_deducido():
    rev = [fact(100, "2025-03-31", "2025-05-01", "10-Q", "2025-01-01"), fact(110, "2025-06-30", "2025-08-01", "10-Q", "2025-04-01"),
           fact(120, "2025-09-30", "2025-11-01", "10-Q", "2025-07-01"), fact(480, "2025-12-31", "2026-02-15", "10-K", "2025-01-01"),
           fact(210, "2025-06-30", "2025-08-01", "10-Q", "2025-01-01"),                     # semestral acumulado: se ignora
           fact(999, "2025-03-31", "2026-05-01", "10-Q", "2025-01-01")]                     # reexpresión posterior: se ignora
    facts = {"facts": {"us-gaap": {"Revenues": {"units": {"USD": rev}}, "NetIncomeLoss": {"units": {"USD": rev}},
                                    "Assets": {"units": {"USD": [fact(1000, "2025-12-31", "2026-02-15", "10-K")]}}}}}
    q4 = fetch_sec.quarterly(facts, "ventas")
    assert q4["2025-03-31"] == (100, "2025-05-01") and q4["2025-12-31"] == (150, "2026-02-15")
    rows = fetch_sec.parse_q(facts)
    assert [r[0] for r in rows] == ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"] and rows[-1][6] == 1000


def test_caducidad_sin_error_de_zona_horaria(monkeypatch):
    # antes: restar una fecha sin zona a una con zona lanzaba TypeError y no se actualizaba nada
    act = date.today().isoformat()
    x = {"act": act, "v": fetch_sec.VERSION}
    assert (fetch_sec.NOW.date() - date.fromisoformat(x["act"][:10])).days < fetch_sec.REFRESH_DAYS
