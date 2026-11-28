/* Screener · Mercado › Riesgo (hoja de ruta definitiva, fases 1 y 1b): termómetro de caída para 11 bolsas con selector,
   comparativa, interpretación del termómetro y lectura conjunta adaptada a la bolsa elegida, señales con fuente y peso,
   ciclo IA desde la SEC y validación histórica. Datos: data/risk.json (scripts/fetch_risk.py). */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate, store } = H;
const R = { d: undefined, loading: false };
const DEF_SEG = ["sp500", "ndx", "sx5e", "ibex"];
const segs = () => { const D = R.d; const v = store.get("rsk_bolsas", DEF_SEG).filter((k) => D?.mercados?.[k]); return v.length ? v : (D?.orden || []).slice(0, 1); };
const plazo = () => (store.get("rsk_plazo", "12") === "3" ? "3" : "12");
const tOf = (T) => (T && plazo() === "3" && T.h3 ? { ...T, ...T.h3 } : T);
const cd = (T) => Math.round((T?.caida ?? 0.15) * 100), hz = (T) => T?.horizonte ?? 12;
const selK = () => { const D = R.d, s = segs(), k = store.get("rsk_sel", s[0]); return D?.mercados?.[k] ? k : s[0]; };

async function ensure() {
  if (R.loading || R.d !== undefined) return;
  R.loading = true;
  try { const r = await fetch(`data/risk.json?t=${Date.now()}`, { cache: "no-store" }); R.d = r.ok ? await r.json() : null; } catch { R.d = null; }
  R.loading = false;
  if (["riesgo", "hoy", "geopolitica", "escenarios"].includes(H.S.view) || H.S.ficha) H.render();
}
const X = () => H.S.mode === "x";
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fm = (m) => (m ? `${MES[+m.slice(5, 7) - 1]}-${m.slice(2, 4)}` : "—");
const fd = (iso) => (iso ? (iso.length <= 7 ? fm(iso) : `${+iso.slice(8, 10)}-${MES[+iso.slice(5, 7) - 1]}-${iso.slice(2, 4)}`) : "—");
const pc = (v, d = 0) => (v == null ? "—" : `${nf(v, d)} %`);
const exp = (t) => `<div class="rsk-exp">${t}</div>`;   /* R1: siempre presente; ui.js lo pliega (abierto en Explicado) */
const VEL = { lenta: ["Lenta · valoración", "predice la rentabilidad de años, no el momento de la caída"], media: ["Media · crédito y ciclo", "la de más evidencia histórica, de 3 a 12 meses vista"], rapida: ["Rápida · mercado", "confirma el estrés más que anticiparlo"] };
const UNIT = { cape: ["", 1], cap_pib: [" %", 0], ebp: [" pp", 2], ebp_6m: [" pp", 2], baa: [" pp", 2], hy: [" pp", 2], ciss: ["", 3], prima_es: [" pb", 0], prima_it: [" pb", 0], margen: [" %", 2], curva: [" pp", 2], sahm: [" pp", 2], vix: ["", 1], nfci: ["", 2], tendencia: [" %", 1], vol_idx: [" %", 1] };
const DEF = {
  cape: "Precio del S&P 500 dividido entre el beneficio medio de 10 años, ajustado por inflación. Alto = bolsa cara frente a su historia.",
  cap_pib: "Valor en bolsa de las empresas de EE. UU. frente al tamaño de su economía (el «indicador Buffett»).",
  ebp: "Lo que los inversores cobran de más por prestar a empresas por encima de su riesgo de quiebra. Cuando sube, el crédito se encarece: es la señal con más evidencia académica.",
  baa: "Diferencia entre lo que paga un bono corporativo de calidad media (Baa) y el bono del Tesoro a 10 años.",
  hy: "Diferencial de los bonos de alto rendimiento. Solo como lectura: FRED publica pocos años de historia.",
  ciss: "Indicador del BCE que combina tensiones en bolsa, bonos, divisas, bancos y dinero en la zona euro.",
  prima_es: "Diferencia entre el bono español a 10 años y el alemán. Sube cuando se teme por España o por el euro.",
  prima_it: "Diferencia entre el bono italiano a 10 años y el alemán. Termómetro clásico de las crisis del euro.",
  ebp_6m: "Cuánto ha subido o bajado el EBP en 6 meses: el crédito que se encarece rápido avisa antes que su nivel.",
  tendencia: "Distancia del índice a su media de 200 sesiones. Por debajo de la media, la tendencia es bajista y las caídas grandes son más frecuentes.",
  vol_idx: "Volatilidad realizada del índice en los últimos 3 meses, anualizada.",
  margen: "Dinero prestado por los brókeres para comprar acciones, frente al valor de la bolsa. Alto = más apalancamiento.",
  curva: "Bono a 10 años menos letra a 3 meses. Cuando se invierte (negativa) ha precedido a las recesiones de EE. UU.",
  sahm: "Subida del paro (media de 3 meses) frente a su mínimo del último año. Por encima de 0,5 suele indicar recesión.",
  vix: "Volatilidad que el mercado de opciones espera para el S&P 500 en los próximos 30 días.",
  nfci: "Índice de condiciones financieras de la Fed de Chicago. Por encima de 0, más tensas que la media.",
};
const FASES = [["Expansión", "capex y caja suben"], ["Euforia", "capex +25 % y la caja aún sube"], ["Digestión", "capex sube, la caja libre cae"], ["Contracción", "recortes de capex"]];
const FASE_TXT = {
  "Expansión": "Las grandes tecnológicas invierten más y su caja también crece: el gasto se paga solo.",
  "Euforia": "La inversión se acelera por encima del 25 % anual y la caja todavía acompaña: es la fase de valoraciones récord.",
  "Digestión": "Siguen aumentando la inversión, pero el flujo de caja libre cae: ya no lo pagan solo con su caja y dependen más de la financiación. Es la fase en la que el mercado pasa de premiar el gasto a exigir retorno (como las telecos en 2000-01).",
  "Contracción": "Recortan la inversión: menos pedidos para chips, centros de datos y energía.",
};

