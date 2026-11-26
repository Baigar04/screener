/* Screener · Stress tests, riesgo de divisas y Escenarios con propuesta (hoja de ruta definitiva, fase 3).
   Datos: data/stress.json (scripts/fetch_stress.py). No predice: mide cuánto perdería cada valor y cada cartera si se repite
   cada escenario. Crisis: lo que hizo de verdad (o estimado por beta si no cotizaba). Choques: regresión mensual con su R².
   Cartera › Escenarios: cartera frente al índice elegido, quién explica el peor caso, mapa de calor, divisas (para un inversor
   en euros), CVaR a 3 meses y una propuesta por reglas fijas que se puede registrar en el Diario. */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate, store } = H;
const R = { d: undefined, loading: false, px: {}, cvar: {} };

async function ensure() {
  if (R.loading || R.d !== undefined) return;
  R.loading = true;
  try { const r = await fetch(`data/stress.json?t=${Date.now()}`, { cache: "no-store" }); R.d = r.ok ? await r.json() : null; } catch { R.d = null; }
  R.loading = false;
  if (["escenarios", "hoy", "carteras"].includes(H.S.view) || H.S.ficha) H.render();
}
const X = () => H.S.mode === "x";
const exp = (t) => (X() ? `<div class="rsk-exp">${t}</div>` : "");
const s0 = (v) => (Math.abs(v) < 0.5 ? "0" : sgn(v, 0));
const pc = (v, d = 1) => (v == null || isNaN(v) ? "—" : `${sgn(v, d)} %`);
const eur = (v) => (v == null || isNaN(v) ? "—" : `${v < 0 ? "−" : ""}${nf(Math.abs(v), 0)} €`);
const E = () => R.d?.escenarios || [];
const NC = () => E().filter((e) => e.tipo === "crisis").length;
const MCUR = { sp500: "USD", ndx: "USD", eem: "USD", ftse: "GBP", n225: "JPY", hsi: "HKD" };
const curOf = (c) => (c === "GBp" || c === "GBX" ? "GBP" : c || "EUR");

/* ---------- reglas (las mismas que scripts/fetch_stress.py): clasificación frente a su bolsa, no un modelo de previsión ---------- */
const UMB = { crisis: { rompe: [-60, -15], tension: [null, -5] }, choque: { rompe: [-20, -8], tension: [null, -3] } };
const SHORT = { c2008: "2008", c2011: "2011", c2020: "COVID", c2022: "2022", tipos: "Tipos", petroleo: "Petróleo", credito: "Crédito", dolar: "Dólar",
  rusia: "Escalada rusa", paz: "Paz Ucrania", taiwan: "Taiwán", capex: "Capex IA" };
const short = (e) => SHORT[e.id] || label(e);
function verdict(v, ref, tipo) {
  if (v == null) return null;
  const u = R.d?.umbral?.[tipo]?.tension?.[0] === null ? R.d.umbral[tipo] : UMB[tipo], d = ref != null ? v - ref : 0;
  if (v <= u.rompe[0] || d <= u.rompe[1]) return "Rompe";
  if ((u.tension[0] != null && v <= u.tension[0]) || d <= u.tension[1]) return "Tensión";
  return "Aguanta";
}
const VCLS = { Rompe: "ko", "Tensión": "te", Aguanta: "ok" };
const vpill = (v) => (v ? `<span class="ui-pill ${VCLS[v]}">${v}</span>` : `<span class="ui-pill nu">s. d.</span>`);
function fiab(e, q) {
  if (q == null) return ["—", "nu"];
  if (e.tipo === "crisis") return q >= 1 ? ["Alta", "ok"] : ["Media", "te"];
  return q >= 0.25 ? ["Alta", "ok"] : q >= 0.1 ? ["Media", "te"] : ["Baja", "nu"];
}
function baseTxt(e, q, b) {
  if (q == null) return "sin datos";
  if (e.tipo === "crisis") return q >= 1 ? "Real (Yahoo)" : `Estimado · beta ${nf(b, 2)} × su bolsa`;
  return `R² ${nf(q, 2)}`;
}
const label = (e) => e.etiqueta || e.nombre;
const mag = (e, mk) => {
  if (!e.magnitud) return "";
  if (typeof e.magnitud === "string") return e.magnitud;
  const z = { sp500: "EE. UU.", ndx: "EE. UU.", eem: "EE. UU.", hsi: "EE. UU.", ftse: "Reino Unido", n225: "Japón" }[mk] || "Alemania";
  return `${e.magnitud[z] || ""} (${z})`;
};

