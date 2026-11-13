"""Fase 7: registro inmutable encadenado (una foto por sesión, huellas SHA-256)."""
import json

import registro as rg


def score(f, nota):
    return {"fecha_precio": f, "total_defecto": nota, "veredictos": {"AAPL": "Alcista"}, "pesos_defecto": {"calidad": 20}, "veredicto_lab": {"etiqueta": "ordenación"}}


def run(tmp_path, f, nota):
    p = tmp_path / "score.json"
    p.write_text(json.dumps(score(f, nota)))
    code = rg.main(str(p), str(tmp_path / "registro"), str(tmp_path / "pub.json"))
    return code, json.loads((tmp_path / "pub.json").read_text())


def test_cadena_crece_una_vez_por_sesion(tmp_path):
    assert run(tmp_path, "2026-11-12", {"AAPL": 60, "MSFT": None})[1]["dias"] == 1
    code, pub = run(tmp_path, "2026-11-12", {"AAPL": 99})          # misma sesión: no se reescribe
    assert code == 0 and pub["dias"] == 1 and not pub["nueva"]
    foto = json.loads((tmp_path / "registro" / "2026-11-12.json").read_text())
    assert foto["nota"] == {"AAPL": 60}                              # la primera foto es la que vale
    code, pub = run(tmp_path, "2026-11-13", {"AAPL": 61})
    assert code == 0 and pub["integra"] and pub["dias"] == 2 and pub["fotos_comprobadas"] == 2


def test_detecta_foto_alterada(tmp_path):
    run(tmp_path, "2026-11-12", {"AAPL": 60})
    run(tmp_path, "2026-11-13", {"AAPL": 61})
    f = tmp_path / "registro" / "2026-11-12.json"
    d = json.loads(f.read_text()); d["nota"]["AAPL"] = 90; f.write_text(json.dumps(d))
    code, pub = run(tmp_path, "2026-11-14", {"AAPL": 62})
    assert code == 1 and not pub["integra"] and "2026-11-12" in pub["motivo"] and pub["dias"] == 2   # no añade sobre una cadena rota


def test_detecta_eslabon_alterado():
    c, _ = rg.append([], rg.snapshot(score("2026-11-12", {"A": 1})))
    c, _ = rg.append(c, rg.snapshot(score("2026-11-13", {"A": 2})))
    assert rg.verify(c)[0]
    c[0]["n"] = 5
    assert not rg.verify(c)[0]


def test_no_registra_hacia_atras():
    c, _ = rg.append([], rg.snapshot(score("2026-11-13", {"A": 1})))
    c2, e = rg.append(c, rg.snapshot(score("2026-11-10", {"A": 1})))
    assert e is None and len(c2) == 1
