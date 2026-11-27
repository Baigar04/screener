"""Sonda de fuentes para la fase 4 (no forma parte del flujo diario): qué URLs responden desde GitHub Actions."""
import io
import json
import re
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (screener personal; github.com/Baigar04)"}


def get(u, t=60):
    req = urllib.request.Request(u, headers=UA)
    with urllib.request.urlopen(req, timeout=t) as r:
        return r.status, r.read()


def tryu(name, u):
    try:
        st, b = get(u)
        txt = b[:400].decode("utf-8", "replace").replace("\n", " | ")
        print(f"OK {name} {st} {len(b)} bytes :: {txt[:300]}")
        return b
    except Exception as e:  # noqa: BLE001
        print(f"FALLA {name} :: {str(e)[:150]}")
        return None


b = tryu("ishares-screener", "https://www.ishares.com/us/product-screener/product-screener-v3.1.jsn?dcrPath=/templatedata/config/product-screener-v3/data/en/us-ishares/ishares-product-screener-backend-config&siteEntryPassthrough=true")
want = ["IWM", "EWJ", "EWT", "EWY", "SOXX", "IBB", "ITA", "IHI", "IGV", "ICLN", "IRBO", "IHAK", "IDRV", "IYW", "IGF"]
found = {}
if b:
    try:
        d = json.loads(b)
        for pid, p in d.items():
            tk = (p.get("localExchangeTicker") or "").upper()
            if tk in want:
                found[tk] = (pid, p.get("productPageUrl"), p.get("fundName"))
        print("ishares ids:", json.dumps(found, ensure_ascii=False))
    except Exception as e:  # noqa: BLE001
        print("ishares parse", e, str(b[:300]))
for tk, (pid, url, nm) in found.items():
    u = f"https://www.ishares.com{url}/1467271812596.ajax?fileType=csv&fileName={tk}_holdings&dataType=fund"
    c = tryu("ishares-csv " + tk, u)
    if c:
        t = c.decode("utf-8", "replace").splitlines()
        h = next((i for i, x in enumerate(t) if x.startswith("Ticker,")), None)
        print("   header", h, t[h] if h is not None else "", "| filas", len(t) - (h or 0), "|", t[h + 1] if h is not None else "", "|", t[h + 2] if h is not None else "")
for tk in ["xar", "xsd", "xbi", "xsw", "cnrg", "komp"]:
    tryu("spdr " + tk, f"https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-{tk}.xlsx")
b = tryu("nikkei-oficial", "https://indexes.nikkei.co.jp/en/nkave/index/component?idx=nk225")
if b:
    codes = re.findall(r"<td[^>]*>\s*(\d{4})\s*</td>", b.decode("utf-8", "replace"))
    print("   nikkei códigos", len(codes), codes[:10])
b = tryu("wiki-nikkei", "https://en.wikipedia.org/wiki/Nikkei_225")
if b:
    s = b.decode("utf-8", "replace")
    print("   TYO", len(re.findall(r"TYO[^0-9]{0,40}(\d{4})", s)), "| 4 dígitos en tablas", len(re.findall(r"<td>\s*(\d{4})\s*</td>", s)))
for nm, u in [("wiki-tw50", "https://en.wikipedia.org/wiki/FTSE_TWSE_Taiwan_50_Index"), ("wiki-kospi200", "https://en.wikipedia.org/wiki/KOSPI_200"),
              ("wiki-r2000", "https://en.wikipedia.org/wiki/Russell_2000_Index")]:
    b = tryu(nm, u)
    if b:
        s = b.decode("utf-8", "replace")
        print("   códigos 4d", len(re.findall(r">\s*(\d{4})\s*<", s)), "6d", len(re.findall(r">\s*(\d{6})\s*<", s)))
