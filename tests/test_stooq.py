"""Fase 1.5: respaldo de precios con Stooq (sin red: se simula la respuesta)."""
import sys
import types

import pandas as pd
import pytest

try:
    import yfinance  # noqa: F401
except ImportError:  # en local sin yfinance: estas pruebas no lo usan
    sys.modules["yfinance"] = types.ModuleType("yfinance")
import fetch_equities as fe  # noqa: E402


def test_tickers_de_stooq():
    assert fe.stooq_symbol("AAPL") == "aapl.us"
    assert fe.stooq_symbol("BRK-B") == "brk-b.us"
    assert fe.stooq_symbol("SAP.DE") == "sap.de"
    assert fe.stooq_symbol("BARC.L") == "barc.uk"
    assert fe.stooq_symbol("SAN.MC") is None and fe.stooq_symbol("^GSPC") is None


def csv(n=60):
    days = pd.bdate_range("2026-01-02", periods=n)
    lines = ["Date,Open,High,Low,Close,Volume"] + [f"{d:%Y-%m-%d},{10+i},{11+i},{9+i},{10.5+i},{1000+i}" for i, d in enumerate(days)]
    return "\n".join(lines).encode()


def test_fallo_simulado_de_yahoo_usa_stooq(monkeypatch):
    calls = []
    monkeypatch.setattr(fe, "get", lambda url, timeout=60: calls.append(url) or csv())
    monkeypatch.setattr(fe.time, "sleep", lambda *_: None)
    fe.STOOQ_USED.clear()
    frames, raw = {}, {}
    n = fe.stooq_fallback(["AAPL", "SAN.MC", "SAP.DE"], frames, raw)
    assert n == 2 and set(frames) == {"AAPL", "SAP.DE"} == fe.STOOQ_USED
    assert "s=aapl.us" in calls[0]
    assert list(frames["AAPL"].columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert (raw["AAPL"]["Dividends"] == 0).all()
    assert frames["AAPL"]["Close"].iloc[-1] == pytest.approx(10.5 + 59)


def test_limite_diario_de_stooq_corta(monkeypatch):
    monkeypatch.setattr(fe, "get", lambda url, timeout=60: b"Exceeded the daily hits limit")
    fe.STOOQ_USED.clear()
    frames, raw = {}, {}
    assert fe.stooq_fallback(["AAPL", "MSFT"], frames, raw) == 0 and not frames


def test_simulacion_por_lista(monkeypatch):
    monkeypatch.setattr(fe, "_SIM", "AAPL,MSFT")
    assert fe.yahoo_fails("AAPL") and not fe.yahoo_fails("NVDA")
    monkeypatch.setattr(fe, "_SIM", "")
    assert not fe.yahoo_fails("AAPL")
