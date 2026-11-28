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


AREAS = {"hoy": "hoy", "pulso": "mercado", "sectores": "mercado", "adelantarse": "mercado", "riesgo": "contexto", "geopolitica": "contexto", "escenarios": "cartera",
         "screener": "screener", "comparar": "screener", "smart": "screener",
         "seguimiento": "cartera", "carteras": "cartera", "laboratorio": "investigacion", "diario": "investigacion"}


def navegacion(pg, base):
    pg.goto(base + "#/pulso")
    pg.wait_for_timeout(1500)
    n = pg.locator("#nav button").count()
    check("barra con 6 áreas", n == 6, f"{n} botones")
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
    for v in ("hoy", "screener", "empresa/AAPL"):
        pg.goto(base + "#/" + v)
        pg.wait_for_timeout(2500)
        hit = pg.evaluate("(() => { const e = document.elementFromPoint(195, 300); return !!(e && e.closest('#view')); })()")
        nh = pg.evaluate("document.getElementById('nav').getBoundingClientRect().height")
        check(f"móvil: contenido visible en #/{v} (barra inferior de {nh:.0f} px)", hit and nh < 100)
    vis = pg.evaluate("[...document.querySelectorAll('#nav button')].filter(b => b.getBoundingClientRect().width > 0).length")
    check("móvil: 6 accesos en la barra inferior", vis == 6, f"{vis}")
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
    pg.click("#side [data-fsec=cuentas]")
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
    check("«Hoy»: secciones", all(x in t for x in ("Qué ha cambiado", "Avisos", "Tus valores", "Lectura del día", "Próximos resultados", "Smart money", "Tu Diario", "Pulso del mercado", "Copia de seguridad")))
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
    pg.goto(base + "#/empresa/AAPL/cuentas")
    pg.wait_for_function("window.SCRFichaSym && window.SCRFichaSym() === 'AAPL'", timeout=60000)
    pg.wait_for_timeout(2500)
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


FSECS = ["informe", "grafico", "cuentas", "movimientos", "comparables", "invest"]


