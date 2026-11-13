#!/usr/bin/env python3
"""Prueba de interfaz con el sitio ya preparado y los datos reales (en el workflow, solo al subir cambios).

Uso: python scripts/check_ui.py _site
Comprueba en Chrome sin pantalla:
  · Fase 1.6: #/empresa/NVDA abre la ficha a pantalla completa; «atrás» la cierra y vuelve a la sección anterior.
  · Fase 1.7: las 7 secciones a ≤ 2 clics desde cualquier otra, 4 áreas en la barra, modos Compacto/Explicado
    y, a 390 px de ancho, sin desbordes horizontales en ninguna sección.
  · Errores de JavaScript en cada sección.
Imprime OK/FALLA por comprobación y termina con error si alguna falla.
"""
import functools
import http.server
import os
import shutil
import sys
import threading

from playwright.sync_api import sync_playwright

SITE = sys.argv[1] if len(sys.argv) > 1 else "_site"
CHROME = os.environ.get("CHROME") or shutil.which("google-chrome") or shutil.which("chromium")
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append(ok)
    print(f"{'OK   ' if ok else 'FALLA'} {name}{' · ' + detail if detail else ''}", flush=True)


def serve(folder):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    h = functools.partial(Quiet, directory=folder)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_port}/index.html"


def fichas(pg, base):
    pg.goto(base + "#/empresa/NVDA")
    pg.wait_for_function("window.SCRFichaSym && window.SCRFichaSym() === 'NVDA'", timeout=60000)
    full = pg.evaluate("(() => { const d = document.getElementById('drawer'); return d.classList.contains('full') && d.getBoundingClientRect().width >= innerWidth - 1; })()")
    check("#/empresa/NVDA abre la ficha a pantalla completa", full, pg.inner_text("#drawerBody h3")[:60])
    check("cabecera ejecutiva visible", pg.locator("#drawerBody .f-exec").count() == 1)
    # navegación interna: sección → ficha → atrás
    pg.goto(base + "#/screener")
    pg.wait_for_selector("[data-sym]", timeout=60000)
    sym = pg.get_attribute("[data-sym]", "data-sym")
    pg.click(f"[data-sym='{sym}']")
    pg.wait_for_function(f"window.SCRFichaSym() === {sym!r}", timeout=30000)
    check("clic en una fila → enlace propio", pg.url.endswith("#/empresa/" + sym), pg.url.split("#")[1])
    pg.go_back()
    pg.wait_for_timeout(800)
    closed = pg.evaluate("!document.getElementById('drawer').classList.contains('on')")
    check("«atrás» cierra la ficha y vuelve al screener", closed and pg.url.endswith("#/screener"), pg.url.split("#")[1])
    pg.go_forward()
    pg.wait_for_function(f"window.SCRFichaSym() === {sym!r}", timeout=30000)
    check("«adelante» la vuelve a abrir", True)


AREAS = {"hoy": "mercado", "pulso": "mercado", "sectores": "mercado", "adelantarse": "mercado",
         "screener": "screener", "comparar": "screener", "smart": "screener",
         "seguimiento": "watchlists", "carteras": "watchlists", "laboratorio": "investigacion"}


def navegacion(pg, base):
    pg.goto(base + "#/pulso")
    pg.wait_for_timeout(1500)
    n = pg.locator("#nav button").count()
    check("barra con 4 áreas", n == 4, f"{n} botones")
    worst = 0
    for start in ("pulso", "smart", "laboratorio"):
        for v, area in AREAS.items():
            pg.goto(base + "#/" + start)
            pg.wait_for_timeout(300)
            clicks = 0
            pg.click(f"#nav button[data-area={area}]")
            clicks += 1
            pg.wait_for_timeout(300)
            if not pg.url.endswith("#/" + v):
                pg.click(f"[data-sub={v}]")
                clicks += 1
                pg.wait_for_timeout(300)
            if not pg.url.endswith("#/" + v):
                clicks = 99
            worst = max(worst, clicks)
    check("cualquier sección a ≤ 2 clics desde cualquier otra", worst <= 2, f"máximo {worst}")
    pg.click("#gear")
    pg.click("#level button[data-mode=c]")
    c = pg.evaluate("document.documentElement.dataset.mode")
    pg.click("#level button[data-mode=x]")
    x = pg.evaluate("document.documentElement.dataset.mode")
    check("ajustes: tema", pg.locator("#theme").is_visible())
    pg.keyboard.press("Escape")
    check("2 modos (Compacto / Explicado)", pg.locator("#level button").count() == 2 and c == "c" and x == "x")


def movil(pg, base):
    pg.set_viewport_size({"width": 390, "height": 844})
    bad = []
    for v in AREAS:
        pg.goto(base + "#/" + v)
        pg.wait_for_timeout(2500)
        sw = pg.evaluate("document.documentElement.scrollWidth")
        if sw > 391:
            bad.append(f"{v} ({sw} px)")
    check("sin desbordes a 390 px", not bad, ", ".join(bad) or f"{len(AREAS)} secciones")
    vis = pg.evaluate("[...document.querySelectorAll('#nav button')].filter(b => b.getBoundingClientRect().width > 0).length")
    check("móvil: 4-5 accesos en la barra inferior", 4 <= vis <= 5, f"{vis}")
    pg.set_viewport_size({"width": 1366, "height": 900})


