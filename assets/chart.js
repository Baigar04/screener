/* Screener · gráfico de cotización interactivo (TradingView Lightweight Charts v5, código abierto, Apache-2.0). */
(() => {
"use strict";

const LIB_LOCAL = "assets/vendor/lightweight-charts.js";
const LIB_CDN = "https://unpkg.com/lightweight-charts@5.0.0/dist/lightweight-charts.standalone.production.js";
const PERIODS = [["1M", 21], ["3M", 63], ["6M", 126], ["1A", 252], ["5A", 1e9]];
const DEF_CFG = {
  type: "velas", period: "1A",
  ind: {
    sma1: { on: true, n: 50 }, sma2: { on: true, n: 200 }, ema: { on: false, n: 21 }, dema: { on: false, n: 21 },
    bb: { on: false, n: 20, k: 2 }, vol: { on: true }, rsi: { on: false, n: 14 }, macd: { on: false, f: 12, s: 26, g: 9 },
    konkorde: { on: false }, eventos: { on: true },
  },
  ev: { ern: true, news: true, div: true, cong: true, pf: true },
};
const EV_TYPES = [["ern", "Resultados"], ["news", "Noticias"], ["div", "Dividendos"], ["cong", "Congreso de EE. UU."], ["pf", "Entradas de tus carteras"]];
const IND_META = {
  sma1: ["SMA", "Media móvil simple", [["n", "Periodo", 2, 400]]],
  sma2: ["SMA 2", "Segunda media móvil simple", [["n", "Periodo", 2, 400]]],
  ema: ["EMA", "Media móvil exponencial: pesa más los datos recientes", [["n", "Periodo", 2, 400]]],
  dema: ["DEMA", "Doble media exponencial: 2·EMA − EMA(EMA), con menos retraso", [["n", "Periodo", 2, 400]]],
  bb: ["Bollinger", "Media ± k desviaciones típicas: mide la volatilidad", [["n", "Periodo", 5, 200], ["k", "Desviaciones", 1, 4]]],
  vol: ["Volumen", "Acciones negociadas por sesión", []],
  rsi: ["RSI", "Fuerza relativa 0-100: > 70 sobrecompra, < 30 sobreventa", [["n", "Periodo", 2, 100]]],
  macd: ["MACD", "Diferencia de dos EMA y su señal: impulso de la tendencia", [["f", "Rápida", 2, 100], ["s", "Lenta", 3, 200], ["g", "Señal", 2, 50]]],
  eventos: ["Eventos", "Franja de eventos bajo el volumen: rombo = resultados, punto = noticias, círculo = dividendo. Pasa el ratón por encima para ver el detalle; pulsa para fijarlo", []],
  konkorde: ["Konkorde", "Manos fuertes (azul), débiles (verde), tendencia (marrón) y su media (roja), a partir de precio y volumen", []],
};

function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem("chart_cfg") || "null");
    if (!c) return structuredClone(DEF_CFG);
    const out = structuredClone(DEF_CFG);
    Object.assign(out, { type: c.type || out.type, period: c.period || out.period, escala: c.escala === "log" ? "log" : "normal" });
    for (const k in out.ind) Object.assign(out.ind[k], c.ind?.[k] || {});
    return out;
  } catch (e) { return structuredClone(DEF_CFG); }
}
function saveCfg(c) { try { localStorage.setItem("chart_cfg", JSON.stringify(c)); } catch (e) { /* */ } }

let libPromise = null;
function loadLib() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (libPromise) return libPromise;
  const add = (src) => new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.async = true;
    s.onload = () => (window.LightweightCharts ? res(window.LightweightCharts) : rej(new Error("librería vacía")));
    s.onerror = () => rej(new Error("no se pudo cargar " + src)); document.head.appendChild(s);
  });
  libPromise = add(LIB_LOCAL).catch(() => add(LIB_CDN)).catch((e) => { libPromise = null; throw e; });
  return libPromise;
}

const cache = new Map();
async function loadPrices(sym) {
  if (cache.has(sym)) return cache.get(sym);
  const r = await fetch(`data/p/${encodeURIComponent(sym)}.json`);
  if (!r.ok) throw new Error(r.status === 404 ? "nohist" : "HTTP " + r.status);
  const d = await r.json();
  cache.set(sym, d);
  return d;
}

