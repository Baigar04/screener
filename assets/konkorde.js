/* Screener · indicador Konkorde (versión clásica de Blai5), calculado con precio y volumen diarios.
   Componentes:
   - Azul (manos fuertes): oscilador del NVI, índice de volumen negativo. Solo cambia los días en que el volumen baja,
     cuando se supone que opera el dinero institucional.
   - Verde (manos débiles): tendencia (marrón) + oscilador del PVI, índice de volumen positivo. Cambia los días de volumen al alza.
   - Marrón (tendencia): media de RSI (14), MFI (14), oscilador de Bollinger (25, 2) y estocástico (21, 3).
   - Media: EMA de 15 sesiones del marrón; su cruce con el marrón se usa como señal de cambio de tendencia.
   Precio de referencia: (apertura + máximo + mínimo + cierre) / 4. */
(() => {
"use strict";
const M = 15, LOOK = 90;

function ema(a, n) {
  const o = new Array(a.length).fill(null), k = 2 / (n + 1); let p = null, seed = [];
  for (let i = 0; i < a.length; i++) {
    const v = a[i]; if (v == null || !isFinite(v)) { o[i] = p; continue; }
    if (p == null) { seed.push(v); if (seed.length === n) { p = seed.reduce((x, y) => x + y, 0) / n; o[i] = p; } continue; }
    p = v * k + p * (1 - k); o[i] = p;
  }
  return o;
}
function sma(a, n) { const o = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rolling(a, n, fn) { const o = new Array(a.length).fill(null); for (let i = n - 1; i < a.length; i++) { const w = a.slice(i - n + 1, i + 1).filter((v) => v != null); if (w.length) o[i] = fn(w); } return o; }
function rsi(a, n) {
  const o = new Array(a.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); continue; }
    g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return o;
}

function calc(D) {
  const n = D.c.length, tp = new Array(n), v = D.v.map((x) => x ?? 0);
  for (let i = 0; i < n; i++) tp[i] = (D.o[i] + D.h[i] + D.l[i] + D.c[i]) / 4;
  /* PVI y NVI: suman el cambio porcentual del cierre ponderado por volumen solo los días de volumen al alza (PVI) o a la baja (NVI) */
  const pvi = new Array(n).fill(0), nvi = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const ch = D.c[i - 1] ? (D.c[i] - D.c[i - 1]) / D.c[i - 1] : 0;
    pvi[i] = v[i] > v[i - 1] ? pvi[i - 1] + ch * v[i] : pvi[i - 1];
    nvi[i] = v[i] < v[i - 1] ? nvi[i - 1] + ch * v[i] : nvi[i - 1];
  }
  const osc = (x) => {
    const m = ema(x, M), mx = rolling(m, LOOK, (w) => Math.max(...w)), mn = rolling(m, LOOK, (w) => Math.min(...w));
    return x.map((val, i) => (m[i] == null || mx[i] == null || mx[i] === mn[i] ? null : ((val - m[i]) * 100) / (mx[i] - mn[i])));
  };
  const oscp = osc(pvi), azul = osc(nvi);
  /* MFI (14) sobre el precio típico */
  const mfi = new Array(n).fill(null);
  for (let i = 14; i < n; i++) {
    let pos = 0, neg = 0;
    for (let j = i - 13; j <= i; j++) { const d = tp[j] - tp[j - 1]; if (d > 0) pos += v[j] * tp[j]; else if (d < 0) neg += v[j] * tp[j]; }
    mfi[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  /* Oscilador de Bollinger (25, 2): posición del precio dentro de las bandas, en % de su anchura */
  const basis = sma(tp, 25), bosc = new Array(n).fill(null);
  for (let i = 24; i < n; i++) {
    let s = 0; for (let j = i - 24; j <= i; j++) s += (tp[j] - basis[i]) ** 2;
    const dev = 2 * Math.sqrt(s / 25), width = 2 * dev;
    bosc[i] = width ? ((tp[i] - basis[i]) / width) * 100 : 0;
  }
  const r = rsi(tp, 14);
  /* Estocástico (21, 3) */
  const kRaw = new Array(n).fill(null);
  for (let i = 20; i < n; i++) {
    let hh = -Infinity, ll = Infinity; for (let j = i - 20; j <= i; j++) { hh = Math.max(hh, D.h[j]); ll = Math.min(ll, D.l[j]); }
    kRaw[i] = hh === ll ? 50 : (100 * (tp[i] - ll)) / (hh - ll);
  }
  const stoc = rolling(kRaw, 3, (w) => w.reduce((a, b) => a + b, 0) / w.length);
  const marron = tp.map((_, i) => (r[i] == null || mfi[i] == null || bosc[i] == null || stoc[i] == null ? null : (r[i] + mfi[i] + bosc[i] + stoc[i] / 3) / 2));
  const verde = marron.map((m, i) => (m == null || oscp[i] == null ? null : m + oscp[i]));
  const media = ema(marron, M);
  return { verde, marron, azul, media };
}

function draw(chart, LW, D, pane, series) {
  const k = calc(D), T = D.t;
  const pts = (arr) => arr.map((v, i) => (v == null || !isFinite(v) ? null : { time: T[i], value: v })).filter(Boolean);
  const area = (key, arr, col, label) => {
    const s = chart.addSeries(LW.BaselineSeries, {
      baseValue: { type: "price", price: 0 }, topLineColor: col, bottomLineColor: col, topFillColor1: col + "99", topFillColor2: col + "55",
      bottomFillColor1: col + "55", bottomFillColor2: col + "99", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    }, pane);
    s.setData(pts(arr)); series[label] = { s, arr, color: col }; return s;
  };
  area("verde", k.verde, "#3fbf6f", "Manos débiles");
  area("marron", k.marron, "#c08a5b", "Tendencia");
  area("azul", k.azul, "#2fa4e7", "Manos fuertes");
  const m = chart.addSeries(LW.LineSeries, { color: "#e5484d", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
  m.setData(pts(k.media)); series["Media"] = { s: m, arr: k.media, color: "#e5484d" };
}

window.SCRKonkorde = { calc, draw };
})();
