/* Screener · Carteras: constructor con cuatro métodos, stress test, guardado y seguimiento con alertas de rebalanceo. */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate, store } = H;
const C = {
  tab: "construir",
  cfg: Object.assign({ src: "top", n: 10, wmax: 20, metodo: "riesgo", region: "Todas", seccap: 3, capital: 10000 }, store.get("cartera_cfg", {})),
  res: null, busy: false, err: null,
  saved: store.get("carteras", []), open: null,
};
const METODOS = [["equi", "Equiponderada"], ["riesgo", "Riesgo-paridad"], ["minvar", "Mínima varianza"], ["sharpe", "Máximo Sharpe"]];
const METODO_TIP = {
  equi: "Mismo peso para todos los valores.",
  riesgo: "Más peso a los valores menos volátiles: cada uno aporta un riesgo parecido.",
  minvar: "La combinación con menor volatilidad conjunta según las correlaciones del último año.",
  sharpe: "La combinación con mejor rentabilidad por unidad de riesgo. La rentabilidad esperada es la histórica del último año reducida a la mitad hacia la media: es la más inestable de las cuatro.",
};
const SRC = [["top", "Top puntuación"], ["filtro", "Resultado del screener"], ["seguimiento", "Mi seguimiento"], ["comparador", "Comparador"]];
/* Sensibilidad aproximada por sector (%). Heurística, no estimación estadística. */
const SENS = {
  tipos: { "Technology": -8, "Communication Services": -6, "Consumer Cyclical": -5, "Real Estate": -10, "Utilities": -7, "Healthcare": -3, "Consumer Defensive": -3, "Industrials": -4, "Basic Materials": -3, "Energy": -1, "Financial Services": 3 },
  petroleo: { "Energy": 12, "Basic Materials": 2, "Industrials": -3, "Consumer Cyclical": -5, "Consumer Defensive": -2, "Utilities": -1, "Technology": -2, "Communication Services": -1, "Healthcare": -1, "Financial Services": 0, "Real Estate": -1 },
};
const pct = (v, d = 1) => (v == null || isNaN(v) ? "—" : nf(v, d) + " %");
const spct = (v, d = 1) => (v == null || isNaN(v) ? "—" : sgn(v, d) + " %");
const eur = (v) => (v == null ? "—" : nf(v, 0) + " €");
const cls = (v) => (v == null || v === 0 ? "z" : v > 0 ? "p" : "n");
const isUS = (r) => r.region === "EE. UU.";

