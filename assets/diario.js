/* Screener · Investigación › Diario de decisiones (Fase 7).
   Cada decisión guarda lo que se sabía ese día (precio, nota, técnico) y se mide a 1, 3 y 6 meses frente a su índice.
   Se guarda en este navegador (clave «diario») y entra en la copia de seguridad. No se edita: solo se puede anular. */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate, store } = H;
const DEC = [["comprar", "Comprar"], ["vender", "Vender"], ["vigilar", "Vigilar"], ["descartar", "Descartar"]];
const HZ = [["corto", "Corto", "1-3 meses"], ["medio", "Medio", "3-12 meses"], ["largo", "Largo", "más de 1 año"]];
const HN = { "1m": 21, "3m": 63, "6m": 126 };
const HZ_EVAL = { corto: "1m", medio: "3m", largo: "6m" };   // horizonte de cada decisión → plazo con el que se juzga
const D = { list: store.get("diario", []), P: {}, reg: null, regErr: null, regLoading: false, form: null, ver: "todas" };
const save = () => store.set("diario", D.list);
const decName = (k) => (DEC.find((x) => x[0] === k) || [, k])[1];
const bench = (sym) => (sym.includes(".") ? "IDX_STOXX50" : "IDX_SP500");
const benchName = (sym) => (sym.includes(".") ? "Euro Stoxx 50" : "S&P 500");
const sign = (e) => (e.dec === "comprar" ? 1 : e.dec === "vender" || e.dec === "descartar" ? -1 : 0);   // vigilar no cuenta para el acierto

