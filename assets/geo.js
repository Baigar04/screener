/* Screener · Contexto › Geopolítica (hoja de ruta definitiva, fase 2). Datos: data/geo.json (scripts/fetch_geo.py).
   Pistas activas (señal → precedente → efecto en tus valores → qué hacer), GPR global, por país y diario, sensibilidad por bolsa,
   sector y valor, estudio de eventos, rearme europeo y lectura conjunta. */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, sgn, fmtDate } = H;
const R = { d: undefined, loading: false };

async function ensure() {
  if (R.loading || R.d !== undefined) return;
  R.loading = true;
  try { const r = await fetch(`data/geo.json?t=${Date.now()}`, { cache: "no-store" }); R.d = r.ok ? await r.json() : null; } catch { R.d = null; }
  R.loading = false;
  if (["geopolitica", "hoy"].includes(H.S.view)) H.render();
}
const X = () => H.S.mode === "x";
const exp = (t) => (X() ? `<div class="rsk-exp">${t}</div>` : "");
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fm = (m) => (m ? `${MES[+m.slice(5, 7) - 1]}-${m.slice(2, 4)}` : "—");
const pc = (v, d = 1) => (v == null ? "—" : `${sgn(v, d)} %`);
const EST = { Oportunidad: "ok", Vigilar: "te", Riesgo: "ko" };
const watch = () => { try { return window.SCREq?.watch?.() || []; } catch { return []; } };

