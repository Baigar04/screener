/* Screener · Sectores, Screener, ficha de empresa, comparador, seguimiento y búsqueda. Usa los helpers de app.js (window.SCR). */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate, store } = H;

const E = {
  uni: null, sec: null, err: null, loading: false,
  region: store.get("eq_region", "Todos"),
  secMetric: store.get("sec_metric", "r3m"),
  f: store.get("filtros", {}),
  rng: store.get("rangos", {}),
  q: "",
  regions: new Set(store.get("scr_regiones", ["EE. UU.", "Europa"])),
  sort: store.get("scr_orden", { k: "mcap", d: -1 }),
  cols: store.get("columnas", null),
  watch: store.get("seguimiento", []),
  onlyWatch: false,
  cmp: store.get("comparar", []),
  more: store.get("mas_filtros", false), showRng: store.get("ver_rangos", false),
  limit: 50, saved: store.get("filtros_guardados", []), tmpl: null,
  ficha: null, chartApi: null,
};

/* ---------- glosario: una línea por métrica ---------- */
const TIPS = {
  per: "PER: precio / beneficio por acción de los últimos 12 meses. Cuántos años de beneficio pagas.",
  per_fwd: "PER previsto: precio / beneficio estimado de los próximos 12 meses.",
  per_vs_sector: "Prima (+) o descuento (−) del PER frente a la mediana de su sector.",
  per_vs_industria: "Prima (+) o descuento (−) del PER frente a la mediana de su industria.",
  ev_ebitda: "EV/EBITDA: valor de la empresa (capitalización + deuda neta) / beneficio operativo antes de amortizaciones.",
  pb: "P/VC: precio / valor contable. Por debajo de 1, cotiza por menos de su patrimonio.",
  ps: "P/V: capitalización / ventas.",
  div: "Rentabilidad por dividendo de los últimos 12 meses.",
  payout: "Pay-out: porcentaje del beneficio que se reparte como dividendo.",
  roe: "ROE: beneficio neto / fondos propios. Rentabilidad para el accionista.",
  roa: "ROA: beneficio neto / activos totales.",
  roic: "ROIC: beneficio operativo después de impuestos / capital invertido. No disponible en la fuente actual.",
  margen_op: "Margen operativo: beneficio operativo / ventas.",
  margen_neto: "Margen neto: beneficio neto / ventas.",
  crec_ventas: "Crecimiento interanual de las ventas del último trimestre.",
  crec_bpa: "Crecimiento interanual del beneficio por acción del último trimestre.",
  deuda_neta_ebitda: "Deuda neta / EBITDA: años de beneficio operativo para pagar la deuda. Negativo = caja neta.",
  deuda_patrimonio: "Deuda / patrimonio neto.",
  mcap: "Capitalización: valor en bolsa de todas las acciones.",
  precio: "Último cierre ajustado.",
  r1d: "Variación en la última sesión.", r1m: "Rentabilidad a 1 mes.", r3m: "Rentabilidad a 3 meses (momentum).",
  r6m: "Rentabilidad a 6 meses.", r1a: "Rentabilidad a 12 meses.",
  vol3m: "Volatilidad anualizada de los últimos 3 meses.",
  rsi: "RSI (14): fuerza relativa 0-100. > 70 sobrecompra, < 30 sobreventa.",
  veredicto: "Veredicto técnico a 1-3 meses según medias de 50 y 200 sesiones y MACD.",
  resultados: "Próxima fecha de presentación de resultados (Yahoo; confirmar con la empresa).",
  beta: "Beta: sensibilidad del valor a los movimientos del mercado (1 = igual que el mercado).",
  sector: "Sector según la clasificación de Yahoo Finance.",
  n_smart: "Número de superinversores de Dataroma que lo tienen en su último 13F.",
  atr_pct: "ATR: rango medio diario de 14 sesiones, en % del precio.",
  vol_rel: "Volumen medio de 5 sesiones / volumen medio de 60.",
};