def fase2(pg, base):
    """Fase 2 (1.ª tanda): amplitud y liquidez, nota explicable, «qué ha cambiado» y comparador con percentiles."""
    pg.goto(base + "#/pulso")
    pg.wait_for_selector("#amplitud", timeout=30000)
    pg.wait_for_timeout(1500)
    txt = pg.text_content("#view")
    check("Pulso: amplitud con datos", "Sobre su media de 50 sesiones" in txt, "sin datos" if "Sin datos de amplitud" in txt else "")
    check("Pulso: liquidez neta de la Fed", "Liquidez neta de la Fed" in txt and "Sin datos de liquidez" not in txt)
    pg.goto(base + "#/empresa/MSFT")
    pg.wait_for_function("window.SCRFichaSym && window.SCRFichaSym() === 'MSFT'", timeout=60000)
    pg.wait_for_timeout(2500)
    check("ficha: «por qué esta nota»", pg.locator("#drawerBody .sc-why .why-row").count() >= 4)
    check("ficha: percentiles en su sector", "Percentiles en su sector" in pg.text_content("#drawerBody"))
    pg.goto(base + "#/screener")
    pg.wait_for_selector("[data-act=changes]", timeout=30000)
    pg.click("[data-act=changes]")
    pg.wait_for_timeout(800)
    t = pg.text_content("#view")
    check("screener: «qué ha cambiado»", "Más suben de nota" in t or "segunda actualización" in t, "frente a la sesión anterior" if "Más suben" in t else "aún sin sesión anterior")
    pg.goto(base + "#/comparar/AAPL,MSFT,NVDA")
    pg.wait_for_selector("table.cmp", timeout=30000)
    pills = pg.locator("table.cmp .pp").count()
    check("comparador por enlace con percentiles", pg.locator("table.cmp thead th a").count() == 3 and pills > 20, f"{pills} percentiles")


def tanda2(pg, base):
    """Fase 2 (2.ª tanda): «Hoy», directivos, fechas del smart money y factores académicos."""
    pg.goto(base + "#/hoy")
    pg.wait_for_timeout(4000)
    t = pg.text_content("#view")
    check("«Hoy»: secciones", all(x in t for x in ("Tu seguimiento", "Mayores cambios de nota", "Resultados en los próximos 7 días", "Compras de directivos", "Copia de seguridad")))
    check("«Hoy»: estado de los datos", "validación" in t or "no pasaron" in t, t.split("\n")[0][:80])
    with pg.expect_download(timeout=10000) as dl:
        pg.click("[data-bk=down]")
    check("copia de seguridad descargable", dl.value.suggested_filename.startswith("screener-copia-"), dl.value.suggested_filename)
    pg.goto(base + "#/smart")
    pg.wait_for_selector("[data-smtab=directivos]", timeout=30000)
    pg.click("[data-smtab=gestores]")
    pg.wait_for_timeout(800)
    check("smart money: fechas de cartera y publicación", "Cartera a" in pg.text_content("#view") and "Desfase" in pg.text_content("#view"))
    pg.click("[data-smtab=directivos]")
    pg.wait_for_timeout(2500)
    n = pg.locator("#view table tbody tr").count()
    check("smart money: directivos (formulario 4)", n >= 1, f"{n} filas")
    pg.goto(base + "#/empresa/AAPL/fund")
    pg.wait_for_function("window.SCRFichaSym && window.SCRFichaSym() === 'AAPL'", timeout=60000)
    pg.wait_for_timeout(2500)
    check("ficha: factores académicos (SEC)", "Factores académicos" in pg.text_content("#drawerBody"), "con datos" if "F-score" in pg.text_content("#drawerBody") else "sin datos SEC aún")


def fase5(pg, base):
    """Fase 5: cabecera con 4 áreas, migas de pan, barra lateral de secciones y enlaces antiguos."""
    pg.set_viewport_size({"width": 1366, "height": 900})
    pg.goto(base + "#/smart")
    pg.wait_for_timeout(1500)
    crumbs = pg.inner_text("#crumbs")
    check("migas de pan", "Screener" in crumbs and "Smart money" in crumbs, crumbs.replace("\n", " "))
    side = [b.inner_text().strip() for b in pg.locator("#side button").all()]
    check("barra lateral con las secciones del área", side == ["Screener", "Comparar", "Smart money"], " · ".join(side))
    for old in ("#/carteras", "#/laboratorio", "#/pulso"):
        pg.goto(base + old)
        pg.wait_for_timeout(800)
    check("enlaces antiguos siguen funcionando", pg.evaluate("window.SCR.S.view") == "pulso")
    pg.goto(base)
    pg.wait_for_timeout(1500)
    check("tema oscuro por defecto", pg.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(10, 20, 36)")


def main():
    base = serve(SITE)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"]) if CHROME else p.chromium.launch()
        pg = b.new_page(viewport={"width": 1366, "height": 900})
        errs = []
        where = ["inicio"]
        pg.on("pageerror", lambda e: errs.append(f"{where[0]}: {e}"))
        for fn in (fichas, navegacion, movil, fase2, tanda2, fase5):
            try:
                fn(pg, base)
            except Exception as e:  # noqa: BLE001
                check(fn.__name__, False, str(e)[:200])
        for v in AREAS:
            where[0] = v
            pg.goto(base + "#/" + v)
            pg.wait_for_timeout(2500)
        check("sin errores de JavaScript", not errs, "; ".join(errs[:3]))
        b.close()
    print(f"Interfaz: {sum(RESULTS)} de {len(RESULTS)} comprobaciones correctas", flush=True)
    return 0 if all(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
