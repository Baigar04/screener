/* Screener · herramientas de dibujo sobre el gráfico: línea de tendencia, horizontal, Fibonacci y tridente de Andrews.
   Se dibuja en un lienzo superpuesto al panel de precio. Los puntos se guardan por fecha y precio (no por píxel),
   así que siguen en su sitio al hacer zoom, desplazar o volver otro día. */
(() => {
"use strict";
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
const NEED = { linea: 2, rayo: 2, horizontal: 1, fib: 2, tridente: 3 };
const TOOLS = [
  ["cursor", "Mover gráfico", "M5 3l12 8-5 1 3 6-2 1-3-6-4 4z"],
  ["linea", "Línea de tendencia (2 clics)", "M4 20L20 4M4 20h0M20 4h0"],
  ["rayo", "Rayo: línea que se prolonga a la derecha (2 clics)", "M4 18L20 6M17 4l3 2-2 3"],
  ["horizontal", "Línea horizontal (1 clic)", "M3 12h18M6 9v6"],
  ["fib", "Retroceso de Fibonacci (2 clics: inicio y fin del movimiento)", "M4 5h16M4 9h16M4 13h16M4 19h16"],
  ["tridente", "Tridente de Andrews (3 clics: pivote, máximo y mínimo)", "M3 18l9-6M12 12l9-7M12 12l9 1M12 12l9 7"],
  ["borrar", "Borrar un dibujo (clic sobre él)", "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"],
];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = (v) => Number(v).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 10 ? 3 : 2 });