/* ---------- gráficos ---------- */
function gauge(p, lo, hi, base, tA, ok) {
  const W = 260, cx = 130, cy = 118, r = 96, max = Math.max(60, Math.ceil((hi || p || 0) / 10) * 10 + 10);
  const ang = (v) => Math.PI * (1 - Math.min(v, max) / max);
  const pt = (v, rr) => [cx + rr * Math.cos(ang(v)), cy - rr * Math.sin(ang(v))];
  const arc = (a, b, col, w = 12, rr = r, op = 1) => { const p0 = [cx + rr * Math.cos(ang(a)), cy - rr * Math.sin(ang(a))], p1 = [cx + rr * Math.cos(ang(b)), cy - rr * Math.sin(ang(b))]; return `<path d="M${p0[0].toFixed(1)},${p0[1].toFixed(1)} A${rr},${rr} 0 0 1 ${p1[0].toFixed(1)},${p1[1].toFixed(1)}" style="stroke:${col};stroke-width:${w};fill:none;stroke-linecap:butt" opacity="${op}"/>`; };
  let s = arc(0, base, "var(--pos)") + arc(base, tA, "var(--warn)") + arc(tA, max, "var(--neg)");
  if (lo != null && hi != null) s += arc(lo, hi, "var(--text)", 3, r + 12, 0.6);
  const [nx, ny] = pt(p, r - 20);
  s += `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${ok ? "var(--text)" : "var(--faint)"}" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="4" fill="var(--text)"/>`;
  for (const v of [0, max]) { const [x, y] = pt(v, r + 22); s += `<text x="${x.toFixed(0)}" y="${(y + 4).toFixed(0)}" font-size="10" fill="var(--faint)" text-anchor="middle">${v}</text>`; }
  return `<svg viewBox="0 0 ${W} 132" class="rsk-gauge" role="img" aria-label="Termómetro ${nf(p, 0)} %">${s}</svg>`;
}