/* ---------- cálculo de indicadores ---------- */
function sma(a, n) {
  const o = new Array(a.length).fill(null); let s = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]; if (v == null) continue;
    s += v; k++;
    if (k > n) { s -= a[i - n] ?? 0; }
    if (k >= n) o[i] = s / n;
  }
  return o;
}
function ema(a, n) {
  const o = new Array(a.length).fill(null), al = 2 / (n + 1);
  let prev = null, seed = [], i0 = a.findIndex((v) => v != null);
  if (i0 < 0) return o;
  for (let i = i0; i < a.length; i++) {
    const v = a[i]; if (v == null) { o[i] = prev; continue; }
    if (prev == null) { seed.push(v); if (seed.length === n) { prev = seed.reduce((x, y) => x + y, 0) / n; o[i] = prev; } continue; }
    prev = v * al + prev * (1 - al); o[i] = prev;
  }
  return o;
}
function dema(a, n) { const e1 = ema(a, n), e2 = ema(e1, n); return e1.map((v, i) => (v == null || e2[i] == null ? null : 2 * v - e2[i])); }
function boll(a, n, k) {
  const m = sma(a, n), up = [], lo = [];
  for (let i = 0; i < a.length; i++) {
    if (m[i] == null) { up.push(null); lo.push(null); continue; }
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += (a[j] - m[i]) ** 2;
    const sd = Math.sqrt(s / n); up.push(m[i] + k * sd); lo.push(m[i] - k * sd);
  }
  return { m, up, lo };
}
function rsi(a, n) {
  const o = new Array(a.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); continue; }
    g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
    o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return o;
}
function macd(a, f, s, g) {
  const ef = ema(a, f), es = ema(a, s);
  const m = ef.map((v, i) => (v == null || es[i] == null ? null : v - es[i]));
  const sig = ema(m, g);
  return { m, sig, h: m.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i])) };
}

/* ---------- utilidades ---------- */
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || undefined;
const fmt = (v, d = 2) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtVol = (v) => (v == null ? "—" : v >= 1e9 ? fmt(v / 1e9, 2) + " mil M" : v >= 1e6 ? fmt(v / 1e6, 1) + " M" : v >= 1e3 ? fmt(v / 1e3, 0) + " k" : fmt(v, 0));
const line = (t, arr) => arr.map((v, i) => (v == null ? null : { time: t[i], value: v })).filter(Boolean);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PAL = { sma1: "#f5a524", sma2: "#a78bfa", ema: "#22d3ee", dema: "#f472b6", bb: "#8b95a5" };

function baseOptions(LW) {
  return {
    autoSize: true,
    layout: { background: { type: LW.ColorType.Solid, color: css("--surface") }, textColor: css("--muted"), fontFamily: css("--font"), fontSize: 11,
      panes: { separatorColor: css("--border"), separatorHoverColor: css("--border-strong") } },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    crosshair: { mode: LW.CrosshairMode.Normal },
    rightPriceScale: { borderColor: css("--border") },
    timeScale: { borderColor: css("--border"), rightOffset: 4, minBarSpacing: 0.5 },
    localization: { locale: "es-ES", priceFormatter: (p) => (Math.abs(p) >= 1e5 ? fmtVol(p) : fmt(p, Math.abs(p) < 10 ? 3 : 2)) },
  };
}

