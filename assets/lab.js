/* Screener · Laboratorio: ¿funciona la puntuación? IC, quintiles y cartera Q5 − Q1 de cada factor (data/lab.json). */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate, store, dropdown } = H;
const pct = (v) => (v == null ? "—" : nf(v, 1) + " %");
const L = { d: null, loading: false, f: store.get("lab_f", "momentum") };
const CAT_ES = { calidad: "Calidad", valor: "Valor", crecimiento: "Crecimiento", momentum: "Momentum", smart: "Smart money", macro: "Encaje macro", extra: "No incluido en la puntuación" };

async function ensure() {
  if (L.d || L.loading) return; L.loading = true;
  try { const r = await fetch("data/lab.json?t=" + Date.now(), { cache: "no-store" }); L.d = r.ok ? await r.json() : { err: "HTTP " + r.status }; } catch (e) { L.d = { err: e.message }; }
  L.loading = false; H.render();
}
/* veredicto de un factor a partir de su IC medio y su estadístico t */
function verdict(x) {
  if (!x) return ["sin", "Sin datos"];
  if (x.ic >= 0.02 && x.ic_t >= 2) return ["ok", "Aporta"];
  if (x.ic > 0 && x.ic_t >= 1) return ["mid", "Débil"];
  if (x.ic < 0 && x.ic_t <= -1) return ["bad", "Resta"];
  return ["sin", "Sin evidencia"];
}
const badge = (x) => { const [c, t] = verdict(x); return `<span class="lab-v lab-${c}">${t}</span>`; };
const fia = (f) => f === "completa" ? `<span class="lab-fia c" data-tip="Solo usa precios conocidos en cada fecha">Fiabilidad completa</span>`
  : f === "sec_us" ? `<span class="lab-fia c" data-tip="10-K y 10-Q originales de la SEC con su fecha real de presentación. Solo valores de EE. UU.">Solo EE. UU.: SEC a fecha</span>`
  : f === "sec" ? `<span class="lab-fia c" data-tip="EE. UU.: 10-K original de la SEC con su fecha real de presentación. Europa: cuentas anuales de Yahoo aproximadas">EE. UU.: SEC a fecha · Europa: aproximada</span>`
  : `<span class="lab-fia a" data-tip="Cuentas anuales supuestas publicadas el 1 de abril siguiente; cobertura más corta">Fiabilidad aproximada</span>`;

