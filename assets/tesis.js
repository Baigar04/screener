/* Screener · Ficha de tesis: qué descuenta el precio (DCF inverso), valoración frente a su historia, comparables y catalizadores. */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate, store } = H;
const F = () => window.SCRFmt;
const ERP = 5;            // prima de riesgo del mercado (%)
const FIN = /bank|insurance|capital markets|credit services|asset management|mortgage|financial conglomerates/i;
const FN = { calidad: "calidad", valor: "valoración", crecimiento: "crecimiento", momentum: "momentum", smart: "smart money", macro: "encaje macro" };

/* ---------- DCF ---------- */
function pv(fcf, g, r, gt, n) {
  let v = 0, f = fcf;
  for (let t = 1; t <= n; t++) { f *= 1 + g; v += f / (1 + r) ** t; }
  return v + (f * (1 + gt)) / (r - gt) / (1 + r) ** n;
}
function implied(ev, fcf, r, gt, n) {
  if (!(fcf > 0) || !(ev > 0) || r <= gt) return null;
  let lo = -0.5, hi = 1.0;
  if (pv(fcf, hi, r, gt, n) < ev) return { g: null, above: true };
  if (pv(fcf, lo, r, gt, n) > ev) return { g: null, below: true };
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (pv(fcf, m, r, gt, n) > ev) hi = m; else lo = m; }
  return { g: (lo + hi) / 2 };
}
function cagr(anual, k) {
  const ys = Object.keys(anual || {}).sort(), v = ys.map((y) => anual[y]?.[k]).filter((x) => x != null);
  const a = ys.find((y) => anual[y]?.[k] > 0), b = ys.slice().reverse().find((y) => anual[y]?.[k] > 0);
  if (!a || !b || a === b || !(anual[a][k] > 0) || !(anual[b][k] > 0)) return null;
  return { v: ((anual[b][k] / anual[a][k]) ** (1 / (b - a)) - 1) * 100, n: b - a, desde: a, hasta: b, all: v };
}
function inputs(r, d) {
  const an = d.anual || {}, ys = Object.keys(an).sort();
  const lastF = ys.length ? an[ys[ys.length - 1]].fcf : null;
  const f3 = ys.slice(-3).map((y) => an[y].fcf).filter((x) => x != null);
  const avg3 = f3.length === 3 ? f3.reduce((a, b) => a + b, 0) / 3 : null;
  const shares = r.acciones || (r.mcap && r.precio ? r.mcap / r.precio : null);
  const nd = r.deuda != null && r.caja != null ? r.deuda - r.caja : null;
  const beta = r.beta != null ? Math.min(2, Math.max(0.5, r.beta)) : 1;
  const rf = H.S.data?.series?.[r.region === "Europa" ? "ez10y" : "us10y"]?.valor ?? (r.region === "Europa" ? 3 : 4.2);
  return { lastF, avg3, ttm: r.fcf_ttm, shares, nd, beta, rf, r0: Math.min(14, Math.max(6, rf + beta * ERP)) };
}

/* ---------- vista ---------- */
const T = { base: store.get("tesis_base", "ttm"), r: null, gt: 2.5, n: 10, sym: null, peers: store.get("tesis_peers", "industria") };

