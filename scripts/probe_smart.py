"""Sondeo temporal: imprime la estructura de las fuentes de smart money."""
import io, json, re, urllib.request, zipfile
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
SEC = {"User-Agent": "Screener personal github.com/Baigar04 screener@users.noreply.github.com"}
def get(u, h=UA, n=None):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=60) as r:
            b = r.read(); print(f"\n==== {u} [{r.status}] {len(b)} bytes"); return b
    except Exception as e:
        print(f"\n==== {u} ERROR {e}"); return b""
h = get("https://www.dataroma.com/m/home.php").decode("utf-8", "replace")
links = re.findall(r'href="(/m/holdings\.php\?m=[^"]+)"[^>]*>(.*?)</a>', h, re.S)
print("gestores:", len(links)); print(links[:8])
i = h.find("holdings.php"); print(h[i-600:i+900])
b = get("https://www.dataroma.com/m/holdings.php?m=BRK").decode("utf-8", "replace")
i = b.find("<table"); print(b[i-400:i+3500])
a = get("https://www.dataroma.com/m/allact.php?typ=a").decode("utf-8", "replace")
i = a.find("<table"); print(a[i:i+2500])
w = get("https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json")
if w:
    try:
        j = json.loads(w); ds = sorted(x.get("disclosure_date", "") for x in j)[-5:]; print("watcher filas", len(j), "últimas", ds, j[-1])
    except Exception as e: print("watcher json", e, w[:300])
z = get("https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2026FD.zip")
if z:
    zf = zipfile.ZipFile(io.BytesIO(z)); print(zf.namelist())
    x = zf.read([n for n in zf.namelist() if n.endswith(".xml")][0]).decode("utf-8", "replace")
    print(x[:800]); pel = [m for m in re.findall(r"<Member>.*?</Member>", x, re.S) if "Pelosi" in m]; print("pelosi", len(pel), pel[-2:] if pel else "")
    ptr = re.findall(r"<FilingType>P</FilingType>", x); print("PTR 2026:", len(ptr))
    if pel:
        doc = re.search(r"<DocID>(\d+)</DocID>", pel[-1]).group(1); yr = re.search(r"<Year>(\d+)</Year>", pel[-1]).group(1)
        pdf = get(f"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{yr}/{doc}.pdf")
        open("/tmp/p.pdf", "wb").write(pdf)
s = get("https://data.sec.gov/submissions/CIK0001029160.json", SEC)
if s:
    j = json.loads(s); r = j["filings"]["recent"]
    f = [(r["form"][k], r["accessionNumber"][k], r["filingDate"][k], r["reportDate"][k]) for k in range(len(r["form"])) if r["form"][k].startswith("13F")][:3]
    print(j["name"], f)
    if f:
        acc = f[0][1].replace("-", ""); idx = get(f"https://www.sec.gov/Archives/edgar/data/1029160/{acc}/index.json", SEC)
        if idx:
            items = json.loads(idx)["directory"]["item"]; print([it["name"] for it in items])
            xmlf = [it["name"] for it in items if it["name"].endswith(".xml") and "primary" not in it["name"]]
            if xmlf: t = get(f"https://www.sec.gov/Archives/edgar/data/1029160/{acc}/{xmlf[0]}", SEC).decode(); print(t[:1500])