function probChart(T) {
  const h = T.hist, W = 900, H = 230, L = 44, Rr = 10, Tp = 10, B = 22;
  const months = h.map((x) => x[0]);
  const m0 = months[0], m1 = months[months.length - 1];
  const idx = (m) => (+m.slice(0, 4) - +m0.slice(0, 4)) * 12 + (+m.slice(5, 7) - +m0.slice(5, 7));
  const n = idx(m1) || 1;
  const xs = (m) => L + (idx(m) / n) * (W - L - Rr);
  const top = Math.max(60, Math.ceil(Math.max(...h.map((x) => x[3] ?? x[1])) / 10) * 10);
  const ys = (v) => Tp + (1 - v / top) * (H - Tp - B);
  let s = "";
  for (const [a, b] of T.caidas.map((c) => [c[0], c[1]]).filter((c) => c[1] >= m0)) {
    const x0 = xs(a < m0 ? m0 : a), x1 = xs(b > m1 ? m1 : b);
    s += `<rect x="${x0.toFixed(1)}" y="${Tp}" width="${Math.max(2, x1 - x0).toFixed(1)}" height="${H - Tp - B}" fill="var(--neg)" opacity=".13"><title>Caída real de ${esc(T.nombre)}: ${fm(a)} → ${fm(b)}</title></rect>`;
  }
  for (let v = 0; v <= top; v += 20) s += `<text x="${L - 6}" y="${(ys(v) + 3.5).toFixed(1)}" font-size="10" fill="var(--faint)" text-anchor="end">${v} %</text>`;
  const hl = (v, col, t) => `<line x1="${L}" x2="${W - Rr}" y1="${ys(v).toFixed(1)}" y2="${ys(v).toFixed(1)}" stroke="${col}" stroke-dasharray="3 3"/><text x="${L + 4}" y="${(ys(v) - 4).toFixed(1)}" font-size="10" fill="${col}">${t}</text>`;
  s += hl(T.actual.base, "var(--faint)", `base ${nf(T.actual.base, 0)} %`) + hl(T.umbrales.alerta, "var(--warn)", `alerta ${nf(T.umbrales.alerta, 0)} %`);
  const band = h.filter((x) => x[2] != null && x[3] != null);
  if (band.length > 2) {
    const up = band.map((x) => `${xs(x[0]).toFixed(1)},${ys(x[3]).toFixed(1)}`), dn = band.slice().reverse().map((x) => `${xs(x[0]).toFixed(1)},${ys(x[2]).toFixed(1)}`);
    s += `<polygon points="${up.concat(dn).join(" ")}" fill="var(--accent)" opacity=".10"/>`;
  }
  const pts = h.map((x) => `${xs(x[0]).toFixed(1)},${ys(x[1]).toFixed(1)}`).join(" ");
  s += `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>`;
  for (let y = +m0.slice(0, 4) + 1; y <= +m1.slice(0, 4); y += 3) s += `<text x="${xs(`${y}-01`).toFixed(1)}" y="${H - 6}" font-size="10" fill="var(--faint)" text-anchor="middle">${y}</text>`;
  s += `<line x1="${L}" x2="${W - Rr}" y1="${H - B}" y2="${H - B}" stroke="var(--border-strong)"/>`;
  const last = h[h.length - 1];
  s += `<circle cx="${xs(last[0]).toFixed(1)}" cy="${ys(last[1]).toFixed(1)}" r="3.5" fill="var(--accent)"/>`;
  /* índice debajo, escala logarítmica */
  const ib = T.indice.filter((x) => x[0] >= m0), H2 = 110, T2 = 6, B2 = 6;
  const lv = ib.map((x) => Math.log(x[1])), mn = Math.min(...lv), mx = Math.max(...lv);
  const y2 = (v) => T2 + (1 - (Math.log(v) - mn) / (mx - mn || 1)) * (H2 - T2 - B2);
  let s2 = "";
  for (const [a, b] of T.caidas.filter((c) => c[1] >= m0)) { const x0 = xs(a < m0 ? m0 : a), x1 = xs(b > m1 ? m1 : b); s2 += `<rect x="${x0.toFixed(1)}" y="${T2}" width="${Math.max(2, x1 - x0).toFixed(1)}" height="${H2 - T2 - B2}" fill="var(--neg)" opacity=".13"/>`; }
  s2 += `<polyline points="${ib.map((x) => `${xs(x[0]).toFixed(1)},${y2(x[1]).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--good)" stroke-width="1.2"/>`;
  for (const v of [Math.exp(mn), Math.exp(mx)]) s2 += `<text x="${L - 6}" y="${(y2(v) + 3.5).toFixed(1)}" font-size="10" fill="var(--faint)" text-anchor="end">${nf(v, 0)}</text>`;
  s2 += `<text x="${L + 4}" y="${T2 + 10}" font-size="10" fill="var(--good)">${esc(T.nombre)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="rsk-chart" role="img" aria-label="Probabilidad histórica">${s}</svg><svg viewBox="0 0 ${W} ${H2}" class="rsk-chart" role="img" aria-label="${esc(T.nombre)}">${s2}</svg>`;
}

