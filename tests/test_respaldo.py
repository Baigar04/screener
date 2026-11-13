"""Fase 1.5: respaldo de precios con Tiingo (sin red: se simula la respuesta)."""
import io
import json
import sys
import types
import urllib.error

import pandas as pd
import pytest

try:
    import yfinance  # noqa: F401
except ImportError:  # en local sin yfinance: estas pruebas no lo usan
    sys.modules["yfinance"] = types.ModuleType("yfinance")
import fetch_equities as fe  # noqa: E402


def test_tickers_de_tiingo():
    assert fe.tiingo_symbol("AAPL") == "aapl" and fe.tiingo_symbol("BRK-B") == "brk-b"
    assert fe.tiingo_symbol("SAP.DE") is None and fe.tiingo_symbol("^GSPC") is None


def payload(n=60):
    days = pd.bdate_range("2026-01-02", periods=n)
    return json.dumps([{"date": f"{d:%Y-%m-%d}T00:00:00.000Z", "open": 10 + i, "high": 11 + i, "low": 9 + i, "close": 10.5 + i, "volume": 1000 + i,
                        "adjOpen": 5 + i, "adjHigh": 5.5 + i, "adjLow": 4.5 + i, "adjClose": 5.2 + i, "adjVolume": 2000 + i,
                        "divCash": 0.5 if i == 10 else 0.0, "splitFactor": 1.0} for i, d in enumerate(days)]).encode()


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_fallo_simulado_de_yahoo_usa_tiingo(monkeypatch):
    calls = []
    monkeypatch.setattr(fe, "TIINGO_KEY", "x")
    monkeypatch.setattr(fe.urllib.request, "urlopen", lambda req, timeout=30: calls.append(req) or Resp(payload()))
    fe.TIINGO_USED.clear()
    frames, raw = {}, {}
    n = fe.tiingo_fallback(["AAPL", "SAN.MC", "MSFT"], frames, raw)
    assert n == 2 and set(frames) == {"AAPL", "MSFT"} == fe.TIINGO_USED
    assert "/daily/aapl/prices" in calls[0].full_url and calls[0].get_header("Authorization") == "Token x"
    assert raw["AAPL"]["Close"].iloc[-1] == pytest.approx(69.5)          # sin ajustar, como Yahoo
    assert frames["AAPL"]["Close"].iloc[-1] == pytest.approx(64.2)       # ajustado
    assert raw["AAPL"]["Dividends"].sum() == pytest.approx(0.5)


def test_sin_clave_no_hace_nada(monkeypatch):
    monkeypatch.setattr(fe, "TIINGO_KEY", "")
    frames, raw = {}, {}
    assert fe.tiingo_fallback(["AAPL"], frames, raw) == 0 and not frames


def test_limite_de_tiingo_corta(monkeypatch):
    def boom(req, timeout=30):
        raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {}, None)
    monkeypatch.setattr(fe, "TIINGO_KEY", "x")
    monkeypatch.setattr(fe.urllib.request, "urlopen", boom)
    fe.TIINGO_USED.clear()
    frames, raw = {}, {}
    assert fe.tiingo_fallback(["AAPL", "MSFT"], frames, raw) == 0 and not frames


def test_simulacion_por_lista(monkeypatch):
    monkeypatch.setattr(fe, "_SIM", "AAPL,MSFT")
    assert fe.yahoo_fails("AAPL") and not fe.yahoo_fails("NVDA")
    monkeypatch.setattr(fe, "_SIM", "")
    assert not fe.yahoo_fails("AAPL")
