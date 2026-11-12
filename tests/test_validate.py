"""validate.py: un JSON corrupto o incompleto nunca sustituye al publicado."""
import json
import os
from datetime import datetime, timezone

import pytest

import validate

NOW = datetime.now(timezone.utc)
TODAY = NOW.strftime("%Y-%m-%d")


def universe(n=100, **over):
    rows = [{"sym": f"S{i}", "precio": 10.0 + i, "moneda": "USD", "fecha_precio": TODAY, "mcap": 1e9, "rsi": 50, "vol3m": 25} for i in range(n)]
    for r in rows:
        r.update(over)
    return {"generado": NOW.isoformat(timespec="seconds"), "filas": rows}


def score(n=100):
    return {"generado": NOW.isoformat(timespec="seconds"), "factores": {f"S{i}": {"calidad": 50.0, "macro": None} for i in range(n)},
            "total_defecto": {f"S{i}": 55.0 for i in range(n)}}


def sectors():
    return {"generado": NOW.isoformat(timespec="seconds"), "stats": {"Todos": {"sector": {"Tech": {"n": 5}, "Energy": {"n": 3}}}}}


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    data, prev = tmp_path / "data", tmp_path / "prev"
    data.mkdir()
    prev.mkdir()
    for name, obj in (("universe.json", universe()), ("score.json", score()), ("sectors.json", sectors())):
        (prev / name).write_text(json.dumps(obj))
        (data / name).write_text(json.dumps(obj))
    monkeypatch.setattr(validate, "DATA", str(data))
    monkeypatch.setattr(validate, "PREV_DIR", str(prev))
    return data, prev


def run(data):
    rc = validate.main()
    return rc, json.loads((data / "validacion.json").read_text())


def test_todo_valido(dirs):
    data, _ = dirs
    rc, rep = run(data)
    assert rc == 0 and rep["recuperados"] == []


def test_json_corrupto_no_sustituye_al_publicado(dirs):
    data, prev = dirs
    (data / "universe.json").write_text('{"generado": "2026-11-12", "filas": [{"sym": "S0", ')   # truncado
    rc, rep = run(data)
    assert rc == 0
    assert (data / "universe.json").read_bytes() == (prev / "universe.json").read_bytes()
    assert {"universe.json", "sectors.json", "score.json"} <= set(rep["recuperados"])         # y sus derivados


def test_menos_del_95_por_ciento_de_filas(dirs):
    data, prev = dirs
    (data / "universe.json").write_text(json.dumps(universe(90)))
    rc, rep = run(data)
    assert "universe.json" in rep["recuperados"] and json.loads((data / "universe.json").read_text())["filas"].__len__() == 100


@pytest.mark.parametrize("over", [{"precio": -1}, {"precio": float("nan")}, {"moneda": "dólares"}, {"fecha_precio": "2099-01-01"},
                                  {"fecha_precio": "2020-01-01"}, {"rsi": 140}])
def test_rangos_monedas_y_fechas(dirs, over):
    data, _ = dirs
    (data / "universe.json").write_text(json.dumps(universe(**over)).replace("NaN", "NaN"))
    rc, rep = run(data)
    assert "universe.json" in rep["recuperados"], over


def test_nota_fuera_de_rango(dirs):
    data, _ = dirs
    s = score()
    s["factores"]["S1"]["calidad"] = 130
    (data / "score.json").write_text(json.dumps(s))
    rc, rep = run(data)
    assert rep["recuperados"] == ["score.json"]


def test_generado_antiguo(dirs):
    data, _ = dirs
    u = universe()
    u["generado"] = "2020-01-01T00:00:00+00:00"
    (data / "universe.json").write_text(json.dumps(u))
    _, rep = run(data)
    assert "universe.json" in rep["recuperados"]


def test_sin_version_publicada_no_se_despliega(dirs):
    data, prev = dirs
    (prev / "universe.json").unlink()
    (data / "universe.json").write_text("no es json")
    rc, rep = run(data)
    assert rc == 1 and "universe.json" in rep["sin_recuperar"]


def test_fichero_nuevo_sin_version_previa_es_valido(dirs):
    data, prev = dirs
    (prev / "score.json").unlink()
    rc, rep = run(data)
    assert rc == 0 and rep["ficheros"]["score.json"]["estado"] == "ok"
