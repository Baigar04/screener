"""Sonda de fuentes para la fase 4 (tercera ronda; no forma parte del flujo diario)."""
import io
import re
import sys
import urllib.request
import zipfile

sys.path.insert(0, "scripts")
UA = "Mozilla/5.0 (screener personal; github.com/Baigar04)"


def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=60) as r:
        return r.read()


for tk, pid, slug in (("IWM", "239710", "ishares-russell-2000-etf"), ("ITA", "239502", "ishares-u-s-aerospace-defense-etf")):
    u = f"https://www.ishares.com/us/products/{pid}/{slug}/1467271812596.ajax?fileType=csv&fileName={tk}_holdings&dataType=fund&siteEntryPassthrough=true"
    try:
        b = get(u).decode("utf-8", "replace")
        L = b.splitlines()
        h = next((i for i, x in enumerate(L) if x.startswith("Ticker,")), None)
        print("ishares", tk, len(b), "header", h, L[h] if h is not None else L[:3], "|", L[h + 1] if h is not None else "", "| filas", len(L))
    except Exception as e:  # noqa: BLE001
        print("FALLA ishares", tk, e)


def xlsx_rows(b):
    z = zipfile.ZipFile(io.BytesIO(b))
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        x = z.read("xl/sharedStrings.xml").decode("utf-8")
        ss = [re.sub(r"<[^>]+>", "", m) for m in re.findall(r"<si>(.*?)</si>", x, re.S)]
    sh = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
    out = []
    for row in re.findall(r"<row[^>]*>(.*?)</row>", sh, re.S):
        cells = []
        for attrs, inner in re.findall(r"<c([^>]*)>(.*?)</c>", row, re.S):
            v = re.search(r"<v>(.*?)</v>", inner, re.S)
            t = re.search(r't="(\w+)"', attrs)
            val = v.group(1) if v else re.sub(r"<[^>]+>", "", inner)
            if t and t.group(1) == "s" and v:
                val = ss[int(val)]
            cells.append(val)
        out.append(cells)
    return out


for tk in ("xar", "xsd", "komp"):
    try:
        R = xlsx_rows(get(f"https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-{tk}.xlsx"))
        h = next(i for i, r in enumerate(R) if "Ticker" in r)
        print("spdr", tk, "cabecera", h, R[h], "| ejemplo", R[h + 1], "| filas", len(R) - h - 1)
    except Exception as e:  # noqa: BLE001
        print("FALLA spdr", tk, e)
b = get("https://indexes.nikkei.co.jp/en/nkave/index/component?idx=nk225").decode("utf-8", "replace")
c = re.findall(r"<td[^>]*>\s*(\d{3}[0-9A-Z])\s*</td>", b)
print("nikkei", len(c), len(set(c)), [x for x in c if not x.isdigit()])
b = get("https://en.wikipedia.org/wiki/KOSPI_200").decode("utf-8", "replace")
c = re.findall(r">\s*(\d{6})\s*<", b)
print("kospi200", len(c), len(set(c)), c[:15])