def fase6(pg, base):
    """Fase 6 (R2: 6 apartados, el Informe como portada): ficha 2.0 (fase 3: Riesgo y escenarios), tarjetas con fuente y fecha, migas «Screener / Empresas / X»."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    for sym in ("AAPL", "SAN.MC"):
        pg.goto(base + "#/empresa/" + sym + "/cuentas")
        pg.wait_for_selector("#view .f3 .fs", timeout=60000)
        pg.wait_for_timeout(1500)
        side = [b.get_attribute("data-fsec") for b in pg.locator("#side button").all()]
        crumbs = pg.text_content("#crumbs")
        check(f"{sym}: barra lateral con los 6 apartados", side == FSECS, " · ".join(x or "?" for x in side))
        check(f"{sym}: migas Screener / Empresas / empresa y área Screener", "Empresas" in crumbs and pg.get_attribute("#nav .on", "data-area") == "screener", crumbs.strip()[:80])
        srcs = [x.text_content() for x in pg.locator("#view .fs > h3 > span").all()]
        check(f"{sym}: bloques con fuente y fecha", sum(any(m in t for m in ("SEC", "Yahoo")) for t in srcs) >= 2 and pg.locator("#view .fsrc").count() >= 1, " · ".join(srcs[:3]))
        t = pg.text_content("#view")
        need = ("Datos clave", "Calidad del dato", "Nota de ordenación", "Próximos eventos", "Crecimiento reciente", "Márgenes")
        check(f"{sym}: Cuentas en tres columnas y lectura en tres partes", all(x in t for x in need) and ("Cuenta de resultados" in t or "Cuentas anuales" in t), ", ".join(x for x in need if x not in t))
        check(f"{sym}: cabecera con precio y titular", pg.locator("#view .fh .fh-p").count() == 1, (pg.text_content("#view .fh-tesis") or "sin titular")[:80] if pg.locator("#view .fh-tesis").count() else "sin titular")
        if sym == "AAPL":
            sec = "Último 10-Q presentado" in pg.text_content("#status") or "Último 10-K presentado" in pg.text_content("#status")
            check("AAPL: trimestres SEC en la ficha", sec, pg.text_content("#status").strip()[:80] if sec else "sin trimestres SEC aún (llegan con la caché v3)")
        bad = []
        for k in FSECS:
            pg.click(f"#side [data-fsec={k}]")
            pg.wait_for_timeout(1200)
            if pg.evaluate("window.SCR.S.ficha && window.SCR.S.ficha.tab") != k or "No se pudo dibujar" in pg.text_content("#view"):
                bad.append(k)
        check(f"{sym}: los 6 apartados abren sin error", not bad, ", ".join(bad))
    pg.goto(base + "#/empresa/AAPL/tesis")
    pg.wait_for_timeout(1500)
    check("enlace antiguo #/empresa/X/tesis → Cuentas y valoración", pg.evaluate("window.SCR.S.ficha && window.SCR.S.ficha.tab") == "cuentas")
    pg.set_viewport_size({"width": 390, "height": 844})
    bad = []
    for k in ("informe", "cuentas", "comparables", "movimientos"):
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
    areas = [b.inner_text().strip() for b in pg.locator("#nav button").all()]
    check("seis áreas en la cabecera", areas == ["Hoy", "Mercado", "Contexto", "Screener", "Cartera", "Investigación"], " · ".join(areas))
    pg.goto(base + "#/pulso")
    pg.wait_for_timeout(1500)
    tabs = [b.inner_text().strip() for b in pg.locator(".tabsbar #side button").all()]
    check("pestañas de sección bajo la cabecera", len(tabs) >= 2 and tabs[0].startswith("Pulso"), " · ".join(tabs))
    pg.click("#gear")
    pg.click("#dens")
    d = pg.evaluate("document.documentElement.dataset.dens")
    pg.click("#dens")
    check("densidad compacta/amplia", d == "amplia" and pg.evaluate("document.documentElement.dataset.dens") == "compacta")
    pg.click("#gear")


def fase9(pg, base):
    """Fase 9: calidad del beneficio y balance en Resumen y Fundamentales (EE. UU. con SEC; Europa aproximado)."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(base + "#/empresa/AAPL/cuentas")
    pg.wait_for_selector("#view .f3 .fs", timeout=60000)
    pg.wait_for_timeout(1000)
    t = pg.text_content("#view .f3c") or ""
    check("AAPL: calidad del beneficio en Cuentas", "Calidad del beneficio y balance" in t and "Conversión en caja" in t, t[-120:].replace("\n", " "))
    pg.goto(base + "#/empresa/AAPL/cuentas")
    pg.wait_for_timeout(2500)
    t = pg.text_content("#view") or ""
    n = pg.locator("#view .q3 tr").count()
    check("AAPL: bloque completo en Fundamentales", all(x in t for x in ("Calidad del beneficio", "Balance y liquidez", "Dilución", "Evolución anual")) and n >= 6, f"{n} métricas")
    check("AAPL: datos nuevos de la SEC (caja, intereses o acciones diluidas)", any(x in t for x in ("Cobertura de intereses", "Acciones diluidas, interanual", "Deuda neta")))
    pg.goto(base + "#/empresa/NVDA/fund")
    pg.wait_for_timeout(2500)
    t = pg.text_content("#view") or ""
    d = pg.evaluate("fetch('data/t/NVDA.json').then(r => r.json()).then(d => [(d.sec && d.sec.splits) || [], ((d.sec && d.sec.q) || []).map(x => [x[0], x[1], x[8], x[14], x[15]])])")
    print("    NVDA splits y trimestres (fin, presentado, BPA, acciones, factor):", d, flush=True)
    check("NVDA: split de 2024 detectado (BPA en la base actual)", "Splits (5 años)" in t and any(abs(sp[1] - 10) < 0.01 for sp in d[0]), str(d[0]))
    pg.goto(base + "#/empresa/SAN.MC/fund")
    pg.wait_for_timeout(2500)
    check("SAN.MC: bloque aproximado sin errores", "Calidad del beneficio y balance" in (pg.text_content("#view") or ""))


