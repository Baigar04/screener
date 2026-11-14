"""Fase 6: trimestres SEC con BPA diluido, etiqueta del trimestre fiscal, formulario y flujo de caja acumulado."""
import fetch_sec as fs


def fact(start, end, val, filed, form, fy, fp):
    return {"start": start, "end": end, "val": val, "filed": filed, "form": form, "fy": fy, "fp": fp}


def facts():
    # ejercicio fiscal julio-junio (como Fabrinet): FY2026 = jul-2025 a jun-2026
    q = [("2025-06-28", "2025-09-26", "2025-11-03", "Q1"), ("2025-09-27", "2025-12-26", "2026-02-02", "Q2"),
         ("2025-12-27", "2026-03-27", "2026-05-04", "Q3")]
    ventas = [fact(s, e, 100 + 10 * i, fl, "10-Q", 2026, fp) for i, (s, e, fl, fp) in enumerate(q)]
    ventas.append(fact("2025-06-28", "2026-06-26", 480, "2026-08-19", "10-K", 2026, "FY"))
    ventas.append(fact("2026-06-27", "2026-09-25", 150, "2026-11-04", "10-Q", 2027, "Q1"))
    bn = [fact(s, e, 10, fl, "10-Q", 2026, fp) for (s, e, fl, fp) in q]
    bn.append(fact("2025-06-28", "2026-06-26", 48, "2026-08-19", "10-K", 2026, "FY"))
    bn.append(fact("2026-06-27", "2026-09-25", 12, "2026-11-04", "10-Q", 2027, "Q1"))
    eps = [fact(s, e, 0.5, fl, "10-Q", 2026, fp) for (s, e, fl, fp) in q]
    eps.append(fact("2025-06-28", "2026-06-26", 2.4, "2026-08-19", "10-K", 2026, "FY"))
    eps.append(fact("2026-06-27", "2026-09-25", 0.6, "2026-11-04", "10-Q", 2027, "Q1"))
    cfo = [fact("2025-06-28", "2025-09-26", 5, "2025-11-03", "10-Q", 2026, "Q1"),
           fact("2025-06-28", "2025-12-26", 12, "2026-02-02", "10-Q", 2026, "Q2"),
           fact("2025-09-27", "2025-12-26", 7, "2026-02-02", "10-Q", 2026, "Q2")]
    return {"facts": {"us-gaap": {
        "Revenues": {"units": {"USD": ventas}}, "NetIncomeLoss": {"units": {"USD": bn}},
        "EarningsPerShareDiluted": {"units": {"USD/shares": eps}},
        "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": cfo}}}}}


def test_trimestres_con_bpa_y_etiqueta():
    rows = fs.parse_q(facts())
    by = {r[0]: r for r in rows}
    assert [r[9] for r in rows] == ["FY2026Q1", "FY2026Q2", "FY2026Q3", "FY2026Q4", "FY2027Q1"]
    q4 = by["2026-06-26"]
    assert q4[2] == 480 - (100 + 110 + 120)          # ventas del 4.º trimestre deducidas del 10-K
    assert q4[8] == round(2.4 - 1.5, 4)              # BPA del 4.º trimestre (aproximado)
    assert q4[10] == "10-K" and by["2026-09-25"][10] == "10-Q"
    assert by["2026-09-25"][8] == 0.6
    # flujo de caja acumulado: en el 2.º trimestre, el de 6 meses (no el de 3)
    assert by["2025-12-26"][11] == 12 and by["2025-09-26"][11] == 5


def test_etiqueta_sin_ejercicio_fiscal():
    assert fs.label(None, None, "2026-09-30") == "CY2026Q3"
    assert fs.label(2027, "Q1", "2026-09-25") == "FY2027Q1"


def test_une_etiquetas_y_ventas_mayor():
    """Cambio de etiqueta en 2018: antes se quedaba con la vieja y perdía las ventas recientes (487 empresas)."""
    old = [fact("2016-01-01", "2016-12-31", 100, "2017-02-01", "10-K", 2016, "FY"), fact("2017-01-01", "2017-12-31", 110, "2018-02-01", "10-K", 2017, "FY")]
    new = [fact("2018-01-01", "2018-12-31", 120, "2019-02-01", "10-K", 2018, "FY"), fact("2019-01-01", "2019-12-31", 130, "2020-02-01", "10-K", 2019, "FY"),
           fact("2017-01-01", "2017-12-31", 112, "2018-02-01", "10-K", 2017, "FY")]
    facts = {"facts": {"us-gaap": {"Revenues": {"units": {"USD": old}}, "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": new}}}}}
    a = fs.annual(facts, "ventas")
    assert sorted(a) == ["2016-12-31", "2017-12-31", "2018-12-31", "2019-12-31"]
    assert a["2017-12-31"][0] == 112        # ventas: el mayor importe entre etiquetas
    bn = {"facts": {"us-gaap": {"NetIncomeLoss": {"units": {"USD": old}}, "ProfitLoss": {"units": {"USD": new}}}}}
    assert fs.annual(bn, "bn")["2017-12-31"][0] == 110   # resto: prioridad de la lista


def test_descarta_t4_incoherente():
    rows = [["2024-03-31", "", 300, 10, 1, 1, 1, 1, 0.1, "FY2024Q1", "10-Q", None], ["2024-06-30", "", 300, 10, 1, 1, 1, 1, 0.1, "FY2024Q2", "10-Q", None],
            ["2024-09-30", "", 300, 10, 1, 1, 1, 1, 0.1, "FY2024Q3", "10-Q", None], ["2024-12-31", "", 40, -5, 1, 1, 1, 1, -0.1, "FY2024Q4", "10-K", None]]
    assert not fs.q4_ok(rows, 3) and fs.q4_ok(rows, 2)
