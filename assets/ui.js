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

/* Bloque «Lectura»: interpretación en frases cortas bajo un bloque clave */
function lectura(frases, titulo = "Lectura") {
  const L = (frases || []).filter(Boolean);
  return L.length ? `<div class="ui-lect"><b>${esc(titulo)}</b>${L.map((x) => `<p>${esc(x)}</p>`).join("")}</div>` : "";
}

/* Lectura conjunta: cierre de una página. C = {conclusion, bloques[], vigilar[], cambiaria[]} */
function conjunta(C, sujeto, fuente = "generada con reglas a partir de los datos de esta página") {
  if (!C) return "";
  const ul = (xs) => `<ul>${(xs || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  return `<section class="ui-conj"><h3>Lectura conjunta${sujeto ? ` · ${esc(sujeto)}` : ""} <span>${esc(fuente)}</span></h3>
    <p class="ui-concl">${esc(C.conclusion)}</p>${C.bloques?.length ? `<ul class="ui-bl">${C.bloques.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
    <div class="ui-2c"><div><h4>Qué vigilar</h4>${ul(C.vigilar)}</div><div><h4>Qué cambiaría la lectura</h4>${ul(C.cambiaria)}</div></div>
    <div class="method">Lectura informativa, no es una recomendación de inversión. Si un dato falta o un modelo no está validado, la lectura lo dice.</div></section>`;
}

/* Línea de fuente y fecha bajo una cifra */
function fuente(nombre, url, extra) {
  const n = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(nombre)}</a>` : esc(nombre);
  return `<div class="ui-src">${n}${extra ? ` · ${esc(extra)}` : ""}</div>`;
}

H.ui = { pill, lectura, conjunta, fuente };
})();
