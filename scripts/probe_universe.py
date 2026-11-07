import io, urllib.request, pandas as pd
UA = {"User-Agent": "Mozilla/5.0 (screener personal; github.com/Baigar04)"}
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as r: return r.read()
t = [x for x in pd.read_html(io.StringIO(get("https://en.wikipedia.org/wiki/STOXX_Europe_600").decode())) if len(x) > 500][0]
print(list(t.columns)); print(t.head(25).to_string()); print(t.sample(25, random_state=1).to_string())
for c in t.columns:
    if t[c].nunique() < 60: print(c, t[c].value_counts().to_string())
