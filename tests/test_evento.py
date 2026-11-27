import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import fetch_sec as S  # noqa: E402


def test_sec_tras_resultados_y_a_los_21_dias():
    f = {"ern": [["2026-11-19", 0.8, 0.9, 12.0], ["2027-02-25", 0.9, None, None]]}
    hoy = date(2026, 11, 20)
    assert S.evento_sec(f, "2026-11-10", hoy)             # pedida antes de publicar: toca
    assert not S.evento_sec(f, "2026-11-20", hoy)         # ya pedida después
    assert S.evento_sec(f, "2026-11-20", date(2026, 12, 10))   # segunda pasada a los 21 días
    assert not S.evento_sec(f, "2026-12-10", date(2026, 12, 12))
    assert not S.evento_sec(f, "2026-09-01", date(2027, 1, 20))  # más de 45 días: ya no
    assert not S.evento_sec({}, "2026-11-10", hoy)


def test_yahoo_al_dia_siguiente_y_a_los_4_dias():
    try:
        import fetch_equities as F
    except ModuleNotFoundError:
        return
    f = {"fecha_fund": "2026-11-15", "ern": [["2026-11-19", 0.8, 0.9, 12.0]], "resultados": "2027-02-25"}
    assert F.resultados_pendientes(f, date(2026, 11, 20))
    f["fecha_fund"] = "2026-11-20"
    assert not F.resultados_pendientes(f, date(2026, 11, 21))
    assert F.resultados_pendientes(f, date(2026, 11, 23))
    f["fecha_fund"] = "2026-11-23"
    assert not F.resultados_pendientes(f, date(2026, 11, 24))
    assert not F.resultados_pendientes({"fecha_fund": "2026-10-01", "ern": [["2026-10-05", 1, 1, 0]]}, date(2026, 11, 24))
