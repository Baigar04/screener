/* Screener · Probabilidad de acierto (hoja de ruta definitiva, fase 5).
   Datos: data/prob.json (scripts/fetch_prob.py). Probabilidad de que el valor bata a su propio índice con dividendos en 12 meses,
   con intervalo, tasa base, aportación de cada factor, reparto de resultados de previsiones parecidas en el examen y gráfico
   de fiabilidad. Solo se presenta como «validada» en los mercados que superan el examen único desde 2016. */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn } = H;
const R = { d: undefined, loading: false };
async function ensure() {
  if (R.loading || R.d !== undefined) return;
  R.loading = true;
  try { const r = await fetch(`data/prob.json?t=${Date.now()}`, { cache: "no-store" }); R.d = r.ok ? await r.json() : null; } catch { R.d = null; }
  R.loading = false;
  if (H.S.ficha || H.S.view === "hoy") H.render();
}
const X = () => H.S.mode === "x";
const exp = (t) => (X() ? `<div class="rsk-exp">${t}</div>` : "");
const of = (sym) => {
  const v = R.d?.valores?.[sym]; if (!v) return null;
  const [p, lo, hi, c, dec, mk] = v, M = R.d.mercados?.[mk];
  return { p, lo, hi, c, dec, mk, M, ok: !!M?.examen?.validado };
};

/* columna de «Hoy» */
function cell(sym) {
  if (R.d === undefined) { ensure(); return null; }
  const x = of(sym); if (!x) return null;
  const tip = x.ok ? `Probabilidad de batir a ${x.M.nombre} en 12 meses (intervalo ${nf(x.lo, 0)}–${nf(x.hi, 0)} %; tasa base ${nf(x.M.base_hoy, 0)} %). Validada en el examen.`
    : `Sin ventaja demostrada en ${x.M?.nombre || "su mercado"}: usa la tasa base (${nf(x.M?.base_hoy, 0)} %). El modelo da ${nf(x.p, 0)} %.`;
  return `<span class="pb-cell ${x.ok ? (x.p >= (x.M.base_hoy || 50) ? "up" : "dn") : "nv"}" data-tip="${esc(tip)}">${nf(x.ok ? x.p : x.M?.base_hoy, 0)} %${x.ok ? "" : "<small>base</small>"}</span>`;
}