function iaChart(I) {
  const t = I.trimestres.slice(-8), W = 420, Hh = 180, L = 34, B = 22, Tp = 8;
  const vals = t.flatMap((x) => [x.capex, x.fcf]);
  const mx = Math.max(...vals, 1), mn = Math.min(0, ...vals);
  const y = (v) => Tp + (1 - (v - mn) / (mx - mn)) * (Hh - Tp - B);
  const gw = (W - L - 6) / t.length;
  let s = `<line x1="${L}" x2="${W - 6}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--border-strong)"/>`;
  for (const v of [0, mx / 2, mx]) s += `<text x="${L - 5}" y="${(y(v) + 3.5).toFixed(1)}" font-size="10" fill="var(--faint)" text-anchor="end">${nf(v, 0)}</text>`;
  t.forEach((q, i) => {
    const x0 = L + i * gw, bw = gw * 0.34;
    for (const [v, col, k] of [[q.capex, "var(--accent)", 0], [q.fcf, "var(--good)", 1]]) {
      s += `<rect x="${(x0 + gw * 0.14 + k * (bw + 2)).toFixed(1)}" y="${Math.min(y(v), y(0)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(y(v) - y(0)).toFixed(1)}" fill="${col}"><title>${q.etq}: ${k ? "flujo de caja libre" : "capex"} ${nf(v, 1)} mil M$</title></rect>`;
    }
    s += `<text x="${(x0 + gw / 2).toFixed(1)}" y="${Hh - 6}" font-size="10" fill="var(--faint)" text-anchor="middle">${q.etq}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${Hh}" class="rsk-chart" role="img" aria-label="Capex y flujo de caja libre">${s}</svg>`;
}

/* ---------- bloques ---------- */
function thermoBox(T) {
  const a = T.actual, P = T.precision, ok = a.validado;
  const reg = a.regimen, cls = reg === "Alerta" ? "ko" : reg === "Tensión" ? "te" : "ok";
  const head = ok
    ? `<div class="rsk-big num">${nf(a.p, 0)} %</div><div class="rsk-sub">intervalo 90 %: ${a.lo != null ? `${nf(a.lo, 0)}-${nf(a.hi, 0)} %` : "—"} · base ${nf(a.base, 0)} %</div><div class="rsk-reg">${H.ui.pill(reg, true)}</div>`
    : `<div class="rsk-big num rsk-mute">${nf(a.p, 0)} %</div><div class="rsk-sub">base ${nf(a.base, 0)} % · el modelo no demuestra ventaja</div><div class="rsk-reg">${H.ui.pill(reg, false)}</div>`;
  const falsas = P.falsas?.length ? `<span data-tip="Años: ${esc(P.falsas.join(", "))}">${P.falsas.length}</span>` : "0";
  const lect = H.ui.lectura(T.lectura?.termometro);
  return `<section class="rsk-p"><h3>Termómetro · ${esc(T.nombre)}</h3>${gauge(a.p, a.lo, a.hi, a.base, T.umbrales.alerta, ok)}${head}${lect}
    <h3 class="rsk-h2">Precisión <span>${P.examen ? `examen ${(P.examen_desde || "").slice(0, 4)}-${(a.mes || "").slice(0, 4)}` : `fuera de muestra desde ${fm(P.desde)}`}</span></h3>
    <table class="rsk-kv"><tr><td>Intervalo del 90 %</td><td class="num">${a.lo != null ? `${nf(a.lo, 0)}-${nf(a.hi, 0)} %` : "—"}</td></tr>
      ${P.examen ? `<tr><td>Examen: mejora frente a la media</td><td class="num ${P.examen.skill >= 3 ? "pos" : ""}">${sgn(P.examen.skill, 1)} %</td></tr>
      <tr><td>Examen: error de calibración</td><td class="num">${nf(P.examen.ece, 1)} pp</td></tr>
      <tr><td>Examen: meses · meses con caída</td><td class="num">${P.examen.meses} · ${P.examen.eventos}</td></tr>
      ${P.diseno ? `<tr><td>Diseño ${(P.desde || "").slice(0, 4)}-2015: mejora</td><td class="num rsk-fa">${sgn(P.diseno.skill, 1)} %</td></tr>` : ""}`
      : `<tr><td>Examen</td><td class="num rsk-fa">sin meses suficientes</td></tr>`}
      <tr><td>Caídas &gt;${cd(T)} % desde ${(P.desde || "").slice(0, 4)}</td><td class="num">${P.caidas ?? "—"}</td></tr>
      <tr><td>Avisadas (1-${hz(T)} meses antes)</td><td class="num">${P.avisadas ?? "—"} de ${P.caidas ?? "—"}${P.antelacion != null ? ` · ${nf(P.antelacion, 0)} m` : ""}</td></tr>
      <tr><td>Falsas alarmas</td><td class="num">${falsas}</td></tr></table>
    <div class="rsk-verdict ${ok ? "ok" : "nu"}">${ok ? "Validado: " : "Sin ventaja demostrada: "}${esc(a.motivo)}.</div>
    ${exp(`<b>Cómo de preciso es.</b> Desde ${(T.indice[0]?.[0] || "").slice(0, 4)} el ${esc(T.nombre)} ha tenido ${P.caidas_total} caídas de más del ${cd(T)} %: es una muestra pequeña, por eso el intervalo es ancho. El número sirve para comparar el riesgo de hoy con su media (${nf(a.base, 0)} %), no como certeza. <b>Examen</b>: el modelo se evalúa una sola vez con las previsiones desde ${(P.examen_desde || "2016").slice(0, 4)}, que no se usaron para diseñarlo; solo se da por validado si ahí mejora a la media al menos un 3 % y está calibrado (cuando dice 30 %, pasa más o menos 3 de cada 10 veces). El modelo por bolsa se eligió después de ver que el modelo conjunto suspendía este examen.`)}</section>`;
}

function signalsBox(T, D) {
  const S = T.senales;
  let rows = "";
  for (const v of ["lenta", "media", "rapida"]) {
    const g = S.filter((s) => s.vel === v);
    const extra = [];
    if (v === "lenta" && D.concentracion) extra.push(`<tr><td>Peso de los 10 mayores del S&amp;P 500<div class="rsk-src">Cálculo propio con el universo · ${D.concentracion.n} valores</div></td><td class="num">${nf(D.concentracion.top10, 1)} %</td><td class="rsk-fa" colspan="2">solo lectura · sin historia larga · ${fd(D.concentracion.fecha)}</td><td class="num rsk-fa">fuera</td></tr>`);
    if (v === "rapida" && D.amplitud) for (const [reg, a] of Object.entries(D.amplitud)) extra.push(`<tr><td>Amplitud ${esc(reg)}: % sobre media de 200<div class="rsk-src">Cálculo propio con el universo</div></td><td class="num">${pc(a.valor, 0)}</td><td>${a.pct != null ? bar(100 - a.pct) : ""}<span class="rsk-fa">percentil 1 año ${a.pct ?? "—"}</span></td><td class="rsk-fa">solo lectura · ${fd(a.fecha)}</td><td class="num rsk-fa">fuera</td></tr>`);
    if (!g.length && !extra.length) continue;
    rows += `<tr class="rsk-grp"><td colspan="5">${VEL[v][0]} <span>· ${VEL[v][1]}</span></td></tr>`;
    for (const s of g) {
      const [u, d] = UNIT[s.k] || ["", 2];
      rows += `<tr><td><span data-tip="${esc(DEF[s.k] || "")}">${esc(s.nombre)}</span><div class="rsk-src"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.fuente)}</a> · ${esc(s.frec)} · ${fd(s.ultimo.fecha)} · desde ${s.desde.slice(0, 4)}</div>${X() && DEF[s.k] ? `<div class="rsk-def">${esc(DEF[s.k])}</div>` : ""}</td>
        <td class="num">${nf(s.ultimo.valor, d)}${u}</td>
        <td>${s.pct != null ? bar(s.pct) : ""}<span class="rsk-fa">${s.pct != null ? `percentil ${s.pct}` : "sin historia"}</span></td>
        <td class="rsk-lect ${s.pct >= 70 ? "warn" : s.pct != null && s.pct < 30 ? "pos" : ""}">${esc(s.lectura)}</td>
        <td class="num">${s.modelo ? `${nf(s.peso, 0)} %` : '<span class="rsk-fa" data-tip="No entra en el modelo: historia corta">fuera</span>'}</td></tr>`;
    }
    rows += extra.join("");
  }
  const wv = (v) => S.filter((s) => s.vel === v && s.modelo).reduce((a, s) => a + (s.peso || 0), 0);
  return `<section class="rsk-p"><h3>Señales, fuentes y peso en el termómetro <span>percentil «a fecha» frente a su historia · más alto = más riesgo</span></h3>
    <div class="rsk-scroll"><table class="rsk-t"><thead><tr><th>Señal · fuente · último dato</th><th class="num">Valor</th><th>Nivel de riesgo</th><th>Lectura</th><th class="num">Peso</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="method">Pesos de hoy: lenta ${nf(wv("lenta"), 0)} % · media ${nf(wv("media"), 0)} % · rápida ${nf(wv("rapida"), 0)} %. El peso es la importancia de cada señal en el modelo (coeficiente × dispersión), no una opinión.</div></section>`;
}
const bar = (p) => `<div class="rsk-bar"><i style="width:${Math.max(2, Math.min(100, p))}%;background:${p >= 85 ? "var(--neg)" : p >= 70 ? "var(--warn)" : p < 30 ? "var(--pos)" : "var(--muted)"}"></i></div>`;

function iaBox(I, C) {
  if (!I) return `<section class="rsk-p"><h3>Ciclo IA · hiperescaladores</h3><div class="hint">Sin datos de la SEC en esta actualización.</div></section>`;
  const g = (v) => (v == null ? "—" : `<span class="chg ${v > 0 ? "p" : "n"}">${sgn(v, 0)} %</span>`);
  return `<section class="rsk-p"><h3>Ciclo IA · hiperescaladores <span>miles de M$ por trimestre · ${esc(I.empresas.join(", "))}</span></h3>${iaChart(I)}
    <div class="rsk-leg"><span><i style="background:var(--accent)"></i>Inversión (capex)</span><span><i style="background:var(--good)"></i>Flujo de caja libre</span></div>
    <table class="rsk-kv"><tr><td>Capex 12 meses</td><td class="num">${nf(I.capex_12m, 0)} mil M$ · ${g(I.g_capex)}</td></tr>
      <tr><td>Flujo de caja libre 12 meses</td><td class="num">${nf(I.fcf_12m, 0)} mil M$ · ${g(I.g_fcf)}</td></tr>
      <tr><td>Capex / flujo de caja operativo</td><td class="num">${nf(I.capex_cfo, 0)} %</td></tr>
      <tr><td>Deuda financiera</td><td class="num">${nf(I.deuda, 0)} mil M$ · ${sgn(I.deuda_12m, 0)} en 12 m</td></tr>
      ${C ? `<tr><td>Peso del bloque IA en el S&amp;P 500</td><td class="num" data-tip="Nvidia, Microsoft, Alphabet, Amazon y Meta">${nf(C.ia, 1)} %</td></tr>` : ""}</table>
    <div class="rsk-fases">${FASES.map(([f, d]) => `<div class="${f === I.fase ? "on" : ""}"><b>${f}</b><span>${d}</span></div>`).join("")}</div>
    ${I.fase ? `<div class="rsk-exp ui-keep" style="display:block"><b>${esc(I.fase)}</b> (${esc(I.trimestre)}): ${esc(FASE_TXT[I.fase])}</div>` : ""}
    ${exp(`<b>Reglas.</b> ${esc(I.reglas)}`)}
    <div class="rsk-src">${esc(I.fuente)}</div></section>`;
}

function trackBox(T) {
  const rows = T.senales.filter((s) => s.modelo && s.historial && s.historial.n).sort((a, b) => b.historial.avisadas / b.historial.n - a.historial.avisadas / a.historial.n);
  const P = T.precision;
  const r = (n, h, b = false) => `<tr${b ? ' class="rsk-b"' : ""}><td>${n}</td><td class="num ${h.avisadas / h.n >= 0.6 ? "pos" : "warn"}">${h.avisadas} de ${h.n}</td><td class="num">${h.antelacion != null ? `${nf(h.antelacion, 0)} m` : "—"}</td><td class="num">${h.falsas ?? "—"}</td></tr>`;
  return `<section class="rsk-p"><h3>¿Ha funcionado antes? <span>caídas &gt;${cd(T)} % del ${esc(T.nombre)}</span></h3>
    <div class="rsk-scroll"><table class="rsk-t"><thead><tr><th>Señal</th><th class="num">Avisadas</th><th class="num">Antel.</th><th class="num">Falsas</th></tr></thead><tbody>
    ${rows.map((s) => r(esc(s.nombre), s.historial)).join("")}
    ${P.caidas ? r(`Termómetro &gt; ${nf(T.umbrales.alerta, 0)} %`, { avisos: null, avisadas: P.avisadas, n: P.caidas, antelacion: P.antelacion, falsas: P.falsas?.length }, true) : ""}</tbody></table></div>
    <div class="method">Aviso = la señal en su 20 % más alto de la historia (o el termómetro sobre el umbral) entre ${hz(T)} y 1 meses antes del máximo previo a la caída. Antelación: mediana en meses. Falsa alarma: tramo de aviso sin caída en los 12 meses siguientes.</div></section>`;
}

function spark(T) {
  const h = T.hist.slice(-60), W = 120, Hh = 26;
  if (h.length < 2) return "";
  const mx = Math.max(...h.map((x) => x[1]), T.actual.base) * 1.05;
  const pts = h.map((x, i) => `${(i / (h.length - 1) * W).toFixed(1)},${(Hh - (x[1] / mx) * Hh).toFixed(1)}`).join(" ");
  const yb = (Hh - (T.actual.base / mx) * Hh).toFixed(1);
  return `<svg viewBox="0 0 ${W} ${Hh}" class="rsk-spark" aria-hidden="true"><line x1="0" x2="${W}" y1="${yb}" y2="${yb}" stroke="var(--faint)" stroke-dasharray="2 2"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.3"/></svg>`;
}
const pillOf = (a) => H.ui.pill(a.regimen, a.validado);

function marketsBox(D) {
  const S = segs(), sel = selK();
  const chips = (D.orden || []).map((k) => `<button class="rsk-chip${S.includes(k) ? " on" : ""}" data-rskseg="${k}" aria-pressed="${S.includes(k)}">${esc(D.mercados[k].nombre)}</button>`).join("");
  const rows = S.map((k) => {
    const T = tOf(D.mercados[k]), a = T.actual, P = T.precision;
    return `<tr class="${k === sel ? "sel" : ""}" data-rsksel="${k}" tabindex="0"><td><b>${esc(T.nombre)}</b></td><td class="num">${nf(a.p, 0)} %</td><td class="num rsk-fa">${a.lo != null ? `${nf(a.lo, 0)}-${nf(a.hi, 0)} %` : "—"}</td><td class="num">${nf(a.base, 0)} %</td>
      <td>${pillOf(a)}</td><td class="num ${P.examen?.skill >= 3 ? "pos" : "rsk-fa"}">${P.examen ? `${sgn(P.examen.skill, 1)} %` : "—"}</td><td class="num">${P.caidas ? `${P.avisadas} de ${P.caidas}` : "—"}</td><td>${spark(T)}</td></tr>`;
  }).join("");
  const pz = `<div class="rsk-plazo"><span>Plazo</span>${[["12", "12 meses · caída >15 %"], ["3", "3 meses · caída >10 %"]].map(([v, l]) => `<button class="rsk-chip${plazo() === v ? " on" : ""}" data-rskplazo="${v}" aria-pressed="${plazo() === v}">${l}</button>`).join("")}</div>`;
  return `<section class="rsk-p rsk-mk"><h3>Bolsas <span>elige las que quieres seguir · pulsa una fila para ver su detalle</span></h3>${pz}<div class="rsk-chips">${chips}</div>
    <div class="rsk-scroll"><table class="rsk-t rsk-cmp"><thead><tr><th>Bolsa</th><th class="num">Prob. caída &gt;${plazo() === "3" ? "10 % · 3 m" : "15 % · 12 m"}</th><th class="num">Intervalo 90 %</th><th class="num">Media histórica</th><th>Régimen</th><th class="num">Examen: mejora</th><th class="num">Caídas avisadas</th><th>5 años</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${exp("<b>Cómo comparar.</b> Cada bolsa tiene su propia media histórica: en unas las caídas grandes son mucho más frecuentes que en otras. Por eso importa más la cifra frente a su media que la cifra sola. «Sin ventaja» significa que en esa bolsa el modelo no mejora a la media fuera de muestra.")}</section>`;
}

function readingBox(T) {
  return T.lectura?.conjunta ? `<div class="rsk-read">${H.ui.conjunta(T.lectura.conjunta, T.nombre)}</div>` : "";
}

function render() {
  ensure();
  if (R.d === undefined) return `<div class="skel" style="height:420px"></div>`;
  const D = R.d;
  if (!D?.mercados || !Object.keys(D.mercados).length) return `<div class="pg-head"><h1>Riesgo de mercado</h1></div><div class="box">Todavía no hay datos del termómetro: se generan en la próxima actualización automática.</div>`;
  const T = tOf(D.mercados[selK()]);
  const nfu = new Set(T.senales.map((s) => s.fuente.split(/[,(·]/)[0].trim())).size;
  return `<div class="pg-head"><h1>Riesgo de mercado</h1><div class="pg-sub">Probabilidad de que cada bolsa caiga más de un ${plazo() === "3" ? "10 % en algún momento de los próximos 3 meses" : "15 % en algún momento de los próximos 12 meses"} · datos del ${fmtDate(D.generado.slice(0, 10))} · ${Object.keys(D.mercados).length} bolsas · ${nfu} fuentes${D.errores?.length ? ` · <span class="stale-txt" data-tip="${esc(D.errores.map((e) => `${e.serie}: ${e.motivo}`).join(" · "))}">${D.errores.length} aviso(s) de fuentes</span>` : ""}</div></div>
    ${marketsBox(D)}
    <div class="rsk-top">${thermoBox(T)}
      <div class="rsk-col"><section class="rsk-p"><h3>Probabilidad de caída &gt;${cd(T)} % en ${hz(T)} meses · ${esc(T.nombre)} <span>banda: intervalo del 90 % · sombreado: caídas reales</span></h3>${probChart(T)}
        ${exp(`<b>Cómo se calcula.</b> ${esc(T.metodo)} Cada punto de la línea es la previsión que se habría hecho ese mes con lo que se sabía entonces.`)}</section>${trackBox(T)}</div></div>
    <div class="rsk-bot">${signalsBox(T, D)}<div class="rsk-col">${iaBox(D.ia, D.concentracion)}</div></div>
    ${readingBox(T)}`;
}

function onClick(t) {
  let b;
  if ((b = t.closest("[data-rskseg]"))) {
    const k = b.dataset.rskseg, cur = segs();
    const nx = cur.includes(k) ? cur.filter((x) => x !== k) : (R.d.orden || []).filter((x) => x === k || cur.includes(x));
    if (!nx.length) return true;
    store.set("rsk_bolsas", nx);
    if (!cur.includes(k)) store.set("rsk_sel", k); else if (selK() === k) store.set("rsk_sel", nx[0]);
    H.render(); return true;
  }
  if ((b = t.closest("[data-rskplazo]"))) { store.set("rsk_plazo", b.dataset.rskplazo); H.render(); return true; }
  if ((b = t.closest("[data-rsksel]"))) { store.set("rsk_sel", b.dataset.rsksel); if (b.dataset.sub) return false; H.render(); return true; }
  return false;
}

/* franja para «Hoy» */
function strip() {
  ensure();
  const D = R.d;
  if (!D?.mercados || !Object.keys(D.mercados).length) return "";
  const S = segs().slice(0, 4), any = D.mercados[S[0]];
  const ebp = any.senales.find((s) => s.k === "ebp"), vix = any.senales.find((s) => s.k === "vix"), I = D.ia;
  const it = S.map((k) => { const T = tOf(D.mercados[k]), a = T.actual; return `<div class="rsk-sm" data-sub="riesgo" data-rsksel="${k}"><span>${esc(T.nombre)}</span><b class="num">${nf(a.p, 0)} %</b><small>${pillOf(a)} <span class="num">media ${nf(a.base, 0)} %</span></small></div>`; });
  if (ebp) it.push(`<div><span>Crédito (EBP)</span><b class="num">${nf(ebp.ultimo.valor, 2)}</b><small class="num">percentil ${ebp.pct ?? "—"}</small></div>`);
  if (I?.fase) it.push(`<div><span>Ciclo IA</span><b class="${I.fase === "Digestión" || I.fase === "Contracción" ? "warn" : ""}">${esc(I.fase)}</b><small>${esc(I.trimestre)}</small></div>`);
  if (vix) it.push(`<div><span>VIX</span><b class="num">${nf(vix.ultimo.valor, 1)}</b><small class="num">percentil ${vix.pct ?? "—"}</small></div>`);
  const G = window.SCRGeo?.data?.();
  if (G?.global?.pct != null) it.push(`<div class="rsk-sm" data-sub="geopolitica"><span>Geopolítica (GPR)</span><b class="num">p${nf(G.global.pct, 0)}</b><small>diario p${nf(G.global.pct7, 0)} · ${G.global.tendencia === "baja" ? "bajando" : G.global.tendencia === "sube" ? "subiendo" : esc(G.global.tendencia || "")}</small></div>`);
  else window.SCRGeo?.ensure?.();
  const gl = true ? `<div class="rsk-exp hoy-gl"><b>Cómo leer esta franja.</b> Para cada bolsa que sigues: probabilidad estimada de que caiga más de un ${plazo() === "3" ? "10 % en algún momento de los próximos 3 meses" : "15 % en algún momento de los próximos 12 meses"} (el plazo se elige en Contexto › Riesgo), comparada con su media histórica, y su régimen (normal, tensión o alerta; «sin ventaja» si el modelo no mejora a la media en esa bolsa). Las bolsas se eligen en Mercado › Riesgo. <b>Crédito (EBP)</b>: lo que se cobra de más por prestar a empresas por encima de su riesgo de quiebra; cuando sube, el crédito se encarece y suele anticipar caídas. <b>Ciclo IA</b>: ${I?.fase ? esc(FASE_TXT[I.fase]) : "fase de la inversión en IA de las grandes tecnológicas."} <b>VIX</b>: volatilidad esperada del S&amp;P 500. <b>Geopolítica</b>: percentil del índice de riesgo geopolítico frente a su historia desde 1985 (mensual y media de 7 días).</div>` : "";
  return `<div class="rsk-strip">${it.join("")}<button class="link-btn" data-sub="riesgo">Ver Riesgo →</button></div>${gl}`;
}

H.modules.riesgo = render;
H.handlers.unshift(onClick);
/* R1 · cabecera común «estado del riesgo» para Geopolítica y Escenarios (y la franja de «Hoy») */
function estado() { const h = strip(); return h ? `<div class="ui-estado"><div class="ui-estado-t">Estado del riesgo</div>${h}</div>` : ""; }
window.SCRRisk = { ensure, strip, estado, data: () => R.d, followed: segs, tOf, plazo };
})();