def grafico(pg, base):
    """Gráfico de la ficha (maqueta 14-nov): sin cuadrícula, leyenda sin titulares, carril de eventos con tarjeta al pasar."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(base + "#/empresa/AAPL/grafico")
    pg.wait_for_selector(".cx-chart canvas", timeout=60000)
    pg.wait_for_timeout(2500)
    leg = pg.text_content(".cx-legend") or ""
    check("gráfico: leyenda sin titulares de noticias", "Resultados:" not in leg and "Noticia" not in leg and "AAPL" in leg, leg[:120])
    vis = pg.evaluate("[...document.querySelectorAll('.cx-lane .cx-g')].filter(g => g.style.display !== 'none').length")
    check("gráfico: carril de eventos con glifos", vis > 0, f"{vis} visibles")
    if vis:
        g = pg.locator(".cx-lane .cx-g:visible").last
        g.hover()
        pg.wait_for_timeout(400)
        check("gráfico: tarjeta del día al pasar el ratón", pg.locator(".cx-card:not([hidden])").count() == 1, (pg.text_content(".cx-card") or "")[:100])
    check("gráfico: selector de eventos", pg.locator(".cx-evdd [data-cx-ev]").count() == 5)
    for size in ("", "l"):   # el cursor del gráfico debe coincidir con el ratón, también con «texto grande» (zoom)
        pg.evaluate(f"document.documentElement.dataset.size = '{size}'")
        pg.wait_for_timeout(600)
        b = pg.locator(".cx-chart").bounding_box()
        pg.mouse.move(b["x"] + 400, b["y"] + 150)
        pg.wait_for_timeout(300)
        pt = pg.evaluate("window.SCRChartLastPt")
        # el punto del gráfico está en píxeles propios del gráfico: con zoom efectivo 1 debe ser 400 ± 3
        check(f"gráfico: cursor alineado con el ratón (texto {'grande' if size else 'normal'})", bool(pt) and abs(pt["x"] - 400) <= 3, str(pt))
    pg.evaluate("document.documentElement.dataset.size = ''")
    try:
        import base64
        b = pg.locator(".cx").first.screenshot(type="jpeg", quality=55)
        print("CAPTURA_GRAFICO " + base64.b64encode(b).decode(), flush=True)
    except Exception as e:  # noqa: BLE001
        print("captura:", e)


def ranking(pg, base):
    """Smart money · más compradas y vendidas (13F del trimestre, directivos y Congreso a 30 días) y universo ampliado."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(base + "#/smart")
    pg.wait_for_selector("[data-smtab=ranking]", timeout=30000)
    pg.click("[data-smtab=ranking]")
    pg.wait_for_timeout(3000)
    t = pg.text_content("#view") or ""
    n = pg.locator("#view table.rk tbody tr").count()
    check("ranking: tres bloques con compradas y vendidas", all(x in t for x in ("Superinversores", "Directivos", "Congreso de EE. UU.", "Más compradas", "Más vendidas")) and n >= 10, f"{n} filas")
    pg.goto(base + "#/hoy")
    pg.wait_for_timeout(3000)
    check("«Hoy»: resumen del ranking", "Más compradas · superinversores" in (pg.text_content("#view") or ""))
    regs = pg.evaluate("(window.SCRUni ? window.SCRUni() : []).reduce((a, r) => (a[r.region] = (a[r.region] || 0) + 1, a), {})")
    idx = pg.evaluate("(window.SCRUni ? window.SCRUni() : []).reduce((a, r) => { (r.indices || []).forEach((i) => a[i] = (a[i] || 0) + 1); return a; }, {})")
    print("    regiones:", regs, "· índices:", idx, flush=True)
    check("universo ampliado: S&P 600, FTSE 250, Mercado Continuo y Latinoamérica", all(idx.get(k, 0) > 0 for k in ("S&P 600", "FTSE 250", "Mercado Continuo", "ADR Latinoamérica")) and regs.get("Latinoamérica", 0) > 0,
          str(idx))
    check("universo fase 4: Nikkei 225, KOSPI 200, Taiwán, pequeñas de EE. UU. y temáticos", all(idx.get(k, 0) > 0 for k in ("Nikkei 225", "KOSPI 200", "Taiwán 100 (mayores, Yahoo)", "Pequeñas EE. UU. (≈ Russell 2000)")) and any(k.startswith("Temático:") for k in idx), str({k: v for k, v in idx.items() if k.startswith(("Nikkei", "KOSPI", "Taiwán", "Pequeñas", "Temático"))}))


