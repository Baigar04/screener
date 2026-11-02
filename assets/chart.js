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
    konkorde: { on: false },
  },
};
const IND_META = {
  sma1: ["SMA", "Media móvil simple", [["n", "Periodo", 2, 400]]],
  sma2: ["SMA 2", "Segunda media móvil simple", [["n", "Periodo", 2, 400]]],
  ema: ["EMA", "Media móvil exponencial: pesa más los datos recientes", [["n", "Periodo", 2, 400]]],
  dema: ["DEMA", "Doble media exponencial: 2·EMA − EMA(EMA), con menos retraso", [["n", "Periodo", 2, 400]]],
  bb: ["Bollinger", "Media ± k desviaciones típicas: mide la volatilidad", [["n", "Periodo", 5, 200], ["k", "Desviaciones", 1, 4]]],
  vol: ["Volumen", "Acciones negociadas por sesión", []],
  rsi: ["RSI", "Fuerza relativa 0-100: > 70 sobrecompra, < 30 sobreventa", [["n", "Periodo", 2, 100]]],
  macd: ["MACD", "Diferencia de dos EMA y su señal: impulso de la tendencia", [["f", "Rápida", 2, 100], ["s", "Lenta", 3, 200], ["g", "Señal", 2, 50]]],
  konkorde: ["Konkorde", "Manos fuertes (azul), débiles (verde), tendencia (marrón) y su media (roja), a partir de precio y volumen", []],
};

function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem("chart_cfg") || "null");
    if (!c) return structuredClone(DEF_CFG);
    const out = structuredClone(DEF_CFG);
    Object.assign(out, { type: c.type || out.type, period: c.period || out.period });
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
    grid: { vertLines: { color: css("--border") }, horzLines: { color: css("--border") } },
    crosshair: { mode: LW.CrosshairMode.Normal },
    rightPriceScale: { borderColor: css("--border") },
    timeScale: { borderColor: css("--border"), rightOffset: 4, minBarSpacing: 0.5 },
    localization: { locale: "es-ES", priceFormatter: (p) => (Math.abs(p) >= 1e5 ? fmtVol(p) : fmt(p, Math.abs(p) < 10 ? 3 : 2)) },
  };
}