/* ---------- datos ---------- */
async function prices(sym) {
  if (window.SCRChart) return window.SCRChart.loadPrices(sym);
  const r = await fetch(`data/p/${encodeURIComponent(sym)}.json`); if (!r.ok) throw new Error("sin histórico"); return r.json();
}
async function eurusd() {
  try { const m = await fetch("data/macro.json").then((r) => r.json()); return m.series?.eurusd?.valor || null; } catch (e) { return null; }
}
function candidates() {
  const all = window.SCRUni ? window.SCRUni() : [];
  let list;
  if (C.cfg.src === "seguimiento") { const w = store.get("seguimiento", []); list = all.filter((r) => w.includes(r.sym)); }
  else if (C.cfg.src === "comparador") { const w = store.get("comparar", []); list = all.filter((r) => w.includes(r.sym)); }
  else if (C.cfg.src === "filtro") list = window.SCRFiltered ? window.SCRFiltered().slice() : [];
  else list = all.filter((r) => r.score != null).sort((a, b) => b.score - a.score);
  if (C.cfg.region !== "Todas") list = list.filter((r) => r.region === C.cfg.region);
  if (C.cfg.src !== "top") list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const per = {}, out = [];
  for (const r of list) {
    if (out.length >= C.cfg.n) break;
    const k = r.sector || "-";
    if ((per[k] || 0) >= C.cfg.seccap) continue;
    per[k] = (per[k] || 0) + 1; out.push(r);
  }
  return out;
}
/* rentabilidades diarias alineadas del último año (fechas comunes con relleno hacia delante) */
function alignReturns(series) {
  const dates = [...new Set(series.flatMap((s) => s.t.slice(-260)))].sort().slice(-253);
  const R = series.map((s) => {
    const m = new Map(s.t.map((t, i) => [t, s.c[i]])); let last = null;
    const px = dates.map((d) => { if (m.has(d) && m.get(d) != null) last = m.get(d); return last; });
    const r = []; for (let i = 1; i < px.length; i++) r.push(px[i] && px[i - 1] ? px[i] / px[i - 1] - 1 : 0);
    return { px, r };
  });
  return { dates, R };
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function covMatrix(R) {
  const n = R.length, T = R[0].length, mu = R.map(mean), S = [];
  for (let i = 0; i < n; i++) { S.push([]); for (let j = 0; j < n; j++) { let s = 0; for (let t = 0; t < T; t++) s += (R[i][t] - mu[i]) * (R[j][t] - mu[j]); S[i].push((s / (T - 1)) * 252); } }
  return { S, mu: mu.map((m) => m * 252) };
}
/* proyección sobre {0 ≤ w ≤ cap, Σw = 1} */
function project(v, cap) {
  let lo = Math.min(...v) - cap, hi = Math.max(...v);
  for (let k = 0; k < 60; k++) { const t = (lo + hi) / 2, s = v.reduce((a, x) => a + Math.min(cap, Math.max(0, x - t)), 0); if (s > 1) lo = t; else hi = t; }
  const t = (lo + hi) / 2; return v.map((x) => Math.min(cap, Math.max(0, x - t)));
}
const quad = (S, w) => w.reduce((a, wi, i) => a + wi * S[i].reduce((b, sij, j) => b + sij * w[j], 0), 0);
const grad = (S, w) => S.map((row) => row.reduce((a, sij, j) => a + sij * w[j], 0));
function optimise(method, S, mu, cap) {
  const n = S.length; let w = project(new Array(n).fill(1 / n), cap);
  if (method === "equi") return w;
  if (method === "riesgo") { const iv = S.map((r, i) => 1 / Math.sqrt(Math.max(r[i], 1e-8))); const s = iv.reduce((a, b) => a + b, 0); return project(iv.map((x) => x / s), cap); }
  const rf = 0.03, m = mu.map((x) => 0.5 * x + 0.5 * mean(mu));
  for (let it = 0; it < 3000; it++) {
    const g = grad(S, w); let step;
    if (method === "minvar") step = g.map((x) => -x);
    else { const v = Math.sqrt(Math.max(quad(S, w), 1e-10)), ex = m.reduce((a, x, i) => a + x * w[i], 0) - rf; step = m.map((x, i) => x / v - (ex * g[i]) / v ** 3); }
    const nw = project(w.map((x, i) => x + 0.02 * step[i]), cap);
    if (nw.every((x, i) => Math.abs(x - w[i]) < 1e-7)) { w = nw; break; }
    w = nw;
  }
  return w;
}

async function build() {
  C.busy = true; C.err = null; C.res = null; H.render();
  try {
    const cand = candidates();
    if (cand.length < 2) throw new Error("Hacen falta al menos 2 valores candidatos. Prueba otra fuente o más valores.");
    if (C.cfg.wmax / 100 * cand.length < 1) throw new Error(`Con ${cand.length} valores y un peso máximo del ${C.cfg.wmax} % no se llega al 100 %. Sube el peso máximo o el número de valores.`);
    const [ser, fx, bus, beu] = await Promise.all([Promise.all(cand.map((r) => prices(r.sym).catch(() => null))), eurusd(),
      prices("IDX_SP500").catch(() => null), prices("IDX_STOXX50").catch(() => null)]);
    const ok = cand.filter((_, i) => ser[i] && ser[i].c.length > 120), oks = ser.filter((s) => s && s.c.length > 120);
    if (ok.length < 2) throw new Error("No hay histórico suficiente para estos valores.");
    const { dates, R } = alignReturns(oks);
    const { S, mu } = covMatrix(R.map((x) => x.r));
    const w = optimise(C.cfg.metodo, S, mu, C.cfg.wmax / 100);
    const vol = Math.sqrt(quad(S, w)) * 100;
    const port = [100]; for (let t = 0; t < R[0].r.length; t++) port.push(port[t] * (1 + R.reduce((a, x, i) => a + w[i] * x.r[t], 0)));
    let peak = 100, mdd = 0; port.forEach((v) => { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
    const usShare = ok.reduce((a, r, i) => a + (isUS(r) ? w[i] : 0), 0);
    const bench = (() => {
      const pick = (b) => { if (!b) return null; const m = new Map(b.t.map((t, i) => [t, b.c[i]])); let l = null; return dates.map((d) => { if (m.has(d)) l = m.get(d); return l; }); };
      const a = pick(bus), e = pick(beu); if (!a && !e) return null;
      return dates.map((_, i) => { const ra = a && a[0] ? a[i] / a[0] : null, re = e && e[0] ? e[i] / e[0] : null;
        return 100 * (ra != null && re != null ? usShare * ra + (1 - usShare) * re : ra ?? re); });
    })();
    const g = vol ? Math.sqrt(quad(S, w)) : 1, mrc = grad(S, w);
    const items = ok.map((r, i) => ({ r, w: w[i], vol: Math.sqrt(S[i][i]) * 100, rc: g ? (w[i] * mrc[i]) / (g * g) * 100 : null }))
      .filter((x) => x.w > 0.0005).sort((a, b) => b.w - a.w);
    const capital = C.cfg.capital;
    items.forEach((x) => {
      const pxEur = x.r.moneda === "USD" && fx ? x.r.precio / fx : x.r.moneda === "EUR" ? x.r.precio : null;
      x.eur = capital * x.w; x.acc = pxEur ? Math.floor(x.eur / pxEur) : null; x.pxEur = pxEur;
    });
    const stress = {
      recesion: items.reduce((a, x) => a + x.w * -25 * (x.r.beta ?? 1), 0),
      tipos: items.reduce((a, x) => a + x.w * (SENS.tipos[x.r.sector] ?? -3), 0),
      petroleo: items.reduce((a, x) => a + x.w * (SENS.petroleo[x.r.sector] ?? 0), 0),
      dolar: items.reduce((a, x) => a + x.w * (isUS(x.r) ? 10 : 0), 0),
    };
    const sect = {}; items.forEach((x) => { sect[x.r.sector || "—"] = (sect[x.r.sector || "—"] || 0) + x.w * 100; });
    C.res = { items, vol, ret: port[port.length - 1] - 100, mdd: mdd * 100, sharpe: vol ? ((port[port.length - 1] - 100) - 3) / vol : null, port, bench, dates, stress, sect, fx,
      excl: cand.length - ok.length, metodo: C.cfg.metodo };
  } catch (e) { C.err = e.message; }
  C.busy = false; H.render();
}

/* ---------- vista ---------- */
function line(dates, series, colors, labels) {
  const W = 640, Hh = 200, L = 6, R = 50, T = 10, B = 20, vals = series.flat().filter((v) => v != null);
  if (!vals.length) return "";
  const mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1, n = dates.length;
  const x = (i) => L + (i / (n - 1)) * (W - L - R), y = (v) => T + (1 - (v - mn) / rg) * (Hh - T - B);
  return `<svg viewBox="0 0 ${W} ${Hh}" style="width:100%;height:auto" role="img" aria-label="Evolución base 100">
    <line x1="${L}" x2="${W - R}" y1="${y(100)}" y2="${y(100)}" stroke="var(--border)" stroke-dasharray="3 3"/>
    ${series.map((s, k) => `<polyline fill="none" stroke="${colors[k]}" stroke-width="${k ? 1.4 : 2}" points="${s.map((v, i) => (v == null ? "" : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(" ")}"/>`).join("")}
    <text x="${W - R + 4}" y="${y(mx) + 4}" font-size="10" fill="var(--muted)">${nf(mx, 0)}</text><text x="${W - R + 4}" y="${y(mn) + 4}" font-size="10" fill="var(--muted)">${nf(mn, 0)}</text>
    <text x="${L}" y="${Hh - 5}" font-size="10" fill="var(--muted)">${fmtDate(dates[0])}</text><text x="${W - R}" y="${Hh - 5}" font-size="10" fill="var(--muted)" text-anchor="end">${fmtDate(dates[n - 1])}</text></svg>
    <div class="method">${labels.map((l, k) => `<span style="color:${colors[k]}">━</span> ${l}`).join(" · ")}</div>`;
}
function render() {
  const uni = window.SCRUni ? window.SCRUni() : [];
  if (!uni.length) { window.SCREnsureUni && window.SCREnsureUni(); return `<div class="skel-wrap"><div class="skel" style="height:34px;width:50%"></div>${'<div class="skel" style="height:22px"></div>'.repeat(6)}</div>`; }
  const tabs = [["construir", "Construir cartera"], ["mis", `Mis carteras (${C.saved.length})`]];
  let h = `<div class="tabs">${tabs.map(([k, t]) => `<button class="${C.tab === k ? "on" : ""}" data-ctab="${k}">${t}</button>`).join("")}</div>`;
  return h + (C.tab === "construir" ? renderBuild() : renderSaved());
}
function renderBuild() {
  const f = C.cfg, dd = H.dropdown;
  let h = `<div class="bar">${dd("c_src", "Candidatos:", SRC, f.src)}${dd("c_n", "Valores:", [5, 8, 10, 12, 15, 20, 25].map((x) => [String(x), String(x)]), String(f.n))}
    ${dd("c_metodo", "Método:", METODOS, f.metodo)}${dd("c_wmax", "Peso máximo:", [10, 15, 20, 25, 30, 40].map((x) => [String(x), x + " %"]), String(f.wmax))}
    ${dd("c_region", "Región:", [["Todas", "Todas"], ["EE. UU.", "EE. UU."], ["Europa", "Europa"]], f.region)}
    ${dd("c_seccap", "Máx. por sector:", [1, 2, 3, 4, 5, 99].map((x) => [String(x), x === 99 ? "Sin límite" : x + " valores"]), String(f.seccap))}
    ${dd("c_capital", "Capital:", [1000, 5000, 10000, 25000, 50000, 100000].map((x) => [String(x), nf(x, 0) + " €"]), String(f.capital))}
    <button class="icon-btn primary" data-cbuild="1" ${C.busy ? "disabled" : ""}>${C.busy ? "Calculando…" : "Construir"}</button></div>
    <div class="method" style="margin-top:-4px">${esc(METODO_TIP[f.metodo])} Los candidatos se ordenan por la puntuación de oportunidad con tus pesos actuales.</div>`;
  if (C.err) h += `<div class="err-box" style="margin-top:10px">${esc(C.err)}</div>`;
  if (C.busy) h += `<div class="skel" style="height:260px;margin-top:10px"></div>`;
  const r = C.res; if (!r) return h + (C.busy || C.err ? "" : `<div class="soon-box" style="margin-top:10px">Elige los parámetros y pulsa «Construir». Se usa el último año de precios diarios para estimar volatilidades y correlaciones.</div>`);
  h += `<div class="kpis" style="grid-template-columns:repeat(6,minmax(0,1fr));margin-top:12px">
    ${[["Volatilidad esperada", pct(r.vol)], ["Rentabilidad 1 año*", spct(r.ret)], ["Máxima caída 1 año*", pct(r.mdd)], ["Sharpe 1 año*", nf(r.sharpe, 2)], ["Valores", r.items.length], ["Mayor sector", (() => { const e = Object.entries(r.sect).sort((a, b) => b[1] - a[1])[0]; return e ? `${pct(e[1], 0)}` : "—"; })()]]
      .map(([l, v]) => `<div class="kpi" style="cursor:default"><span class="k-l">${l}</span><span class="k-v num">${v}</span></div>`).join("")}</div>
    <div class="method">* Simulación con los pesos actuales sobre el último año: los valores se eligieron con información de hoy, así que sobreestima el resultado. No es una previsión.</div>
    <div class="f-grid" style="margin-top:12px"><div><div class="tbl-wrap"><table><thead><tr><th>Valor</th><th>Peso</th><th>Importe</th><th data-tip="Número aproximado de acciones al cambio actual">Acciones</th><th>Puntuación</th><th>Volatilidad</th><th data-tip="Parte del riesgo total de la cartera que aporta el valor">Aporte al riesgo</th></tr></thead><tbody>
    ${r.items.map((x) => `<tr data-sym="${esc(x.r.sym)}"><td><b>${esc(x.r.sym)}</b> <span class="nm">${esc((x.r.nombre || "").slice(0, 20))}</span></td><td class="num">${pct(x.w * 100)}</td><td class="num">${eur(x.eur)}</td><td class="num">${x.acc ?? "—"}</td><td class="num">${x.r.score ?? "—"}</td><td class="num">${pct(x.vol, 0)}</td><td class="num">${pct(x.rc, 0)}</td></tr>`).join("")}
    </tbody></table></div>${r.excl ? `<div class="method">${r.excl} candidato(s) excluido(s) por falta de histórico.</div>` : ""}</div>
    <div><div class="box"><b>Evolución simulada 1 año (base 100)</b>${line(r.dates, r.bench ? [r.port, r.bench] : [r.port], ["var(--accent)", "var(--faint)"], r.bench ? ["Cartera", "Índices de referencia (S&P 500 y Euro Stoxx 50 según peso por región)"] : ["Cartera"])}</div>
    <div class="box"><b>Stress test (aproximado)</b><table><tbody>
      ${[["Recesión: bolsa −25 %", r.stress.recesion, "Beta de cada valor × −25 %."], ["Tipos +100 pb", r.stress.tipos, "Sensibilidad típica de cada sector (heurística)."],
        ["Petróleo +30 %", r.stress.petroleo, "Sensibilidad típica de cada sector (heurística)."], ["Dólar +10 % frente al euro", r.stress.dolar, "Efecto cambiario para un inversor en euros."]]
        .map(([t, v, d]) => `<tr><td data-tip="${esc(d)}">${t}</td><td class="num chg ${cls(v)}">${spct(v)}</td><td class="num">${eur(C.cfg.capital * v / 100)}</td></tr>`).join("")}</tbody></table></div>
    <div class="bar" style="margin-top:12px"><button class="icon-btn primary" data-csave="1">Guardar cartera</button><button class="icon-btn" data-ccsv="1">Exportar CSV</button></div></div></div>`;
  return h;
}
/* ---------- carteras guardadas ---------- */
function valuation(p) {
  const uni = window.SCRUni ? window.SCRUni() : [], px = Object.fromEntries(uni.map((r) => [r.sym, r.precio]));
  let tot = 0; const cur = p.items.map((x) => { const v = px[x.sym] && x.p0 ? x.w * (px[x.sym] / x.p0) : x.w; tot += v; return v; });
  const items = p.items.map((x, i) => ({ ...x, now: px[x.sym], wcur: cur[i] / tot, drift: (cur[i] / tot - x.w) * 100 }));
  return { ret: (tot - 1) * 100, items, maxDrift: Math.max(...items.map((x) => Math.abs(x.drift))) };
}
async function benchRet(p) {
  try {
    const [a, e] = await Promise.all([prices("IDX_SP500"), prices("IDX_STOXX50")]);
    const r = (b, v0) => (b && v0 ? (b.c[b.c.length - 1] / v0 - 1) * 100 : null);
    const ra = r(a, p.b_us), re = r(e, p.b_eu);
    return ra != null && re != null ? p.us * ra + (1 - p.us) * re : ra ?? re;
  } catch (e) { return null; }
}
function renderSaved() {
  if (!C.saved.length) return `<div class="soon-box">No hay carteras guardadas. Construye una y pulsa «Guardar cartera». Se guardan en este navegador; usa «Exportar todas» para llevarlas a otro dispositivo.</div>
    <div class="bar" style="margin-top:10px"><label class="icon-btn">Importar carteras<input type="file" accept="application/json" data-cimport="1" hidden></label></div>`;
  let h = `<div class="tbl-wrap"><table><thead><tr><th>Cartera</th><th>Creada</th><th>Método</th><th>Valores</th><th>Rentabilidad</th><th data-tip="Índices de referencia en el mismo periodo, ponderados por región">Referencia</th><th data-tip="Mayor desviación de un peso frente a su objetivo">Desviación máx.</th></tr></thead><tbody>
    ${C.saved.map((p) => { const v = valuation(p); return `<tr data-copen="${p.id}" class="${C.open === p.id ? "sel" : ""}"><td>${esc(p.nombre)}</td><td>${fmtDate(p.creada.slice(0, 10))}</td><td>${esc((METODOS.find((m) => m[0] === p.metodo) || [, p.metodo])[1])}</td>
      <td class="num">${p.items.length}</td><td class="num chg ${cls(v.ret)}">${spct(v.ret, 2)}</td><td class="num" id="bench_${p.id}">…</td><td class="num ${v.maxDrift > 5 ? "stale-txt" : ""}">${nf(v.maxDrift, 1)} pp${v.maxDrift > 5 ? " ⚠" : ""}</td></tr>`; }).join("")}
    </tbody></table></div><div class="bar" style="margin-top:10px"><button class="icon-btn" data-cexport="1">Exportar todas</button><label class="icon-btn">Importar<input type="file" accept="application/json" data-cimport="1" hidden></label></div>`;
  const p = C.saved.find((x) => x.id === C.open);
  if (p) {
    const v = valuation(p);
    h += `<div class="box" style="margin-top:12px"><b>${esc(p.nombre)} · capital inicial ${eur(p.capital)} · valor estimado ${eur(p.capital * (1 + v.ret / 100))}</b>
      ${v.maxDrift > 5 ? `<div class="err-box" style="margin:6px 0">Rebalanceo sugerido: algún peso se ha desviado más de 5 puntos de su objetivo.</div>` : ""}
      <table><thead><tr><th>Valor</th><th>Objetivo</th><th>Actual</th><th>Desviación</th><th>Precio inicial</th><th>Precio actual</th><th>Variación</th></tr></thead><tbody>
      ${v.items.map((x) => `<tr data-sym="${esc(x.sym)}"><td><b>${esc(x.sym)}</b></td><td class="num">${pct(x.w * 100)}</td><td class="num">${pct(x.wcur * 100)}</td><td class="num ${Math.abs(x.drift) > 5 ? "stale-txt" : ""}">${sgn(x.drift, 1)} pp</td>
        <td class="num">${nf(x.p0, 2)}</td><td class="num">${nf(x.now, 2)}</td><td class="num chg ${cls(x.now && x.p0 ? x.now / x.p0 - 1 : null)}">${x.now && x.p0 ? spct((x.now / x.p0 - 1) * 100) : "—"}</td></tr>`).join("")}</tbody></table>
      <h2 class="sec">Diario de decisiones</h2>
      ${(p.notas || []).slice().reverse().map((n) => `<div class="note"><span class="hint">${fmtDate(n.f.slice(0, 10))}</span> ${esc(n.t)}</div>`).join("") || '<div class="hint">Sin notas.</div>'}
      <div class="bar" style="margin-top:8px"><input id="cnote" class="txt" placeholder="Por qué compras, vendes o rebalanceas" aria-label="Nueva nota"><button class="icon-btn" data-cnote="${p.id}">Añadir nota</button>
      <span style="flex:1"></span><button class="icon-btn" data-ccsvp="${p.id}">Exportar CSV</button><button class="icon-btn" data-cdel="${p.id}">Eliminar cartera</button></div></div>`;
  }
  setTimeout(() => C.saved.forEach(async (q) => { const el = document.getElementById("bench_" + q.id); if (el) { const b = await benchRet(q); el.textContent = b == null ? "—" : spct(b, 2); el.className = "num chg " + cls(b); } }), 0);
  return h;
}
async function saveCurrent() {
  const r = C.res; if (!r) return;
  const [a, e] = await Promise.all([prices("IDX_SP500").catch(() => null), prices("IDX_STOXX50").catch(() => null)]);
  const us = r.items.reduce((s, x) => s + (isUS(x.r) ? x.w : 0), 0);
  const p = { id: Date.now().toString(36), nombre: `Cartera ${new Date().toLocaleDateString("es-ES")} · ${(METODOS.find((m) => m[0] === r.metodo) || [])[1]}`,
    creada: new Date().toISOString(), metodo: r.metodo, capital: C.cfg.capital, us, b_us: a ? a.c[a.c.length - 1] : null, b_eu: e ? e.c[e.c.length - 1] : null,
    items: r.items.map((x) => ({ sym: x.r.sym, w: +x.w.toFixed(4), p0: x.r.precio })), notas: [] };
  C.saved.push(p); store.set("carteras", C.saved); C.tab = "mis"; C.open = p.id; H.render();
}
function csv(rows, name) {
  const q = (v) => (v == null ? "" : /[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(q).join(";")).join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click();
}

/* ---------- eventos ---------- */
function onClick(t, dd) {
  let b;
  const opt = t.closest(".dd-menu button");
  if (opt && dd && dd.dataset.dd?.startsWith("c_")) {
    const k = dd.dataset.dd.slice(2), v = opt.dataset.v;
    C.cfg[k] = ["n", "wmax", "seccap", "capital"].includes(k) ? +v : v; store.set("cartera_cfg", C.cfg); H.render(); return true;
  }
  if ((b = t.closest("[data-ctab]"))) { C.tab = b.dataset.ctab; H.render(); return true; }
  if (t.closest("[data-cbuild]")) { build(); return true; }
  if (t.closest("[data-csave]")) { saveCurrent(); return true; }
  if (t.closest("[data-ccsv]") && C.res) { csv([["Valor", "Nombre", "Peso %", "Importe €", "Acciones", "Puntuación"], ...C.res.items.map((x) => [x.r.sym, x.r.nombre, (x.w * 100).toFixed(2), x.eur.toFixed(0), x.acc, x.r.score])], "cartera.csv"); return true; }
  if ((b = t.closest("[data-copen]"))) { C.open = C.open === b.dataset.copen ? null : b.dataset.copen; H.render(); return true; }
  if ((b = t.closest("[data-cnote]"))) {
    const p = C.saved.find((x) => x.id === b.dataset.cnote), i = document.getElementById("cnote");
    if (p && i && i.value.trim()) { (p.notas = p.notas || []).push({ f: new Date().toISOString(), t: i.value.trim().slice(0, 500) }); store.set("carteras", C.saved); H.render(); }
    return true;
  }
  if ((b = t.closest("[data-cdel]"))) { if (confirm("¿Eliminar esta cartera?")) { C.saved = C.saved.filter((x) => x.id !== b.dataset.cdel); store.set("carteras", C.saved); C.open = null; H.render(); } return true; }
  if ((b = t.closest("[data-ccsvp]"))) { const p = C.saved.find((x) => x.id === b.dataset.ccsvp); const v = valuation(p); csv([["Valor", "Peso objetivo %", "Peso actual %", "Precio inicial", "Precio actual"], ...v.items.map((x) => [x.sym, (x.w * 100).toFixed(2), (x.wcur * 100).toFixed(2), x.p0, x.now])], `${p.nombre}.csv`); return true; }
  if (t.closest("[data-cexport]")) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(C.saved, null, 1)], { type: "application/json" })); a.download = "mis_carteras.json"; a.click(); return true; }
  return false;
}
document.addEventListener("change", async (e) => {
  if (!e.target.dataset.cimport) return;
  const f = e.target.files[0]; if (!f) return;
  try { const arr = JSON.parse(await f.text()); if (!Array.isArray(arr)) throw 0; const ids = new Set(C.saved.map((x) => x.id)); arr.forEach((p) => { if (p.id && p.items && !ids.has(p.id)) C.saved.push(p); }); store.set("carteras", C.saved); C.tab = "mis"; H.render(); }
  catch (err) { alert("El archivo no es una exportación válida de carteras."); }
});

H.modules.carteras = render;
H.handlers.unshift(onClick);
})();