/* ---------- valor ---------- */
const val = (sym) => R.d?.valores?.[sym] || null;
const idx = (k) => R.d?.indices?.[k] || null;
function symRows(sym) {
  const V = val(sym); if (!V) return null;
  const I = idx(V.m);
  return E().map((e, j) => {
    const v = V.v[j], ref = I ? I.v[j] : null;
    return { e, v, ref, q: V.q[j], ver: verdict(v, ref, e.tipo), b: V.b };
  });
}
/* columna «Estrés» de «Hoy»: peor crisis y escenarios en que rompe */
function cell(sym) {
  if (R.d === undefined) { ensure(); return null; }
  const rows = symRows(sym); if (!rows) return null;
  const w = rows.filter((r) => r.v != null).sort((a, b) => a.v - b.v)[0], nr = rows.filter((r) => r.ver === "Rompe").length, nt = rows.filter((r) => r.ver === "Tensión").length;
  if (!w) return null;
  const v = nr ? "Rompe" : nt ? "Tensión" : "Aguanta";
  return `<span class="ui-pill ${VCLS[v]}" data-tip="${esc(`Peor escenario: ${label(w.e)} ${pc(w.v, 0)} · rompe en ${nr} y tensión en ${nt} de ${rows.length} escenarios`)}">${v}</span>`;
}
function bar(v, mx) {
  if (v == null) return "";
  const w = Math.min(50, (Math.abs(v) / mx) * 50);
  return `<span class="st-bar"><i class="${v < 0 ? "n" : "p"}" style="${v < 0 ? `right:50%` : `left:50%`};width:${w.toFixed(1)}%"></i></span>`;
}
/* Ficha › Riesgo y escenarios: tabla de stress test (el balance lo calcula la ficha y llega en B) */
function fichaHTML(r, B) {
  if (R.d === undefined) { ensure(); return `<div class="skel" style="height:420px"></div>`; }
  const rows = symRows(r.sym), I = rows && idx(val(r.sym).m);
  const mx = rows ? Math.max(10, ...rows.flatMap((x) => [Math.abs(x.v || 0), Math.abs(x.ref || 0)])) : 10;
  const nr = rows ? rows.filter((x) => x.ver === "Rompe").length : 0, nt = rows ? rows.filter((x) => x.ver === "Tensión").length : 0;
  const worst = rows ? rows.filter((x) => x.v != null).sort((a, b) => a.v - b.v)[0] : null;
  const better = rows ? rows.filter((x) => x.v != null && x.ref != null && x.v > x.ref + 3).map((x) => label(x.e)) : [];
  const tbl = !rows ? `<div class="hint">${R.d ? "Sin historia de precios suficiente para este valor." : "Los stress tests llegan con la próxima actualización automática."}</div>` : `
    <div class="rsk-scroll"><table class="rsk-t st-tbl"><thead><tr><th>Escenario</th><th class="num">${esc(r.sym)}</th><th class="num">${esc(I?.nombre || "Bolsa")}</th><th class="st-bc"></th><th>Veredicto</th><th>Base del cálculo</th><th>Fiabilidad</th></tr></thead><tbody>
    ${rows.map((x, j) => { const [fl, fc] = fiab(x.e, x.q); return `${j === NC() ? `<tr class="rsk-grp"><td colspan="7">Choques de un mes · misma talla para todos (2 desviaciones típicas desde 2007) · regresión mensual</td></tr>` : j === 0 ? `<tr class="rsk-grp"><td colspan="7">Crisis históricas · del máximo al mínimo del S&P 500</td></tr>` : ""}
      <tr><td data-tip="${esc(`${x.e.desc}${x.e.desde ? ` · ${fmtDate(x.e.desde)} – ${fmtDate(x.e.hasta)}` : ""}${mag(x.e, val(r.sym).m) ? ` · ${mag(x.e, val(r.sym).m)}` : ""}`)}">${esc(x.e.nombre)}${x.e.tipo === "choque" && mag(x.e, val(r.sym).m) ? ` <span class="st-mag">${esc(mag(x.e, val(r.sym).m))}</span>` : ""}</td>
      <td class="num ${x.v < 0 ? "neg" : "pos"}">${pc(x.v, 0)}</td><td class="num st-fa">${pc(x.ref, 0)}</td><td class="st-bc">${bar(x.v, mx)}</td><td>${vpill(x.ver)}</td>
      <td class="st-fa">${esc(baseTxt(x.e, x.q, x.b))}</td><td><span class="st-f ${fc}">${fl}</span></td></tr>`; }).join("")}</tbody></table></div>`;
  const lect = rows ? H.ui.lectura([
    worst ? `Su peor escenario es ${label(worst.e)}: ${pc(worst.v, 0)} frente a ${pc(worst.ref, 0)} de ${I?.nombre || "su bolsa"}.` : null,
    `Rompe en ${nr} y queda en tensión en ${nt} de ${rows.length} escenarios.${better.length ? ` Aguanta mejor que su bolsa en ${better.slice(0, 3).join(", ")}${better.length > 3 ? " y otros" : ""}.` : ""}`,
    rows.some((x) => x.e.tipo === "choque" && x.q != null && x.q < 0.1) ? "Los choques con fiabilidad baja (R² < 0,10) son orientativos: el factor explica poco de lo que hace el valor." : null,
  ]) : "";
  return `<div class="st-ficha"><section class="rsk-p"><h3>Stress test <span>caída estimada y de dónde sale cada cifra · en ${esc(r.moneda || "su moneda")}</span></h3>${tbl}${lect}
    ${exp(`<b>Cómo leerlo.</b> Las crisis son lo que hizo de verdad la acción (con dividendos) entre el máximo y el mínimo del S&P 500 de cada episodio; si no cotizaba, se estima con su beta frente a su bolsa (fiabilidad media). Los choques salen de una regresión con datos mensuales desde 2007: el efecto de un movimiento de dos desviaciones típicas del factor en un mes. El R² dice cuánto del movimiento del valor explica el factor; por debajo de 0,10 la cifra es orientativa. <b>Veredicto</b> (reglas fijas, frente a su bolsa): en crisis, «Rompe» si cae 15 puntos más que su bolsa o más del 60 %; «Tensión» si cae 5 puntos más. En choques de un mes: «Rompe» 8 puntos peor que su bolsa o más del 20 %; «Tensión» 3 puntos peor. Caer en una crisis no es romperse: lo que se mide es si lo hace mucho peor que su mercado.`)}</section>
    ${B}</div>`;
}

