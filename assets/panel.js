/* Screener · panel izquierdo de trabajo (diseño A, 14-nov-2026): Watchlist con precio y variación, valores en el
   comparador, fichas recientes y filtros guardados. Se repinta tras cada render. Oculto en pantallas estrechas. */
(() => {
"use strict";
const H = window.SCR;
const { esc, nf, store } = H;
const sg = (v) => (v == null ? "" : `<span class="${v > 0 ? "pos" : v < 0 ? "neg" : "mu"}">${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(Math.abs(v), 1)} %</span>`);
function paint() {
  const el = document.getElementById("wsp");
  if (!el || getComputedStyle(el).display === "none") return;
  const Q = window.SCREq, uni = window.SCRUni?.() || [];
  if (!uni.length) window.SCREnsureUni?.();
  const by = Object.fromEntries(uni.map((r) => [r.sym, r]));
  const cur = H.S.ficha?.sym;
  const watch = Q?.watch?.() || [], cmp = Q?.cmp?.() || [], rec = store.get("recientes", []).filter((s) => !watch.includes(s)), saved = Q?.saved?.() || [];
  const row = (s, right) => `<tr data-sym="${esc(s)}" class="${s === cur ? "on" : ""}"><td class="sym">${esc(s)}</td>${right}</tr>`;
  let h = `<h4><span>Watchlist</span><span>${watch.length}</span></h4>`;
  h += watch.length ? `<table>${watch.map((s) => row(s, `<td class="num">${by[s] ? nf(by[s].precio, 2) : "…"}</td><td class="num">${by[s] ? sg(by[s].r1d) : ""}</td>`)).join("")}</table>`
    : `<div class="wsp-empty">Marca valores con la estrella en el Screener o en su ficha.</div>`;
  if (cmp.length) h += `<h4><span>Comparando</span><span>${cmp.length}</span></h4><table><tr data-sub="comparar"><td class="sym" colspan="3">${cmp.map(esc).join(" · ")}</td></tr></table>`;
  if (rec.length) h += `<h4><span>Recientes</span></h4><table>${rec.map((s) => row(s, `<td class="num mu" colspan="2">${esc((by[s]?.nombre || "").slice(0, 16))}</td>`)).join("")}</table>`;
  if (saved.length) h += `<h4><span>Filtros guardados</span><span>${saved.length}</span></h4><table>${saved.slice(-6).map((x, j) => `<tr data-wsaved="${saved.length - Math.min(6, saved.length) + j}"><td class="flt" colspan="3">${esc(x.n)}</td></tr>`).join("")}</table>`;
  el.innerHTML = h;
}
H.after.push(paint);
H.handlers.unshift((t) => { const b = t.closest("[data-wsaved]"); if (b) { window.SCREq?.applySaved(+b.dataset.wsaved); return true; } return false; });
window.addEventListener("resize", () => { clearTimeout(paint.t); paint.t = setTimeout(paint, 200); });
paint();
})();
