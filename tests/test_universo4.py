import io
import os
import sys
import zipfile

import pytest

pytest.importorskip("yfinance")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import fetch_equities as F  # noqa: E402


def _xlsx(rows):
    ss, sheet = [], []
    for r in rows:
        cells = []
        for v in r:
            ss.append(v)
            cells.append(f'<c t="s"><v>{len(ss) - 1}</v></c>')
        sheet.append("<row>" + "".join(cells) + "</row>")
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("xl/sharedStrings.xml", "<sst>" + "".join(f"<si><t>{x}</t></si>" for x in ss) + "</sst>")
        z.writestr("xl/worksheets/sheet1.xml", "<worksheet><sheetData>" + "".join(sheet) + "</sheetData></worksheet>")
    return b.getvalue()


def test_xlsx_y_cartera_spdr(monkeypatch):
    rows = [["Fund Name:", "SPDR X"], [], ["Holdings:"], ["Name", "Ticker", "Identifier", "Local Currency"],
            ["LOCKHEED MARTIN CORP", "LMT", "1", "USD"], ["BRK B", "BRK.B", "2", "USD"], ["ORSTED", "ORSTED", "3", "DKK"],
            ["CASH", "-", "4", "USD"], ["Past performance is no guarantee", "", "", ""]]
    monkeypatch.setattr(F, "get", lambda url, timeout=60: _xlsx(rows))
    assert F.spdr_holdings("xar") == ["LMT", "BRK-B"]


def test_region_asia_y_cierre_asiatico():
    assert ".T" in F.ASIA_SUFFIX and "7203.T".endswith(F.ASIA_SUFFIX) and not "SAN.MC".endswith(F.ASIA_SUFFIX)
