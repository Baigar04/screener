"""Percentiles, empates y grupos pequeños de la puntuación (score.py)."""
import score


def test_percentiles_extremos_y_orden():
    p = score.pct_ranks([("a", 1), ("b", 5), ("c", 3)])
    assert p == {"a": 0.0, "c": 50.0, "b": 100.0}


def test_empates_rango_medio():
    p = score.pct_ranks([("a", 1), ("b", 2), ("c", 2), ("d", 3)])
    assert p["b"] == p["c"] == 50.0
    assert p["a"] == 0.0 and p["d"] == 100.0


def test_todos_empatados_y_nulos():
    p = score.pct_ranks([("a", 7), ("b", 7), ("c", None)])
    assert p == {"a": 50.0, "b": 50.0}          # sin dato no se puntúa (no es 0)
    assert score.pct_ranks([("a", 4)]) == {"a": 100.0}
    assert score.pct_ranks([]) == {}


def test_grupo_pequeno_usa_universo():
    # sector A con 8 valores (percentil dentro del sector); sector B con 2 (percentil en todo el universo)
    rows = [{"sym": f"A{i}", "sector": "A", "x": i} for i in range(8)] + \
           [{"sym": "B0", "sector": "B", "x": -100}, {"sym": "B1", "sector": "B", "x": 100}]
    p = score.by_group(rows, "sector", lambda r: r["x"])
    assert p["A0"] == 0.0 and p["A7"] == 100.0          # dentro de su sector
    assert p["B0"] == 0.0 and p["B1"] == 100.0          # extremos del universo
    rows[-1]["x"] = 3.5                                  # B1 en medio del universo de 10
    p = score.by_group(rows, "sector", lambda r: r["x"])
    assert 0 < p["B1"] < 100


def test_grupo_pequeno_por_valores_con_dato():
    # 9 valores en el sector, pero solo 7 con dato: no llega a 8 → universo
    rows = [{"sym": f"A{i}", "sector": "A", "x": (i if i < 7 else None)} for i in range(9)] + \
           [{"sym": "Z", "sector": "Z", "x": 100}]
    p = score.by_group(rows, "sector", lambda r: r["x"])
    assert p["A6"] < 100 and p["Z"] == 100.0
    assert "A7" not in p