/* ---------- gráficos ---------- */
function gprChart(G) {
  const s = G.mensual.global, W = 900, Hh = 220, L = 40, Rr = 10, T = 10, B = 22;
  const n = s.length - 1, mx = Math.max(...s.map((x) => x[1])) * 1.05;
  const xs = (i) => L + (i / n) * (W - L - Rr), ys = (v) => T + (1 - v / mx) * (Hh - T - B);
  let o = "";
  for (let v = 0; v <= mx; v += 100) o += `<text x="${L - 6}" y="${(ys(v) + 3.5).toFixed(1)}" font-size="10" fill="var(--faint)" text-anchor="end">${v}</text>`;
  o += `<line x1="${L}" x2="${W - Rr}" y1="${ys(100).toFixed(1)}" y2="${ys(100).toFixed(1)}" stroke="var(--faint)" stroke-dasharray="3 3"/><text x="${L + 4}" y="${(ys(100) - 4).toFixed(1)}" font-size="10" fill="var(--faint)">100 = media 1985-2019</text>`;
  const pts = s.map((x, i) => `${xs(i).toFixed(1)},${ys(x[1]).toFixed(1)}`);
  o += `<polygon points="${xs(0)},${Hh - B} ${pts.join(" ")} ${xs(n)},${Hh - B}" fill="var(--accent)" opacity=".12"/><polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1.3"/>`;
  // picos principales (máximos locales más altos, separados 24 meses)
  const idx = s.map((x, i) => i).sort((a, b) => s[b][1] - s[a][1]), picked = [];
  for (const i of idx) { if (picked.length >= 6) break; if (picked.every((j) => Math.abs(j - i) > 24)) picked.push(i); }
  for (const i of picked) o += `<circle cx="${xs(i).toFixed(1)}" cy="${ys(s[i][1]).toFixed(1)}" r="3" fill="var(--text)"/><text x="${xs(i).toFixed(1)}" y="${(ys(s[i][1]) - 7).toFixed(1)}" font-size="10" fill="var(--muted)" text-anchor="middle">${fm(s[i][0])}</text>`;
  o += `<circle cx="${xs(n).toFixed(1)}" cy="${ys(s[n][1]).toFixed(1)}" r="3.5" fill="var(--accent)"/>`;
  for (let y = +s[0][0].slice(0, 4) + 5; y <= +s[n][0].slice(0, 4); y += 5) { const i = s.findIndex((x) => x[0] === `${y}-01`); if (i >= 0) o += `<text x="${xs(i).toFixed(1)}" y="${Hh - 6}" font-size="10" fill="var(--faint)" text-anchor="middle">${y}</text>`; }
  o += `<line x1="${L}" x2="${W - Rr}" y1="${Hh - B}" y2="${Hh - B}" stroke="var(--border-strong)"/>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" class="rsk-chart" role="img" aria-label="Índice de riesgo geopolítico mensual">${o}</svg>`;
}
function line(series, W, Hh, col, lbl) {
  if (!series?.length) return "";
  const v = series.map((x) => x[1]), mn = Math.min(...v), mx = Math.max(...v), n = v.length - 1, L = 36, T = 6, B = 18;
  const xs = (i) => L + (i / n) * (W - L - 6), ys = (x) => T + (1 - (x - mn) / (mx - mn || 1)) * (Hh - T - B);
  let o = `<polyline points="${v.map((x, i) => `${xs(i).toFixed(1)},${ys(x).toFixed(1)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="1.3"/>`;
  for (const x of [mn, mx]) o += `<text x="${L - 5}" y="${(ys(x) + 3.5).toFixed(1)}" font-size="10" fill="var(--faint)" text-anchor="end">${nf(x, 0)}</text>`;
  o += `<text x="${L}" y="${Hh - 4}" font-size="10" fill="var(--faint)">${esc(series[0][0].slice(0, 7))}</text><text x="${W - 6}" y="${Hh - 4}" font-size="10" fill="var(--faint)" text-anchor="end">${esc(series[n][0].slice(0, 10))}</text>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" class="rsk-chart" role="img" aria-label="${esc(lbl)}">${o}</svg>`;
}
function bars(rows, W = 420) {
  const mx = Math.max(1, ...rows.map((r) => Math.abs(r[1]))), lw = 120, rh = 22, x0 = lw + (W - lw - 60) / 2, sc = (W - lw - 60) / 2 / mx;
  let o = `<line x1="${x0}" x2="${x0}" y1="0" y2="${rows.length * rh + 4}" stroke="var(--border-strong)"/>`;
  rows.forEach(([n, v, t], i) => {
    const y = i * rh + 4, col = Math.abs(t ?? 9) < 2 ? "var(--muted)" : v >= 0 ? "var(--pos)" : "var(--neg)";
    o += `<text x="0" y="${y + 12}" font-size="12" fill="var(--text)">${esc(n)}</text><rect x="${Math.min(x0, x0 + v * sc).toFixed(1)}" y="${y + 2}" width="${Math.abs(v * sc).toFixed(1)}" height="${rh - 9}" fill="${col}"><title>${esc(n)}: ${sgn(v, 1)} % (t = ${nf(t ?? 0, 1)})</title></rect>
      <text x="${W - 2}" y="${y + 12}" font-size="11.5" fill="${col}" text-anchor="end" font-family="var(--mono)">${sgn(v, 1)} %</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${rows.length * rh + 6}" class="rsk-chart" role="img" aria-label="Sensibilidad">${o}</svg>`;
}
function heat(E) {
  if (!E || !Object.keys(E).length) return `<div class="hint">Sin eventos suficientes.</div>`;
  const cols = [["m1", "−1 d"], ["dia", "Día"], ["m5", "+5 d"], ["m20", "+20 d"]];
  const cell = (v) => { const a = Math.min(1, Math.abs(v) / 6) * 0.8 + 0.06; return `<td class="num" style="background:${v >= 0 ? `rgba(76,183,130,${a.toFixed(2)})` : `rgba(226,98,91,${a.toFixed(2)})`}">${sgn(v, 1)}</td>`; };
  const rows = Object.entries(E).sort((a, b) => (a[0] === "defensa" ? -1 : b[0] === "defensa" ? 1 : 0)).map(([, r]) => `<tr><td>${esc(r.nombre)}</td>${cols.map(([k]) => cell(r[k])).join("")}<td class="num rsk-fa">${r.pos20} %</td></tr>`).join("");
  return `<div class="rsk-scroll"><table class="rsk-t geo-heat"><thead><tr><th>Serie</th>${cols.map(([, l]) => `<th class="num">${l}</th>`).join("")}<th class="num">Sube 20 d</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------- bloques ---------- */
function paraTi(p, G) {
  const w = new Set(watch()), seg = new Set(window.SCRRisk?.followed?.() || []);
  const mine = (p.syms || []).filter((s) => w.has(s)), bol = (p.bolsas || []).filter((b) => seg.has(b));
  const names = (window.SCRRisk?.data?.()?.mercados) || {};
  const out = [];
  if (mine.length) out.push(`En tu Watchlist: ${mine.map((s) => `<button class="link-btn" data-sym="${esc(s)}">${esc(s)}</button>`).join(", ")}.`);
  if (bol.length) out.push(`Afecta a bolsas que sigues: ${bol.map((b) => esc(names[b]?.nombre || b)).join(", ")}.`);
  if (!out.length && p.syms?.length) out.push(`Ninguno de tus valores; valores implicados: ${p.syms.slice(0, 5).map((s) => `<button class="link-btn" data-sym="${esc(s)}">${esc(s)}</button>`).join(", ")}.`);
  if (!out.length) out.push("No afecta directamente a tus valores ni a las bolsas que sigues.");
  return out.join(" ");
}
function pistasBox(G) {
  const P = G.pistas || [];
  if (!P.length) return `<section class="rsk-p"><h3>Pistas activas</h3><div class="hint">Ninguna señal geopolítica activa hoy: el riesgo no se aparta de lo normal ni hay divergencias en defensa.</div></section>`;
  return `<section class="rsk-p"><h3>Pistas activas <span>señal → precedente histórico → efecto en tus valores → qué hacer</span></h3><div class="geo-pistas">${P.map((p) => `
    <div class="geo-pista ${EST[p.estado] || "nu"}"><div class="geo-ph"><b>${esc(p.titulo)}</b><span class="ui-pill ${EST[p.estado] || "nu"}">${esc(p.estado)}</span></div>
      <table class="rsk-kv"><tr><td>Señal</td><td>${esc(p.senal)}</td></tr><tr><td>Precedente</td><td>${esc(p.precedente)}</td></tr>
      <tr><td>Para ti</td><td>${paraTi(p, G)}</td></tr><tr><td>Qué hacer</td><td class="geo-acc">${esc(p.accion)}</td></tr></table></div>`).join("")}</div></section>`;
}
function flowBox(G) {
  const Rk = window.SCRRisk?.data?.()?.mercados || {};
  const pr = Object.values(Rk).map((T) => T.prueba_gpr).filter(Boolean);
  const mej = pr.filter((x) => x.con != null && x.sin != null && x.con > x.sin).length, val = pr.filter((x) => x.valida_con).length;
  const t1 = pr.length ? `Probado en el examen 2016-2026: con el GPR mejora en ${mej} de ${pr.length} bolsas y validaría ${val}. ${val ? "Pendiente de tu decisión para incluirlo." : "No entra: no aprueba el examen."}` : "Se probará en la próxima actualización del termómetro.";
  const items = [["1 · Termómetro", t1], ["2 · Tus valores", "Sensibilidad de cada valor al GPR, descontando su bolsa: columna «Geopolítica» en «Hoy»."],
    ["3 · Stress test", "Escenarios «escalada rusa», «paz en Ucrania» y «China-Taiwán» con estas sensibilidades (fase 3)."], ["4 · Avisos", "Pistas activas y países que cruzan el percentil 95."]];
  return `<section class="rsk-p"><h3>Cómo entra en tus análisis</h3><div class="geo-flow">${items.map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join("")}</div></section>`;
}
function kpis(G) {
  const g = G.global || {}, B = G.defensa;
  const k = (l, v, d) => `<div class="geo-k"><span>${l}</span><b class="num">${v}</b><small>${d}</small></div>`;
  return `<div class="geo-kpis">${k("GPR global (mensual)", nf(g.valor, 0), `percentil ${g.pct ?? "—"} desde 1985 · ${fm(g.ultimo_mes)}`)}
    ${k("GPR diario (7 días)", nf(g.media7, 0), `percentil ${g.pct7 ?? "—"} · tendencia ${esc(g.tendencia || "—")} · ${g.ultimo_dia ? fmtDate(g.ultimo_dia) : "—"}`)}
    ${k("Amenazas / actos", `${nf(g.amenazas, 0)} / ${nf(g.actos, 0)}`, g.amenazas && g.actos ? (g.amenazas > g.actos * 1.15 ? "pesan más las amenazas" : g.actos > g.amenazas * 1.15 ? "pesan más los hechos" : "equilibrado") : "—")}
    ${B ? k("Defensa Europa desde máximo 3 m", pc(B.dd3m, 0), `${pc(B.r1a, 0)} en un año · ${B.valores.length} valores`) : ""}</div>`;
}
function paisesBox(G) {
  const P = (G.paises || []).slice(0, 14);
  const rows = P.map((p) => `<tr><td>${esc(p.nombre)}</td>${p.ult4.map((x) => `<td class="num rsk-fa">${x[1]}</td>`).join("")}<td style="width:90px"><div class="rsk-bar"><i style="width:${p.pct}%;background:${p.pct >= 90 ? "var(--neg)" : p.pct >= 70 ? "var(--warn)" : "var(--muted)"}"></i></div></td><td class="num ${p.d3 > 0 ? "neg" : "pos"}">${p.d3 != null ? `${sgn(p.d3, 0)} %` : "—"}</td></tr>`).join("");
  const hd = P[0]?.ult4.map((x) => `<th class="num">${fm(x[0])}</th>`).join("") || "";
  return `<section class="rsk-p"><h3>Por país <span>percentil de su propia historia · cambio frente a los 3 meses previos</span></h3>
    <div class="rsk-scroll"><table class="rsk-t"><thead><tr><th>País</th>${hd}<th>Nivel</th><th class="num">3 m</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${exp("<b>Cómo leerlo.</b> Cada país se compara con su propia historia (percentil), porque el volumen de noticias de cada país es muy distinto. Un percentil de 95 significa que el riesgo en ese país está más alto que el 95 % de los meses desde 1985.")}</section>`;
}
function rearmeBox(G) {
  const B = G.defensa;
  return `<section class="rsk-p"><h3>Rearme europeo</h3>
    <ul class="geo-facts">${(G.rearme || []).map((r) => `<li>${esc(r.dato)}${H.ui.fuente(r.fuente, r.url)}</li>`).join("")}</ul>
    ${B ? `<h3 class="rsk-h2">Cesta de defensa europea <span>equiponderada · desde ${fmtDate(B.desde)}</span></h3>${line(B.serie, 420, 120, "var(--accent)", "Cesta de defensa")}
      <div class="rsk-src">${Object.entries(B.nombres || {}).map(([t, n]) => `<button class="link-btn" data-sym="${esc(t)}">${esc(n)}</button>`).join(" · ")}</div>
      ${B.precedente ? `<div class="method">Precedente: ${B.precedente.n} caídas de más del 10 % desde su máximo de 3 meses; a 6 meses, ${sgn(B.precedente.media6m, 1)} % de media y ${B.precedente.positivos} % en positivo.</div>` : ""}` : ""}</section>`;
}
function sensBox(G) {
  const SB = Object.values(G.sens_bolsas || {}).sort((a, b) => a.beta2 - b.beta2);
  const ST = Object.entries(G.sectores || {}).sort((a, b) => b[1].mediana - a[1].mediana);
  return `<section class="rsk-p"><h3>Sensibilidad a un sobresalto geopolítico <span>rentabilidad media del mes si el GPR sube 2 desviaciones · 2000-${(G.global?.ultimo_mes || "").slice(0, 4)}</span></h3>
    ${SB.length ? bars(SB.map((x) => [x.nombre, x.beta2, x.t])) : `<div class="hint">Sin datos.</div>`}
    ${ST.length ? `<h3 class="rsk-h2">Por sectores <span>mediana de los valores del universo · descontando su bolsa · 5 años</span></h3>
      <div class="rsk-scroll"><table class="rsk-t"><thead><tr><th>Sector</th><th class="num">Mediana</th><th class="num">Valores</th><th class="num">Ganan</th><th class="num">Significativos</th></tr></thead><tbody>
      ${ST.map(([s, x]) => `<tr><td>${esc(s)}</td><td class="num ${x.mediana >= 0 ? "pos" : "neg"}">${sgn(x.mediana, 2)} %</td><td class="num">${x.n}</td><td class="num">${x.positivos} %</td><td class="num rsk-fa">${x.significativos}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${exp("<b>Cómo se calcula.</b> Regresión de las rentabilidades mensuales sobre el cambio del índice GPR (estandarizado). En los valores se descuenta el movimiento de su bolsa, para aislar el efecto geopolítico. En gris, efectos no significativos (t &lt; 2): con 5 años de datos mensuales, la mayoría de valores no tienen una sensibilidad clara, y se dice.")}</section>`;
}
function eventsBox(G) {
  const E = G.eventos || {}, F = G.fechas_eventos || {};
  return `<section class="rsk-p"><h3>Qué pasa tras un sobresalto <span>% medio desde 5 sesiones antes</span></h3>
    <div class="geo-ev"><div><h4>Escaladas <span>${(F.escalada || []).length} desde ${(F.escalada || [])[0]?.slice(0, 4) || "—"}</span></h4>${heat(E.escalada)}</div>
    <div><h4>Relajaciones <span>${(F.relajacion || []).length} desde ${(F.relajacion || [])[0]?.slice(0, 4) || "—"}</span></h4>${heat(E.relajacion)}</div></div>
    ${exp("<b>Eventos.</b> Escalada: el GPR diario (media de 7 días) supera el percentil 98 de los 3 años previos. Relajación: la media de 30 días cae por debajo del 70 % de su último pico alto. Reglas fijas, sin elegir los episodios a mano.")}</section>`;
}
function valoresBox(G) {
  const w = watch(), S = G.sens_valores || {};
  if (!w.length) return "";
  const rows = w.filter((s) => S[s]).slice(0, 15).map((s) => { const [b, t] = S[s]; return `<tr><td><button class="link-btn" data-sym="${esc(s)}">${esc(s)}</button></td><td class="num ${Math.abs(t) < 2 ? "rsk-fa" : b >= 0 ? "pos" : "neg"}">${sgn(b, 1)} %</td><td class="num rsk-fa">${nf(t, 1)}</td><td>${Math.abs(t) < 2 ? "Sin efecto claro" : b >= 0 ? "Gana con escalada" : "Pierde con escalada"}</td></tr>`; }).join("");
  return rows ? `<section class="rsk-p"><h3>Tus valores <span>sensibilidad al GPR descontando su bolsa</span></h3><div class="rsk-scroll"><table class="rsk-t"><thead><tr><th>Valor</th><th class="num">+2σ GPR</th><th class="num">t</th><th>Lectura</th></tr></thead><tbody>${rows}</tbody></table></div></section>` : "";
}

function render() {
  ensure();
  window.SCRRisk?.ensure?.();
  if (R.d === undefined) return `<div class="skel" style="height:420px"></div>`;
  const G = R.d;
  if (!G?.mensual) return `<div class="pg-head"><h1>Geopolítica</h1></div><div class="box">Todavía no hay datos de geopolítica: se generan en la próxima actualización automática.</div>`;
  return `<div class="pg-head"><h1>Geopolítica</h1><div class="pg-sub">Qué significa el riesgo geopolítico para tus valores y qué hacer · índice GPR de Caldara e Iacoviello (Fed) · mensual ${fm(G.global?.ultimo_mes)}, diario ${G.global?.ultimo_dia ? fmtDate(G.global.ultimo_dia) : "—"}${G.errores?.length ? ` · <span class="stale-txt" data-tip="${esc(G.errores.map((e) => `${e.serie}: ${e.motivo}`).join(" · "))}">${G.errores.length} aviso(s)</span>` : ""}</div></div>
    ${pistasBox(G)}
    ${flowBox(G)}
    ${kpis(G)}
    <div class="rsk-top geo-top"><section class="rsk-p"><h3>Índice de riesgo geopolítico 1985-${(G.global?.ultimo_mes || "").slice(0, 4)} <span>mensual · picos marcados</span></h3>${gprChart(G)}
      <h3 class="rsk-h2">Últimos 400 días <span>diario</span></h3>${line(G.diario, 900, 110, "var(--accent)", "GPR diario")}
      ${H.ui.fuente(G.fuente, G.url)}</section>${paisesBox(G)}</div>
    <div class="geo-3">${sensBox(G)}${eventsBox(G)}${rearmeBox(G)}</div>
    ${valoresBox(G)}
    <div class="rsk-read">${H.ui.conjunta(G.lectura, "Geopolítica")}</div>`;
}

/* columna «Geopolítica» de «Hoy» */
function cell(sym) {
  ensure();
  const v = R.d?.sens_valores?.[sym];
  if (!v) return null;
  const [b, t] = v;
  return Math.abs(t) < 2 ? `<span class="hy-fa" data-tip="Sin efecto claro (t = ${nf(t, 1)})">neutral</span>` : `<span class="${b >= 0 ? "pos" : "neg"}" data-tip="Rentabilidad del mes si el GPR sube 2 desviaciones, descontando su bolsa (t = ${nf(t, 1)})">${b >= 0 ? "gana" : "pierde"} ${sgn(b, 1)} %</span>`;
}

H.modules.geopolitica = render;
window.SCRGeo = { ensure, data: () => R.d, cell };
})();
