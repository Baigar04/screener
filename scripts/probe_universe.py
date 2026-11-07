"""Prueba temporal de fuentes para ampliar el universo (S&P 400 y STOXX Europe 600)."""
import io, urllib.request, pandas as pd
UA = {"User-Agent": "Mozilla/5.0 (screener personal; github.com/Baigar04)"}
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as r: return r.read()
try:
    t = pd.read_html(io.StringIO(get("https://en.wikipedia.org/wiki/List_of_S%26P_400_companies").decode()))
    for x in t[:4]: print("SP400 table", x.shape, list(x.columns)[:8]); print(x.head(3).to_string()[:400])
except Exception as e: print("SP400 ERR", e)
for u in ["https://www.ishares.com/uk/individual/en/products/251931/ishares-stoxx-europe-600-ucits-etf-de-fund/1506575576011.ajax?fileType=csv&fileName=EXSA_holdings&dataType=fund",
          "https://www.ishares.com/de/privatanleger/de/produkte/251931/ishares-stoxx-europe-600-ucits-etf-de-fund/1478358465952.ajax?fileType=csv&fileName=EXSA_holdings&dataType=fund"]:
    try:
        b = get(u).decode("utf-8-sig", "replace"); lines = b.splitlines(); print("ISHARES", u[:60], len(lines)); print("\n".join(lines[:14])); print("...", "\n".join(lines[300:304]))
        hdr = next(i for i, l in enumerate(lines) if l.startswith(("Ticker", "Emittententicker")))
        df = pd.read_csv(io.StringIO("\n".join(lines[hdr:])), sep=None, engine="python")
        print(df.shape); ex = [c for c in df.columns if "rse" in c or "Exchange" in c]; print(ex, df[ex[0]].value_counts().to_string() if ex else "")
        break
    except Exception as e: print("ISHARES ERR", u[:60], e)
try:
    t = pd.read_html(io.StringIO(get("https://en.wikipedia.org/wiki/STOXX_Europe_600").decode()))
    print("WIKI STOXX600 tables", [x.shape for x in t])
except Exception as e: print("WIKI600 ERR", e)