/* ---------- gráfico de un valor ---------- */
async function mount(el, sym, opts = {}) {
  const cfg = loadCfg();
  el.innerHTML = `<div class="cx"><div class="cx-bar"></div><div class="cx-wrap"><div class="cx-legend"></div><div class="cx-chart"></div></div><div class="cx-note"></div></div>`;
  const root = el.querySelector(".cx"), bar = el.querySelector(".cx-bar"), host = el.querySelector(".cx-chart"),
    legend = el.querySelector(".cx-legend"), note = el.querySelector(".cx-note");
  host.innerHTML = `<div class="skel" style="height:100%"></div>`;
  let LW, D;
  try { [LW, D] = await Promise.all([loadLib(), loadPrices(sym)]); } catch (e) {
    host.innerHTML = "";
    if (e.message === "nohist") {
      root.innerHTML = `<div class="err-box"><b>Sin histórico diario para ${esc(sym)}.</b> Yahoo Finance no devolvió precios en la última actualización.
        Fuente alternativa prevista: Stooq (CSV diario gratuito, sin clave), que se añadiría al proceso de GitHub como respaldo.</div>`;
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
          <label data-tip="${esc(d)}"><input type="checkbox" data-cx-on="${k}" ${cfg.ind[k].on ? "checked" : ""}> ${t}</label>
          <span>${ps.map(([p, pl, mn, mx]) => `<input type="number" class="cx-num" data-cx-p="${k}.${p}" value="${cfg.ind[k][p]}" min="${mn}" max="${mx}" step="${p === "k" ? 0.5 : 1}" title="${pl}" aria-label="${t} ${pl}">`).join("")}</span></div>`).join("")}
          <div class="cx-row"><button class="chip" data-cx-reset="1">Restablecer</button></div></div></div>
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
      main = chart.addSeries(LW.LineSeries, { color: css("--accent"), lineWidth: 2 });
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
    if (I.vol.on && D.v) {
      pane++;
      const s = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, pane);
      s.setData(T.map((t, i) => (D.v[i] == null ? null : { time: t, value: D.v[i], color: (C[i] >= (C[i - 1] ?? C[i]) ? up : dn) + "88" })).filter(Boolean));
      series["Volumen"] = { s, arr: D.v, color: css("--muted"), vol: true }; heights.push(70);
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
    requestAnimationFrame(() => { try { const ps = chart.panes(); heights.forEach((h, i) => ps[i + 1]?.setHeight(h)); } catch (e) { /* sin paneles ajustables */ } });
    addEvents();
    setPeriod();
    chart.subscribeCrosshairMove((p) => showLegend(p));
    showLegend(null);
  }

  function setPeriod() {
    const n = T.length, bars = PERIODS.find((p) => p[0] === cfg.period)[1];
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - bars) - 0.5, to: n - 1 + 3 });
  }

  function showLegend(p) {
    let i = T.length - 1;
    if (p && p.time) { const t = typeof p.time === "string" ? p.time : `${p.time.year}-${String(p.time.month).padStart(2, "0")}-${String(p.time.day).padStart(2, "0")}`; const j = T.indexOf(t); if (j >= 0) i = j; }
    const ch = i > 0 && C[i - 1] ? (C[i] / C[i - 1] - 1) * 100 : null;
    const cls = ch == null ? "" : ch >= 0 ? "p" : "n";
    let h = `<span class="cx-d">${T[i]}</span> A <b>${fmt(D.o[i])}</b> Máx <b>${fmt(D.h[i])}</b> Mín <b>${fmt(D.l[i])}</b> C <b>${fmt(C[i])}</b> <span class="chg ${cls}">${ch == null ? "" : (ch >= 0 ? "+" : "") + fmt(ch) + " %"}</span>`;
    const extra = Object.entries(series).filter(([, v]) => v.arr && v.arr[i] != null).map(([k, v]) => `<span style="color:${v.color}">${k} ${v.vol ? fmtVol(v.arr[i]) : fmt(v.arr[i])}</span>`);
    if (extra.length) h += `<br>${extra.join(" · ")}`;
    const ev = EV.get(T[i]); if (ev) h += `<br><span class="cx-ev">${ev.map((x) => esc(x.txt)).join(" · ")}</span>`;
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
    if (t.closest(".cx-ind .dd-btn")) { e.stopPropagation(); t.closest(".dd").classList.toggle("open"); return; }
    if (t.closest(".cx-menu")) e.stopPropagation();
  }
  function onChange(e) {
    const t = e.target;
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
  /* eventos: operaciones del Congreso y entradas de mis carteras */
  const EV = new Map();
  function collectEvents() {
    EV.clear();
    const add = (d, o) => { let k = d; if (!T.includes(k)) { k = T.find((t) => t >= d); if (!k) return; } (EV.get(k) || EV.set(k, []).get(k)).push(o); };
    const sm = window.SCRSmart?.data?.()?.por_valor?.[sym];
    (sm?.c || []).forEach(([n, tp, fo, fd, imp]) => { if (fo > fd) return; const buy = tp === "Compra";
      add(fo, { kind: buy ? "cb" : "cs", txt: `${n.split(" ").slice(-1)[0]} (Congreso): ${tp.toLowerCase()} ${imp || ""}`, buy }); });
    try { (JSON.parse(localStorage.getItem("carteras") || "[]")).forEach((p) => p.items.forEach((x) => { if (x.sym === sym) add(p.creada.slice(0, 10), { kind: "pf", txt: `Entrada en «${p.nombre}» a ${fmt(x.p0)}`, p0: x.p0 }); })); } catch (e) { /* */ }
  }
  function addEvents() {
    collectEvents();
    const mk = [];
    EV.forEach((list, d) => list.forEach((o) => {
      if (o.kind === "pf") mk.push({ time: d, position: "belowBar", color: "#2962ff", shape: "circle", text: "Cartera" });
      else mk.push({ time: d, position: o.buy ? "belowBar" : "aboveBar", color: o.buy ? css("--pos") : css("--neg"), shape: o.buy ? "arrowUp" : "arrowDown", text: o.txt.split(" ")[0] });
    }));
    mk.sort((a, b) => (a.time < b.time ? -1 : 1));
    try { if (LW.createSeriesMarkers) LW.createSeriesMarkers(main, mk); else if (main.setMarkers) main.setMarkers(mk); } catch (e) { /* sin marcadores */ }
    const pf = [...EV.values()].flat().filter((o) => o.kind === "pf");
    if (pf.length) { const avg = pf.reduce((a, o) => a + o.p0, 0) / pf.length; try { main.createPriceLine({ price: avg, color: "#2962ff", lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: "Media" }); } catch (e) { /* */ } }
  }
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
