/* Screener · Adelantarse: indicadores adelantados con su historial, escenarios por fase del ciclo y registro de aciertos. */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate } = H;
const A = { sc: null, loading: false };
/* indicador: [id, umbral contractivo, umbral expansivo, sentido (1: valores altos = expansivo), explicación] */
const LEAD = [
  ["t10y3m", 0, 0.5, 1, "Curva invertida (por debajo de 0) ha precedido a todas las recesiones de EE. UU. desde 1970, con 6-18 meses de adelanto. Lo peligroso suele ser cuando vuelve a positivo tras la inversión."],
  ["t10y2y", 0, 0.5, 1, "Misma lógica que la 10a−3m, con la parte corta más sensible a las expectativas sobre la Fed."],
  ["sahm", 0.5, 0.3, -1, "Por encima de 0,5 indica que la recesión ya ha empezado casi siempre. Es coincidente más que adelantado, pero confirma pronto."],
  ["hy_oas", 5, 3.5, -1, "El crédito suele adelantarse a la bolsa: una ampliación brusca del diferencial anticipa caídas y menor crecimiento."],
  ["nfci", 0, -0.3, -1, "Condiciones financieras más duras que la media (por encima de 0) suelen preceder a menos crédito e inversión."],
  ["vix", 30, 20, -1, "Por encima de 30 indica pánico; por debajo de 15, complacencia. Los extremos de pánico han sido históricamente buenos puntos de entrada a largo plazo."],
  ["indpro", 0, 1, 1, "La producción industrial en negativo interanual suele acompañar a las fases de desaceleración y recesión."],
  ["ez_curve", 0, 0.5, 1, "Pendiente de la curva europea: invertida anticipa debilidad en la zona euro."],
];
const SCEN = {
  "Expansión": ["La economía sigue creciendo sin señales de agotamiento.", "Bolsa al alza liderada por cíclicos; bonos largos planos o a la baja; crédito estable."],
  "Desaceleración": ["El crecimiento se frena sin llegar a recesión (aterrizaje suave).", "Mejor calidad y defensivos; bonos largos empiezan a subir; volatilidad al alza."],
  "Recesión": ["Contracción de la actividad y del empleo.", "Bolsa a la baja, sobre todo cíclicos y bancos; bonos del Estado al alza; dólar suele apreciarse; diferenciales de crédito se amplían."],
  "Recuperación": ["Salida de una contracción con indicadores mejorando desde niveles bajos.", "Históricamente la mejor fase para la bolsa: cíclicos, financieros y pequeñas compañías; diferenciales se estrechan."],
};
const SEC_ES = { "Technology": "Tecnología", "Financial Services": "Financiero", "Healthcare": "Salud", "Consumer Cyclical": "Consumo cíclico", "Consumer Defensive": "Consumo defensivo",
  "Industrials": "Industria", "Energy": "Energía", "Utilities": "Utilities", "Real Estate": "Inmobiliario", "Basic Materials": "Materiales", "Communication Services": "Comunicaciones" };

async function ensure() {
  if (A.sc || A.loading) return; A.loading = true;
  try { const r = await fetch("data/score.json?t=" + Date.now(), { cache: "no-store" }); A.sc = r.ok ? await r.json() : {}; } catch (e) { A.sc = {}; }
  A.loading = false; H.render();
}
function signal(v, lo, hi, dir) {
  if (v == null) return null;
  if (dir === 1) return v < lo ? "Contractiva" : v >= hi ? "Expansiva" : "Neutral";
  return v > lo ? "Contractiva" : v <= hi ? "Expansiva" : "Neutral";
}
function history(hist, lo, dir) {
  /* fechas en que el indicador entra en zona contractiva */
  const out = []; let prev = null;
  (hist || []).forEach(([d, v]) => { const c = dir === 1 ? v < lo : v > lo; if (c && prev === false) out.push(d); prev = c; });
  return out;
}
function spark(hist, lo, dir) {
  if (!hist || hist.length < 3) return "";
  const W = 160, Hh = 34, vs = hist.map((p) => p[1]), mn = Math.min(...vs, lo), mx = Math.max(...vs, lo), rg = mx - mn || 1;
  const x = (i) => (i / (vs.length - 1)) * W, y = (v) => 2 + (1 - (v - mn) / rg) * (Hh - 4);
  return `<svg viewBox="0 0 ${W} ${Hh}" style="width:160px;height:34px" aria-hidden="true"><line x1="0" x2="${W}" y1="${y(lo)}" y2="${y(lo)}" stroke="var(--neg)" stroke-dasharray="3 2" opacity=".7"/>
    <polyline fill="none" stroke="var(--accent)" stroke-width="1.4" points="${vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/></svg>`;
}
const badge = (s) => `<span class="badge ${s === "Expansiva" ? "Favorable" : s === "Contractiva" ? "Defensivo" : "Neutral"}">${s || "Sin datos"}</span>`;

