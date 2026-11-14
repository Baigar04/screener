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
    ok = bool(ok)
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
    page = pg.evaluate("!document.getElementById('drawer').classList.contains('on') && !!document.querySelector('#view .fp-head h1')")
    check("#/empresa/NVDA abre la ficha como página", page, pg.inner_text("#view .fp-head h1")[:60])
    # navegación interna: sección → ficha → atrás
    pg.goto(base + "#/screener")
    pg.wait_for_selector("[data-sym]", timeout=60000)
    sym = pg.get_attribute("[data-sym]", "data-sym")
    pg.click(f"[data-sym='{sym}']")
    pg.wait_for_function(f"window.SCRFichaSym() === {sym!r}", timeout=30000)
    check("clic en una fila → enlace propio", pg.url.endswith("#/empresa/" + sym), pg.url.split("#")[1])
    pg.go_back()
    pg.wait_for_timeout(800)
    check("«atrás» vuelve al screener", pg.url.endswith("#/screener") and pg.evaluate("!window.SCR.S.ficha"), pg.url.split("#")[1])
    pg.go_forward()
    pg.wait_for_function(f"window.SCRFichaSym() === {sym!r}", timeout=30000)
    check("«adelante» la vuelve a abrir", True)


AREAS = {"hoy": "mercado", "pulso": "mercado", "sectores": "mercado", "adelantarse": "mercado",
         "screener": "screener", "comparar": "screener", "smart": "screener",
         "seguimiento": "watchlists", "carteras": "watchlists", "laboratorio": "investigacion", "diario": "investigacion"}


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
    pg.click("#side [data-fsec=factores]")
    pg.wait_for_timeout(1500)
    check("ficha: «por qué esta nota»", pg.locator("#view .sc-why .why-row").count() >= 4)
    check("ficha: percentiles en su sector", "Percentiles en su sector" in pg.text_content("#view"))
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
    pg.evaluate("document.querySelector('.hoy-more').open = true")
    t = pg.text_content("#view")
    check("«Hoy»: secciones", all(x in t for x in ("Pulso del mercado", "Tu Watchlist hoy", "Próximos resultados", "Movimientos de la nota", "Smart money", "Tu Diario", "Copia de seguridad")))
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
    pg.click("#side [data-fsec=factores]")
    pg.wait_for_timeout(1500)
    check("ficha: factores académicos (SEC)", "Factores académicos" in pg.text_content("#view"), "con datos" if "F-score" in pg.text_content("#view") else "sin datos SEC aún")


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
    check("tema oscuro por defecto", pg.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(13, 15, 18)")


FSECS = ["resumen", "grafico", "fund", "valoracion", "factores", "resultados", "comparables", "smartm", "invest"]


def fase6(pg, base):
    """Fase 6: ficha 2.0 con 9 apartados, tarjetas con fuente y fecha, migas «Screener / Empresas / X»."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    for sym in ("AAPL", "SAN.MC"):
        pg.goto(base + "#/empresa/" + sym)
        pg.wait_for_selector("#view .f3 .fs", timeout=60000)
        pg.wait_for_timeout(1500)
        side = [b.get_attribute("data-fsec") for b in pg.locator("#side button").all()]
        crumbs = pg.text_content("#crumbs")
        check(f"{sym}: barra lateral con los 9 apartados", side == FSECS, " · ".join(x or "?" for x in side))
        check(f"{sym}: migas Screener / Empresas / empresa y área Screener", "Empresas" in crumbs and pg.get_attribute("#nav .on", "data-area") == "screener", crumbs.strip()[:80])
        srcs = [x.text_content() for x in pg.locator("#view .fs > h3 > span").all()]
        check(f"{sym}: bloques con fuente y fecha", sum(any(m in t for m in ("SEC", "Yahoo")) for t in srcs) >= 2 and pg.locator("#view .fsrc").count() >= 1, " · ".join(srcs[:3]))
        t = pg.text_content("#view")
        need = ("Datos clave", "Calidad del dato", "Nota de ordenación", "Próximos eventos", "Crecimiento reciente", "Márgenes", "Observado", "Interpretación", "En contra")
        check(f"{sym}: Resumen en tres columnas y lectura en tres partes", all(x in t for x in need) and ("Cuenta de resultados" in t or "Cuentas anuales" in t), ", ".join(x for x in need if x not in t))
        check(f"{sym}: cabecera con precio y titular", pg.locator("#view .fh .fh-p").count() == 1, (pg.text_content("#view .fh-tesis") or "sin titular")[:80] if pg.locator("#view .fh-tesis").count() else "sin titular")
        if sym == "AAPL":
            sec = "Último 10-Q presentado" in pg.text_content("#status") or "Último 10-K presentado" in pg.text_content("#status")
            check("AAPL: trimestres SEC en la ficha", sec, pg.text_content("#status").strip()[:80] if sec else "sin trimestres SEC aún (llegan con la caché v3)")
        bad = []
        for k in FSECS[1:]:
            pg.click(f"#side [data-fsec={k}]")
            pg.wait_for_timeout(1200)
            if not pg.url.endswith(f"/{k}") or "No se pudo dibujar" in pg.text_content("#view"):
                bad.append(k)
        check(f"{sym}: los 9 apartados abren sin error", not bad, ", ".join(bad))
    pg.goto(base + "#/empresa/AAPL/tesis")
    pg.wait_for_timeout(1500)
    check("enlace antiguo #/empresa/X/tesis → Valoración", pg.evaluate("window.SCR.S.ficha && window.SCR.S.ficha.tab") == "valoracion")
    pg.set_viewport_size({"width": 390, "height": 844})
    bad = []
    for k in ("resumen", "fund", "comparables", "resultados"):
        pg.goto(base + f"#/empresa/AAPL/{k}")
        pg.wait_for_timeout(2500)
        sw = pg.evaluate("document.documentElement.scrollWidth")
        if sw > 391:
            bad.append(f"{k} ({sw} px)")
    check("ficha sin desbordes a 390 px", not bad, ", ".join(bad))
    pg.set_viewport_size({"width": 1366, "height": 900})


def fase7(pg, base):
    """Fase 7: diario de decisiones (registrar desde la ficha, medir, anular) y registro inmutable. Usa un navegador limpio."""
    pg.set_viewport_size({"width": 1366, "height": 900})
    pg.goto(base + "#/diario")
    pg.evaluate("localStorage.removeItem('diario')")
    pg.goto(base + "#/empresa/MSFT")
    pg.wait_for_selector("#view .fp-act [data-dnew]", timeout=60000)
    pg.click("#view .fp-act [data-dnew]")
    pg.wait_for_selector("#drawer [data-ddec=comprar]", timeout=10000)
    pg.click("#drawer [data-dsave]")
    check("diario: no guarda sin decisión ni motivo", "Elige la decisión" in pg.text_content("#dmsg"))
    pg.click("#drawer [data-ddec=comprar]")
    pg.click("#drawer [data-dhz=medio]")
    pg.fill("#dmot", "Prueba automática de la interfaz")
    pg.click("#drawer [data-dsave]")
    pg.wait_for_timeout(800)
    saved = pg.evaluate("JSON.parse(localStorage.getItem('diario') || '[]')")
    ok = len(saved) == 1 and saved[0]["sym"] == "MSFT" and saved[0]["p0"] and saved[0]["fp"]
    check("diario: decisión guardada con precio y cierre del día", ok, f"{saved[0]['dec']} a {saved[0]['p0']} ({saved[0]['fp']})" if saved else "nada")
    check("ficha: «Tu investigación» muestra la decisión", "Última decisión" in pg.text_content("#view") and "Comprar" in pg.text_content("#view"))
    pg.goto(base + "#/diario")
    pg.wait_for_selector("table.dtab", timeout=30000)
    pg.wait_for_timeout(2000)
    t = pg.text_content("#view")
    check("diario: sección en Investigación con tabla y KPIs", "Decisiones registradas" in t and "Acierto a 3 meses" in t and pg.get_attribute("#nav .on", "data-area") == "investigacion")
    check("diario: notas de carteras integradas", "Notas de tus carteras" in t)
    check("registro inmutable visible", "Registro inmutable" in pg.text_content("#status") and ("íntegra" in t or "próxima actualización" in t), pg.text_content("#status").strip()[:80])
    pg.click("[data-danul]")
    pg.click("[data-danul]")
    pg.wait_for_timeout(500)
    an = pg.evaluate("JSON.parse(localStorage.getItem('diario'))[0].anulada")
    check("diario: anular deja la decisión a la vista", bool(an) and pg.locator("tr.anul").count() == 1)
    pg.evaluate("localStorage.removeItem('diario')")


def diseno1(pg, base):
    """Diseño A · entrega 1: tipografía propia, panel de trabajo, pestañas de sección y densidad."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(base + "#/hoy")
    pg.wait_for_timeout(2500)
    pg.evaluate("document.fonts.ready")
    check("tipografía IBM Plex cargada", pg.evaluate("document.fonts.check(\"13px 'IBM Plex Sans'\") && [...document.fonts].some(f => f.family.includes('IBM Plex Sans') && f.status === 'loaded')"))
    wsp = pg.text_content("#wsp") or ""
    check("panel de trabajo con la Watchlist", "Watchlist" in wsp and pg.evaluate("getComputedStyle(document.getElementById('wsp')).display") != "none")
    tabs = [b.inner_text().strip() for b in pg.locator(".tabsbar #side button").all()]
    check("pestañas de sección bajo la cabecera", len(tabs) >= 2 and tabs[0] == "Hoy" and tabs[1].startswith("Pulso"), " · ".join(tabs))
    pg.click("#gear")
    pg.click("#dens")
    d = pg.evaluate("document.documentElement.dataset.dens")
    pg.click("#dens")
    check("densidad compacta/amplia", d == "amplia" and pg.evaluate("document.documentElement.dataset.dens") == "compacta")
    pg.click("#gear")


def fase9(pg, base):
    """Fase 9: calidad del beneficio y balance en Resumen y Fundamentales (EE. UU. con SEC; Europa aproximado)."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(base + "#/empresa/AAPL/resumen")
    pg.wait_for_selector("#view .f3 .fs", timeout=60000)
    pg.wait_for_timeout(1000)
    t = pg.text_content("#view .f3c") or ""
    check("AAPL: calidad del beneficio en el Resumen", "Calidad del beneficio y balance" in t and "Conversión en caja" in t, t[-120:].replace("\n", " "))
    pg.goto(base + "#/empresa/AAPL/fund")
    pg.wait_for_timeout(2500)
    t = pg.text_content("#view") or ""
    n = pg.locator("#view .q3 tr").count()
    check("AAPL: bloque completo en Fundamentales", all(x in t for x in ("Calidad del beneficio", "Balance y liquidez", "Dilución", "Evolución anual")) and n >= 6, f"{n} métricas")
    check("AAPL: datos nuevos de la SEC (caja, intereses o acciones diluidas)", any(x in t for x in ("Cobertura de intereses", "Acciones diluidas, interanual", "Deuda neta")))
    pg.goto(base + "#/empresa/SAN.MC/fund")
    pg.wait_for_timeout(2500)
    check("SAN.MC: bloque aproximado sin errores", "Calidad del beneficio y balance" in (pg.text_content("#view") or ""))


def diseno3(pg, base):
    """Diseño A · entrega 3: Screener de una línea, «Hoy» en rejilla, rotación sectorial nueva y atajos."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(base + "#/hoy")
    pg.wait_for_timeout(3000)
    check("«Hoy»: 6 bloques y tira de índices", pg.locator(".hgrid .hs").count() == 6 and pg.locator(".ixs > div").count() >= 1, f"{pg.locator('.ixs > div').count()} índices")
    pg.goto(base + "#/screener")
    pg.wait_for_selector("table.scr tbody tr[data-sym]", timeout=20000)
    check("Screener: cabecera de página", (pg.text_content(".pg-head h1") or "").strip() == "Screener")
    check("Screener: filas sin logotipo ni etiquetas", pg.locator("table.scr .logo, table.scr .tgs").count() == 0)
    heads = [x.strip() for x in pg.locator("table.scr thead th").all_inner_texts()]
    check("Screener: la nota va tras el sector", "Sector" in heads and heads.index("Sector") + 1 < len(heads) and heads[heads.index("Sector") + 1].startswith("Nota"), " · ".join(heads[:6]))
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press("j"); pg.keyboard.press("j"); pg.keyboard.press("k")
    first = pg.locator("table.scr tbody tr[data-sym]").first.get_attribute("data-sym")
    kf = pg.locator("table.scr tr.kf").get_attribute("data-sym")
    check("atajos J/K", kf == first, f"{kf} vs {first}")
    pg.keyboard.press("c")
    check("atajo C añade al comparador", pg.locator(".cmp-bar").count() == 1)
    pg.click("[data-act=cmpclear]")
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(1500)
    check("atajo Intro abre la ficha", f"/empresa/{first}" in pg.url, pg.url)
    pg.goto(base + "#/sectores")
    pg.wait_for_timeout(3000)
    n = pg.locator(".rrg2 svg g[data-rrgsel]").count()
    if n:
        pg.locator(".rrgt tbody tr").first.click()
        pg.locator(".rrgt tbody tr").nth(1).click()
        check("rotación: etiquetas, tabla y recorridos de los elegidos", n >= 5 and pg.locator(".rrg2 svg polyline").count() == 2 and pg.locator(".rrgt tbody tr").count() == n, f"{n} sectores")
    else:
        check("rotación: aviso hasta el próximo cálculo", "próxima actualización" in (pg.text_content("#view") or ""))


def main():
    base = serve(SITE)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"]) if CHROME else p.chromium.launch()
        pg = b.new_page(viewport={"width": 1366, "height": 900})
        errs = []
        where = ["inicio"]
        pg.on("pageerror", lambda e: errs.append(f"{where[0]}: {e}"))
        for fn in (fichas, navegacion, movil, fase2, tanda2, fase5, fase6, fase7, fase9, diseno1, diseno3):
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
