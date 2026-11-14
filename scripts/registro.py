"""Registro inmutable de la nota: una foto por sesión, encadenada con huellas SHA-256 (Fase 7).

Cada sesión se guarda en la rama copia-datos como registro/AAAA-MM-DD.json (la nota con los pesos por defecto,
el veredicto técnico y el del laboratorio) y se añade una entrada a registro/cadena.json:
    {"f": fecha, "n": valores, "hd": sha256(foto), "prev": huella anterior, "h": sha256(prev|f|hd|n)}
Una foto ya registrada nunca se reescribe (la primera de cada sesión es la que vale). Si alguien cambia una foto
o una entrada antigua, la comprobación lo detecta y deja de añadir hasta que se revise.

Uso: python scripts/registro.py data/score.json <carpeta registro de copia-datos> data/registro.json
Escribe también data/registro.json (resumen público: íntegra o no, días, primera y última sesión).
"""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

ZERO = "0" * 64


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()


def snapshot(score):
    """Lo que dijo el screener ese día: nota por valor (pesos por defecto), técnico y veredicto del laboratorio."""
    nota = {s: v for s, v in (score.get("total_defecto") or {}).items() if v is not None}
    lab = score.get("veredicto_lab")
    return {"fecha": score.get("fecha_precio"), "nota": nota, "tec": score.get("veredictos") or {},
            "pesos": score.get("pesos_defecto") or {}, "lab": lab.get("etiqueta") if isinstance(lab, dict) else lab,
            "metodo": score.get("metodo") or "v1 · hasta el 13-nov-2026 · factor sin dato: su peso se repartía entre los demás"}


def link(prev, f, hd, n):
    return sha(f"{prev}|{f}|{hd}|{n}")


def append(chain, snap):
    """Añade la foto si su sesión no está registrada. Devuelve (cadena, entrada nueva o None)."""
    if not snap.get("fecha") or not snap["nota"] or any(e["f"] == snap["fecha"] for e in chain):
        return chain, None
    if chain and snap["fecha"] < chain[-1]["f"]:
        return chain, None   # nunca se registra hacia atrás
    prev = chain[-1]["h"] if chain else ZERO
    hd = sha(canonical(snap))
    e = {"f": snap["fecha"], "n": len(snap["nota"]), "hd": hd, "prev": prev, "h": link(prev, snap["fecha"], hd, len(snap["nota"]))}
    return chain + [e], e


def verify(chain, folder=None):
    """(íntegra, motivo, fotos comprobadas). Comprueba cada eslabón y, si hay carpeta, la huella de cada foto guardada."""
    prev, checked = ZERO, 0
    for i, e in enumerate(chain):
        if e.get("prev") != prev:
            return False, f"eslabón {i + 1} ({e.get('f')}): no enlaza con el anterior", checked
        if e.get("h") != link(e["prev"], e["f"], e["hd"], e["n"]):
            return False, f"eslabón {i + 1} ({e.get('f')}): huella alterada", checked
        if folder:
            p = os.path.join(folder, e["f"] + ".json")
            if os.path.exists(p):
                if sha(canonical(json.load(open(p, encoding="utf-8")))) != e["hd"]:
                    return False, f"la foto del {e['f']} no coincide con su huella", checked
                checked += 1
        prev = e["h"]
    return True, "", checked


def main(score_path, folder, out_path):
    os.makedirs(folder, exist_ok=True)
    cpath = os.path.join(folder, "cadena.json")
    chain = json.load(open(cpath)).get("entradas", []) if os.path.exists(cpath) else []
    ok, why, checked = verify(chain, folder)
    nueva = None
    snap = snapshot(json.load(open(score_path, encoding="utf-8")))
    if ok:
        chain, nueva = append(chain, snap)
        if nueva:
            fp = os.path.join(folder, nueva["f"] + ".json")
            if not os.path.exists(fp):   # una foto registrada no se reescribe nunca
                with open(fp, "w", encoding="utf-8") as fh:
                    json.dump(snap, fh, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            json.dump({"version": 1, "algoritmo": "sha256", "entradas": chain}, open(cpath, "w"), separators=(",", ":"))
            ok, why, checked = verify(chain, folder)
    pub = {"generado": datetime.now(timezone.utc).isoformat(timespec="seconds"), "integra": ok, "motivo": why,
           "dias": len(chain), "fotos_comprobadas": checked, "desde": chain[0]["f"] if chain else None,
           "hasta": chain[-1]["f"] if chain else None, "ultima": chain[-1] if chain else None,
           "nueva": bool(nueva), "donde": "rama copia-datos del repositorio, carpeta registro/", "metodo": snap.get("metodo")}
    json.dump(pub, open(out_path, "w"), separators=(",", ":"))
    print(f"Registro inmutable: {'íntegro' if ok else 'ALTERADO: ' + why} · {len(chain)} sesiones · fotos comprobadas {checked}"
          f" · {'añadida ' + nueva['f'] if nueva else 'sin sesión nueva'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