function qBars(q) {
  const W = 520, Hh = 170, pad = 30, m = Math.max(0.05, ...q.map((v) => Math.abs(v || 0)));
  const y0 = Hh / 2, bw = (W - pad * 2) / 5 - 10;
  return `<svg viewBox="0 0 ${W} ${Hh + 22}" class="lab-svg" role="img" aria-label="Rentabilidad mensual por quintil frente a la media">
    <line x1="${pad}" x2="${W - pad}" y1="${y0}" y2="${y0}" class="lab-ax"/>
    ${q.map((v, i) => { const h = ((v || 0) / m) * (Hh / 2 - 14), x = pad + i * ((W - pad * 2) / 5) + 5;
      return `<rect x="${x}" y="${h >= 0 ? y0 - h : y0}" width="${bw}" height="${Math.abs(h)}" rx="3" class="${v >= 0 ? "lab-p" : "lab-n"}"/>
        <text x="${x + bw / 2}" y="${h >= 0 ? y0 - h - 4 : y0 - h + 12}" text-anchor="middle" class="lab-t">${sgn(v, 2)}</text>
        <text x="${x + bw / 2}" y="${Hh + 16}" text-anchor="middle" class="lab-t">Q${i + 1}</text>`; }).join("")}
  </svg>`;
}
function curve(c) {
  if (!c?.length) return "";
  const W = 520, Hh = 170, p = 30, ys = c.map((x) => x[1]), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), rg = hi - lo || 1;
  const X = (i) => p + (i / Math.max(1, c.length - 1)) * (W - p - 8), Y = (v) => 8 + (1 - (v - lo) / rg) * (Hh - 16);
  const path = c.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x[1]).toFixed(1)}`).join("");
  const last = ys[ys.length - 1];
  return `<svg viewBox="0 0 ${W} ${Hh + 20}" class="lab-svg" role="img" aria-label="Rentabilidad acumulada de la cartera Q5 menos Q1">
    <line x1="${p}" x2="${W - 8}" y1="${Y(0)}" y2="${Y(0)}" class="lab-ax"/>
    <text x="${p - 4}" y="${Y(hi) + 4}" text-anchor="end" class="lab-t">${nf(hi, 0)}</text><text x="${p - 4}" y="${Y(lo) + 4}" text-anchor="end" class="lab-t">${nf(lo, 0)}</text>
    <path d="${path}" fill="none" class="${last >= 0 ? "lab-lp" : "lab-ln"}" stroke-width="2"/>
    <text x="${p}" y="${Hh + 16}" class="lab-t">${fmtDate(c[0][0])}</text><text x="${W - 8}" y="${Hh + 16}" text-anchor="end" class="lab-t">${fmtDate(c[c.length - 1][0])}</text>
  </svg>`;
}
const row = (x, name, extra = "") => `<tr><td>${esc(name)}${extra}</td><td>${badge(x)}</td><td class="num">${nf(x.ic, 3)}</td><td class="num">${x.ic_t == null ? "—" : nf(x.ic_t, 1)}</td>
  <td class="num">${nf(x.ic_pos, 0)} %</td><td class="num chg ${x.ls_anual >= 0 ? "p" : "n"}">${sgn(x.ls_anual, 1)} %</td><td class="num">${x.ls_sharpe == null ? "—" : nf(x.ls_sharpe, 2)}</td><td class="num">${x.meses}</td></tr>`;
const thead = `<thead><tr><th>Factor</th><th>Veredicto</th><th data-tip="Correlación media entre la nota del factor y la rentabilidad del mes siguiente. 0,02-0,05 ya es útil en la práctica profesional">IC medio</th>
  <th data-tip="Fiabilidad estadística del IC: por encima de 2, es difícil que sea casualidad">t</th><th data-tip="Meses en que el IC fue positivo">Meses IC &gt; 0</th>
  <th data-tip="Rentabilidad anual teórica de comprar el mejor quinto y vender el peor, sin costes">Q5 − Q1 anual</th><th data-tip="Rentabilidad entre volatilidad de esa cartera, anualizada">Sharpe</th><th>Meses</th></tr></thead>`;

function render() {
  ensure();
  const d = L.d, lv = H.S.level;
  let h = `<p class="lead">¿La puntuación anticipa qué valores lo harán mejor? Aquí se mide cada factor con datos históricos, mes a mes.</p>`;
  if (!d) return h + `<div class="skel" style="height:240px"></div>`;
  if (d.err || !d.categorias) return h + `<div class="err-box"><b>Todavía no hay resultados del laboratorio.</b> Se calculan en la actualización diaria de los datos. ${esc(d.err || "")}</div>`;

  if (H.S.explain) h += `<div class="box lab-intro"><b>Cómo leerlo</b> Cada fin de mes se ordenan los valores por un factor (por ejemplo, momentum) y se mira qué pasó el mes siguiente.
    Si los mejor puntuados suben más que los peor puntuados de forma repetida, el factor <strong>aporta</strong>. Si no hay diferencia clara, es <strong>ruido</strong>, y darle mucho peso solo añade riesgo.</div>`;
  h += `<div class="status-line hint">Universo: ${d.universo} valores · ${d.meses} meses evaluados (${fmtDate(d.desde)} – ${fmtDate(d.hasta)}) · horizonte ${esc(d.horizonte)} · calculado ${fmtDate(d.generado.slice(0, 10))}${d.fuentes ? ` · ${nf(d.fuentes.anios_precio, 0)} años de precios · ${d.fuentes.sec} empresas con cuentas SEC · ${d.fuentes.ex_miembros} ex miembros del S&P` : ""}</div>`;

  /* veredicto global (Fase 1): ¿la nota es «de oportunidad» o solo «de ordenación»? */
  const V = d.veredicto;
  if (V) h += `<div class="box lab-verd ${V.etiqueta === "oportunidad" ? "ok" : "bad"}"><div class="lab-ch"><b>Veredicto: puntuación de ${esc(V.etiqueta)}</b><span class="lab-v lab-${V.etiqueta === "oportunidad" ? "ok" : "sin"}">umbral t ≥ ${nf(V.t_umbral, 2)} · ${V.pruebas} pruebas</span></div>
    <div class="hint" style="margin-top:6px">${esc(V.texto)}</div>
    ${V.supera?.length ? `<div class="hint">Superan: ${V.supera.map((x) => `${esc(x.nombre)} a ${x.horizonte} (IC ${nf(x.ic, 3)}, t ${nf(x.t, 1)}${x.t_n != null ? `, t neutral ${nf(x.t_n, 1)}` : ""})`).join(" · ")}</div>` : ""}</div>`;

  /* tarjetas por categoría */
  h += `<h2 class="sec">Resultado por factor de la puntuación</h2><div class="lab-cards">${d.categorias.map((c) => `<button class="box lab-card ${L.f === c.k ? "on" : ""}" data-labf="${c.k}">
      <div class="lab-ch"><b>${esc(c.nombre)}</b>${badge(c)}</div>
      <div class="lab-big">${nf(c.ic, 3)}<span>IC medio · t ${c.ic_t == null ? "—" : nf(c.ic_t, 1)}</span></div>
      <div class="hint">Mejor quinto − peor quinto: <strong class="chg ${c.ls_anual >= 0 ? "p" : "n"}">${sgn(c.ls_anual, 1)} % al año</strong></div>${fia(c.fiabilidad)}</button>`).join("")}
    ${(d.no_evaluables || []).map((x) => `<div class="box lab-card lab-na"><div class="lab-ch"><b>${esc(x.nombre)}</b><span class="lab-v lab-sin">No evaluable</span></div><div class="hint">${esc(x.motivo)}</div></div>`).join("")}</div>`;

  /* pesos */
  const P = d.pesos || {}, cur = store.get("pesos", null), sug = P.sugerido || {}, keys = Object.keys(P.actual || {});
  const same = (a, b) => a && b && keys.every((k) => +a[k] === +b[k]);
  const cn = d.compuesto?.actual, cs = d.compuesto?.sugerido, o = d.fuera_muestra;
  h += `<h2 class="sec">Pesos: intuición frente a evidencia</h2><div class="f-grid"><div class="box"><div class="lab-tw"><table><thead><tr><th>Factor</th><th>Actuales (por defecto)</th><th>Sugeridos</th><th>Tus pesos</th></tr></thead><tbody>
    ${keys.map((k) => `<tr><td>${esc(CAT_ES[k] || k)}</td><td class="num">${P.actual[k]}</td><td class="num"><strong>${sug[k]}</strong>${sug[k] !== P.actual[k] ? ` <span class="chg ${sug[k] > P.actual[k] ? "p" : "n"}">${sgn(sug[k] - P.actual[k], 0)}</span>` : ""}</td><td class="num">${cur ? cur[k] ?? "—" : P.actual[k]}</td></tr>`).join("")}</tbody></table></div>
    <div class="bar" style="margin-top:12px">${same(cur, sug) ? `<span class="chip on">Usando los pesos sugeridos ✓</span>` : `<button class="chip" data-labw="sug">Aplicar pesos sugeridos</button>`}
      <button class="chip" data-labw="def">Volver a los pesos por defecto</button></div>
    <div class="method">Regla: cada factor cuenta según su fiabilidad (t ≤ 1 no cuenta; t ≥ 2 cuenta entero). Los pesos se mueven hacia los factores con IC positivo solo en la medida de esa fiabilidad: con evidencia débil apenas cambian. Un factor que resta con claridad (t ≤ −2) pierde la mitad de su peso en favor del resto. Máximo de 40 por factor. Smart money y encaje macro conservan su peso porque no se pueden medir.</div></div>
    <div class="box"><b>Puntuación completa (sin smart money ni macro)</b><div class="lab-tw"><table>${thead}<tbody>${cn ? row(cn, "Pesos actuales") : ""}${cs ? row(cs, "Pesos sugeridos") : ""}</tbody></table></div>
    ${o ? `<div class="method"><strong>Prueba fuera de muestra.</strong> Con pesos calculados solo con los datos hasta ${fmtDate(o.corte)}, en los ${o.sugerido.meses} meses siguientes: IC ${nf(o.sugerido.ic, 3)} frente a ${nf(o.actual.ic, 3)} con los pesos actuales
      (Q5 − Q1: ${sgn(o.sugerido.ls_anual, 1)} % frente a ${sgn(o.actual.ls_anual, 1)} % al año). ${keys.filter((k) => k in (o.pesos_primera_mitad || {})).every((k) => o.pesos_primera_mitad[k] === P.actual[k]) ? "Con la primera mitad no había evidencia suficiente para mover los pesos, así que no hay mejora que comprobar." : o.sugerido.ic > o.actual.ic + 0.005 ? "La mejora se mantiene con datos que el ajuste no vio." : "La mejora no se mantiene con datos nuevos: tómalo como señal de prudencia antes de cambiar los pesos."}</div>` : ""}</div></div>`;

  /* horizontes y neutralización */
  const HZ = d.horizontes || ["1m"], HZN = { "1m": "1 mes", "3m": "3 meses", "6m": "6 meses", "12m": "12 meses" };
  const cell = (v) => { if (!v) return `<td class="num">—</td><td class="num">—</td>`; const strong = v.ic >= (V?.ic_min ?? 0.02) && (v.t || 0) >= (V?.t_umbral ?? 3);
    return `<td class="num ${strong ? "lab-hit" : ""}">${nf(v.ic, 3)} <span class="hint">t ${v.t == null ? "—" : nf(v.t, 1)}</span></td><td class="num">${v.ic_n == null ? "—" : nf(v.ic_n, 3)} <span class="hint">t ${v.t_n == null ? "—" : nf(v.t_n, 1)}</span></td>`; };
  const hzRows = (list) => list.filter((x) => x.hz).map((x) => `<tr><td>${esc(x.nombre)}</td>${HZ.map((k) => cell(x.hz[k])).join("")}</tr>`).join("");
  if (d.categorias.some((c) => c.hz)) h += `<h2 class="sec">Por horizonte y neutralizado</h2><div class="box"><div class="lab-tw"><table class="lab-hz"><thead><tr><th rowspan="2">Factor</th>${HZ.map((k) => `<th colspan="2">${HZN[k] || k}</th>`).join("")}</tr>
      <tr>${HZ.map(() => `<th data-tip="IC medio y estadístico t (Newey-West en horizontes solapados)">IC</th><th data-tip="IC tras quitar el efecto de sector, tamaño y beta cada mes">Neutral</th>`).join("")}</tr></thead>
      <tbody>${hzRows(d.categorias)}${d.categorias.some((c) => c.hz_us) ? `<tr><td colspan="${1 + HZ.length * 2}" class="hint">Solo EE. UU. (fundamentales de la SEC)</td></tr>${d.categorias.filter((c) => c.hz_us).map((x) => `<tr><td>${esc(x.nombre)}</td>${HZ.map((k) => cell(x.hz_us[k])).join("")}</tr>`).join("")}` : ""}${lv >= 1 ? `<tr><td colspan="${1 + HZ.length * 2}" class="hint">Subfactores y controles</td></tr>${hzRows(d.factores)}` : ""}</tbody></table></div>
    <div class="method">Neutral: lo que el factor aporta por sí mismo, descontado el sector, el tamaño y la beta. Si el IC cae mucho al neutralizar, el factor era en realidad una apuesta por un sector, por empresas grandes o pequeñas, o por más o menos riesgo de mercado.
      Resaltado: supera IC ≥ ${nf(V?.ic_min ?? 0.02, 2)} y el umbral de t corregido por pruebas múltiples (${nf(V?.t_umbral, 2)}).</div></div>`;

  /* costes */
  if (d.categorias.some((c) => c.ls_neto_anual != null)) h += `<h2 class="sec">Después de costes</h2><div class="box"><div class="lab-tw"><table><thead><tr><th>Factor</th><th data-tip="Parte media de cada quinto que cambia de un mes al siguiente">Rotación mensual</th><th>Q5 − Q1 bruto</th><th>Q5 − Q1 neto</th><th>Sharpe neto</th></tr></thead><tbody>
      ${[...d.categorias, ...(lv >= 1 ? d.factores : [])].filter((x) => x.ls_neto_anual != null).map((x) => `<tr><td>${esc(x.nombre)}</td><td class="num">${pct(x.rotacion)}</td><td class="num chg ${x.ls_anual >= 0 ? "p" : "n"}">${sgn(x.ls_anual, 1)} %</td>
        <td class="num chg ${x.ls_neto_anual >= 0 ? "p" : "n"}"><strong>${sgn(x.ls_neto_anual, 1)} %</strong></td><td class="num">${x.ls_neto_sharpe == null ? "—" : nf(x.ls_neto_sharpe, 2)}</td></tr>`).join("")}</tbody></table></div>
    <div class="method">${nf(d.coste_pb ?? 15, 0)} pb por operación y lado sobre la parte renovada cada mes, en las dos patas. Sin impuestos ni coste de préstamo de títulos para vender en corto.</div></div>`;

  /* walk-forward */
  const W = d.walk_forward;
  if (W) h += `<h2 class="sec">Pesos recalculados año a año (walk-forward)</h2><div class="box"><div class="lab-tw"><table><thead><tr><th>Año</th><th>Meses</th><th>Pesos usados (calc. con años anteriores)</th><th>IC pesos actuales</th><th>IC walk-forward</th></tr></thead><tbody>
      ${W.anios.map((y) => `<tr><td>${y.anio}</td><td class="num">${y.meses}</td><td class="hint">${Object.entries(y.pesos).map(([k, v]) => `${esc(CAT_ES[k] || k)} ${v}`).join(" · ")}</td><td class="num">${nf(y.ic_actual, 3)}</td><td class="num"><strong>${nf(y.ic_wf, 3)}</strong></td></tr>`).join("")}
      <tr class="tes-med"><td>Total</td><td class="num">${W.meses}</td><td></td><td class="num">${nf(W.ic_actual, 3)} <span class="hint">t ${nf(W.t_actual, 1)}</span></td><td class="num"><strong>${nf(W.ic_wf, 3)}</strong> <span class="hint">t ${nf(W.t_wf, 1)}</span></td></tr></tbody></table></div>
    <div class="method">Cada año se usan solo los pesos que la regla habría sugerido con los datos disponibles hasta entonces: es la prueba más parecida a usar el laboratorio en tiempo real. ${W.ic_wf > W.ic_actual + 0.005 ? "Ajustar los pesos con la evidencia ha mejorado el resultado fuera de muestra." : "Ajustar los pesos con la evidencia no ha mejorado el resultado fuera de muestra."}</div></div>`;

  /* detalle de un factor */
  const all = [...d.categorias.map((c) => [c.k, c.nombre + " (factor completo)", c]), ...d.factores.map((f) => [f.k, `${CAT_ES[f.categoria] || f.categoria} · ${f.nombre}`, f])];
  const sel = all.find((x) => x[0] === L.f) || all[0], x = sel[2];
  h += `<h2 class="sec">Detalle ${dropdown("labf", "", all.map(([k, t]) => [k, t]), sel[0])}</h2>
    <div class="f-grid"><div class="box"><b>Rentabilidad mensual por quintil frente a la media</b><div class="hint">Q1 = peor nota del factor, Q5 = mejor. Si el factor funciona, las barras suben de izquierda a derecha.</div>${qBars(x.q)}</div>
    <div class="box"><b>Mejor quinto − peor quinto, acumulado (%)</b><div class="hint">${badge(x)} ${x.explica ? esc(x.explica) + " " : ""}${fia(x.fiabilidad)}</div>${curve(x.curva)}</div></div>`;

  /* tabla completa */
  if (lv >= 1) h += `<h2 class="sec">Todos los factores y subfactores</h2><div class="box"><div class="lab-tw"><table>${thead}<tbody>
    ${["momentum", "calidad", "valor", "crecimiento", "extra"].map((cat) => d.factores.filter((f) => f.categoria === cat).map((f) => row(f, f.nombre, ` <span class="hint">· ${esc(CAT_ES[cat])}</span>`)).join("")).join("")}</tbody></table></div></div>`;

  h += `<h2 class="sec">Limitaciones</h2><div class="box"><ul class="lab-ul">${(d.sesgos || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`;
  return h;
}
function onClick(t, dd) {
  if (H.S.view !== "laboratorio") return false;
  let b;
  const opt = t.closest(".dd-menu button");
  if (opt && dd?.dataset.dd === "labf") { L.f = opt.dataset.v; store.set("lab_f", L.f); H.render(); return true; }
  if ((b = t.closest("[data-labf]"))) { L.f = b.dataset.labf; store.set("lab_f", L.f); H.render(); return true; }
  if ((b = t.closest("[data-labw]"))) {
    const w = b.dataset.labw === "sug" ? L.d?.pesos?.sugerido : L.d?.pesos?.actual;
    if (w) { if (window.SCRSetWeights) window.SCRSetWeights({ ...w }); else store.set("pesos", { ...w }); H.render(); }
    return true;
  }
  return false;
}
H.modules.laboratorio = render;
H.handlers.unshift(onClick);
})();