/* ---------- cartera ---------- */
function sources() {
  const w = window.SCREq?.watch?.() || [], C = store.get("carteras", []) || [];
  return [["w", `Watchlist (${w.length} valores, mismo peso)`], ...C.map((p) => [p.id, `${p.nombre} (${p.items.length})`])];
}
function positions(src) {
  const uni = window.SCRUni ? window.SCRUni() : [], by = Object.fromEntries(uni.map((r) => [r.sym, r]));
  if (src === "w") {
    const w = (window.SCREq?.watch?.() || []).filter((s) => by[s]);
    return { pos: w.map((s) => ({ sym: s, w: 1 / w.length, r: by[s] })), capital: null, nombre: "Watchlist" };
  }
  const p = (store.get("carteras", []) || []).find((x) => x.id === src); if (!p) return { pos: [], capital: null };
  const cur = p.items.filter((x) => by[x.sym]).map((x) => ({ sym: x.sym, r: by[x.sym], raw: x.w * (x.p0 && by[x.sym].precio ? by[x.sym].precio / x.p0 : 1), p0: x.p0 }));
  const t = cur.reduce((a, x) => a + x.raw, 0) || 1;
  const val = cur.reduce((a, x) => a + x.raw, 0) / (p.items.reduce((a, x) => a + x.w, 0) || 1);
  return { pos: cur.map((x) => ({ ...x, w: x.raw / t })), capital: p.capital * val, nombre: p.nombre, creada: p.creada, id: p.id };
}
/* efecto de cada escenario para un inversor en euros: crisis con el cambio de su divisa en ese tramo; choque del dólar con la traslación */
function eurEffect(v, j, ccy) {
  if (v == null) return null;
  const e = E()[j], c = curOf(ccy), FX = R.d?.divisas?.fx || {};
  if (c === "EUR") return v;
  if (e.tipo === "crisis") { const f = FX[c]?.crisis?.[j]; return f == null ? v : ((1 + v / 100) * (1 + f / 100) - 1) * 100; }
  if (e.id === "dolar" && (c === "USD" || c === "HKD") && e.traslacion != null) return ((1 + v / 100) * (1 + e.traslacion / 100) - 1) * 100;
  return v;
}
function calc(P, mkey, hedge = false) {
  const n = E().length;
  const rows = P.pos.map((p) => {
    const V = val(p.sym), I = V ? idx(V.m) : null, ccy = hedge ? "EUR" : curOf(p.r.moneda);
    const loc = E().map((e, j) => { const v = V?.v[j] ?? (I ? I.v[j] : null); return v; });
    const fill = E().map((e, j) => V?.v[j] == null);
    const eurv = loc.map((v, j) => eurEffect(v, j, ccy));
    const ver = E().map((e, j) => verdict(V?.v[j] ?? null, I ? I.v[j] : null, e.tipo));
    return { ...p, V, I, loc, eurv, fill, ver, nr: ver.filter((x) => x === "Rompe").length, nt: ver.filter((x) => x === "Tensión").length };
  });
  const port = Array.from({ length: n }, (_, j) => rows.reduce((a, x) => a + x.w * (x.eurv[j] ?? 0), 0));
  const B = idx(mkey), bcur = MCUR[mkey] || "EUR";
  const bench = Array.from({ length: n }, (_, j) => (B ? eurEffect(B.v[j], j, bcur) : null));
  const pv = port.map((v, j) => verdict(v, bench[j], E()[j].tipo));
  let wj = 0; port.forEach((v, j) => { if (v < port[wj]) wj = j; });
  const contrib = rows.map((x) => ({ sym: x.sym, nombre: x.r.nombre, w: x.w, pp: x.w * (x.eurv[wj] ?? 0) })).sort((a, b) => a.pp - b.pp);
  return { rows, port, bench, pv, wj, contrib, missing: rows.filter((x) => !x.V).length, filled: rows.reduce((a, x) => a + x.fill.filter(Boolean).length, 0) };
}
/* CVaR 95 % a 3 meses: media del peor 5 % de las rentabilidades de 63 sesiones (5 años, pesos actuales, en moneda local) */
async function loadPx(sym) {
  if (R.px[sym] !== undefined) return R.px[sym];
  R.px[sym] = null;
  try { const r = await fetch(`data/p/${encodeURIComponent(sym)}.json`); if (r.ok) { const d = await r.json(); R.px[sym] = { t: d.t, c: d.c }; } } catch { /* sin precios */ }
  return R.px[sym];
}
function cvar(pos, W) {
  const S = pos.map((p) => R.px[p.sym]).filter(Boolean); if (S.length < pos.length * 0.6) return null;
  const dates = [...new Set(S.flatMap((s) => s.t))].sort();
  const ser = pos.map((p) => { const s = R.px[p.sym]; if (!s) return null; const m = new Map(s.t.map((t, i) => [t, s.c[i]])); let l = null; return dates.map((d) => { if (m.get(d)) l = m.get(d); return l; }); });
  const ww = pos.map((p, i) => (ser[i] ? W[i] : 0)), tw = ww.reduce((a, b) => a + b, 0) || 1;
  const rets = [];
  for (let t = 63; t < dates.length; t += 1) {
    let r = 0, ok = true;
    for (let i = 0; i < pos.length; i++) { if (!ser[i]) continue; const a = ser[i][t - 63], b = ser[i][t]; if (!a || !b) { ok = false; break; } const q = b / a; r += (ww[i] / tw) * (q > 4 || q < 0.15 ? 1 : q); }
    if (ok) rets.push((r - 1) * 100);
  }
  if (rets.length < 250) return null;
  rets.sort((a, b) => a - b);
  const k = Math.max(1, Math.floor(rets.length * 0.05));
  return { cvar: rets.slice(0, k).reduce((a, b) => a + b, 0) / k, var95: rets[k - 1], n: rets.length, desde: dates[63] };
}
function needPx(P) {
  const miss = P.pos.filter((p) => R.px[p.sym] === undefined);
  if (miss.length) Promise.all(miss.map((p) => loadPx(p.sym))).then(() => { if (H.S.view === "escenarios") H.render(); });
  return miss.length === 0;
}