/* ---------- gráfico de un valor ---------- */
async function mount(el, sym, opts = {}) {
  const cfg = loadCfg();
  cfg.ev = { ...DEF_CFG.ev, ...(cfg.ev || {}) };
  el.innerHTML = `<div class="cx"><div class="cx-bar"></div><div class="cx-wrap"><div class="cx-legend"></div><div class="cx-chart"></div></div><div class="cx-note"></div></div>`;
  const root = el.querySelector(".cx"), bar = el.querySelector(".cx-bar"), host = el.querySelector(".cx-chart"),
    legend = el.querySelector(".cx-legend"), note = el.querySelector(".cx-note");
  host.innerHTML = `<div class="skel" style="height:100%"></div>`;
  let LW, D;
  try { [LW, D] = await Promise.all([loadLib(), loadPrices(sym)]); } catch (e) {
    host.innerHTML = "";
    if (e.message === "nohist") {
      root.innerHTML = `<div class="err-box"><b>Sin histórico diario para ${esc(sym)}.</b> Ni Yahoo Finance ni el respaldo (Tiingo, solo valores de EE. UU.) devolvieron precios en la última actualización.</div>`;
    } else {
      root.innerHTML = `<div class="err-box"><b>No se pudo cargar el gráfico interactivo.</b> ${esc(e.message)}. ${opts.fallback || ""}</div>`;
    }
    return null;
  }
  host.innerHTML = "";
  let chart = null, main = null, series = {}, draw = null, drTool = "cursor", drMag = true;
  const T = D.t, C = D.c;

  function toolbar() {
    bar.innerHTML = `<div class="seg seg-s">${[["velas", "Velas"], ["linea", "Línea"]].map(([k, t]) => `<button data-cx-type="${k}" class="${cfg.type === k ? "on" : ""}">${t}</button>`).join("")}</div>
      <div class="seg seg-s">${PERIODS.map(([p]) => `<button data-cx-per="${p}" class="${cfg.period === p ? "on" : ""}">${p}</button>`).join("")}</div>
      <div class="dd cx-ind"><button class="dd-btn"><span class="lab">Indicadores</span> ${Object.values(cfg.ind).filter((x) => x.on).length} ▾</button>
        <div class="dd-menu cx-menu">${Object.entries(IND_META).filter(([k]) => k !== "konkorde" || window.SCRKonkorde).map(([k, [t, d, ps]]) => `<div class="cx-row">
          <label data-tip="${esc(d)}"><input type="checkbox" data-cx-on="${k}" ${cfg.ind[k].on ? "checked" : ""}> ${t}${k === "konkorde" ? " " + window.SCR.evid("h") : ""}</label>
          <span>${ps.map(([p, pl, mn, mx]) => `<input type="number" class="cx-num" data-cx-p="${k}.${p}" value="${cfg.ind[k][p]}" min="${mn}" max="${mx}" step="${p === "k" ? 0.5 : 1}" title="${pl}" aria-label="${t} ${pl}">`).join("")}</span></div>`).join("")}
          <div class="cx-row"><button class="chip" data-cx-reset="1">Restablecer</button></div></div></div>
      <div class="dd cx-ind cx-evdd"><button class="dd-btn"><span class="lab">Eventos</span> ▾</button>
        <div class="dd-menu cx-menu">${EV_TYPES.map(([k, t]) => `<div class="cx-row"><label><input type="checkbox" data-cx-ev="${k}" ${cfg.ev[k] ? "checked" : ""} ${cfg.ind.eventos?.on === false ? "disabled" : ""}> ${t}</label></div>`).join("")}</div></div>
      ${window.SCRDraw ? window.SCRDraw.toolbarHtml(drTool, drMag) : ""}
      <span style="flex:1"></span>
      <button class="icon-btn" data-cx-fs="1" title="Pantalla completa" aria-label="Pantalla completa"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>`;
  }

  function build() {
    if (chart) { try { chart.remove(); } catch (e) { /* */ } }
    host.innerHTML = "";
    chart = LW.createChart(host, baseOptions(LW));
    series = {};
    const up = css("--pos"), dn = css("--neg");
    if (cfg.type === "velas") {
      main = chart.addSeries(LW.CandlestickSeries, { upColor: up, downColor: dn, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn });
      main.setData(T.map((t, i) => (D.o[i] == null || C[i] == null ? null : { time: t, open: D.o[i], high: D.h[i], low: D.l[i], close: C[i] })).filter(Boolean));
    } else {
      const acc = css("--accent") || "#4c6fff", rgb = (() => { const h = acc.replace("#", ""); const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; })();
      /* sombreado suave bajo la línea: degradado del 14 % de opacidad a transparente */
      main = LW.AreaSeries
        ? chart.addSeries(LW.AreaSeries, { lineColor: acc, lineWidth: 2, topColor: `rgba(${rgb},0.14)`, bottomColor: `rgba(${rgb},0)`, crosshairMarkerRadius: 4 })
        : chart.addSeries(LW.LineSeries, { color: acc, lineWidth: 2 });
      main.setData(line(T, C));
    }
    const I = cfg.ind, addL = (key, arr, color, w = 1.5, pane = 0, extra = {}) => {
      const s = chart.addSeries(LW.LineSeries, { color, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra }, pane);
      s.setData(line(T, arr)); series[key] = { s, arr, color }; return s;
    };
    if (I.sma1.on) addL("SMA " + I.sma1.n, sma(C, +I.sma1.n), PAL.sma1);
    if (I.sma2.on) addL("SMA " + I.sma2.n, sma(C, +I.sma2.n), PAL.sma2);
    if (I.ema.on) addL("EMA " + I.ema.n, ema(C, +I.ema.n), PAL.ema);
    if (I.dema.on) addL("DEMA " + I.dema.n, dema(C, +I.dema.n), PAL.dema);
    if (I.bb.on) {
      const b = boll(C, +I.bb.n, +I.bb.k);
      addL("BB sup", b.up, PAL.bb, 1, 0, { lineStyle: LW.LineStyle.Dashed });
      addL("BB media", b.m, PAL.bb, 1);
      addL("BB inf", b.lo, PAL.bb, 1, 0, { lineStyle: LW.LineStyle.Dashed });
    }
    let pane = 0;
    const heights = [];
    evLane = I.eventos?.on !== false ? 0 : null;   // panel que aloja el carril (0 = bajo las velas si no hay volumen)
    if (evLane === 0) { try { main.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.14 } }); } catch (e) { /* */ } }
    if (I.vol.on && D.v) {
      pane++;
      /* escala propia superpuesta: los márgenes se respetan y la parte baja queda libre para el carril de eventos */
      const evOn = I.eventos?.on !== false;
      const s = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false, priceScaleId: "vol" }, pane);
      try { s.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: evOn ? 0.38 : 0 } }); } catch (e) { /* */ }
      s.setData(T.map((t, i) => (D.v[i] == null ? null : { time: t, value: D.v[i], color: (C[i] >= (C[i - 1] ?? C[i]) ? up : dn) + "88" })).filter(Boolean));
      series["Volumen"] = { s, arr: D.v, color: css("--muted"), vol: true };
      /* franja inferior del panel de volumen reservada al carril de eventos (capa HTML, sin escala) */
      if (I.eventos?.on !== false) {
        evLane = pane;
        try { main.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.06 } }); } catch (e) { /* */ }
        heights.push(100);
      } else heights.push(70);
    }
    if (I.rsi.on) {
      pane++;
      const s = addL("RSI " + I.rsi.n, rsi(C, +I.rsi.n), "#a78bfa", 1.5, pane);
      [70, 30].forEach((p) => s.createPriceLine({ price: p, color: css("--faint"), lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: false }));
      heights.push(90);
    }
    if (I.macd.on) {
      pane++;
      const m = macd(C, +I.macd.f, +I.macd.s, +I.macd.g);
      const h = chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
      h.setData(T.map((t, i) => (m.h[i] == null ? null : { time: t, value: m.h[i], color: (m.h[i] >= 0 ? up : dn) + "99" })).filter(Boolean));
      series["MACD hist"] = { s: h, arr: m.h, color: css("--muted") };
      addL("MACD", m.m, "#22d3ee", 1.5, pane); addL("Señal", m.sig, "#f5a524", 1.2, pane);
      heights.push(100);
    }
    if (I.konkorde.on && window.SCRKonkorde) {
      pane++;
      try { window.SCRKonkorde.draw(chart, LW, D, pane, series); heights.push(110); } catch (e) { note.textContent = "Konkorde: " + e.message; }
    }
    const wrap = host.parentElement, mainH = window.innerWidth < 640 ? 300 : 380;
    if (!root.classList.contains("fs") && !document.fullscreenElement) wrap.style.height = mainH + heights.reduce((a, b) => a + b, 0) + "px";
    requestAnimationFrame(() => { try { const ps = chart.panes(); heights.forEach((h, i) => ps[i + 1]?.setHeight(h)); } catch (e) { /* sin paneles ajustables */ } requestAnimationFrame(layoutLane); });
    applyScale();
    addEvents();
    setPeriod();
    chart.subscribeCrosshairMove((p) => showLegend(p));
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => layoutLane());
    showLegend(null);
  }

  /* escala de precios del panel principal: normal o logarítmica (menú del botón derecho) */
  function applyScale() {
    /* solo la escala de la serie de precio; volumen, RSI, MACD y Konkorde quedan en escala normal */
    const N = LW.PriceScaleMode.Normal, L = LW.PriceScaleMode.Logarithmic;
    try { main.priceScale().applyOptions({ mode: cfg.escala === "log" ? L : N }); } catch (e) { /* */ }
    Object.values(series).forEach((v) => { try { if (v.s && v.s !== main && v.s.priceScale() !== main.priceScale()) v.s.priceScale().applyOptions({ mode: N }); } catch (e) { /* */ } });
    try { chart.panes().slice(1).forEach((pn) => pn.getSeries().forEach((x) => x.priceScale().applyOptions({ mode: N }))); } catch (e) { /* */ }
  }
  const ctx = document.createElement("div"); ctx.className = "cx-ctx"; ctx.hidden = true;
  host.parentElement.appendChild(ctx);
  const closeCtx = () => { ctx.hidden = true; };
  host.parentElement.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".dr-pop,.dr-modal")) return;
    e.preventDefault();
    const it = (k, t) => `<button data-cx-esc="${k}" class="${cfg.escala === k ? "on" : ""}"><span class="ck">${cfg.escala === k ? "✓" : ""}</span>${t}</button>`;
    ctx.innerHTML = `<div class="cx-ctx-h">Escala de precios</div>${it("normal", "Normal")}${it("log", "Logarítmica")}
      <div class="cx-ctx-sep"></div><button data-cx-fit="1"><span class="ck"></span>Restablecer vista</button>`;
    const r = host.parentElement.getBoundingClientRect();
    ctx.hidden = false;
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = Math.max(4, Math.min(e.clientX - r.left, r.width - w - 4)) + "px";
    ctx.style.top = Math.max(4, Math.min(e.clientY - r.top, r.height - h - 4)) + "px";
  });
  ctx.addEventListener("click", (e) => {
    e.stopPropagation(); let b;
    if ((b = e.target.closest("[data-cx-esc]"))) { cfg.escala = b.dataset.cxEsc; saveCfg(cfg); applyScale(); draw?.redraw?.(); }
    else if (e.target.closest("[data-cx-fit]")) { try { main.priceScale().applyOptions({ autoScale: true }); } catch (x) { /* */ } setPeriod(); }
    closeCtx();
  });
  document.addEventListener("pointerdown", (e) => { if (!ctx.hidden && !ctx.contains(e.target)) closeCtx(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCtx(); });

  function setPeriod() {
    const n = T.length, bars = PERIODS.find((p) => p[0] === cfg.period)[1];
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - bars) - 0.5, to: n - 1 + 3 });
  }

  function showLegend(p) {
    let i = T.length - 1;
    if (p && p.time) { const t = typeof p.time === "string" ? p.time : `${p.time.year}-${String(p.time.month).padStart(2, "0")}-${String(p.time.day).padStart(2, "0")}`; const j = T.indexOf(t); if (j >= 0) i = j; }
    const ch = i > 0 && C[i - 1] ? (C[i] / C[i - 1] - 1) * 100 : null;
    const cls = ch == null ? "" : ch >= 0 ? "p" : "n";
    const dt = new Date(T[i] + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
    let h = `<div><b class="cx-sym">${esc(sym)}</b> <span class="cx-d">${dt}</span> <span class="cx-ohlc">A ${fmt(D.o[i])} · M ${fmt(D.h[i])} · m ${fmt(D.l[i])} · C <b>${fmt(C[i])}</b></span> <span class="chg ${cls}">${ch == null ? "" : (ch >= 0 ? "+" : "") + fmt(ch) + " %"}</span></div>`;
    const extra = Object.entries(series).filter(([, v]) => v.arr && v.arr[i] != null).map(([k, v]) => `<span style="color:${v.color}">— ${k} ${v.vol ? fmtVol(v.arr[i]) : fmt(v.arr[i])}</span>`);
    if (extra.length) h += `<div class="cx-l2">${extra.join(" &nbsp; ")}</div>`;
    legend.innerHTML = h;
  }

  function onClick(e) {
    const t = e.target; let b;
    if ((b = t.closest("[data-cx-type]"))) { cfg.type = b.dataset.cxType; saveCfg(cfg); toolbar(); build(); return; }
    if ((b = t.closest("[data-cx-per]"))) { cfg.period = b.dataset.cxPer; saveCfg(cfg); toolbar(); setPeriod(); return; }
    if (t.closest("[data-cx-reset]")) { Object.assign(cfg, structuredClone(DEF_CFG)); saveCfg(cfg); toolbar(); build(); return; }
    if (t.closest("[data-cx-fs]")) { toggleFs(); return; }
    if ((b = t.closest("[data-dr-tool]")) && draw) { draw.setTool(b.dataset.drTool); return; }
    if (t.closest("[data-dr-magnet]") && draw) { draw.toggleMagnet(); return; }
    if ((b = t.closest("[data-dr-auto]")) && draw) { draw.auto(b.dataset.drAuto); b.closest(".dd")?.classList.remove("open"); return; }
    if (t.closest("[data-dr-undo]") && draw) { draw.undo(); return; }
    if (t.closest("[data-dr-clear]") && draw) { draw.clear(); return; }
    if (t.closest(".cx-ind .dd-btn")) { e.stopPropagation(); const dd = t.closest(".dd"); bar.querySelectorAll(".cx-ind.open").forEach((x) => x !== dd && x.classList.remove("open")); dd.classList.toggle("open"); return; }
    if (t.closest(".cx-menu")) e.stopPropagation();
  }
  function onChange(e) {
    const t = e.target;
    if (t.dataset.cxEv) { cfg.ev[t.dataset.cxEv] = t.checked; saveCfg(cfg); build(); return; }
    if (t.dataset.cxOn) { cfg.ind[t.dataset.cxOn].on = t.checked; }
    else if (t.dataset.cxP) {
      const [k, p] = t.dataset.cxP.split("."); let v = +t.value;
      if (!isFinite(v) || v < +t.min) v = +t.min; if (v > +t.max) v = +t.max; t.value = v; cfg.ind[k][p] = v;
    } else return;
    saveCfg(cfg); build();
    const btn = bar.querySelector(".cx-ind .dd-btn"); if (btn) btn.innerHTML = `<span class="lab">Indicadores</span> ${Object.values(cfg.ind).filter((x) => x.on).length} ▾`;
  }
  function toggleFs() {
    const fsEl = document.fullscreenElement;
    if (fsEl) { document.exitFullscreen?.(); return; }
    if (root.requestFullscreen) root.requestFullscreen().catch(() => root.classList.toggle("fs"));
    else root.classList.toggle("fs");
  }
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root.classList.contains("fs")) root.classList.remove("fs"); });
  note.innerHTML = `${esc(D.fuente || "Yahoo Finance")} · ${T.length} sesiones (${T[0]} a ${T[T.length - 1]}) · rueda o pellizco para zoom, arrastrar para desplazar`;
  const NEWS_LAB = { legal: "Legal", producto: "Producto", expansion: "Expansión / operación", resultados: "Resultados", analistas: "Analistas", directivos: "Directivos" };
  const NEWS_COL = { legal: "var(--neg)", producto: "var(--good)", expansion: "var(--pos)", resultados: "var(--accent)", analistas: "#a48bd6", directivos: "var(--muted)" };
  /* eventos: resultados, dividendos, noticias, Congreso y entradas de mis carteras */
  const EV = new Map();
  let evLane = null;
  function collectEvents() {
    EV.clear();
    const add = (d, o) => { let k = d; if (!T.includes(k)) { k = T.find((t) => t >= d); if (!k) return; } (EV.get(k) || EV.set(k, []).get(k)).push(o); };
    const sm = window.SCRSmart?.data?.()?.por_valor?.[sym];
    (sm?.c || []).forEach(([n, tp, fo, fd, imp]) => { if (fo > fd) return; const buy = tp === "Compra";
      add(fo, { kind: buy ? "cb" : "cs", txt: `${n.split(" ").slice(-1)[0]} (Congreso): ${tp.toLowerCase()} ${imp || ""}`, buy }); });
    const ev = D.ev || {};
    (ev.div || []).forEach(([d, a]) => add(d, { kind: "div", txt: `Dividendo: ${fmt(a, a < 1 ? 4 : 2)} por acción` }));
    (ev.ern || []).forEach(([d, est, rep, sur]) => { if (rep == null) return;
      add(d, { kind: "ern", txt: `Resultados: BPA ${fmt(rep)} frente a ${est == null ? "—" : fmt(est)} estimado${sur == null ? "" : ` (sorpresa ${sur > 0 ? "+" : ""}${fmt(sur, 1)} %)`}`, beat: sur == null ? null : sur >= 0 }); });
    (ev.news || []).forEach(([d, cat, title, url, src]) => { if (cat === "otras") return; add(d, { kind: "news", cat, title, url, src, txt: `${NEWS_LAB[cat] || "Noticia"}: ${title}` }); });
    try { (JSON.parse(localStorage.getItem("carteras") || "[]")).forEach((p) => p.items.forEach((x) => { if (x.sym === sym) add(p.creada.slice(0, 10), { kind: "pf", txt: `Entrada en «${p.nombre}» a ${fmt(x.p0)}`, p0: x.p0 }); })); } catch (e) { /* */ }
  }
  /* Congreso y entradas de tus carteras: marcadores discretos sobre las velas */
  function addEvents() {
    collectEvents();
    const mk = [], on = cfg.ind.eventos?.on !== false;
    if (on) EV.forEach((list, d) => {
      const b = list.filter((o) => o.kind === "cb").length, sl = list.filter((o) => o.kind === "cs").length, pf = list.some((o) => o.kind === "pf");
      if (pf && cfg.ev.pf) mk.push({ time: d, position: "belowBar", color: css("--good"), shape: "circle", size: 0.7 });
      if (b && cfg.ev.cong) mk.push({ time: d, position: "belowBar", color: css("--pos"), shape: "arrowUp", size: b > 1 ? 1 : 0.7 });
      if (sl && cfg.ev.cong) mk.push({ time: d, position: "aboveBar", color: css("--neg"), shape: "arrowDown", size: sl > 1 ? 1 : 0.7 });
    });
    mk.sort((a, b) => (a.time < b.time ? -1 : 1));
    try { if (LW.createSeriesMarkers) LW.createSeriesMarkers(main, mk); else if (main.setMarkers) main.setMarkers(mk); } catch (e) { /* sin marcadores */ }
    const pf = [...EV.values()].flat().filter((o) => o.kind === "pf");
    if (pf.length && on && cfg.ev.pf) { const avg = pf.reduce((a, o) => a + o.p0, 0) / pf.length; try { main.createPriceLine({ price: avg, color: css("--good"), lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: "Media" }); } catch (e) { /* */ } }
    paintLane();
  }

  /* ---------- carril de eventos (capa HTML): rombo = resultados, punto = noticias, círculo = dividendo ---------- */
  const NEWS_PRI = ["resultados", "legal", "analistas", "producto", "expansion", "directivos"];
  const lane = document.createElement("div"); lane.className = "cx-lane"; host.parentElement.appendChild(lane);
  const card = document.createElement("div"); card.className = "cx-card"; card.hidden = true; host.parentElement.appendChild(card);
  let pinned = null;
  function laneItems() {
    const out = [];
    EV.forEach((list, d) => {
      const er = cfg.ev.ern && list.find((o) => o.kind === "ern"), dv = cfg.ev.div && list.some((o) => o.kind === "div");
      const nw = cfg.ev.news ? list.filter((o) => o.kind === "news").sort((a, b) => NEWS_PRI.indexOf(a.cat) - NEWS_PRI.indexOf(b.cat)) : [];
      if (er || dv || nw.length) out.push({ d, er, dv, nw });
    });
    return out;
  }
  function paintLane() {
    if (evLane == null) { lane.innerHTML = ""; lane.hidden = true; return; }
    lane.hidden = false;
    const ern = (er) => `<i class="g-ern" style="border-color:${er.beat === false ? "var(--neg)" : er.beat ? "var(--pos)" : "var(--warn)"}"></i>`;
    lane.innerHTML = `<div class="cx-lane-line"></div><span class="cx-lane-lab">Eventos</span><div class="cx-guide" hidden></div>` + laneItems().map((x) => `<button class="cx-g" data-evd="${x.d}" aria-label="Eventos del ${x.d}">
      ${x.er ? ern(x.er) : ""}${x.nw.length ? `<i class="g-news${x.nw.length > 1 ? " n" : ""}" style="--c:${NEWS_COL[x.nw[0].cat] || "var(--muted)"}">${x.nw.length > 1 ? x.nw.length : ""}</i>` : ""}${x.dv ? '<i class="g-div"></i>' : ""}</button>`).join("");
    layoutLane();
  }
  function laneY() {
    try {
      const ps = chart.panes(); let y = 0;
      for (let k = 0; k < evLane; k++) y += ps[k].getHeight() + 1;
      return y + ps[evLane].getHeight() - 17;
    } catch (e) { return null; }
  }
  function layoutLane() {
    if (evLane == null || !chart) return;
    const y = laneY(); if (y == null) return;
    let w = host.clientWidth; try { w -= chart.priceScale("right").width(); } catch (e) { /* */ }
    lane.style.setProperty("--ly", y + "px"); lane.style.setProperty("--lw", w + "px");
    lane.querySelectorAll(".cx-g").forEach((g) => {
      const x = chart.timeScale().timeToCoordinate(g.dataset.evd);
      if (x == null || x < 4 || x > w - 4) { g.style.display = "none"; return; }
      g.style.display = ""; g.style.transform = `translate(${x}px,${y}px)`;
    });
    if (pinned) showCard(pinned, true);
  }
  const fdate = (d) => new Date(d + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
  function showCard(d, keep) {
    const list = EV.get(d); if (!list) return;
    const x = chart.timeScale().timeToCoordinate(d), y = laneY(); if (x == null || y == null) return;
    const er = list.find((o) => o.kind === "ern"), dv = list.find((o) => o.kind === "div");
    const nw = list.filter((o) => o.kind === "news").sort((a, b) => NEWS_PRI.indexOf(a.cat) - NEWS_PRI.indexOf(b.cat));
    const sum = [nw.length ? `${nw.length} ${nw.length === 1 ? "noticia" : "noticias"}` : "", er ? `resultados${er.beat == null ? "" : er.beat ? " (supera)" : " (decepciona)"}` : "", dv ? "dividendo" : ""].filter(Boolean).join(" · ");
    const row = (c, cat, t, src, url) => `<div class="cc-it"><i style="background:${c}"></i><span class="cc-cat">${cat}</span><span class="cc-t">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t)}</span><span class="cc-src">${esc(src || "")}</span></div>`;
    card.innerHTML = `<div class="cc-h"><b>${fdate(d)}</b><span>${sum}</span></div>
      ${er ? row(er.beat === false ? "var(--neg)" : er.beat ? "var(--pos)" : "var(--warn)", "Resultados", er.txt.replace(/^Resultados: /, ""), "Yahoo") : ""}
      ${dv ? row("var(--good)", "Dividendo", dv.txt.replace(/^Dividendo: /, ""), "Yahoo") : ""}
      ${nw.slice(0, 4).map((o) => row(NEWS_COL[o.cat] || "var(--muted)", NEWS_LAB[o.cat] || "Noticia", o.title.length > 110 ? o.title.slice(0, 110) + "…" : o.title, o.src, o.url)).join("")}
      <div class="cc-f">${nw.length > 4 ? `y ${nw.length - 4} más · ` : ""}${keep ? "fijada: pulsa fuera para cerrar" : "pulsa el punto para fijarla"}</div>`;
    card.hidden = false;
    const W = host.clientWidth, cw = card.offsetWidth, ch = card.offsetHeight;
    card.style.left = Math.max(4, Math.min(x > W / 2 ? x - cw - 14 : x + 14, W - cw - 4)) + "px";
    card.style.top = Math.max(4, y - ch - 10) + "px";
    const g = lane.querySelector(".cx-guide"); if (g) { g.hidden = false; g.style.transform = `translateX(${x}px)`; g.style.height = y - 8 + "px"; }
  }
  function hideCard() { if (pinned) return; card.hidden = true; const g = lane.querySelector(".cx-guide"); if (g) g.hidden = true; }
  lane.addEventListener("mouseover", (e) => { const g = e.target.closest(".cx-g"); if (g && !pinned) showCard(g.dataset.evd); });
  lane.addEventListener("mouseout", (e) => { const g = e.target.closest(".cx-g"); if (g && !g.contains(e.relatedTarget)) hideCard(); });
  lane.addEventListener("click", (e) => { const g = e.target.closest(".cx-g"); if (!g) return; e.stopPropagation(); pinned = pinned === g.dataset.evd ? null : g.dataset.evd; if (pinned) showCard(pinned, true); else hideCard(); });
  document.addEventListener("pointerdown", (e) => { if (pinned && !card.contains(e.target) && !e.target.closest(".cx-g")) { pinned = null; hideCard(); } }, true);
  new ResizeObserver(() => layoutLane()).observe(host);

  /* sonda: punto pulsante sobre el último cierre */
  const probe = document.createElement("div"); probe.className = "cx-probe"; probe.innerHTML = "<i></i><b></b>";
  host.parentElement.appendChild(probe);
  let probeOn = true;
  (function loop() {
    if (!probeOn || !probe.isConnected) return;
    try {
      const x = chart.timeScale().logicalToCoordinate(T.length - 1), y = main.priceToCoordinate(C[C.length - 1]);
      let w = host.clientWidth; try { w -= chart.priceScale("right").width(); } catch (e) { /* */ }
      if (x == null || y == null || x < 0 || x > w) probe.style.display = "none";
      else { probe.style.display = ""; probe.style.transform = `translate(${x}px,${y}px)`; }
    } catch (e) { probe.style.display = "none"; }
    requestAnimationFrame(loop);
  })();
  if (window.SCRSmart && !window.SCRSmart.data()) window.SCRSmart.ensure();

  toolbar(); build();
  if (window.SCRDraw) {
    draw = window.SCRDraw.attach(host.parentElement, { chart: () => chart, main: () => main, D, T, sym,
      onState: (st) => { drTool = st.tool; drMag = st.magnet; bar.querySelectorAll("[data-dr-tool]").forEach((x) => x.classList.toggle("on", x.dataset.drTool === st.tool));
        bar.querySelector("[data-dr-magnet]")?.classList.toggle("on", st.magnet); } });
  }
  return { rebuild: build, destroy: () => { probeOn = false; probe.remove(); if (draw) draw.destroy(); try { chart.remove(); } catch (e) { /* */ } } };
}