/* gráficos */
function gauge(x) {
  const W = 260, Hh = 150, cx = 130, cy = 132, r = 104;
  const ang = (v) => Math.PI * (1 - v / 100), pt = (v, rr = r) => [cx + rr * Math.cos(ang(v)), cy - rr * Math.sin(ang(v))];
  const arc = (a, b, rr, col, w) => { const [x1, y1] = pt(a, rr), [x2, y2] = pt(b, rr); return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${rr} ${rr} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" style="stroke:${col};stroke-width:${w}px;stroke-linecap:butt"/>`; };
  const base = x.M.base_hoy ?? 50, [bx1, by1] = pt(base, r - 14), [bx2, by2] = pt(base, r + 14), [nx, ny] = pt(x.p, r - 22);
  return `<svg viewBox="0 0 ${W} ${Hh}" class="pb-gauge" role="img" aria-label="Probabilidad ${nf(x.p, 0)} %">
    ${arc(0, 100, r, "var(--line)", 14)}${arc(Math.max(0, x.lo), Math.min(100, x.hi), r, x.ok ? "color-mix(in srgb,var(--accent) 45%,transparent)" : "color-mix(in srgb,var(--faint) 40%,transparent)", 14)}
    <line x1="${bx1.toFixed(1)}" y1="${by1.toFixed(1)}" x2="${bx2.toFixed(1)}" y2="${by2.toFixed(1)}" style="stroke:var(--text);stroke-width:2px"/>
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" style="stroke:${x.ok ? "var(--accent)" : "var(--faint)"};stroke-width:3px"/><circle cx="${cx}" cy="${cy}" r="5" style="fill:${x.ok ? "var(--accent)" : "var(--faint)"}"/>
    <text x="${cx}" y="${cy - 34}" text-anchor="middle" font-size="34" font-family="var(--mono)" fill="${x.ok ? "var(--text)" : "var(--muted)"}">${nf(x.p, 0)} %</text>
    <text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="11" fill="var(--muted)">90 %: ${nf(x.lo, 0)}–${nf(x.hi, 0)} %</text>
    <text x="14" y="${Hh - 2}" font-size="10" fill="var(--faint)">0</text><text x="${W - 22}" y="${Hh - 2}" font-size="10" fill="var(--faint)">100</text>
    <text x="${bx2.toFixed(1)}" y="${(by2 - 4).toFixed(1)}" font-size="10" fill="var(--muted)" text-anchor="middle">base ${nf(base, 0)}</text></svg>`;
}
function reliab(M) {
  const D = M?.examen?.deciles || []; if (!D.length) return "";
  const W = 220, Hh = 190, L = 30, B = 26, T = 8, Rr = 8;
  const lo = Math.max(0, Math.floor(Math.min(...D.map((d) => Math.min(d.p_media, d.acierto))) / 10) * 10 - 0);
  const hi = Math.min(100, Math.ceil(Math.max(...D.map((d) => Math.max(d.p_media, d.acierto))) / 10) * 10);
  const sx = (v) => L + ((v - lo) / (hi - lo || 1)) * (W - L - Rr), sy = (v) => T + ((hi - v) / (hi - lo || 1)) * (Hh - T - B);
  let o = `<line x1="${sx(lo)}" y1="${sy(lo)}" x2="${sx(hi)}" y2="${sy(hi)}" style="stroke:var(--border-strong);stroke-dasharray:3 3"/>`;
  for (let v = lo; v <= hi; v += 10) o += `<text x="${L - 5}" y="${sy(v) + 3}" font-size="9" fill="var(--faint)" text-anchor="end">${v}</text><text x="${sx(v)}" y="${Hh - B + 13}" font-size="9" fill="var(--faint)" text-anchor="middle">${v}</text>`;
  o += `<polyline points="${D.map((d) => `${sx(d.p_media).toFixed(1)},${sy(d.acierto).toFixed(1)}`).join(" ")}" fill="none" style="stroke:var(--accent);stroke-width:1.5px"/>`;
  o += D.map((d) => `<circle cx="${sx(d.p_media).toFixed(1)}" cy="${sy(d.acierto).toFixed(1)}" r="3.2" style="fill:var(--accent)"><title>Previsto ${nf(d.p_media, 0)} % · ocurrió ${nf(d.acierto, 0)} % (${nf(d.n, 0)} casos)</title></circle>`).join("");
  o += `<text x="${(L + W) / 2}" y="${Hh - 2}" font-size="9.5" fill="var(--muted)" text-anchor="middle">previsto (%)</text><text x="9" y="${T + 70}" font-size="9.5" fill="var(--muted)" transform="rotate(-90 9 ${T + 70})" text-anchor="middle">ocurrió (%)</text>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" class="pb-rel" role="img" aria-label="Gráfico de fiabilidad">${o}</svg>`;
}
function spread(d) {
  if (!d) return "";
  const [p10, p25, p50, p75, p90] = d.exceso, mn = Math.min(-40, p10), mx = Math.max(40, p90), W = 300, sx = (v) => 8 + ((v - mn) / (mx - mn)) * (W - 16);
  return `<svg viewBox="0 0 ${W} 54" class="pb-spread" role="img" aria-label="Reparto de resultados">
    <line x1="${sx(0)}" y1="4" x2="${sx(0)}" y2="34" style="stroke:var(--border-strong)"/>
    <line x1="${sx(p10)}" y1="19" x2="${sx(p90)}" y2="19" style="stroke:var(--muted);stroke-width:1.2px"/>
    <rect x="${sx(p25)}" y="11" width="${Math.max(1, sx(p75) - sx(p25))}" height="16" style="fill:color-mix(in srgb,var(--accent) 35%,transparent);stroke:var(--accent)"/>
    <line x1="${sx(p50)}" y1="9" x2="${sx(p50)}" y2="29" style="stroke:var(--text);stroke-width:2px"/>
    <text x="${sx(p10)}" y="48" font-size="10" fill="var(--faint)" text-anchor="middle">${sgn(p10, 0)}</text><text x="${sx(p50)}" y="48" font-size="10" fill="var(--text)" text-anchor="middle">${sgn(p50, 0)}</text><text x="${sx(p90)}" y="48" font-size="10" fill="var(--faint)" text-anchor="middle">${sgn(p90, 0)}</text></svg>`;
}

/* panel de la ficha */
function fichaPanel(r) {
  if (R.d === undefined) { ensure(); return `<div class="skel" style="height:260px"></div>`; }
  const x = R.d && of(r.sym);
  if (!x) return `<section class="rsk-p pb"><h3>Probabilidad de acierto <span>batir a su índice con dividendos en 12 meses</span></h3><div class="hint">${R.d ? "Sin historia suficiente (hacen falta 3 años de precios) o su mercado tiene pocos valores." : "Llega con la próxima actualización automática."}</div></section>`;
  const M = x.M, ex = M.examen, F = R.d.factores || [], D = ex.deciles || [], dd = x.dec != null ? D[x.dec] : null;
  const mx = Math.max(2, ...x.c.map((v) => Math.abs(v)));
  const fac = F.map((f, j) => [f, x.c[j]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const bars = fac.map(([f, v]) => `<div class="pb-f"><span>${esc(f.nombre)}</span><span class="pb-fb"><i class="${v < 0 ? "n" : "p"}" style="${v < 0 ? "right:50%" : "left:50%"};width:${((Math.abs(v) / mx) * 50).toFixed(1)}%"></i></span><b class="num ${v < 0 ? "neg" : v > 0 ? "pos" : ""}">${sgn(v, 1)}</b></div>`).join("");
  const pill = x.ok ? `<span class="ui-pill ok">Validada en el examen</span>` : `<span class="ui-pill nu">Sin ventaja demostrada</span>`;
  const top = fac.filter(([, v]) => Math.abs(v) >= 0.5).slice(0, 2);
  const lect = H.ui.lectura([
    x.ok ? `Probabilidad de batir a ${M.nombre} en 12 meses: ${nf(x.p, 0)} % (entre ${nf(x.lo, 0)} y ${nf(x.hi, 0)} % con un 90 % de confianza), frente a una tasa base del ${nf(M.base_hoy, 0)} %.`
      : `En ${M.nombre} el modelo no ha demostrado ventaja en el examen (mejora ${sgn(ex.skill, 1)} % frente al mínimo del 3 %; calibración ${nf(ex.ece, 1)} pp): la cifra útil es la tasa base, ${nf(M.base_hoy, 0)} %. El ${nf(x.p, 0)} % del modelo es orientativo.`,
    top.length ? `Lo que más mueve su cifra: ${top.map(([f, v]) => `${f.nombre.toLowerCase()} (${sgn(v, 1)} pp)`).join(" y ")}.` : "Ningún factor la aleja más de medio punto de la media de su mercado.",
    dd ? `En el examen, los valores con previsiones parecidas (${nf(dd.p_de, 0)}–${nf(dd.p_a, 0)} %) batieron a su índice el ${nf(dd.acierto, 0)} % de las veces; la mitad quedó entre ${sgn(dd.exceso[1], 0)} y ${sgn(dd.exceso[3], 0)} puntos frente al índice.` : null,
  ]);
  return `<section class="rsk-p pb"><h3>Probabilidad de acierto <span>batir a ${esc(M.nombre)} con dividendos en 12 meses · ${esc(R.d.semana ? `datos al ${H.fmtDate(R.d.semana)}` : "")}</span></h3>
    <div class="pb-g">
      <div class="pb-c1">${gauge(x)}<div class="pb-pill">${pill}</div>
        <table class="rsk-kv pb-kv"><tr><td>Tasa base de su mercado</td><td class="num">${nf(M.base_hoy, 0)} %</td></tr>
        <tr><td>Examen ${esc(ex.desde?.slice(0, 4) || "")}–${esc(ex.hasta?.slice(0, 4) || "")}: mejora</td><td class="num ${ex.skill >= 3 ? "pos" : "neg"}">${sgn(ex.skill, 1)} %</td></tr>
        <tr><td>Calibración (error medio)</td><td class="num ${ex.ece < 10 ? "pos" : "neg"}">${nf(ex.ece, 1)} pp</td></tr>
        <tr><td>Índice con dividendos</td><td class="num">${esc(M.indice?.ticker || "—")}${M.indice && !M.indice.dividendos ? " ∗" : ""}</td></tr></table></div>
      <div class="pb-c2"><div class="pb-h">Aportación de cada factor <small>puntos frente a la media de su mercado</small></div>${bars}</div>
      <div class="pb-c3"><div class="pb-h">Qué pasó con previsiones parecidas <small>examen, exceso frente al índice a 12 meses</small></div>
        ${dd ? `${spread(dd)}<div class="pb-sp-l"><span>batió al índice: <b>${nf(dd.acierto, 0)} %</b></span><span>${nf(dd.n, 0)} casos</span></div>` : "<div class=\"hint\">Sin datos.</div>"}
        <div class="pb-h" style="margin-top:10px">Fiabilidad en ${esc(M.nombre)} <small>previsto frente a ocurrido, por deciles</small></div>${reliab(M)}</div>
    </div>${lect}
    ${exp(`<b>Qué es.</b> La probabilidad de que la acción, con dividendos, rinda más que su propio índice con dividendos en los próximos 12 meses. Sale de un modelo de regresión logística con ocho factores medibles en cada fecha (momento, reversión del último mes, volatilidad, beta, distancia al máximo y a la media de 40 semanas, y la tendencia y la volatilidad de su mercado), ajustado con datos desde 2007. <b>Examen</b>: el modelo se reajusta cada enero solo con lo que se sabía entonces y se evalúa con las previsiones de 2016 en adelante; se da por validado en un mercado si mejora a la tasa base al menos un 3 % (Brier) y su calibración tiene un error menor de 10 puntos. <b>Intervalo</b>: 90 % al reajustar el modelo con años remuestreados. <b>Límites</b>: solo precios (los fundamentales no tienen historia homogénea en todas las bolsas) y sesgo de supervivencia: el universo es el de hoy, así que el pasado incluye solo empresas que siguen cotizando. ∗ Índice sin dividendos: no hay ETF con historia suficiente.`)}
  </section>`;
}
window.SCRProb = { ensure, data: () => R.d, cell, fichaPanel, of };
})();