function render() {
  const D = H.S.data; ensure();
  if (!D) return `<div class="skel" style="height:240px"></div>`;
  const lv = H.S.level;
  const rows = LEAD.map(([id, lo, hi, dir, why]) => { const s = D.series[id]; const v = s?.estado === "ok" ? s.valor : null; return { id, s, v, lo, hi, dir, why, sig: signal(v, lo, hi, dir), cross: history(s?.hist, lo, dir) }; });
  const nC = rows.filter((r) => r.sig === "Contractiva").length, nE = rows.filter((r) => r.sig === "Expansiva").length, nT = rows.filter((r) => r.sig).length;
  let h = `<h2 class="sec">Indicadores adelantados <span class="hint">Señales que históricamente se han anticipado a la economía y a la bolsa. No predicen la fecha: avisan del riesgo.</span></h2>
    <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="kpi" style="cursor:default"><span class="k-l">Señales contractivas</span><span class="k-v num" style="color:var(--neg)">${nC} de ${nT}</span></div>
      <div class="kpi" style="cursor:default"><span class="k-l">Señales expansivas</span><span class="k-v num" style="color:var(--pos)">${nE} de ${nT}</span></div>
      <div class="kpi" style="cursor:default"><span class="k-l">Lectura conjunta</span><span class="k-v">${nC >= 4 ? "Riesgo alto" : nC >= 2 ? "Vigilar" : "Sin alarma"}</span></div></div>
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Indicador</th><th>Valor</th><th>Señal</th><th data-tip="Nivel a partir del cual se considera contractiva">Umbral</th><th>Cambio 3 m</th><th style="text-align:left">Histórico disponible</th>${lv >= 2 ? '<th data-tip="Veces que entró en zona contractiva en el histórico descargado">Señales previas</th>' : ""}</tr></thead><tbody>
    ${rows.map((r) => `<tr data-id="${r.id}" class="lead-row"><td data-tip="${esc(r.why)}">${esc(r.s?.nombre || r.id)}</td><td class="num">${r.v == null ? "—" : nf(r.v, 2)}</td><td>${badge(r.sig)}</td>
      <td class="num">${r.dir === 1 ? "<" : ">"} ${nf(r.lo, 1)}</td><td class="num">${r.s?.cambio_3m == null ? "—" : sgn(r.s.cambio_3m, 2)}</td><td style="text-align:left">${spark(r.s?.hist, r.lo, r.dir)}</td>
      ${lv >= 2 ? `<td class="num">${r.cross.length}${r.cross.length ? ` <span class="hint">(última ${fmtDate(r.cross[r.cross.length - 1])})</span>` : ""}</td>` : ""}</tr>`).join("")}</tbody></table></div>
    <div class="method">Pulsa un indicador para ver su histórico completo y por qué importa. Umbrales habituales en la literatura; la lectura conjunta es una regla simple (2 o más contractivas = vigilar; 4 o más = riesgo alto).</div>`;

  /* escenarios */
  const R = D.regimen, ciclo = A.sc?.ciclo;
  if (R?.estado === "ok") {
    const order = Object.entries(R.probabilidades).sort((a, b) => b[1] - a[1]);
    h += `<h2 class="sec">Escenarios a 6-12 meses <span class="hint">Probabilidades del modelo de régimen (EE. UU.), heurístico y sin calibrar estadísticamente</span></h2><div class="views" style="grid-template-columns:repeat(2,1fr)">
      ${order.map(([k, p]) => { const sec = ciclo?.[k] ? Object.entries(ciclo[k]).sort((a, b) => b[1] - a[1]) : [];
        return `<div class="view-card"><h3>${esc(k)} · ${p} %</h3><div class="track" style="height:6px;background:var(--surface-3);border-radius:3px;margin-bottom:8px"><div style="height:100%;width:${p}%;background:${k === R.dominante ? "var(--accent)" : "var(--faint)"};border-radius:3px"></div></div>
          <div style="font-size:12.5px">${esc(SCEN[k][0])}</div><div class="hint" style="margin-top:4px">${esc(SCEN[k][1])}</div>
          ${sec.length ? `<div style="margin-top:8px;font-size:12px"><span class="chg p">Suelen ganar:</span> ${sec.slice(0, 3).map(([s]) => `<a href="#" data-gosector="${esc(s)}">${esc(SEC_ES[s] || s)}</a>`).join(", ")}<br>
          <span class="chg n">Suelen perder:</span> ${sec.slice(-3).map(([s]) => esc(SEC_ES[s] || s)).join(", ")}</div>` : ""}</div>`; }).join("")}</div>
      <div class="method">Las preferencias sectoriales por fase son la rotación típica descrita en la literatura de ciclo, no una predicción. Lo que movería las probabilidades: regla de Sahm, diferencial high yield y condiciones financieras.</div>`;
  }

  /* registro de aciertos */
  const hist = A.sc?.historial || [], sig = A.sc?.senales || [];
  h += `<h2 class="sec">Registro de aciertos <span class="hint">Se mide sola cada semana: así sabrás si las señales de esta herramienta funcionan</span></h2>
    <div class="f-grid"><div class="box"><b>Top 20 de la puntuación frente al universo</b>${hist.length ? `<table><thead><tr><th>Semana</th><th>Días</th><th>Top 20</th><th>Universo</th><th>Diferencia</th></tr></thead><tbody>
      ${hist.slice().reverse().slice(0, 10).map((x) => `<tr><td>${fmtDate(x.fecha.slice(0, 10))}</td><td class="num">${x.dias}</td><td class="num">${x.top == null ? "—" : sgn(x.top, 2) + " %"}</td><td class="num">${x.universo == null ? "—" : sgn(x.universo, 2) + " %"}</td>
        <td class="num chg ${x.top == null || x.universo == null || x.top === x.universo ? "z" : x.top > x.universo ? "p" : "n"}">${x.top == null || x.universo == null ? "—" : sgn(x.top - x.universo, 2) + " pp"}</td></tr>`).join("")}</tbody></table>
      ${(() => { const old = hist.filter((x) => x.dias >= 28 && x.top != null); if (!old.length) return '<div class="method">Hace falta al menos un mes de registros para valorar el resultado.</div>';
        const w = old.filter((x) => x.top > x.universo).length; return `<div class="method">Semanas con al menos 4 semanas de antigüedad en que el top 20 batió al universo: <b>${w} de ${old.length}</b>.</div>`; })()}` : '<div class="hint">Sin registros todavía.</div>'}</div>
    <div class="box"><b>Señales técnicas (alcista / bajista)</b>${sig.length ? `<table><thead><tr><th>Semana</th><th>Tipo</th><th>Señales</th><th data-tip="Alcista acierta si lo hace mejor que el universo; bajista, si lo hace peor">Aciertos</th><th>Rent. media</th><th>Universo</th></tr></thead><tbody>
      ${sig.slice().reverse().slice(0, 12).map((x) => `<tr><td>${fmtDate(x.fecha.slice(0, 10))}</td><td>${esc(x.tipo)}</td><td class="num">${x.n}</td><td class="num">${nf(x.aciertos, 0)} %</td><td class="num">${sgn(x.rent_media, 2)} %</td><td class="num">${sgn(x.universo, 2)} %</td></tr>`).join("")}</tbody></table>`
      : '<div class="hint">Las señales de esta semana se evaluarán dentro de 3 semanas. Por encima del 50 % de aciertos, la señal aporta algo.</div>'}</div></div>`;
  return h;
}
function onClick(t) {
  const b = t.closest("tr.lead-row");
  if (b && H.S.view === "adelantarse" && H.S.data?.series?.[b.dataset.id]) { H.seriesDrawer(b.dataset.id); return true; }
  return false;
}
H.modules.adelantarse = render;
H.handlers.unshift(onClick);
})();