/* ---------- comparador: rentabilidad base 100 ---------- */
const CMP_COLORS = ["#4c6fff", "#f5a524", "#1db980", "#f472b6"];
async function compare(el, syms, names = {}) {
  el.innerHTML = `<div class="cx"><div class="cx-bar"></div><div class="cx-wrap" style="height:300px"><div class="cx-legend"></div><div class="cx-chart"></div></div></div>`;
  const host = el.querySelector(".cx-chart"), bar = el.querySelector(".cx-bar"), legend = el.querySelector(".cx-legend");
  let per = "1A";
  let LW, data;
  try { LW = await loadLib(); data = await Promise.all(syms.map((s) => loadPrices(s).catch(() => null))); } catch (e) {
    el.innerHTML = `<div class="err-box">No se pudo cargar el gráfico comparativo: ${esc(e.message)}</div>`; return;
  }
  let chart;
  function draw() {
    if (chart) chart.remove();
    chart = LW.createChart(host, { ...baseOptions(LW), localization: { locale: "es-ES", priceFormatter: (p) => fmt(p, 1) } });
    const bars = PERIODS.find((p) => p[0] === per)[1];
    legend.innerHTML = syms.map((s, k) => {
      const d = data[k]; if (!d) return `<span style="color:${CMP_COLORS[k]}">${esc(s)}: sin histórico</span>`;
      const i0 = Math.max(0, d.t.length - 1 - Math.min(bars, d.t.length - 1)), base = d.c[i0];
      const ser = chart.addSeries(LW.LineSeries, { color: CMP_COLORS[k], lineWidth: 2, priceLineVisible: false });
      ser.setData(d.t.slice(i0).map((t, j) => ({ time: t, value: (d.c[i0 + j] / base) * 100 })).filter((x) => isFinite(x.value)));
      const last = (d.c[d.c.length - 1] / base - 1) * 100;
      return `<span style="color:${CMP_COLORS[k]}">● ${esc(s)} ${last >= 0 ? "+" : ""}${fmt(last, 1)} %</span>`;
    }).join(" &nbsp; ");
    chart.timeScale().fitContent();
  }
  bar.innerHTML = `<div class="seg seg-s">${PERIODS.map(([p]) => `<button data-cmp-per="${p}" class="${per === p ? "on" : ""}">${p}</button>`).join("")}</div><span class="hint">Base 100 al inicio del periodo</span>`;
  bar.addEventListener("click", (e) => { const b = e.target.closest("[data-cmp-per]"); if (!b) return; per = b.dataset.cmpPer; bar.querySelectorAll("[data-cmp-per]").forEach((x) => x.classList.toggle("on", x === b)); draw(); });
  draw();
}

window.SCRChart = { mount, compare, loadLib, loadPrices, ind: { sma, ema, dema, boll, rsi, macd } };
})();
