/* Screener · Ficha de empresa 2.0 (Fase 6): página propia #/empresa/SYM/<apartado> con 9 apartados en la barra lateral.
   Cada cifra lleva su fuente y su fecha. Datos: data/universe.json (fila), data/t/SYM.json (cuentas: SEC en EE. UU., Yahoo en Europa). */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate } = H;
const K = () => window.SCRKit;
const DET = {};                 // data/t/SYM.json ya leídos
const today = () => new Date().toISOString().slice(0, 10);
const daysTo = (d) => (d ? Math.round((new Date(d + "T00:00:00Z") - new Date(today() + "T00:00:00Z")) / 864e5) : null);

/* ---------- datos ---------- */
function row(sym) { return K()?.E.uni?.filas.find((x) => x.sym === sym) || null; }
function detail(sym) {
  if (DET[sym] && DET[sym] !== "…") return DET[sym];
  if (!DET[sym]) {
    DET[sym] = "…";
    fetch(`data/t/${encodeURIComponent(sym)}.json`).then((x) => (x.ok ? x.json() : {})).catch(() => ({}))
      .then((d) => { DET[sym] = d || {}; if (H.S.ficha?.sym === sym) H.render(); });
  }
  return null;
}
/* trimestres SEC: [fin, presentado, ventas, bn, ebit, bruto, activos, patrimonio, bpa, periodo, forma, cfo_acumulado] */
const Q = { fin: 0, pres: 1, v: 2, bn: 3, ebit: 4, bruto: 5, act: 6, pat: 7, bpa: 8, per: 9, forma: 10, cfo: 11 };
/* ejercicios SEC: [fin, presentado, ventas, bn, ebit, patrimonio, deuda, cfo, capex, acciones, activos, bruto, ac, pc] */
const FY = { fin: 0, pres: 1, v: 2, bn: 3, ebit: 4, pat: 5, deuda: 6, cfo: 7, capex: 8, acc: 9, act: 10, bruto: 11 };
function qLabel(q, short) {
  const p = q[Q.per], m = /^(FY|CY)(\d{4})Q([1-4])$/.exec(p || "");
  if (m) return short ? `T${m[3]} ${m[2].slice(2)}` : `T${m[3]} ${m[1] === "FY" ? "FY" : ""}${m[2]}`;
  const y = +q[Q.fin].slice(0, 4), t = Math.floor((+q[Q.fin].slice(5, 7) - 1) / 3) + 1;
  return short ? `T${t} ${String(y).slice(2)}` : `T${t} ${y}`;
}
const dd = (a, b) => (new Date(b) - new Date(a)) / 864e5;
function yearAgo(rows, i) {   // el mismo trimestre del año anterior (cierre 350-380 días antes)
  for (let j = i - 1; j >= 0; j--) { const g = dd(rows[j][0], rows[i][0]); if (g >= 350 && g <= 380) return j; if (g > 380) break; }
  return -1;
}
const chg = (a, b) => (a == null || b == null || !(b > 0) ? null : (a / b - 1) * 100);
const chgAbs = (a, b) => (a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
/* flujo de caja operativo de cada trimestre a partir del acumulado del ejercicio */
function cfoQ(rows) {
  return rows.map((q, i) => {
    const m = /Q([1-4])$/.exec(q[Q.per] || ""); if (q[Q.cfo] == null || !m) return null;
    if (m[1] === "1") return q[Q.cfo];
    const p = rows[i - 1]; if (!p || p[Q.cfo] == null || !p[Q.per] || p[Q.per].slice(0, -1) !== q[Q.per].slice(0, -1)) return null;
    return q[Q.cfo] - p[Q.cfo];
  });
}
function nextLabel(q) {
  const m = /^(FY|CY)(\d{4})Q([1-4])$/.exec(q?.[Q.per] || ""); if (!m) return "";
  const t = +m[3] === 4 ? 1 : +m[3] + 1, y = +m[3] === 4 ? +m[2] + 1 : +m[2];
  return `T${t} ${m[1] === "FY" ? "FY" : ""}${y}`;
}
function ctx(sym) {
  const r = row(sym), d = detail(sym); if (!r) return null;
  const sec = d?.sec, q = (sec?.q || []).filter((x) => x[Q.v] != null || x[Q.bn] != null), fy = sec?.fy || [];
  return { r, d, sec, q, fy, us: !!(sec && q.length), cur: r.moneda_fin || r.moneda || "" };
}

/* ---------- formato ---------- */
const fmtM = (v, cur) => {   // importes de cuentas: millones con separador
  if (v == null) return "—";
  const a = Math.abs(v), c = cur === "USD" ? " $" : cur === "EUR" ? " €" : cur ? " " + cur : "";
  if (a >= 1e9) return nf(v / 1e6, 0) + " M" + c;
  if (a >= 1e6) return nf(v / 1e6, 1) + " M" + c;
  return nf(v, 0) + c;
};
const pill = (v, d = 1, inv) => (v == null ? "" : `<span class="pl ${(inv ? -v : v) > 0 ? "pl-p" : (inv ? -v : v) < 0 ? "pl-n" : ""}">${sgn(v, d)} %</span>`);
const dot = (k) => `<i class="dt dt-${k}" aria-hidden="true"></i>`;
const ago = (d) => { const n = d ? -daysTo(d) : null; return n == null ? "" : n === 0 ? "hoy" : n === 1 ? "ayer" : `hace ${n} días`; };
const ticker = (r) => {
  const b = r.bolsa || "", base = r.sym.replace(/\.[A-Z]+$/, "");
  const ex = /nasdaq/i.test(b) ? "NASDAQ" : /^nyse/i.test(b) ? "NYSE" : b === "MCE" || r.sym.endsWith(".MC") ? "BME" : /xetra|\.DE$/i.test(b + r.sym) ? "XETRA" : b;
  return ex ? `${ex}: ${base}` : r.sym;
};
const box = (title, body, right = "", cls = "") => `<section class="fbox ${cls}"><header><h2>${title}</h2>${right ? `<span class="fbox-r">${right}</span>` : ""}</header>${body}</section>`;

/* ---------- cabecera ---------- */
const PAIS = { "United States": "EE. UU.", Spain: "España", Germany: "Alemania", France: "Francia", Netherlands: "Países Bajos", Italy: "Italia", "United Kingdom": "Reino Unido",
  Switzerland: "Suiza", Belgium: "Bélgica", Sweden: "Suecia", Denmark: "Dinamarca", Finland: "Finlandia", Norway: "Noruega", Ireland: "Irlanda", Portugal: "Portugal", Austria: "Austria",
  Luxembourg: "Luxemburgo", Canada: "Canadá", Taiwan: "Taiwán", China: "China", Japan: "Japón", Israel: "Israel", Bermuda: "Bermudas", "Cayman Islands": "Islas Caimán", Thailand: "Tailandia" };
const IC = {
  star: "M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.6-4.1 6.1-.6z", cmp: "M7 7h13M17 4l3 3-3 3M17 17H4M7 14l-3 3 3 3",
  pen: "M4 20h4L19 9l-4-4L4 16z", link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" };
const ico = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${IC[k]}"/></svg>`;
function sparkSvg(d) {
  const pts = (d?.diario || []).map((x) => x[1]).filter((v) => v != null).slice(-252);
  if (pts.length < 20) return "";
  const W = 150, Hh = 40, mn = Math.min(...pts), mx = Math.max(...pts), y = (v) => 4 + (1 - (v - mn) / (mx - mn || 1)) * (Hh - 12);
  const p = pts.map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return `<svg class="fh-sp" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" aria-label="Precio 12 meses"><polyline fill="none" stroke="var(--good)" stroke-width="1.3" points="${p}"/><text x="${W}" y="${Hh}" text-anchor="end">12 m</text></svg>`;
}
function head(c) {
  const { r, d } = c, k = K();
  const desc = d?.desc ? d.desc.split(/(?<=\.)\s/)[0] : "";
  const fy = c.us && c.q.length ? (() => { const m = c.fy[c.fy.length - 1]?.[0]; return m && m.slice(5, 7) !== "12" ? `ejercicio fiscal hasta ${["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][+m.slice(5, 7)]}` : ""; })() : "";
  const meta = [desc && desc.length < 200 ? desc : "", k.sn(r.sector), PAIS[r.pais] || r.pais, fy].filter(Boolean).join(" · ");
  const tv = r.veredicto, w = k.isW(r.sym), cm = k.isC(r.sym), R = reading(c);
  const tk = ticker(r).split(": ");
  return `<div class="fp-head fh">
    <div class="fh-id"><div class="fh-tk">${esc(tk.length > 1 ? `${tk[1]} · ${tk[0]}` : tk[0])}</div><h1>${esc(r.nombre || r.sym)}</h1>
      <div class="fh-meta">${esc(meta)}</div>${R.head ? `<div class="fh-tesis" title="Titular generado con reglas a partir de los datos, sin IA">${esc(R.head)}</div>` : ""}</div>
    <div class="fh-px"><div class="fh-p num">${nf(r.precio, 2)}<small>${esc(r.moneda || "")}</small></div>
      <div class="fh-c num"><span class="${(r.r1d ?? 0) >= 0 ? "pos" : "neg"}">${sgn(r.r1d, 2)} %</span> <span class="fa">hoy · 1 año</span> <span class="${(r.r1a ?? 0) >= 0 ? "pos" : "neg"}">${r.r1a == null ? "—" : sgn(r.r1a, 1) + " %"}</span></div>
      <div class="fh-t">Técnico <span class="${tv === "Alcista" ? "pos" : tv === "Bajista" ? "neg" : "mu"}">${esc(tv || "—")}</span> ${H.evid("h", "r")}</div></div>
    ${sparkSvg(d)}
    <div class="fp-act"><button class="fbtn ${w ? "on" : ""}" data-watch="${esc(r.sym)}">${ico("star")}${w ? "En Watchlist" : "Añadir a Watchlist"}</button>
      <button class="fbtn ${cm ? "on" : ""}" data-cmp-toggle="${esc(r.sym)}">${ico("cmp")}${cm ? "En comparador" : "Comparar"}</button>
      <button class="fbtn pri" data-dnew="${esc(r.sym)}">${ico("pen")}Registrar decisión</button>
      <button class="fbtn ic" data-copylink="${esc(r.sym)}" title="Copiar el enlace directo a esta ficha" aria-label="Copiar enlace">${ico("link")}</button></div></div>`;
}

/* ---------- Resumen en tres columnas (diseño A) ---------- */
const sec2 = (title, body, right = "") => `<section class="fs"><h3>${title}${right ? `<span>${right}</span>` : ""}</h3>${body}</section>`;
const kvt = (rows) => `<table class="kvt">${rows.map(([a, b, tip]) => `<tr><td${tip ? ` data-tip="${esc(tip)}"` : ""}>${a}</td><td class="num">${b}</td></tr>`).join("")}</table>`;
const mm = (v) => (v == null ? "—" : v < 0 ? `(${nf(-v / 1e6, 1)})` : nf(v / 1e6, 1));
const pc = (v, d = 1) => (v == null ? "—" : v < 0 ? `<span class="neg">${sgn(v, d)} %</span>` : `${sgn(v, d)} %`);
function keyData(c) {
  const { r } = c, k = K(), x = (v, s = "×") => (v == null ? "—" : nf(v, 1) + s);
  return sec2("Datos clave", kvt([
    ["Capitalización", r.mcap ? `${nf(r.mcap / 1e6, 0)} M ${esc(r.moneda || "")}` : "—"], ["PER (12 m)", x(r.per)], ["PER previsto", x(r.per_fwd)],
    ["EV/EBITDA", x(r.ev_ebitda)], ["P/VC", x(r.pb)],
    ["Deuda neta/EBITDA", r.deuda_neta_ebitda == null ? "—" : r.deuda_neta_ebitda <= 0 ? '<span class="pos">caja neta</span>' : x(r.deuda_neta_ebitda)],
    ["ROE", r.roe == null ? "—" : nf(r.roe, 1) + " %"], ["Margen operativo", r.margen_op == null ? "—" : nf(r.margen_op, 1) + " %"],
    ["Dividendo", r.div > 0 ? nf(r.div, 2) + " %" : '<span class="mu">no reparte</span>'], ["Beta", r.beta == null ? "—" : nf(r.beta, 2)],
    ["Precio objetivo medio", r.precio_objetivo ? `${nf(r.precio_objetivo, 2)} <span class="fa">(${r.n_analistas ?? "?"} analistas)</span>` : "—"],
  ]), `Yahoo · ${fmtDate(r.fecha_fund)}`);
}
function finTable(c) {
  const cur = esc(c.cur || "");
  if (c.us) {
    const q = c.q.slice(-8), off = c.q.length - q.length, cq = cfoQ(c.q).slice(-8), L = q.length - 1;
    const yoy = (i, col) => { const j = yearAgo(c.q, off + i); return j >= 0 ? chg(q[i][col], c.q[j][col]) : null; };
    const row = (t, f, cls = "") => `<tr class="${cls}"><td>${t}</td>${q.map((x, i) => `<td class="num${i === L ? " last" : ""}">${f(x, i)}</td>`).join("")}</tr>`;
    return sec2("Cuenta de resultados trimestral", `<div class="tbl-wrap"><table class="fin"><thead><tr><th></th>${q.map((x, i) => `<th class="${i === L ? "last" : ""}">${qLabel(x, true)}${x[Q.forma] === "10-K" ? "*" : ""}</th>`).join("")}</tr></thead><tbody>
      ${row("Ingresos", (x) => mm(x[Q.v]), "k")}${row("crec. interanual", (x, i) => pc(yoy(i, Q.v)), "p")}
      ${row("Beneficio bruto", (x) => mm(x[Q.bruto]))}${row("margen bruto", (x) => (mg(x[Q.bruto], x[Q.v]) == null ? "—" : nf(mg(x[Q.bruto], x[Q.v]), 1) + " %"), "p")}
      ${row("Resultado operativo", (x) => mm(x[Q.ebit]))}
      ${row("Beneficio neto", (x) => mm(x[Q.bn]), "k")}${row("margen neto", (x) => (mg(x[Q.bn], x[Q.v]) == null ? "—" : nf(mg(x[Q.bn], x[Q.v]), 1) + " %"), "p")}
      ${row(`BPA diluido (${cur})`, (x) => (x[Q.bpa] == null ? "—" : x[Q.bpa] < 0 ? `(${nf(-x[Q.bpa], 2)})` : nf(x[Q.bpa], 2)))}
      ${row("Flujo de caja operativo", (x, i) => mm(cq[i]))}${row("caja / beneficio", (x, i) => (cq[i] == null || !x[Q.bn] ? "—" : cq[i] / x[Q.bn] < 0 ? `<span class="neg">(${nf(-cq[i] / x[Q.bn], 2)})</span>` : nf(cq[i] / x[Q.bn], 2)), "p")}
      ${row("presentado", (x) => (x[Q.pres] ? fmtDate(x[Q.pres]).replace(/ \d{4}$/, "") : "—"), "p")}
      </tbody></table></div><div class="fsrc">Millones de ${cur} salvo indicación · SEC 10-Q y 10-K originales · * 4.º trimestre deducido del 10-K (BPA aproximado) · negativos entre paréntesis · columna resaltada: último presentado</div>`,
      `M ${cur} · SEC`);
  }
  const an = c.d?.anual || {}, ys = Object.keys(an).sort().slice(-5), L = ys.length - 1;
  if (!ys.length) return sec2("Cuentas anuales", '<div class="nodata">Sin cuentas anuales en la fuente.</div>');
  const row = (t, f, cls = "") => `<tr class="${cls}"><td>${t}</td>${ys.map((y, i) => `<td class="num${i === L ? " last" : ""}">${f(an[y], i)}</td>`).join("")}</tr>`;
  const g = (i, key) => (i ? chg(an[ys[i]][key], an[ys[i - 1]][key]) : null);
  return sec2("Cuentas anuales", `<div class="tbl-wrap"><table class="fin"><thead><tr><th></th>${ys.map((y, i) => `<th class="${i === L ? "last" : ""}">${y}</th>`).join("")}</tr></thead><tbody>
    ${row("Ventas", (a) => mm(a.ventas), "k")}${row("crecimiento", (a, i) => pc(g(i, "ventas")), "p")}
    ${row("EBITDA", (a) => mm(a.ebitda))}${row("margen EBITDA", (a) => (mg(a.ebitda, a.ventas) == null ? "—" : nf(mg(a.ebitda, a.ventas), 1) + " %"), "p")}
    ${row("Beneficio neto", (a) => mm(a.beneficio_neto), "k")}${row("margen neto", (a) => (mg(a.beneficio_neto, a.ventas) == null ? "—" : nf(mg(a.beneficio_neto, a.ventas), 1) + " %"), "p")}
    ${row(`BPA (${cur})`, (a) => (a.bpa == null ? "—" : a.bpa < 0 ? `(${nf(-a.bpa, 2)})` : nf(a.bpa, 2)))}${row("Flujo de caja libre", (a) => mm(a.fcf))}
    </tbody></table></div><div class="fsrc">Millones de ${cur} · Yahoo Finance, cuentas anuales a ${fmtDate(c.r.fecha_fund)} · la fuente no da trimestres comparables en Europa · negativos entre paréntesis</div>`, `M ${cur} · Yahoo`);
}
function chartsRow(c) {
  const strip = (h) => h.replace(/^<section class="fbox ">/, '<div class="fch">').replace(/<\/section>$/, "</div>");
  return `<div class="fchs">${strip(growthBox(c))}${strip(marginsBox(c))}</div>`;
}
function scoreCol(c) {
  const { r } = c, k = K(), f = k.E.sc?.factores?.[r.sym] || {}, U = k.E.uni.filas.filter((x) => x.score != null);
  const sv = r.score, pctU = sv == null ? null : Math.round((100 * U.filter((x) => x.score < sv).length) / Math.max(1, U.length - 1));
  const S = U.filter((x) => x.sector === r.sector).sort((a, b) => b.score - a.score), pos = S.findIndex((x) => x.sym === r.sym) + 1;
  const ord = k.E.sc?.veredicto_lab?.etiqueta === "ordenación", cov = k.coverageOf(f), W = k.E.w, tw = Object.values(W).reduce((a, b) => a + (b || 0), 0) || 1;
  return sec2(`Nota de ordenación ${H.evid("e", "r")}`, `<div class="fsc"><span class="fsc-v num">${sv ?? "s. d."}</span><span class="fsc-t">${sv == null ? "no concluyente: faltan datos" : `percentil ${pctU} del universo<br>${esc(k.sn(r.sector))}: ${pos} de ${S.length}`}</span></div>
    ${ord ? '<div class="fwarn">Ordena empresas; el Laboratorio no ha demostrado que prediga rentabilidad.</div>' : ""}
    <table class="fac">${k.FACT.map(([key, t]) => { const v = f[key]; return `<tr data-tip="${esc(k.FACT_TIP[key])}"><td>${t}</td><td>${v == null ? '<span class="fa">sin dato · cuenta 50</span>' : `<span class="fbr"><i style="width:${v}%;background:${v >= 67 ? "var(--good)" : v <= 33 ? "var(--bad)" : "var(--muted)"}"></i><b></b></span>`}</td><td class="num">${v == null ? "—" : "p" + Math.round(v)}</td><td class="num fa">${Math.round((100 * (W[key] || 0)) / tw)} %</td></tr>`; }).join("")}</table>
    <div class="fsrc">Percentil dentro de su sector · línea = mediana · última columna = peso · cobertura ${cov ?? "—"} %${r.f_fs != null ? ` · F-score ${r.f_fs}/9` : ""} · <button class="link-btn" data-fsec="factores">desglose</button></div>`, `tus pesos · ${U.length} valores`);
}
function valCol(c) {
  const { r } = c, k = K(), st = k.E.sec.stats.Todos, sI = st.industria[r.industria] || {}, sS = st.sector[r.sector] || {};
  const ref = (sI.n || 0) >= 8 ? sI : sS, refN = ref === sI ? "industria" : "sector";
  const line = (t, v, m, suf, lowGood) => { if (v == null || m == null) return [t, "—"]; const d = m ? (v / m - 1) * 100 : null;
    return [t, `${nf(v, 1)}${suf} <span class="fa">vs ${nf(m, 1)}${suf}</span> ${d == null ? "" : `<span class="${(lowGood ? -d : d) > 0 ? "pos" : "neg"}">${sgn(d, 0)} %</span>`}`]; };
  return sec2(`Valoración frente a su ${refN}`, kvt([line("PER", r.per, ref.per, "×", true), line("EV/EBITDA", r.ev_ebitda, ref.ev_ebitda, "×", true), line("P/VC", r.pb, ref.pb, "×", true), line("P/Ventas", r.ps, ref.ps, "×", true)]), `mediana · ${ref.n || "—"} valores`);
}
function secResumen(c) {
  return `<div class="f3"><div class="f3a">${keyData(c)}${eventsBox(c)}${qualityBox(c)}</div>
    <div class="f3b">${finTable(c)}${chartsRow(c)}</div>
    <div class="f3c">${scoreCol(c)}${valCol(c)}</div></div>${readingBox(c)}`;
}

/* ---------- tarjetas con fuente y fecha ---------- */
function kpis(c) {
  const { r, q, fy } = c, k = K(), out = [];
  const card = (t, v, p, src, tip) => `<div class="fk"${tip ? ` data-tip="${esc(tip)}"` : ""}><span class="fk-t">${t}</span><div class="fk-v num">${v} ${p || ""}</div><div class="fk-s">${src}</div></div>`;
  if (c.us) {
    const i = q.length - 1, L = q[i], j = yearAgo(q, i), P = j >= 0 ? q[j] : null;
    const src = `SEC · ${esc(L[Q.forma] || "10-Q")}${L[Q.forma] === "10-K" ? " (trimestre deducido)" : ""} · presentado ${fmtDate(L[Q.pres])}${P ? ` · vs ${qLabel(P)}` : ""}`;
    out.push(card(`Ingresos ${qLabel(L)}`, fmtM(L[Q.v], c.cur), pill(chg(L[Q.v], P?.[Q.v])), src, "Ventas del trimestre y variación frente al mismo trimestre del año anterior"));
    out.push(card(`Beneficio neto ${qLabel(L, true).split(" ")[0]}`, fmtM(L[Q.bn], c.cur), pill(chgAbs(L[Q.bn], P?.[Q.bn])), `SEC · ${esc(L[Q.forma] || "10-Q")} · presentado ${fmtDate(L[Q.pres])}`));
    if (L[Q.bpa] != null) out.push(card(`BPA diluido ${qLabel(L, true).split(" ")[0]}`, `${nf(L[Q.bpa], 2)} $`, pill(chgAbs(L[Q.bpa], P?.[Q.bpa])), `SEC · ${esc(L[Q.forma] || "10-Q")} · presentado ${fmtDate(L[Q.pres])}${L[Q.forma] === "10-K" ? " · aproximado" : ""}`));
    else out.push(card(`Margen bruto ${qLabel(L, true).split(" ")[0]}`, L[Q.bruto] != null && L[Q.v] ? nf((100 * L[Q.bruto]) / L[Q.v], 1) + " %" : "—", "", `SEC · presentado ${fmtDate(L[Q.pres])} · sin BPA en la caché todavía`));
    const F = fy[fy.length - 1], F0 = fy[fy.length - 2];
    if (F) out.push(card(`Ingresos ejercicio ${F[0].slice(0, 4)}`, fmtM(F[FY.v], c.cur), pill(chg(F[FY.v], F0?.[FY.v])), `SEC · 10-K · presentado ${fmtDate(F[FY.pres])}`, "Ejercicio fiscal cerrado el " + fmtDate(F[0])));
  } else {
    const an = c.d?.anual || {}, ys = Object.keys(an).sort(), y = ys[ys.length - 1], y0 = ys[ys.length - 2];
    const src = `Yahoo Finance · cuentas anuales · a ${fmtDate(r.fecha_fund)}`;
    if (y) {
      out.push(card(`Ventas ${y}`, fmtM(an[y].ventas, c.cur), pill(chg(an[y].ventas, an[y0]?.ventas)), src));
      out.push(card(`Beneficio neto ${y}`, fmtM(an[y].beneficio_neto, c.cur), pill(chgAbs(an[y].beneficio_neto, an[y0]?.beneficio_neto)), src));
      out.push(card(`BPA ${y}`, an[y].bpa == null ? "—" : nf(an[y].bpa, 2), pill(chgAbs(an[y].bpa, an[y0]?.bpa)), src));
    } else out.push(card("Cuentas", "—", "", "Sin cuentas anuales en la fuente"));
    out.push(card("Margen operativo (12 m)", r.margen_op == null ? "—" : nf(r.margen_op, 1) + " %", "", `Yahoo Finance · últimos 12 meses · a ${fmtDate(r.fecha_fund)}`));
  }
  out.push(card("Precio y nota", `${nf(r.precio, 2)} <small>${esc(r.moneda || "")}</small>`, pill(r.r1d, 1),
    `${esc(k.scoreName().replace("Puntuación", "Nota"))} <b>${r.score ?? "—"}</b> · técnico ${esc(r.veredicto || "—")} · cierre ${fmtDate(r.fecha_precio)}`));
  return `<div class="fks">${out.join("")}</div>`;
}

/* ---------- gráficos SVG ---------- */
function bars(items, hiA, hiB, unit) {   // items: [etiqueta, valor]; hiA = último, hiB = comparado
  if (items.length < 2) return '<div class="nodata">Sin serie suficiente.</div>';
  const W = 560, Hh = 210, L = 44, R = 8, T = 34, B = 26, vals = items.map((x) => x[1] || 0), mx = Math.max(...vals, 0) * 1.05 || 1, mn = Math.min(0, ...vals);
  const bw = (W - L - R) / items.length, y = (v) => T + (1 - (v - mn) / (mx - mn)) * (Hh - T - B);
  const ticks = [mn, (mx + mn) / 2, mx].map((v) => `<text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" class="ax">${nf(v / unit, 0)}</text><line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/>`).join("");
  const cx = (i) => L + bw * i + bw / 2;
  let h = items.map(([l, v], i) => { const c = i === hiA ? "var(--accent)" : i === hiB ? "var(--good)" : "var(--surface-3, #24406a)";
    return `<rect x="${L + bw * i + bw * 0.18}" y="${Math.min(y(v || 0), y(0))}" width="${bw * 0.64}" height="${Math.abs(y(0) - y(v || 0))}" rx="2" fill="${c}"/>
      ${i === hiA || i === hiB ? `<text x="${cx(i)}" y="${y(v || 0) - 5}" text-anchor="middle" class="bv">${nf(v / unit, 0)}</text>` : ""}
      <text x="${cx(i)}" y="${Hh - 8}" text-anchor="middle" class="ax ${i === hiA || i === hiB ? "on" : ""}">${esc(l)}</text>`; }).join("");
  if (hiA >= 0 && hiB >= 0 && items[hiB][1] > 0) {
    const g = chg(items[hiA][1], items[hiB][1]), yy = T - 14;
    h += `<path d="M${cx(hiB)} ${y(items[hiB][1]) - 18} V${yy} H${cx(hiA)} V${y(items[hiA][1]) - 18}" fill="none" stroke="var(--accent)" stroke-width="1.2"/>
      <rect x="${(cx(hiA) + cx(hiB)) / 2 - 30}" y="${yy - 10}" width="60" height="20" rx="5" fill="var(--surface)" stroke="var(--accent)"/>
      <text x="${(cx(hiA) + cx(hiB)) / 2}" y="${yy + 4}" text-anchor="middle" class="bv" fill="var(--accent)">${sgn(g, 1)} %</text>`;
  }
  return `<svg class="fsvg" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Barras">${ticks}${h}</svg>`;
}
function lines(labels, series) {   // series: [nombre, color, valores %]
  const all = series.flatMap((s) => s[2]).filter((v) => v != null && isFinite(v));
  if (labels.length < 2 || !all.length) return '<div class="nodata">Sin serie suficiente.</div>';
  const W = 560, Hh = 210, L = 40, R = 14, T = 12, B = 26, pad = Math.max(1, (Math.max(...all) - Math.min(...all)) * 0.15);
  const mn = Math.min(...all) - pad, mx = Math.max(...all) + pad, x = (i) => L + (i / (labels.length - 1)) * (W - L - R), y = (v) => T + (1 - (v - mn) / (mx - mn)) * (Hh - T - B);
  const tk = [0, 1, 2, 3, 4].map((i) => mn + ((mx - mn) * i) / 4).map((v) => `<text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" class="ax">${nf(v, 0)} %</text><line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/>`).join("");
  const ln = series.map(([, c, v]) => {
    const p = v.map((z, i) => (z == null || !isFinite(z) ? null : `${x(i).toFixed(1)},${y(z).toFixed(1)}`)).filter(Boolean);
    const li = v.map((z, i) => [z, i]).filter(([z]) => z != null && isFinite(z)).pop();
    return p.length ? `<polyline points="${p.join(" ")}" fill="none" stroke="${c}" stroke-width="2"/>${li ? `<circle cx="${x(li[1])}" cy="${y(li[0])}" r="3.5" fill="${c}"/>` : ""}` : "";
  }).join("");
  return `<svg class="fsvg" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Líneas">${tk}${ln}${labels.map((l, i) => `<text x="${x(i)}" y="${Hh - 8}" text-anchor="middle" class="ax">${esc(l)}</text>`).join("")}</svg>`;
}
const legend = (items) => `<div class="flg">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("")}</div>`;
const mg = (a, b) => (a == null || !b ? null : (100 * a) / b);

function growthBox(c) {
  if (c.us) {
    const q = c.q.slice(-8), i = q.length - 1, j = yearAgo(q, i);
    return box("Crecimiento reciente", bars(q.map((x) => [qLabel(x, true), x[Q.v]]), i, j, 1e6) + legend([["var(--accent)", "Último trimestre"], ["var(--good)", "Mismo trimestre del año anterior"]]),
      `Ingresos trimestrales (M) · SEC 10-Q/10-K`);
  }
  const an = c.d?.anual || {}, ys = Object.keys(an).sort();
  return box("Crecimiento reciente", bars(ys.map((y) => [y, an[y].ventas]), ys.length - 1, ys.length - 2, 1e6) + legend([["var(--accent)", "Último ejercicio"], ["var(--good)", "Ejercicio anterior"]]),
    "Ventas anuales (M) · Yahoo Finance · la fuente no da trimestres comparables");
}
function marginsBox(c) {
  if (c.us) {
    const q = c.q.slice(-8), S = [["Bruto", "var(--accent)", q.map((x) => mg(x[Q.bruto], x[Q.v]))], ["Operativo", "var(--good)", q.map((x) => mg(x[Q.ebit], x[Q.v]))], ["Neto", "var(--warn)", q.map((x) => mg(x[Q.bn], x[Q.v]))]]
      .filter((s) => s[2].some((v) => v != null));
    const last = (v) => [...v].reverse().find((z) => z != null);
    return box("Márgenes", lines(q.map((x) => qLabel(x, true)), S) + legend(S.map(([t, col, v]) => [col, `${t} ${last(v) == null ? "—" : nf(last(v), 1) + " %"}`])), `Últimos ${q.length} trimestres · SEC`);
  }
  const an = c.d?.anual || {}, ys = Object.keys(an).sort();
  const S = [["EBITDA", "var(--good)", ys.map((y) => mg(an[y].ebitda, an[y].ventas))], ["Neto", "var(--warn)", ys.map((y) => mg(an[y].beneficio_neto, an[y].ventas))]].filter((s) => s[2].some((v) => v != null));
  const last = (v) => [...v].reverse().find((z) => z != null);
  return box("Márgenes", lines(ys, S) + legend(S.map(([t, col, v]) => [col, `${t} ${last(v) == null ? "—" : nf(last(v), 1) + " %"}`])), "Anual · Yahoo Finance (sin margen bruto en la fuente)");
}

/* ---------- calidad y trazabilidad del dato ---------- */
function discrepancy(c) {   // ventas del último ejercicio: SEC frente a Yahoo
  const an = c.d?.anual || {};
  for (const F of [...c.fy].reverse()) {
    const y = F[0].slice(0, 4), a = an[y]?.ventas;
    if (a != null && F[FY.v]) return { y, d: (a / F[FY.v] - 1) * 100 };
  }
  return null;
}
function qualityBox(c) {
  const { r } = c, k = K(), rows = [];
  const add = (t, v, st) => rows.push(`<div class="fq"><span>${t}</span><span class="fq-v">${dot(st)}${v}</span></div>`);
  const st = k.E.sec?.stats?.Todos?.sector?.[r.sector] || {};
  if (c.us) {
    const L = c.q[c.q.length - 1], age = -daysTo(L[Q.pres]);
    add("Resultados", L[Q.forma] === "10-K" ? "SEC 10-K original (trimestre deducido)" : "SEC 10-Q original", "ok");
    add("Presentación", `${fmtDate(L[Q.pres])} (${ago(L[Q.pres])})`, age > 120 ? "warn" : "ok");
    add("Cobertura fundamental", `${c.sec.nq || c.q.length} trimestres · ${c.sec.nfy || c.fy.length} ejercicios`, (c.sec.nq || 0) >= 8 ? "ok" : "warn");
  } else {
    add("Resultados", "Yahoo Finance (cuentas anuales)", "warn");
    add("Actualización", fmtDate(r.fecha_fund) + ` (${ago(r.fecha_fund)})`, -daysTo(r.fecha_fund) > 10 ? "warn" : "ok");
    add("Cobertura fundamental", `${Object.keys(c.d?.anual || {}).length} ejercicios · sin trimestres`, "warn");
  }
  const pa = -daysTo(r.fecha_precio);
  add("Precio", `${esc(r.fuente_precio || "Yahoo")} · cierre ${fmtDate(r.fecha_precio)}`, pa > 4 ? "warn" : "ok");
  add("Valoración", r.per_vs_sector != null ? "PER y EV/EBITDA frente a sector" : "Sin PER comparable", r.per_vs_sector != null ? "ok" : "warn");
  add("Comparables", `${st.n || "—"} valores del sector`, (st.n || 0) >= 8 ? "ok" : "warn");
  add("Histórico «a fecha»", c.us ? "Fechas de presentación SEC" : "No: Yahoo no da fechas de publicación", c.us ? "ok" : "warn");
  const dsc = c.us ? discrepancy(c) : null;
  if (c.us) add("Discrepancias entre fuentes", dsc ? `Ventas ${dsc.y}: Yahoo ${sgn(dsc.d, 1)} % vs SEC` : "Sin segunda fuente comparable", dsc ? (Math.abs(dsc.d) < 1 ? "ok" : "warn") : "na");
  return sec2("Calidad del dato", rows.join(""));
}

/* ---------- factores ---------- */
function factorsBox(c) {
  const { r } = c, k = K(), f = k.E.sc?.factores?.[r.sym] || {}, st = k.E.sec?.stats?.Todos?.sector?.[r.sector] || {};
  const ord = k.E.sc?.veredicto_lab?.etiqueta === "ordenación";
  return box(`Factores y scoring ${H.evid("e", "r")}`, `${ord ? `<div class="fwarn">ⓘ <b>Nota de ordenación</b>: el Laboratorio no ha validado que prediga rentabilidad.</div>` : ""}
    ${k.FACT.map(([key, t]) => { const v = f[key]; return `<div class="fbar" data-tip="${esc(k.FACT_TIP[key])}"><span>${t}</span><span class="tr"><i style="width:${v ?? 0}%;background:${v == null ? "transparent" : v >= 67 ? "var(--good)" : v <= 33 ? "var(--warn)" : "var(--muted)"}"></i></span><b class="num${v == null ? " hint" : ""}">${v == null ? "s. d." : "p" + Math.round(v)}</b></div>`; }).join("")}
    <div class="fq"><span>Comparación sectorial</span><span class="fq-v">${dot(st.n >= 8 ? "ok" : "warn")}${esc(k.sn(r.sector))} · ${st.n || "—"} valores</span></div>
    <div class="fq"><span>Cobertura de la nota</span><span class="fq-v">${(() => { const cv = k.coverageOf(f); return `${dot(cv >= 100 ? "ok" : cv >= 70 ? "warn" : "bad")}${cv ?? "—"} % del peso con dato`; })()}</span></div>
    ${r.f_fs != null ? `<div class="fq"><span>F-score de Piotroski</span><span class="fq-v">${dot(r.f_fs >= 7 ? "ok" : r.f_fs <= 3 ? "bad" : "warn")}${r.f_fs} / 9</span></div>` : ""}
    <button class="link-btn" data-fsec="factores">Ver el desglose de la nota →</button>`);
}

/* ---------- próximos eventos ---------- */
function eventsBox(c) {
  const { r } = c, rows = [], add = (t, v, st) => rows.push(`<div class="fq"><span>${t}</span><span class="fq-v">${st ? dot(st) : ""}${v}</span></div>`);
  const n = daysTo(r.resultados);
  add(`Resultados${c.us ? " " + nextLabel(c.q[c.q.length - 1]) : ""}`, r.resultados ? `<b>${fmtDate(r.resultados)}</b>${n != null && n >= 0 ? ` <span class="pl pl-i">en ${n} días</span>` : ""}` : "Sin fecha en la fuente", r.resultados ? "" : "na");
  const ex = r.exdiv, nx = daysTo(ex);
  add("Dividendo", ex && nx >= 0 ? `Ex-dividendo <b>${fmtDate(ex)}</b> <span class="pl pl-i">en ${nx} días</span>` : r.div > 0 ? `${nf(r.div, 2)} %${ex ? ` · último ex-div. ${fmtDate(ex)}` : ""}` : "No reparte", r.div > 0 ? "ok" : "na");
  const sm = window.SCRSmart, ins = sm?.ins?.(), sd = sm?.data?.();
  if (!r.sym.includes(".")) {
    if (!ins) sm?.ensureIns?.();
    const v = ins?.por_valor?.[r.sym];
    add(`Directivos (${ins?.ventana_dias || 90} días)`, !ins ? "cargando…" : v ? `${v.n_ventas} ventas · ${v.n_compras} compras${v.racimo ? " · racimo" : ""}` : "Sin operaciones", !v ? "na" : v.n_compras > v.n_ventas ? "ok" : v.n_ventas ? "warn" : "na");
  } else add("Directivos", "Formulario 4 solo existe en EE. UU.", "na");
  if (!sd) sm?.ensure?.();
  const p = sd?.por_valor?.[r.sym];
  add("Superinversores", !sd ? "cargando…" : p?.f?.length ? `${p.f.length} gestores (13F)` : "Ninguno en su último 13F", p?.f?.length ? "ok" : "na");
  add("Congreso de EE. UU.", !sd ? "cargando…" : p?.c?.length ? `${p.c.length} operaciones (12 m)` : "Sin operaciones (12 m)", p?.c?.length ? "warn" : "na");
  return sec2("Próximos eventos", rows.join("")) + sec2("Tu investigación", myResearch(c));
}
function myResearch(c) {
  return window.SCRDiario ? window.SCRDiario.fichaBlock(c.r.sym) : '<div class="hint">Cargando el diario…</div>';
}

/* ---------- lectura analítica (reglas, sin IA) ---------- */
function reading(c) {
  const { r } = c, k = K(), f = k.E.sc?.factores?.[r.sym] || {}, txt = [], ev = [], todo = [], M = {};
  if (c.us && c.q.length >= 5) {
    const q = c.q, i = q.length - 1, L = q[i], j = yearAgo(q, i), g = j >= 0 ? chg(L[Q.v], q[j][Q.v]) : null;
    const gs = q.map((_, n) => { const a = yearAgo(q, n); return a >= 0 ? chg(q[n][Q.v], q[a][Q.v]) : null; }).slice(-8).filter((v) => v != null);
    if (g != null) {
      const rank = gs.length >= 4 ? (g >= Math.max(...gs) ? ", el mayor ritmo de los últimos " + gs.length + " trimestres con comparación" : g <= Math.min(...gs) ? ", el menor ritmo de los últimos " + gs.length + " trimestres con comparación" : "") : "";
      txt.push(`Los ingresos del ${qLabel(L)} ${g >= 0 ? "crecen" : "caen"} un ${nf(Math.abs(g), 1)} % interanual${rank}.`);
      ev.push(`Ingresos ${sgn(g, 1)} % interanual en el ${qLabel(L)}${rank ? rank.replace(", el", "; el") : ""}.|${L[Q.forma] || "10-Q"}`);
      M.g = g; M.gs = gs;
    }
    const mb = q.slice(-4).map((x) => mg(x[Q.bruto], x[Q.v])), mn = q.slice(-4).map((x) => mg(x[Q.bn], x[Q.v]));
    if (mb[3] != null && mb[0] != null) { const d = mb[3] - mb[0]; M.mbD = d; M.mb = mb[3];
      ev.push(`Margen bruto ${Math.abs(d) < 1 ? "estable" : d > 0 ? "al alza" : "a la baja"}: ${nf(mb[0], 1)} % → ${nf(mb[3], 1)} % en cuatro trimestres.|10-Q`); txt.push(`El margen bruto ${Math.abs(d) < 1 ? "se mantiene estable" : d > 0 ? "mejora" : "empeora"} (${nf(mb[0], 1)} % → ${nf(mb[3], 1)} % en cuatro trimestres).`); }
    if (mn[3] != null && mn[2] != null && mn[1] != null) {
      const e = 0.15, down2 = mn[3] < mn[2] - e && mn[2] < mn[1] - e, up2 = mn[3] > mn[2] + e && mn[2] > mn[1] + e;
      const flat = Math.abs(mn[3] - mn[2]) <= e;
      txt.push(flat ? `El margen neto se mantiene en torno al ${nf(mn[3], 1)} %.`
        : `El margen neto ${down2 ? "baja por segundo trimestre consecutivo" : up2 ? "sube por segundo trimestre consecutivo" : mn[3] < mn[2] ? "baja" : "sube"}, de ${nf(mn[2], 1)} % a ${nf(mn[3], 1)} %${down2 && g > 0 ? ": el beneficio crece menos que las ventas" : ""}.`);
      M.down2 = down2; M.up2 = up2; M.mn = [mn[2], mn[3]];
      if (down2) todo.push("Por qué cae el margen neto (impuestos, costes, mezcla de producto).");
    }
    if (j >= 0 && L[Q.bpa] != null && q[j][Q.bpa] != null) { M.gEps = chgAbs(L[Q.bpa], q[j][Q.bpa]); ev.push(`BPA diluido ${sgn(M.gEps, 1)} % interanual${L[Q.forma] === "10-K" ? " (aproximado)" : ""}.|${L[Q.forma] || "10-Q"}`); }
    const cq = cfoQ(q).slice(-4), bq = q.slice(-4).map((x) => x[Q.bn]);
    const okc = cq.filter((v) => v != null);
    if (okc.length >= 2) {
      const pos = okc.filter((v) => v > 0).length;
      ev.push(`Caja operativa positiva en ${pos} de los ${okc.length} últimos trimestres con dato.|10-Q`);
      const sc = okc.reduce((a, b) => a + b, 0), sb = bq.filter((v, n) => cq[n] != null).reduce((a, b) => a + (b || 0), 0);
      if (sb > 0) M.cr = sc / sb;
      if (sb > 0 && sc < 0.8 * sb) todo.push("Conversión del beneficio en caja: el flujo operativo está por debajo del beneficio.");
    }
  } else {
    const an = c.d?.anual || {}, ys = Object.keys(an).sort(), y = ys[ys.length - 1], y0 = ys[ys.length - 2];
    if (y && y0 && an[y].ventas && an[y0].ventas) { const g = chg(an[y].ventas, an[y0].ventas); M.g = g; txt.push(`Las ventas de ${y} ${g >= 0 ? "crecen" : "caen"} un ${nf(Math.abs(g), 1)} % frente a ${y0}.`); ev.push(`Ventas ${sgn(g, 1)} % en ${y}.|Yahoo`); }
    if (r.margen_op != null) txt.push(`Margen operativo de los últimos 12 meses: ${nf(r.margen_op, 1)} %.`);
    todo.push("Resultados trimestrales o semestrales: la fuente gratuita solo da cuentas anuales.");
  }
  if (r.per_vs_sector != null) {
    txt.push(`Cotiza con un PER un ${nf(Math.abs(r.per_vs_sector), 0)} % ${r.per_vs_sector >= 0 ? "por encima" : "por debajo"} de la mediana de su sector.`);
    if (r.per_vs_sector > 20) todo.push("Si el crecimiento justifica la prima frente a su sector.");
  }
  const best = k.FACT.map(([key, t]) => [t, f[key]]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
  if (best.length) ev.push(`${best[0][0]} en el percentil ${Math.round(best[0][1])} de su sector.|nota`);
  if (r.f_fs != null) ev.push(`F-score de Piotroski ${r.f_fs} / 9.|10-K`);
  if (r.deuda_neta_ebitda != null && r.deuda_neta_ebitda <= 0) ev.push("Caja neta: no tiene deuda financiera neta.|Yahoo");
  const v = window.SCRSmart?.ins?.()?.por_valor?.[r.sym];
  if (v && v.n_ventas && !v.n_compras) todo.push(`Ventas de directivos (${v.n_ventas}): si son planes 10b5-1 o ventas discrecionales.`);
  if (r.deuda_neta_ebitda != null && r.deuda_neta_ebitda > 3) todo.push(`Capacidad de pago de la deuda (deuda neta/EBITDA ${nf(r.deuda_neta_ebitda, 1)}×).`);
  const n = daysTo(r.resultados);
  if (n != null && n >= 0 && n <= 30) todo.push(`Resultados el ${fmtDate(r.resultados)}: guía de la directiva y cartera de pedidos.`);
  todo.push(c.us ? "Concentración de clientes y riesgos en el último 10-K." : "Concentración de clientes y riesgos en el informe anual.");
  todo.push("Valoración frente a comparables directos (apartado Comparables).");
  /* interpretación (juicio con reglas) y argumentos en contra, separados de lo observado */
  const interp = [], contra = [], pv = r.per_vs_sector, sg = r.crec_ventas;
  const sec = k.E.sec?.stats?.Todos?.sector?.[r.sector] || {};
  if (M.g != null && M.mbD != null && M.g > 5 && Math.abs(M.mbD) < 1) interp.push("El crecimiento lo sostiene el volumen, no el precio: el margen bruto no se mueve.");
  if (M.mbD != null && M.mbD >= 1) interp.push("Gana poder de precios o mejora la mezcla: el margen bruto sube.");
  if (M.mbD != null && M.mbD <= -1) contra.push(`El margen bruto cae ${nf(Math.abs(M.mbD), 1)} puntos en cuatro trimestres.`);
  if (M.down2 && M.g > 0) contra.push(`El margen neto baja dos trimestres seguidos (${nf(M.mn[0], 1)} % → ${nf(M.mn[1], 1)} %): el beneficio crece menos que las ventas.`);
  if (M.up2) interp.push("El margen neto sube dos trimestres seguidos: apalancamiento operativo.");
  if (M.cr != null) (M.cr >= 1 ? interp : contra).push(M.cr >= 1 ? `El beneficio se convierte en caja (${nf(M.cr, 2)} veces en el último año).` : `La caja operativa cubre solo ${nf(M.cr, 2)} veces el beneficio del último año.`);
  if (pv != null) {
    if (pv > 20 && sg != null && sec.crec_ventas != null && sg > sec.crec_ventas + 5) interp.push(`La prima frente a su sector (PER +${nf(pv, 0)} %) se apoya en un crecimiento mayor que el de su sector.`);
    else if (pv > 20) contra.push(`PER un ${nf(pv, 0)} % por encima de la mediana de su sector sin crecer claramente más.`);
    else if (pv < -20) interp.push(`Cotiza con descuento frente a su sector (PER ${nf(pv, 0)} %): el mercado espera menos de ella.`);
  }
  if (v && v.n_ventas && !v.n_compras) contra.push(`${v.n_ventas} ventas de directivos en 90 días y ninguna compra.`);
  if (v && v.n_compras > v.n_ventas) interp.push(`Los directivos compran (${v.n_compras} compras frente a ${v.n_ventas} ventas en 90 días).`);
  if (r.veredicto === "Bajista") contra.push("Técnico bajista: la nota se limita a 60.");
  if (!interp.length) interp.push("Sin una lectura clara con los datos disponibles.");
  /* titular de una línea */
  const hp = [];
  const mbTxt = M.mbD != null && Math.abs(M.mbD) < 1 ? " con margen bruto estable" : M.mbD >= 1 ? " con margen bruto al alza" : M.mbD <= -1 ? " con margen bruto a la baja" : "";
  if (M.g != null) hp.push(`${Math.abs(M.g) < 0.5 ? "Ventas estables" : `Ventas ${M.g > 0 ? "+" : "−"}${nf(Math.abs(M.g), 0)} %`}${mbTxt}`);
  else if (mbTxt) hp.push("Margen bruto" + mbTxt.replace(" con margen bruto", ""));
  if (M.down2) hp.push("el beneficio crece menos que las ventas");
  else if (M.cr != null && M.cr < 0.8) hp.push("la caja no acompaña al beneficio");
  if (v && v.n_compras > v.n_ventas) hp.push("los directivos compran");
  if (pv != null && Math.abs(pv) >= 15) hp.push(`cotiza un ${nf(Math.abs(pv), 0)} % ${pv > 0 ? "por encima" : "por debajo"} de su sector`);
  if (r.veredicto === "Bajista" && hp.length < 3) hp.push("técnico bajista");
  const head = hp.length ? hp[0] + (hp.length > 1 ? "; " + hp.slice(1).join("; ") : "") + "." : "";
  return { txt: txt.join(" "), ev, todo: todo.slice(0, 5), interp, contra, head };
}
function readingBox(c) {
  const R = reading(c);
  const li = (x) => { const [t, src] = String(x).split("|"); return `<li>${esc(t)}${src ? `<span class="ref">${esc(src)}</span>` : ""}</li>`; };
  const contra = [...R.contra, ...R.todo.map((x) => x)].slice(0, 6);
  return `<section class="rd3" aria-label="Lectura analítica">
    <div><h3><i class="pos">●</i>Observado <span class="evid-t">hechos con su fuente</span></h3><ul>${R.ev.map(li).join("") || "<li>Sin datos suficientes.</li>"}</ul></div>
    <div><h3><i class="ac">●</i>Interpretación ${H.evid("h")} <span class="evid-t">juicio con reglas · sin IA</span></h3><ul>${R.interp.map(li).join("")}</ul></div>
    <div><h3><i class="neg">●</i>En contra · por comprobar</h3><ul>${contra.map(li).join("")}</ul></div></section>`;
}

/* ---------- apartados ---------- */
function secFund(c) {
  const { r, d } = c, k = K(); let h = "";
  if (c.us) {
    const fy = c.fy, cur = c.cur;
    const rowsF = [["Ventas", (x) => x[FY.v]], ["Beneficio bruto", (x) => x[FY.bruto]], ["Resultado operativo", (x) => x[FY.ebit]], ["Beneficio neto", (x) => x[FY.bn]],
      ["Flujo de caja operativo", (x) => x[FY.cfo]], ["Inversión (capex)", (x) => x[FY.capex]], ["Flujo de caja libre", (x) => (x[FY.cfo] != null && x[FY.capex] != null ? x[FY.cfo] - x[FY.capex] : null)],
      ["Activos", (x) => x[FY.act]], ["Patrimonio neto", (x) => x[FY.pat]], ["Deuda financiera", (x) => x[FY.deuda]]];
    h += box("Cuentas anuales · SEC 10-K", `<div class="tbl-wrap"><table class="ft"><thead><tr><th></th>${fy.map((x) => `<th>${x[0].slice(0, 4)}<div class="hint">${fmtDate(x[0])}</div></th>`).join("")}</tr></thead><tbody>
      ${rowsF.map(([t, f]) => `<tr><td>${t}</td>${fy.map((x) => `<td class="num">${fmtM(f(x), cur)}</td>`).join("")}</tr>`).join("")}
      <tr><td>Acciones (portada)</td>${fy.map((x) => `<td class="num">${x[FY.acc] == null ? "—" : nf(x[FY.acc] / 1e6, 1) + " M"}</td>`).join("")}</tr>
      <tr class="hint"><td>Presentado</td>${fy.map((x) => `<td class="num">${fmtDate(x[FY.pres])}</td>`).join("")}</tr></tbody></table></div>`,
      `<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.sec.cik}&type=10-K" target="_blank" rel="noopener">Ver en EDGAR</a>`);
    const q = c.q, cq = cfoQ(q);
    h += box("Trimestres · SEC 10-Q (4.º trimestre deducido del 10-K)", `<div class="tbl-wrap"><table class="ft"><thead><tr><th>Trimestre</th><th>Cierre</th><th>Presentado</th><th>Ventas</th><th>Interanual</th><th>M. bruto</th><th>M. operativo</th><th>Beneficio neto</th><th>BPA diluido</th><th>Caja operativa</th></tr></thead><tbody>
      ${q.map((x, i) => { const j = yearAgo(q, i); return `<tr><td>${qLabel(x)}${x[Q.forma] === "10-K" ? ' <span class="hint">10-K</span>' : ""}</td><td class="num">${fmtDate(x[0])}</td><td class="num">${fmtDate(x[Q.pres])}</td>
        <td class="num">${fmtM(x[Q.v], cur)}</td><td class="num">${j >= 0 ? pill(chg(x[Q.v], q[j][Q.v])) : "—"}</td><td class="num">${mg(x[Q.bruto], x[Q.v]) == null ? "—" : nf(mg(x[Q.bruto], x[Q.v]), 1) + " %"}</td>
        <td class="num">${mg(x[Q.ebit], x[Q.v]) == null ? "—" : nf(mg(x[Q.ebit], x[Q.v]), 1) + " %"}</td><td class="num">${fmtM(x[Q.bn], cur)}</td><td class="num">${x[Q.bpa] == null ? "—" : nf(x[Q.bpa], 2)}</td><td class="num">${fmtM(cq[i], cur)}</td></tr>`; }).reverse().join("")}
      </tbody></table></div><div class="method">Cifras del documento original presentado (sin reexpresiones posteriores). BPA del 4.º trimestre: ejercicio menos los tres trimestres (aproximado). Caja operativa: diferencia del acumulado del ejercicio.</div>`);
  }
  const years = Object.keys(d?.anual || {});
  const fl = [["ventas", "Ventas"], ["ebitda", "EBITDA"], ["beneficio_neto", "Beneficio neto"], ["bpa", "BPA"], ["fcf", "Flujo de caja libre"], ["deuda_total", "Deuda total"], ["patrimonio", "Patrimonio neto"]];
  h += years.length ? box(`Cuentas anuales · Yahoo Finance${c.us ? " (segunda fuente)" : ""}`, `<div class="tbl-wrap"><table class="ft"><thead><tr><th></th>${years.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>
      ${fl.map(([key, t]) => `<tr><td>${t}</td>${years.map((y) => `<td class="num">${key === "bpa" ? nf(d.anual[y][key], 2) : fmtM(d.anual[y][key], c.cur)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`, `a ${fmtDate(r.fecha_fund)}`)
    : `<div class="err-box">Sin cuentas anuales de Yahoo para este valor.</div>`;
  h += box("Ratios (últimos 12 meses) · Yahoo Finance", `<div class="kv-grid">${[["roe", "ROE", k.pct], ["roa", "ROA", k.pct], ["margen_bruto", "Margen bruto", k.pct], ["margen_op", "Margen operativo", k.pct], ["margen_neto", "Margen neto", k.pct],
    ["crec_ventas", "Crec. ventas", k.spct], ["crec_bpa", "Crec. BPA", k.spct], ["deuda_neta_ebitda", "Deuda neta/EBITDA", (v) => (v == null ? "—" : nf(v, 1) + "×")],
    ["deuda_patrimonio", "Deuda/patrimonio", (v) => nf(v, 2)], ["payout", "Pay-out", k.pct], ["beta", "Beta", (v) => nf(v, 2)], ["empleados", "Empleados", (v) => (v == null ? "—" : nf(v, 0))]]
    .map(([key, t, f]) => `<div class="kvc"><span${k.tip(key)}>${t}</span><b class="num">${f(r[key])}</b></div>`).join("")}</div>`, `a ${fmtDate(r.fecha_fund)}`);
  return h;
}
function secValoracion(c) {
  const { r } = c, k = K(), st = k.E.sec.stats.Todos, sS = st.sector[r.sector] || {}, sI = st.industria[r.industria] || {};
  const vs = (key, lab, v, ms, mi, f) => `<tr><td${k.tip(key)}>${lab}</td><td class="num">${nf(v, 1)}</td><td class="num">${nf(ms, 1)}</td><td class="num">${nf(mi, 1)}</td><td class="num chg ${k.cls(f == null ? null : -f)}">${k.spct(f, 0)}</td></tr>`;
  const up = r.precio_objetivo && r.precio ? (r.precio_objetivo / r.precio - 1) * 100 : null;
  return `<div class="fg2">${box("Múltiplos frente a su sector e industria", `<table class="ft"><thead><tr><th></th><th>Empresa</th><th>Sector</th><th>Industria</th><th>Dif. sector</th></tr></thead><tbody>
      ${vs("per", "PER", r.per, sS.per, sI.per, r.per_vs_sector)}${vs("per_fwd", "PER previsto", r.per_fwd, sS.per_fwd, sI.per_fwd, null)}${vs("ev_ebitda", "EV/EBITDA", r.ev_ebitda, sS.ev_ebitda, sI.ev_ebitda, r.ev_ebitda_vs_sector)}${vs("pb", "P/VC", r.pb, sS.pb, sI.pb, r.pb_vs_sector)}${vs("ps", "P/V", r.ps, sS.ps, sI.ps, null)}
      </tbody></table><div class="method">Medianas de su sector (${sS.n || "—"} valores) y de su industria (${sI.n || "—"}). Verde = cotiza con descuento. Yahoo Finance a ${fmtDate(r.fecha_fund)}.</div>`)}
    ${box("Mercado y analistas", `<div class="kv-grid">${[["mcap", "Capitalización", k.big(r.mcap, r.moneda)], ["div", "Dividendo", k.pct(r.div)], ["per_fwd", "PER previsto", nf(r.per_fwd, 1)],
      ["precio_objetivo", "Precio objetivo medio", r.precio_objetivo ? `${nf(r.precio_objetivo, 2)} <span class="hint">${k.spct(up)}</span>` : "—"], ["n_analistas", "Analistas", r.n_analistas ?? "—"], ["r1a", "Rent. 1 año", k.spct(r.r1a)]]
      .map(([key, t, v]) => `<div class="kvc"><span${k.tip(key)}>${t}</span><b class="num">${v}</b></div>`).join("")}</div><div class="method">El precio objetivo es la media de los analistas que recoge Yahoo: referencia, no estimación propia.</div>`)}</div>
    ${window.SCRTesis ? `<div id="ftesis"></div>` : ""}`;
}
function secFactores(c) { const k = K(); return `<div class="fg2"><div>${k.scoreBox(c.r)}</div><div>${k.percentilesBox(c.r)}${k.academicBox(c.r)}</div></div>`; }
function secResultados(c) {
  let h = "";
  if (c.us) {
    const q = c.q.slice(-8);
    h += box("Últimos trimestres · SEC", `<div class="tbl-wrap"><table class="ft"><thead><tr><th>Trimestre</th><th>Presentado</th><th>Ventas</th><th>Interanual</th><th>Beneficio neto</th><th>BPA diluido</th><th>BPA interanual</th></tr></thead><tbody>
      ${q.map((x, i) => { const all = c.q, n = all.length - q.length + i, j = yearAgo(all, n); return `<tr><td>${qLabel(x)}</td><td class="num">${fmtDate(x[Q.pres])}</td><td class="num">${fmtM(x[Q.v], c.cur)}</td><td class="num">${j >= 0 ? pill(chg(x[Q.v], all[j][Q.v])) : "—"}</td>
        <td class="num">${fmtM(x[Q.bn], c.cur)}</td><td class="num">${x[Q.bpa] == null ? "—" : nf(x[Q.bpa], 2)}</td><td class="num">${j >= 0 ? pill(chgAbs(x[Q.bpa], all[j][Q.bpa])) : "—"}</td></tr>`; }).reverse().join("")}</tbody></table></div>`,
      `<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.sec.cik}&type=10-Q" target="_blank" rel="noopener">Documentos en EDGAR</a>`);
  }
  return h + `<div id="fnews"><div class="skel" style="height:220px"></div></div>`;
}
function peers(r) {
  const U = K().E.uni.filas, same = (x) => x.sym !== r.sym && x.mcap_usd;
  let p = U.filter((x) => same(x) && x.industria && x.industria === r.industria);
  if (p.length < 4) p = p.concat(U.filter((x) => same(x) && x.sector === r.sector && x.industria !== r.industria));
  const m = Math.log(r.mcap_usd || r.mcap || 1);
  return p.sort((a, b) => Math.abs(Math.log(a.mcap_usd) - m) - Math.abs(Math.log(b.mcap_usd) - m)).slice(0, 8);
}
function secComparables(c) {
  const { r } = c, k = K(), P = peers(r), all = [r, ...P];
  const cols = [["score", "Nota", (v) => k.scoreBadge(v)], ["mcap_usd", "Cap. ($)", (v) => k.big(v)], ["per", "PER", (v) => nf(v, 1)], ["ev_ebitda", "EV/EBITDA", (v) => nf(v, 1)],
    ["margen_op", "M. operativo", k.pct], ["crec_ventas", "Crec. ventas", k.spct], ["roe", "ROE", k.pct], ["r1a", "Rent. 1 año", k.spct], ["veredicto", "Técnico", (v) => esc(v || "—")]];
  const med = (key) => { const v = P.map((x) => x[key]).filter((z) => typeof z === "number").sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const others = k.E.cmp.filter((s) => s !== r.sym);
  return box(`Comparables · ${esc(P.some((x) => x.industria === r.industria) ? r.industria : k.sn(r.sector))}`, P.length ? `<div class="tbl-wrap"><table class="ft"><thead><tr><th>Empresa</th>${cols.map(([key, t]) => `<th${k.tip(key)}>${t}</th>`).join("")}</tr></thead><tbody>
      ${all.map((x) => `<tr ${x.sym === r.sym ? 'class="me"' : `data-sym="${esc(x.sym)}"`}><td><b>${esc(x.sym)}</b> <span class="nm">${esc((x.nombre || "").slice(0, 26))}</span></td>${cols.map(([key, , f]) => `<td class="num">${f(x[key])}</td>`).join("")}</tr>`).join("")}
      <tr class="hint"><td>Mediana de los comparables</td>${cols.map(([key, , f]) => `<td class="num">${key === "veredicto" || key === "score" ? "" : typeof med(key) === "number" ? f(med(key)) : "—"}</td>`).join("")}</tr></tbody></table></div>
      <div class="bar" style="margin-top:10px"><button class="chip" data-gocmp="${esc([r.sym, ...P.slice(0, 3).map((x) => x.sym)].join(","))}">Comparar con los 3 más parecidos →</button>${others.length ? `<button class="chip" data-gocmp="${esc([r.sym, ...others].slice(0, 4).join(","))}">Comparar con tu selección (${others.length}) →</button>` : ""}</div>
      <div class="method">Misma industria (si hay menos de 4, se completa con su sector), ordenadas por tamaño más parecido. Pulsa una fila para abrir su ficha.</div>`
    : '<div class="nodata">Sin comparables en el universo del screener.</div>', `${P.length} valores`);
}
function secInvest(c) {
  const { r, d } = c, links = [];
  if (c.sec?.cik) links.push(`<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.sec.cik}&type=10-K" target="_blank" rel="noopener">Informes en la SEC (EDGAR)</a>`);
  links.push(`<a href="https://finance.yahoo.com/quote/${encodeURIComponent(r.sym)}" target="_blank" rel="noopener">Yahoo Finance</a>`);
  if (d?.web) links.push(`<a href="${esc(d.web)}" target="_blank" rel="noopener">Web de la empresa</a>`);
  return `${readingBox(c)}<div class="fg2">${box("Tu investigación", myResearch(c))}
    ${box("Qué hace la empresa", `${d?.desc ? `<p class="fdesc">${esc(d.desc)}</p><div class="method">Descripción de Yahoo Finance (en inglés en la fuente original si no hay traducción).</div>` : '<div class="hint">La descripción llega con la próxima actualización semanal de sus fundamentales.</div>'}
      <div class="bar" style="margin-top:8px">${links.join(" · ")}</div>`)}</div>`;
}

/* ---------- página ---------- */
function render(F) {
  const k = K();
  if (!k) return `<div class="skel-wrap"><div class="skel" style="height:60px"></div><div class="skel" style="height:240px"></div></div>`;
  if (!k.E.uni) { k.ensure(); return k.E.err ? `<div class="err-box">${esc(k.E.err)}</div>` : `<div class="fp"><div class="skel" style="height:70px"></div><div class="skel" style="height:110px;margin-top:12px"></div><div class="skel" style="height:240px;margin-top:12px"></div></div>`; }
  const c = ctx(F.sym);
  if (!c) return `<div class="fp"><div class="soon-box"><h3>${esc(F.sym)}: valor no encontrado</h3>${esc(F.sym)} no está en el universo del screener (${k.E.uni.filas.length} valores). Busca otro ticker con el buscador de arriba.</div></div>`;
  if (!c.d) return `<div class="fp">${head(c)}<div class="skel" style="height:110px;margin-top:12px"></div><div class="skel" style="height:260px;margin-top:12px"></div></div>`;
  const body = { resumen: secResumen, grafico: () => `<div id="fchart" class="fchart"></div>`, fund: secFund, valoracion: secValoracion, factores: secFactores,
    resultados: secResultados, comparables: secComparables, smartm: () => (window.SCRSmart ? window.SCRSmart.persTab(F.sym) : '<div class="err-box">Módulo de smart money no disponible.</div>'), invest: secInvest }[F.tab] || secResumen;
  let html;
  try { html = body(c); } catch (e) { console.error(e); html = `<div class="err-box">No se pudo dibujar este apartado: ${esc(e.message)}</div>`; }
  return `<div class="fp" data-sec="${esc(F.tab)}">${head(c)}<div class="fp-body">${html}</div></div>`;
}
function after(F) {
  const c = ctx(F.sym); if (!c || !c.d) return;
  if (F.tab === "grafico") K().mountChart(F.sym);
  if (F.tab === "resultados") K().mountNews(F.sym);
  if (F.tab === "valoracion" && window.SCRTesis) { const el = document.getElementById("ftesis"); if (el) window.SCRTesis.mount(el, c.r, c.d, { uni: K().E.uni.filas, fact: K().E.sc?.factores?.[F.sym] }); }
}
function title(sym) { return row(sym)?.nombre || sym; }
function note(sym) {
  const c = row(sym) && ctx(sym); if (!c || !c.d) return "";
  if (c.us) { const L = c.q[c.q.length - 1]; return `<span>📅 Último ${esc(L[Q.forma] || "10-Q")} presentado a la SEC: <b>${fmtDate(L[Q.pres])}</b></span>`; }
  return `<span>Fundamentales de Yahoo Finance a <b>${fmtDate(c.r.fecha_fund)}</b> · precio al cierre del ${fmtDate(c.r.fecha_precio)}</span>`;
}
window.SCRFicha = { render, after, title, note, reading: (sym) => { const c = ctx(sym); return c && c.d ? reading(c) : null; } };
if (H.S.ficha) H.render();
})();
