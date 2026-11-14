"""Fase 9: deuda sin doble cómputo, caja, vencimientos, acciones diluidas y BPA ajustado por splits."""
import sys
import types

try:
    import yfinance  # noqa: F401
except ImportError:
    sys.modules["yfinance"] = types.ModuleType("yfinance")
import fetch_sec as fs  # noqa: E402
import fetch_equities as fe  # noqa: E402


def inst(end, val, filed, form="10-K"):
    return {"end": end, "val": val, "filed": filed, "form": form}


def test_deuda_sin_doble_computo():
    g = {"LongTermDebt": {"units": {"USD": [inst("2025-12-31", 100, "2026-02-10")]}},
         "LongTermDebtCurrent": {"units": {"USD": [inst("2025-12-31", 20, "2026-02-10")]}},
         "ShortTermBorrowings": {"units": {"USD": [inst("2025-12-31", 5, "2026-02-10")]}},
         "LongTermDebtNoncurrent": {"units": {"USD": [inst("2024-12-31", 70, "2025-02-10")]}},
         "DebtCurrent": {"units": {"USD": [inst("2024-12-31", 15, "2025-02-10")]}}}
    d = fs.debt({"facts": {"us-gaap": g}})
    assert d["2025-12-31"][0] == 105          # LongTermDebt ya incluye la parte corriente (20): solo se suma el corto
    assert d["2024-12-31"][0] == 85           # no corriente + deuda corriente


def test_ajuste_por_split():
    q = [["2024-03-31", "2024-05-01", 0, 0, 0, 0, 0, 0, 2.0, "", "10-Q", None, None, None, 100],
         ["2024-06-30", "2024-08-01", 0, 0, 0, 0, 0, 0, 2.2, "", "10-Q", None, None, None, 101],
         ["2024-09-30", "2024-11-01", 0, 0, 0, 0, 0, 0, 0.24, "", "10-Q", None, None, None, 1010]]
    out = fe.split_adjust(q, [("2024-06-10", 10.0)])
    assert out[0][8] == 0.2 and out[0][14] == 1000      # presentado antes del split: se divide el BPA y se multiplican las acciones
    assert out[1][8] == 2.2                              # presentado después (ya reexpresado por la empresa): no se toca
    assert out[2][8] == 0.24
    assert out[0][15] == 10.0 and out[1][15] is None


def test_nsi_sin_splits():
    import academic
    assert abs(academic.unsplit(4.08) - 1.02) < 1e-9     # split 4:1 con un 2 % de emisión real
    assert academic.unsplit(1.3) == 1.3                  # ampliación real
    assert abs(academic.unsplit(0.1) - 1.0) < 1e-9       # contrasplit 1:10