function toolbarHtml(tool) {
  return `<div class="seg seg-s dr-tools" role="toolbar" aria-label="Herramientas de dibujo">${TOOLS.map(([k, t, d]) =>
    `<button data-dr-tool="${k}" class="${tool === k ? "on" : ""}" data-tip="${esc(t)}" aria-label="${esc(t)}"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></button>`).join("")}
    <button data-dr-undo="1" data-tip="Deshacer el último dibujo" aria-label="Deshacer"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button>
    <button data-dr-clear="1" data-tip="Borrar todos los dibujos de este valor" aria-label="Borrar todos"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
}

function attach(wrap, ctx) {
  /* ctx: { chart(), main(), T, sym, onTool(tool) } */
  const key = "dibujos_" + ctx.sym;
  let items = []; try { items = JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { items = []; }
  const save = () => { try { localStorage.setItem(key, JSON.stringify(items)); } catch (e) { /* */ } };
  let tool = "cursor", pending = [], hover = null, alive = true;
  const cv = document.createElement("canvas"); cv.className = "dr-canvas"; wrap.appendChild(cv);
  const g = cv.getContext("2d");
  const T = ctx.T, last = T.length - 1;

  /* conversión punto guardado <-> píxeles */
  const idxOf = (pt) => { if (pt.off != null) return last + pt.off; const i = T.indexOf(pt.d); if (i >= 0) return i; let j = T.findIndex((t) => t >= pt.d); return j < 0 ? last : j; };
  const toXY = (pt) => {
    const ch = ctx.chart(), s = ctx.main(); if (!ch || !s) return null;
    const x = ch.timeScale().logicalToCoordinate(idxOf(pt)), y = s.priceToCoordinate(pt.p);
    return x == null || y == null ? null : { x, y };
  };
  const fromXY = (x, y) => {
    const ch = ctx.chart(), s = ctx.main(); if (!ch || !s) return null;
    let l = ch.timeScale().coordinateToLogical(x); const p = s.coordinateToPrice(y);
    if (l == null || p == null) return null;
    l = Math.round(l); if (l < 0) l = 0;
    return l <= last ? { d: T[l], p } : { d: T[last], off: l - last, p };
  };
  function area() {
    const ch = ctx.chart(); let h = wrap.clientHeight, w = wrap.clientWidth;
    try { h = ch.panes()[0].getHeight(); } catch (e) { /* sin API de paneles */ }
    try { w -= ch.priceScale("right").width(); } catch (e) { /* */ }
    return { w: Math.max(0, w), h: Math.max(0, h) };
  }

  /* geometría */
  const extend = (a, b, W) => { if (b.x === a.x) return { x: b.x, y: b.y }; const m = (b.y - a.y) / (b.x - a.x); return { x: W, y: a.y + m * (W - a.x) }; };
  function shapes(it, pts, W) {
    const s = [];
    if (it.t === "linea" && pts.length >= 2) s.push([pts[0], pts[1]]);
    if (it.t === "rayo" && pts.length >= 2) s.push([pts[0], extend(pts[0], pts[1], W)]);
    if (it.t === "horizontal" && pts.length >= 1) s.push([{ x: 0, y: pts[0].y }, { x: W, y: pts[0].y }]);
    if (it.t === "tridente" && pts.length >= 3) {
      const [a, b, c] = pts, m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
      const end = extend(a, m, W), dx = end.x - a.x, dy = end.y - a.y;
      s.push([a, end], [b, c], [b, { x: b.x + dx, y: b.y + dy }], [c, { x: c.x + dx, y: c.y + dy }]);
    }
    return s;
  }
  const distSeg = (p, a, b) => { const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2; let t = l2 ? ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))); };

  function drawItem(it, pts, W, preview) {
    const col = preview ? css("--muted") : (it.c || css("--warn") || "#f5a524");
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.5; g.setLineDash(preview ? [4, 3] : []);
    g.font = `11px ${css("--font") || "sans-serif"}`;
    if (it.t === "fib" && pts.length >= 2) {
      const [a, b] = pts, x0 = Math.min(a.x, b.x);
      const pa = it.pts[0].p, pb = (it.pts[1] || it.pts[0]).p;
      FIB.forEach((lv, k) => {
        const y = b.y + (a.y - b.y) * lv, price = pb + (pa - pb) * lv;
        g.globalAlpha = lv === 0 || lv === 1 ? 0.95 : 0.75; g.beginPath(); g.moveTo(x0, y); g.lineTo(W, y); g.stroke();
        if (k < FIB.length - 1) { const y2 = b.y + (a.y - b.y) * FIB[k + 1]; g.globalAlpha = 0.05; g.fillRect(x0, Math.min(y, y2), W - x0, Math.abs(y2 - y)); }
        g.globalAlpha = 1; g.fillText(`${(lv * 100).toFixed(1).replace(".0", "")} %  ${fmt(price)}`, x0 + 4, y - 3);
      });
      g.setLineDash([2, 3]); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      return;
    }
    shapes(it, pts, W).forEach(([a, b]) => { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); });
    if (it.t === "horizontal" && pts[0]) g.fillText(fmt(it.pts[0].p), 6, pts[0].y - 4);
    if (it.t === "tridente" && pts.length >= 3) { g.globalAlpha = 0.06; g.beginPath(); const s = shapes(it, pts, W); g.moveTo(s[2][0].x, s[2][0].y); g.lineTo(s[2][1].x, s[2][1].y); g.lineTo(s[3][1].x, s[3][1].y); g.lineTo(s[3][0].x, s[3][0].y); g.fill(); g.globalAlpha = 1; }
    if (!preview) pts.forEach((p) => { g.beginPath(); g.arc(p.x, p.y, 2.5, 0, 7); g.fill(); });
  }

  function paint() {
    if (!alive) return;
    const { w, h } = area(), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + "px"; cv.style.height = h + "px"; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip();
    items.forEach((it) => { const pts = it.pts.map(toXY); if (pts.every(Boolean)) drawItem(it, pts, w, false); });
    if (pending.length && hover) {
      const it = { t: tool, pts: [...pending, hover] }, pts = it.pts.map(toXY);
      if (pts.every(Boolean)) drawItem(it, pts, w, true);
    }
    g.restore();
    requestAnimationFrame(paint);
  }
  requestAnimationFrame(paint);

  const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function setTool(t) {
    tool = t; pending = []; hover = null;
    cv.style.pointerEvents = t === "cursor" ? "none" : "auto";
    cv.style.cursor = t === "borrar" ? "not-allowed" : t === "cursor" ? "" : "crosshair";
    ctx.onTool && ctx.onTool(t);
  }
  cv.addEventListener("pointermove", (e) => { if (tool !== "cursor" && tool !== "borrar") { const q = local(e); hover = fromXY(q.x, q.y); } });
  cv.addEventListener("pointerdown", (e) => {
    e.preventDefault(); const q = local(e);
    if (tool === "borrar") {
      const { w } = area(); let best = -1, bd = 8;
      items.forEach((it, i) => {
        const pts = it.pts.map(toXY); if (!pts.every(Boolean)) return;
        let segs = shapes(it, pts, w);
        if (it.t === "fib") segs = FIB.map((lv) => { const y = pts[1].y + (pts[0].y - pts[1].y) * lv; return [{ x: Math.min(pts[0].x, pts[1].x), y }, { x: w, y }]; });
        segs.forEach(([a, b]) => { const d = distSeg(q, a, b); if (d < bd) { bd = d; best = i; } });
      });
      if (best >= 0) { items.splice(best, 1); save(); }
      return;
    }
    const pt = fromXY(q.x, q.y); if (!pt) return;
    pending.push(pt);
    if (pending.length >= NEED[tool]) { items.push({ t: tool, pts: pending.slice(0, NEED[tool]) }); save(); pending = []; hover = null; }
  });
  const onKey = (e) => { if (e.key === "Escape" && pending.length) { pending = []; hover = null; e.stopPropagation(); } };
  document.addEventListener("keydown", onKey, true);
  setTool("cursor");
  return {
    setTool,
    undo() { items.pop(); save(); },
    clear() { if (items.length && confirm(`¿Borrar los ${items.length} dibujos de ${ctx.sym}?`)) { items = []; save(); } },
    count: () => items.length,
    destroy() { alive = false; document.removeEventListener("keydown", onKey, true); cv.remove(); },
  };
}

window.SCRDraw = { attach, toolbarHtml };
})();
