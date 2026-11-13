"""Fase 2 · tanda 2: formulario 4 (compras y ventas de directivos)."""
from datetime import date

import fetch_insiders as fi

IDX = """Form Type   Company Name                                                  CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------------------------------------------------------
4           APPLE INC                                                     320193      20261112    edgar/data/320193/0001140361-26-000001.txt
4           COOK TIMOTHY D                                                1214156     20261112    edgar/data/320193/0001140361-26-000001.txt
4/A         APPLE INC                                                     320193      20261112    edgar/data/320193/0001140361-26-000002.txt
10-Q        APPLE INC                                                     320193      20261112    edgar/data/320193/0000320193-26-000010.txt
4           OTRA EMPRESA                                                  999         20261112    edgar/data/999/0000000999-26-000001.txt
"""

XML = b"""<SEC-DOCUMENT><XML><?xml version="1.0"?>
<ownershipDocument>
  <issuer><issuerCik>0000320193</issuerCik><issuerTradingSymbol>AAPL</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerName>Cook Timothy D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>CEO</officerTitle></reportingOwnerRelationship></reportingOwner>
  <aff10b5One>1</aff10b5One>
  <nonDerivativeTable>
    <nonDerivativeTransaction><transactionDate><value>2026-11-10</value></transactionDate><transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>250.5</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>
    <nonDerivativeTransaction><transactionDate><value>2026-11-10</value></transactionDate><transactionCoding><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>5000</value></transactionShares></transactionAmounts></nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument></XML></SEC-DOCUMENT>"""


def test_indice_solo_formularios_4_del_universo():
    items = fi.parse_index(IDX, {320193: "AAPL"})
    assert items == [(320193, "edgar/data/320193/0001140361-26-000001.txt")]   # sin enmiendas, sin duplicados, sin 10-Q


def test_formulario_4_solo_mercado_abierto():
    cik, ops = fi.parse_form4(XML)
    assert cik == 320193 and len(ops) == 1                                       # el ejercicio de opciones (M) no cuenta
    o = ops[0]
    assert o["codigo"] == "S" and o["importe"] == 250500 and o["plan"] is True
    assert o["cargo"] == "CEO, Consejero" and o["nombre"] == "Cook Timothy D"


def test_resumen_y_racimo_de_compras():
    base = {"sym": "XYZ", "codigo": "P", "importe": 100000, "plan": False}
    ops = [{**base, "nombre": "A", "fecha_op": "2026-10-01"}, {**base, "nombre": "B", "fecha_op": "2026-10-15"},
           {**base, "nombre": "C", "fecha_op": "2026-10-28"}, {**base, "nombre": "D", "fecha_op": "2026-01-01"},
           {**base, "sym": "ABC", "codigo": "S", "nombre": "E", "fecha_op": "2026-11-01", "plan": True}]
    r = fi.summarize(ops, date(2026, 11, 13))
    assert r["XYZ"]["compras"] == 300000 and r["XYZ"]["compradores"] == 3 and r["XYZ"]["racimo"] is True
    assert r["ABC"]["ventas"] == r["ABC"]["ventas_plan"] == 100000 and r["ABC"]["racimo"] is False


def test_fecha_de_dataroma():
    import fetch_smart
    assert fetch_smart.iso_day("14 Nov 2025") == "2025-11-14"
    assert fetch_smart.iso_day("Nov 14, 2025") == "2025-11-14"
    assert fetch_smart.iso_day("") is None and fetch_smart.iso_day(None) is None
