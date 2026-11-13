"""Fase 1.4: marco de evidencia. Ninguna cifra sin calibrar se presenta como «probabilidad» y cada lectura lleva su etiqueta."""
import glob
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def src(path):
    return open(os.path.join(ROOT, path), encoding="utf-8").read()


def visible_strings(code):
    """Texto que puede verse en pantalla: plantillas y cadenas, sin accesos a claves como R.probabilidades."""
    code = re.sub(r"\.\s*probabilidades\b", ".__clave__", code)
    return code


def test_ninguna_cifra_se_llama_probabilidad():
    bad = re.compile(r"(%\s*(de\s+)?probabilidad|probabilidad(es)?\s*(\$\{|\(|:\s*\$|\d|del\s+modelo|por\s+fase))", re.I)
    for f in glob.glob(os.path.join(ROOT, "assets", "*.js")) + [os.path.join(ROOT, "scripts", "fetch_macro.py")]:
        txt = visible_strings(open(f, encoding="utf-8").read())
        hits = [m.group(0) for m in bad.finditer(txt)]
        assert not hits, f"{os.path.basename(f)}: {hits}"


def test_motivo_de_la_vision_usa_peso_del_escenario():
    assert "peso del escenario" in src("scripts/fetch_macro.py")


def test_etiquetas_en_cada_lectura():
    req = {
        "assets/app.js": ['Régimen macro · EE. UU. ${evid("h")}', 'Visión por horizonte ${evid("h")}'],
        "assets/adelantarse.js": ['Escenarios a 6-12 meses ${H.evid("h")}', 'horizontes cerrados</b> ${H.evid("h", "r")}', 'registrada a diario</b> ${H.evid("e", "r")}'],
        "assets/equities.js": ['${esc(profileName())}</b> ${H.evid("e", "r")}'],
        "assets/ficha.js": ['${esc(tv || "—")}</span> ${H.evid("h", "r")}', 'Factores y scoring ${H.evid("e", "r")}', 'Lectura analítica ${H.evid("h")}'],
        "assets/smart.js": ['${H.evid("h")} ${esc(SMART_TIP)}'],
        "assets/chart.js": ['k === "konkorde" ? " " + window.SCR.evid("h")'],
    }
    for f, needles in req.items():
        s = src(f)
        for n in needles:
            assert n in s, f"{f}: falta {n}"
    app = src("assets/app.js")
    for label in ("Heurística", "Evaluada históricamente", "Registrada en funcionamiento"):
        assert label in app