/* ---------- propuesta (reglas fijas) ---------- */
/* coste aproximado de una orden (tarifa fija de IBKR) más el impuesto sobre transacciones en compras (Reino Unido, Francia, España, Italia) */
const ITF = { "United Kingdom": 0.5, France: 0.4, Spain: 0.2, Italy: 0.1 };
function COST(amount, r, compra) {
  const c = curOf(r.moneda), FX = R.d?.divisas?.fx || {};
  let fee;
  if (c === "USD") { const e = FX.USD?.serie?.slice(-1)[0]?.[1] || 0.92, sh = r.precio ? amount / e / r.precio : 0; fee = Math.max(1, 0.005 * sh) * e; }
  else fee = Math.max(3, amount * 0.0005);
  return fee + (compra ? (amount * (ITF[r.pais] || 0)) / 100 : 0);
}
function proposal(P, K, mkey, cap) {
  const n = E().length, wv = K.port[K.wj], loss = Math.min(0, wv);
  const share = (x) => (loss < 0 ? (x.w * Math.min(0, x.eurv[K.wj] ?? 0)) / loss : 0);
  const cand = K.rows.filter((x) => x.w > 0.02 && (x.nr >= 3 || (share(x) >= 1.5 * x.w && x.w >= 0.1)))
    .sort((a, b) => share(b) - share(a)).slice(0, 2);
  const recv = K.rows.filter((x) => !cand.includes(x) && x.nr === 0)
    .sort((a, b) => Math.min(...b.eurv.filter((v) => v != null)) - Math.min(...a.eurv.filter((v) => v != null))).slice(0, 2);
  const nonEur = K.rows.reduce((a, x) => a + (curOf(x.r.moneda) !== "EUR" ? x.w : 0), 0);
  const sim = (W, hedge = false, cash = 0) => {
    const Q = { pos: P.pos.map((p, i) => ({ ...p, w: W[i] })) }, k = calc(Q, mkey, hedge);
    const port = k.port.map((v) => v * (1 - cash));
    let wj = 0; port.forEach((v, j) => { if (v < port[wj]) wj = j; });
    const sw = W.reduce((a, b) => a + b, 0), cv = cvar(P.pos, W);
    return { worst: port[wj], wj, nT: port.filter((v, j) => verdict(v, K.bench[j], E()[j].tipo) !== "Aguanta").length,
      nR: k.rows.filter((x) => x.w > 0.001 && x.nr >= 3).length, wR: k.rows.reduce((a, x) => a + (x.nr >= 3 ? x.w : 0), 0) * 100, cvar: cv ? cv.cvar * sw * (1 - cash) : null,
      div: k.rows.reduce((a, x) => a + x.w * (x.r.div || 0), 0) * (1 - cash) };
  };
  const W0 = P.pos.map((p) => p.w), now = sim(W0);
  const alts = [];
  // liquidez 20 %
  const liq = sim(W0, false, 0.2);
  alts.push({ t: "Pasar un 20 % a liquidez", r: `peor caso ${pc(liq.worst, 1)} (ahora ${pc(now.worst, 1)}), pero renuncias al 20 % de la rentabilidad y del dividendo (${nf(now.div, 1)} % → ${nf(liq.div, 1)} %)`, s: liq });
  // cobertura de divisa
  const FX = R.d?.divisas?.fx || {};
  const hcost = K.rows.reduce((a, x) => a + x.w * (curOf(x.r.moneda) !== "EUR" ? FX[curOf(x.r.moneda)]?.cubrir ?? 0 : 0), 0);
  const hed = nonEur > 0.05 ? sim(W0, true) : null;
  if (hed) alts.push({ t: `Cubrir la divisa (${nf(nonEur * 100, 0)} % fuera del euro)`, r: `peor caso ${pc(hed.worst, 1)}; cuesta ${hcost >= 0 ? "" : "(rinde) "}${nf(Math.abs(hcost), 2)} % al año de la cartera y elimina también las ganancias por divisa`, s: hed, cost: hcost });
  alts.push({ t: "Mantener sin cambios", r: `peor escenario ${label(E()[now.wj])} ${pc(now.worst, 1)}; tensión o rotura en ${now.nT} de ${n} escenarios frente a su índice`, s: now });
  let main = null;
  if (cand.length) {
    const W = W0.slice(), freed = cand.reduce((a, x) => a + x.w / 2, 0);
    cand.forEach((x) => { W[P.pos.findIndex((p) => p.sym === x.sym)] = x.w / 2; });
    let liqShare = 0;
    if (recv.length) recv.forEach((x) => { const i = P.pos.findIndex((p) => p.sym === x.sym); const add = Math.min(freed / recv.length, Math.max(0, 0.25 - W[i])); W[i] += add; liqShare += freed / recv.length - add; });
    else liqShare = freed;
    const after = sim(W.map((w) => w), false, 0);
    const afterL = liqShare > 0 ? sim(W, false, 0) : after;
    const capRef = cap || 10000;
    const orders = cand.map((x) => ({ sym: x.sym, de: x.w, a: x.w / 2, r: x.r }))
      .concat(recv.map((x) => ({ sym: x.sym, de: x.w, a: W[P.pos.findIndex((p) => p.sym === x.sym)], r: x.r })).filter((o) => o.a > o.de + 1e-6));
    const cost = orders.reduce((a, o) => a + COST(Math.abs(o.a - o.de) * capRef, o.r, o.a > o.de), 0);
    main = { tipo: "reducir", titulo: `${cand.map((x) => `${x.sym} ${nf(x.w * 100, 0)} → ${nf(x.w * 50, 0)} %`).join(" y ")}; el ${nf(freed * 100, 0)} % liberado, ${recv.length ? `a ${orders.filter((o) => o.a > o.de).map((o) => `${o.sym} (+${nf((o.a - o.de) * 100, 0)})`).join(" y ")}${liqShare > 0.001 ? ` y ${nf(liqShare * 100, 0)} % a liquidez` : ""}` : "a liquidez"}.`,
      porque: cand.map((x) => `${x.sym} explica el ${nf(share(x) * 100, 0)} % de la pérdida del peor escenario (${label(E()[K.wj])}) con un peso del ${nf(x.w * 100, 0)} % y rompe en ${x.nr} de ${n} escenarios.`).join(" ")
        + (recv.length ? ` ${recv.map((x) => x.sym).join(" y ")} no rompe${recv.length > 1 ? "n" : ""} en ningún escenario.` : " Ningún otro valor de la cartera aguanta todos los escenarios: el peso liberado queda en liquidez."),
      W, after: afterL, cost, capRef, orders, cand, recv, liqShare };
  } else if (hed && nonEur > 0.5 && now.worst - hed.worst <= -3 && hcost < 1) {
    main = { tipo: "cubrir", titulo: `Cubrir la divisa de la parte fuera del euro (${nf(nonEur * 100, 0)} % de la cartera).`, porque: `Sin cubrir, el peor escenario es ${pc(now.worst, 1)}; cubierta, ${pc(hed.worst, 1)}. Ninguna posición rompe en 3 o más escenarios, así que el riesgo que sobra es el de la divisa.`,
      W: W0, after: hed, cost: null, hcost, orders: [] };
  } else {
    main = { tipo: "mantener", titulo: "Mantener los pesos actuales.", porque: `Ninguna posición rompe en 3 o más escenarios ni explica una parte del peor caso desproporcionada a su peso. El peor escenario (${label(E()[now.wj])}) deja la cartera en ${pc(now.worst, 1)}${K.bench[now.wj] != null ? ` frente a ${pc(K.bench[now.wj], 1)} de su índice` : ""}.`, W: W0, after: now, orders: [] };
  }
  return { main, now, alts: alts.filter(Boolean).filter((a) => !(main.tipo === "mantener" && a.t.startsWith("Mantener")) && !(main.tipo === "cubrir" && a.t.startsWith("Cubrir"))) };
}
function when(mkey) {
  const T = window.SCRRisk?.data?.()?.mercados?.[mkey], h = T?.h3?.actual, nom = T?.nombre || "su bolsa";
  if (!h) return `En el próximo rebalanceo: no hay termómetro de ${nom}.`;
  if (h.validado && h.p >= h.base) return `Ahora, en dos tramos (hoy y en dos semanas): el termómetro a 3 meses de ${nom} está por encima de su media (${nf(h.p, 0)} % frente a ${nf(h.base, 0)} %) y está validado.`;
  if (h.validado) return `Sin urgencia, en el próximo rebalanceo: el termómetro a 3 meses de ${nom} está por debajo de su media (${nf(h.p, 0)} % frente a ${nf(h.base, 0)} %).`;
  return `Sin urgencia, en el próximo rebalanceo: el termómetro de ${nom} no demuestra ventaja, así que no se usa para elegir el momento.`;
}