/* ---------- carga perezosa ---------- */
async function ensure(force) {
  if ((E.uni && !force) || E.loading) return;
  E.loading = true; E.err = null;
  try {
    const [u, s] = await Promise.all(["universe", "sectors"].map((n) => fetch(`data/${n}.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(r.status === 404 ? "Todavía no hay datos de acciones: la primera actualización automática aún no ha terminado." : `Error HTTP ${r.status} al leer ${n}.json`);
      return r.json();
    })));
    E.uni = u; E.sec = s;
    try { const r = await fetch(`data/score.json?t=${Date.now()}`, { cache: "no-store" }); E.sc = r.ok ? await r.json() : null; } catch (e) { E.sc = null; }
    computeScores();
  } catch (e) { E.err = e.message || String(e); }
  E.loading = false;
  H.render();
  if (document.getElementById("gq")?.value) paintSearch();
}

/* ---------- formato ---------- */
const dd_ = (d) => (typeof d === "number" ? d : 1);
const pct = (v, d) => (v == null ? "—" : nf(v, dd_(d)) + " %");
const spct = (v, d) => (v == null ? "—" : sgn(v, dd_(d)) + " %");
function big(v, cur) {
  if (v == null) return "—";
  const a = Math.abs(v), c = cur ? " " + cur : "";
  if (a >= 1e12) return nf(v / 1e12, 2) + " bill." + c;
  if (a >= 1e9) return nf(v / 1e9, 1) + " mil M" + c;
  if (a >= 1e6) return nf(v / 1e6, 0) + " M" + c;
  return nf(v, 0) + c;
}
const cls = (v) => (v == null || v === 0 ? "z" : v > 0 ? "p" : "n");
window.SCRFmt = { pct, spct, big, cls };
const SEC_NAMES = { "Technology": "Tecnología", "Financial Services": "Servicios financieros", "Healthcare": "Salud", "Consumer Cyclical": "Consumo cíclico",
  "Consumer Defensive": "Consumo defensivo", "Industrials": "Industria", "Energy": "Energía", "Utilities": "Utilities", "Real Estate": "Inmobiliario",
  "Basic Materials": "Materiales básicos", "Communication Services": "Comunicaciones", "Financials": "Financiero" };
const sn = (s) => SEC_NAMES[s] || s || "—";
const isW = (s) => E.watch.includes(s);
function logo(r, big) {
  const hue = [...r.sym].reduce((a, c) => a + c.charCodeAt(0), 0) * 37 % 360;
  /* sin logotipos externos: avatar con la inicial (no se envía a terceros qué valores se consultan) */
  return `<span class="av ${big ? "av-l" : ""}" style="--h:${hue}" aria-hidden="true">${esc(r.sym[0])}</span>`;
}
function tags(r) {
  const t = [];
  if (r.score != null && r.score >= 75) t.push(["Top puntuación", "tg-top"]);
  const p = window.SCRSmart?.data?.()?.por_valor?.[r.sym];
  if (p && p.f.filter((x) => /^(Add|Buy)/.test(x[2] || "")).length >= 2) t.push(["Superinversores compran", "tg-sm"]);
  if (p && p.c.some((x) => x[1] === "Compra" && (Date.now() - new Date(x[2])) / 864e5 < 90)) t.push(["Congreso compra", "tg-cg"]);
  if (r.resultados) { const d = (new Date(r.resultados) - Date.now()) / 864e5; if (d >= -1 && d <= 7) t.push(["Resultados esta semana", "tg-er"]); }
  if (r.veredicto === "Alcista" && (r.r3m ?? 0) > 15) t.push(["Momentum", "tg-mo"]);
  return t;
}
const tagHtml = (r, max = 2) => tags(r).slice(0, max).map(([l, c]) => `<span class="tg ${c}">${l}</span>`).join("");
const isC = (s) => E.cmp.includes(s);
const star = (s) => `<button class="star ${isW(s) ? "on" : ""}" data-watch="${esc(s)}" aria-label="${isW(s) ? "Quitar de" : "Añadir a"} seguimiento" title="${isW(s) ? "Quitar de" : "Añadir a"} seguimiento">${isW(s) ? "★" : "☆"}</button>`;
const tip = (k) => (TIPS[k] ? ` data-tip="${esc(TIPS[k])}"` : "");

/* ---------- SECTORES ---------- */
const SEC_COLS = [
  ["n", "Valores", null, 0, (v) => nf(v, 0), "Número de empresas del universo en el sector."],
  ["crec_ventas", "Crec. ventas", true, 1, pct, "Mediana del crecimiento interanual de ventas del último trimestre."],
  ["crec_bpa", "Crec. BPA", true, 1, pct, "Mediana del crecimiento interanual del BPA del último trimestre."],
  ["r1m", "1 mes", true, 0, spct, "Mediana de la rentabilidad a 1 mes."],
  ["r3m", "3 meses", true, 0, spct, "Mediana de la rentabilidad a 3 meses (momentum)."],
  ["r6m", "6 meses", true, 1, spct, "Mediana de la rentabilidad a 6 meses."],
  ["moda", "Aceleración", true, 2, (v) => sgn(v, 1), "Momentum reciente frente al de 6 meses (3 × rent. 1 m − rent. 6 m / 2). Positivo = el sector entra en foco."],
  ["vol3m", "Volatilidad", false, 1, pct, "Mediana de la volatilidad anualizada a 3 meses."],
  ["roe", "ROE", true, 1, pct, "Mediana de la rentabilidad sobre fondos propios."],
  ["margen_op", "Margen op.", true, 2, pct, "Mediana del margen operativo."],
  ["per", "PER", false, 0, (v) => nf(v, 1), "Mediana del PER (solo empresas con beneficios)."],
  ["per_fwd", "PER previsto", false, 2, (v) => nf(v, 1), "Mediana del PER con beneficio estimado a 12 meses."],
  ["pct_sobre_mm200", "% sobre MM200", true, 1, (v) => (v == null ? "—" : v + " %"), "Porcentaje de valores sobre su media de 200 sesiones (amplitud)."],
];
function heatColor(rank, n, good) {
  if (good == null || n < 3) return "";
  let t = rank / (n - 1); if (!good) t = 1 - t;
  const c = t >= 0.5 ? "var(--good)" : "var(--bad)";
  const a = Math.round(Math.abs(t - 0.5) * 2 * 38);
  return a < 4 ? "" : `background:color-mix(in srgb,${c} ${a}%,transparent)`;
}
function renderSectores() {
  if (!E.uni) { ensure(); return stateBox(); }
  const lv = H.S.level, st = E.sec.stats[E.region];
  const cols = SEC_COLS.filter((c) => c[3] <= lv);
  const rows = Object.entries(st.sector).filter(([, d]) => d.n >= 2);
  const m = E.secMetric, asc = SEC_COLS.find((c) => c[0] === m)?.[2] === false;
  rows.sort((a, b) => { const va = a[1][m], vb = b[1][m]; if (va == null) return 1; if (vb == null) return -1; return asc ? va - vb : vb - va; });
  const ranks = {};
  cols.forEach(([k]) => { ranks[k] = rows.map((r) => r[1][k]).filter((x) => x != null).sort((a, b) => a - b); });
  let h = `<h2 class="sec">Radar de sectores <span class="hint">Medianas de ${E.uni.n} valores. Azul = mejor, naranja = peor en cada columna. Pulsa un sector para ver sus industrias.</span></h2>
    <div class="bar">${["Todos", "EE. UU.", "Europa"].map((r) => `<button class="chip ${E.region === r ? "on" : ""}" data-eqr="${r}">${r}</button>`).join("")}
    ${H.dropdown("secmetric", "Ordenar por:", SEC_COLS.filter((c) => c[2] != null && c[3] <= lv).map((c) => [c[0], c[1]]), m)}</div>`;
  if (H.S.explain) {
    const lab = SEC_COLS.find((c) => c[0] === m)[1];
    h += `<div class="panel" style="margin-bottom:10px">Por «${esc(lab)}», los sectores más fuertes son <b>${esc(rows.slice(0, 3).map((r) => sn(r[0])).join(", "))}</b> y los más débiles <b>${esc(rows.slice(-3).map((r) => sn(r[0])).join(", "))}</b>. Que un sector haya subido no garantiza que siga subiendo.</div>`;
  }
  h += `<div class="tbl-wrap"><table><thead><tr><th>Sector</th>${cols.map(([k, t, , , , d]) => `<th class="${k === m ? "sorted" : ""}" data-tip="${esc(d)}" data-secsort="${k}">${t}</th>`).join("")}</tr></thead><tbody>
    ${rows.map(([s, d]) => `<tr data-sector="${esc(s)}"><td>${esc(sn(s))}</td>${cols.map(([k, , good, , fmt]) => `<td class="num" style="${d[k] == null ? "" : heatColor(ranks[k].indexOf(d[k]), ranks[k].length, good)}">${fmt(d[k])}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>`;
  if (lv >= 1 && E.sec.rrg && Object.keys(E.sec.rrg).length) h += rrgChart();
  return h;
}
const RRG_HZ = [["corto", "Corto · 10 semanas"], ["medio", "Medio · 40 semanas"], ["largo", "Largo · 100 semanas"]];
const RRG_PAL = ["#5aa9ff", "#36c690", "#f2b44c", "#ff6b78", "#b48cff", "#4fd1c5", "#f78fb3", "#a3e635", "#fb923c", "#94a3b8", "#e879f9", "#38bdf8"];
E.rrgH = store.get("rrg_h", "corto"); E.rrgSel = null;
const rrgMap = () => { const R = E.sec?.rrg || {}; return R.corto ? R[E.rrgH] || {} : R; };
function rrgChart() {
  const R = rrgMap(), entries = Object.entries(R);
  if (!entries.length) return "";
  const W = 680, Hh = 440, P = 36;
  const all = entries.flatMap(([, r]) => r.cola);
  const span = Math.max(1.2, ...all.map((p) => Math.abs(p[1] - 100)), ...all.map((p) => Math.abs(p[2] - 100))) * 1.12;
  const X = (v) => P + ((v - (100 - span)) / (2 * span)) * (W - 2 * P), Y = (v) => Hh - P - ((v - (100 - span)) / (2 * span)) * (Hh - 2 * P);
  const q = [["Mejorando", "var(--accent)", P, P], ["Liderando", "var(--pos)", X(100), P], ["Rezagado", "var(--neg)", P, Y(100)], ["Debilitándose", "var(--warn)", X(100), Y(100)]];
  const col = Object.fromEntries(Object.keys(E.sec.rrg?.corto || R).map((k, i) => [k, RRG_PAL[i % RRG_PAL.length]]));
  const sel = E.rrgSel && R[E.rrgSel] ? E.rrgSel : null;
  const tails = entries.map(([s, r]) => {
    const c = col[s] || "#94a3b8", on = !sel || sel === s, l = r.cola[r.cola.length - 1];
    return `<g opacity="${on ? 1 : 0.15}"><polyline points="${r.cola.map((p) => `${X(p[1]).toFixed(1)},${Y(p[2]).toFixed(1)}`).join(" ")}" fill="none" stroke="${c}" stroke-width="${sel === s ? 2.2 : 1.4}" opacity=".75"/>
      ${r.cola.slice(0, -1).map((p) => `<circle cx="${X(p[1]).toFixed(1)}" cy="${Y(p[2]).toFixed(1)}" r="${sel === s ? 2.6 : 1.8}" fill="${c}" opacity=".7"><title>${esc(sn(s))} · ${fmtDate(p[0])}</title></circle>`).join("")}
      <circle cx="${X(l[1])}" cy="${Y(l[2])}" r="${sel === s ? 9 : 6.5}" fill="${c}" stroke="var(--surface)" stroke-width="2" data-rrgsel="${esc(s)}" style="cursor:pointer"><title>${esc(sn(s))}: ${r.cuadrante} (pulsa para ver el nombre)</title></circle></g>`;
  }).join("");
  let label = "";
  if (sel) {
    const l = R[sel].cola[R[sel].cola.length - 1], tx = X(l[1]), ty = Y(l[2]), txt = `${sn(sel)} · ${R[sel].cuadrante}`, w = txt.length * 7.2 + 18;
    const lx = Math.min(Math.max(tx + 14, P), W - P - w), ly = Math.max(ty - 34, P + 4);
    label = `<g data-sector="${esc(sel)}" style="cursor:pointer"><rect x="${lx}" y="${ly}" width="${w}" height="26" rx="7" fill="var(--surface)" stroke="${col[sel]}" stroke-width="1.5"/>
      <text x="${lx + 9}" y="${ly + 17}" font-size="13" font-weight="600" fill="var(--text)">${esc(txt)}</text><title>Pulsa para ver las industrias del sector</title></g>`;
  }
  return `<h2 class="sec">Rotación sectorial <span class="hint">Fuerza relativa frente al universo (X) e impulso (Y). Cada punto es una semana. Pulsa el círculo grande de un sector para ver su nombre.</span></h2>
    <div class="bar">${RRG_HZ.map(([k, t]) => `<button class="chip ${E.rrgH === k ? "on" : ""}" data-rrgh="${k}">${t}</button>`).join("")}${sel ? `<button class="link-btn" data-rrgsel="">Mostrar todos</button>` : ""}</div>
    <div class="panel" style="overflow-x:auto"><svg viewBox="0 0 ${W} ${Hh}" style="width:100%;max-width:820px;min-width:520px;height:auto;display:block;margin:0 auto" role="img" aria-label="Rotación sectorial">
    ${q.map(([t, c, x, y]) => `<rect x="${x}" y="${y}" width="${X(100) - P}" height="${Y(100) - P}" fill="${c}" opacity=".06"/><text x="${x + 10}" y="${y + 20}" font-size="14" fill="${c}" font-weight="600">${t}</text>`).join("")}
    <line x1="${X(100)}" x2="${X(100)}" y1="${P}" y2="${Hh - P}" stroke="var(--border)"/><line x1="${P}" x2="${W - P}" y1="${Y(100)}" y2="${Y(100)}" stroke="var(--border)"/>
    <text x="${W - P}" y="${Hh - 10}" font-size="12" fill="var(--muted)" text-anchor="end">Fuerza relativa →</text><text x="${P}" y="${P - 12}" font-size="12" fill="var(--muted)">↑ Impulso</text>${tails}${label}</svg>
    <div class="rrg-leg">${entries.map(([s, r]) => `<button class="rrg-it ${sel === s ? "on" : ""}" data-rrgsel="${esc(s)}"><i style="background:${col[s]}"></i>${esc(sn(s))} <span class="hint">${r.cuadrante}</span></button>`).join("")}</div>
    <div class="method">Lectura habitual: los sectores giran en el sentido de las agujas del reloj (Mejorando → Liderando → Debilitándose → Rezagado). Corto: fuerza relativa sobre 10 semanas; medio: 26; largo: 52. Aproximación propia al gráfico RRG, es una tendencia, no una regla.</div></div>`;
}
function sectorDrawer(s) {
  const st = E.sec.stats[E.region], d = st.sector[s] || {}, rr = rrgMap()[s];
  const inds = Object.entries(st.industria).filter(([, x]) => x.sector === s).sort((a, b) => (b[1].r3m ?? -1e9) - (a[1].r3m ?? -1e9));
  const tops = rowsRegion().filter((r) => r.sector === s && r.r3m != null).sort((a, b) => b.r3m - a.r3m);
  H.openDrawer(`<h3>${esc(sn(s))}</h3><div class="reg">${esc(E.region)} · ${d.n} valores${rr ? ` · Rotación: <b>${rr.cuadrante}</b>` : ""}</div>
    <dl class="kv"><dt${tip("per")}>PER mediano</dt><dd class="num">${nf(d.per, 1)} <span class="hint">(mercado ${nf(st.mercado.per, 1)})</span></dd>
    <dt${tip("crec_ventas")}>Crecimiento ventas</dt><dd class="num">${pct(d.crec_ventas)}</dd><dt${tip("roe")}>ROE</dt><dd class="num">${pct(d.roe)}</dd>
    <dt>Rentabilidad 3 meses</dt><dd class="num">${spct(d.r3m)}</dd><dt>% sobre MM200</dt><dd class="num">${d.pct_sobre_mm200 ?? "—"} %</dd></dl>
    <div class="box"><b>Industrias (por rentabilidad a 3 meses)</b><table><thead><tr><th>Industria</th><th>N</th><th>3 m</th><th>PER</th></tr></thead><tbody>
    ${inds.map(([n, x]) => `<tr><td style="white-space:normal">${esc(n)}</td><td class="num">${x.n}</td><td class="num">${spct(x.r3m)}</td><td class="num">${nf(x.per, 1)}</td></tr>`).join("")}</tbody></table></div>
    <div class="box"><b>Más fuertes a 3 meses</b>${tops.slice(0, 5).map((r) => `<div><a href="#" data-sym="${esc(r.sym)}">${esc(r.nombre || r.sym)}</a> <span class="num chg p">${spct(r.r3m)}</span></div>`).join("")}</div>
    <button class="chip on" data-gosector="${esc(s)}" style="margin-top:12px">Ver el sector en el screener →</button>`);
}

/* ---------- SCREENER: filtros ---------- */
const opt = (...a) => a;
const FILTERS = [
  ["indice", "Índice", 1, null, (r, v) => (r.indices || []).includes(v)],
  ["pais", "País", 1, null, (r, v) => r.pais === v],
  ["sector", "Sector", 0, null, (r, v) => r.sector === v],
  ["industria", "Industria", 2, null, (r, v) => r.industria === v],
  ["mcap", "Capitalización", 1, opt(["200", "Mega (> 200 mil M $)"], ["10", "Grande (> 10 mil M $)"], ["2-10", "Mediana (2-10 mil M $)"], ["<2", "Pequeña (< 2 mil M $)"]),
    (r, v) => { const m = (r.mcap_usd ?? r.mcap ?? 0) / 1e9; return v === "200" ? m > 200 : v === "10" ? m > 10 : v === "2-10" ? m >= 2 && m <= 10 : m < 2; }],
  ["per", "PER", 1, opt(["<10", "< 10"], ["<15", "< 15"], ["<20", "< 20"], ["<30", "< 30"], [">30", "> 30"], ["neg", "Con pérdidas"]),
    (r, v) => (v === "neg" ? r.per == null && r.margen_neto < 0 : r.per != null && (v[0] === "<" ? r.per < +v.slice(1) : r.per > +v.slice(1)))],
  ["per_vs_sector", "PER vs su sector", 1, opt(["-30", "Descuento > 30 %"], ["-15", "Descuento > 15 %"], ["0", "Por debajo"], ["+0", "Por encima"]),
    (r, v) => r.per_vs_sector != null && (v === "+0" ? r.per_vs_sector > 0 : r.per_vs_sector < +v)],
  ["per_vs_industria", "PER vs su industria", 2, opt(["-30", "Descuento > 30 %"], ["-15", "Descuento > 15 %"], ["0", "Por debajo"], ["+0", "Por encima"]),
    (r, v) => r.per_vs_industria != null && (v === "+0" ? r.per_vs_industria > 0 : r.per_vs_industria < +v)],
  ["ev_ebitda", "EV/EBITDA", 2, opt(["<6", "< 6"], ["<10", "< 10"], ["<15", "< 15"], [">15", "> 15"]),
    (r, v) => r.ev_ebitda != null && r.ev_ebitda > 0 && (v[0] === "<" ? r.ev_ebitda < +v.slice(1) : r.ev_ebitda > +v.slice(1))],
  ["pb", "Precio/valor contable", 2, opt(["<1", "< 1"], ["<2", "< 2"], ["<4", "< 4"]), (r, v) => r.pb != null && r.pb > 0 && r.pb < +v.slice(1)],
  ["div", "Dividendo", 1, opt([">0", "Paga dividendo"], [">2", "> 2 %"], [">3", "> 3 %"], [">5", "> 5 %"]), (r, v) => r.div != null && r.div > +v.slice(1)],
  ["roe", "ROE", 2, opt([">10", "> 10 %"], [">15", "> 15 %"], [">20", "> 20 %"]), (r, v) => r.roe != null && r.roe > +v.slice(1)],
  ["margen_op", "Margen operativo", 2, opt([">10", "> 10 %"], [">20", "> 20 %"], [">30", "> 30 %"]), (r, v) => r.margen_op != null && r.margen_op > +v.slice(1)],
  ["crec_ventas", "Crecimiento ventas", 1, opt([">0", "Positivo"], [">10", "> 10 %"], [">20", "> 20 %"]), (r, v) => r.crec_ventas != null && r.crec_ventas > +v.slice(1)],
  ["crec_bpa", "Crecimiento BPA", 2, opt([">0", "Positivo"], [">15", "> 15 %"], [">25", "> 25 %"]), (r, v) => r.crec_bpa != null && r.crec_bpa > +v.slice(1)],
  ["deuda", "Deuda neta/EBITDA", 2, opt(["<0", "Caja neta"], ["<1", "< 1×"], ["<2", "< 2×"], ["<3", "< 3×"]), (r, v) => r.deuda_neta_ebitda != null && r.deuda_neta_ebitda < +v.slice(1)],
  ["r3m", "Momentum 3 meses", 1, opt([">0", "Positivo"], [">10", "> 10 %"], ["<0", "Negativo"], ["<-15", "< −15 %"]),
    (r, v) => r.r3m != null && (v[0] === ">" ? r.r3m > +v.slice(1) : r.r3m < +v.slice(1))],
  ["vol3m", "Volatilidad", 2, opt(["<20", "Baja (< 20 %)"], ["20-35", "Media (20-35 %)"], [">35", "Alta (> 35 %)"]),
    (r, v) => r.vol3m != null && (v === "<20" ? r.vol3m < 20 : v === ">35" ? r.vol3m > 35 : r.vol3m >= 20 && r.vol3m <= 35)],
  ["veredicto", "Técnico", 1, opt(["Alcista", "Alcista"], ["Neutral", "Neutral"], ["Bajista", "Bajista"]), (r, v) => r.veredicto === v],
  ["mm200", "Precio vs MM200", 2, opt(["sobre", "Por encima"], ["bajo", "Por debajo"]), (r, v) => r.sobre_mm200 != null && (v === "sobre" ? r.sobre_mm200 : !r.sobre_mm200)],
  ["rsi", "RSI", 2, opt(["<30", "Sobreventa (< 30)"], ["30-70", "Neutral"], [">70", "Sobrecompra (> 70)"]),
    (r, v) => r.rsi != null && (v === "<30" ? r.rsi < 30 : v === ">70" ? r.rsi > 70 : r.rsi >= 30 && r.rsi <= 70)],
  ["smart", "Superinversores", 1, opt(["1", "En ≥ 1 cartera"], ["3", "En ≥ 3 carteras"], ["5", "En ≥ 5 carteras"], ["buy", "Comprado el último trimestre"], ["cong", "Comprado en el Congreso (12 m)"]),
    (r, v) => { const p = window.SCRSmart?.data()?.por_valor?.[r.sym]; if (!p) return false;
      if (v === "buy") return p.f.some((x) => /^(Add|Buy)/.test(x[2] || "")); if (v === "cong") return p.c.some((x) => x[1] === "Compra"); return p.f.length >= +v; }],
  ["resultados", "Resultados", 1, opt(["30", "En los próximos 30 días"], ["7", "En los próximos 7 días"]),
    (r, v) => { if (!r.resultados) return false; const d = (new Date(r.resultados) - Date.now()) / 864e5; return d >= -1 && d <= +v; }],
];
const FILTER_KEY = { per: "per", per_vs_sector: "per_vs_sector", ev_ebitda: "ev_ebitda", div: "div", roe: "roe", margen_op: "margen_op", crec_ventas: "crec_ventas", crec_bpa: "crec_bpa", deuda: "deuda_neta_ebitda", r3m: "r3m", vol3m: "vol3m", rsi: "rsi" };
/* rangos con controles deslizantes: [clave, etiqueta, mínimo, máximo, paso, sufijo] */
/* ---------- puntuación de oportunidad ---------- */
const FACT = [["calidad", "Calidad"], ["valor", "Valor"], ["crecimiento", "Crecimiento"], ["momentum", "Momentum"], ["smart", "Smart money"], ["macro", "Encaje macro"]];
const FACT_TIP = {
  calidad: "ROE, margen operativo y deuda neta/EBITDA, en percentil dentro de su sector.",
  valor: "PER, EV/EBITDA y P/VC frente a la mediana de su sector, en percentil (más barato = más alto).",
  crecimiento: "Crecimiento de ventas y de BPA, en percentil dentro de su sector.",
  momentum: "Rentabilidad a 3 y 6 meses y distancia a la MM200, en percentil del universo.",
  smart: "Superinversores que lo tienen, compras y ventas del trimestre y operaciones del Congreso, en percentil.",
  macro: "Comportamiento típico de su sector en la fase actual del ciclo (heurística de rotación sectorial).",
};
const PROFILES = {
  "Equilibrado": { calidad: 20, valor: 20, crecimiento: 15, momentum: 20, smart: 15, macro: 10 },
  "Value": { calidad: 30, valor: 35, crecimiento: 10, momentum: 5, smart: 15, macro: 5 },
  "Growth": { calidad: 20, valor: 5, crecimiento: 35, momentum: 25, smart: 10, macro: 5 },
  "Momentum": { calidad: 10, valor: 5, crecimiento: 15, momentum: 45, smart: 15, macro: 10 },
};
E.w = store.get("pesos", PROFILES["Equilibrado"]);
/* nota de ordenación (método v2, 14-nov-2026): un factor sin dato cuenta como neutral (50) con su peso, no se reparte
   entre los demás; sin 3 de los 4 factores básicos no hay nota (no concluyente). Igual que scripts/score.py */
const NEUTRAL = 50;
function scoreFrom(f, tec) {
  if (!f || ["calidad", "valor", "crecimiento", "momentum"].filter((k) => f[k] != null).length < 3) return null;
  let num = 0, den = 0;
  for (const [k] of FACT) if (E.w[k] > 0) { num += E.w[k] * (f[k] != null ? f[k] : NEUTRAL); den += E.w[k]; }
  if (!den) return null;
  let t = num / den; if (tec === "Bajista") t = Math.min(t, 60);
  return Math.round(t);
}
/* cobertura: % del peso de la nota (con tus pesos) que tiene dato real */
function coverageOf(f) {
  if (!f) return null;
  let den = 0, have = 0;
  for (const [k] of FACT) if (E.w[k] > 0) { den += E.w[k]; if (f[k] != null) have += E.w[k]; }
  return den ? Math.round((100 * have) / den) : null;
}
const covBadge = (sym) => { const c = coverageOf(E.sc?.factores?.[sym]); return c == null || c >= 100 ? "" : `<sup class="cov" data-tip="Cobertura ${c} %: ${100 - c} % del peso de la nota es de factores sin dato, que cuentan como neutral (50)">${c}%</sup>`; };
function scoreOf(r) { return scoreFrom(E.sc?.factores?.[r.sym], r.veredicto); }
/* nota explicable: cuántos puntos aporta o resta cada factor frente a una nota neutra de 50 */
function contributions(f, tec) {
  const all = FACT.filter(([k]) => E.w[k] > 0);
  const den = all.reduce((a, [k]) => a + E.w[k], 0); if (!den) return null;
  const ks = all.filter(([k]) => f[k] != null);   // sin dato: neutral (50) → aporta 0 puntos, pero su peso cuenta
  const items = ks.map(([k, t]) => ({ k, t, pct: f[k], w: Math.round((100 * E.w[k]) / den), pts: ((f[k] - 50) * E.w[k]) / den })).sort((a, b) => b.pts - a.pts);
  const raw = 50 + items.reduce((a, x) => a + x.pts, 0);
  const missing = all.filter(([k]) => f[k] == null);
  return { items, raw, capped: tec === "Bajista" && raw > 60, missing: missing.map(([, t]) => t), cov: coverageOf(f),
    missingW: missing.reduce((a, [k]) => a + Math.round((100 * E.w[k]) / den), 0) };
}
/* qué ha cambiado desde la sesión anterior, con los pesos del usuario */
function changeOf(sym) {
  const A = E.sc?.anterior; if (!A?.factores?.[sym]) return null;
  const r = E.uni?.filas.find((x) => x.sym === sym); if (!r) return null;
  const f0 = A.factores[sym], f1 = E.sc.factores[sym] || {};
  const t0 = A.veredictos?.[sym] || null, t1 = r.veredicto || null;
  const n0 = scoreFrom(f0, t0), n1 = scoreFrom(f1, t1);
  const fx = FACT.map(([k, t]) => ({ k, t, d: f1[k] != null && f0[k] != null ? f1[k] - f0[k] : null })).filter((x) => x.d != null && Math.abs(x.d) >= 1).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  return { fecha: A.fecha, n0, n1, d: n0 != null && n1 != null ? n1 - n0 : null, fx, t0, t1 };
}
function changesPanel() {
  if (!E.sc?.anterior) return `<div class="wpanel"><div class="hint">«Qué ha cambiado» empieza a funcionar a partir de la segunda actualización con este registro.</div></div>`;
  const all = rowsRegion().map((r) => ({ r, c: changeOf(r.sym) })).filter((x) => x.c && x.c.d != null);
  const up = all.filter((x) => x.c.d > 0).sort((a, b) => b.c.d - a.c.d).slice(0, 10);
  const dn = all.filter((x) => x.c.d < 0).sort((a, b) => a.c.d - b.c.d).slice(0, 10);
  const tecCh = all.filter((x) => x.c.t0 !== x.c.t1 && x.c.t0 && x.c.t1);
  const row = ({ r, c }) => `<tr data-sym="${esc(r.sym)}"><td><b>${esc(r.sym)}</b> <span class="hint">${esc(r.nombre || "")}</span></td><td class="num">${c.n0} → ${scoreBadge(c.n1)}</td>
    <td class="num chg ${cls(c.d)}">${sgn(c.d, 0)}</td><td class="hint">${c.fx.slice(0, 2).map((x) => `${esc(x.t)} ${sgn(x.d, 0)}`).join(" · ") || (c.t0 !== c.t1 ? `técnico ${esc(c.t0 || "—")} → ${esc(c.t1 || "—")}` : "")}</td></tr>`;
  const tbl = (t, xs) => `<div class="box"><b>${t}</b>${xs.length ? `<div class="lab-tw"><table><thead><tr><th>Valor</th><th>Nota</th><th>Cambio</th><th>Por qué</th></tr></thead><tbody>${xs.map(row).join("")}</tbody></table></div>` : '<div class="hint">Ninguno.</div>'}</div>`;
  return `<div class="wpanel"><div class="hint">Frente a la sesión del ${fmtDate(E.sc.anterior.fecha)}, con tus pesos (${esc(profileName())}). Pulsa un valor para abrir su ficha.</div>
    <div class="f-grid">${tbl("Más suben de nota", up)}${tbl("Más bajan de nota", dn)}</div>
    ${tecCh.length ? `<div class="box"><b>Cambios de veredicto técnico (${tecCh.length})</b><div class="chg-tags">${tecCh.slice(0, 40).map(({ r, c }) => `<button class="chip" data-sym="${esc(r.sym)}">${esc(r.sym)}: ${esc(c.t0)} → <span class="chg ${c.t1 === "Alcista" ? "p" : c.t1 === "Bajista" ? "n" : "z"}">${esc(c.t1)}</span></button>`).join("")}</div></div>` : ""}</div>`;
}
function computeScores() { if (!E.uni) return; E.uni.filas.forEach((r) => { r.score = scoreOf(r); }); }
window.SCRFactors = (s) => E.sc?.factores?.[s];
/* el laboratorio decide el nombre: «de oportunidad» solo si algún factor supera el umbral estadístico */
function scoreName() { return E.sc?.veredicto_lab?.etiqueta === "ordenación" ? "Puntuación de ordenación" : "Puntuación de oportunidad"; }
window.SCRScoreName = scoreName;
window.SCRSetWeights = (w) => { E.w = { ...w }; store.set("pesos", E.w); computeScores(); };
const scoreBadge = (v) => (v == null ? "—" : `<span class="sc sc-${v >= 70 ? "hi" : v >= 50 ? "mid" : "lo"}">${v}</span>`);
const profileName = () => Object.keys(PROFILES).find((k) => FACT.every(([f]) => PROFILES[k][f] === E.w[f])) || "Personalizado";
function explain(r) {
  const f = E.sc?.factores?.[r.sym]; if (!f) return null;
  const phrase = {
    calidad: () => `calidad ${Math.round(f.calidad)} (ROE ${pct(r.roe)}, margen operativo ${pct(r.margen_op)})`,
    valor: () => `valor ${Math.round(f.valor)} (frente a su sector: PER ${r.per_vs_sector == null ? "sin dato" : spct(r.per_vs_sector, 0)}, EV/EBITDA ${r.ev_ebitda_vs_sector == null ? "sin dato" : spct(r.ev_ebitda_vs_sector, 0)}, P/VC ${r.pb_vs_sector == null ? "sin dato" : spct(r.pb_vs_sector, 0)})`,
    crecimiento: () => `crecimiento ${Math.round(f.crecimiento)} (ventas ${spct(r.crec_ventas)}, BPA ${spct(r.crec_bpa)})`,
    momentum: () => `momentum ${Math.round(f.momentum)} (${spct(r.r3m)} en 3 meses)`,
    smart: () => `smart money ${Math.round(f.smart)} (${r.n_smart ?? 0} superinversores${r.n_cong ? `, ${r.n_cong} operaciones en el Congreso` : ""})`,
    macro: () => `encaje macro ${Math.round(f.macro)} (sector ${sn(r.sector)} en fase de ${E.sc.regimen || "—"})`,
  };
  const av = FACT.filter(([k]) => f[k] != null && E.w[k] > 0).sort((a, b) => f[b[0]] - f[a[0]]);
  if (!av.length) return null;
  const por = `Destaca por ${av.slice(0, 2).map(([k]) => phrase[k]()).join(" y ")}. Punto débil: ${phrase[av[av.length - 1][0]]()}.`;
  const inv = [];
  if (r.invalidacion) inv.push(`cierre ${r.veredicto === "Alcista" ? "por debajo" : "por encima"} de ${nf(r.invalidacion, 2)}`);
  else if (r.sma200) inv.push(`pérdida de la media de 200 sesiones (${nf(r.sma200, 2)})`);
  if (r.resultados) { const d = (new Date(r.resultados) - Date.now()) / 864e5; if (d > -1 && d < 75) inv.push(`unos resultados del ${fmtDate(r.resultados)} que empeoren márgenes o crecimiento`); }
  if (r.veredicto === "Bajista") inv.unshift("el técnico es bajista: la nota está limitada a 60 hasta que cambie");
  const fast = (E.w.momentum + E.w.smart) > (E.w.calidad + E.w.valor);
  return { por, inv: inv.length ? "Qué la invalidaría: " + inv.join("; ") + "." : "", hz: fast ? "Horizonte: 1-3 meses (pesa más el momentum)." : "Horizonte: 6-12 meses (pesan más calidad y valor)." };
}
function weightsPanel() {
  const hist = E.sc?.historial || [];
  return `<div class="wpanel"><div class="bar"><span class="hint">Perfil:</span>${Object.keys(PROFILES).map((p) => `<button class="chip ${profileName() === p ? "on" : ""}" data-prof="${p}">${p}</button>`).join("")}
    ${profileName() === "Personalizado" ? '<span class="chip on">Personalizado</span>' : ""}</div>
    <div class="rng-grid">${FACT.map(([k, t]) => `<div class="rng"><div class="rng-h"><span data-tip="${esc(FACT_TIP[k])}">${t}</span><span class="num rng-v" id="wv_${k}">${E.w[k]}</span></div>
      <input class="wslider" type="range" min="0" max="50" step="5" value="${E.w[k]}" data-w="${k}" aria-label="Peso ${t}"></div>`).join("")}</div>
    <div class="method">${esc(E.sc?.metodo || "")} Los pesos se normalizan: solo importa su proporción.</div>
    ${hist.length ? `<div class="box"><b>Historial del top 20 (perfil Equilibrado), registrado cada semana</b><table><thead><tr><th>Semana</th><th>Días</th><th>Top 20</th><th>Universo</th><th>Diferencia</th></tr></thead><tbody>
      ${hist.slice().reverse().slice(0, 12).map((h) => `<tr><td>${fmtDate(h.fecha.slice(0, 10))}</td><td class="num">${h.dias}</td><td class="num chg ${cls(h.top)}">${spct(h.top, 2)}</td><td class="num chg ${cls(h.universo)}">${spct(h.universo, 2)}</td>
        <td class="num chg ${cls(h.top - h.universo)}">${h.top == null || h.universo == null ? "—" : sgn(h.top - h.universo, 2) + " pp"}</td></tr>`).join("")}</tbody></table>
      <div class="method">Rentabilidad media desde la fecha de registro hasta el último cierre. Hacen falta varios meses de registros para sacar conclusiones.</div></div>` : ""}</div>`;
}

const RANGES = [
  ["per", "PER", 0, 80, 1, ""], ["ev_ebitda", "EV/EBITDA", 0, 40, 0.5, "×"], ["div", "Dividendo", 0, 10, 0.25, " %"],
  ["roe", "ROE", -20, 60, 1, " %"], ["margen_op", "Margen operativo", -10, 60, 1, " %"], ["crec_ventas", "Crecimiento ventas", -30, 60, 1, " %"],
  ["r3m", "Rentabilidad 3 meses", -40, 60, 1, " %"], ["r1a", "Rentabilidad 1 año", -60, 150, 5, " %"], ["vol3m", "Volatilidad", 0, 80, 1, " %"],
  ["rsi", "RSI", 0, 100, 1, ""], ["deuda_neta_ebitda", "Deuda neta/EBITDA", -3, 8, 0.25, "×"], ["score", "Puntuación", 0, 100, 5, ""],
  ["f_fs", "F-score (Piotroski)", 0, 9, 1, ""], ["f_gp", "Rentabilidad bruta", -10, 80, 1, " %"], ["f_sue", "Sorpresa de beneficios", -5, 5, 0.5, ""],
];
const TEMPLATES = {
  "Valor": { per: "<15", per_vs_sector: "-15", deuda: "<3" }, "Calidad": { roe: ">15", margen_op: ">20", deuda: "<2" },
  "Crecimiento": { crec_ventas: ">10", crec_bpa: ">15" }, "Dividendo": { div: ">3", deuda: "<3" },
  "Momentum": { r3m: ">10", mm200: "sobre", veredicto: "Alcista" }, "Rebote técnico": { rsi: "<30", per_vs_sector: "0" },
};
const TEMPLATE_TXT = {
  "Valor": "Baratas frente a su sector y sin exceso de deuda.", "Calidad": "Alta rentabilidad, márgenes amplios y balance sano.",
  "Crecimiento": "Ventas y beneficios creciendo con fuerza.", "Dividendo": "Dividendo superior al 3 % con deuda controlada.",
  "Momentum": "Tendencia alcista confirmada por precio, medias y MACD.", "Rebote técnico": "Sobreventa y valoración por debajo de su sector.",
};
/* columnas: clave, etiqueta, nivel por defecto, formato */
const COLS = [
  ["sector", "Sector", 1, (v) => esc(sn(v))], ["industria", "Industria", 9, (v) => esc(v || "—")], ["pais", "País", 9, (v) => esc(v || "—")],
  ["mcap", "Capitalización", 1, (v, r) => big(v, r.moneda)], ["precio", "Precio", 0, (v) => nf(v, 2)],
  ["r1d", "Día", 2, spct], ["r1m", "1 mes", 9, spct], ["r3m", "3 meses", 0, spct], ["r6m", "6 meses", 9, spct], ["r1a", "1 año", 1, spct],
  ["per", "PER", 0, (v) => nf(v, 1)], ["per_fwd", "PER prev.", 9, (v) => nf(v, 1)], ["per_vs_sector", "PER vs sector", 1, (v) => spct(v, 0)],
  ["ev_ebitda", "EV/EBITDA", 2, (v) => nf(v, 1)], ["pb", "P/VC", 9, (v) => nf(v, 2)], ["ps", "P/V", 9, (v) => nf(v, 2)],
  ["div", "Dividendo", 0, (v) => pct(v)], ["roe", "ROE", 1, (v) => pct(v)], ["margen_op", "Margen op.", 9, (v) => pct(v)],
  ["crec_ventas", "Crec. ventas", 1, spct], ["crec_bpa", "Crec. BPA", 9, spct],
  ["deuda_neta_ebitda", "DN/EBITDA", 2, (v) => (v == null ? "—" : nf(v, 1) + "×")], ["beta", "Beta", 9, (v) => nf(v, 2)],
  ["vol3m", "Volatilidad", 9, (v) => pct(v)], ["rsi", "RSI", 2, (v) => nf(v, 0)],
  ["veredicto", "Técnico", 0, (v) => (v ? `<span class="badge ${v === "Alcista" ? "Favorable" : v === "Bajista" ? "Defensivo" : "Neutral"}">${v}</span>` : "—")],
  ["resultados", "Resultados", 1, (v) => (v ? fmtDate(v) : "—")],
  ["n_smart", "Superinv.", 1, (v) => (v == null ? "—" : v || "·")],
  ["f_fs", "F-score", 9, (v) => (v == null ? "—" : nf(v, 1))], ["f_gp", "Rent. bruta", 9, (v) => pct(v)], ["f_ag", "Crec. activos", 9, spct],
  ["f_acr", "Devengos", 9, spct], ["f_nsi", "Emisión acciones", 9, spct], ["f_sue", "Sorpresa BN", 9, (v) => (v == null ? "—" : sgn(v, 1))],
  ["score", "Puntuación", 0, (v, r) => (v == null ? `<span class="hint" data-tip="No concluyente: faltan datos en 2 o más de los 4 factores básicos">s. d.</span>` : scoreBadge(v) + covBadge(r.sym))],
];
const colsFor = (lv) => (E.cols && E.cols.length ? E.cols : COLS.filter((c) => c[2] <= lv).map((c) => c[0]));

function rowsRegion() { return E.uni.filas.filter((r) => E.regions.has(r.region)); }
function filtered() {
  let rows = rowsRegion();
  if (E.onlyWatch) rows = rows.filter((r) => isW(r.sym));
  const q = E.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.sym.toLowerCase().includes(q) || (r.nombre || "").toLowerCase().includes(q));
  for (const [id, v] of Object.entries(E.f)) {
    const def = FILTERS.find((x) => x[0] === id);
    if (def && v) rows = rows.filter((r) => def[4](r, v));
  }
  for (const [k, [a, b]] of Object.entries(E.rng)) {
    const R = RANGES.find((x) => x[0] === k); if (!R) continue;
    rows = rows.filter((r) => r[k] != null && (a <= R[2] || r[k] >= a) && (b >= R[3] || r[k] <= b));
  }
  const { k, d } = E.sort;
  rows.sort((x, y) => {
    const va = k === "nombre" ? x.sym : k === "mcap" ? x.mcap_usd ?? x.mcap : x[k], vb = k === "nombre" ? y.sym : k === "mcap" ? y.mcap_usd ?? y.mcap : y[k];
    if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
    return typeof va === "string" ? d * va.localeCompare(vb, "es") : d * (va - vb);
  });
  return rows;
}
function filterOptions(id, rows) {
  const def = FILTERS.find((x) => x[0] === id);
  if (def[3]) return def[3];
  const vals = new Map();
  rows.forEach((r) => (id === "indice" ? r.indices || [] : [r[id]]).forEach((v) => v && vals.set(v, (vals.get(v) || 0) + 1)));
  return [...vals.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => [v, `${id === "sector" ? sn(v) : v} (${n})`]);
}
function activeChips() {
  const out = [];
  for (const [id, v] of Object.entries(E.f)) {
    if (!v) continue;
    const def = FILTERS.find((x) => x[0] === id); if (!def) continue;
    const o = def[3] ? (def[3].find((x) => x[0] === v) || [, v])[1] : id === "sector" ? sn(v) : v;
    out.push(`<button class="fchip" data-rmf="${id}" title="Quitar">${esc(def[1])}: ${esc(o)} <span aria-hidden="true">×</span></button>`);
  }
  for (const [k, [a, b]] of Object.entries(E.rng)) {
    const R = RANGES.find((x) => x[0] === k); if (!R) continue;
    const lo = a > R[2] ? nf(a, R[4] < 1 ? 2 : 0) + R[5] : "", hi = b < R[3] ? nf(b, R[4] < 1 ? 2 : 0) + R[5] : "";
    const txt = lo && hi ? `${lo} – ${hi}` : lo ? `≥ ${lo}` : `≤ ${hi}`;
    out.push(`<button class="fchip" data-rmr="${k}" title="Quitar">${esc(R[1])}: ${txt} <span aria-hidden="true">×</span></button>`);
  }
  if (E.q) out.push(`<button class="fchip" data-rmq="1">Texto: «${esc(E.q)}» <span aria-hidden="true">×</span></button>`);
  if (E.onlyWatch) out.push(`<button class="fchip" data-act="watchonly">Solo seguimiento <span aria-hidden="true">×</span></button>`);
  return out;
}
function rangePanel() {
  return `<div class="rng-grid">${RANGES.map(([k, lab, mn, mx, st, suf]) => {
    const [a, b] = E.rng[k] || [mn, mx];
    const show = (v, edge) => (v === edge ? (edge === mn ? "mín." : "máx.") : nf(v, st < 1 ? 2 : 0) + suf);
    return `<div class="rng"><div class="rng-h"><span${tip(k)}>${lab}</span><span class="num rng-v" id="rv_${k}">${show(a, mn)} – ${show(b, mx)}</span></div>
      <div class="rng-s" style="--a:${((a - mn) / (mx - mn)) * 100}%;--b:${((b - mn) / (mx - mn)) * 100}%">
      <input type="range" min="${mn}" max="${mx}" step="${st}" value="${a}" data-rng="${k}" data-end="0" aria-label="${lab} mínimo">
      <input type="range" min="${mn}" max="${mx}" step="${st}" value="${b}" data-rng="${k}" data-end="1" aria-label="${lab} máximo"></div></div>`;
  }).join("")}</div>`;
}

function enrichSmart() {
  const d = window.SCRSmart?.data(); if (!d || E._smartDone === d) return;
  E.uni.filas.forEach((r) => { const p = d.por_valor[r.sym]; r.n_smart = p ? p.f.length : 0; r.n_cong = p ? p.c.length : 0; });
  E._smartDone = d;
}
function renderScreener() {
  if (!E.uni) { ensure(); return stateBox(); }
  window.SCRSmart?.ensure(); enrichSmart();
  const lv = H.S.level, base = rowsRegion(), rows = filtered();
  const fdefs = FILTERS.filter((f) => f[2] <= lv);
  const cols = colsFor(lv).map((k) => COLS.find((c) => c[0] === k)).filter(Boolean);
  const chips = activeChips();
  return `<div class="scr-head"><div class="search-in"><svg viewBox="0 0 24 24"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"/></svg>
      <input id="scrq" type="search" placeholder="Filtrar por ticker o nombre" value="${esc(E.q)}" autocomplete="off" aria-label="Filtrar por ticker o nombre"></div>
    ${["EE. UU.", "Europa"].map((r) => `<button class="chip ${E.regions.has(r) ? "on" : ""}" data-scr="${r}">${r}</button>`).join("")}
    <button class="chip ${E.onlyWatch ? "on" : ""}" data-act="watchonly">★ Seguimiento (${E.watch.length})</button>
    <button class="chip mf-btn ${E.mf ? "on" : ""}" data-act="mf">Filtros${chips.length ? ` (${chips.length})` : ""} ▾</button></div>
    <div class="fwrap ${E.mf ? "open" : ""}"><div class="bar"><span class="hint">Plantillas:</span>${E.sc ? `<button class="chip ${E.tmpl === "Top" ? "on" : ""}" data-tmpl="Top" data-tip="Los valores con mejor puntuación según tus pesos">★ Top puntuación</button>` : ""}${Object.keys(TEMPLATES).map((t) => `<button class="chip ${E.tmpl === t ? "on" : ""}" data-tmpl="${t}" data-tip="${esc(TEMPLATE_TXT[t])}">${t}</button>`).join("")}
    ${E.sc ? `<button class="chip ${E.showW ? "on" : ""}" data-act="weights">Pesos de la puntuación · ${profileName()}</button><button class="chip ${E.showChg ? "on" : ""}" data-act="changes">Qué ha cambiado</button>` : ""}</div>
    ${E.showW && E.sc ? weightsPanel() : ""}${E.showChg && E.sc ? changesPanel() : ""}
    <div class="bar">${fdefs.filter((f) => f[2] <= 1 || E.more || E.f[f[0]]).map(([id, lab]) => H.dropdown("f_" + id, lab + ":", [["", "Cualquiera"], ...filterOptions(id, base)], E.f[id] || "")).join("")}
    ${fdefs.some((f) => f[2] > 1) ? `<button class="chip" data-act="morefilters">${E.more ? "Menos filtros" : `Más filtros (${fdefs.filter((f) => f[2] > 1).length})`}</button>` : ""}
    ${lv >= 1 ? `<button class="chip ${E.showRng ? "on" : ""}" data-act="ranges">Rangos ⇆</button>` : ""}</div>
    ${E.showRng && lv >= 1 ? rangePanel() : ""}</div>
    ${chips.length ? `<div class="bar fchips">${chips.join("")}<button class="link-btn" data-act="clear">Limpiar todo</button></div>` : ""}
    <div class="bar"><b class="num">${rows.length}</b><span class="hint">de ${base.length} valores</span><span style="flex:1"></span>
    ${Object.values(E.f).some(Boolean) || Object.keys(E.rng).length ? `<button class="icon-btn" data-act="save">Guardar filtro</button>` : ""}
    ${E.saved.length ? H.dropdown("saved", "Mis filtros:", [["", "Elegir…"], ...E.saved.map((s, i) => [String(i), s.n])], "") : ""}
    ${colsMenu(lv)}<button class="icon-btn" data-act="csv">Exportar CSV</button></div>
    ${window.innerWidth <= 640 ? `<div class="mcards">${rows.length ? rows.slice(0, E.limit).map((r) => `<div class="mcard" data-sym="${esc(r.sym)}">${logo(r, true)}
      <div class="mc-mid"><div><b>${esc(r.sym)}</b> ${star(r.sym)}</div><div class="nm">${esc(r.nombre || "")}</div>${tagHtml(r, 3) ? `<div class="tgs">${tagHtml(r, 3)}</div>` : ""}</div>
      <div class="mc-right"><div class="mc-px num">${nf(r.precio, 2)} <small>${esc(r.moneda || "")}</small></div><span class="pill ${cls(r.r1d)}">${(r.r1d ?? 0) >= 0 ? "↑" : "↓"} ${nf(Math.abs(r.r1d ?? 0), 2)} %</span>
      ${r.score != null ? `<div class="mc-sc">${scoreBadge(r.score)}${covBadge(r.sym)}</div>` : ""}</div></div>`).join("") : `<div class="soon-box">Ningún valor cumple los filtros. <button class="link-btn" data-act="clear">Limpiar filtros</button></div>`}</div>` : `
    <div class="tbl-wrap"><table class="scr"><thead><tr><th class="c-x" data-tip="Marca hasta 4 valores para compararlos">⇄</th>
      <th data-scrsort="nombre" class="${E.sort.k === "nombre" ? "sorted" : ""}">Valor${E.sort.k === "nombre" ? (E.sort.d < 0 ? " ↓" : " ↑") : ""}</th>
      ${cols.map(([k, t]) => `<th data-scrsort="${k}"${tip(k)} class="${E.sort.k === k ? "sorted" : ""}">${t}${E.sort.k === k ? (E.sort.d < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.length ? rows.slice(0, E.limit).map((r) => `<tr data-sym="${esc(r.sym)}" class="${isC(r.sym) ? "sel" : ""}">
      <td class="c-x"><input type="checkbox" data-cmp="${esc(r.sym)}" ${isC(r.sym) ? "checked" : ""} aria-label="Comparar ${esc(r.sym)}"></td>
      <td class="c-name"><div class="nmw">${star(r.sym)}${logo(r)}<div><div><b>${esc(r.sym)}</b> <span class="nm">${esc((r.nombre || "").slice(0, 26))}</span></div>${tagHtml(r) ? `<div class="tgs">${tagHtml(r)}</div>` : ""}</div></div></td>
      ${cols.map(([k, , , fmt]) => `<td class="num ${["r1d", "r1m", "r3m", "r6m", "r1a"].includes(k) ? "chg " + cls(r[k]) : ""}">${fmt(r[k], r)}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${cols.length + 2}" class="empty">Ningún valor cumple los filtros. <button class="link-btn" data-act="clear">Limpiar filtros</button></td></tr>`}</tbody></table></div>`}
    ${rows.length > E.limit ? `<div style="text-align:center;margin-top:10px"><button class="icon-btn" data-act="more">Mostrar 50 más (${rows.length - E.limit} restantes)</button></div>` : ""}
    <div class="method">Precios y fundamentales: Yahoo Finance, con los fundamentales refrescados por rotación semanal. Sin revisiones de beneficios ni ROIC: no hay fuente pública fiable.</div>
    ${cmpBar()}`;
}
function colsMenu(lv) {
  const cur = colsFor(lv);
  return `<div class="dd" data-dd="cols"><button class="dd-btn"><span class="lab">Columnas</span> ${cur.length} ▾</button>
    <div class="dd-menu cols-menu">${COLS.map(([k, t]) => `<label class="ck"><input type="checkbox" data-col="${k}" ${cur.includes(k) ? "checked" : ""}> ${t}</label>`).join("")}
    <button class="link-btn" data-act="colsreset">Restablecer según nivel</button></div></div>`;
}
function cmpBar() {
  if (!E.cmp.length) return "";
  return `<div class="cmp-bar"><span>${E.cmp.map((s) => `<b>${esc(s)}</b>`).join(" · ")}</span>
    <button class="icon-btn primary" data-act="compare" ${E.cmp.length < 2 ? "disabled" : ""}>Comparar ${E.cmp.length}</button>
    <button class="link-btn" data-act="cmpclear">Vaciar</button></div>`;
}
function exportCsv() {
  const rows = filtered();
  const keys = ["sym", "nombre", "region", "pais", "sector", "industria", "mcap", "precio", "r1m", "r3m", "r1a", "per", "per_fwd", "per_vs_sector", "ev_ebitda", "pb", "div", "roe", "margen_op", "crec_ventas", "crec_bpa", "deuda_neta_ebitda", "vol3m", "rsi", "veredicto", "resultados"];
  const q = (v) => (v == null ? "" : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [keys.join(";"), ...rows.map((r) => keys.map((k) => q(r[k])).join(";"))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `screener_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
}

/* ---------- FICHA DE EMPRESA: página propia (assets/ficha.js, Fase 6) ---------- */
function companyDrawer(sym, tab) { H.openFicha(sym, tab); }
const cur = () => H.S.ficha;
const paintFicha = () => { if (H.S.ficha) H.render(); };
function mountChart(sym) {
  const el = document.getElementById("fchart");
  if (!el || !window.SCRChart) return;
  if (E.chartApi) { E.chartApi.destroy(); E.chartApi = null; }
  window.SCRChart.mount(el, sym, { fallback: "Se muestra el gráfico simplificado en el Resumen." }).then((api) => { if (cur()?.sym === sym && document.body.contains(el)) E.chartApi = api; else api?.destroy?.(); });
}
const NEWS_LAB = { legal: "Legal", producto: "Producto", expansion: "Expansión", resultados: "Resultados", analistas: "Analistas", directivos: "Directivos", otras: "Otras" };
let newsCat = "relevantes";
async function mountNews(sym) {
  const el = document.getElementById("fnews"); if (!el) return;
  let d; try { d = await window.SCRChart.loadPrices(sym); } catch (e) { el.innerHTML = `<div class="err-box">No se pudieron cargar los eventos de ${esc(sym)}.</div>`; return; }
  if (cur()?.sym !== sym || !document.body.contains(el)) return;
  const ev = d.ev || {}, r = E.uni.filas.find((x) => x.sym === sym);
  const ern = ev.ern || [], next = ern.find((x) => x[2] == null && x[0] >= new Date().toISOString().slice(0, 10)), past = ern.filter((x) => x[2] != null).reverse();
  const divs = (ev.div || []).slice().reverse(), y1 = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const div12 = divs.filter((x) => x[0] >= y1).reduce((a, x) => a + x[1], 0);
  const news = ev.news || [], shown = news.filter((n) => newsCat === "todas" ? true : newsCat === "relevantes" ? n[1] !== "otras" : n[1] === newsCat);
  const cats = ["relevantes", "todas", ...Object.keys(NEWS_LAB).filter((k) => news.some((n) => n[1] === k))];
  el.innerHTML = `<div class="f-grid"><div>
    <div class="box"><b>Resultados</b>${next || r?.resultados ? `<div style="margin-bottom:6px">Próximos: <strong class="num">${fmtDate((next || [r.resultados])[0])}</strong>${next && next[1] != null ? ` · BPA estimado ${nf(next[1], 2)}` : ""}</div>` : ""}
      ${past.length ? `<table><thead><tr><th>Fecha</th><th>BPA estimado</th><th>BPA real</th><th>Sorpresa</th></tr></thead><tbody>${past.map(([f, e, rp, su]) => `<tr><td>${fmtDate(f)}</td><td class="num">${nf(e, 2)}</td><td class="num">${nf(rp, 2)}</td><td class="num chg ${cls(su)}">${su == null ? "—" : spct(su)}</td></tr>`).join("")}</tbody></table>` : '<div class="hint">Sin historial de resultados en la fuente (se completa con la actualización semanal de cada valor).</div>'}</div>
    <div class="box"><b>Dividendos</b>${divs.length ? `<div style="margin-bottom:6px">Últimos 12 meses: <strong class="num">${nf(div12, div12 < 1 ? 4 : 2)} ${esc(r?.moneda || "")}</strong> por acción${r?.div != null ? ` · rentabilidad ${pct(r.div)}` : ""}</div>
      <table><thead><tr><th>Fecha ex-dividendo</th><th>Importe</th></tr></thead><tbody>${divs.slice(0, 10).map(([f, a]) => `<tr><td>${fmtDate(f)}</td><td class="num">${nf(a, a < 1 ? 4 : 2)}</td></tr>`).join("")}</tbody></table>` : '<div class="hint">No ha repartido dividendos en los últimos 5 años.</div>'}</div></div>
    <div><div class="box"><b>Noticias (últimos 60 días)</b>
      <div class="bar" style="margin:4px 0 8px">${cats.map((c) => `<button class="chip ${newsCat === c ? "on" : ""}" data-ncat="${c}">${c === "relevantes" ? "Relevantes" : c === "todas" ? "Todas" : NEWS_LAB[c]}</button>`).join("")}</div>
      ${shown.length ? shown.map(([f, c, t, l, pv]) => `<div class="nw"><span class="hint num">${fmtDate(f)}</span> <span class="tg tg-n-${c}">${NEWS_LAB[c] || c}</span><div>${l ? `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t)}</div>${pv ? `<span class="hint">${esc(pv)}</span>` : ""}</div>`).join("")
        : '<div class="hint">Sin noticias en esta categoría. El archivo de noticias empieza a acumularse desde ahora.</div>'}
      <div class="method">Titulares de Yahoo Finance, en su idioma original. La categoría se asigna por palabras clave del titular, no leyendo la noticia: puede equivocarse.</div></div></div></div>`;
}
function mountCompare(sym) {
  const el = document.getElementById("fcmp"); const list = [sym, ...E.cmp.filter((s) => s !== sym)].slice(0, 4);
  if (el && window.SCRChart && list.length > 1) window.SCRChart.compare(el, list);
}
function scoreBox(r) {
  const f = E.sc?.factores?.[r.sym]; if (!f) return "";
  const ex = explain(r), lv = H.S.level;
  return `<div class="box scbox"><b>${esc(scoreName())} · perfil ${esc(profileName())}</b> ${H.evid("e", "r")}
    <div class="sc-top">${r.score == null ? '<b class="hint">No concluyente</b>' : scoreBadge(r.score)}<span class="hint">de 100 · percentil frente a su sector · cobertura ${coverageOf(f) ?? "—"} %</span></div>
    ${FACT.map(([k, t]) => `<div class="prob" data-tip="${esc(FACT_TIP[k])}"><span>${t}${E.w[k] ? "" : ' <span class="hint">(peso 0)</span>'}</span><div class="track"><div class="fill" style="width:${f[k] ?? 0}%;background:${f[k] == null ? "var(--surface-3)" : f[k] >= 70 ? "var(--good)" : f[k] >= 40 ? "var(--faint)" : "var(--bad)"}"></div></div><span class="num">${f[k] == null ? "—" : Math.round(f[k])}</span></div>`).join("")}
    ${ex ? `<div class="sc-ex"><div>${esc(ex.por)}</div>${ex.inv ? `<div>${esc(ex.inv)}</div>` : ""}<div>${esc(ex.hz)}</div></div>` : ""}
    ${(() => {
      const C = contributions(f, r.veredicto); if (!C) return "";
      const mx = Math.max(1, ...C.items.map((x) => Math.abs(x.pts)));
      return `<details class="sc-why" ${H.S.explain ? "open" : ""}><summary>Por qué esta nota: lo que suma y resta cada factor</summary>
        <div class="hint">Partiendo de 50 (la mediana), cada factor suma o resta según su percentil y su peso.</div>
        ${C.items.map((x) => `<div class="why-row"><span>${esc(x.t)} <span class="hint">p${Math.round(x.pct)} · peso ${x.w} %</span></span>
          <span class="why-bar"><span class="${x.pts >= 0 ? "pos" : "neg"}" style="${x.pts >= 0 ? "left:50%" : `right:50%`};width:${(50 * Math.abs(x.pts)) / mx}%"></span></span>
          <b class="num chg ${cls(x.pts)}">${sgn(x.pts, 1)}</b></div>`).join("")}
        <div class="why-tot">50 ${C.items.map((x) => (x.pts >= 0 ? "+ " : "− ") + nf(Math.abs(x.pts), 1)).join(" ")} = <b>${nf(C.raw, 1)}</b>${C.capped ? ` → <b>60</b> <span class="hint">(técnico bajista: la nota se limita a 60)</span>` : ""}</div>
        ${C.missing.length ? `<div class="hint">Sin dato: ${esc(C.missing.join(", "))} (${C.missingW} % del peso). Cuentan como neutral (50): no suman ni restan, y su peso no se reparte entre los demás.</div>` : ""}</details>`;
    })()}
    ${(() => {
      const c = changeOf(r.sym); if (!c) return "";
      const same = c.d === 0 && !c.fx.length && c.t0 === c.t1;
      return `<div class="sc-chg"><b>Qué ha cambiado desde el ${fmtDate(c.fecha)}</b> ${same ? '<span class="hint">Nada relevante.</span>' : `
        <span class="num">${c.n0 ?? "—"} → ${c.n1 ?? "—"}</span> ${c.d != null ? `<span class="chg ${cls(c.d)}">${sgn(c.d, 0)}</span>` : ""}
        ${c.fx.length ? `<div class="hint">${c.fx.map((x) => `${esc(x.t)} ${sgn(x.d, 0)}`).join(" · ")}</div>` : ""}
        ${c.t0 !== c.t1 ? `<div class="hint">Técnico: ${esc(c.t0 || "—")} → ${esc(c.t1 || "—")}</div>` : ""}`}</div>`;
    })()}
    ${H.S.explain ? `<div class="method">Nota para ordenar ideas, no una recomendación de compra.</div>` : ""}</div>`;
}
function miniChart(rows) {
  if (!rows || rows.length < 10) return `<div class="err-box">Sin histórico de precios para el gráfico simplificado.</div>`;
  const W = 420, Hh = 170, L = 4, R = 48, T = 8, B = 20, vals = rows.flatMap((r) => [r[1], r[2], r[3]]).filter((v) => v != null);
  const mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const x = (i) => L + (i / (rows.length - 1)) * (W - L - R), y = (v) => T + (1 - (v - mn) / rg) * (Hh - T - B);
  const ln = (i, c, w, dash = "") => { const p = rows.map((r, j) => (r[i] == null ? null : `${x(j).toFixed(1)},${y(r[i]).toFixed(1)}`)).filter(Boolean).join(" "); return p ? `<polyline points="${p}" fill="none" stroke="${c}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>` : ""; };
  return `<svg class="mini" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Precio 1 año"><text x="${W - R + 4}" y="${y(mx) + 4}" font-size="10" fill="var(--muted)">${nf(mx, 2)}</text><text x="${W - R + 4}" y="${y(mn) + 4}" font-size="10" fill="var(--muted)">${nf(mn, 2)}</text>
    ${ln(3, "var(--warn)", 1.2, "4 3")}${ln(2, "var(--faint)", 1.2)}${ln(1, "var(--accent)", 1.8)}
    <text x="${L}" y="${Hh - 5}" font-size="10" fill="var(--muted)">${fmtDate(rows[0][0])}</text><text x="${W - R}" y="${Hh - 5}" font-size="10" fill="var(--muted)" text-anchor="end">${fmtDate(rows[rows.length - 1][0])}</text></svg>
    <div class="method" style="margin-top:-4px"><span style="color:var(--accent)">━</span> Precio · <span style="color:var(--faint)">━</span> MM50 · <span style="color:var(--warn)">┅</span> MM200</div>`;
}

/* ---------- COMPARADOR ---------- */
const CMP_ROWS = [
  ["precio", "Precio", (v) => nf(v, 2), null], ["mcap", "Capitalización", (v, r) => big(v, r.moneda), true], ["r3m", "Rent. 3 meses", spct, true], ["r1a", "Rent. 1 año", spct, true],
  ["per", "PER", (v) => nf(v, 1), false], ["per_fwd", "PER previsto", (v) => nf(v, 1), false], ["per_vs_sector", "PER vs sector", (v) => spct(v, 0), false],
  ["ev_ebitda", "EV/EBITDA", (v) => nf(v, 1), false], ["pb", "P/VC", (v) => nf(v, 2), false], ["div", "Dividendo", pct, true], ["roe", "ROE", pct, true],
  ["margen_op", "Margen operativo", pct, true], ["crec_ventas", "Crec. ventas", spct, true], ["crec_bpa", "Crec. BPA", spct, true],
  ["deuda_neta_ebitda", "Deuda neta/EBITDA", (v) => (v == null ? "—" : nf(v, 1) + "×"), false], ["vol3m", "Volatilidad", pct, false], ["beta", "Beta", (v) => nf(v, 2), null],
  ["rsi", "RSI", (v) => nf(v, 0), null], ["veredicto", "Técnico", (v) => esc(v || "—"), null], ["resultados", "Resultados", (v) => (v ? fmtDate(v) : "—"), null],
];
function cmpTable(list) {
  const rs = list.map((s) => E.uni.filas.find((x) => x.sym === s)).filter(Boolean);
  return `<div class="tbl-wrap"><table class="cmp"><thead><tr><th>Métrica</th>${rs.map((r) => `<th><a href="#" data-sym="${esc(r.sym)}">${esc(r.sym)}</a> <button class="link-btn" data-cmprm="${esc(r.sym)}" aria-label="Quitar ${esc(r.sym)}">×</button><div class="nm">${esc((r.nombre || "").slice(0, 22))}</div></th>`).join("")}</tr></thead><tbody>
    ${CMP_ROWS.map(([k, t, f, good]) => {
      const vals = rs.map((r) => r[k]).filter((v) => typeof v === "number");
      const best = good == null || vals.length < 2 ? null : good ? Math.max(...vals) : Math.min(...vals.filter((v) => !["per", "per_fwd", "ev_ebitda", "pb"].includes(k) || v > 0));
      const dir = good == null ? 0 : good ? 1 : -1;
      return `<tr><td${tip(k)}>${t}</td>${rs.map((r) => `<td class="num ${best != null && r[k] === best ? "best" : ""}">${f(r[k], r)}${typeof r[k] === "number" && k !== "precio" ? pctPill(pctIn(r, k), dir) : ""}</td>`).join("")}</tr>`;
    }).join("")}
    ${E.sc ? `<tr><td>Nota (tus pesos)</td>${rs.map((r) => `<td class="num">${scoreBadge(r.score)}${covBadge(r.sym)}</td>`).join("")}</tr>
      ${(() => { const cv = rs.map((r) => coverageOf(E.sc.factores?.[r.sym])); return new Set(cv).size > 1 ? `<tr><td colspan="${rs.length + 1}"><div class="fwarn">ⓘ Coberturas distintas (${rs.map((r, i) => `${esc(r.sym)} ${cv[i] ?? "—"} %`).join(" · ")}): las notas no son del todo comparables; los factores sin dato cuentan como neutral (50).</div></td></tr>` : ""; })()}
      ${FACT.map(([k, t]) => `<tr><td data-tip="${esc(FACT_TIP[k])}">${t} <span class="hint">percentil</span></td>${rs.map((r) => { const v = E.sc.factores?.[r.sym]?.[k]; return `<td class="num">${v == null ? "—" : `<span class="pp ${v >= 67 ? "pp-g" : v <= 33 ? "pp-b" : ""}">p${Math.round(v)}</span>`}</td>`; }).join("")}</tr>`).join("")}` : ""}
    </tbody></table></div><div class="method">Resaltado = mejor valor de la fila (no aplica a precio, beta, RSI ni técnico). pNN = percentil dentro de su sector (o del universo si el sector tiene menos de 8 valores con dato); en azul, de lo mejor de su sector en esa medida; en naranja, de lo peor.</div>`;
}
function openCompare() {
  if (E.cmp.length < 2) return;
  if (H.modules.comparar) { H.closeDrawer(); history.replaceState(null, "", location.hash); H.go("comparar"); return; }
  document.getElementById("drawer").classList.add("full");
  H.openDrawer(`<h3>Comparador</h3><div class="reg">${E.cmp.length} valores · máximo 4</div>${cmpTable(E.cmp)}<h2 class="sec">Rentabilidad comparada</h2><div id="fcmp"></div>`);
  const el = document.getElementById("fcmp"); if (el && window.SCRChart) window.SCRChart.compare(el, E.cmp);
}

/* ---------- búsqueda global ---------- */
function searchResults(q) {
  q = q.trim().toLowerCase(); if (!q || !E.uni) return [];
  const sc = (r) => { const s = r.sym.toLowerCase(), n = (r.nombre || "").toLowerCase(); return s === q ? 0 : s.startsWith(q) ? 1 : n.startsWith(q) ? 2 : s.includes(q) ? 3 : n.includes(q) ? 4 : 9; };
  return E.uni.filas.map((r) => [sc(r), r]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || (b[1].mcap || 0) - (a[1].mcap || 0)).slice(0, 8).map(([, r]) => r);
}
let gIdx = 0;
function paintSearch() {
  const inp = document.getElementById("gq"), box = document.getElementById("gres"); if (!inp || !box) return;
  if (!inp.value.trim()) { box.classList.remove("on"); box.innerHTML = ""; return; }
  if (!E.uni) { box.innerHTML = `<div class="gr-msg">${E.err ? esc(E.err) : "Cargando valores…"}</div>`; box.classList.add("on"); return; }
  const res = searchResults(inp.value);
  gIdx = Math.min(gIdx, Math.max(0, res.length - 1));
  box.innerHTML = res.length ? res.map((r, i) => `<button class="gr ${i === gIdx ? "on" : ""}" data-gsym="${esc(r.sym)}">${logo(r)}<b>${esc(r.sym)}</b><span class="nm">${esc(r.nombre || "")}</span><span class="num">${nf(r.precio, 2)}</span><span class="num chg ${cls(r.r1d)}">${spct(r.r1d, 2)}</span></button>`).join("")
    : `<div class="gr-msg">Sin resultados en el universo (${E.uni.n} valores).</div>`;
  box.classList.add("on");
}
function setupSearch() {
  const top = document.querySelector(".top"); if (!top || document.getElementById("gq")) return;
  const w = document.createElement("div"); w.className = "gsearch";
  w.innerHTML = `<svg viewBox="0 0 24 24"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"/></svg><input id="gq" type="search" placeholder="Buscar empresa, ticker o palabra clave…" autocomplete="off" aria-label="Buscar ticker o empresa"><kbd>/</kbd><div id="gres" class="gres" role="listbox"></div>`;
  top.insertBefore(w, top.querySelector(".top-right"));
  const inp = w.querySelector("#gq");
  inp.addEventListener("focus", () => { ensure(); paintSearch(); });
  inp.addEventListener("input", () => { gIdx = 0; paintSearch(); });
  inp.addEventListener("keydown", (e) => {
    const res = searchResults(inp.value);
    if (e.key === "ArrowDown") { gIdx = Math.min(gIdx + 1, res.length - 1); paintSearch(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { gIdx = Math.max(gIdx - 1, 0); paintSearch(); e.preventDefault(); }
    else if (e.key === "Enter" && res[gIdx]) { companyDrawer(res[gIdx].sym); inp.value = ""; paintSearch(); inp.blur(); }
    else if (e.key === "Escape") { inp.value = ""; paintSearch(); inp.blur(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); inp.focus(); }
  });
}

/* ---------- estados ---------- */
function stateBox() {
  if (E.err) return `<div class="err-box"><b>No se pudieron cargar los datos de acciones.</b> ${esc(E.err)}<br><button class="icon-btn" data-act="retry" style="margin-top:10px">Reintentar</button></div>`;
  return `<div class="skel-wrap" aria-busy="true"><div class="skel" style="height:34px;width:60%"></div><div class="skel" style="height:30px"></div>${'<div class="skel" style="height:22px"></div>'.repeat(8)}</div>`;
}

/* ---------- tooltips (uno flotante para toda la página) ---------- */
function setupTips() {
  const t = document.createElement("div"); t.className = "tipbox"; t.setAttribute("role", "tooltip"); document.body.appendChild(t);
  let cur = null;
  const show = (el) => {
    cur = el; t.textContent = el.dataset.tip; t.classList.add("on");
    const r = el.getBoundingClientRect(), w = Math.min(300, window.innerWidth - 16);
    t.style.maxWidth = w + "px";
    const tw = t.offsetWidth, th = t.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8), y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    t.style.left = x + "px"; t.style.top = y + "px";
  };
  document.addEventListener("mouseover", (e) => { const el = e.target.closest("[data-tip]"); if (el && el !== cur) show(el); else if (!el && cur) { cur = null; t.classList.remove("on"); } });
  document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el) show(el); });
  document.addEventListener("scroll", () => { cur = null; t.classList.remove("on"); }, true);
}

/* ---------- eventos ---------- */
function persist() { store.set("filtros", E.f); store.set("rangos", E.rng); }
function toggleCmp(s) {
  if (isC(s)) E.cmp = E.cmp.filter((x) => x !== s);
  else { if (E.cmp.length >= 4) E.cmp.shift(); E.cmp.push(s); }
  store.set("comparar", E.cmp);
}
function onClick(t, dd) {
  let b;
  const opt = t.closest(".dd-menu button");
  if (opt && dd && !opt.closest(".cx")) {
    const id = dd.dataset.dd, v = opt.dataset.v;
    if (id === "secmetric") { E.secMetric = v; store.set("sec_metric", v); }
    else if (id && id.startsWith("f_")) { E.f[id.slice(2)] = v; E.tmpl = null; E.limit = 50; persist(); }
    else if (id === "saved" && v !== "") { E.f = { ...E.saved[+v].f }; E.rng = { ...(E.saved[+v].r || {}) }; E.tmpl = null; persist(); }
    else if (opt.dataset.act === "colsreset") { E.cols = null; store.set("columnas", null); }
    else return false;
    H.render(); return true;
  }
  if (t.closest(".cols-menu")) { if (t.closest("[data-act=colsreset]")) { E.cols = null; store.set("columnas", null); H.render(); } return true; }
  if (t.closest(".cx")) return true; // el gráfico gestiona sus propios clics
  if ((b = t.closest("[data-gsym]"))) { const s = b.dataset.gsym; const i = document.getElementById("gq"); if (i) { i.value = ""; paintSearch(); } companyDrawer(s); return true; }
  if ((b = t.closest("[data-watch]"))) {
    const s = b.dataset.watch; E.watch = isW(s) ? E.watch.filter((x) => x !== s) : [...E.watch, s]; store.set("seguimiento", E.watch);
    H.render(); return true;
  }
  if ((b = t.closest("[data-cmp-toggle]"))) { toggleCmp(b.dataset.cmpToggle); H.render(); return true; }
  if (t.closest("[data-cmp]")) { toggleCmp(t.closest("[data-cmp]").dataset.cmp); H.render(); return true; }
  if (t.closest(".c-x")) return true;
  if ((b = t.closest("[data-cmprm]"))) { toggleCmp(b.dataset.cmprm); if (!document.getElementById("drawer").classList.contains("on")) { H.render(); return true; } if (E.cmp.length >= 2) openCompare(); else H.closeDrawer(); H.render(); return true; }
  if ((b = t.closest("[data-ncat]"))) { newsCat = b.dataset.ncat; if (cur()) mountNews(cur().sym); return true; }
  if ((b = t.closest("[data-gocmp]"))) { E.cmp = b.dataset.gocmp.split(","); store.set("comparar", E.cmp); H.closeDrawer(); H.go("comparar"); return true; }
  if ((b = t.closest("[data-copycmp]"))) {
    const url = location.href.split("#")[0] + "#/comparar/" + E.cmp.join(",");
    (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => { b.textContent = "✓ Copiado"; }, () => { b.textContent = url; });
    return true;
  }
  if ((b = t.closest("[data-copylink]"))) {
    const url = location.href.split("#")[0] + "#/empresa/" + encodeURIComponent(b.dataset.copylink);
    (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => { b.textContent = "✓ Copiado"; }, () => { b.textContent = url; });
    return true;
  }
  if ((b = t.closest("[data-ftab]"))) { if (cur()) H.openFicha(cur().sym, b.dataset.ftab); return true; }
  if ((b = t.closest("[data-eqr]"))) { E.region = b.dataset.eqr; store.set("eq_region", E.region); H.render(); return true; }
  if ((b = t.closest("[data-secsort]"))) { const k = b.dataset.secsort; if (SEC_COLS.find((c) => c[0] === k)[2] != null) { E.secMetric = k; store.set("sec_metric", k); H.render(); } return true; }
  if ((b = t.closest("[data-rrgh]"))) { E.rrgH = b.dataset.rrgh; store.set("rrg_h", E.rrgH); H.render(); return true; }
  if ((b = t.closest("[data-rrgsel]"))) { const v = b.dataset.rrgsel; E.rrgSel = v && E.rrgSel !== v ? v : null; H.render(); return true; }
  if ((b = t.closest("[data-sector]"))) { sectorDrawer(b.dataset.sector); return true; }
  if ((b = t.closest("[data-gosector]"))) { E.f = { sector: b.dataset.gosector }; E.rng = {}; E.tmpl = null; persist(); H.closeDrawer(); H.go("screener"); return true; }
  if ((b = t.closest("[data-prof]"))) { E.w = { ...PROFILES[b.dataset.prof] }; store.set("pesos", E.w); computeScores(); H.render(); return true; }
  if ((b = t.closest("[data-tmpl]")) && b.dataset.tmpl === "Top") {
    if (E.tmpl === "Top") { E.tmpl = null; E.rng = {}; } else { E.tmpl = "Top"; E.f = {}; E.rng = { score: [70, 100] }; E.sort = { k: "score", d: -1 }; store.set("scr_orden", E.sort); }
    E.limit = 50; persist(); H.render(); return true;
  }
  if ((b = t.closest("[data-tmpl]"))) {
    const n = b.dataset.tmpl;
    if (E.tmpl === n) { E.tmpl = null; E.f = {}; } else { E.tmpl = n; E.f = { ...TEMPLATES[n] }; }
    E.limit = 50; persist(); H.render(); return true;
  }
  if ((b = t.closest("[data-scr]"))) { const r = b.dataset.scr; if (E.regions.has(r) && E.regions.size > 1) E.regions.delete(r); else E.regions.add(r); store.set("scr_regiones", [...E.regions]); H.render(); return true; }
  if ((b = t.closest("[data-scrsort]"))) {
    const k = b.dataset.scrsort; E.sort = E.sort.k === k ? { k, d: -E.sort.d } : { k, d: ["nombre", "sector", "industria", "pais"].includes(k) ? 1 : -1 };
    store.set("scr_orden", E.sort); H.render(); return true;
  }
  if ((b = t.closest("[data-rmf]"))) { delete E.f[b.dataset.rmf]; E.tmpl = null; persist(); H.render(); return true; }
  if ((b = t.closest("[data-rmr]"))) { delete E.rng[b.dataset.rmr]; persist(); H.render(); return true; }
  if (t.closest("[data-rmq]")) { E.q = ""; H.render(); return true; }
  if ((b = t.closest("[data-act]"))) {
    const a = b.dataset.act;
    if (a === "clear") { E.f = {}; E.rng = {}; E.q = ""; E.onlyWatch = false; E.tmpl = null; persist(); }
    if (a === "more") E.limit += 50;
    if (a === "morefilters") { E.more = !E.more; store.set("mas_filtros", E.more); }
    if (a === "weights") { E.showW = !E.showW; }
    if (a === "changes") { E.showChg = !E.showChg; }
    if (a === "ranges") { E.showRng = !E.showRng; store.set("ver_rangos", E.showRng); }
    if (a === "watchonly") E.onlyWatch = !E.onlyWatch;
    if (a === "mf") E.mf = !E.mf;
    if (a === "csv") { exportCsv(); return true; }
    if (a === "compare") { openCompare(); return true; }
    if (a === "cmpclear") { E.cmp = []; store.set("comparar", E.cmp); }
    if (a === "retry") { ensure(true); }
    if (a === "save") {
      const parts = Object.entries(E.f).filter(([, v]) => v).map(([k, v]) => `${FILTERS.find((f) => f[0] === k)[1]} ${k === "sector" ? sn(v) : v}`)
        .concat(Object.keys(E.rng).map((k) => RANGES.find((x) => x[0] === k)?.[1] + " (rango)"));
      E.saved.push({ n: ((E.tmpl ? E.tmpl + ": " : "") + parts.join(" · ")).slice(0, 70), f: { ...E.f }, r: { ...E.rng } });
      E.saved = E.saved.slice(-15); store.set("filtros_guardados", E.saved);
    }
    H.render(); return true;
  }
  if ((b = t.closest("[data-sym]"))) { companyDrawer(b.dataset.sym); return true; }
  return false;
}
let qTimer = null;
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "scrq") {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { E.q = t.value; E.limit = 50; const pos = t.selectionStart; H.render(); const n = document.getElementById("scrq"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 180);
  }
  if (t.dataset.rng) {
    const k = t.dataset.rng, R = RANGES.find((x) => x[0] === k), box = t.parentElement, ins = box.querySelectorAll("input");
    let a = +ins[0].value, b2 = +ins[1].value; if (a > b2) { if (t.dataset.end === "0") a = b2; else b2 = a; ins[0].value = a; ins[1].value = b2; }
    box.style.setProperty("--a", ((a - R[2]) / (R[3] - R[2])) * 100 + "%"); box.style.setProperty("--b", ((b2 - R[2]) / (R[3] - R[2])) * 100 + "%");
    const show = (v, edge) => (v === edge ? (edge === R[2] ? "mín." : "máx.") : nf(v, R[4] < 1 ? 2 : 0) + R[5]);
    const lab = document.getElementById("rv_" + k); if (lab) lab.textContent = `${show(a, R[2])} – ${show(b2, R[3])}`;
  }
});
document.addEventListener("input", (e) => { const t = e.target; if (t.dataset.w) { const l = document.getElementById("wv_" + t.dataset.w); if (l) l.textContent = t.value; } });
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.w) { E.w = { ...E.w, [t.dataset.w]: +t.value }; store.set("pesos", E.w); computeScores(); H.render(); return; }
  if (t.dataset.rng) {
    const k = t.dataset.rng, R = RANGES.find((x) => x[0] === k), ins = t.parentElement.querySelectorAll("input");
    const a = +ins[0].value, b = +ins[1].value;
    if (a <= R[2] && b >= R[3]) delete E.rng[k]; else E.rng[k] = [a, b];
    E.limit = 50; persist(); H.render();
  }
  if (t.dataset.col) {
    const cur = colsFor(H.S.level).slice(), k = t.dataset.col;
    E.cols = t.checked ? COLS.map((c) => c[0]).filter((c) => cur.includes(c) || c === k) : cur.filter((c) => c !== k);
    store.set("columnas", E.cols); H.render();
    document.querySelector('[data-dd="cols"]')?.classList.add("open");
  }
});

/* el panel a pantalla completa (comparador sin módulo) vuelve a su tamaño al cerrarse */
const _close = H.closeDrawer;
H.closeDrawer = () => { document.getElementById("drawer").classList.remove("full"); _close(); };
document.addEventListener("click", (e) => { if (e.target.closest("#drawerClose") || e.target.id === "overlay") document.getElementById("drawer").classList.remove("full"); }, true);

window.SCRUni = () => (E.uni ? E.uni.filas : []);
window.SCREq = { sc: () => E.sc, changeOf: (s) => changeOf(s), watch: () => E.watch, scoreBadge: (v) => scoreBadge(v), cmp: () => E.cmp, saved: () => E.saved,
  applySaved: (i) => { const x = E.saved[i]; if (!x) return; E.f = { ...x.f }; E.rng = { ...(x.r || {}) }; E.tmpl = null; persist(); H.go("screener"); } };
window.SCRFiltered = () => (E.uni ? filtered() : []);
window.SCREnsureUni = () => ensure();
window.SCROpen = (sym, tab) => companyDrawer(sym, tab);
window.SCRFichaSym = () => (H.S.ficha && document.querySelector("#view .fp") ? H.S.ficha.sym : null);
if (window.SCRSmart) window.SCRSmart.onload = () => paintFicha();
/* piezas que usa la ficha (assets/ficha.js) */
window.SCRKit = { coverageOf, E, ensure, logo, star, tagHtml: (r, n) => tagHtml(r, n), sn, tip, isC, isW, scoreName, scoreBadge: (v) => scoreBadge(v), explain, contributions, changeOf,
  scoreBox, percentilesBox, academicBox, cmpTable, miniChart, mountChart, mountNews, pctIn, FACT, FACT_TIP, TIPS, pct, spct, big, cls };
/* ---------- comparador y percentiles (Fase 2) ---------- */
// medidas de «Percentiles en su sector» de la ficha: [campo, etiqueta, formato, mejor: 1 = más alto, -1 = más bajo]
const PCT_METRICS = [
  ["per", "PER", (v) => nf(v, 1), -1], ["ev_ebitda", "EV/EBITDA", (v) => nf(v, 1), -1], ["pb", "Precio / valor contable", (v) => nf(v, 2), -1],
  ["div", "Dividendo", (v) => pct(v), 1], ["roe", "ROE", (v) => pct(v), 1], ["margen_op", "Margen operativo", (v) => pct(v), 1],
  ["crec_ventas", "Crecimiento de ventas", spct, 1], ["crec_bpa", "Crecimiento del BPA", spct, 1],
  ["deuda_neta_ebitda", "Deuda neta / EBITDA", (v) => (v == null ? "—" : nf(v, 1) + "×"), -1],
  ["r3m", "Rentabilidad 3 meses", spct, 1], ["r1a", "Rentabilidad 1 año", spct, 1], ["vol3m", "Volatilidad", (v) => pct(v), -1],
];
const PCT_SORTED = new Map();
/* percentil de un dato dentro de su sector (o de todo el universo si el sector tiene menos de 8 valores con dato) */
function pctIn(r, k) {
  const v = r[k]; if (v == null || !E.uni || typeof v !== "number") return null;
  const key = k + "|" + r.sector;
  if (!PCT_SORTED.has(key)) {
    let xs = E.uni.filas.filter((x) => x.sector === r.sector && typeof x[k] === "number").map((x) => x[k]), scope = "sector";
    if (xs.length < 8) { xs = E.uni.filas.filter((x) => typeof x[k] === "number").map((x) => x[k]); scope = "universo"; }
    PCT_SORTED.set(key, { xs: xs.sort((a, b) => a - b), scope });
  }
  const { xs, scope } = PCT_SORTED.get(key);
  if (xs.length < 2) return null;
  let lo = 0, hi = 0; for (const x of xs) { if (x < v) lo++; else if (x === v) hi++; }
  return { p: Math.round((100 * (lo + Math.max(0, hi - 1) / 2)) / (xs.length - 1)), scope, n: xs.length };
}
const pctPill = (q, better) => {
  if (!q) return "";
  const good = better === 0 ? null : better > 0 ? q.p : 100 - q.p;
  return `<span class="pp ${good == null ? "" : good >= 67 ? "pp-g" : good <= 33 ? "pp-b" : ""}" data-tip="Percentil ${q.p} de ${q.n} valores de su ${q.scope}${better ? (better > 0 ? " · más alto es mejor" : " · más bajo es mejor") : ""}">p${q.p}</span>`;
};
/* factores académicos (SEC, solo EE. UU.): valor, percentil en su sector y referencia */
const ACAD = [
  ["f_fs", "F-score de Piotroski", (v) => nf(v, 1) + " / 9", 1, "9 señales contables de solidez (rentabilidad, caja, deuda, liquidez, dilución, margen y rotación). Piotroski (2000)."],
  ["f_gp", "Rentabilidad bruta", (v) => pct(v), 1, "Beneficio bruto entre activos: las empresas más rentables en bruto han rendido más. Novy-Marx (2013)."],
  ["f_ag", "Crecimiento de activos", spct, -1, "Las empresas que más engordan su balance han rendido menos después. Cooper, Gulen y Schill (2008)."],
  ["f_acr", "Devengos", spct, -1, "Beneficio que no llega a caja, sobre activos: mucho devengo anticipa peor rentabilidad. Sloan (1996)."],
  ["f_nsi", "Emisión neta de acciones", spct, -1, "Variación de acciones en un año: emitir suele preceder a peor rentabilidad; recomprar, a mejor. Pontiff y Woodgate (2008)."],
  ["f_sue", "Sorpresa de beneficios (SUE)", (v) => sgn(v, 1) + " σ", 1, "Beneficio del último trimestre frente al mismo del año anterior, en desviaciones típicas: tras sorpresas positivas el precio suele seguir subiendo. Foster, Olsen y Shevlin (1984)."],
];
function academicBox(r) {
  const ks = ACAD.filter(([k]) => typeof r[k] === "number");
  if (!ks.length) return r.sym.includes(".") ? "" : `<div class="box"><b>Factores académicos</b><div class="hint">Sin cuentas de la SEC para este valor todavía.</div></div>`;
  return `<div class="box"><b>Factores académicos · SEC</b> ${H.evid("e")} <span class="hint">cuentas a ${fmtDate(r.f_fecha)}</span>
    <table><tbody>${ks.map(([k, t, fmt, b, tip]) => `<tr><td data-tip="${esc(tip)}">${esc(t)}</td><td class="num">${fmt(r[k])}${pctPill(pctIn(r, k), b)}</td></tr>`).join("")}</tbody></table>
    <div class="method">El Laboratorio mide si cada uno ha predicho la rentabilidad con datos «a fecha»; no están en la nota.</div></div>`;
}
function percentilesBox(r) {
  const ks = PCT_METRICS.filter(([k]) => typeof r[k] === "number");
  if (!ks.length) return "";
  return `<div class="box"><b>Percentiles en su sector</b> <span class="hint">0 = el más bajo, 100 = el más alto · color según si es bueno</span>
    ${ks.map(([k, t, fmt, b]) => { const q = pctIn(r, k); if (!q) return ""; const good = b > 0 ? q.p : 100 - q.p;
      return `<div class="prob" data-tip="${esc(t)}: ${q.scope === "sector" ? "frente a " + q.n + " valores de su sector" : "frente a todo el universo (sector pequeño)"}"><span>${esc(t)} <span class="hint">${fmt(r[k], r)}</span></span><div class="track"><div class="fill" style="width:${q.p}%;background:${good >= 67 ? "var(--good)" : good <= 33 ? "var(--bad)" : "var(--faint)"}"></div></div><span class="num">p${q.p}</span></div>`; }).join("")}
  </div>`;
}
if (H.S.cmp0) { E.cmp = H.S.cmp0; store.set("comparar", E.cmp); }
window.SCRSetCmp = (list) => { E.cmp = list.slice(0, 4); store.set("comparar", E.cmp); H.render(); };
function cmpAdd(sym) {
  if (!sym || E.cmp.includes(sym)) return;
  E.cmp = [...E.cmp, sym].slice(-4); store.set("comparar", E.cmp);
}
/* sección «Comparar» (Empresas): el comparador a pantalla completa, con enlace propio #/comparar/A,B,C */
function renderComparar() {
  if (!E.uni) { ensure(); return stateBox(); }
  window.SCRSmart?.ensure(); enrichSmart();
  const list = E.cmp.filter((s) => E.uni.filas.some((x) => x.sym === s));
  const want = "#/comparar" + (list.length ? "/" + list.join(",") : "");
  if (location.hash !== want && location.hash.startsWith("#/comparar")) history.replaceState(null, "", want);
  let h = `<div class="scr-head"><div class="search-in"><svg viewBox="0 0 24 24"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"/></svg>
      <input id="cmpq" type="search" list="cmp-dl" placeholder="${list.length >= 4 ? "Máximo 4: quita uno para añadir otro" : "Añade un ticker y pulsa Intro"}" autocomplete="off" aria-label="Añadir valor al comparador" ${list.length >= 4 ? "disabled" : ""}></div>
      <datalist id="cmp-dl">${E.uni.filas.map((x) => `<option value="${esc(x.sym)}">${esc(x.nombre || "")}</option>`).join("")}</datalist>
      ${list.length ? `<button class="chip" data-copycmp="1">🔗 Enlace</button><button class="link-btn" data-act="cmpclear">Vaciar</button>` : ""}</div>`;
  if (list.length < 2) return h + `<div class="soon-box"><h3>Comparador</h3>${list.length ? `Tienes ${esc(list[0])}. ` : ""}Añade de 2 a 4 valores con el buscador de arriba, con la casilla ⇄ del screener o con «+ Comparar» en cada ficha. Verás sus datos lado a lado con el percentil de cada uno dentro de su sector.</div>`;
  setTimeout(() => { const el = document.getElementById("pcmp"); if (el && window.SCRChart && !el.dataset.on) { el.dataset.on = "1"; window.SCRChart.compare(el, list); } }, 0);
  return h + `<div class="box cmp-page">${cmpTable(list)}</div><h2 class="sec">Rentabilidad comparada</h2><div id="pcmp" class="fchart"></div>`;
}

H.modules.comparar = renderComparar;
function cmpFromInput(inp) {
  const v = inp.value.trim().toUpperCase(); if (!v || !E.uni) return;
  const r = E.uni.filas.find((x) => x.sym === v) || E.uni.filas.find((x) => (x.nombre || "").toUpperCase().startsWith(v));
  if (!r) { inp.setCustomValidity("No está en el universo"); inp.reportValidity(); return; }
  cmpAdd(r.sym); H.render(); setTimeout(() => document.getElementById("cmpq")?.focus(), 0);
}
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "cmpq") { e.preventDefault(); cmpFromInput(e.target); } });
document.addEventListener("change", (e) => { if (e.target.id === "cmpq" && E.uni?.filas.some((x) => x.sym === e.target.value.trim().toUpperCase())) cmpFromInput(e.target); });
H.modules.sectores = renderSectores;
H.modules.screener = renderScreener;
H.handlers.push(onClick);
setupSearch();
setupTips();
})();
