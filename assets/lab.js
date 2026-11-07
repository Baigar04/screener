/* Screener · Laboratorio: ¿funciona la puntuación? IC, quintiles y cartera Q5 − Q1 de cada factor (data/lab.json). */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate, store, dropdown } = H;
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
const fia = (f) => `<span class="lab-fia ${f === "completa" ? "c" : "a"}" data-tip="${f === "completa" ? "Solo usa precios conocidos en cada fecha" : "Cuentas anuales supuestas publicadas el 1 de abril siguiente; cobertura más corta"}">${f === "completa" ? "Fiabilidad completa" : "Fiabilidad aproximada"}</span>`;

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
  let h = `<p class="lead">¿La puntuación de oportunidad anticipa qué valores lo harán mejor? Aquí se mide cada factor con datos históricos, mes a mes.</p>`;
  if (!d) return h + `<div class="skel" style="height:240px"></div>`;
  if (d.err || !d.categorias) return h + `<div class="err-box"><b>Todavía no hay resultados del laboratorio.</b> Se calculan en la actualización diaria de los datos. ${esc(d.err || "")}</div>`;

  if (lv <= 1) h += `<div class="box lab-intro"><b>Cómo leerlo</b> Cada fin de mes se ordenan los valores por un factor (por ejemplo, momentum) y se mira qué pasó el mes siguiente.
    Si los mejor puntuados suben más que los peor puntuados de forma repetida, el factor <strong>aporta</strong>. Si no hay diferencia clara, es <strong>ruido</strong>, y darle mucho peso solo añade riesgo.</div>`;
  h += `<div class="status-line hint">Universo: ${d.universo} valores · ${d.meses} meses evaluados (${fmtDate(d.desde)} – ${fmtDate(d.hasta)}) · horizonte ${esc(d.horizonte)} · calculado ${fmtDate(d.generado.slice(0, 10))}</div>`;

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
    <div class="method">Regla: el peso se desplaza hacia los factores con IC positivo y fiable (t &gt; 1; entero desde t = 2), mezclado al 50 % con los pesos actuales y con un máximo de 40 por factor. Smart money y encaje macro conservan su peso porque no se pueden medir.</div></div>
    <div class="box"><b>Puntuación completa (sin smart money ni macro)</b><div class="lab-tw"><table>${thead}<tbody>${cn ? row(cn, "Pesos actuales") : ""}${cs ? row(cs, "Pesos sugeridos") : ""}</tbody></table></div>
    ${o ? `<div class="method"><strong>Prueba fuera de muestra.</strong> Con pesos calculados solo con los datos hasta ${fmtDate(o.corte)}, en los ${o.sugerido.meses} meses siguientes: IC ${nf(o.sugerido.ic, 3)} frente a ${nf(o.actual.ic, 3)} con los pesos actuales
      (Q5 − Q1: ${sgn(o.sugerido.ls_anual, 1)} % frente a ${sgn(o.actual.ls_anual, 1)} % al año). ${keys.filter((k) => k in (o.pesos_primera_mitad || {})).every((k) => o.pesos_primera_mitad[k] === P.actual[k]) ? "Con la primera mitad no había evidencia suficiente para mover los pesos, así que no hay mejora que comprobar." : o.sugerido.ic > o.actual.ic + 0.005 ? "La mejora se mantiene con datos que el ajuste no vio." : "La mejora no se mantiene con datos nuevos: tómalo como señal de prudencia antes de cambiar los pesos."}</div>` : ""}</div></div>`;

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
