// Extrae funciones puras de los ficheros del front (que viven dentro de una IIFE) y las evalúa.
// Uso: node tests/js_eval.mjs <fichero.js> "<nombres separados por comas>" "<expresión JS>"  → imprime JSON
import { readFileSync } from "node:fs";
const [file, names, expr] = process.argv.slice(2);
const src = readFileSync(file, "utf8");
function grab(name) {
  const re = new RegExp(`^(const ${name} = [^\\n]*;|function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\})`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`no encuentro ${name} en ${file}`);
  return m[0];
}
const code = names.split(",").map(grab).join("\n") + `\nreturn (${expr});`;
console.log(JSON.stringify(new Function(code)()));