def riesgo(pg, base):
    """Fase 1 de la hoja definitiva: Mercado › Riesgo (termómetro, señales con fuente, ciclo IA, historial) y franja en «Hoy»."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(base + "#/riesgo")
    try:
        pg.wait_for_selector(".rsk-gauge", timeout=30000)
    except Exception:  # noqa: BLE001
        check("riesgo: termómetro", False, "sin .rsk-gauge (¿falta data/risk.json?)")
        return
    t = pg.text_content("#view") or ""
    n = pg.locator("#view table.rsk-t tbody tr:not(.rsk-grp)").count()
    check("riesgo: termómetro, precisión y veredicto", all(x in t for x in ("Termómetro", "Precisión", "Examen")) and ("Validado" in t or "Sin ventaja demostrada" in t))
    check("riesgo: señales con fuente y peso", n >= 15 and "Fed" in t and "FRED" in t, f"{n} filas")
    check("riesgo: ciclo IA con fase", any(f in t for f in ("Expansión", "Euforia", "Digestión", "Contracción")) and "SEC" in t)
    check("riesgo: historial «¿Ha funcionado antes?»", "¿Ha funcionado antes?" in t and "de " in t)
    w = pg.evaluate("document.querySelector('.rsk-bot').scrollWidth <= document.querySelector('.rsk-bot').clientWidth + 2")
    check("riesgo: sin desbordes a 1440 px", w)
    nchips = pg.locator("[data-rskseg]").count()
    check("riesgo: selector con las bolsas principales", nchips >= 8, f"{nchips} bolsas")
    lect = pg.locator(".rsk-top .ui-lect p").count()
    conj = pg.text_content(".rsk-read") or ""
    check("riesgo: lectura del termómetro y lectura conjunta", lect == 3 and "Qué vigilar" in conj and "Qué cambiaría" in conj)
    alt = pg.evaluate("[...document.querySelectorAll('[data-rskseg]')].map(b => b.dataset.rskseg).find(k => !document.querySelector(`[data-rskseg='${k}']`).classList.contains('on'))")
    if alt:
        pg.click(f"[data-rskseg='{alt}']")
        pg.wait_for_timeout(600)
        h = pg.text_content(".rsk-top h3") or ""
        nm = pg.text_content(f"[data-rskseg='{alt}']") or ""
        check("riesgo: elegir otra bolsa cambia el detalle y la lectura", nm.strip() in h and nm.strip() in (pg.text_content(".rsk-read .ui-conj h3") or ""), h)
        pg.click(f"[data-rskseg='{alt}']")
        pg.wait_for_timeout(400)
    pg.goto(base + "#/hoy")
    pg.wait_for_timeout(2500)
    check("«Hoy»: franja de riesgo con las bolsas seguidas", pg.locator(".rsk-strip").count() == 1 and pg.locator(".rsk-strip .rsk-sm").count() >= 1)
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.goto(base + "#/riesgo")
    pg.wait_for_timeout(2000)
    check("riesgo: móvil sin desborde horizontal", pg.evaluate("document.documentElement.scrollWidth") <= 392)


def geopolitica(pg, base):
    """Fase 2: Contexto › Geopolítica (pistas, GPR, países, sensibilidad, eventos, rearme, lectura conjunta)."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(base + "#/geopolitica")
    try:
        pg.wait_for_selector(".geo-kpis", timeout=30000)
    except Exception:  # noqa: BLE001
        check("geopolítica: página", False, "sin .geo-kpis (¿falta data/geo.json?)")
        return
    t = pg.text_content("#view") or ""
    check("geopolítica: pistas, GPR y países", "Pistas activas" in t and "Por país" in t and pg.locator(".geo-k").count() >= 3)
    check("geopolítica: sensibilidad, eventos y rearme con fuente", all(x in t for x in ("Sensibilidad", "Escaladas", "Rearme europeo", "Agencia Europea de Defensa")))
    check("geopolítica: lectura conjunta", "Lectura conjunta" in t and "Qué vigilar" in t)
    check("geopolítica: en el área Contexto", "Geopolítica" in (pg.text_content(".tabsbar") or ""))
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.wait_for_timeout(800)
    check("geopolítica: móvil sin desborde horizontal", pg.evaluate("document.documentElement.scrollWidth") <= 392)