/* ---------- precios (data/p/SYM.json, cierres sin ajustar) ---------- */
function prices(sym) {
  const c = D.P[sym];
  if (c && c !== "…") return c;
  if (!c) {
    D.P[sym] = "…";
    fetch(`data/p/${encodeURIComponent(sym)}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => { D.P[sym] = d && d.t ? { t: d.t, c: d.c } : { t: [], c: [], err: true }; H.render(); });
  }
  return null;
}
const idxAtOrBefore = (t, d) => { let lo = 0, hi = t.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (t[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
/* rentabilidad encadenando cierres; un salto diario > +80 % o < −45 % se trata como split y no cuenta */
function chain(p, i0, i1) {
  let r = 1, split = false;
  for (let i = i0 + 1; i <= i1; i++) {
    const a = p.c[i - 1], b = p.c[i]; if (!(a > 0) || !(b > 0)) continue;
    const q = b / a; if (q > 1.8 || q < 0.55) { split = true; continue; }
    r *= q;
  }
  return { r: r - 1, split };
}
/* resultado de una decisión a n sesiones (o hasta hoy si n es null) frente a su índice */
function perf(e, n) {
  const p = prices(e.sym), b = prices(bench(e.sym));
  if (!p || !b) return { loading: true };
  if (p.err || !p.t.length) return { err: true };
  const i0 = idxAtOrBefore(p.t, e.fp); if (i0 < 0) return { err: true };
  const i1 = n == null ? p.t.length - 1 : i0 + n;
  if (i1 >= p.t.length || i1 <= i0) return { open: true, ses: p.t.length - 1 - i0 };
  const s = chain(p, i0, i1);
  const j0 = idxAtOrBefore(b.t, p.t[i0]), j1 = idxAtOrBefore(b.t, p.t[i1]);
  const ib = j0 >= 0 && j1 > j0 ? b.c[j1] / b.c[j0] - 1 : null;
  return { r: 100 * s.r, idx: ib == null ? null : 100 * ib, ex: ib == null ? null : 100 * (s.r - ib), split: s.split, hasta: p.t[i1], ses: i1 - i0 };
}

/* ---------- registro inmutable (data/registro.json) ---------- */
async function ensureReg() {
  if (D.reg || D.regLoading || D.regErr) return;
  D.regLoading = true;
  try { const r = await fetch("data/registro.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw new Error("aún sin registro"); D.reg = await r.json(); }
  catch (e) { D.regErr = e.message; }
  D.regLoading = false; H.render();
}
function regNote() {
  ensureReg();
  const R = D.reg;
  if (!R) return `<span>Registro inmutable: ${D.regErr ? "empieza con la próxima actualización" : "comprobando…"}</span>`;
  return `<span data-tip="Una foto de la nota por sesión, encadenada con huellas SHA-256 en la rama copia-datos. Si se altera una foto, la cadena deja de cuadrar.">Registro inmutable: ${R.integra ? '<b class="chg p">✓ cadena íntegra</b>' : '<b class="chg n">✗ alterado</b>'} · ${R.dias} ${R.dias === 1 ? "sesión" : "sesiones"}</span>`;
}

/* ---------- formulario (panel lateral) ---------- */
function openForm(sym) {
  const r = window.SCRUni?.().find((x) => x.sym === sym);
  if (!r) { window.SCREnsureUni?.(); H.openDrawer(`<h3>Registrar decisión</h3><div class="box">Cargando los datos de ${esc(sym)}…</div>`); setTimeout(() => window.SCRUni?.().length && openForm(sym), 800); return; }
  D.form = { sym, dec: D.form?.sym === sym ? D.form.dec : null, hz: D.form?.sym === sym ? D.form.hz : "medio" };
  paintForm();
}
function paintForm() {
  const F = D.form, r = window.SCRUni().find((x) => x.sym === F.sym);
  const prev = D.list.filter((e) => e.sym === F.sym && !e.anulada);
  H.openDrawer(`<h3>Registrar decisión · ${esc(F.sym)}</h3><div class="reg">${esc(r.nombre || "")}</div>
    <div class="box"><b>Lo que se sabe hoy (queda guardado con la decisión)</b>
      <div class="kv-grid sm">${[["Precio", `${nf(r.precio, 2)} ${esc(r.moneda || "")}`], ["Cierre", fmtDate(r.fecha_precio)], ["Nota (tus pesos)", r.score ?? "—"], ["Técnico", esc(r.veredicto || "—")]]
        .map(([k, v]) => `<div class="kvc"><span>${k}</span><b class="num">${v}</b></div>`).join("")}</div></div>
    <div class="dform"><label>Decisión</label><div class="seg">${DEC.map(([k, t]) => `<button class="${F.dec === k ? "on" : ""}" data-ddec="${k}">${t}</button>`).join("")}</div>
      <label>Horizonte</label><div class="seg">${HZ.map(([k, t, s]) => `<button class="${F.hz === k ? "on" : ""}" data-dhz="${k}" title="${s}">${t} <small>${s}</small></button>`).join("")}</div>
      <label for="dmot">Motivo <span class="hint">obligatorio</span></label><textarea id="dmot" class="txt" rows="3" maxlength="300" placeholder="Por qué: la tesis en una o dos frases">${esc(F.mot || "")}</textarea>
      <label for="dinv">Qué la invalidaría <span class="hint">opcional</span></label><input id="dinv" class="txt" maxlength="200" placeholder="Ej.: cierre por debajo de 300 $ o caída del margen bruto" value="${esc(F.inv || "")}">
      <div id="dmsg" class="hint"></div>
      <div class="bar"><button class="icon-btn primary" data-dsave="1">Guardar decisión</button><button class="icon-btn" data-dcancel="1">Cancelar</button></div>
      <div class="method">Se mide a 1, 3 y 6 meses frente al ${benchName(F.sym)} desde el cierre del ${fmtDate(r.fecha_precio)}. Una decisión guardada no se edita: solo se puede anular (y la anulación queda a la vista).${prev.length ? ` Ya tienes ${prev.length} ${prev.length === 1 ? "decisión" : "decisiones"} sobre ${esc(F.sym)}.` : ""}</div></div>`);
}
function saveForm() {
  const F = D.form, mot = document.getElementById("dmot")?.value.trim() || "", inv = document.getElementById("dinv")?.value.trim() || "";
  const msg = document.getElementById("dmsg");
  if (!F.dec) { msg.textContent = "Elige la decisión."; msg.className = "chg n"; return; }
  if (mot.length < 5) { msg.textContent = "Escribe el motivo (al menos unas palabras)."; msg.className = "chg n"; return; }
  const r = window.SCRUni().find((x) => x.sym === F.sym);
  D.list.push({ id: Date.now().toString(36), f: new Date().toISOString(), sym: F.sym, nombre: r.nombre || "", dec: F.dec, hz: F.hz, motivo: mot.slice(0, 300), inval: inv.slice(0, 200) || null,
    p0: r.precio, fp: r.fecha_precio, mon: r.moneda || "", nota: r.score ?? null, tec: r.veredicto || null, anulada: null });
  save(); D.form = null; H.closeDrawer(); H.render();
}

/* ---------- estadísticas ---------- */
function stats(list) {
  const act = list.filter((e) => !e.anulada), out = { n: act.length, by: {}, h: {} };
  DEC.forEach(([k]) => { out.by[k] = act.filter((e) => e.dec === k).length; });
  for (const h of Object.keys(HN)) {
    const done = act.filter((e) => sign(e)).map((e) => [e, perf(e, HN[h])]).filter(([, p]) => p.ex != null);
    out.h[h] = { n: done.length, hit: done.length ? (100 * done.filter(([e, p]) => sign(e) * p.ex > 0).length) / done.length : null,
      ex: done.length ? done.reduce((a, [e, p]) => a + sign(e) * p.ex, 0) / done.length : null };
  }
  for (const [hz, h] of Object.entries(HZ_EVAL)) {
    const done = act.filter((e) => sign(e) && e.hz === hz).map((e) => [e, perf(e, HN[h])]).filter(([, p]) => p.ex != null);
    out["hz_" + hz] = { n: done.length, hit: done.length ? (100 * done.filter(([e, p]) => sign(e) * p.ex > 0).length) / done.length : null, h };
  }
  return out;
}

/* ---------- página ---------- */
const cellEx = (p, e) => {
  if (p.loading) return '<span class="hint">…</span>';
  if (p.err) return '<span class="hint" data-tip="Sin precios para este valor">s. d.</span>';
  if (p.open) return `<span class="hint" data-tip="Aún no se ha cumplido el plazo (${p.ses} sesiones)">—</span>`;
  if (p.ex == null) return "—";
  const good = sign(e) ? sign(e) * p.ex > 0 : null;
  return `<span class="chg ${good == null ? (p.ex >= 0 ? "p" : "n") : good ? "p" : "n"}" data-tip="Valor ${sgn(p.r, 1)} % · ${esc(benchName(e.sym))} ${sgn(p.idx, 1)} % · hasta ${fmtDate(p.hasta)}${p.split ? " · se ha descontado un posible split" : ""}">${sgn(p.ex, 1)} pp${p.split ? "*" : ""}</span>`;
};
const scoreB = (v) => (window.SCREq ? window.SCREq.scoreBadge(v) : v ?? "—");
function render() {
  ensureReg();
  window.SCREnsureUni?.();
  const L = D.list.slice().sort((a, b) => (a.f < b.f ? 1 : -1));
  const shown = L.filter((e) => D.ver === "todas" || (D.ver === "activas" ? !e.anulada : e.dec === D.ver));
  const S = stats(D.list), h3 = S.h["3m"], small = (n) => (n < 20 ? "Muestra pequeña: no es concluyente" : "");
  const card = (t, v, badge, sub) => `<div class="fk"><span class="fk-t">${t}</span><div class="fk-v num">${v} ${badge || ""}</div><div class="fk-s">${sub}</div></div>`;
  let h = `<div class="fks">
    ${card("Decisiones registradas", S.n, "", `${S.by.comprar} compras · ${S.by.vender} ventas · ${S.by.descartar} descartes · ${S.by.vigilar} vigilar`)}
    ${card("Acierto a 3 meses", h3.hit == null ? "—" : nf(h3.hit, 0) + " %", `<span class="pl pl-i">${h3.n} cerradas</span>`, h3.n ? `Comprar: batir al índice · vender o descartar: quedar por debajo. ${small(h3.n)}` : "Aún no se ha cumplido ningún plazo de 3 meses")}
    ${card("Exceso medio a 3 meses", h3.ex == null ? "—" : sgn(h3.ex, 1) + " pp", '<span class="pl pl-p">vs índice</span>', h3.n ? small(h3.n) || "A favor de tu decisión, frente a su índice" : "Se calcula al cerrar el primer plazo")}
    ${card("Corto plazo", S.hz_corto.hit == null ? "—" : nf(S.hz_corto.hit, 0) + " %", "", `Acierto a 1 mes en decisiones de corto plazo (${S.hz_corto.n} cerradas)`)}
    ${card("Medio plazo", S.hz_medio.hit == null ? "—" : nf(S.hz_medio.hit, 0) + " %", "", `Acierto a 3 meses en decisiones de medio plazo (${S.hz_medio.n} cerradas)`)}
  </div>`;
  const filt = `<span class="bar" style="margin:0">${[["todas", "Todas"], ["activas", "Sin anuladas"], ...DEC].map(([k, t]) => `<button class="chip ${D.ver === k ? "on" : ""}" data-dver="${k}">${t}</button>`).join("")}</span>`;
  h += `<section class="fbox"><header><h2>Decisiones</h2><span class="fbox-r">Resultado frente a su índice (S&P 500 o Euro Stoxx 50), en puntos</span></header>
    <div class="bar" style="margin-top:0">${filt}<span style="flex:1"></span><input id="dsym" class="txt" placeholder="Ticker (AAPL, SAN.MC…)" aria-label="Ticker para registrar" style="width:170px"><button class="icon-btn primary" data-dnewin="1">Registrar decisión</button><button class="icon-btn" data-dcsv="1">CSV</button></div>
    ${shown.length ? `<div class="tbl-wrap"><table class="ft dtab"><thead><tr><th>Fecha</th><th>Valor</th><th>Decisión</th><th style="text-align:left">Motivo</th><th>Horizonte</th><th>Precio</th><th>Nota ese día</th><th>1 mes</th><th>3 meses</th><th>6 meses</th><th>Desde entonces</th><th></th></tr></thead><tbody>
      ${shown.map((e) => `<tr class="${e.anulada ? "anul" : ""}"><td class="num">${fmtDate(e.f.slice(0, 10))}</td><td><a href="#" data-sym="${esc(e.sym)}"><b>${esc(e.sym)}</b></a></td>
        <td><span class="dec dec-${e.dec}">${decName(e.dec)}</span></td><td style="text-align:left" class="dmot">${esc(e.motivo)}${e.inval ? `<div class="hint">Invalida: ${esc(e.inval)}</div>` : ""}${e.anulada ? `<div class="hint">Anulada el ${fmtDate(e.anulada.slice(0, 10))}</div>` : ""}</td>
        <td>${esc((HZ.find((x) => x[0] === e.hz) || [, "—"])[1])}</td><td class="num">${nf(e.p0, 2)} <small class="hint">${esc(e.mon)}</small></td><td class="num">${scoreB(e.nota)}</td>
        <td class="num">${cellEx(perf(e, 21), e)}</td><td class="num">${cellEx(perf(e, 63), e)}</td><td class="num">${cellEx(perf(e, 126), e)}</td><td class="num">${(() => { const p = perf(e, null); return p.loading ? "…" : p.err || p.ex == null ? "—" : `${cellEx(p, e)} <span class="hint">${p.ses} s.</span>`; })()}</td>
        <td>${e.anulada ? "" : `<button class="link-btn" data-danul="${e.id}" title="Anular (queda a la vista, no cuenta en las estadísticas)">Anular</button>`}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="soon-box">${D.list.length ? "Ninguna decisión con este filtro." : "Aún no has registrado decisiones. Escribe un ticker y pulsa «Registrar decisión», o hazlo desde la ficha de cualquier empresa."}</div>`}
    <div class="method">Para «Vender» y «Descartar», acertar es que el valor lo haga peor que su índice; «Vigilar» se mide pero no cuenta en el acierto. Rentabilidad con cierres sin dividendos; * = se ha descontado un posible split. Las decisiones se guardan en este navegador y entran en la copia de seguridad (Mercado › Hoy).</div></section>`;
  /* notas de las carteras (carteras.js): se muestran aquí, no se duplican */
  const notes = (store.get("carteras", []) || []).flatMap((p) => (p.notas || []).map((n) => ({ ...n, cartera: p.nombre }))).sort((a, b) => (a.f < b.f ? 1 : -1));
  h += `<section class="fbox"><header><h2>Notas de tus carteras</h2><span class="fbox-r">${notes.length} notas · se escriben en Watchlists › Carteras</span></header>
    ${notes.length ? notes.slice(0, 30).map((n) => `<div class="fq"><span><b>${esc(n.cartera)}</b> · ${esc(n.t)}</span><span class="fq-v hint">${fmtDate(n.f.slice(0, 10))}</span></div>`).join("")
      : '<div class="hint">Sin notas. En cada cartera guardada puedes anotar por qué compras, vendes o rebalanceas.</div>'}
    <div class="bar" style="margin-top:8px"><button class="chip" data-sub="carteras">Ir a Carteras →</button></div></section>`;
  const R = D.reg;
  h += `<section class="fbox"><header><h2>Registro inmutable de la nota</h2><span class="fbox-r">${H.evid("r")}</span></header>
    ${R ? `<div class="fq"><span>Estado</span><span class="fq-v">${R.integra ? '<i class="dt dt-ok"></i>Cadena íntegra' : `<i class="dt dt-bad"></i>Alterado: ${esc(R.motivo)}`}</span></div>
      <div class="fq"><span>Sesiones registradas</span><span class="fq-v">${R.dias} · desde ${fmtDate(R.desde)} hasta ${fmtDate(R.hasta)}</span></div>
      ${R.metodo ? `<div class="fq"><span>Método de la nota</span><span class="fq-v" style="max-width:60%">${esc(R.metodo)}</span></div>` : ""}
      <div class="fq"><span>Fotos comprobadas en esta actualización</span><span class="fq-v">${R.fotos_comprobadas}</span></div>
      <div class="fq"><span>Última huella</span><span class="fq-v num hint" style="font-size:12px">${esc((R.ultima?.h || "").slice(0, 16))}…</span></div>`
      : `<div class="hint">${D.regErr ? "El registro empieza con la próxima actualización de datos." : "Cargando…"}</div>`}
    <div class="method">Cada sesión se guarda una foto de la nota de todos los valores (pesos por defecto), el técnico y el veredicto del laboratorio en la rama «copia-datos» del repositorio, encadenada con huellas SHA-256. Una foto registrada no se reescribe; si alguien la cambia, la cadena deja de cuadrar y aquí aparece «alterado». Sirve para que el historial de la nota no pueda maquillarse a posteriori.</div></section>`;
  return h;
}

/* ---------- para la ficha ---------- */
function forSym(sym) {
  return D.list.filter((e) => e.sym === sym).sort((a, b) => (a.f < b.f ? 1 : -1));
}
function fichaBlock(sym) {
  const L = forSym(sym), act = L.filter((e) => !e.anulada), e = act[0];
  const row = (t, v) => `<div class="fq"><span>${t}</span><span class="fq-v">${v}</span></div>`;
  if (!e) return row("Última decisión", '<i class="dt dt-na"></i>Sin decisiones registradas') + `<div class="bar" style="margin-top:8px"><button class="chip" data-dnew="${esc(sym)}">Registrar decisión</button></div>`;
  const p = perf(e, null);
  const res = p.loading ? "…" : p.err || p.ex == null ? (p.open ? "sin sesiones todavía" : "—") : `<span class="pl ${p.r >= 0 ? "pl-p" : "pl-n"}">${sgn(p.r, 1)} %</span> vs índice <span class="pl ${sign(e) * p.ex >= 0 ? "pl-p" : "pl-n"}">${sgn(p.ex, 1)} pp</span>`;
  return row("Última decisión", `<b>${decName(e.dec)}</b>&nbsp;· ${fmtDate(e.f.slice(0, 10))} a ${nf(e.p0, 2)} ${esc(e.mon)}`) + row("Resultado desde entonces", res)
    + (act.length > 1 ? row("Decisiones sobre este valor", String(act.length)) : "") + `<div class="hint" style="margin-top:4px">«${esc(e.motivo)}»</div>`
    + `<div class="bar" style="margin-top:8px"><button class="chip" data-dnew="${esc(sym)}">Registrar otra</button><button class="chip" data-sub="diario">Ver el diario →</button></div>`;
}

/* ---------- eventos ---------- */
function onClick(t) {
  let b;
  if ((b = t.closest("[data-dnew]"))) { openForm(b.dataset.dnew); return true; }
  if (t.closest("[data-dnewin]")) {
    const v = (document.getElementById("dsym")?.value || "").trim().toUpperCase();
    const ok = v && window.SCRUni?.().some((x) => x.sym === v);
    if (ok) openForm(v); else { const i = document.getElementById("dsym"); if (i) { i.focus(); i.placeholder = v ? `${v} no está en el universo` : "Escribe un ticker"; i.value = ""; } }
    return true;
  }
  if ((b = t.closest("[data-ddec]"))) { D.form.dec = b.dataset.ddec; keepText(); paintForm(); return true; }
  if ((b = t.closest("[data-dhz]"))) { D.form.hz = b.dataset.dhz; keepText(); paintForm(); return true; }
  if (t.closest("[data-dsave]")) { saveForm(); return true; }
  if (t.closest("[data-dcancel]")) { D.form = null; H.closeDrawer(); return true; }
  if ((b = t.closest("[data-dver]"))) { D.ver = b.dataset.dver; H.render(); return true; }
  if ((b = t.closest("[data-danul]"))) {
    const e = D.list.find((x) => x.id === b.dataset.danul);
    if (e && b.dataset.sure) { e.anulada = new Date().toISOString(); save(); H.render(); }
    else if (e) { b.dataset.sure = "1"; b.textContent = "¿Seguro? Pulsa otra vez"; }
    return true;
  }
  if (t.closest("[data-dcsv]")) { csv(); return true; }
  return false;
}
function keepText() { D.form.mot = document.getElementById("dmot")?.value || D.form.mot; D.form.inv = document.getElementById("dinv")?.value || D.form.inv; }
function csv() {
  const q = (v) => (v == null ? "" : /[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = D.list.map((e) => { const p1 = perf(e, 21), p3 = perf(e, 63), p6 = perf(e, 126);
    return [e.f.slice(0, 10), e.sym, decName(e.dec), e.hz, e.motivo, e.inval, e.p0, e.mon, e.fp, e.nota, e.tec, p1.ex?.toFixed(2), p3.ex?.toFixed(2), p6.ex?.toFixed(2), e.anulada ? e.anulada.slice(0, 10) : ""].map(q).join(";"); });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + ["fecha;valor;decision;horizonte;motivo;invalidacion;precio;moneda;cierre;nota;tecnico;exceso_1m_pp;exceso_3m_pp;exceso_6m_pp;anulada", ...rows].join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `diario-decisiones-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
}
window.addEventListener("storage", (e) => { if (e.key === "diario") { D.list = store.get("diario", []); H.render(); } });

window.SCRDiario = { openForm, forSym, fichaBlock, note: regNote, list: () => D.list };
H.notes = H.notes || {}; H.notes.diario = regNote;
H.modules.diario = render;
H.handlers.unshift(onClick);
if (H.S.view === "diario" || H.S.ficha) H.render();
})();