function dcfBox(r, d, I) {
  if (FIN.test(r.industria || "") ) return `<div class="box"><b>Qué descuenta el precio</b><div class="hint">El DCF por flujo de caja libre no aplica a bancos, aseguradoras y gestoras: su «caja» es su materia prima. Para ellos, mira el P/VC frente a su historia y el ROE.</div></div>`;
  if (r.moneda_fin && r.moneda && r.moneda_fin !== r.moneda) return `<div class="box"><b>Qué descuenta el precio</b><div class="hint">Las cuentas están en ${esc(r.moneda_fin)} y la acción cotiza en ${esc(r.moneda)}: sin tipo de cambio fiable en la fuente, el DCF no sería comparable.</div></div>`;
  const opts = [["ttm", "FCF últimos 12 meses", I.ttm], ["ult", "FCF último ejercicio", I.lastF], ["avg3", "FCF medio 3 ejercicios", I.avg3]].filter((o) => o[2] != null);
  if (!opts.length) return `<div class="box"><b>Qué descuenta el precio</b><div class="hint">Sin flujo de caja libre en la fuente.</div></div>`;
  const cur = opts.find((o) => o[0] === T.base) || opts[0], fcf = cur[2];
  const rr = (T.r ?? I.r0) / 100, gt = T.gt / 100, ev = r.mcap + (I.nd || 0);
  const res = fcf > 0 ? implied(ev, fcf, rr, gt, T.n) : null;
  const vs = cagr(d.anual, "ventas"), fs = cagr(d.anual, "fcf");
  const g = res?.g != null ? res.g * 100 : null;
  let ver = "", vc = "sin";
  if (g != null && vs) {
    const diff = g - vs.v;
    if (diff <= -2) { ver = "Exigencia baja: el precio descuenta menos crecimiento del que ha tenido."; vc = "ok"; }
    else if (diff <= 3) { ver = "En línea con su historia: el precio descuenta que siga creciendo como hasta ahora."; vc = "mid"; }
    else if (g > 15 && g > 2 * Math.max(vs.v, 1)) { ver = "Muy exigente: el precio necesita un crecimiento muy superior al histórico durante una década."; vc = "bad"; }
    else { ver = "Exigente: el precio descuenta acelerar el crecimiento respecto a su historia."; vc = "bad"; }
  }
  /* escenarios */
  const base = vs ? Math.max(-5, Math.min(20, vs.v)) : (r.crec_ventas != null ? Math.max(-5, Math.min(20, r.crec_ventas)) : null);
  const scen = fcf > 0 && base != null && I.shares ? [["Bajista", base - 5], ["Base", base], ["Alcista", base + 5]].map(([k, gg]) => {
    const eq = pv(fcf, gg / 100, rr, gt, T.n) - (I.nd || 0), px = eq / I.shares;
    return [k, gg, px, r.precio ? (px / r.precio - 1) * 100 : null];
  }) : null;
  return `<div class="box tes-dcf"><b>Qué descuenta el precio · DCF inverso</b>
    ${fcf <= 0 ? `<div class="hint">El flujo de caja libre elegido es negativo (${F().big(fcf, r.moneda)}): el precio descuenta un cambio de rumbo, no una continuación. Prueba con la media de 3 ejercicios.</div>` : ""}
    ${res?.above ? `<div class="hint">Ni con un 100 % anual se justifica el precio con estos supuestos: cotiza por opcionalidad o por beneficios muy lejanos.</div>` : ""}
    ${g != null ? `<div class="lab-big">${sgn(g, 1)} %<span>crecimiento anual del flujo de caja libre que justifica el precio actual, ${T.n} años</span></div>
      <div class="tes-cmp"><div><span class="hint">Ventas, histórico${vs ? ` (${vs.desde}-${vs.hasta})` : ""}</span><b class="num">${vs ? sgn(vs.v, 1) + " %/año" : "—"}</b></div>
        <div><span class="hint">FCF, histórico</span><b class="num">${fs ? sgn(fs.v, 1) + " %/año" : "—"}</b></div>
        <div><span class="hint">Ventas, último año</span><b class="num">${F().spct(r.crec_ventas)}</b></div></div>
      ${ver ? `<div class="tes-ver lab-v lab-${vc}">${esc(ver)}</div>` : ""}` : ""}
    <div class="tes-ctl">
      <div class="bar">${opts.map(([k, t, v]) => `<button class="chip ${k === cur[0] ? "on" : ""}" data-tbase="${k}">${t}: ${F().big(v, r.moneda)}</button>`).join("")}</div>
      <label>Tasa de descuento <b class="num">${nf(T.r ?? I.r0, 1)} %</b><input type="range" min="5" max="15" step="0.5" value="${T.r ?? I.r0}" data-tset="r"></label>
      <label>Crecimiento a perpetuidad <b class="num">${nf(T.gt, 1)} %</b><input type="range" min="0" max="4" step="0.5" value="${T.gt}" data-tset="gt"></label>
      <label>Años de crecimiento <b class="num">${T.n}</b><input type="range" min="5" max="15" step="1" value="${T.n}" data-tset="n"></label>
    </div>
    ${scen ? `<div class="lab-tw"><table><thead><tr><th>Escenario</th><th>Crec. FCF</th><th>Valor por acción</th><th>Frente al precio</th></tr></thead><tbody>
      ${scen.map(([k, gg, px, up]) => `<tr><td>${k}</td><td class="num">${sgn(gg, 1)} %</td><td class="num">${px > 0 ? nf(px, 2) : "negativo"}</td><td class="num chg ${F().cls(up)}">${px > 0 ? F().spct(up, 0) : "—"}</td></tr>`).join("")}
      ${r.precio_objetivo ? `<tr><td>Analistas (${r.n_analistas || "?"})</td><td></td><td class="num">${nf(r.precio_objetivo, 2)}</td><td class="num chg ${F().cls(r.precio_objetivo / r.precio - 1)}">${F().spct((r.precio_objetivo / r.precio - 1) * 100, 0)}</td></tr>` : ""}</tbody></table></div>` : ""}
    <div class="method">Valor empresa = capitalización ${F().big(r.mcap, r.moneda)} + deuda neta ${I.nd == null ? "(sin dato: se toma 0)" : F().big(I.nd, r.moneda)}.
      Tasa por defecto = bono a 10 años (${nf(I.rf, 2)} %) + beta ${nf(I.beta, 2)} × ${ERP} % de prima de mercado. Escenarios: crecimiento histórico de ventas (acotado entre −5 % y 20 %) ± 5 puntos.
      Es una herramienta para entender qué espera el mercado, no un precio objetivo.</div></div>`;
}

