"""Auditoría de exactitud: detecta las anomalías que debe detectar."""
import auditoria as au


def q(e, v, bn, bpa, per, forma="10-Q", fl=None):
    return [e, fl or e, v, bn, None, None, None, None, bpa, per, forma, None]


def fy(e, v, bn, acc):
    return [e, e, v, bn, None, None, None, None, None, acc, None, None, None, None]


def test_detecta_anomalias():
    sec = {
        "OK": {"fy": [fy("2024-12-31", 100e6, 10e6, 10e6), fy("2025-09-30", 110e6, 11e6, 10e6)],
               "q": [q("2025-03-31", 25e6, 2.5e6, 0.25, "FY2025Q1"), q("2025-06-30", 26e6, 2.6e6, 0.26, "FY2025Q2"),
                     q("2025-09-30", 27e6, 2.7e6, 0.27, "FY2025Q3", fl="2026-10-30")]},
        "TAG": {"fy": [fy("2023-12-31", 50e6, 5e6, 1e6), fy("2024-12-31", None, 6e6, 1e6)], "q": []},
        "SPLIT": {"fy": [fy("2025-01-31", 100e6, 40e6, 10e6)],
                  "q": [q("2025-10-31", 30e6, 12e6, 12.0, "FY2026Q3", fl="2026-11-01")]},   # BPA sin ajustar al split (×10)
        "T4": {"fy": [fy("2025-12-31", 100e6, 10e6, 1e6)],
               "q": [q("2025-03-31", 30e6, 1e6, 1, "FY2025Q1"), q("2025-06-30", 30e6, 1e6, 1, "FY2025Q2"),
                     q("2025-09-30", 30e6, 1e6, 1, "FY2025Q3"), q("2025-12-31", 2e6, 1e6, 1, "FY2025Q4", "10-K", "2026-10-30")]},
    }
    fund = {"OK": {"anual": {"2025": {"ventas": 110.2e6, "beneficio_neto": 11e6}}},
            "TAG": {"anual": {"2024": {"ventas": 60e6, "beneficio_neto": 6e6}}},
            "SPLIT": {"anual": {"2025": {"ventas": 130e6, "beneficio_neto": 40e6}}}}
    res, L = au.audit(sec, fund, ["OK", "TAG", "SPLIT", "T4", "NADA"], "2026-11-14")
    assert L["sin_sec"] == ["NADA"]
    assert [x[0] for x in L["etiqueta"]] == ["TAG"]
    assert [x[0] for x in L["yahoo_ventas"]] == ["SPLIT"] and res["dif_mediana_ventas_pct"] is not None
    assert [x[0] for x in L["bpa_acciones"]] == ["SPLIT"]
    assert [x[0] for x in L["t4_raro"]] == ["T4"]
    assert "OK" not in {x[0] for k in L if k != "pocos_datos" for x in L[k] if isinstance(x, list)}
