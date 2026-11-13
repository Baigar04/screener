/* Screener · «Hoy»: lo que ha cambiado y lo que viene, en una sola pantalla, y copia de seguridad de tus datos. */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate, store } = H;
const T = { val: undefined, ins: undefined, loading: false };

async function ensure() {
  if (T.loading || T.val !== undefined) return;
  T.loading = true;
  const get = async (f) => { try { const r = await fetch(`data/${f}?t=${Date.now()}`, { cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; } };
  [T.val, T.ins] = await Promise.all([get("validacion.json"), get("insiders.json")]);
  T.loading = false;
  if (H.S.view === "hoy") H.render();
}
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const link = (s, extra = "") => `<button class="link-btn" data-sym="${esc(s)}"><b>${esc(s)}</b></button>${extra}`;
const chg = (v, d = 1) => (v == null ? "—" : `<span class="chg ${v > 0 ? "p" : v < 0 ? "n" : "z"}">${sgn(v, d)} %</span>`);

function dataStatus() {
  const D = H.S.data, V = T.val;
  const items = [];
  if (D?.generado) {
    const hrs = (Date.now() - Date.parse(D.generado)) / 36e5;
    items.push(`<span class="${hrs > 40 ? "stale-txt" : ""}">Datos del ${new Date(D.generado).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>`);
  }
  if (V) {
    const bad = Object.entries(V.ficheros || {}).filter(([, x]) => x.estado === "no válido");
    items.push(bad.length ? `<span class="stale-txt" data-tip="${esc(bad.map(([k, x]) => `${k}: ${x.motivo}`).join(" · "))}">${bad.length} fichero(s) no pasaron la validación: se muestra su última versión buena</span>` : "validación correcta");
  }
  if (D?.errores?.length) items.push(`<span class="stale-txt">${D.errores.length} fuente(s) macro con error</span>`);
  return `<div class="hoy-status">${items.join(" · ")}</div>`;
}

function market() {
  const D = H.S.data, A = H.S.amp?.regiones || {};
  const k = (id) => { const s = D?.series?.[id]; return s && s.estado === "ok" ? s : null; };
  const kp = [];
  const R = D?.regimen;
  if (R?.estado === "ok") kp.push(`<div><span>Régimen EE. UU. ${H.evid("h")}</span><b>${esc(R.dominante)}</b><small>peso ${R.probabilidades[R.dominante]} %</small></div>`);
  for (const [reg, a] of Object.entries(A)) kp.push(`<div><span>Amplitud ${esc(reg)}</span><b class="num">${nf(a.sobre_sma50, 0)} %</b><small>sobre su media de 50 · ${a.avances}↑ ${a.descensos}↓</small></div>`);
  for (const id of ["vix", "us10y", "hy_oas"]) { const s = k(id); if (s) kp.push(`<div><span>${esc(s.nombre)}</span><b class="num">${nf(s.valor)}<small> ${esc(s.unidad)}</small></b><small class="num">${sgn(s.cambio_1m)} en 1 mes</small></div>`); }
  const L = k("liq_neta"); if (L) kp.push(`<div><span>Liquidez neta Fed</span><b class="num">${nf(L.valor / 1000, 2)} bill. $</b><small class="num">${sgn(L.cambio_3m, 0)} mm $ en 3 meses</small></div>`);
  return kp.length ? `<div class="amp-kpis hoy-kpis">${kp.join("")}</div>` : `<div class="hint">Sin datos de mercado todavía.</div>`;
}

function watchlist(uni, Q) {
  const w = Q.watch();
  if (!w.length) return `<div class="hint">No sigues ningún valor. Márcalos con ★ en el screener o en su ficha y aquí verás cada día qué ha cambiado.</div>`;
  const rows = w.map((s) => uni.find((r) => r.sym === s)).filter(Boolean);
  return `<div class="lab-tw"><table><thead><tr><th>Valor</th><th>Día</th><th>Nota</th><th>Cambio nota</th><th>Técnico</th><th>Resultados</th></tr></thead><tbody>
    ${rows.map((r) => { const c = Q.changeOf(r.sym); const soon = r.resultados && r.resultados >= today() && r.resultados <= addDays(today(), 14);
      return `<tr><td>${link(r.sym)} <span class="hint">${esc((r.nombre || "").slice(0, 26))}</span></td><td class="num">${chg(r.r1d, 2)}</td><td class="num">${Q.scoreBadge(r.score)}</td>
        <td class="num">${c?.d ? `<span class="chg ${c.d > 0 ? "p" : "n"}">${sgn(c.d, 0)}</span>` : "—"}</td>
        <td>${esc(r.veredicto || "—")}${c && c.t0 && c.t1 && c.t0 !== c.t1 ? ` <span class="hint">(antes ${esc(c.t0)})</span>` : ""}</td>
        <td>${r.resultados ? `<span class="${soon ? "stale-txt" : ""}">${fmtDate(r.resultados)}</span>` : "—"}</td></tr>`; }).join("")}</tbody></table></div>`;
}

function movers(uni, Q) {
  if (!Q.sc()?.anterior) return `<div class="hint">Disponible desde la segunda actualización con registro de la sesión anterior.</div>`;
  const all = uni.map((r) => ({ r, c: Q.changeOf(r.sym) })).filter((x) => x.c?.d);
  const pick = (xs) => xs.map(({ r, c }) => `<li>${link(r.sym)} ${c.n0} → ${c.n1} <span class="chg ${c.d > 0 ? "p" : "n"}">${sgn(c.d, 0)}</span> <span class="hint">${esc(c.fx.slice(0, 1).map((x) => `${x.t} ${sgn(x.d, 0)}`).join("") || (c.t0 !== c.t1 ? "técnico " + (c.t1 || "") : ""))}</span></li>`).join("");
  const up = all.filter((x) => x.c.d > 0).sort((a, b) => b.c.d - a.c.d).slice(0, 5), dn = all.filter((x) => x.c.d < 0).sort((a, b) => a.c.d - b.c.d).slice(0, 5);
  return `<div class="f-grid"><div><div class="sub">Suben</div><ul class="hoy-list">${pick(up) || "<li class='hint'>Ninguno</li>"}</ul></div><div><div class="sub">Bajan</div><ul class="hoy-list">${pick(dn) || "<li class='hint'>Ninguno</li>"}</ul></div></div>
    <div class="method">Con tus pesos, frente a la sesión del ${fmtDate(Q.sc().anterior.fecha)}. Lista completa en Screener → «Qué ha cambiado».</div>`;
}

function earnings(uni, Q) {
  const w = new Set(Q.watch());
  const xs = uni.filter((r) => r.resultados && r.resultados >= today() && r.resultados <= addDays(today(), 7))
    .sort((a, b) => (w.has(b.sym) - w.has(a.sym)) || a.resultados.localeCompare(b.resultados) || (b.mcap_usd || 0) - (a.mcap_usd || 0)).slice(0, 14);
  return xs.length ? `<ul class="hoy-list cols">${xs.map((r) => `<li>${fmtDate(r.resultados)} · ${link(r.sym)}${w.has(r.sym) ? " ★" : ""} <span class="hint">${esc((r.nombre || "").slice(0, 22))}</span></li>`).join("")}</ul>`
    : `<div class="hint">Ningún resultado del universo en los próximos 7 días.</div>`;
}

function insiders() {
  const I = T.ins;
  if (!I) return `<div class="hint">${T.loading ? "Cargando…" : "Sin datos de directivos todavía."}</div>`;
  const lim = addDays(today(), -10);
  const buys = (I.ops || []).filter((o) => o.codigo === "P" && o.fecha_pres >= lim && (o.importe || 0) >= 50000);
  const by = {};
  for (const o of buys) { const x = by[o.sym] || (by[o.sym] = { v: 0, n: new Set() }); x.v += o.importe || 0; x.n.add(o.nombre); }
  const top = Object.entries(by).sort((a, b) => b[1].v - a[1].v).slice(0, 8);
  return top.length ? `<ul class="hoy-list">${top.map(([s, x]) => `<li>${link(s)} ${nf(x.v / 1e6, 2)} M $ · ${x.n.size} ${x.n.size === 1 ? "directivo" : "directivos"}${I.por_valor?.[s]?.racimo ? ' · <b>racimo</b>' : ""}</li>`).join("")}</ul>
    <div class="method">Compras en mercado abierto de 50.000 $ o más presentadas en los últimos 10 días (formulario 4). Detalle en Smart money → Directivos.</div>`
    : `<div class="hint">Sin compras relevantes de directivos en los últimos 10 días${I.pendientes ? " (aún se están cargando días anteriores)" : ""}.</div>`;
}

function smart() {
  const D = window.SCRSmart?.data();
  if (!D) { window.SCRSmart?.ensure(); return `<div class="hint">Cargando…</div>`; }
  const lim = addDays(today(), -10);
  const g = (D.gestores || []).filter((x) => x.actualizado_iso && x.actualizado_iso >= lim);
  const c = (D.congreso || []).filter((x) => x.fecha_decl >= lim).slice(0, 6);
  return `${g.length ? `<div class="sub">Superinversores con cartera nueva: ${g.map((x) => esc(x.nombre)).join(", ")}</div>` : `<div class="hint">Ningún superinversor ha publicado cartera en los últimos 10 días.</div>`}
    ${c.length ? `<ul class="hoy-list">${c.map((x) => `<li>${esc(x.nombre)} · <span class="chg ${x.tipo === "Compra" ? "p" : "n"}">${esc(x.tipo)}</span> ${link(x.sym)} <span class="hint">${esc(x.importe || "")} · operación ${fmtDate(x.fecha_op)}</span></li>`).join("")}</ul>` : ""}`;
}

/* ---------- copia de seguridad de tus datos (seguimiento, pesos, carteras, filtros…) ---------- */
function backupBox() {
  const n = (() => { try { return Object.keys(localStorage).length; } catch { return 0; } })();
  return `<div class="box"><b>Copia de seguridad de tus datos</b>
    <div class="hint">Tu seguimiento, pesos, carteras, filtros guardados y preferencias viven solo en este navegador (${n} ajustes). Descárgalos de vez en cuando o para pasarlos a otro dispositivo.</div>
    <div class="bar" style="margin-top:8px"><button class="icon-btn primary" data-bk="down">Descargar copia</button>
    <label class="icon-btn" style="cursor:pointer">Restaurar copia…<input type="file" id="bkfile" accept="application/json,.json" hidden></label></div>
    <div class="method">El historial de la web (registro de la nota, directivos, laboratorio) se guarda aparte cada viernes en la rama «copia-datos» del repositorio.</div></div>`;
}
function download() {
  const all = {};
  try { for (const k of Object.keys(localStorage)) all[k] = localStorage.getItem(k); } catch { /* sin almacenamiento */ }
  const blob = new Blob([JSON.stringify({ app: "screener", version: 1, fecha: new Date().toISOString(), datos: all }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `screener-copia-${today()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function restore(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.app !== "screener" || typeof j.datos !== "object") throw new Error("no es una copia del screener");
    const n = Object.keys(j.datos).length;
    if (!confirmBox(n, j.fecha)) return;
    for (const [k, v] of Object.entries(j.datos)) localStorage.setItem(k, v);
    location.reload();
  } catch (e) { H.openDrawer(`<h3>No se pudo restaurar</h3><div class="err-box">${esc(e.message || String(e))}</div>`); }
}
let pending = null;
function confirmBox(n, fecha) {   // confirmación propia (sin diálogos del navegador)
  if (pending && pending.ok) { pending = null; return true; }
  H.openDrawer(`<h3>Restaurar copia</h3><div class="box">La copia es del ${esc(fecha ? new Date(fecha).toLocaleString("es-ES") : "—")} y tiene ${n} ajustes. Sustituirá los ajustes actuales con el mismo nombre.</div>
    <div class="bar"><button class="icon-btn primary" data-bk="ok">Restaurar</button><button class="icon-btn" data-bk="no">Cancelar</button></div>`);
  return false;
}

function render() {
  ensure();
  window.SCREnsureUni?.();
  const uni = window.SCRUni?.() || [], Q = window.SCREq;
  const wait = `<div class="skel" style="height:120px"></div>`;
  return `${dataStatus()}
    <h2 class="sec">Mercado</h2>${market()}
    <div class="hoy-grid">
      <div class="box"><b>Tu seguimiento</b>${uni.length && Q ? watchlist(uni, Q) : wait}</div>
      <div class="box"><b>Mayores cambios de nota</b>${uni.length && Q ? movers(uni, Q) : wait}</div>
      <div class="box"><b>Resultados en los próximos 7 días</b>${uni.length && Q ? earnings(uni, Q) : wait}</div>
      <div class="box"><b>Compras de directivos</b> ${H.evid("h")}${insiders()}</div>
      <div class="box"><b>Smart money reciente</b> ${H.evid("h")}${smart()}</div>
      ${backupBox()}
    </div>`;
}

function onClick(t) {
  let b;
  if ((b = t.closest("[data-bk]"))) {
    const k = b.dataset.bk;
    if (k === "down") download();
    if (k === "no") { pending = null; H.closeDrawer(); }
    if (k === "ok" && pending) { pending.ok = true; H.closeDrawer(); restore(pending.file); }
    return true;
  }
  return false;
}
document.addEventListener("change", (e) => {
  if (e.target.id !== "bkfile" || !e.target.files?.[0]) return;
  pending = { file: e.target.files[0], ok: false };
  restore(pending.file);
});
document.addEventListener("click", (e) => { if (onClick(e.target)) { e.preventDefault(); e.stopPropagation(); } }, true);
H.modules.hoy = render;
})();
