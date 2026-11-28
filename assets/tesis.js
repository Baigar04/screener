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


/* ---------- R3 · Escenarios a largo plazo (reglas fijadas el 28-nov-2026, antes de mirar resultados) ----------
   Ventas: crecen 5 años al ritmo del escenario y convergen en línea recta al crecimiento a perpetuidad en los años 6-10.
   Ritmo base = media del crecimiento anual compuesto de las ventas de su historia y el del último ejercicio, acotada entre −5 % y 25 %.
   Bajista / alcista = base ∓ la dispersión de su crecimiento anual (desviación típica, entre 3 y 10 puntos; el alcista, hasta 35 %).
   Margen de caja (FCF / ventas): base = mediana de sus ejercicios; bajista = el peor, sin bajar de la mitad de la mediana;
   alcista = el mejor, sin pasar de 1,5 veces la mediana. Descuento = bono a 10 años de la divisa de sus cuentas + beta (0,8-2) × 5 %,
   entre 6 % y 14 %;
   perpetuidad 2,5 % (como mucho, el descuento − 3 puntos). Valor por acción = (valor presente de los flujos − deuda neta) / acciones.
   «Qué descuenta el precio» = ritmo de ventas de 5 años que iguala el valor base al precio con el margen mediano.
   Si las cuentas van en otra divisa, el valor se pasa a la de cotización con el último cambio semanal (Yahoo, vía stress.json).
   Son escenarios para entender qué hace falta que pase, no probabilidades ni precios objetivo.
   Cambios tras la primera prueba con datos reales (28-nov, antes de publicar): «último año» salía del dato trimestral de Yahoo
   (error: Samsung +127 %) y pasa a ser el último ejercicio de las cuentas; el suelo de la beta sube de 0,5 a 0,8 porque con 0,5
   el descuento de valores defensivos europeos quedaba en el 6 % y daba valores desproporcionados; conversión de divisa añadida. */