def escenarios(pg, base):
    """Fase 3: Cartera › Escenarios (propuesta, escenarios, mapa de calor, divisas) y Ficha › Riesgo y escenarios."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    uni = pg.evaluate("fetch('data/universe.json').then(r => r.json()).then(u => u.filas.slice(0, 6).map(r => r.sym))")
    pg.goto(base + "#/hoy")
    pg.evaluate("(s) => localStorage.setItem('seguimiento', JSON.stringify(s))", uni)
    pg.goto(base + "#/escenarios")
    pg.reload()
    try:
        pg.wait_for_selector(".st-hm", timeout=40000)
    except Exception:  # noqa: BLE001
        check("escenarios: página", False, "sin mapa de calor (¿falta data/stress.json?)")
        return
    pg.wait_for_timeout(2500)
    t = pg.text_content("#view") or ""
    check("escenarios: indicadores, propuesta y alternativas", all(x in t for x in ("Peor escenario", "CVaR", "Propuesta", "Por qué", "Invalida si", "Alternativas evaluadas")))
    check("escenarios: cartera frente al índice, peor caso y mapa", "Quién explica el peor caso" in t and pg.locator(".st-hm tbody tr").count() >= 4)
    check("escenarios: riesgo de divisas con coste de cubrir", "Riesgo de divisas" in t and "Cubrir / año" in t)
    check("escenarios: lectura conjunta", "Lectura conjunta" in t)
    check("escenarios: en el área Cartera", "Escenarios" in (pg.text_content(".tabsbar") or ""))
    pg.goto(base + f"#/empresa/{uni[0]}/riesgo")
    pg.wait_for_timeout(3500)
    t = pg.text_content("#view") or ""
    check("ficha: stress test con base y fiabilidad y estrés del balance", all(x in t for x in ("Stress test", "Base del cálculo", "Fiabilidad", "Estrés del balance")))
    check("ficha: probabilidad de acierto con examen, factores y fiabilidad", all(x in t for x in ("Probabilidad de acierto", "Tasa base", "Aportación de cada factor", "previsiones parecidas")) and ("Validada en el examen" in t or "Sin ventaja demostrada" in t))
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.goto(base + "#/escenarios")
    pg.wait_for_timeout(3000)
    check("escenarios: móvil sin desborde horizontal", pg.evaluate("document.documentElement.scrollWidth") <= 392)


def r1(pg, base):
    """R1: textos plegables, una sola columna de contexto en «Hoy», cabecera de estado del riesgo y noticias desplegables."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(base + "#/geopolitica")
    pg.wait_for_timeout(1500)
    pg.evaluate("""() => document.querySelector('#level button[data-mode="c"]')?.click()""")
    pg.wait_for_timeout(3000)
    n = pg.locator("#view details.ui-det").count()
    opened = pg.locator("#view details.ui-det[open]").count()
    check("R1: explicaciones plegadas en Compacto", n >= 3 and opened == 0, f"{n} desplegables, {opened} abiertos")
    check("R1: cabecera «Estado del riesgo» en Geopolítica", pg.locator("#view .ui-estado").count() == 1)
    syms = pg.evaluate("fetch('data/universe.json').then(r => r.json()).then(u => u.filas.slice(0, 4).map(r => r.sym))")
    pg.evaluate("(s) => { if (!JSON.parse(localStorage.getItem('seguimiento') || '[]').length) localStorage.setItem('seguimiento', JSON.stringify(s)); }", syms)
    pg.goto(base + "#/hoy")
    pg.reload()
    pg.wait_for_timeout(3500)
    th = " ".join(pg.locator(".hy-t th").all_text_contents())
    check("R1: «Hoy» con una sola columna de contexto", "Contexto" in th and "Estrés" not in th.replace("estrés", ""), th[:120])
    sym = pg.evaluate("fetch('data/universe.json').then(r => r.json()).then(u => u.filas[0].sym)")
    pg.goto(base + f"#/empresa/{sym}/movimientos")
    pg.wait_for_timeout(3500)
    nd = pg.locator("details.nw-d").count()
    check("R1: noticias desplegables en la ficha", nd >= 1 or "Sin noticias" in (pg.text_content("#view") or ""), f"{nd} noticias")


