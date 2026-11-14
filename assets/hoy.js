/* Screener · «Hoy»: lo que ha cambiado y lo que viene, en una sola pantalla, y copia de seguridad de tus datos. */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate, store } = H;
const T = { val: undefined, ins: undefined, idx: {}, loading: false };

async function ensure() {
  if (T.loading || T.val !== undefined) return;
  T.loading = true;
  const get = async (f) => { try { const r = await fetch(`data/${f}?t=${Date.now()}`, { cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; } };
  const ix = ["IDX_SP500", "IDX_STOXX50", "IDX_IBEX"];
  const res = await Promise.all([get("validacion.json"), get("insiders.json"), ...ix.map((f) => get(`p/${f}.json`))]);
  [T.val, T.ins] = res;
  ix.forEach((f, i) => { T.idx[f] = res[2 + i]; });
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

/* ---------- diseño A: tira de índices y filas «etiqueta … valor» ---------- */
const kv = (l, v, h = "") => `<div class="hr"><span>${l}</span><span class="v">${v}${h ? ` <i>${h}</i>` : ""}</span></div>`;
const sec = (t, hint, body) => `<section class="hs"><h3>${t}<span>${hint}</span></h3>${body}</section>`;
function strip() {
  const D = H.S.data, out = [];
  for (const [f, n] of [["IDX_SP500", "S&P 500"], ["IDX_STOXX50", "Euro Stoxx 50"], ["IDX_IBEX", "IBEX 35"]]) {
    const d = T.idx[f]; if (!d?.c?.length) continue;
    const c = d.c.filter((x) => x != null), l = c[c.length - 1], p = c[c.length - 2];
    out.push(`<div><span>${n}</span><b class="num">${nf(l, 1)}</b>${chg(p ? (l / p - 1) * 100 : null, 2)}</div>`);
  }
  const s = (id) => { const x = D?.series?.[id]; return x && x.estado === "ok" ? x : null; };
  const y = s("us10y"); if (y) out.push(`<div><span>Bono EE. UU. 10 a</span><b class="num">${nf(y.valor, 2)} %</b><small class="num">${sgn(y.cambio_1m)} en 1 mes</small></div>`);
  const v = s("vix"); if (v) out.push(`<div><span>VIX</span><b class="num">${nf(v.valor, 1)}</b><small class="num">${sgn(v.cambio_1m)} en 1 mes</small></div>`);
  return out.length ? `<div class="ixs">${out.join("")}</div>` : "";
}
function pulse() {
  const D = H.S.data, A = H.S.amp?.regiones || {}, rows = [];
  for (const [reg, a] of Object.entries(A)) {
    rows.push(kv(`Sobre su media de 200 · ${esc(reg)}`, `${nf(a.sobre_sma200, 0)} %`, a.sobre_sma200_1m != null ? `hace 1 mes ${nf(a.sobre_sma200_1m, 0)} %` : ""));
    if (a.max52 != null) { const d = a.max52 - a.min52; rows.push(kv(`Máximos − mínimos 52 sem. · ${esc(reg)}`, `<span class="chg ${d > 0 ? "p" : d < 0 ? "n" : "z"}">${d > 0 ? "+" : ""}${d}</span>`)); }
  }
  const L = D?.series?.liq_neta; if (L?.estado === "ok") rows.push(kv("Liquidez neta de la Fed", `${nf(L.valor / 1000, 2)} bill. $`, `${sgn(L.cambio_3m, 0)} mm $ en 3 meses`));
  const R = D?.regimen; if (R?.estado === "ok") rows.push(kv(`Régimen macro EE. UU. ${H.evid("h")}`, esc(R.dominante), `${R.probabilidades[R.dominante]} %`));
  const G = window.SCRKit?.E?.sec?.rrg?.["EE. UU."]?.medio;
  if (G) {
    const by = (q) => Object.entries(G).filter(([, r]) => r.cuadrante === q).sort((a, b) => b[1].cola.at(-1)[1] - a[1].cola.at(-1)[1]).map(([k]) => esc(window.SCRKit.sn(k)));
    const l = by("Liderando"), d = by("Debilitándose");
    rows.push(kv("Sectores líderes EE. UU. (rotación)", l.slice(0, 3).join(", ") || "ninguno"));
    if (d.length) rows.push(kv("Sectores debilitándose", d.slice(0, 3).join(", ")));
  }
  return rows.join("") || `<div class="hint">Sin datos de mercado todavía.</div>`;
}
function watchToday(uni, Q) {
  const w = Q.watch(); if (!w.length) return `<div class="hint">No sigues ningún valor. Márcalos con ☆ en el screener o pulsa W sobre una fila.</div>`;
  const rows = w.map((s) => uni.find((r) => r.sym === s)).filter(Boolean).map((r) => {
    const c = Q.changeOf(r.sym), why = [];
    if (r.resultados && r.resultados >= today() && r.resultados <= addDays(today(), 14)) why.push(`resultados el ${fmtDate(r.resultados)}`);
    if (c?.t0 && c.t1 && c.t0 !== c.t1) why.push(`técnico pasa a ${esc(c.t1)}`);
    if (c?.d) why.push(`nota ${c.n0} → ${c.n1}`);
    return { r, why, k: why.length * 10 + Math.abs(r.r1d || 0) };
  }).sort((a, b) => b.k - a.k);
  const top = rows.filter((x) => x.why.length).slice(0, 6), rest = rows.length - top.length;
  return top.map(({ r, why }) => kv(`${link(r.sym)} <i>· ${why.join(" · ")}</i>`, chg(r.r1d, 1))).join("")
    + kv(top.length ? `Resto (${rest}) sin cambios relevantes` : `Sin cambios relevantes en tus ${rows.length} valores`, "");
}
function earn(uni, Q) {
  const w = new Set(Q.watch()), top = new Set(uni.filter((r) => r.score != null).sort((a, b) => b.score - a.score).slice(0, 50).map((r) => r.sym));
  const xs = uni.filter((r) => (w.has(r.sym) || top.has(r.sym)) && r.resultados && r.resultados >= today()).sort((a, b) => a.resultados.localeCompare(b.resultados)).slice(0, 7);
  return xs.length ? xs.map((r) => kv(new Date(r.resultados + "T12:00").toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" }), `${link(r.sym)}${w.has(r.sym) ? " ★" : ""}`)).join("")
    : `<div class="hint">Sin fechas de resultados próximas en tu Watchlist ni en el top 50.</div>`;
}
function moves(uni, Q) {
  if (!Q.sc()?.anterior) return `<div class="hint">Disponible desde la segunda actualización con registro de la sesión anterior.</div>`;
  const all = uni.map((r) => ({ r, c: Q.changeOf(r.sym) })).filter((x) => x.c?.d).sort((a, b) => Math.abs(b.c.d) - Math.abs(a.c.d)).slice(0, 6);
  return all.length ? all.map(({ r, c }) => kv(`${link(r.sym)} <i>· ${esc((r.nombre || "").slice(0, 20))}</i>`, `${c.n0} → <b>${c.n1 ?? "s. d."}</b> <span class="chg ${c.d > 0 ? "p" : "n"}">${sgn(c.d, 0)}</span>`)).join("")
    : `<div class="hint">Ningún cambio de nota desde la sesión anterior.</div>`;
}
function smartRows() {
  const out = [], I = T.ins, lim = addDays(today(), -7);
  if (I) {
    const rac = Object.entries(I.por_valor || {}).filter(([, x]) => x.racimo).map(([s]) => s);
    out.push(kv("Compras en racimo de directivos", rac.length ? rac.slice(0, 3).map((s) => link(s)).join(", ") : "ninguna"));
    const buys = (I.ops || []).filter((o) => o.codigo === "P" && o.fecha_pres >= lim && (o.importe || 0) >= 50000);
    out.push(kv("Compras de directivos ≥ 50.000 $", `${buys.length}`, "últimos 7 días"));
  }
  const D = window.SCRSmart?.data();
  if (!D) window.SCRSmart?.ensure();
  else {
    const g = (D.gestores || []).filter((x) => x.actualizado_iso && x.actualizado_iso >= addDays(today(), -10));
    out.push(kv("Superinversores con cartera nueva", g.length ? `${g.length}` : "ninguno", "últimos 10 días"));
    const c = (D.congreso || []).filter((x) => x.fecha_decl >= lim);
    out.push(kv("Congreso de EE. UU.", `${c.length} operaciones`, [...new Set(c.map((x) => x.sym))].slice(0, 3).join(", ")));
  }
  return out.join("") || `<div class="hint">${T.loading ? "Cargando…" : "Sin datos todavía."}</div>`;
}
function diaryRows() {
  const Dd = window.SCRDiario; if (!Dd) return "";
  const L = Dd.list().filter((e) => !e.anulada).slice(-5).reverse(), out = [];
  for (const e of L) {
    const p = Dd.perf(e, null);
    const v = p.ex != null ? `<span class="chg ${p.ex > 0 ? "p" : p.ex < 0 ? "n" : "z"}">${sgn(p.ex, 1)} pp</span> <i>vs índice</i>` : p.loading ? "…" : "—";
    out.push(kv(`${esc(Dd.decName(e.dec))} · ${link(e.sym)} <i>· ${fmtDate(e.f.slice(0, 10))}</i>`, v));
  }
  const R = Dd.reg();
  out.push(kv("Registro inmutable", R ? (R.integra ? `<span class="chg p">● íntegro</span> · ${R.dias} ${R.dias === 1 ? "sesión" : "sesiones"}` : '<span class="chg n">● alterado</span>') : "comprobando…"));
  return (L.length ? "" : `<div class="hint">Aún no has registrado decisiones. Pulsa «Registrar decisión» en una ficha.</div>`) + out.join("");
}

function render() {
  ensure();
  window.SCREnsureUni?.();
  const uni = window.SCRUni?.() || [], Q = window.SCREq, ok = uni.length && Q;
  const wait = `<div class="skel" style="height:120px"></div>`;
  const fecha = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `<div class="pg-head"><h1>Hoy</h1><div class="pg-sub">${fecha.charAt(0).toUpperCase() + fecha.slice(1)} · ${dataStatus().replace(/<\/?div[^>]*>/g, "")}</div></div>
    ${strip()}
    <div class="hgrid">
      ${sec("Pulso del mercado", "amplitud y liquidez", pulse())}
      ${sec("Tu Watchlist hoy", ok ? `${Q.watch().length} valores` : "", ok ? watchToday(uni, Q) : wait)}
      ${sec("Próximos resultados", "tu Watchlist y top 50 por nota", ok ? earn(uni, Q) : wait)}
      ${sec("Movimientos de la nota", "desde la sesión anterior · tus pesos", ok ? moves(uni, Q) : wait)}
      ${sec(`Smart money ${H.evid("h")}`, "últimos 7-10 días", smartRows())}
      ${sec("Tu Diario", "decisiones abiertas", diaryRows())}
    </div>
    <details class="hoy-more"><summary>Más: detalle de directivos, superinversores y copia de seguridad</summary>
      <div class="hoy-grid"><div class="box"><b>Compras de directivos</b>${insiders()}</div><div class="box"><b>Smart money reciente</b>${smart()}</div>${backupBox()}</div></details>`;
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
/* Watchlists › Seguimiento: tus valores marcados con ★, con lo que ha cambiado y lo que viene */
H.modules.seguimiento = () => {
  ensure();
  window.SCREnsureUni?.();
  const uni = window.SCRUni?.() || [], Q = window.SCREq;
  if (!uni.length || !Q) return `<div class="skel" style="height:240px"></div>`;
  const n = Q.watch().length;
  return `<h2 class="sec">Seguimiento <span class="hint">${n} ${n === 1 ? "valor" : "valores"} · cambios desde la sesión anterior</span></h2>
    <div class="box">${watchlist(uni, Q)}</div>
    <div class="method">Añade o quita valores con ★ en el screener o en su ficha. Se guardan en este navegador y entran en la copia de seguridad (Mercado › Hoy).</div>`;
};
})();