function histCaja(r, d) {
  const fy = d?.sec?.fy, out = [];
  if (Array.isArray(fy) && fy.length >= 4) {
    fy.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-8).forEach((x) => { if (x[2] > 0 && x[7] != null && x[8] != null) out.push({ y: String(x[0]).slice(0, 4), v: x[2], f: x[7] - x[8] }); });
    if (out.length >= 4) return { rows: out, src: "SEC 10-K" };
    out.length = 0;
  }
  const an = d?.anual || {};
  Object.keys(an).sort().forEach((y) => { const a = an[y]; if (a?.ventas > 0 && a.fcf != null) out.push({ y, v: a.ventas, f: a.fcf }); });
  return { rows: out, src: "Yahoo Finance" };
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function tipo10(moneda) {
  const c = String(moneda || "").toUpperCase().slice(0, 3) === "GBP" ? "GBP" : String(moneda || "").toUpperCase();
  const T = window.SCRStress?.data?.()?.tipos10 || {};
  if (T[c]) return { v: T[c].valor, src: `bono a 10 años en ${c} (${T[c].fuente}, ${T[c].fecha})`, local: true };
  const us = H.S.data?.series?.us10y?.valor, ez = H.S.data?.series?.ez10y?.valor;
  if (c === "EUR" && ez != null) return { v: ez, src: "curva AAA del euro a 10 años (BCE)", local: true };
  return { v: us ?? 4.2, src: `bono de EE. UU. a 10 años${c && c !== "USD" ? `, por falta de serie oficial en ${c}` : ""}`, local: c === "USD" };
}
function eurPor(c) {
  if (c === "EUR") return { v: 1 };
  const x = window.SCRStress?.data?.()?.divisas?.fx?.[c], last = x?.serie?.[x.serie.length - 1];
  return last && last[1] > 0 ? { v: last[1], f: last[0], src: x.fuente } : null;
}
function escenarios(r, d, o = {}) {
  if (FIN.test(r.industria || "")) return { na: "No aplica a bancos, aseguradoras y gestoras: su flujo de caja es su materia prima. Para ellas cuenta el P/VC frente a su historia y el ROE." };
  const mp = String(r.moneda || ""), mf = String(r.moneda_fin || mp);
  const pence = mp === "GBp" || mp === "GBX";
  const cf = mf.toUpperCase().slice(0, 3), cp = pence ? "GBP" : mp.toUpperCase().slice(0, 3);
  let fxr = 1, fxs = null;
  if (cf !== cp) {
    const a = eurPor(cf), b = eurPor(cp);
    if (!a || !b) return { na: `Las cuentas están en ${mf} y la acción cotiza en ${mp}: sin tipo de cambio ${cf}/${cp} en las fuentes del screener, el valor por acción no sería comparable.` };
    fxr = a.v / b.v; fxs = `1 ${cf} = ${nf(fxr, 4)} ${cp} (Yahoo, semana del ${a.f || b.f})`;
  }
  const HC = histCaja(r, d), rows = HC.rows;
  if (rows.length < 3) return { na: "Hacen falta al menos 3 ejercicios con ventas y flujo de caja libre." };
  const shares = r.acciones;
  if (!(shares > 0) || !(r.precio > 0)) return { na: "Sin número de acciones o precio en la fuente." };
  const ms = rows.slice(-5).map((x) => x.f / x.v).filter(Number.isFinite), mBase = med(ms);
  const nd = r.deuda != null && r.caja != null ? r.deuda - r.caja : null;
  if (!(mBase > 0)) return { na: `Su flujo de caja libre mediano es negativo (${nf(mBase * 100, 1)} % de las ventas): el precio descuenta un cambio de rumbo, no una continuación, y un flujo descontado no lo puede medir.`, neg: true };
  const mBear = Math.max(Math.min(...ms), mBase / 2), mBull = Math.min(Math.max(...ms), mBase * 1.5);
  const gs = []; for (let i = 1; i < rows.length; i++) gs.push((rows[i].v / rows[i - 1].v - 1) * 100);
  const n = rows.length - 1, cg = ((rows[n].v / rows[0].v) ** (1 / n) - 1) * 100;
  const lastG = (rows[n].v / rows[n - 1].v - 1) * 100;
  const parts = [cg, lastG].filter(Number.isFinite), gBase = clamp(parts.reduce((a, b) => a + b, 0) / parts.length, -5, 25);
  const mu = gs.reduce((a, b) => a + b, 0) / gs.length, sd = gs.length >= 2 ? Math.sqrt(gs.reduce((a, b) => a + (b - mu) ** 2, 0) / (gs.length - 1)) : 5;
  const sig = clamp(sd, 3, 10), gBear = gBase - sig, gBull = Math.min(35, gBase + sig);
  const rf = tipo10(cf), beta = r.beta != null ? clamp(r.beta, 0.8, 2) : 1;
  const k = (o.r != null ? o.r : clamp(rf.v + beta * ERP, 6, 14)) / 100, gt = Math.min(o.gt != null ? o.gt : 2.5, k * 100 - 3) / 100;
  const v0 = rows[n].v, fx = fxr * (pence ? 100 : 1);
  const value = (g, m) => {
    let V = v0, pvs = 0, F = 0;
    for (let t = 1; t <= 10; t++) { const gg = t <= 5 ? g / 100 : g / 100 + (gt - g / 100) * ((t - 5) / 5); V *= 1 + gg; F = V * m; pvs += F / (1 + k) ** t; }
    const ev = pvs + (F * (1 + gt)) / (k - gt) / (1 + k) ** 10;
    return ((ev - (nd || 0)) / shares) * fx;
  };
  const S = [["Bajista", gBear, mBear], ["Base", gBase, mBase], ["Alcista", gBull, mBull]].map(([t, g, m]) => { const px = value(g, m); return { t, g, m: m * 100, px, up: px > 0 ? (px / r.precio - 1) * 100 : null }; });
  let gi = null, lo = -30, hi = 60;
  if (value(hi, mBase) < r.precio) gi = { above: true };
  else if (value(lo, mBase) > r.precio) gi = { below: true };
  else { for (let i = 0; i < 70; i++) { const m = (lo + hi) / 2; if (value(m, mBase) > r.precio) hi = m; else lo = m; } gi = { g: (lo + hi) / 2 }; }
  return { S, gi, cg, n, last: lastG, fxs, sig, mBase: mBase * 100, k: k * 100, gt: gt * 100, rf, beta, nd, src: HC.src, desde: rows[0].y, hasta: rows[n].y, moneda: mp };
}
function lecturaLargo(E) {
  if (!E || E.na) return null;
  const b = E.S[1];
  if (E.gi?.above) return "El precio pide más del 60 % anual de crecimiento de ventas durante 5 años con su margen actual: cotiza por expectativas que sus cuentas no muestran todavía.";
  if (E.gi?.below) return "El precio descuenta que las ventas caigan más de un 30 % al año: el mercado duda de la continuidad del negocio o de sus cuentas.";
  const gap = E.gi.g - E.cg;
  const exig = gap <= -3 ? "menos crecimiento del que ha tenido" : gap <= 3 ? "un crecimiento parecido al de su historia" : gap <= 10 ? "acelerar respecto a su historia" : "un crecimiento muy superior al de su historia";
  return `El precio descuenta ventas a ${sgn(E.gi.g, 1)} % anual durante 5 años (su historia: ${sgn(E.cg, 1)} %), es decir, ${exig}. En el escenario base vale ${b.px > 0 ? nf(b.px, 2) : "menos de cero"}${b.up != null ? ` (${sgn(b.up, 0)} % frente al precio)` : ""}.`;
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
  /* escenarios: el mismo motor que el Informe (R3), con la tasa y la perpetuidad de los controles */
  const E = escenarios(r, d, { r: T.r, gt: T.gt });
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
    ${E && !E.na ? `<div class="lab-tw"><table><thead><tr><th>Escenario</th><th>Ventas 5 años</th><th>Margen de caja</th><th>Valor por acción</th><th>Frente al precio</th></tr></thead><tbody>
      ${E.S.map((x) => `<tr><td>${x.t}</td><td class="num">${sgn(x.g, 1)} %</td><td class="num">${nf(x.m, 1)} %</td><td class="num">${x.px > 0 ? nf(x.px, 2) : "negativo"}</td><td class="num chg ${F().cls(x.up)}">${x.px > 0 ? F().spct(x.up, 0) : "—"}</td></tr>`).join("")}
      ${r.precio_objetivo ? `<tr><td>Analistas (${r.n_analistas || "?"})</td><td></td><td class="num">${nf(r.precio_objetivo, 2)}</td><td class="num chg ${F().cls(r.precio_objetivo / r.precio - 1)}">${F().spct((r.precio_objetivo / r.precio - 1) * 100, 0)}</td></tr>` : ""}</tbody></table></div>` : ""}
    <div class="method">Valor empresa = capitalización ${F().big(r.mcap, r.moneda)} + deuda neta ${I.nd == null ? "(sin dato: se toma 0)" : F().big(I.nd, r.moneda)}.
      Tasa por defecto = bono a 10 años (${nf(I.rf, 2)} %) + beta ${nf(I.beta, 2)} × ${ERP} % de prima de mercado. Escenarios: los mismos del Informe (ventas y margen de caja de su historia; reglas en el Informe), con la tasa y la perpetuidad de estos controles.
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
  const mc = (x) => x.mcap_usd ?? x.mcap;
  let pool = uni.filter((x) => x.sym !== r.sym && same(x) && mc(x));
  if (T.peers === "industria" && pool.length < 3) pool = uni.filter((x) => x.sym !== r.sym && x.sector === r.sector && mc(x));
  const peers = pool.sort((a, b) => Math.abs(Math.log(mc(a) / mc(r))) - Math.abs(Math.log(mc(b) / mc(r)))).slice(0, 8);
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
window.SCRTesis = { mount, implied, pv, escenarios, lecturaLargo, tipo10 };
})();