function histBox(r, d) {
  const v = d.val_hist;
  if (!v) return `<div class="box"><b>Valoración frente a su propia historia</b><div class="hint">Sin historial suficiente de cuentas anuales en la fuente.</div></div>`;
  const M = [["per", "PER", 1, -1], ["pvc", "P/VC", 2, -1], ["ps", "Precio / ventas", 2, -1], ["fcfy", "Rentab. FCF %", 2, 1]];
  const rows = M.map(([k, t, dc, dir]) => {
    const s = v[k].filter((x) => x != null); if (s.length < 6) return null;
    const cur = v[k][v[k].length - 1]; if (cur == null) return null;
    const so = s.slice().sort((a, b) => a - b), med = so[Math.floor(so.length / 2)];
    const p = Math.round((so.filter((x) => x < cur).length / so.length) * 100);
    const cheap = dir < 0 ? p <= 25 : p >= 75, dear = dir < 0 ? p >= 75 : p <= 25;
    return { k, t, dc, cur, med, lo: so[0], hi: so[so.length - 1], p, cheap, dear, s: v[k] };
  }).filter(Boolean);
  if (!rows.length) return `<div class="box"><b>Valoración frente a su propia historia</b><div class="hint">Sin datos suficientes.</div></div>`;
  const sp = (s, med) => { const xs = s.map((x, i) => [i, x]).filter((p) => p[1] != null); const lo = Math.min(...xs.map((p) => p[1])), hi = Math.max(...xs.map((p) => p[1])), rg = hi - lo || 1;
    const X = (i) => (i / (s.length - 1)) * 116 + 2, Y = (y) => 22 - ((y - lo) / rg) * 20;
    return `<svg viewBox="0 0 120 24" class="tes-sp"><line x1="2" x2="118" y1="${Y(med)}" y2="${Y(med)}" class="lab-ax" stroke-dasharray="2 2"/><path d="${xs.map((p, j) => `${j ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("")}" fill="none" stroke="var(--accent)" stroke-width="1.4"/></svg>`; };
  const nC = rows.filter((x) => x.cheap).length, nD = rows.filter((x) => x.dear).length;
  return `<div class="box"><b>Valoración frente a su propia historia · ${v.t[0].replace("-", "/")} – ${v.t[v.t.length - 1].replace("-", "/")}</b>
    <div class="lab-tw"><table><thead><tr><th>Múltiplo</th><th>Actual</th><th>Mediana</th><th>Rango</th><th data-tip="Porcentaje de meses en que estuvo por debajo del nivel actual">Percentil</th><th>Evolución</th></tr></thead><tbody>
    ${rows.map((x) => `<tr><td>${x.t}</td><td class="num"><strong>${nf(x.cur, x.dc)}</strong></td><td class="num">${nf(x.med, x.dc)}</td><td class="num">${nf(x.lo, x.dc)} – ${nf(x.hi, x.dc)}</td>
      <td class="num"><span class="lab-v lab-${x.cheap ? "ok" : x.dear ? "bad" : "sin"}">${x.p}</span></td><td>${sp(x.s, x.med)}</td></tr>`).join("")}</tbody></table></div>
    <div class="tes-ver lab-v lab-${nC > nD ? "ok" : nD > nC ? "bad" : "sin"}">${nC > nD ? "Barata frente a su propia historia" : nD > nC ? "Cara frente a su propia historia" : "En su rango habitual"}</div>
    <div class="method">Mensual, con el último ejercicio publicado (se supone conocido el 1 de abril siguiente). Verde: en el 25 % más barato de su historia; rojo: en el 25 % más caro. Pocas observaciones anuales: úsalo como orientación.</div></div>`;
}

function peersBox(r, uni) {
  const same = (x) => (T.peers === "industria" ? x.industria && x.industria === r.industria : x.sector === r.sector);
  let pool = uni.filter((x) => x.sym !== r.sym && same(x) && x.mcap);
  if (T.peers === "industria" && pool.length < 3) pool = uni.filter((x) => x.sym !== r.sym && x.sector === r.sector && x.mcap);
  const peers = pool.sort((a, b) => Math.abs(Math.log(a.mcap / r.mcap)) - Math.abs(Math.log(b.mcap / r.mcap))).slice(0, 8);
  const C = [["mcap", "Capitaliz.", (v, x) => F().big(v, x.moneda)], ["per", "PER", (v) => nf(v, 1)], ["per_fwd", "PER prev.", (v) => nf(v, 1)], ["ev_ebitda", "EV/EBITDA", (v) => nf(v, 1)],
    ["pb", "P/VC", (v) => nf(v, 2)], ["margen_op", "Margen op.", (v) => F().pct(v)], ["roe", "ROE", (v) => F().pct(v)], ["crec_ventas", "Crec. ventas", (v) => F().spct(v)],
    ["deuda_neta_ebitda", "DN/EBITDA", (v) => (v == null ? "—" : nf(v, 1) + "×")], ["r1a", "Rent. 1 año", (v) => F().spct(v)], ["score", "Puntuación", (v) => (v == null ? "—" : String(v))]];
  const med = (k) => { const s = peers.map((x) => x[k]).filter((v) => v != null && (!["per", "per_fwd", "ev_ebitda", "pb"].includes(k) || v > 0)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const LOWER = ["per", "per_fwd", "ev_ebitda", "pb", "deuda_neta_ebitda"];
  const diff = (k) => { const m = med(k), v = r[k]; if (m == null || v == null || k === "mcap" || k === "score") return ""; if (["per", "per_fwd", "ev_ebitda", "pb"].includes(k)) { if (!(v > 0) || !(m > 0)) return ""; const d = (v / m - 1) * 100; return `<span class="chg ${F().cls(-d)}">${F().spct(d, 0)}</span>`; }
    const d = v - m; return `<span class="chg ${F().cls(LOWER.includes(k) ? -d : d)}">${sgn(d, 1)}${k === "deuda_neta_ebitda" ? "×" : " pp"}</span>`; };
  return `<div class="box"><b>Comparables</b> <span class="bar" style="display:inline-flex;margin-left:8px">${[["industria", "Misma industria"], ["sector", "Mismo sector"]].map(([k, t]) => `<button class="chip ${T.peers === k ? "on" : ""}" data-tpeers="${k}">${t}</button>`).join("")}</span>
    ${peers.length ? `<div class="lab-tw"><table class="tes-peers"><thead><tr><th>Valor</th>${C.map(([, t]) => `<th>${t}</th>`).join("")}</tr></thead><tbody>
      <tr class="tes-self"><td><strong>${esc(r.sym)}</strong></td>${C.map(([k, , f]) => `<td class="num"><strong>${f(r[k], r)}</strong></td>`).join("")}</tr>
      ${peers.map((x) => `<tr class="tes-row" data-topen="${esc(x.sym)}"><td><span class="link-btn">${esc(x.sym)}</span> <span class="hint">${esc((x.nombre || "").slice(0, 22))}</span></td>${C.map(([k, , f]) => `<td class="num">${f(x[k], x)}</td>`).join("")}</tr>`).join("")}
      <tr class="tes-med"><td>Mediana comparables</td>${C.map(([k, , f]) => `<td class="num">${k === "mcap" ? "" : k === "score" ? nf(med(k), 0) : f(med(k), r)}</td>`).join("")}</tr>
      <tr class="tes-med"><td>${esc(r.sym)} frente a la mediana</td>${C.map(([k]) => `<td class="num">${diff(k)}</td>`).join("")}</tr></tbody></table></div>
      <div class="method">Hasta 8 valores del universo de ${T.peers === "industria" && pool.some((x) => x.industria === r.industria) ? "su industria" : "su sector"} con capitalización más parecida. Múltiplos: diferencia en %; verde = más barato o mejor. Pulsa un valor para abrir su ficha.</div>`
      : '<div class="hint">No hay comparables en el universo.</div>'}</div>`;
}

async function catalysts(r) {
  let d = {}; try { d = await window.SCRChart.loadPrices(r.sym); } catch (e) { /* sin eventos */ }
  const ev = d.ev || {}, today = new Date().toISOString().slice(0, 10), items = [];
  const days = (f) => Math.round((new Date(f) - new Date(today)) / 864e5);
  const ern = ev.ern || [], next = ern.find((x) => x[2] == null && x[0] >= today)?.[0] || (r.resultados >= today ? r.resultados : null);
  const past = ern.filter((x) => x[3] != null).slice(-4), beats = past.filter((x) => x[3] > 0).length;
  if (next) items.push([next, "Resultados", `Publica resultados${past.length ? `. Superó la previsión de BPA en ${beats} de los últimos ${past.length}` : ""}.`, "resultados"]);
  const dv = (ev.div || []).map((x) => x[0]).sort();
  if (dv.length >= 2) { const gaps = dv.slice(1).map((x, i) => (new Date(x) - new Date(dv[i])) / 864e5), g = gaps.slice(-4).sort((a, b) => a - b)[Math.floor(Math.min(4, gaps.length) / 2)];
    let nx = new Date(new Date(dv[dv.length - 1]).getTime() + g * 864e5); while (nx.toISOString().slice(0, 10) < today) nx = new Date(nx.getTime() + g * 864e5);
    if (g > 20 && g < 400) items.push([nx.toISOString().slice(0, 10), "Dividendo (estimado)", `Fecha ex-dividendo estimada por su calendario habitual (cada ~${Math.round(g / 30)} meses).`, "div"]); }
  if (r.invalidacion) items.push([null, "Nivel técnico", `El técnico ${String(r.veredicto || "").toLowerCase()} se invalida si cierra ${r.veredicto === "Alcista" ? "por debajo" : "por encima"} de ${nf(r.invalidacion, 2)}.`, "tec"]);
  if (r.soporte || r.resistencia) items.push([null, "Soporte / resistencia", `${nf(r.soporte, 2)} / ${nf(r.resistencia, 2)} ${esc(r.moneda || "")}.`, "tec"]);
  if (r.precio_objetivo && r.precio) items.push([null, "Consenso de analistas", `Precio objetivo medio ${nf(r.precio_objetivo, 2)} (${F().spct((r.precio_objetivo / r.precio - 1) * 100, 0)}), ${r.n_analistas || "?"} analistas.`, "ana"]);
  const nw = (ev.news || []).filter((n) => n[1] !== "otras" && days(n[0]) >= -30).slice(0, 5);
  return `<div class="box"><b>Catalizadores</b><ul class="tes-cat">
    ${items.filter((x) => x[0]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([f, t, x]) => `<li><span class="tes-date num">${fmtDate(f)}<small>${days(f) === 0 ? "hoy" : days(f) > 0 ? "en " + days(f) + " días" : ""}</small></span><div><strong>${t}</strong> ${esc(x)}</div></li>`).join("")}
    ${items.filter((x) => !x[0]).map(([, t, x]) => `<li><span class="tes-date">—</span><div><strong>${t}</strong> ${esc(x)}</div></li>`).join("")}
    ${nw.map((n) => `<li><span class="tes-date num">${fmtDate(n[0])}</span><div><span class="tg tg-n-${n[1]}">${esc(n[1])}</span> ${n[3] ? `<a href="${esc(n[3])}" target="_blank" rel="noopener">${esc(n[2])}</a>` : esc(n[2])}</div></li>`).join("")}
    ${!items.length && !nw.length ? '<li class="hint">Sin catalizadores identificados en la fuente.</li>' : ""}</ul>
    <div class="method">Revisiones de estimaciones de analistas: sin fuente pública fiable. Noticias relevantes de los últimos 30 días, clasificadas por palabras clave.</div></div>`;
}

function thesis(r, d, ctx, I) {
  const f = ctx.fact || {}, av = Object.entries(f).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
  const pros = av.filter(([, v]) => v >= 65).slice(0, 2), cons = av.filter(([, v]) => v <= 35).slice(-2).reverse();
  const lines = [];
  const vs = cagr(d.anual, "ventas");
  const fcf = I.ttm ?? I.lastF, ev = r.mcap + (I.nd || 0), res = fcf > 0 && !FIN.test(r.industria || "") && !(r.moneda_fin && r.moneda && r.moneda_fin !== r.moneda) ? implied(ev, fcf, I.r0 / 100, 0.025, 10) : null;
  if (res?.g != null) lines.push(`<strong>Qué paga el mercado:</strong> un crecimiento del flujo de caja libre del ${nf(res.g * 100, 1)} % anual durante 10 años${vs ? `, frente a un ${nf(vs.v, 1)} % de crecimiento de ventas en ${vs.desde}-${vs.hasta}` : ""}.`);
  if (pros.length) lines.push(`<strong>A favor:</strong> ${pros.map(([k, v]) => `${FN[k]} (${Math.round(v)}/100)`).join(" y ")}${r.veredicto === "Alcista" ? "; técnico alcista" : ""}.`);
  const risk = cons.map(([k, v]) => `${FN[k]} (${Math.round(v)}/100)`);
  if (r.deuda_neta_ebitda > 3) risk.push(`apalancamiento de ${nf(r.deuda_neta_ebitda, 1)}× EBITDA`);
  if (r.veredicto === "Bajista") risk.push("técnico bajista");
  if (risk.length) lines.push(`<strong>En contra:</strong> ${risk.join(", ")}.`);
  const inv = [];
  if (r.invalidacion) inv.push(`cierre ${r.veredicto === "Alcista" ? "por debajo" : "por encima"} de ${nf(r.invalidacion, 2)}`);
  if (r.resultados && r.resultados >= new Date().toISOString().slice(0, 10)) inv.push(`resultados del ${fmtDate(r.resultados)} con crecimiento por debajo de lo que descuenta el precio`);
  if (inv.length) lines.push(`<strong>Qué la invalidaría:</strong> ${inv.join("; ")}.`);
  return `<div class="box tes-th"><b>Tesis en cuatro líneas</b>${lines.length ? `<ul>${lines.map((x) => `<li>${x}</li>`).join("")}</ul>` : '<div class="hint">Sin datos suficientes.</div>'}
    <div class="method">Generada con reglas a partir de los datos de esta ficha (puntuación, DCF inverso y técnico). No es una recomendación de inversión.</div></div>`;
}

function html(r, d, ctx) {
  if (T.sym !== r.sym) { T.sym = r.sym; T.r = null; }
  const I = inputs(r, d);
  return `${thesis(r, d, ctx, I)}<div class="f-grid"><div id="tdcf">${dcfBox(r, d, I)}</div><div>${histBox(r, d)}<div id="tcat"><div class="skel" style="height:160px"></div></div></div></div><div id="tpeers">${peersBox(r, ctx.uni)}</div>`;
}
function mount(el, r, d, ctx) {
  el.innerHTML = html(r, d, ctx);
  catalysts(r).then((h) => { const c = el.querySelector("#tcat"); if (c && T.sym === r.sym) c.innerHTML = h; });
  const I = () => inputs(r, d);
  el.oninput = (e) => { const k = e.target.dataset.tset; if (!k) return; T[k] = +e.target.value; el.querySelector("#tdcf").innerHTML = dcfBox(r, d, I()); };
  el.onclick = (e) => { let b;
    if ((b = e.target.closest("[data-tbase]"))) { T.base = b.dataset.tbase; store.set("tesis_base", T.base); el.querySelector("#tdcf").innerHTML = dcfBox(r, d, I()); }
    else if ((b = e.target.closest("[data-tpeers]"))) { T.peers = b.dataset.tpeers; store.set("tesis_peers", T.peers); el.querySelector("#tpeers").innerHTML = peersBox(r, ctx.uni); }
    else if ((b = e.target.closest("[data-topen]"))) { e.stopPropagation(); window.SCROpen?.(b.dataset.topen); } };
}
window.SCRTesis = { mount, implied, pv };
})();
