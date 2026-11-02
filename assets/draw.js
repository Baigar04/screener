/* Screener · dibujo sobre el gráfico (estilo TradingView).
   Herramientas: línea, rayo, horizontal, Fibonacci configurable y tridente de Andrews.
   Edición: seleccionar, arrastrar puntos, color y grosor, borrar. Imán a apertura/máximo/mínimo/cierre.
   Automáticos: Fibonacci del último tramo, tridente de los tres últimos pivotes, soportes y resistencias.
   Los puntos se guardan por fecha y precio, por valor, en el navegador. */
(() => {
"use strict";
const FIB_DEFAULT = [
  { v: 0, on: true, c: "#787b86" }, { v: 0.236, on: true, c: "#f23645" }, { v: 0.382, on: true, c: "#ff9800" },
  { v: 0.5, on: true, c: "#4caf50" }, { v: 0.618, on: true, c: "#089981" }, { v: 0.786, on: true, c: "#00bcd4" },
  { v: 1, on: true, c: "#787b86" }, { v: 1.272, on: false, c: "#2962ff" }, { v: 1.618, on: true, c: "#9c27b0" },
  { v: 2.618, on: false, c: "#e91e63" }, { v: 3.618, on: false, c: "#673ab7" },
];
const FIB_OPTS_DEFAULT = { fill: true, labels: "ambos", ext: "ninguna", reverse: false };
const NEED = { linea: 2, rayo: 2, horizontal: 1, fib: 2, tridente: 3 };
const COLORS = ["#2962ff", "#f23645", "#089981", "#ff9800", "#9c27b0", "#00bcd4", "#e6e6e6", "#787b86"];
const TOOLS = [
  ["cursor", "Seleccionar y mover gráfico", "M5 3l12 8-5 1 3 6-2 1-3-6-4 4z"],
  ["linea", "Línea de tendencia (2 clics)", "M4 20L20 4"],
  ["rayo", "Rayo: se prolonga a la derecha (2 clics)", "M4 18L20 6M17 4l3 2-2 3"],
  ["horizontal", "Línea horizontal (1 clic)", "M3 12h18M6 9v6"],
  ["fib", "Retroceso de Fibonacci (2 clics: inicio y fin del movimiento)", "M4 5h16M4 9h16M4 13h16M4 19h16"],
  ["tridente", "Tridente de Andrews (3 clics: pivote, máximo y mínimo)", "M3 18l9-6M12 12l9-7M12 12l9 1M12 12l9 7"],
];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = (v) => Number(v).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 10 ? 3 : 2 });
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* */ } } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const hexA = (hex, a) => { const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

function toolbarHtml(tool, magnet) {
  return `<div class="seg seg-s dr-tools" role="toolbar" aria-label="Herramientas de dibujo">${TOOLS.map(([k, t, d]) =>
    `<button data-dr-tool="${k}" class="${tool === k ? "on" : ""}" data-tip="${esc(t)}" aria-label="${esc(t)}"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></button>`).join("")}
    <button data-dr-magnet="1" class="${magnet ? "on" : ""}" data-tip="Imán: pega los puntos a la apertura, máximo, mínimo o cierre de la vela más cercana" aria-label="Imán"><svg viewBox="0 0 24 24"><path d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM6 7h4M14 7h4"/></svg></button>
    <div class="dd dr-auto"><button class="dd-btn" data-tip="Trazados automáticos sobre los pivotes del gráfico">Auto ▾</button><div class="dd-menu">
      <button data-dr-auto="fib">Fibonacci del último tramo</button><button data-dr-auto="tridente">Tridente de los tres últimos pivotes</button>
      <button data-dr-auto="sr">Soportes y resistencias</button><button data-dr-auto="quitar">Quitar trazados automáticos</button></div></div>
    <button data-dr-undo="1" data-tip="Deshacer" aria-label="Deshacer"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button>
    <button data-dr-clear="1" data-tip="Borrar todos los dibujos de este valor" aria-label="Borrar todos"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button></div>`;
}

/* ---------- pivotes (zigzag sobre máximos y mínimos) ---------- */
function zigzag(D, from, pct) {
  const piv = []; let trend = 0, hi = D.h[from], hiI = from, lo = D.l[from], loI = from;
  for (let i = from + 1; i < D.c.length; i++) {
    const h = D.h[i], l = D.l[i]; if (h == null || l == null) continue;
    if (trend === 0) {
      if (h > hi) { hi = h; hiI = i; } if (l < lo) { lo = l; loI = i; }
      if (hi / lo - 1 >= pct) { if (hiI > loI) { piv.push({ i: loI, p: lo, k: "L" }); trend = 1; } else { piv.push({ i: hiI, p: hi, k: "H" }); trend = -1; } }
    } else if (trend === 1) {
      if (h > hi) { hi = h; hiI = i; }
      if (l <= hi * (1 - pct)) { piv.push({ i: hiI, p: hi, k: "H" }); trend = -1; lo = l; loI = i; }
    } else {
      if (l < lo) { lo = l; loI = i; }
      if (h >= lo * (1 + pct)) { piv.push({ i: loI, p: lo, k: "L" }); trend = 1; hi = h; hiI = i; }
    }
  }
  if (trend === 1) piv.push({ i: hiI, p: hi, k: "H", prov: true }); else if (trend === -1) piv.push({ i: loI, p: lo, k: "L", prov: true });
  return piv;
}

function attach(wrap, ctx) {
  /* ctx: { chart(), main(), D, T, sym, onState(state) } */
  const key = "dibujos_" + ctx.sym, D = ctx.D, T = ctx.T, last = T.length - 1;
  let items = ls.get(key, []).map((it, k) => ({ id: it.id || "d" + k + Date.now().toString(36), ...it }));
  let tool = "cursor", magnet = ls.get("dibujo_iman", true), pending = [], hover = null, sel = null, drag = null, alive = true, lastColor = ls.get("dibujo_color", "#2962ff");
  const save = () => ls.set(key, items);
  const cv = document.createElement("canvas"); cv.className = "dr-canvas"; wrap.appendChild(cv);
  const g = cv.getContext("2d");
  const pop = document.createElement("div"); pop.className = "dr-pop"; pop.hidden = true; wrap.appendChild(pop);
  const modal = document.createElement("div"); modal.className = "dr-modal"; modal.hidden = true; wrap.appendChild(modal);

  /* ---- conversión ---- */
  const idxOf = (pt) => { if (pt.off != null) return last + pt.off; const i = T.indexOf(pt.d); if (i >= 0) return i; const j = T.findIndex((t) => t >= pt.d); return j < 0 ? last : j; };
  const toXY = (pt) => { const ch = ctx.chart(), s = ctx.main(); if (!ch || !s) return null; const x = ch.timeScale().logicalToCoordinate(idxOf(pt)), y = s.priceToCoordinate(pt.p); return x == null || y == null ? null : { x, y }; };
  function fromXY(x, y, snap) {
    const ch = ctx.chart(), s = ctx.main(); if (!ch || !s) return null;
    let l = ch.timeScale().coordinateToLogical(x), p = s.coordinateToPrice(y); if (l == null || p == null) return null;
    l = Math.max(0, Math.round(l));
    if (snap && l <= last && D.o[l] != null) {
      let best = null; for (const v of [D.o[l], D.h[l], D.l[l], D.c[l]]) { const yy = s.priceToCoordinate(v); if (yy != null && (best == null || Math.abs(yy - y) < best[0])) best = [Math.abs(yy - y), v]; }
      if (best && best[0] < 40) p = best[1];
    }
    return l <= last ? { d: T[l], p } : { d: T[last], off: l - last, p };
  }
  function area() {
    const ch = ctx.chart(); let h = wrap.clientHeight, w = wrap.clientWidth;
    try { h = ch.panes()[0].getHeight(); } catch (e) { /* */ }
    try { w -= ch.priceScale("right").width(); } catch (e) { /* */ }
    return { w: Math.max(0, w), h: Math.max(0, h) };
  }
  const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  /* ---- geometría ---- */
  const extend = (a, b, W) => { if (b.x === a.x) return { x: b.x, y: b.y }; const m = (b.y - a.y) / (b.x - a.x); return { x: W, y: a.y + m * (W - a.x) }; };
  function fibLevels(it, pts, W) {
    const o = { ...FIB_OPTS_DEFAULT, ...(it.o || {}) }; let [a, b] = pts, [pa, pb] = [it.pts[0].p, it.pts[1].p];
    if (o.reverse) { [a, b] = [b, a]; [pa, pb] = [pb, pa]; }
    const xl = o.ext === "izquierda" || o.ext === "ambas" ? 0 : Math.min(a.x, b.x), xr = o.ext === "derecha" || o.ext === "ambas" ? W : Math.max(a.x, b.x);
    return { o, xl, xr, lv: (it.lv || FIB_DEFAULT).filter((l) => l.on).sort((x, y) => x.v - y.v).map((l) => ({ ...l, y: b.y + (a.y - b.y) * l.v, price: pb + (pa - pb) * l.v })) };
  }
  function segs(it, pts, W) {
    const s = [];
    if (it.t === "linea") s.push([pts[0], pts[1]]);
    if (it.t === "rayo") s.push([pts[0], extend(pts[0], pts[1], W)]);
    if (it.t === "horizontal") s.push([{ x: 0, y: pts[0].y }, { x: W, y: pts[0].y }]);
    if (it.t === "tridente" && pts.length >= 3) {
      const [a, b, c] = pts, m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }, end = extend(a, m, W), dx = end.x - a.x, dy = end.y - a.y;
      s.push([a, end], [b, c], [b, { x: b.x + dx, y: b.y + dy }], [c, { x: c.x + dx, y: c.y + dy }]);
    }
    if (it.t === "fib" && pts.length >= 2) { const f = fibLevels(it, pts, W); f.lv.forEach((l) => s.push([{ x: f.xl, y: l.y }, { x: f.xr, y: l.y }])); s.push([pts[0], pts[1]]); }
    return s;
  }
  const distSeg = (p, a, b) => { const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2; let t = l2 ? ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))); };
  function hit(q) {
    const { w } = area(); let best = null;
    items.forEach((it) => {
      const pts = it.pts.map(toXY); if (!pts.every(Boolean)) return;
      pts.forEach((p, k) => { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < 9 && (!best || d < best.d)) best = { it, k, d: d - 5 }; });
      segs(it, pts, w).forEach(([a, b]) => { const d = distSeg(q, a, b); if (d < 7 && (!best || d < best.d)) best = { it, k: -1, d }; });
    });
    return best;
  }

  /* ---- pintado ---- */
  function drawItem(it, pts, W, preview) {
    const col = it.c || lastColor, lw = it.w || 1.5, selected = sel && sel === it.id;
    g.setLineDash(preview ? [5, 4] : it.dash ? [6, 4] : []); g.lineWidth = selected ? lw + 1 : lw;
    g.font = `12px ${css("--font") || "sans-serif"}`;
    if (it.t === "fib") {
      const f = fibLevels(it, pts, W);
      f.lv.forEach((l, k) => {
        const nx = f.lv[k + 1];
        if (f.o.fill && nx) { g.fillStyle = hexA(nx.c, 0.12); g.fillRect(f.xl, Math.min(l.y, nx.y), f.xr - f.xl, Math.abs(nx.y - l.y)); }
        g.strokeStyle = l.c; g.beginPath(); g.moveTo(f.xl, l.y); g.lineTo(f.xr, l.y); g.stroke();
        if (f.o.labels !== "ninguna") {
          const txt = f.o.labels === "porcentaje" ? `${(l.v * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %` : f.o.labels === "precio" ? fmt(l.price) : `${(l.v * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} % (${fmt(l.price)})`;
          g.fillStyle = l.c; g.fillText(txt, f.xl + 4, l.y - 4);
        }
      });
      g.setLineDash([3, 3]); g.strokeStyle = hexA("#787b86", 0.8); g.lineWidth = 1; g.beginPath(); g.moveTo(pts[0].x, pts[0].y); g.lineTo(pts[1].x, pts[1].y); g.stroke();
    } else {
      g.strokeStyle = preview ? css("--muted") : col; g.fillStyle = col;
      if (it.t === "tridente" && pts.length >= 3 && !preview) { const s = segs(it, pts, W); g.fillStyle = hexA(col.startsWith("#") ? col : "#2962ff", 0.08); g.beginPath(); g.moveTo(s[2][0].x, s[2][0].y); g.lineTo(s[2][1].x, s[2][1].y); g.lineTo(s[3][1].x, s[3][1].y); g.lineTo(s[3][0].x, s[3][0].y); g.fill(); g.fillStyle = col; }
      segs(it, pts, W).forEach(([a, b]) => { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); });
      if (it.t === "horizontal") { g.fillStyle = col; g.fillText(fmt(it.pts[0].p) + (it.lab ? "  " + it.lab : ""), 6, pts[0].y - 5); }
    }
    g.setLineDash([]);
    if (selected || preview) pts.forEach((p) => { g.fillStyle = css("--surface") || "#111"; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 5, 0, 7); g.fill(); g.stroke(); });
  }
  function paint() {
    if (!alive) return;
    const { w, h } = area(), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + "px"; cv.style.height = h + "px"; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip();
    items.forEach((it) => { const pts = it.pts.map(toXY); if (pts.every(Boolean)) drawItem(it, pts, w, false); });
    if (pending.length && hover) { const it = { t: tool, pts: [...pending, hover], c: lastColor, lv: ls.get("fib_def", null), o: ls.get("fib_opts", null) }; const pts = it.pts.map(toXY); if (pts.every(Boolean)) drawItem(it, pts, w, true); }
    g.restore();
    placePop();
    requestAnimationFrame(paint);
  }
  requestAnimationFrame(paint);

  /* ---- barra flotante del dibujo seleccionado ---- */
  function placePop() {
    const it = items.find((x) => x.id === sel); if (!it) { pop.hidden = true; return; }
    const pts = it.pts.map(toXY).filter(Boolean); if (!pts.length) { pop.hidden = true; return; }
    const { w } = area(), x = Math.min(Math.max(...pts.map((p) => p.x)), w - 10), y = Math.min(...pts.map((p) => p.y));
    pop.style.left = Math.max(6, Math.min(x - pop.offsetWidth / 2, w - pop.offsetWidth - 6)) + "px"; pop.style.top = Math.max(4, y - 46) + "px";
  }
  function showPop() {
    const it = items.find((x) => x.id === sel); if (!it) { pop.hidden = true; return; }
    pop.innerHTML = `${it.t !== "fib" ? COLORS.map((c) => `<button class="sw ${it.c === c ? "on" : ""}" style="background:${c}" data-dr-col="${c}" aria-label="Color ${c}"></button>`).join("") : ""}
      ${it.t !== "fib" ? `<select data-dr-w aria-label="Grosor">${[1, 1.5, 2, 3].map((v) => `<option value="${v}" ${+(it.w || 1.5) === v ? "selected" : ""}>${v} px</option>`).join("")}</select>` : ""}
      ${it.t === "fib" ? `<button class="pb" data-dr-fibcfg="1">Ajustes de Fibonacci</button>` : ""}
      <button class="pb" data-dr-del="1" aria-label="Borrar dibujo">Borrar</button>`;
    pop.hidden = false;
  }
  function select(id) { sel = id; showPop(); }

  /* ---- ajustes de Fibonacci ---- */
  function openFib(it) {
    it.lv = it.lv || clone(ls.get("fib_def", FIB_DEFAULT)); it.o = { ...FIB_OPTS_DEFAULT, ...(ls.get("fib_opts", {})), ...(it.o || {}) };
    const o = it.o;
    modal.innerHTML = `<div class="dr-mbox" role="dialog" aria-label="Ajustes de Fibonacci"><div class="dr-mh"><b>Ajustes de Fibonacci</b><button class="icon-btn" data-dr-mclose="1" aria-label="Cerrar">✕</button></div>
      <div class="dr-lv">${it.lv.map((l, k) => `<label class="dr-l"><input type="checkbox" data-dr-lon="${k}" ${l.on ? "checked" : ""}><input type="number" step="0.001" value="${l.v}" data-dr-lv="${k}" aria-label="Nivel"><input type="color" value="${l.c}" data-dr-lc="${k}" aria-label="Color"><button class="link-btn" data-dr-ldel="${k}" aria-label="Quitar nivel">✕</button></label>`).join("")}</div>
      <button class="link-btn" data-dr-ladd="1">+ Añadir nivel</button>
      <div class="dr-opts"><label><input type="checkbox" data-dr-o="fill" ${o.fill ? "checked" : ""}> Relleno entre niveles</label>
        <label><input type="checkbox" data-dr-o="reverse" ${o.reverse ? "checked" : ""}> Invertir</label>
        <label>Etiquetas <select data-dr-o="labels">${["ambos", "porcentaje", "precio", "ninguna"].map((v) => `<option ${o.labels === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Extender líneas <select data-dr-o="ext">${["ninguna", "derecha", "izquierda", "ambas"].map((v) => `<option ${o.ext === v ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
      <div class="dr-mf"><button class="icon-btn" data-dr-fdef="1">Guardar como predeterminado</button><button class="icon-btn" data-dr-freset="1">Restablecer</button><button class="icon-btn primary" data-dr-mclose="1">Hecho</button></div></div>`;
    modal.hidden = false; modal.dataset.id = it.id;
  }
  modal.addEventListener("input", onModal); modal.addEventListener("change", onModal);
  function onModal(e) {
    const it = items.find((x) => x.id === modal.dataset.id); if (!it) return; const t = e.target, d = t.dataset;
    if (d.drLon != null) it.lv[+d.drLon].on = t.checked;
    else if (d.drLv != null && t.value !== "" && isFinite(+t.value)) it.lv[+d.drLv].v = +t.value;
    else if (d.drLc != null) it.lv[+d.drLc].c = t.value;
    else if (d.drO) it.o[d.drO] = t.type === "checkbox" ? t.checked : t.value;
    else return;
    save();
  }
  modal.addEventListener("click", (e) => {
    e.stopPropagation(); const t = e.target, it = items.find((x) => x.id === modal.dataset.id);
    if (t.closest("[data-dr-mclose]") || t === modal) { modal.hidden = true; return; }
    if (!it) return;
    let b;
    if ((b = t.closest("[data-dr-ldel]"))) { it.lv.splice(+b.dataset.drLdel, 1); save(); openFib(it); }
    else if (t.closest("[data-dr-ladd]")) { it.lv.push({ v: 1.414, on: true, c: "#f7525f" }); save(); openFib(it); }
    else if (t.closest("[data-dr-fdef]")) { ls.set("fib_def", it.lv); ls.set("fib_opts", it.o); t.closest("button").textContent = "Guardado ✓"; }
    else if (t.closest("[data-dr-freset]")) { it.lv = clone(FIB_DEFAULT); it.o = { ...FIB_OPTS_DEFAULT }; save(); openFib(it); }
  });

  /* ---- automáticos ---- */
  function auto(kind) {
    if (kind === "quitar") { items = items.filter((x) => !x.auto); sel = null; pop.hidden = true; save(); return; }
    const ch = ctx.chart(); let from = Math.max(0, last - 260);
    try { const r = ch.timeScale().getVisibleLogicalRange(); if (r) from = Math.max(0, Math.floor(r.from)); } catch (e) { /* */ }
    const span = Math.max(...D.h.slice(from).filter((x) => x != null)) / Math.min(...D.l.slice(from).filter((x) => x != null)) - 1;
    const pct = Math.max(0.03, Math.min(0.2, span / 5));
    const pv = zigzag(D, from, pct);
    const P = (p) => ({ d: T[p.i], p: p.p });
    items = items.filter((x) => !(x.auto === kind));
    if (kind === "fib") {
      if (pv.length < 2) return alert("No hay suficientes pivotes en la zona visible. Amplía el periodo.");
      const [a, b] = pv.slice(-2);
      items.push({ id: "a" + Date.now().toString(36), t: "fib", auto: "fib", pts: [P(a), P(b)], lv: clone(ls.get("fib_def", FIB_DEFAULT)), o: { ...FIB_OPTS_DEFAULT, ...ls.get("fib_opts", {}) } });
    } else if (kind === "tridente") {
      if (pv.length < 3) return alert("No hay suficientes pivotes en la zona visible. Amplía el periodo.");
      const [a, b, c] = pv.slice(-3);
      items.push({ id: "a" + Date.now().toString(36), t: "tridente", auto: "tridente", c: "#2962ff", w: 1.5, pts: [P(a), P(b), P(c)] });
    } else if (kind === "sr") {
      const all = zigzag(D, Math.max(0, last - 500), Math.max(0.025, pct * 0.6)), tol = 0.015, cl = [];
      all.forEach((p) => { const c = cl.find((x) => Math.abs(x.p / p.p - 1) < tol); if (c) { c.n++; c.p = (c.p * (c.n - 1) + p.p) / c.n; } else cl.push({ p: p.p, n: 1 }); });
      const px = D.c[last];
      cl.filter((c) => c.n >= 3).sort((a, b) => Math.abs(a.p - px) - Math.abs(b.p - px)).slice(0, 6).forEach((c, k) =>
        items.push({ id: "s" + k + Date.now().toString(36), t: "horizontal", auto: "sr", dash: true, c: c.p > px ? "#f23645" : "#089981", w: 1.5, lab: `${c.p > px ? "resistencia" : "soporte"} · ${c.n} toques`, pts: [{ d: T[last], p: c.p }] }));
      if (!cl.some((c) => c.n >= 3)) alert("No se encontraron niveles con al menos 3 toques en el histórico reciente.");
    }
    save();
  }

  /* ---- eventos de puntero ---- */
  function down(e) {
    if (e.button === 2 || e.target.closest(".dr-pop, .dr-modal")) return;
    const q = local(e); const { w, h } = area(); if (q.x > w || q.y > h || q.x < 0 || q.y < 0) return;
    if (tool !== "cursor") {
      e.preventDefault(); e.stopPropagation();
      const pt = fromXY(q.x, q.y, magnet); if (!pt) return;
      pending.push(pt);
      if (pending.length >= NEED[tool]) {
        const it = { id: "d" + Date.now().toString(36), t: tool, pts: pending.slice(0, NEED[tool]), c: lastColor, w: 1.5 };
        if (tool === "fib") { it.lv = clone(ls.get("fib_def", FIB_DEFAULT)); it.o = { ...FIB_OPTS_DEFAULT, ...ls.get("fib_opts", {}) }; }
        items.push(it); save(); pending = []; hover = null; setTool("cursor"); select(it.id);
      }
      return;
    }
    const hb = hit(q);
    if (hb) {
      e.preventDefault(); e.stopPropagation(); select(hb.it.id);
      drag = { id: hb.it.id, k: hb.k, start: q, orig: clone(hb.it.pts) };
      if (e.detail === 2 && hb.it.t === "fib") openFib(hb.it);
    } else if (sel) { sel = null; pop.hidden = true; }
  }
  function move(e) {
    const q = local(e);
    if (drag) {
      const it = items.find((x) => x.id === drag.id); if (!it) return;
      if (drag.k >= 0) { const pt = fromXY(q.x, q.y, magnet); if (pt) it.pts[drag.k] = pt; }
      else { /* mover el dibujo entero */
        const s = ctx.main(), ch = ctx.chart(); const dl = (ch.timeScale().coordinateToLogical(q.x) ?? 0) - (ch.timeScale().coordinateToLogical(drag.start.x) ?? 0);
        const dp = (s.coordinateToPrice(q.y) ?? 0) - (s.coordinateToPrice(drag.start.y) ?? 0);
        it.pts = drag.orig.map((pt) => { const i = Math.max(0, Math.round(idxOf(pt) + dl)); return i <= last ? { d: T[i], p: pt.p + dp } : { d: T[last], off: i - last, p: pt.p + dp }; });
      }
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (tool !== "cursor") hover = fromXY(q.x, q.y, magnet);
    else cv.parentElement.style.cursor = hit(q) ? "pointer" : "";
  }
  function up() { if (drag) { save(); drag = null; } }
  wrap.addEventListener("pointerdown", down, true);
  wrap.addEventListener("mousedown", (e) => { if (drag || tool !== "cursor") { e.stopPropagation(); } }, true);
  wrap.addEventListener("touchstart", (e) => { if (drag || tool !== "cursor") e.stopPropagation(); }, { capture: true, passive: true });
  wrap.addEventListener("dblclick", (e) => { const hb = hit(local(e)); if (hb && hb.it.t === "fib") { e.stopPropagation(); openFib(hb.it); } }, true);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  pop.addEventListener("pointerdown", (e) => e.stopPropagation());
  pop.addEventListener("click", (e) => {
    e.stopPropagation(); const it = items.find((x) => x.id === sel); if (!it) return; let b;
    if ((b = e.target.closest("[data-dr-col]"))) { it.c = b.dataset.drCol; lastColor = it.c; ls.set("dibujo_color", lastColor); save(); showPop(); }
    else if (e.target.closest("[data-dr-del]")) { items = items.filter((x) => x.id !== sel); sel = null; pop.hidden = true; save(); }
    else if (e.target.closest("[data-dr-fibcfg]")) openFib(it);
  });
  pop.addEventListener("change", (e) => { const it = items.find((x) => x.id === sel); if (it && e.target.dataset.drW != null) { it.w = +e.target.value; save(); } });
  const onKey = (e) => {
    if (e.key === "Escape") { if (!modal.hidden) { modal.hidden = true; e.stopPropagation(); } else if (pending.length || tool !== "cursor") { pending = []; hover = null; setTool("cursor"); e.stopPropagation(); } else if (sel) { sel = null; pop.hidden = true; e.stopPropagation(); } }
    if ((e.key === "Delete" || e.key === "Backspace") && sel && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { items = items.filter((x) => x.id !== sel); sel = null; pop.hidden = true; save(); e.preventDefault(); }
  };
  document.addEventListener("keydown", onKey, true);

  function setTool(t) { tool = t; pending = []; hover = null; cv.style.cursor = t === "cursor" ? "" : "crosshair"; cv.style.pointerEvents = t === "cursor" ? "none" : "auto"; ctx.onState && ctx.onState({ tool, magnet }); }
  setTool("cursor");
  return {
    setTool, auto,
    toggleMagnet() { magnet = !magnet; ls.set("dibujo_iman", magnet); ctx.onState && ctx.onState({ tool, magnet }); },
    undo() { items.pop(); sel = null; pop.hidden = true; save(); },
    clear() { if (items.length && confirm(`¿Borrar los ${items.length} dibujos de ${ctx.sym}?`)) { items = []; sel = null; pop.hidden = true; save(); } },
    state: () => ({ tool, magnet }),
    destroy() { alive = false; document.removeEventListener("keydown", onKey, true); window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); cv.remove(); pop.remove(); modal.remove(); },
  };
}

window.SCRDraw = { attach, toolbarHtml, zigzag };
})();
