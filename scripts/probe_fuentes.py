"""Sonda de fuentes para la fase 4 (cuarta ronda: Russell 2000)."""
import http.cookiejar
import sys
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
op.addheaders = [("User-Agent", UA), ("Accept-Language", "en-US,en;q=0.9")]
pg = "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf"
for u in (pg + "?siteEntryPassthrough=true", pg + "/1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund",
          pg + "/1521942788811.ajax?fileType=xls&fileName=iShares-Russell-2000-ETF_fund&dataType=fund"):
    try:
        b = op.open(u, timeout=60).read()
        print("ishares-cookie", u[-60:], len(b), repr(b[:160]), "| cookies", len(cj))
    except Exception as e:  # noqa: BLE001
        print("FALLA", u[-60:], e)
try:
    import yfinance as yf
    from yfinance import EquityQuery as Q
    q = Q("and", [Q("eq", ["region", "us"]), Q("btwn", ["intradaymarketcap", 2e8, 8e9]), Q("is-in", ["exchange", "NMS", "NYQ", "NGM", "NCM", "ASE"])])
    n = []
    for off in (0, 250, 1750):
        r = yf.screen(q, offset=off, size=250, sortField="intradaymarketcap", sortAsc=False)
        n.append((off, len(r.get("quotes", [])), r.get("total"), [x.get("symbol") for x in r.get("quotes", [])[:5]]))
    print("yf.screen usa pequeñas", n)
except Exception as e:  # noqa: BLE001
    print("FALLA yf.screen", e)
