/* Screener · módulos de Sectores, Screener, ficha de empresa y técnico. Usa los helpers de app.js (window.SCR). */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate, store } = H;

const E = {
  uni: null, sec: null, err: null, loading: false,
  region: store.get("eq_region", "Todos"),
  secMetric: store.get("sec_metric", "r3m"),
  f: store.get("filtros", {}),
  regions: new Set(store.get("scr_regiones", ["EE. UU.", "Europa"])),
  sort: store.get("scr_orden", { k: "mcap", d: -1 }),
  more: store.get("mas_filtros", false), limit: 50, saved: store.get("filtros_guardados", []), tmpl: null,
};

/* ---------- carga perezosa ---------- */
async function ensure() {
  if (E.uni || E.loading) return;
  E.loading = true;
  try {
    const [u, s] = await Promise.all(["universe", "sectors"].map((n) => fetch(`data/${n}.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(r.status === 404 ? "Todavía no hay datos de acciones: la primera actualización automática aún no ha terminado." : "HTTP " + r.status);
      return r.json();
    })));
    E.uni = u; E.sec = s; E.err = null;
  } catch (e) { E.err = e.message; }
  E.loading = false;
  H.render();
}

/* ---------- formato ---------- */
const pct = (v, d = 1) => (v == null ? "—" : nf(v, d) + " %");
const spct = (v, d = 1) => (v == null ? "—" : sgn(v, d) + " %");
function big(v, cur) {
  if (v == null) return "—";
  const a = Math.abs(v), c = cur ? " " + cur : "";
  if (a >= 1e12) return nf(v / 1e12, 2) + " bill." + c;
  if (a >= 1e9) return nf(v / 1e9, 1) + " mil M" + c;
  if (a >= 1e6) return nf(v / 1e6, 0) + " M" + c;
  return nf(v, 0) + c;
}
const cls = (v) => (v == null || v === 0 ? "z" : v > 0 ? "p" : "n");

/* ---------- SECTORES ---------- */
const SEC_COLS = [
  // clave, etiqueta, más alto es mejor (true/false/null), nivel mínimo, formato, definición
  ["n", "Valores", null, 0, (v) => nf(v, 0), "Número de empresas del universo en el sector."],
  ["crec_ventas", "Crec. ventas", true, 1, pct, "Mediana del crecimiento interanual de ventas del último trimestre."],
  ["crec_bpa", "Crec. BPA", true, 1, pct, "Mediana del crecimiento interanual del beneficio por acción del último trimestre."],
  ["r1m", "1 mes", true, 0, spct, "Mediana de la rentabilidad en un mes."],
  ["r3m", "3 meses", true, 0, spct, "Mediana de la rentabilidad en tres meses (momentum)."],
  ["r6m", "6 meses", true, 1, spct, "Mediana de la rentabilidad en seis meses."],
  ["moda", "Aceleración", true, 2, (v) => sgn(v, 1), "«Moda»: momentum reciente frente al de seis meses (3 × rent. 1 mes − rent. 6 meses / 2). Positivo = el sector está entrando en foco."],
  ["vol3m", "Volatilidad", false, 1, pct, "Mediana de la volatilidad anualizada de los últimos 3 meses."],
  ["roe", "ROE", true, 1, pct, "Mediana de la rentabilidad sobre fondos propios."],
  ["margen_op", "Margen op.", true, 2, pct, "Mediana del margen operativo."],
  ["per", "PER", false, 0, (v) => nf(v, 1), "Mediana del PER de los últimos 12 meses (solo empresas con beneficios)."],
  ["per_fwd", "PER previsto", false, 2, (v) => nf(v, 1), "Mediana del PER con el beneficio estimado de los próximos 12 meses."],
  ["pct_sobre_mm200", "% sobre MM200", true, 1, (v) => (v == null ? "—" : v + " %"), "Porcentaje de valores del sector que cotizan por encima de su media de 200 sesiones (amplitud)."],
];
const SEC_NAMES = { "Technology": "Tecnología", "Financial Services": "Servicios financieros", "Healthcare": "Salud", "Consumer Cyclical": "Consumo cíclico",
  "Consumer Defensive": "Consumo defensivo", "Industrials": "Industria", "Energy": "Energía", "Utilities": "Utilities", "Real Estate": "Inmobiliario",
  "Basic Materials": "Materiales básicos", "Communication Services": "Comunicaciones" };
const sn = (s) => SEC_NAMES[s] || s || "—";

function heatColor(rank, n, good) {
  if (good == null || n < 3) return "";
  let t = rank / (n - 1); if (!good) t = 1 - t; // 0 = peor, 1 = mejor
  const c = t >= 0.5 ? "var(--pos)" : "var(--neg)";
  const a = Math.round(Math.abs(t - 0.5) * 2 * 32);
  return a < 4 ? "" : `background:color-mix(in srgb,${c} ${a}%,transparent)`;
}

function renderSectores() {
  if (!E.uni) { ensure(); return box(); }
  const lv = H.S.level;
  const st = E.sec.stats[E.region];
  const cols = SEC_COLS.filter((c) => c[3] <= lv);
  const rows = Object.entries(st.sector).filter(([, d]) => d.n >= 2);
  const m = E.secMetric;
  const asc = SEC_COLS.find((c) => c[0] === m)[2] === false;
  rows.sort((a, b) => { const va = a[1][m], vb = b[1][m]; if (va == null) return 1; if (vb == null) return -1; return asc ? va - vb : vb - va; });
  const ranks = {};
  cols.forEach(([k]) => { const v = rows.map((r) => r[1][k]).filter((x) => x != null).sort((a, b) => a - b); ranks[k] = v; });
  let h = `<h2 class="sec">Radar de sectores <span class="hint">Medianas del universo (${E.uni.n} valores). Verde = mejor dentro de cada columna. Pulsa un sector para ver sus industrias.</span></h2>
    <div class="bar">${["Todos", "EE. UU.", "Europa"].map((r) => `<button class="chip ${E.region === r ? "on" : ""}" data-eqr="${r}">${r}</button>`).join("")}
    ${H.dropdown("secmetric", "Ordenar por:", SEC_COLS.filter((c) => c[2] != null && c[3] <= lv).map((c) => [c[0], c[1]]), m)}</div>`;
  if (lv === 0) {
    const top = rows.slice(0, 3).map((r) => sn(r[0])).join(", "), bot = rows.slice(-3).map((r) => sn(r[0])).join(", ");
    h += `<div class="panel" style="margin-bottom:12px">Según «${esc(SEC_COLS.find((c) => c[0] === m)[1])}», los sectores más fuertes ahora son <b>${esc(top)}</b> y los más débiles, <b>${esc(bot)}</b>. Que un sector suba no garantiza que lo siga haciendo.</div>`;
  }
  h += `<div class="tbl-wrap"><table><thead><tr><th>Sector</th>${cols.map(([k, t, , , , d]) => `<th class="${k === m ? "sorted" : ""}" title="${esc(d)}" data-secsort="${k}">${t}</th>`).join("")}</tr></thead><tbody>
    ${rows.map(([s, d]) => `<tr data-sector="${esc(s)}"><td>${esc(sn(s))}</td>${cols.map(([k, , good, , fmt]) => {
      const rk = ranks[k].indexOf(d[k]);
      return `<td class="num" style="${d[k] == null ? "" : heatColor(rk, ranks[k].length, good)}">${fmt(d[k])}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`;
  if (lv >= 1 && E.sec.rrg && Object.keys(E.sec.rrg).length) h += rrgChart(E.sec.rrg);
  return h;
}

function rrgChart(R) {
  const W = 640, Hh = 420, P = 36;
  const all = Object.values(R).flatMap((r) => r.cola);
  const xs = all.map((p) => p[1]), ys = all.map((p) => p[2]);
  const span = Math.max(1.2, ...xs.map((v) => Math.abs(v - 100)), ...ys.map((v) => Math.abs(v - 100))) * 1.15;
  const X = (v) => P + ((v - (100 - span)) / (2 * span)) * (W - 2 * P);
  const Y = (v) => Hh - P - ((v - (100 - span)) / (2 * span)) * (Hh - 2 * P);
  const q = [["Mejorando", "var(--accent)", P, P], ["Liderando", "var(--pos)", X(100), P], ["Rezagado", "var(--neg)", P, Y(100)], ["Debilitándose", "var(--warn)", X(100), Y(100)]];
  const pal = ["#5aa9ff", "#36c690", "#f2b44c", "#ff6b78", "#b48cff", "#4fd1c5", "#f78fb3", "#a3e635", "#fb923c", "#94a3b8", "#e879f9"];
  let i = 0;
  const series = Object.entries(R).map(([s, r]) => {
    const col = pal[i++ % pal.length];
    const pts = r.cola.map((p) => `${X(p[1]).toFixed(1)},${Y(p[2]).toFixed(1)}`).join(" ");
    const l = r.cola[r.cola.length - 1];
    return `<g data-sector="${esc(s)}" style="cursor:pointer"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" opacity=".8"/>
      ${r.cola.slice(0, -1).map((p) => `<circle cx="${X(p[1])}" cy="${Y(p[2])}" r="2" fill="${col}" opacity=".6"/>`).join("")}
      <circle cx="${X(l[1])}" cy="${Y(l[2])}" r="5" fill="${col}"><title>${esc(sn(s))}: ${r.cuadrante}</title></circle>
      <text x="${X(l[1]) + 7}" y="${Y(l[2]) + 4}" font-size="11" fill="var(--text)">${esc(sn(s))}</text></g>`;
  }).join("");
  return `<h2 class="sec">Rotación sectorial <span class="hint">Fuerza relativa de cada sector frente al universo (eje X) y su impulso (eje Y). Cola = últimas 6 semanas. Aproximación propia al gráfico RRG.</span></h2>
    <div class="panel" style="overflow-x:auto"><svg viewBox="0 0 ${W} ${Hh}" style="width:100%;max-width:760px;min-width:520px;height:auto;display:block;margin:0 auto" role="img" aria-label="Rotación sectorial">
    ${q.map(([t, c, x, y]) => `<rect x="${x}" y="${y}" width="${X(100) - P}" height="${Y(100) - P}" fill="${c}" opacity=".06"/><text x="${x + 8}" y="${y + 16}" font-size="11" fill="${c}" font-weight="600">${t}</text>`).join("")}
    <line x1="${X(100)}" x2="${X(100)}" y1="${P}" y2="${Hh - P}" stroke="var(--border)"/><line x1="${P}" x2="${W - P}" y1="${Y(100)}" y2="${Y(100)}" stroke="var(--border)"/>
    <text x="${W - P}" y="${Hh - 10}" font-size="10" fill="var(--muted)" text-anchor="end">Fuerza relativa →</text>
    <text x="${P}" y="${P - 10}" font-size="10" fill="var(--muted)">↑ Impulso</text>${series}</svg>
    <div class="method">Lectura habitual: los sectores giran en el sentido de las agujas del reloj (Mejorando → Liderando → Debilitándose → Rezagado). Es una tendencia, no una regla.</div></div>`;
}

function sectorDrawer(s) {
  const st = E.sec.stats[E.region];
  const inds = Object.entries(st.industria).filter(([, d]) => d.sector === s).sort((a, b) => (b[1].r3m ?? -1e9) - (a[1].r3m ?? -1e9));
  const tops = rowsRegion().filter((r) => r.sector === s && r.r3m != null).sort((a, b) => b.r3m - a.r3m);
  const d = st.sector[s] || {};
  const rr = E.sec.rrg?.[s];
  H.openDrawer(`<h3>${esc(sn(s))}</h3><div class="reg">${esc(E.region)} · ${d.n} valores${rr ? ` · Rotación: <b>${rr.cuadrante}</b>` : ""}</div>
    <dl class="kv"><dt>PER mediano</dt><dd class="num">${nf(d.per, 1)} <span style="color:var(--faint)">(mercado ${nf(st.mercado.per, 1)})</span></dd>
    <dt>Crecimiento ventas</dt><dd class="num">${pct(d.crec_ventas)}</dd><dt>ROE</dt><dd class="num">${pct(d.roe)}</dd>
    <dt>Rentabilidad 3 meses</dt><dd class="num">${spct(d.r3m)}</dd><dt>% sobre MM200</dt><dd class="num">${d.pct_sobre_mm200 ?? "—"} %</dd></dl>
    <div class="box"><b>Industrias (ordenadas por rentabilidad a 3 meses)</b>
    <table style="font-size:12px"><thead><tr><th>Industria</th><th>N</th><th>3 m</th><th>PER</th></tr></thead><tbody>
    ${inds.map(([n, x]) => `<tr><td style="white-space:normal">${esc(n)}</td><td class="num">${x.n}</td><td class="num">${spct(x.r3m)}</td><td class="num">${nf(x.per, 1)}</td></tr>`).join("")}</tbody></table></div>
    <div class="box"><b>Más fuertes a 3 meses</b>${tops.slice(0, 5).map((r) => `<div><a href="#" data-sym="${esc(r.sym)}">${esc(r.nombre || r.sym)}</a> <span class="num chg p">${spct(r.r3m)}</span></div>`).join("")}</div>
    <button class="chip on" data-gosector="${esc(s)}" style="margin-top:12px">Ver el sector en el screener →</button>`);
}

/* ---------- SCREENER ---------- */
const opt = (...a) => a;
const FILTERS = [
  // id, etiqueta, nivel, opciones [valor, texto], test(fila, valor)
  ["indice", "Índice", 1, null, (r, v) => (r.indices || []).includes(v)],
  ["pais", "País", 1, null, (r, v) => r.pais === v],
  ["sector", "Sector", 0, null, (r, v) => r.sector === v],
  ["industria", "Industria", 2, null, (r, v) => r.industria === v],
  ["mcap", "Capitalización", 1, opt(["200", "Mega (> 200 mil M)"], ["10", "Grande (> 10 mil M)"], ["2-10", "Mediana (2-10 mil M)"], ["<2", "Pequeña (< 2 mil M)"]),
    (r, v) => { const m = (r.mcap || 0) / 1e9; return v === "200" ? m > 200 : v === "10" ? m > 10 : v === "2-10" ? m >= 2 && m <= 10 : m < 2; }],
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
  ["resultados", "Resultados", 1, opt(["30", "En los próximos 30 días"], ["7", "En los próximos 7 días"]),
    (r, v) => { if (!r.resultados) return false; const d = (new Date(r.resultados) - Date.now()) / 864e5; return d >= -1 && d <= +v; }],
];
const TEMPLATES = {
  "Valor": { per: "<15", per_vs_sector: "-15", deuda: "<3" },
  "Calidad": { roe: ">15", margen_op: ">20", deuda: "<2" },
  "Crecimiento": { crec_ventas: ">10", crec_bpa: ">15" },
  "Dividendo": { div: ">3", deuda: "<3" },
  "Momentum": { r3m: ">10", mm200: "sobre", veredicto: "Alcista" },
  "Rebote técnico": { rsi: "<30", per_vs_sector: "0" },
};
const TEMPLATE_TXT = {
  "Valor": "Empresas baratas frente a su sector y sin exceso de deuda.", "Calidad": "Alta rentabilidad, márgenes amplios y balance sano.",
  "Crecimiento": "Ventas y beneficios creciendo con fuerza.", "Dividendo": "Dividendo superior al 3 % con deuda controlada.",
  "Momentum": "Tendencia alcista confirmada por precio, medias y MACD.", "Rebote técnico": "Valores en sobreventa que cotizan por debajo de la valoración de su sector.",
};
const COLS = [
  // clave, etiqueta, nivel, formato, definición
  ["nombre", "Empresa", 0, null, ""],
  ["sector", "Sector", 1, (v) => sn(v), ""],
  ["mcap", "Capitalización", 1, (v, r) => big(v, r.moneda), "Valor en bolsa."],
  ["precio", "Precio", 0, (v) => nf(v, 2), "Último cierre."],
  ["r1d", "Día", 2, (v) => spct(v), "Variación en la última sesión."],
  ["r3m", "3 meses", 0, (v) => spct(v), "Rentabilidad a 3 meses."],
  ["r1a", "1 año", 1, (v) => spct(v), "Rentabilidad a 12 meses."],
  ["per", "PER", 0, (v) => nf(v, 1), "Precio / beneficio de los últimos 12 meses."],
  ["per_vs_sector", "PER vs sector", 1, (v) => spct(v, 0), "Prima o descuento del PER frente a la mediana de su sector."],
  ["ev_ebitda", "EV/EBITDA", 2, (v) => nf(v, 1), "Valor de empresa / EBITDA."],
  ["div", "Dividendo", 0, (v) => pct(v), "Rentabilidad por dividendo de los últimos 12 meses."],
  ["roe", "ROE", 1, (v) => pct(v), "Rentabilidad sobre fondos propios."],
  ["crec_ventas", "Crec. ventas", 1, (v) => spct(v), "Crecimiento interanual de ventas (último trimestre)."],
  ["deuda_neta_ebitda", "DN/EBITDA", 2, (v) => (v == null ? "—" : nf(v, 1) + "×"), "Deuda neta / EBITDA."],
  ["rsi", "RSI", 2, (v) => nf(v, 0), "Índice de fuerza relativa (14 sesiones)."],
  ["veredicto", "Técnico", 0, (v) => (v ? `<span class="badge ${v === "Alcista" ? "Favorable" : v === "Bajista" ? "Defensivo" : "Neutral"}">${v}</span>` : "—"), "Veredicto técnico a 1-3 meses."],
  ["resultados", "Resultados", 1, (v) => (v ? fmtDate(v) : "—"), "Próxima fecha de resultados."],
];

function rowsRegion() { return E.uni.filas.filter((r) => E.regions.has(r.region)); }
function filtered() {
  let rows = rowsRegion();
  for (const [id, v] of Object.entries(E.f)) {
    const def = FILTERS.find((x) => x[0] === id);
    if (def && v) rows = rows.filter((r) => def[4](r, v));
  }
  const { k, d } = E.sort;
  rows.sort((a, b) => {
    const va = a[k], vb = b[k];
    if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
    return typeof va === "string" ? d * va.localeCompare(vb, "es") : d * (va - vb);
  });
  return rows;
}
function filterOptions(id, rows) {
  const def = FILTERS.find((x) => x[0] === id);
  if (def[3]) return def[3];
  const key = id === "indice" ? null : id;
  const vals = new Map();
  rows.forEach((r) => {
    const vs = id === "indice" ? r.indices || [] : [r[key]];
    vs.forEach((v) => v && vals.set(v, (vals.get(v) || 0) + 1));
  });
  return [...vals.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => [v, `${id === "sector" ? sn(v) : v} (${n})`]);
}

function renderScreener() {
  if (!E.uni) { ensure(); return box(); }
  const lv = H.S.level;
  const base = rowsRegion();
  const rows = filtered();
  const fdefs = FILTERS.filter((f) => f[2] <= lv);
  const cols = COLS.filter((c) => c[2] <= lv);
  let h = `<h2 class="sec">Screener <span class="hint">${E.uni.n} valores del S&amp;P 500, Nasdaq-100, Euro Stoxx 50 e IBEX 35. Pulsa una fila para abrir la ficha.</span></h2>
    <div class="bar"><span class="hint" style="margin-right:4px">Plantillas:</span>${Object.keys(TEMPLATES).map((t) => `<button class="chip ${E.tmpl === t ? "on" : ""}" data-tmpl="${t}" title="${esc(TEMPLATE_TXT[t])}">${t}</button>`).join("")}</div>
    ${E.tmpl && lv === 0 ? `<div class="panel" style="margin-bottom:10px;font-size:13px">${esc(TEMPLATE_TXT[E.tmpl])}</div>` : ""}
    <div class="bar">${["EE. UU.", "Europa"].map((r) => `<button class="chip ${E.regions.has(r) ? "on" : ""}" data-scr="${r}">${r}</button>`).join("")}
    ${fdefs.filter((f) => f[2] <= 1 || E.more || E.f[f[0]]).map(([id, lab]) => {
      const o = [["", "Cualquiera"], ...filterOptions(id, base)];
      return H.dropdown("f_" + id, lab + ":", o, E.f[id] || "");
    }).join("")}
    ${fdefs.some((f) => f[2] > 1) ? `<button class="chip" data-act="morefilters">${E.more ? "Menos filtros" : `Más filtros (${fdefs.filter((f) => f[2] > 1).length})`}</button>` : ""}</div>
    <div class="bar"><b class="num">${rows.length}</b>&nbsp;<span class="hint">valores cumplen los filtros</span>
    <span style="flex:1"></span>
    ${Object.values(E.f).some(Boolean) ? `<button class="icon-btn" data-act="clear">Limpiar filtros</button><button class="icon-btn" data-act="save">Guardar filtro</button>` : ""}
    ${E.saved.length ? H.dropdown("saved", "Mis filtros:", [["", "Elegir…"], ...E.saved.map((s, i) => [String(i), s.n])], "") : ""}
    <button class="icon-btn" data-act="csv">Exportar CSV</button></div>
    <div class="tbl-wrap"><table><thead><tr>${cols.map(([k, t, , , d]) => `<th data-scrsort="${k}" title="${esc(d)}" class="${E.sort.k === k ? "sorted" : ""}">${t}${E.sort.k === k ? (E.sort.d < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(0, E.limit).map((r) => `<tr data-sym="${esc(r.sym)}">${cols.map(([k, , , fmt]) => k === "nombre"
      ? `<td><b>${esc(r.sym)}</b> <span style="color:var(--muted)">${esc((r.nombre || "").slice(0, 28))}</span></td>`
      : `<td class="num ${["r1d", "r3m", "r1a"].includes(k) ? "chg " + cls(r[k]) : ""}">${fmt(r[k], r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    ${rows.length > E.limit ? `<div style="text-align:center;margin-top:10px"><button class="icon-btn" data-act="more">Mostrar 50 más (${rows.length - E.limit} restantes)</button></div>` : ""}
    <div class="method">Precios y fundamentales de Yahoo Finance; fundamentales refrescados por rotación semanal. Las revisiones de beneficios de los analistas no se incluyen: no hay fuente pública fiable.</div>`;
  return h;
}

function exportCsv() {
  const rows = filtered();
  const keys = ["sym", "nombre", "region", "pais", "sector", "industria", "mcap", "precio", "r1m", "r3m", "r1a", "per", "per_fwd", "per_vs_sector", "ev_ebitda", "pb", "div", "roe", "margen_op", "crec_ventas", "crec_bpa", "deuda_neta_ebitda", "vol3m", "rsi", "veredicto", "resultados"];
  const q = (v) => (v == null ? "" : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [keys.join(";"), ...rows.map((r) => keys.map((k) => q(r[k])).join(";"))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `screener_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

/* ---------- FICHA DE EMPRESA ---------- */
async function companyDrawer(sym) {
  const r = E.uni.filas.find((x) => x.sym === sym);
  if (!r) return;
  H.openDrawer(`<h3>${esc(r.nombre || sym)}</h3><div class="reg">Cargando ficha…</div>`);
  let d = {};
  try { d = await fetch(`data/t/${encodeURIComponent(sym)}.json`).then((x) => (x.ok ? x.json() : {})); } catch (e) { /* sin detalle */ }
  const lv = H.S.level;
  const vs = (lab, v, ms, mi, f) => `<tr><td>${lab}</td><td class="num">${nf(v, 1)}</td><td class="num">${nf(ms, 1)}</td><td class="num">${nf(mi, 1)}</td><td class="num chg ${cls(f == null ? null : -f)}">${spct(f, 0)}</td></tr>`;
  const st = E.sec.stats.Todos;
  const sS = st.sector[r.sector] || {}, sI = st.industria[r.industria] || {};
  const years = Object.keys(d.anual || {});
  const fl = [["ventas", "Ventas"], ["ebitda", "EBITDA"], ["beneficio_neto", "Beneficio neto"], ["bpa", "BPA"], ["fcf", "Flujo de caja libre"], ["deuda_total", "Deuda total"], ["patrimonio", "Patrimonio neto"]];
  const tv = r.veredicto;
  const up = r.precio_objetivo && r.precio ? (r.precio_objetivo / r.precio - 1) * 100 : null;
  H.openDrawer(`<h3>${esc(r.nombre || sym)}</h3>
    <div class="reg">${esc(sym)} · ${esc(sn(r.sector))} · ${esc(r.industria || "—")} · ${esc(r.pais || "—")}</div>
    <div class="bigv num">${nf(r.precio, 2)} <span style="font-size:14px;color:var(--muted)">${esc(r.moneda || "")}</span> <span class="chg ${cls(r.r1d)}" style="font-size:15px">${spct(r.r1d, 2)}</span></div>
    <div class="reg">Cierre ${fmtDate(r.fecha_precio)} · Capitalización ${big(r.mcap, r.moneda)}</div>
    ${priceChart(d.diario)}
    <div class="box"><b>Análisis técnico · horizonte ${esc(r.horizonte_tec || "1-3 meses")}</b>
      <span class="badge ${tv === "Alcista" ? "Favorable" : tv === "Bajista" ? "Defensivo" : "Neutral"}">${esc(tv || "Sin datos")}</span>
      <div style="margin-top:6px">${esc(r.motivo_tec || "")}.</div>
      ${r.invalidacion ? `<div style="margin-top:4px">Se invalida si cierra ${tv === "Alcista" ? "por debajo" : "por encima"} de <b class="num">${nf(r.invalidacion, 2)}</b>.</div>` : ""}
      ${lv >= 1 ? `<dl class="kv"><dt>MM50 / MM200</dt><dd class="num">${nf(r.sma50, 2)} / ${nf(r.sma200, 2)}</dd><dt>RSI (14)</dt><dd class="num">${nf(r.rsi, 0)}</dd>
      <dt>MACD (histograma)</dt><dd class="num">${sgn(r.macd_hist, 3)}</dd><dt>Soporte / resistencia (60 s.)</dt><dd class="num">${nf(r.soporte, 2)} / ${nf(r.resistencia, 2)}</dd>
      <dt>ATR (14)</dt><dd class="num">${pct(r.atr_pct, 2)} del precio</dd><dt>Volumen relativo</dt><dd class="num">${nf(r.vol_rel, 2)}× (5 vs 60 sesiones)</dd></dl>` : ""}</div>
    <div class="box"><b>Valoración frente a su sector e industria</b>
      <table style="font-size:12px"><thead><tr><th></th><th>Empresa</th><th>Sector</th><th>Industria</th><th>Dif. vs sector</th></tr></thead><tbody>
      ${vs("PER", r.per, sS.per, sI.per, r.per_vs_sector)}${vs("EV/EBITDA", r.ev_ebitda, sS.ev_ebitda, sI.ev_ebitda, r.ev_ebitda_vs_sector)}${vs("P/VC", r.pb, sS.pb, sI.pb, r.pb_vs_sector)}
      </tbody></table><div class="method">Medianas de su sector (${sS.n || "—"} valores) y de su industria (${sI.n || "—"}). Verde = cotiza con descuento.</div></div>
    <dl class="kv"><dt>PER previsto</dt><dd class="num">${nf(r.per_fwd, 1)}</dd><dt>Dividendo</dt><dd class="num">${pct(r.div)}${r.payout != null ? ` · pay-out ${pct(r.payout, 0)}` : ""}</dd>
      <dt>ROE / margen op.</dt><dd class="num">${pct(r.roe)} / ${pct(r.margen_op)}</dd><dt>Crec. ventas / BPA</dt><dd class="num">${spct(r.crec_ventas)} / ${spct(r.crec_bpa)}</dd>
      <dt>Deuda neta/EBITDA</dt><dd class="num">${r.deuda_neta_ebitda == null ? "—" : nf(r.deuda_neta_ebitda, 1) + "×"}</dd><dt>Beta</dt><dd class="num">${nf(r.beta, 2)}</dd>
      <dt>Próximos resultados</dt><dd class="num">${r.resultados ? fmtDate(r.resultados) : "—"}</dd>
      ${lv >= 2 ? `<dt>Precio objetivo medio</dt><dd class="num">${nf(r.precio_objetivo, 2)} ${up != null ? `(${spct(up)}, ${r.n_analistas || "?"} analistas)` : ""}</dd>` : ""}</dl>
    ${years.length && lv >= 1 ? `<div class="box"><b>Fundamentales anuales (${esc(r.moneda || "")})</b><div style="overflow-x:auto"><table style="font-size:12px"><thead><tr><th></th>${years.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>
      ${fl.map(([k, t]) => `<tr><td>${t}</td>${years.map((y) => `<td class="num">${k === "bpa" ? nf(d.anual[y][k], 2) : big(d.anual[y][k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>` : ""}
    <div class="box"><b>Smart money y opciones</b>Llegan en la fase 3 (fondos, directivos, congresistas y volatilidad implícita).</div>
    <dl class="kv"><dt>Fuente</dt><dd><a href="https://finance.yahoo.com/quote/${encodeURIComponent(sym)}" target="_blank" rel="noopener">Yahoo Finance · ${esc(sym)}</a></dd>
    <dt>Fundamentales a</dt><dd class="num">${fmtDate(r.fecha_fund)}</dd><dt>Índices</dt><dd>${esc((r.indices || []).join(", "))}</dd></dl>`);
}

function priceChart(rows) {
  if (!rows || rows.length < 10) return `<div class="nodata">Sin histórico de precios.</div>`;
  const W = 420, Hh = 180, L = 4, R = 48, T = 8, B = 20;
  const vals = rows.flatMap((r) => [r[1], r[2], r[3]]).filter((v) => v != null);
  const mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const x = (i) => L + (i / (rows.length - 1)) * (W - L - R), y = (v) => T + (1 - (v - mn) / rg) * (Hh - T - B);
  const line = (idx, col, w, dash = "") => {
    const p = rows.map((r, i) => (r[idx] == null ? null : `${x(i).toFixed(1)},${y(r[idx]).toFixed(1)}`)).filter(Boolean).join(" ");
    return p ? `<polyline points="${p}" fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>` : "";
  };
  return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Precio un año con medias">
    <text x="${W - R + 4}" y="${y(mx) + 4}" font-size="10" fill="var(--muted)">${nf(mx, 2)}</text><text x="${W - R + 4}" y="${y(mn) + 4}" font-size="10" fill="var(--muted)">${nf(mn, 2)}</text>
    ${line(3, "var(--warn)", 1.2, "4 3")}${line(2, "var(--faint)", 1.2)}${line(1, "var(--accent)", 1.8)}
    <text x="${L}" y="${Hh - 5}" font-size="10" fill="var(--muted)">${fmtDate(rows[0][0])}</text><text x="${W - R}" y="${Hh - 5}" font-size="10" fill="var(--muted)" text-anchor="end">${fmtDate(rows[rows.length - 1][0])}</text></svg>
    <div class="method" style="margin-top:-6px"><span style="color:var(--accent)">━</span> Precio · <span style="color:var(--faint)">━</span> MM50 · <span style="color:var(--warn)">┅</span> MM200</div>`;
}

function box() {
  return E.err ? `<div class="soon-box"><h3>Sin datos</h3>${esc(E.err)}</div>` : `<div class="soon-box">Cargando datos de acciones…</div>`;
}

/* ---------- eventos ---------- */
function onClick(t, dd) {
  let b;
  const opt = t.closest(".dd-menu button");
  if (opt && dd) {
    const id = dd.dataset.dd, v = opt.dataset.v;
    if (id === "secmetric") { E.secMetric = v; store.set("sec_metric", v); }
    else if (id.startsWith("f_")) { E.f[id.slice(2)] = v; E.tmpl = null; E.limit = 50; store.set("filtros", E.f); }
    else if (id === "saved" && v !== "") { E.f = { ...E.saved[+v].f }; E.tmpl = null; store.set("filtros", E.f); }
    else return false;
    H.render(); return true;
  }
  if ((b = t.closest("[data-eqr]"))) { E.region = b.dataset.eqr; store.set("eq_region", E.region); H.render(); return true; }
  if ((b = t.closest("[data-secsort]"))) { const k = b.dataset.secsort; if (SEC_COLS.find((c) => c[0] === k)[2] != null) { E.secMetric = k; store.set("sec_metric", k); H.render(); } return true; }
  if ((b = t.closest("[data-sector]"))) { sectorDrawer(b.dataset.sector); return true; }
  if ((b = t.closest("[data-gosector]"))) { E.f = { sector: b.dataset.gosector }; E.tmpl = null; H.closeDrawer(); H.go("screener"); return true; }
  if ((b = t.closest("[data-tmpl]"))) {
    const n = b.dataset.tmpl;
    if (E.tmpl === n) { E.tmpl = null; E.f = {}; } else { E.tmpl = n; E.f = { ...TEMPLATES[n] }; }
    E.limit = 50; store.set("filtros", E.f); H.render(); return true;
  }
  if ((b = t.closest("[data-scr]"))) {
    const r = b.dataset.scr;
    if (E.regions.has(r) && E.regions.size > 1) E.regions.delete(r); else E.regions.add(r);
    store.set("scr_regiones", [...E.regions]); H.render(); return true;
  }
  if ((b = t.closest("[data-scrsort]"))) {
    const k = b.dataset.scrsort;
    E.sort = E.sort.k === k ? { k, d: -E.sort.d } : { k, d: ["nombre", "sector"].includes(k) ? 1 : -1 };
    store.set("scr_orden", E.sort); H.render(); return true;
  }
  if ((b = t.closest("[data-act]"))) {
    const a = b.dataset.act;
    if (a === "clear") { E.f = {}; E.tmpl = null; store.set("filtros", E.f); }
    if (a === "more") E.limit += 50;
    if (a === "morefilters") { E.more = !E.more; store.set("mas_filtros", E.more); }
    if (a === "csv") { exportCsv(); return true; }
    if (a === "save") {
      const parts = Object.entries(E.f).filter(([, v]) => v).map(([k, v]) => `${FILTERS.find((f) => f[0] === k)[1]} ${k === "sector" ? sn(v) : v}`);
      E.saved.push({ n: (E.tmpl ? E.tmpl + ": " : "") + parts.join(" · ").slice(0, 60), f: { ...E.f } });
      E.saved = E.saved.slice(-15); store.set("filtros_guardados", E.saved);
    }
    H.render(); return true;
  }
  if ((b = t.closest("[data-sym]"))) { companyDrawer(b.dataset.sym); return true; }
  return false;
}

H.modules.sectores = renderSectores;
H.modules.screener = renderScreener;
H.handlers.push(onClick);
})();
