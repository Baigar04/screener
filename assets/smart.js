/* Screener · Smart money y pestaña Personalidades. Datos: data/smart.json (Dataroma y PTR de la Cámara de Representantes). */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, fmtDate, store } = H;
const S = { d: null, err: null, loading: false, tab: store.get("sm_tab", "gestores"), q: "", mov: "todos", ctype: "todos", sort: { k: "n", d: -1 }, limit: 100 };
const SMART_TIP = "13F: se publican hasta 45 días después del cierre del trimestre. Congreso: hasta 45 días después de la operación, con importes en rangos.";

async function ensure() {
  if (S.d || S.loading) return;
  S.loading = true;
  try {
    const r = await fetch("data/smart.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status === 404 ? "Todavía no hay datos de smart money: la primera actualización aún no ha terminado." : "Error HTTP " + r.status);
    S.d = await r.json();
    S.byCode = Object.fromEntries((S.d.gestores || []).map((g) => [g.code, g]));
  } catch (e) { S.err = e.message; }
  S.loading = false;
  H.render();
  if (window.SCRSmart.onload) window.SCRSmart.onload();
}
const inUni = (sym) => (window.SCRUni ? window.SCRUni().some((r) => r.sym === sym) : false);
const symLink = (sym) => (inUni(sym) ? `<a href="#" data-sym="${esc(sym)}"><b>${esc(sym)}</b></a>` : `<b>${esc(sym)}</b>`);
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const actClass = (a) => (!a ? "" : /^(Add|Buy)/.test(a) ? "p" : /^(Reduce|Sell)/.test(a) ? "n" : "");
const actEs = (a) => (a || "").replace(/^Add/, "Aumenta").replace(/^Reduce/, "Reduce").replace(/^Buy/, "Compra nueva").replace(/^Sell/, "Vende");
function big(v) { if (v == null) return "—"; if (v >= 1e9) return nf(v / 1e9, 1) + " mil M $"; if (v >= 1e6) return nf(v / 1e6, 0) + " M $"; return nf(v, 0) + " $"; }

/* ---------- fechas del smart money: a qué fecha se refiere cada dato y con cuánto retraso se conoce ---------- */
function qEnd(tri) {   // «Q3 2026» → 2026-09-30
  const m = /Q([1-4])\s+(\d{4})/.exec(tri || ""); if (!m) return null;
  return `${m[2]}-${["03-31", "06-30", "09-30", "12-31"][+m[1] - 1]}`;
}
function lagBadge(a, b, warnDays) {
  if (!a || !b) return "—";
  const d = days(a, b);
  return `<span class="${d > warnDays ? "stale-txt" : ""}" data-tip="Días entre la fecha del dato y su publicación">${d} d</span>`;
}
function ageNote(a) {   // antigüedad del dato hoy
  if (!a) return "";
  const d = days(a, new Date().toISOString().slice(0, 10));
  return d > 135 ? `<span class="stale-txt" data-tip="La cartera es de hace más de un trimestre: puede haber cambiado mucho"> · hace ${d} d</span>` : `<span class="hint"> · hace ${d} d</span>`;
}

/* ---------- directivos (formulario 4) ---------- */
const I = { d: null, err: null, loading: false, tipo: "compras", racimo: false };
async function ensureIns() {
  if (I.d || I.loading) return;
  I.loading = true;
  try { const r = await fetch("data/insiders.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw new Error(r.status === 404 ? "Todavía no hay datos de directivos: llegan con la próxima actualización." : "HTTP " + r.status); I.d = await r.json(); }
  catch (e) { I.err = e.message; }
  I.loading = false; H.render();
}
const usd = (v) => (v == null ? "—" : v >= 1e6 ? nf(v / 1e6, 1) + " M $" : v >= 1e3 ? nf(v / 1e3, 0) + " mil $" : nf(v, 0) + " $");
function insTab(q) {
  if (!I.d) { ensureIns(); return I.err ? `<div class="err-box">${esc(I.err)}</div>` : '<div class="skel" style="height:200px"></div>'; }
  const D = I.d, P = D.por_valor || {};
  const top = Object.entries(P).filter(([, v]) => v.n_compras && (!I.racimo || v.racimo)).sort((a, b) => b[1].compras - a[1].compras).slice(0, 12);
  let h = `${[["compras", "Compras"], ["ventas", "Ventas"], ["todas", "Todas"]].map(([k, t]) => `<button class="chip ${I.tipo === k ? "on" : ""}" data-instipo="${k}">${t}</button>`).join("")}
    <button class="chip ${I.racimo ? "on" : ""}" data-insrac="1" data-tip="3 o más directivos distintos comprando en 30 días">Solo compras en racimo</button></div>
    <div class="method" style="margin:0 0 8px">Formulario 4 de la SEC: solo operaciones en mercado abierto (compras P y ventas S) de valores de EE. UU. del universo.
      Ventana: ${D.ventana_dias} días${D.pendientes ? ` · <span class="stale-txt">faltan ${D.pendientes} días por cargar (se completan en las próximas actualizaciones)</span>` : ""}. Los directivos tienen 2 días hábiles para declarar.</div>`;
  if (top.length && I.tipo !== "ventas") h += `<div class="box"><b>Más compras de directivos · ${D.ventana_dias === 90 ? "90" : D.ventana_dias} días</b><div class="chg-tags">${top.map(([s, v]) => `<button class="chip" data-smsym="${esc(s)}" data-sym="${esc(s)}">${esc(s)} · ${usd(v.compras)} · ${v.compradores} ${v.compradores === 1 ? "directivo" : "directivos"}${v.racimo ? " · racimo" : ""}</button>`).join("")}</div></div>`;
  const rows = (D.ops || []).filter((o) => (I.tipo === "todas" || (I.tipo === "compras" ? o.codigo === "P" : o.codigo === "S")) && (!I.racimo || P[o.sym]?.racimo) && (!q || o.sym.toLowerCase() === q || o.nombre.toLowerCase().includes(q)));
  h += `<div class="tbl-wrap"><table><thead><tr><th>Operación</th><th>Presentada</th><th>Desfase</th><th style="text-align:left">Valor</th><th style="text-align:left">Directivo</th><th style="text-align:left">Cargo</th><th style="text-align:left">Tipo</th><th>Acciones</th><th>Precio</th><th>Importe</th></tr></thead><tbody>
    ${rows.slice(0, S.limit).map((o) => `<tr data-smsym="${esc(o.sym)}"><td>${fmtDate(o.fecha_op)}</td><td>${fmtDate(o.fecha_pres)}</td><td class="num">${lagBadge(o.fecha_op, o.fecha_pres, 4)}</td>
      <td style="text-align:left">${symLink(o.sym)}</td><td style="text-align:left">${esc(o.nombre)}</td><td style="text-align:left" class="hint">${esc(o.cargo || "—")}</td>
      <td style="text-align:left" class="chg ${o.codigo === "P" ? "p" : "n"}">${o.codigo === "P" ? "Compra" : "Venta"}${o.plan ? ' <span class="hint" data-tip="Venta programada de antemano (plan 10b5-1): dice poco sobre la opinión del directivo">plan</span>' : ""}</td>
      <td class="num">${nf(o.acciones, 0)}</td><td class="num">${o.precio == null ? "—" : nf(o.precio, 2)}</td><td class="num">${usd(o.importe)}</td></tr>`).join("") || '<tr><td colspan="10">Sin operaciones con estos filtros.</td></tr>'}</tbody></table></div>`;
  if (rows.length > S.limit) h += `<div style="text-align:center;margin-top:10px"><button class="icon-btn" data-smmore="1">Mostrar 100 más</button></div>`;
  return h + `<div class="method">Fuente: ${esc(D.fuente)}. Las compras con dinero propio, sobre todo si coinciden varios directivos, son la parte más informativa; las ventas tienen muchos motivos (impuestos, diversificación).</div>`;
}
function insBlock(sym) {
  if (!I.d) { ensureIns(); return ""; }
  const v = I.d.por_valor?.[sym], ops = (I.d.ops || []).filter((o) => o.sym === sym).slice(0, 15);
  if (!ops.length) return "." in sym ? "" : `<h2 class="sec">Directivos · formulario 4</h2><div class="hint">Sin compras ni ventas en mercado abierto en los últimos ${I.d.ventana_dias} días${I.d.pendientes ? " cargados" : ""}.</div>`;
  return `<h2 class="sec">Directivos · formulario 4 ${H.evid("h")} <span class="hint">${v ? `${I.d.ventana_dias} días: compras ${usd(v.compras)} (${v.compradores} directivos)${v.racimo ? " · compra en racimo" : ""} · ventas ${usd(v.ventas)}${v.ventas_plan ? ` (${usd(v.ventas_plan)} programadas)` : ""}` : ""}</span></h2>
    <div class="tbl-wrap"><table><thead><tr><th>Operación</th><th>Presentada</th><th style="text-align:left">Directivo</th><th style="text-align:left">Tipo</th><th>Acciones</th><th>Precio</th><th>Importe</th></tr></thead><tbody>
    ${ops.map((o) => `<tr><td>${fmtDate(o.fecha_op)}</td><td>${fmtDate(o.fecha_pres)}</td><td style="text-align:left">${esc(o.nombre)} <span class="hint">${esc(o.cargo || "")}</span></td>
      <td style="text-align:left" class="chg ${o.codigo === "P" ? "p" : "n"}">${o.codigo === "P" ? "Compra" : "Venta"}${o.plan ? " (plan)" : ""}</td><td class="num">${nf(o.acciones, 0)}</td><td class="num">${o.precio == null ? "—" : nf(o.precio, 2)}</td><td class="num">${usd(o.importe)}</td></tr>`).join("")}</tbody></table></div>`;
}

function stateBox() {
  if (S.err) return `<div class="err-box"><b>No se pudieron cargar los datos de smart money.</b> ${esc(S.err)}</div>`;
  return `<div class="skel-wrap"><div class="skel" style="height:34px;width:50%"></div>${'<div class="skel" style="height:22px"></div>'.repeat(8)}</div>`;
}

/* ---------- sección Smart money ---------- */
function render() {
  if (!S.d) { ensure(); return stateBox(); }
  const D = S.d, lv = H.S.level;
  const tabs = [["gestores", `Superinversores (${D.gestores.length})`], ["consenso", "Consenso"], ["mov", "Movimientos del trimestre"], ["congreso", `Congreso de EE. UU. (${D.congreso.length})`], ["directivos", `Directivos${I.d ? ` (${(I.d.ops || []).length})` : ""}`]];
  let h = `<div class="sm-head"><div class="hint">${H.evid("h")} ${esc(SMART_TIP)} Datos: ${new Date(D.generado).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
    ${D.n_errores ? ` · <span class="stale-txt">${D.n_errores} aviso(s) de fuente</span>` : ""}</div></div>
    <div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" class="${S.tab === k ? "on" : ""}" data-smtab="${k}">${t}</button>`).join("")}</div>
    <div class="bar"><div class="search-in"><svg viewBox="0 0 24 24"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"/></svg>
      <input id="smq" type="search" value="${esc(S.q)}" placeholder="${S.tab === "congreso" ? "Filtrar por congresista o ticker" : "Filtrar por gestor, ticker o empresa"}" aria-label="Filtrar"></div>`;
  const q = S.q.trim().toLowerCase();
  if (S.tab === "directivos") {
    h += insTab(q);
  } else if (S.tab === "gestores") {
    const rows = D.gestores.filter((g) => !q || g.nombre.toLowerCase().includes(q) || g.pos.some((p) => p[0].toLowerCase() === q));
    h += `</div>${H.S.explain ? `<div class="panel" style="margin-bottom:10px">Carteras declaradas por gestores con historial reconocido (Buffett, Pabrai, Ackman…). Pulsa uno para ver todo lo que tiene.</div>` : ""}
      <div class="tbl-wrap"><table><thead><tr><th>Gestor</th><th data-tip="Fecha a la que se refiere la cartera (cierre del trimestre del 13F)">Cartera a</th><th data-tip="Cuándo la publicó Dataroma a partir del 13F">Publicada</th><th data-tip="Días entre el cierre del trimestre y la publicación">Desfase</th><th>Valores</th><th style="text-align:left">Mayores posiciones</th></tr></thead><tbody>
      ${rows.map((g) => `<tr data-mgr="${esc(g.code)}"><td>${esc(g.nombre)}</td><td>${qEnd(g.trimestre) ? fmtDate(qEnd(g.trimestre)) + ageNote(qEnd(g.trimestre)) : esc(g.trimestre || "—")}</td><td>${g.actualizado_iso ? fmtDate(g.actualizado_iso) : esc(g.actualizado || "—")}</td><td class="num">${lagBadge(qEnd(g.trimestre), g.actualizado_iso, 46)}</td><td class="num">${g.n}</td>
        <td style="text-align:left"><div class="pos-chips">${g.pos.slice(0, 4).map((p) => `<span class="pos-chip"><b>${esc(p[0])}</b><span>${nf(p[2], 1)} %</span><i style="width:${Math.min(100, (p[2] || 0) * 3)}%"></i></span>`).join("")}</div></td></tr>`).join("")}</tbody></table></div>`;
  } else if (S.tab === "consenso") {
    const rows = D.consenso.filter((c) => !q || c[0].toLowerCase().includes(q) || (c[1] || "").toLowerCase().includes(q));
    h += `</div><div class="tbl-wrap"><table><thead><tr><th>Valor</th><th data-tip="Número de superinversores que lo tienen en cartera">Gestores</th><th data-tip="Peso medio en las carteras que lo tienen">Peso medio</th>
      <th data-tip="Gestores que lo compraron o aumentaron el último trimestre">Compras</th><th data-tip="Gestores que lo redujeron el último trimestre">Ventas</th></tr></thead><tbody>
      ${rows.slice(0, S.limit).map((c) => `<tr data-smsym="${esc(c[0])}"><td>${symLink(c[0])} <span class="nm">${esc(c[1] || "")}</span></td><td class="num">${c[2]}</td><td class="num">${nf(c[3], 2)} %</td>
        <td class="num chg p">${c[4] || "—"}</td><td class="num chg n">${c[5] || "—"}</td></tr>`).join("")}</tbody></table></div>`;
  } else if (S.tab === "mov") {
    const rows = D.actividad.filter((a) => (S.mov === "todos" || a.tipo === S.mov) && (!q || a.sym.toLowerCase().includes(q) || a.firma.toLowerCase().includes(q) || a.nombre.toLowerCase().includes(q)));
    h += `${[["todos", "Todos"], ["buy", "Compras"], ["sell", "Ventas"]].map(([k, t]) => `<button class="chip ${S.mov === k ? "on" : ""}" data-smmov="${k}">${t}</button>`).join("")}</div>
      <div class="tbl-wrap"><table><thead><tr><th>Gestor</th><th>Periodo</th><th style="text-align:left">Valor</th><th style="text-align:left">Movimiento</th><th data-tip="Cuánto cambia el peso de esa posición en la cartera del gestor">Cambio en cartera</th></tr></thead><tbody>
      ${rows.slice(0, S.limit).map((a) => `<tr data-smsym="${esc(a.sym)}"><td>${esc(a.firma)}</td><td>${esc(a.periodo || "—")}</td><td style="text-align:left">${symLink(a.sym)} <span class="nm">${esc(a.nombre)}</span></td>
        <td style="text-align:left" class="chg ${a.tipo === "buy" ? "p" : "n"}">${esc(actEs(a.accion))}</td><td class="num">${nf(a.cambio, 2)} %</td></tr>`).join("")}</tbody></table></div>`;
  } else {
    const rows = D.congreso.filter((c) => (S.ctype === "todos" || (S.ctype === "compra" ? c.tipo === "Compra" : c.tipo.startsWith("Venta"))) && (!q || c.nombre.toLowerCase().includes(q) || c.sym.toLowerCase().includes(q)));
    const people = [...new Set(D.congreso.map((c) => c.nombre))];
    h += `${[["todos", "Todas"], ["compra", "Compras"], ["venta", "Ventas"]].map(([k, t]) => `<button class="chip ${S.ctype === k ? "on" : ""}" data-smct="${k}">${t}</button>`).join("")}
      ${people.some((p) => /Pelosi/.test(p)) ? `<button class="chip ${q === "pelosi" ? "on" : ""}" data-smq="pelosi">Nancy Pelosi</button>` : ""}</div>
      <div class="method" style="margin:0 0 8px">Últimos 12 meses de la Cámara de Representantes · ${people.length} congresistas · extraído automáticamente de los PDF oficiales: comprueba cada operación en su documento.</div>
      <div class="tbl-wrap"><table><thead><tr><th>Operación</th><th>Declarada</th><th data-tip="Días entre la operación y su declaración pública">Desfase</th><th style="text-align:left">Congresista</th><th style="text-align:left">Valor</th><th style="text-align:left">Tipo</th><th>Importe</th><th>PDF</th></tr></thead><tbody>
      ${rows.slice(0, S.limit).map((c) => `<tr data-smsym="${esc(c.sym)}"><td>${fmtDate(c.fecha_op)}${c.dudosa ? ' <span class="stale-txt" data-tip="La fecha de operación es posterior a la de declaración: error en el documento original">⚠</span>' : ""}</td><td>${fmtDate(c.fecha_decl)}</td><td class="num">${c.dudosa ? "—" : days(c.fecha_op, c.fecha_decl) + " d"}</td>
        <td style="text-align:left">${esc(c.nombre)} <span class="hint">${esc(c.distrito || "")}</span></td><td style="text-align:left">${symLink(c.sym)}${c.clase === "Opción" ? ' <span class="hint">opción</span>' : ""}</td>
        <td style="text-align:left" class="chg ${c.tipo === "Compra" ? "p" : c.tipo.startsWith("Venta") ? "n" : ""}">${esc(c.tipo)}</td><td class="num">${esc(c.importe || "—")}</td>
        <td><a href="${esc(c.url)}" target="_blank" rel="noopener">ver</a></td></tr>`).join("")}</tbody></table></div>`;
  }
  const total = { consenso: D.consenso.length, mov: D.actividad.length, congreso: D.congreso.length }[S.tab];   // directivos: lo pagina insTab
  if (total > S.limit) h += `<div style="text-align:center;margin-top:10px"><button class="icon-btn" data-smmore="1">Mostrar 100 más</button></div>`;
  h += `<div class="method">Fuentes: ${D.fuentes.map(esc).join(" · ")}. ${esc(D.notas)}</div>`;
  return h;
}

function mgrDrawer(code) {
  const g = S.byCode[code]; if (!g) return;
  H.openDrawer(`<h3>${esc(g.nombre)}</h3><div class="reg">${esc(g.trimestre || "")} · actualizado ${esc(g.actualizado || "—")} · ${g.n} valores · fuente: <a href="https://www.dataroma.com/m/holdings.php?m=${encodeURIComponent(code)}" target="_blank" rel="noopener">Dataroma</a></div>
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Valor</th><th>% cartera</th><th style="text-align:left">Último trimestre</th><th>Valor declarado</th></tr></thead><tbody>
    ${g.pos.map((p) => `<tr data-smsym="${esc(p[0])}"><td>${symLink(p[0])} <span class="nm">${esc(p[1] || "")}</span></td><td class="num">${nf(p[2], 2)} %</td><td style="text-align:left" class="chg ${actClass(p[3])}">${esc(actEs(p[3]) || "Sin cambios")}</td><td class="num">${big(p[5])}</td></tr>`).join("")}
    </tbody></table></div><div class="method">${esc(SMART_TIP)}</div>`);
}

/* ---------- pestaña Personalidades de la ficha ---------- */
function persTab(sym) {
  if (!S.d) { ensure(); return S.err ? stateBox() : `<div class="skel" style="height:200px"></div>`; }
  const v = S.d.por_valor[sym], lv = H.S.level;
  const f = v?.f || [], c = v?.c || [];
  if (!f.length && !c.length) return `<div class="soon-box"><h3>Sin personalidades</h3>Ningún superinversor de Dataroma declara ${esc(sym)} en su último 13F y ningún congresista de la Cámara lo ha operado en los últimos 12 meses.
    ${sym.includes(".") ? "<br>Los 13F solo recogen acciones que cotizan en EE. UU.; los valores europeos solo aparecen si el gestor tiene su ADR." : ""}</div>`;
  const buys = f.filter((x) => /^(Add|Buy)/.test(x[2] || "")).length, sells = f.filter((x) => /^Reduce/.test(x[2] || "")).length;
  let h = `<div class="kv-grid">${[["Superinversores con el valor", f.length], ["Compraron o aumentaron", buys], ["Redujeron", sells], ["Operaciones en el Congreso (12 m)", c.length]]
    .map(([t, n]) => `<div class="kvc"><span>${t}</span><b class="num">${n}</b></div>`).join("")}</div>`;
  if (f.length) h += `<h2 class="sec">Superinversores <span class="hint">Último 13F declarado de cada gestor</span></h2><div class="tbl-wrap"><table><thead><tr><th>Gestor</th><th>% de su cartera</th><th style="text-align:left">Último trimestre</th><th>Valor declarado</th><th data-tip="Fecha a la que se refiere la cartera">Cartera a</th><th data-tip="Cuándo se publicó">Publicada</th></tr></thead><tbody>
    ${f.map(([code, pct, a, val]) => { const g = S.byCode[code] || {}; return `<tr data-mgr="${esc(code)}"><td>${esc(g.nombre || code)}</td><td class="num">${nf(pct, 2)} %</td><td style="text-align:left" class="chg ${actClass(a)}">${esc(actEs(a) || "Sin cambios")}</td><td class="num">${big(val)}</td><td>${qEnd(g.trimestre) ? fmtDate(qEnd(g.trimestre)) + ageNote(qEnd(g.trimestre)) : esc(g.trimestre || "—")}</td><td>${g.actualizado_iso ? fmtDate(g.actualizado_iso) : esc(g.actualizado || "—")}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  if (c.length) h += `<h2 class="sec">Congreso de EE. UU. <span class="hint">Operaciones declaradas en los últimos 12 meses</span></h2><div class="tbl-wrap"><table><thead><tr><th style="text-align:left">Congresista</th><th style="text-align:left">Tipo</th><th>Operación</th><th>Declarada</th><th>Desfase</th><th>Importe</th></tr></thead><tbody>
    ${c.map(([n, t, fo, fd, imp, cl]) => `<tr><td style="text-align:left">${esc(n)}</td><td style="text-align:left" class="chg ${t === "Compra" ? "p" : t.startsWith("Venta") ? "n" : ""}">${esc(t)}${cl === "Opción" ? " (opción)" : ""}</td><td>${fmtDate(fo)}</td><td>${fmtDate(fd)}</td><td class="num">${days(fo, fd)} d</td><td class="num">${esc(imp || "—")}</td></tr>`).join("")}
    </tbody></table></div>`;
  h += insBlock(sym);
  h += `<div class="method">${esc(SMART_TIP)} ${H.S.explain ? "Que un gestor famoso tenga un valor no significa que siga siendo buena compra hoy. " : ""}Las operaciones del Congreso se extraen automáticamente del PDF oficial; el enlace a cada documento está en Smart money → Congreso.</div>`;
  return h;
}

/* ---------- eventos ---------- */
function onClick(t) {
  let b;
  if ((b = t.closest("[data-smtab]"))) { S.tab = b.dataset.smtab; S.limit = 100; store.set("sm_tab", S.tab); H.render(); return true; }
  if ((b = t.closest("[data-smmov]"))) { S.mov = b.dataset.smmov; H.render(); return true; }
  if ((b = t.closest("[data-instipo]"))) { I.tipo = b.dataset.instipo; S.limit = 100; H.render(); return true; }
  if (t.closest("[data-insrac]")) { I.racimo = !I.racimo; H.render(); return true; }
  if ((b = t.closest("[data-smct]"))) { S.ctype = b.dataset.smct; H.render(); return true; }
  if ((b = t.closest("[data-smq]"))) { S.q = S.q === b.dataset.smq ? "" : b.dataset.smq; H.render(); return true; }
  if (t.closest("[data-smmore]")) { S.limit += 100; H.render(); return true; }
  if (t.closest("a[data-sym]")) return false; // la ficha la abre equities.js
  if ((b = t.closest("[data-mgr]"))) { mgrDrawer(b.dataset.mgr); return true; }
  if ((b = t.closest("[data-smsym]")) && inUni(b.dataset.smsym)) return false;
  return false;
}
let qt = null;
document.addEventListener("input", (e) => {
  if (e.target.id !== "smq") return;
  clearTimeout(qt);
  qt = setTimeout(() => { S.q = e.target.value; S.limit = 100; const p = e.target.selectionStart; H.render(); const n = document.getElementById("smq"); if (n) { n.focus(); n.setSelectionRange(p, p); } }, 200);
});

window.SCRSmart = { ensure, persTab, data: () => S.d, ins: () => I.d, ensureIns, onload: null };
H.modules.smart = render;
H.handlers.unshift(onClick);
})();