def r3(pg, base):
    """R3: horizonte largo con escenarios, apuesta razonada (rearme en la cesta de defensa) y PDF del Informe."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    defensa = pg.evaluate("""Promise.all([fetch('data/geo.json').then(r => r.json()), fetch('data/universe.json').then(r => r.json())])
        .then(([g, u]) => { const s = new Set(u.filas.map(x => x.sym)); return ((g.defensa || {}).valores || []).find(x => s.has(x)) || null; })""")
    check("R3: hay un valor de la cesta de defensa en el universo", bool(defensa), str(defensa))
    banco = pg.evaluate("window.SCR && fetch('data/universe.json').then(r => r.json()).then(u => (u.filas.find(x => /bank/i.test(x.industria || '')) || {}).sym || null)")
    for sym in [x for x in ("AAPL", banco, defensa) if x]:
        pg.goto(base + "#/empresa/" + sym)
        pg.wait_for_selector("#view .inf", timeout=60000)
        pg.wait_for_timeout(4000)
        t = pg.text_content("#view") or ""
        i = t.find("Largo · 3-5 años")
        largo = t[i:i + 400] if i >= 0 else ""
        ok = ("Escenarios, no probabilidad" in largo and "Base" in largo) or "No aplica" in largo or "Sin flujo positivo" in largo
        check(f"R3 {sym}: horizonte largo con escenarios o motivo", ok and "R3" not in largo[:40], largo[:120])
        check(f"R3 {sym}: apuesta razonada y botón de PDF", pg.locator("[data-apuesta]").count() == 1 and pg.locator("[data-infpdf]").count() == 1)
        if sym == banco:
            check(f"R3 {sym}: el método no se aplica a bancos", "No aplica a bancos" in largo)
        if sym == defensa:
            check(f"R3 {sym}: caso del rearme europeo con fuentes", "Rearme europeo" in t and "OTAN" in t)
            pg.click("[data-apuesta]")
            pg.wait_for_timeout(1200)
            d = pg.text_content("#drawer") or ""
            check("R3: la apuesta se abre en el Diario con su tesis", "Registrar apuesta razonada" in d and "Rearme europeo" in d)
            pg.keyboard.press("Escape")
    pg.goto(base + "#/empresa/AAPL/cuentas")
    pg.wait_for_timeout(4000)
    check("R3: Cuentas usa los mismos escenarios", "Margen de caja" in (pg.text_content("#view") or ""))
    pg.goto(base + "#/empresa/AAPL")
    pg.wait_for_timeout(3000)
    pg.evaluate("document.body.classList.add('print-inf')")
    pg.emulate_media(media="print")
    w = pg.evaluate("document.querySelector('.inf').getBoundingClientRect().width")
    vis = pg.evaluate("getComputedStyle(document.querySelector('.inf-print')).display")
    pg.emulate_media(media="screen")
    pg.evaluate("document.body.classList.remove('print-inf')")
    check("R3: el Informe se imprime a todo el ancho y con cabecera", w > 600 and vis == "block", f"{w:.0f} px · {vis}")


def r2(pg, base):
    """R2: el Informe del valor es la portada de la ficha y reúne veredicto, horizontes, tesis, riesgo aplicado, catalizadores e invalidación."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    uni = pg.evaluate("fetch('data/universe.json').then(r => r.json()).then(u => u.filas.slice(0, 2).map(x => x.sym))")
    for sym in ["AAPL", "SAN.MC"] + uni[:1]:
        pg.goto(base + "#/empresa/" + sym)
        pg.wait_for_selector("#view .inf", timeout=60000)
        pg.wait_for_timeout(3500)
        t = pg.text_content("#view") or ""
        need = ("Corto · 3 meses", "Medio · 12 meses", "Largo · 3-5 años", "Tesis a favor", "Tesis en contra", "Riesgo aplicado a la acción", "Catalizadores", "Qué invalidaría la tesis", "Cómo se forma la etiqueta")
        check(f"R2 {sym}: Informe completo", all(x in t for x in need) and pg.evaluate("window.SCR.S.ficha.tab") == "informe", ", ".join(x for x in need if x not in t))
        v = pg.text_content("#view .inf-verd .ui-pill") or ""
        check(f"R2 {sym}: etiqueta por reglas", v.strip() in ("Favorable", "Vigilar", "Desfavorable"), v)
        check(f"R2 {sym}: catalizadores cargados", pg.locator("#fcat .skel").count() == 0)
    for old, new in (("resumen", "informe"), ("riesgo", "informe"), ("fund", "cuentas"), ("smartm", "movimientos"), ("resultados", "movimientos")):
        pg.goto(base + f"#/empresa/AAPL/{old}")
        pg.wait_for_timeout(1500)
        if pg.evaluate("window.SCR.S.ficha && window.SCR.S.ficha.tab") != new:
            check(f"R2: enlace antiguo /{old} → /{new}", False)
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.goto(base + "#/empresa/AAPL")
    pg.wait_for_timeout(3500)
    check("R2: Informe sin desborde a 390 px", pg.evaluate("document.documentElement.scrollWidth") <= 392)
    pg.set_viewport_size({"width": 1366, "height": 900})


def diseno3(pg, base):
    """Diseño A · entrega 3: Screener de una línea, «Hoy» en rejilla, rotación sectorial nueva y atajos."""
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(base + "#/hoy")
    pg.wait_for_timeout(3000)
    t = pg.text_content("#view") or ""
    check("«Hoy»: portada de síntesis (qué ha cambiado, avisos, tus valores, lectura del día) y tira de índices",
          pg.locator(".hy2 .hs").count() == 4 and all(x in t for x in ("Qué ha cambiado", "Avisos", "Tus valores", "Lectura del día")) and pg.locator(".ixs > div").count() >= 1,
          f"{pg.locator('.ixs > div').count()} índices")
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
        for fn in (fichas, navegacion, movil, fase2, tanda2, fase5, fase6, fase7, fase9, diseno1, diseno3, ranking, grafico, riesgo, geopolitica, escenarios, r1, r2, r3):
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
