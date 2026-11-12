"""Funciones puras del front (JS), evaluadas con Node: filtro de splits y DCF inverso."""
import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(not NODE, reason="Node no disponible")


def js(file, names, expr):
    out = subprocess.run([NODE, os.path.join(ROOT, "tests", "js_eval.mjs"), os.path.join(ROOT, "assets", file), names, expr],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_split_2x1_se_neutraliza():
    r = js("carteras.js", "SPLITS,splitSafe", "[splitSafe(0.5), splitSafe(2.0), splitSafe(0.1), splitSafe(10.02), splitSafe(1/3)]")
    assert r == [1, 1, 1, 1, 1]


def test_movimientos_normales_no_se_tocan():
    r = js("carteras.js", "SPLITS,splitSafe", "[splitSafe(1.05), splitSafe(0.9), splitSafe(0.62), splitSafe(1.55), splitSafe(0.45)]")
    assert r == [1.05, 0.9, 0.62, 1.55, 0.45]                   # una caída del 55 % que no es un split se conserva


def test_dcf_inverso_recupera_el_crecimiento():
    # valor de empresa calculado con g = 7 %: el DCF inverso debe devolver 7 %
    g = js("tesis.js", "pv,implied", "implied(pv(100, 0.07, 0.09, 0.025, 10), 100, 0.09, 0.025, 10).g")
    assert g == pytest.approx(0.07, abs=1e-6)


def test_dcf_inverso_casos_limite():
    r = js("tesis.js", "pv,implied",
           "[implied(1000, -5, 0.09, 0.025, 10), implied(1000, 100, 0.02, 0.025, 10), implied(1e12, 1, 0.09, 0.025, 10), implied(1, 100, 0.09, 0.025, 10)]")
    assert r[0] is None and r[1] is None                       # FCF negativo o descuento ≤ crecimiento perpetuo
    assert r[2] == {"g": None, "above": True}                   # ni con un 100 % anual
    assert r[3] == {"g": None, "below": True}
