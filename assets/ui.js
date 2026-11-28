/* Screener · piezas comunes de interfaz (reorganización del 25-nov-2026). Se definen una vez y las usan todas las páginas:
   bloque «Lectura», lectura conjunta, etiqueta de régimen y línea de fuente y fecha. */
(() => {
"use strict";
const H = window.SCR;
const { esc } = H;

/* Etiqueta de régimen: Normal · Tensión · Alerta · Sin ventaja (si el modelo no está validado) */
function pill(regimen, validado = true) {
  if (!validado) return `<span class="ui-pill nu" data-tip="El modelo no mejora a la media histórica fuera de muestra">Sin ventaja</span>`;
  const cls = regimen === "Alerta" ? "ko" : regimen === "Tensión" ? "te" : regimen === "Normal" ? "ok" : "nu";
  return `<span class="ui-pill ${cls}">${esc(regimen || "—")}</span>`;
}

const XP = () => H.S.mode === "x";
/* Bloque «Lectura»: la primera frase a la vista; el resto, plegado (abierto en modo Explicado) */
function lectura(frases, titulo = "Lectura") {
  const L = (frases || []).filter(Boolean);
  if (!L.length) return "";
  const rest = L.slice(1);
  return `<div class="ui-lect"><b>${esc(titulo)}</b><p>${esc(L[0])}</p>${rest.length ? `<details class="ui-det ui-det-in" ${XP() ? "open" : ""}><summary>Leer más</summary>${rest.map((x) => `<p>${esc(x)}</p>`).join("")}</details>` : ""}</div>`;
}
/* Explicación plegable («Cómo leerlo», «Cómo se calcula»): cerrada en Compacto, abierta en Explicado */
function exp(html, resumen = "Cómo leerlo") {
  return `<details class="ui-det" ${XP() ? "open" : ""}><summary>${esc(resumen)}</summary><div class="ui-det-b">${html}</div></details>`;
}
/* Pliega en toda la web los textos explicativos largos que generan los módulos antiguos (.method, .rsk-exp, .lab-intro):
   los cortos se quedan como estaban; los largos pasan a un desplegable. Se aplica también a lo que se monta después. */
function fold(root) {
  if (!root) return;
  root.querySelectorAll(".rsk-exp:not(.ui-keep), .method:not(.keep), .lab-intro").forEach((el) => {
    if (el.closest(".ui-det") || el.dataset.uiF) return;
    const txt = (el.textContent || "").trim();
    if (txt.length < 140 && !el.classList.contains("rsk-exp")) return;
    el.dataset.uiF = "1";
    const b = el.querySelector(":scope > b:first-child");
    let sum = b ? b.textContent.replace(/[.:]\s*$/, "") : el.classList.contains("method") ? "Método y fuentes" : "Cómo leerlo";
    if (sum.length > 48) sum = "Cómo leerlo";
    if (b) b.remove();
    const d = document.createElement("details");
    d.className = "ui-det";
    if (XP()) d.open = true;
    d.innerHTML = `<summary>${esc(sum)}</summary>`;
    el.replaceWith(d);
    el.classList.add("ui-det-b");
    d.appendChild(el);
  });
}
let foldT = null;
const obs = new MutationObserver(() => { clearTimeout(foldT); foldT = setTimeout(() => fold(document.getElementById("view")), 30); });
const v0 = document.getElementById("view");
if (v0) obs.observe(v0, { childList: true, subtree: true });
H.after.push(() => fold(document.getElementById("view")));

/* Lectura conjunta: cierre de una página. C = {conclusion, bloques[], vigilar[], cambiaria[]} */
function conjunta(C, sujeto, fuente = "generada con reglas a partir de los datos de esta página") {
  if (!C) return "";
  const ul = (xs) => `<ul>${(xs || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  return `<section class="ui-conj"><h3>Lectura conjunta${sujeto ? ` · ${esc(sujeto)}` : ""} <span>${esc(fuente)}</span></h3>
    <p class="ui-concl">${esc(C.conclusion)}</p>
    <details class="ui-det ui-det-in" ${XP() ? "open" : ""}><summary>Ver la lectura completa: claves, qué vigilar y qué la cambiaría</summary>
    ${C.bloques?.length ? `<ul class="ui-bl">${C.bloques.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
    <div class="ui-2c"><div><h4>Qué vigilar</h4>${ul(C.vigilar)}</div><div><h4>Qué cambiaría la lectura</h4>${ul(C.cambiaria)}</div></div></details>
    <div class="method keep">Lectura informativa, no es una recomendación de inversión. Si un dato falta o un modelo no está validado, la lectura lo dice.</div></section>`;
}

/* Línea de fuente y fecha bajo una cifra */
function fuente(nombre, url, extra) {
  const n = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(nombre)}</a>` : esc(nombre);
  return `<div class="ui-src">${n}${extra ? ` · ${esc(extra)}` : ""}</div>`;
}

H.ui = { pill, lectura, conjunta, fuente, exp, fold };
})();
