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


def test_nota_ausencia_neutral_y_cobertura():
    """Método v2 (14-nov-2026): sin dato = neutral (50) con su peso; no se reparte entre los demás."""
    import score as sc
    w = {"calidad": 20, "valor": 20, "crecimiento": 15, "momentum": 20, "smart": 15, "macro": 10}
    f = {"calidad": 90, "valor": 90, "crecimiento": 90, "momentum": 90, "smart": None, "macro": None}
    assert round(sc.nota(f, w), 1) == round((75 * 90 + 25 * 50) / 100, 1)   # antes: 90 (se repartía el peso)
    assert sc.cobertura(f, w) == 75
    assert sc.nota({**f, "valor": None, "momentum": None}, w) is None        # 2 de 4 básicos: no concluyente
    full = {k: 60 for k in w}
    assert sc.nota(full, w) == 60 and sc.cobertura(full, w) == 100
