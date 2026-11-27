"""Sonda de fuentes para la fase 4 (segunda ronda; no forma parte del flujo diario)."""
import re
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def tryu(name, u, h=None):
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA, **(h or {})})
        with urllib.request.urlopen(req, timeout=60) as r:
            b = r.read()
        print(f"OK {name} {len(b)} :: {b[:250].decode('utf-8', 'replace')!r}")
        return b
    except Exception as e:  # noqa: BLE001
        print(f"FALLA {name} :: {str(e)[:150]}")


base = "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund"
tryu("ishares-accept", base, {"Accept": "text/csv,*/*", "Referer": "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf"})
tryu("ishares-xhr", base, {"X-Requested-With": "XMLHttpRequest", "Accept": "*/*"})
tryu("ishares-sin-slug", "https://www.ishares.com/us/products/239710/1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund")
tryu("ishares-json", "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/1467271812596.ajax?tab=all&fileType=json")
tryu("spdr twok", "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-twok.xlsx")
tryu("vanguard vtwo", "https://investor.vanguard.com/investment-products/etfs/profile/api/VTWO/portfolio-holding/stock")
for nm, u in [("zh-tw50", "https://zh.wikipedia.org/wiki/%E8%87%BA%E7%81%A350%E6%8C%87%E6%95%B8"), ("en-taiex", "https://en.wikipedia.org/wiki/TAIEX"),
              ("en-tw50b", "https://en.wikipedia.org/wiki/Taiwan_50_Index")]:
    b = tryu(nm, u)
    if b:
        print("   códigos 4d", len(set(re.findall(r">\s*(\d{4})\s*<", b.decode("utf-8", "replace")))))
try:
    import yfinance as yf
    from yfinance import EquityQuery
    for reg in ("tw", "kr", "jp"):
        q = EquityQuery("eq", ["region", reg])
        r = yf.screen(q, sortField="intradaymarketcap", sortAsc=False, size=100)
        qs = r.get("quotes", [])
        print("yf.screen", reg, len(qs), [x.get("symbol") for x in qs[:12]])
except Exception as e:  # noqa: BLE001
    print("FALLA yf.screen", e)
