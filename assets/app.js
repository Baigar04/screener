/* Screener · front estático. Lee data/macro.json (lo genera GitHub Actions cada día laborable). */
(() => {
"use strict";

const NAV = [
  ["pulso", "Pulso del mercado", true],
  ["sectores", "Sectores", true],
  ["screener", "Screener", true],
  ["smart", "Smart money", true],
  ["carteras", "Carteras", true],
  ["adelantarse", "Adelantarse", true],
];
const LEVELS = ["Principiante", "Intermedio", "Avanzado", "Experto inversor"];
const LEVELS_SHORT = ["Principiante", "Intermedio", "Avanzado", "Experto"];
const REGIONS = [["US", "EE. UU."], ["EZ", "Zona euro"], ["GL", "Global"]];
const PERIODS = [["cambio_1m", "1 mes"], ["cambio_3m", "3 meses"], ["cambio_1a", "1 año"]];
const KEY_BASIC = ["fed_upper", "ecb_dfr", "us10y", "t10y3m", "cpi_us", "hicp_ez", "vix", "brent"];
const HIDE_MID = ["us2y", "ez2y", "ez10y", "wti", "ig_oas"];
const UP_BAD = ["vix", "hy_oas", "ig_oas", "unrate", "sahm", "cpi_us", "pce_core", "hicp_ez", "nfci"];
const UP_GOOD = ["indpro"];
const REGIME_TXT = {
  "Expansión": "La economía crece y los indicadores no empeoran. Suele favorecer a la bolsa, sobre todo a los sectores cíclicos.",
  "Desaceleración": "La economía sigue creciendo, pero los indicadores empeoran. Suele premiar la calidad y los sectores defensivos.",
  "Recesión": "Los indicadores de crecimiento son débiles y siguen empeorando. Históricamente es la fase más dura para la bolsa.",
  "Recuperación": "Los indicadores siguen débiles, pero mejoran. Suele ser cuando la bolsa se adelanta a la economía.",
};
const SOON = {
  sectores: ["Heatmap y ranking de sectores e industrias por crecimiento, momentum, moda, volatilidad, rentabilidad y valoración", "Rotación sectorial (cuadrante tipo RRG)"],
  screener: ["Filtros por país, sector, industria, capitalización, múltiplos (también frente a su sector), crecimiento, calidad, deuda, dividendo y técnico", "Ficha de empresa con fundamentales a 5 años, PER frente a sector e industria, técnico y catalizadores"],
  smart: ["Dataroma, 13F, compras de directivos (Form 4) y declaraciones de congresistas", "Fecha de operación y fecha de declaración separadas, con su desfase"],
  carteras: ["Constructor por perfil, horizonte y restricciones", "Equiponderada, riesgo-paridad, mínima varianza y máximo Sharpe; stress test y seguimiento"],
  adelantarse: ["Cuadro de indicadores adelantados con su historial", "Escenarios con probabilidades y registro de señales con su tasa de acierto real"],
};

/* ---------- estado y preferencias ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
};
const S = {
  view: "pulso",
  level: store.get("nivel", 1),
  regions: new Set(store.get("regiones", ["US", "EZ", "GL"])),
  group: store.get("grupo", "Todos"),
  period: store.get("periodo", "cambio_1m"),
  viewRegion: store.get("region_vision", "US"),
  sort: store.get("orden_paises", { k: "pib", d: -1 }),
  data: null, error: null,
};
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d = 2) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }));
const sgn = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d));
const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""))) / 864e5);
const fmtDate = (iso) => { if (!iso) return "—"; const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso); return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }); };
const fmtDateTime = (iso) => new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/* ---------- carga ---------- */
async function load() {
  try {
    const r = await fetch("data/macro.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status === 404 ? "Todavía no hay datos: la primera actualización automática aún no se ha ejecutado." : "HTTP " + r.status);
    S.data = await r.json();
    S.error = null;
  } catch (e) {
    S.data = null;
    S.error = e.message || String(e);
  }
  render();
}

/* ---------- componentes ---------- */
function dropdown(id, label, options, current) {
  const cur = options.find((o) => o[0] === current) || options[0];
  return `<div class="dd" data-dd="${id}"><button class="dd-btn" aria-haspopup="listbox"><span class="lab">${esc(label)}</span> ${esc(cur[1])} ▾</button>
    <div class="dd-menu" role="listbox">${options.map(([v, t]) => `<button role="option" data-v="${esc(v)}" class="${v === cur[0] ? "on" : ""}">${esc(t)}${v === cur[0] ? " ✓" : ""}</button>`).join("")}</div></div>`;
}
function spark(hist, w = 220, h = 38, pad = 2) {
  if (!hist || hist.length < 2) return "";
  const vs = hist.map((p) => p[1]);
  const mn = Math.min(...vs), mx = Math.max(...vs), rg = mx - mn || 1;
  const pts = vs.map((v, i) => `${(pad + (i / (vs.length - 1)) * (w - 2 * pad)).toFixed(1)},${(pad + (1 - (v - mn) / rg) * (h - 2 * pad)).toFixed(1)}`);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
function chart(hist, unit) {
  if (!hist || hist.length < 2) return `<div class="nodata">Sin histórico disponible.</div>`;
  const W = 420, H = 170, L = 6, R = 46, T = 10, B = 22;
  const vs = hist.map((p) => p[1]);
  const mn = Math.min(...vs), mx = Math.max(...vs), rg = mx - mn || 1;
  const x = (i) => L + (i / (hist.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - mn) / rg) * (H - T - B);
  const pts = hist.map((p, i) => `${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const last = hist[hist.length - 1];
  const zero = mn < 0 && mx > 0 ? `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--faint)" stroke-dasharray="3 3"/>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Histórico">
    <line x1="${L}" x2="${W - R}" y1="${y(mx)}" y2="${y(mx)}" stroke="var(--border)"/><line x1="${L}" x2="${W - R}" y1="${y(mn)}" y2="${y(mn)}" stroke="var(--border)"/>${zero}
    <text x="${W - R + 4}" y="${y(mx) + 4}" font-size="10" fill="var(--muted)">${nf(mx)}</text>
    <text x="${W - R + 4}" y="${y(mn) + 4}" font-size="10" fill="var(--muted)">${nf(mn)}</text>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>
    <circle cx="${x(hist.length - 1)}" cy="${y(last[1])}" r="3.5" fill="var(--accent)"/>
    <text x="${L}" y="${H - 6}" font-size="10" fill="var(--muted)">${fmtDate(hist[0][0])}</text>
    <text x="${W - R}" y="${H - 6}" font-size="10" fill="var(--muted)" text-anchor="end">${fmtDate(last[0])}</text></svg>`;
}
function chgClass(id, v) {
  if (v == null || v === 0) return "z";
  if (UP_BAD.includes(id)) return v > 0 ? "n" : "p";
  if (UP_GOOD.includes(id)) return v > 0 ? "p" : "n";
  return "z";
}
function freshness(s) {
  if (!s || s.estado !== "ok") return { cls: "err", txt: "sin datos" };
  const age = daysAgo(s.fecha_dato);
  return age > (s.umbral_frescura_dias || 7) ? { cls: "stale", txt: `dato de hace ${age} días`, age } : { cls: "ok", txt: "al día", age };
}

/* ---------- render ---------- */
const ICONS = {
  pulso: "M3 12h4l3-8 4 16 3-8h4",
  sectores: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  screener: "M3 5h18l-7 8v6l-4 2v-8z",
  smart: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5",
  carteras: "M3 7h18v13H3zM8 7V4h8v3M3 12h18",
  adelantarse: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z",
};
const SHORT = { pulso: "Pulso", sectores: "Sectores", screener: "Screener", smart: "Smart", carteras: "Carteras", adelantarse: "Adelantarse" };
function renderTop() {
  $("#nav").innerHTML = NAV.map(([k, n, ready]) => `<button data-k="${k}" class="${S.view === k ? "on" : ""}${ready ? "" : " is-soon"}" title="${n}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[k]}"/></svg><span class="lbl">${n}</span><span class="lbl-s">${SHORT[k]}</span>${ready ? "" : '<span class="soon">pronto</span>'}</button>`).join("");
  const pt = $("#pageTitle"); if (pt) pt.textContent = NAV.find((x) => x[0] === S.view)[1];
  $("#level").innerHTML = LEVELS.map((l, i) => `<button role="radio" aria-checked="${S.level === i}" data-i="${i}" class="${S.level === i ? "on" : ""}" title="${l}"><span class="l-f">${LEVELS_SHORT[i]}</span><span class="l-s">${["Inicial", "Medio", "Avanz.", "Experto"][i]}</span></button>`).join("");
  const st = $("#status");
  if (!S.data) { st.innerHTML = `<span><span class="dot err"></span> ${esc(S.error || "Cargando…")}</span>`; return; }
  const ser = Object.values(S.data.series);
  const ok = ser.filter((s) => s.estado === "ok").length;
  const h = Math.round((Date.now() - new Date(S.data.generado)) / 36e5);
  st.innerHTML = `<span><span class="dot ${h > 80 ? "stale" : "ok"}"></span> Datos: ${fmtDateTime(S.data.generado)} · hace ${h} h</span>
    <span class="sep">·</span><span>${ok}/${ser.length} series macro al día</span><span class="sep">·</span>
    ${S.data.errores?.length ? `<button id="showErr">${S.data.errores.length} fuente(s) con error</button>` : "<span>Sin errores de fuente</span>"}
    <span class="sep hide-s">·</span><span class="hide-s">Actualización: L-V tras el cierre de EE. UU.</span>`;
}

function renderPulso() {
  const D = S.data;
  if (!D) return `<div class="soon-box"><h3>Sin datos</h3>${esc(S.error)}<br><br>Los datos los genera cada día laborable un proceso automático en GitHub. No se muestran cifras de ejemplo.</div>`;
  const lv = S.level;
  let h = "";

  /* resumen */
  const KPI = ["us10y", "t10y3m", "vix", "hy_oas", "brent", "eurusd"];
  const R0 = D.regimen;
  h += `<div class="kpis">${R0?.estado === "ok" ? `<button class="kpi kpi-reg" data-goreg="1"><span class="k-l">Régimen EE. UU.</span><span class="k-v">${esc(R0.dominante)}</span><span class="k-c">${R0.probabilidades[R0.dominante]} % de probabilidad</span></button>` : ""}
    ${KPI.map((id) => { const s = D.series[id]; if (!s || s.estado !== "ok") return `<div class="kpi"><span class="k-l">${esc(s?.nombre || id)}</span><span class="k-v">—</span></div>`;
      return `<button class="kpi card-lite" data-id="${id}"><span class="k-l">${esc(s.nombre)}</span><span class="k-v num">${nf(s.valor)}<small>${esc(s.unidad)}</small></span><span class="k-c num chg ${chgClass(id, s.cambio_1m)}">${sgn(s.cambio_1m)} en 1 mes</span></button>`; }).join("")}</div>`;

  /* régimen */
  const R = D.regimen;
  h += `<h2 class="sec" id="regimen">Régimen macro · EE. UU. <span class="hint">${lv === 0 ? "En qué fase del ciclo está la economía" : "Probabilidad por fase del ciclo"}</span></h2>`;
  if (R?.estado === "ok") {
    const order = ["Expansión", "Desaceleración", "Recesión", "Recuperación"];
    h += `<div class="panel regime"><div><div class="sub">Fase dominante</div><div class="big">${R.dominante}</div>
      <div class="sub">${REGIME_TXT[R.dominante]}</div>
      ${R.inflacion ? `<div class="sub" style="margin-top:8px">Inflación subyacente (PCE): <b>${R.inflacion}</b></div>` : ""}</div>
      <div>${order.map((k) => `<div class="prob ${k === R.dominante ? "dom" : ""}" title="${esc(REGIME_TXT[k])}"><span>${k}</span><div class="track"><div class="fill" style="width:${R.probabilidades[k]}%"></div></div><span class="num">${R.probabilidades[k]} %</span></div>`).join("")}
      ${lv >= 2 ? `<div class="signals">${Object.entries(R.senales).map(([k, v]) => `<span class="sig ${v > 0 ? "p" : v < 0 ? "n" : "z"}">${esc(k)}: ${v > 0 ? "positiva" : v < 0 ? "negativa" : "neutral"}</span>`).join("")}</div>` : ""}
      ${lv >= 3 ? `<div class="method">Nivel de crecimiento ${sgn(R.nivel_crecimiento)} · cambio en 3 meses ${sgn(R.direccion_3m)}. ${esc(R.metodo)}</div>` : `<div class="method">Modelo heurístico: las probabilidades no están calibradas estadísticamente.</div>`}
      </div></div>`;
  } else {
    h += `<div class="panel nodata">Sin datos: ${esc(R?.motivo || "no calculado")}</div>`;
  }

  /* visiones */
  const V = D.visiones?.[S.viewRegion];
  h += `<h2 class="sec">Visión por horizonte <span class="hint">Lectura basada en reglas a partir de los datos; no es una recomendación</span></h2>
    <div class="bar">${[["US", "EE. UU."], ["EZ", "Zona euro"]].map(([k, n]) => `<button class="chip ${S.viewRegion === k ? "on" : ""}" data-vr="${k}">${n}</button>`).join("")}</div>`;
  if (V) {
    const hz = [["corto", "Corto plazo · 1-3 meses"], ["medio", "Medio plazo · 3-12 meses"], ["largo", "Largo plazo · 1-3 años"]];
    h += `<div class="views">${hz.map(([k, t]) => {
      const v = V[k] || {};
      const mot = lv === 0 ? (v.motivos || []).slice(0, 1) : v.motivos || [];
      return `<div class="view-card"><h3>${t}</h3><span class="badge ${(v.senal || "").replace(" ", "")}">${esc(v.senal || "Sin datos")}</span><span class="conf">confianza ${esc(v.confianza || "—")}</span>
        <ul>${mot.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
        ${lv >= 1 ? `<div class="inval"><b>Qué lo invalidaría:</b> ${esc(v.invalidacion || "—")}</div>` : ""}</div>`;
    }).join("")}</div>`;
  }

  /* indicadores */
  const groups = ["Todos", ...new Set(Object.values(D.series).map((s) => s.grupo))];
  let list = Object.values(D.series).filter((s) => S.regions.has(s.region) && (S.group === "Todos" || s.grupo === S.group));
  if (lv === 0) list = list.filter((s) => KEY_BASIC.includes(s.id));
  else if (lv === 1) list = list.filter((s) => !HIDE_MID.includes(s.id));
  h += `<h2 class="sec">Indicadores clave <span class="hint">Pulsa una tarjeta para ver su histórico, qué es y por qué importa</span></h2>
    <div class="bar">${REGIONS.map(([k, n]) => `<button class="chip ${S.regions.has(k) ? "on" : ""}" data-r="${k}">${n}</button>`).join("")}
    ${dropdown("group", "Grupo:", groups.map((g) => [g, g]), S.group)}
    ${dropdown("period", "Variación:", PERIODS, S.period)}</div>`;
  h += list.length ? `<div class="grid">${list.map(card).join("")}</div>` : `<div class="panel nodata">Ningún indicador con estos filtros.</div>`;

  /* países */
  if (D.paises) h += countriesTable(D.paises, lv);
  return h;
}

function card(s) {
  const f = freshness(s);
  if (s.estado !== "ok") {
    return `<button class="card" data-id="${s.id}"><div class="h"><span>${esc(s.nombre)}</span><span class="dot err"></span></div>
      <div class="nodata">Sin datos — ${esc(s.motivo || "error de fuente")}</div><div class="m"><span>${esc(s.fuente)}</span></div></button>`;
  }
  const c = s[S.period];
  return `<button class="card" data-id="${s.id}" title="${esc(s.def)}"><div class="h"><span>${esc(s.nombre)}</span><span class="dot ${f.cls}" title="${f.txt}"></span></div>
    <div class="v num">${nf(s.valor)} <span class="u">${esc(s.unidad)}</span><span class="chg ${chgClass(s.id, c)}">${sgn(c)}</span></div>
    ${spark(s.hist)}
    <div class="m"><span>${esc(s.fuente)}</span><span class="num ${f.cls === "stale" ? "stale-txt" : ""}">${fmtDate(s.fecha_dato)}</span></div></button>`;
}

function countriesTable(P, lv) {
  const cols = lv === 0
    ? [["pib", "PIB % (último)"], ["inflacion", "Inflación %"]]
    : [["pib", "PIB %"], ["pib_prev", "PIB prev. FMI"], ["inflacion", "Inflación %"], ["inflacion_prev", "Infl. prev. FMI"], ["paro", "Paro %"], ["cuenta_corriente", "Cta. corriente % PIB"], ["deuda", "Deuda pública % PIB"]];
  const rows = Object.entries(P).sort((a, b) => {
    const va = a[1][S.sort.k]?.valor, vb = b[1][S.sort.k]?.valor;
    if (S.sort.k === "nombre") return S.sort.d * a[1].nombre.localeCompare(b[1].nombre, "es");
    return (va == null) - (vb == null) || S.sort.d * ((va ?? 0) - (vb ?? 0));
  });
  return `<h2 class="sec">Economías principales <span class="hint">Banco Mundial (último año disponible) y FMI (previsión del año próximo). Pulsa una columna para ordenar.</span></h2>
    <div class="tbl-wrap"><table><thead><tr><th data-sort="nombre" class="${S.sort.k === "nombre" ? "sorted" : ""}">País</th>
    ${cols.map(([k, t]) => `<th data-sort="${k}" class="${S.sort.k === k ? "sorted" : ""}">${t}${S.sort.k === k ? (S.sort.d < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(([iso, c]) => `<tr data-pais="${iso}"><td>${esc(c.nombre)}</td>${cols.map(([k]) => `<td class="num">${c[k] ? nf(c[k].valor, 1) + `<span class="yr">${c[k].año}</span>` : "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderSoon(k) {
  const n = NAV.find((x) => x[0] === k)[1];
  return `<div class="soon-box"><h3>${n} · próximamente</h3>Este módulo llega en una fase posterior. Incluirá:<ul>${SOON[k].map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
}

function render() {
  renderTop();
  $("#view").innerHTML = S.view === "pulso" ? renderPulso() : MODULES[S.view] ? MODULES[S.view]() : renderSoon(S.view);
  document.title = NAV.find((x) => x[0] === S.view)[1] + " · Screener";
}

/* ---------- panel lateral ---------- */
function openDrawer(html) {
  $("#drawerBody").innerHTML = html;
  $("#drawer").classList.add("on"); $("#drawer").setAttribute("aria-hidden", "false");
  $("#overlay").classList.add("on");
}
function closeDrawer() {
  $("#drawer").classList.remove("on"); $("#drawer").setAttribute("aria-hidden", "true");
  $("#overlay").classList.remove("on");
}
let drawerRange = 5;
function seriesDrawer(id) {
  const s = S.data.series[id];
  const f = freshness(s);
  const regName = Object.fromEntries(REGIONS)[s.region];
  let hist = s.hist || [];
  if (hist.length) {
    const cut = new Date(); cut.setFullYear(cut.getFullYear() - drawerRange);
    const iso = cut.toISOString().slice(0, 10);
    hist = hist.filter((p) => p[0] >= iso);
  }
  openDrawer(`<h3>${esc(s.nombre)}</h3><div class="reg">${esc(regName)} · ${esc(s.grupo)}</div>
    ${s.estado === "ok" ? `<div class="bigv num">${nf(s.valor)} <span class="u" style="font-size:14px;color:var(--muted)">${esc(s.unidad)}</span></div>
      <div class="bar" style="margin:8px 0 0">${[[1, "1 año"], [3, "3 años"], [5, "5 años"]].map(([y, t]) => `<button class="chip ${drawerRange === y ? "on" : ""}" data-range="${y}" data-sid="${id}">${t}</button>`).join("")}</div>
      ${chart(hist, s.unidad)}
      <dl class="kv"><dt>Variación 1 mes</dt><dd class="num chg ${chgClass(id, s.cambio_1m)}">${sgn(s.cambio_1m)}</dd>
      <dt>Variación 3 meses</dt><dd class="num chg ${chgClass(id, s.cambio_3m)}">${sgn(s.cambio_3m)}</dd>
      <dt>Variación 1 año</dt><dd class="num chg ${chgClass(id, s.cambio_1a)}">${sgn(s.cambio_1a)}</dd></dl>`
      : `<div class="box"><b>Sin datos</b>${esc(s.motivo || "error de fuente")}</div>`}
    <div class="box"><b>${S.level === 0 ? "¿Qué es?" : "Definición"}</b>${esc(s.def)}</div>
    <div class="box"><b>Por qué importa</b>${esc(s.por)}</div>
    <dl class="kv"><dt>Fuente</dt><dd>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.fuente)} · ${esc(s.codigo)}</a>` : esc(s.fuente + " · " + s.codigo)}</dd>
    <dt>Fecha del dato</dt><dd class="num">${fmtDate(s.fecha_dato)}</dd>
    <dt>Frescura</dt><dd><span class="dot ${f.cls}"></span> ${esc(f.txt)}</dd>
    <dt>Actualizado</dt><dd class="num">${s.fecha_actualizacion ? fmtDateTime(s.fecha_actualizacion) : "—"}</dd></dl>`);
}
function countryDrawer(iso) {
  const c = S.data.paises[iso];
  const rows = [["pib", "Crecimiento del PIB", "%"], ["pib_prev", "PIB previsto (FMI)", "%"], ["inflacion", "Inflación", "%"], ["inflacion_prev", "Inflación prevista (FMI)", "%"],
    ["paro", "Paro", "%"], ["cuenta_corriente", "Cuenta corriente", "% PIB"], ["deuda", "Deuda pública", "% PIB"]];
  openDrawer(`<h3>${esc(c.nombre)}</h3><div class="reg">Datos anuales</div>
    <dl class="kv">${rows.map(([k, t, u]) => `<dt>${t}</dt><dd class="num">${c[k] ? `${nf(c[k].valor, 1)} ${u} <span class="yr" style="color:var(--faint)">(${c[k].año} · <a href="${esc(c[k].url)}" target="_blank" rel="noopener">${esc(c[k].fuente)}</a>)</span>` : "sin datos"}</dd>`).join("")}</dl>
    <div class="box"><b>Cómo leerlo</b>El dato del Banco Mundial es el último año cerrado; la previsión del FMI corresponde al año próximo. Las cifras anuales cambian pocas veces al año.</div>`);
}
function errorsDrawer() {
  openDrawer(`<h3>Fuentes con error</h3><div class="reg">Última actualización ${fmtDateTime(S.data.generado)}</div>
    ${S.data.errores.map((e) => `<div class="box"><b>${esc(e.fuente)} · ${esc(e.serie)}</b>${esc(e.motivo)}</div>`).join("")}`);
}

/* ---------- eventos ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  const dd = t.closest(".dd");
  document.querySelectorAll(".dd.open").forEach((x) => { if (x !== dd) x.classList.remove("open"); });
  if (t.closest(".dd-btn")) { dd.classList.toggle("open"); return; }
  if (t.closest("a[href='#']")) e.preventDefault();
  for (const fn of HANDLERS) if (fn(t, dd)) return;
  const opt = t.closest(".dd-menu button");
  if (opt) {
    const id = dd.dataset.dd, v = opt.dataset.v;
    if (id === "group") { S.group = v; store.set("grupo", v); }
    if (id === "period") { S.period = v; store.set("periodo", v); }
    render(); return;
  }
  let b;
  if ((b = t.closest("#nav button"))) { S.view = b.dataset.k; render(); window.scrollTo(0, 0); return; }
  if ((b = t.closest("#level button"))) { S.level = +b.dataset.i; store.set("nivel", S.level); render(); return; }
  if ((b = t.closest("[data-r]"))) {
    const r = b.dataset.r;
    if (S.regions.has(r) && S.regions.size > 1) S.regions.delete(r); else S.regions.add(r);
    store.set("regiones", [...S.regions]); render(); return;
  }
  if ((b = t.closest("[data-vr]"))) { S.viewRegion = b.dataset.vr; store.set("region_vision", S.viewRegion); render(); return; }
  if ((b = t.closest("th[data-sort]"))) {
    const k = b.dataset.sort;
    S.sort = S.sort.k === k ? { k, d: -S.sort.d } : { k, d: k === "nombre" ? 1 : -1 };
    store.set("orden_paises", S.sort); render(); return;
  }
  if ((b = t.closest("[data-range]"))) { drawerRange = +b.dataset.range; seriesDrawer(b.dataset.sid); return; }
  if ((b = t.closest(".card, .card-lite"))) { seriesDrawer(b.dataset.id); return; }
  if (t.closest("[data-goreg]")) { document.getElementById("regimen")?.scrollIntoView({ behavior: "smooth" }); return; }
  if ((b = t.closest("tr[data-pais]"))) { countryDrawer(b.dataset.pais); return; }
  if (t.closest("#showErr")) { errorsDrawer(); return; }
  if (t.closest("#drawerClose") || t.id === "overlay") { closeDrawer(); return; }
  if (t.closest("#tsize")) {
    const root = document.documentElement; root.dataset.size = root.dataset.size === "l" ? "" : "l";
    try { localStorage.setItem("tamano", root.dataset.size); } catch (er) { /* */ }
    return;
  }
  if (t.closest("#theme")) {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("tema", root.dataset.theme); } catch (er) { /* */ }
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); document.querySelectorAll(".dd.open").forEach((x) => x.classList.remove("open")); } });

const MODULES = {}, HANDLERS = [];
function go(v) { S.view = v; render(); window.scrollTo(0, 0); }
window.SCR = { S, esc, nf, sgn, fmtDate, store, dropdown, openDrawer, closeDrawer, render, go, seriesDrawer, modules: MODULES, handlers: HANDLERS };
render();
load();
})();