/* ---------- gráficos ---------- */
function barsChart(K, bname) {
  const n = E().length, W = 900, Hh = 250, L = 40, Rr = 8, T = 14, B = 48;
  const vals = [...K.port, ...K.bench.filter((v) => v != null)], mn = Math.min(-10, ...vals) * 1.1, mx = Math.max(5, ...vals) * 1.15;
  const y = (v) => T + ((mx - v) / (mx - mn)) * (Hh - T - B), gw = (W - L - Rr) / n, bw = Math.min(26, gw / 2 - 4);
  let o = "";
  for (let v = Math.ceil(mn / 10) * 10; v <= mx; v += 10) o += `<line x1="${L}" x2="${W - Rr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)" ${v === 0 ? 'stroke-width="1.2" stroke="var(--border-strong)"' : ""}/><text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" font-size="10" fill="var(--faint)" text-anchor="end">${v > 0 ? "+" : ""}${v} %</text>`;
  E().forEach((e, j) => {
    const cx = L + gw * j + gw / 2, a = K.port[j], b = K.bench[j];
    o += `<rect x="${(cx - bw - 1).toFixed(1)}" y="${Math.min(y(a), y(0)).toFixed(1)}" width="${bw}" height="${Math.abs(y(a) - y(0)).toFixed(1)}" fill="var(--accent)"><title>${esc(e.nombre)}: cartera ${pc(a, 1)}</title></rect>`;
    if (b != null) o += `<rect x="${(cx + 1).toFixed(1)}" y="${Math.min(y(b), y(0)).toFixed(1)}" width="${bw}" height="${Math.abs(y(b) - y(0)).toFixed(1)}" fill="var(--info, #6f9fd8)"><title>${esc(e.nombre)}: ${esc(bname)} ${pc(b, 1)}</title></rect>`;
    o += `<text x="${cx.toFixed(1)}" y="${Hh - B + 16}" font-size="10.5" fill="var(--muted)" text-anchor="middle">${esc(short(e))}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${Hh}" class="st-chart" role="img" aria-label="Cartera frente a ${esc(bname)} en cada escenario">${o}</svg>
    <div class="st-leg"><span><i style="background:var(--accent)"></i>Tu cartera</span><span><i style="background:var(--info, #6f9fd8)"></i>${esc(bname)}</span><span class="st-fa">en euros · crisis con el cambio de cada divisa en ese tramo</span></div>`;
}
function heat(v) {
  if (v == null) return "transparent";
  const a = Math.min(1, Math.abs(v) / 50) * 0.75 + 0.08;
  return v < 0 ? `rgba(229,72,77,${a.toFixed(2)})` : `rgba(29,185,128,${a.toFixed(2)})`;
}

/* ---------- página ---------- */
function divisasBox(P, K) {
  const FX = R.d?.divisas?.fx || {}, T = R.d?.divisas?.tipos3m || {}, cap = P.capital;
  const ex = {}; K.rows.forEach((x) => { const c = curOf(x.r.moneda); ex[c] = (ex[c] || 0) + x.w; });
  const L = Object.entries(ex).sort((a, b) => b[1] - a[1]);
  const fuera = L.filter(([c]) => c !== "EUR").reduce((a, [, w]) => a + w, 0);
  const rows = L.map(([c, w]) => {
    const f = FX[c], cost = f?.cubrir;
    return `<tr><td><b>${esc(c)}</b></td><td class="num">${nf(w * 100, 0)} %</td>${cap ? `<td class="num">${eur(w * cap)}</td>` : ""}
      <td class="num ${c === "EUR" ? "" : "pos"}">${c === "EUR" ? "—" : pc(w * 10, 1)}</td><td class="num ${c === "EUR" ? "" : "neg"}">${c === "EUR" ? "—" : pc(-w * 10, 1)}</td>
      <td class="num">${c === "EUR" || !f?.vol1a ? "—" : nf(f.vol1a, 1) + " %"}</td>
      <td class="num">${c === "EUR" ? "—" : cost == null ? "s. d." : `${sgn(cost, 2)} %`}</td>${cap ? `<td class="num">${c === "EUR" || cost == null ? "—" : eur(-w * cap * cost / 100)}</td>` : ""}</tr>`;
  }).join("");
  // rentabilidad separada en acción y divisa (solo carteras guardadas)
  let sep = "";
  if (P.creada) {
    const d0 = P.creada.slice(0, 10);
    const fxAt = (c, d) => { const s = FX[c]?.serie; if (!s) return null; let v = null; for (const [t, x] of s) { if (t <= d) v = x; else break; } return v ?? s[0]?.[1]; };
    const it = K.rows.map((x) => {
      const c = curOf(x.r.moneda), a = x.p0 && x.r.precio ? x.r.precio / x.p0 - 1 : null;
      const f = c === "EUR" ? 0 : (() => { const s = FX[c]?.serie, f0 = fxAt(c, d0), f1 = s?.[s.length - 1]?.[1]; return f0 && f1 ? f1 / f0 - 1 : null; })();
      return { x, a, f };
    });
    const tw = it.reduce((s, z) => s + (z.a != null ? z.x.w : 0), 0) || 1;
    const A = it.reduce((s, z) => s + (z.a != null ? z.x.w * z.a : 0), 0) / tw, F = it.reduce((s, z) => s + (z.a != null && z.f != null ? z.x.w * (1 + z.a) * z.f : 0), 0) / tw;
    sep = `<div class="st-sep"><span>Desde el ${fmtDate(d0)}</span><b>Acciones ${pc(A * 100, 1)}</b><b>Divisa ${pc(F * 100, 1)}</b><b>Total en euros ${pc((A + F) * 100, 1)}</b></div>`;
  }
  const fx = R.d?.divisas;
  return `<section class="rsk-p"><h3>Riesgo de divisas <span>inversor en euros · ${nf(fuera * 100, 0)} % fuera del euro</span></h3>
    <div class="rsk-scroll"><table class="rsk-t"><thead><tr><th>Divisa</th><th class="num">Peso</th>${cap ? '<th class="num">Importe</th>' : ""}<th class="num">Si sube 10 %</th><th class="num">Si baja 10 %</th><th class="num" data-tip="Volatilidad anual frente al euro, último año (semanal)">Volatilidad</th><th class="num" data-tip="Tipo a 3 meses de la divisa menos el del euro (OCDE vía FRED): lo que cuesta al año cubrirla; negativo = cubrir rinde">Cubrir / año</th>${cap ? '<th class="num">Coste / año</th>' : ""}</tr></thead><tbody>${rows}</tbody></table></div>
    ${sep}
    ${H.ui.lectura([
      fuera > 0.05 ? `Un movimiento del 10 % de las divisas extranjeras frente al euro mueve la cartera un ${nf(fuera * 10, 1)} % sin que cambie el precio de ninguna acción.` : "Casi toda la cartera está en euros: el riesgo de divisa es pequeño.",
      L.some(([c]) => c === "USD") && FX.USD?.cubrir != null ? `Cubrir el dólar ${FX.USD.cubrir >= 0 ? "cuesta" : "rinde"} ${nf(Math.abs(FX.USD.cubrir), 2)} % al año (tipo a 3 meses en dólares ${nf(T.USD?.valor, 2)} % a ${T.USD?.fecha || "—"} frente a ${nf(T.EUR?.valor, 2)} % en euros a ${T.EUR?.fecha || "—"}).` : null,
    ])}
    ${H.ui.fuente(`Cambios: Yahoo Finance · tipos: ${[...new Set(Object.values(T).map((x) => x.fuente || "OCDE, interbancario a 3 meses (FRED)"))].join(", ")}`, T.EUR?.url, fx?.nota)}</section>`;
}
function render() {
  if (R.d === undefined) { ensure(); return `<div class="pg-head"><h1>Escenarios</h1></div><div class="skel" style="height:420px"></div>`; }
  window.SCRRisk?.ensure?.();
  const uni = window.SCRUni ? window.SCRUni() : [];
  if (!uni.length) { window.SCREnsureUni && window.SCREnsureUni(); return `<div class="pg-head"><h1>Escenarios</h1></div><div class="skel" style="height:420px"></div>`; }
  if (!R.d) return `<div class="pg-head"><h1>Escenarios</h1></div><div class="box">Todavía no hay datos de stress tests: se generan en la próxima actualización automática.</div>`;
  const SRC = sources(); let src = store.get("esc_src", "w"); if (!SRC.some((s) => s[0] === src)) src = "w";
  const P = positions(src);
  const marks = {}; P.pos.forEach((p) => { const m = val(p.sym)?.m; if (m) marks[m] = (marks[m] || 0) + p.w; });
  const auto = Object.entries(marks).sort((a, b) => b[1] - a[1])[0]?.[0] || "sp500";
  let mkey = store.get("esc_idx", "auto"); const mk = mkey === "auto" || !idx(mkey) ? auto : mkey;
  const sel = `<div class="st-bar-top"><label>Cartera <select data-escsrc>${SRC.map(([k, t]) => `<option value="${esc(k)}" ${k === src ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
    <label>Comparar con <select data-escidx><option value="auto" ${mkey === "auto" ? "selected" : ""}>Su bolsa principal (${esc(idx(auto)?.nombre || "—")})</option>${Object.entries(R.d.indices).map(([k, x]) => `<option value="${k}" ${k === mkey ? "selected" : ""}>${esc(x.nombre)}</option>`).join("")}</select></label></div>`;
  const head = `<div class="pg-head"><h1>Escenarios</h1><div class="pg-sub">Cuánto perdería tu cartera si se repite cada crisis o choque, quién lo explica y qué cambiar · ${esc(P.nombre || "")}${P.pos.length ? ` · ${P.pos.length} posiciones` : ""}${P.capital ? ` · ${eur(P.capital)}` : ""} · datos del ${fmtDate((R.d.generado || "").slice(0, 10))}</div></div>`;
  if (P.pos.length < 2) return head + sel + `<div class="soon-box">Hacen falta al menos 2 valores. Añade valores a la Watchlist (☆ en el screener) o guarda una cartera en Cartera › Carteras.</div>`;
  const K = calc(P, mk), n = E().length, bname = idx(mk)?.nombre || "índice";
  const pxReady = needPx(P), CV = pxReady ? cvar(P.pos, P.pos.map((p) => p.w)) : null;
  const wv = K.port[K.wj], nTen = K.pv.filter((v) => v !== "Aguanta").length, nR = K.pv.filter((v) => v === "Rompe").length;
  const overall = nR ? "Rompe" : nTen >= 3 ? "Tensión" : "Aguanta";
  const top2 = K.contrib.slice(0, 2), sh2 = wv < 0 ? top2.reduce((a, x) => a + x.pp, 0) / wv : 0;
  const fuera = K.rows.reduce((a, x) => a + (curOf(x.r.moneda) !== "EUR" ? x.w : 0), 0);
  const k = (l, v, d, c = "") => `<div class="geo-k"><span>${l}</span><b class="num ${c}">${v}</b><small>${d}</small></div>`;
  const kpis = `<div class="geo-kpis">${k("Peor escenario", pc(wv, 1), `${esc(label(E()[K.wj]))}${P.capital ? ` · ${eur(P.capital * wv / 100)}` : ""} · ${esc(bname)} ${pc(K.bench[K.wj], 1)}`, wv < -20 ? "neg" : "")}
    ${k("Pérdida en el peor 5 % (CVaR 95 %)", CV ? pc(CV.cvar, 1) : pxReady ? "—" : "…", CV ? `a 3 meses · ${nf(CV.n, 0)} tramos desde ${fmtDate(CV.desde)}` : "a 3 meses · precios de 5 años", CV && CV.cvar < -15 ? "neg" : "")}
    ${k("Fuera del euro", `${nf(fuera * 100, 0)} %`, "riesgo de divisa para un inversor en euros")}
    <div class="geo-k"><span>Veredicto frente a ${esc(bname)}</span><b>${vpill(overall)}</b><small>${top2.length ? `${esc(top2.map((x) => x.sym).join(" y "))} explican el ${nf(sh2 * 100, 0)} % del peor caso` : ""} · tensión o rotura en ${nTen} de ${n}</small></div></div>`;
  // propuesta
  const PR = pxReady ? proposal(P, K, mk, P.capital) : null;
  let prop = `<section class="rsk-p st-prop"><h3>Propuesta <span>una recomendación · la decisión es tuya</span></h3><div class="skel" style="height:160px"></div></section>`;
  if (PR) {
    const M = PR.main, a = M.after, b = PR.now;
    const same = (x, y) => x == null || y == null || Math.abs(x - y) < 0.05;
    const effRow = (t, x, y, f, good) => `<tr><td>${t}</td><td class="num">${f(x)}</td><td class="num ${same(x, y) ? "" : good(x, y) ? "pos" : "neg"}">${f(y)}</td></tr>`;
    prop = `<section class="rsk-p st-prop"><h3>Propuesta <span>una recomendación · la decisión es tuya · reglas fijas</span></h3>
      <div class="st-prop-g"><div><p class="st-tit">${esc(M.titulo)}</p>
        <table class="rsk-kv st-kv"><tr><td>Por qué</td><td>${esc(M.porque)}</td></tr>
        <tr><td>Cuándo</td><td>${esc(M.tipo === "mantener" ? "Revisar con cada actualización: la propuesta cambia si cambian los precios o los pesos." : when(mk))}</td></tr>
        <tr><td>Invalida si</td><td>${esc(M.tipo === "reducir" ? `La aportación de ${M.cand.map((x) => x.sym).join(" y ")} al peor escenario baja del 25 % o deja${M.cand.length > 1 ? "n" : ""} de romper en 3 escenarios (se recalcula con cada actualización).` : M.tipo === "cubrir" ? "El euro se aprecia de forma sostenida o el diferencial de tipos encarece la cobertura por encima del 1 % anual." : "Alguna posición pasa a romper en 3 o más escenarios o a explicar una parte del peor caso desproporcionada a su peso.")}</td></tr></table></div>
      <div><table class="rsk-t"><thead><tr><th>Efecto</th><th class="num">Ahora</th><th class="num">Con propuesta</th></tr></thead><tbody>
        ${effRow(`Peor escenario (${esc(short(E()[b.wj]))})`, b.worst, a.worst, (v) => pc(v, 1), (x, y) => y > x)}
        ${effRow("CVaR 95 % · 3 meses", b.cvar, a.cvar, (v) => pc(v, 1), (x, y) => y > x)}
        ${effRow("Escenarios en tensión", b.nT, a.nT, (v) => `${v} de ${n}`, (x, y) => y < x)}
        ${effRow("Peso que rompe en ≥ 3", b.wR, a.wR, (v) => nf(v, 0) + " %", (x, y) => y < x)}
        ${effRow("Dividendo", b.div, a.div, (v) => nf(v, 1) + " %", (x, y) => y > x)}
        ${M.tipo === "reducir" ? `<tr><td>Coste · ${M.orders.length} órdenes</td><td class="num"></td><td class="num">≈ ${eur(M.cost)} · ${nf((M.cost / M.capRef) * 100, 2)} %${P.capital ? "" : " sobre 10.000 €"}</td></tr>` : ""}
        ${M.tipo === "cubrir" ? `<tr><td>Coste de cubrir</td><td class="num"></td><td class="num">${nf(M.hcost, 2)} % al año</td></tr>` : ""}
      </tbody></table></div>
      <div><div class="st-alt-h">Alternativas evaluadas y descartadas</div><table class="rsk-kv st-kv">${PR.alts.map((x) => `<tr><td>${esc(x.t)}</td><td>${esc(x.r)}</td></tr>`).join("")}</table>
        ${M.tipo === "reducir" ? (R.reg ? `<div class="st-ok">${esc(R.reg)}</div>` : `<button class="icon-btn primary" data-escreg="1" style="margin-top:10px">Registrar en el Diario</button>`) : ""}
        <div class="rsk-exp" style="display:block">La propuesta se registra en el Diario con fecha y precios para comparar dentro de 3-12 meses qué habría pasado con y sin ella. Si decides ejecutarla, se hace con el protocolo IBKR.</div></div></div>
      ${exp(`<b>Reglas de la propuesta</b> (fijadas antes de ver ninguna cartera): se reduce a la mitad, como mucho, a las 2 posiciones que más explican el peor escenario si rompen en 3 o más escenarios o si su parte de la pérdida es al menos 1,5 veces su peso (con peso ≥ 10 %). Lo liberado va a las posiciones que no rompen en ningún escenario y caen menos en su peor caso (máximo 25 % por valor); si no hay, a liquidez. Coste aproximado con la tarifa fija de IBKR (0,05 % con mínimo de 3 € en Europa; 0,005 $ por acción con mínimo de 1 $ en EE. UU.) más el impuesto sobre transacciones financieras en las compras (Reino Unido 0,5 %, Francia 0,4 %, España 0,2 %, Italia 0,1 %; en Francia, España e Italia solo afecta a empresas grandes, así que puede ser menor).`)}</section>`;
    R.lastProp = { M, P, mk };
  }
  // quién explica el peor caso
  const cmx = Math.max(1, ...K.contrib.map((x) => Math.abs(x.pp)));
  const contrib = `<section class="rsk-p"><h3>Quién explica el peor caso <span>${esc(label(E()[K.wj]))} · puntos de cartera</span></h3>
    <div class="st-contrib">${K.contrib.slice(0, 10).map((x) => `<div class="st-cr" data-sym="${esc(x.sym)}"><span>${esc(x.sym)} <small>${nf(x.w * 100, 0)} %</small></span><span class="st-cb"><i class="${x.pp < 0 ? "n" : "p"}" style="width:${((Math.abs(x.pp) / cmx) * 100).toFixed(1)}%"></i></span><b class="num ${x.pp < 0 ? "neg" : "pos"}">${sgn(x.pp, 1)} pp</b></div>`).join("")}</div>
    ${H.ui.lectura([top2.length && wv < 0 ? `${top2.map((x) => x.sym).join(" y ")} concentran el ${nf(sh2 * 100, 0)} % de la pérdida con el ${nf(top2.reduce((a, x) => a + x.w, 0) * 100, 0)} % del peso.` : null])}</section>`;
  // mapa de calor
  const hm = `<section class="rsk-p"><h3>Mapa de estrés por posición <span>% estimado del valor en su moneda · crisis: dato real; ∗ = estimado o sin dato (se usa su bolsa)</span></h3>
    <div class="rsk-scroll"><table class="st-hm"><thead><tr><th></th>${E().map((e) => `<th data-tip="${esc(`${e.nombre}${e.magnitud ? ` · ${typeof e.magnitud === "string" ? e.magnitud : Object.entries(e.magnitud).map(([a, b]) => `${a} ${b}`).join(", ")}` : ""}`)}">${esc(short(e))}</th>`).join("")}</tr></thead><tbody>
    ${K.rows.slice().sort((a, b) => b.w - a.w).map((x) => `<tr><th data-sym="${esc(x.sym)}">${esc(x.sym)} · ${nf(x.w * 100, 0)} %</th>${x.loc.map((v, j) => `<td style="background:${heat(v)}" data-tip="${esc(`${E()[j].nombre}: ${pc(v, 1)} · ${x.ver[j] || "sin dato propio"} · ${baseTxt(E()[j], x.V?.q[j], x.V?.b)}`)}">${v == null ? "—" : s0(v)}${x.fill[j] || x.V?.q[j] === 0.5 ? "∗" : ""}</td>`).join("")}</tr>`).join("")}
    <tr class="st-hm-p"><th>Cartera (en €)</th>${K.port.map((v) => `<td style="background:${heat(v)}">${s0(v)}</td>`).join("")}</tr>
    <tr class="st-hm-p"><th>${esc(bname)} (en €)</th>${K.bench.map((v) => `<td style="background:${heat(v)}">${v == null ? "—" : s0(v)}</td>`).join("")}</tr></tbody></table></div>
    ${K.missing ? `<div class="hint">${K.missing} posición(es) sin datos propios: se usa su bolsa.</div>` : ""}</section>`;
  // lectura conjunta
  const worstE = E()[K.wj], better = E().map((e, j) => [e, K.port[j] - (K.bench[j] ?? K.port[j])]).filter(([, d]) => d > 2).map(([e]) => label(e));
  const C = {
    conclusion: `En el peor escenario (${label(worstE)}) la cartera perdería un ${nf(-wv, 1)} %${K.bench[K.wj] != null ? ` frente a un ${nf(-K.bench[K.wj], 1)} % del ${bname}` : ""}; ${overall === "Aguanta" ? "aguanta frente a su índice" : overall === "Tensión" ? `queda en tensión en ${nTen} de ${n} escenarios` : `rompe en ${nR} escenario(s)`}.`,
    bloques: [
      top2.length && wv < 0 ? `${top2.map((x) => x.sym).join(" y ")} explican el ${nf(sh2 * 100, 0)} % del peor caso.` : null,
      better.length ? `Aguanta mejor que el ${bname} en: ${better.slice(0, 4).join(", ")}.` : `No mejora al ${bname} en ningún escenario por más de 2 puntos.`,
      CV ? `En el peor 5 % de los tramos de 3 meses de los últimos 5 años, la pérdida media habría sido del ${nf(-CV.cvar, 1)} %.` : null,
      fuera > 0.05 ? `El ${nf(fuera * 100, 0)} % está fuera del euro: un 10 % de movimiento de esas divisas mueve la cartera un ${nf(fuera * 10, 1)} %.` : null,
      PR ? `Propuesta: ${PR.main.titulo}` : null,
    ].filter(Boolean),
    vigilar: [
      `${worstE.tipo === "crisis" ? "Señales de crisis de crédito (diferenciales y EBP) en Contexto › Riesgo" : `El factor del peor choque: ${worstE.desc.toLowerCase()}`}.`,
      ...(K.rows.filter((x) => x.nr >= 3).slice(0, 2).map((x) => `${x.sym}: rompe en ${x.nr} escenarios; su balance en la ficha › Riesgo y escenarios.`)),
    ],
    cambiaria: ["Cambiar los pesos o añadir valores que aguanten el peor escenario.", "Una nueva actualización de precios que cambie las sensibilidades estimadas."],
  };
  return head + sel + kpis + prop + `<div class="st-2">${`<section class="rsk-p"><h3>Tu cartera frente al ${esc(bname)} en cada escenario <span>en euros</span></h3>${barsChart(K, bname)}</section>`}${contrib}</div>` + hm + divisasBox(P, K)
    + exp(`<b>Cómo se calcula.</b> Cada posición con su peso actual y su efecto en cada escenario; en las crisis se suma lo que hizo su divisa frente al euro en ese tramo, y en el choque del dólar, la apreciación del dólar para los valores en dólares. Si un valor no tiene dato propio se usa el de su bolsa (∗). Es una foto de lo que habría pasado con esta cartera, no una previsión. CVaR: media del peor 5 % de las rentabilidades de 3 meses con los pesos actuales en los últimos 5 años, en la moneda de cada valor.`)
    + `<div class="rsk-read">${H.ui.conjunta(C, P.nombre || "Escenarios")}</div>`;
}
function register() {
  const L = R.lastProp; if (!L || !window.SCRDiario?.add) return;
  const { M, mk } = L, uni = window.SCRUni();
  const motivo = `Escenarios: ${M.titulo} ${M.porque}`.slice(0, 300), inval = "Ver «Invalida si» en Cartera › Escenarios".slice(0, 200);
  M.orders.forEach((o) => {
    const r = uni.find((x) => x.sym === o.sym); if (!r) return;
    window.SCRDiario.add({ sym: o.sym, nombre: r.nombre || "", dec: o.a < o.de ? "vender" : "comprar", hz: "medio", motivo, inval, p0: r.precio, fp: r.fecha_precio, mon: r.moneda || "", nota: r.score ?? null, tec: r.veredicto || null });
  });
  R.reg = `Registrada en Investigación › Diario: ${M.orders.length} decisiones con fecha y precio de hoy.`;
  H.render();
}
function onChange(t) {
  if (t.matches?.("[data-escsrc]")) { store.set("esc_src", t.value); R.reg = null; H.render(); return true; }
  if (t.matches?.("[data-escidx]")) { store.set("esc_idx", t.value); H.render(); return true; }
  return false;
}
document.addEventListener("change", (ev) => { if (onChange(ev.target)) ev.stopPropagation(); });
H.handlers.unshift((t) => { if (t.closest("[data-escreg]")) { register(); return true; } return false; });
H.modules.escenarios = render;
window.SCRStress = { ensure, data: () => R.d, cell, fichaHTML, symRows, verdict, calc, eurEffect, escenarios: E };
})();
