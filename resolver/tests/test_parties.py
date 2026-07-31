"""Channel A party-extraction tests (W5.1).

Exercise the deterministic heuristic backend (the bare-venv / CI path). The GLiNER path is
Docker-only and not covered here; the heuristic must stand on its own for CI to pass.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.parties import extract_parties, gliner_available

client = TestClient(app)


def test_health_reports_gliner_backend():
    body = client.get("/health").json()
    assert "gliner" in body["backends"]
    assert body["backends"]["gliner"] == gliner_available()


def test_listing_broker_exclusively_retained():
    note = ("Colliers International has been exclusively retained to market the "
            "single-tenant Fresenius clinic at 100 Main Street.")
    r = extract_parties(note)
    assert r["listing_broker"] and "Colliers" in r["listing_broker"]
    # span is anchored and points back into the note
    span = next(s for s in r["spans"] if s["field"] == "listing_broker")
    assert note[span["start"]:span["end"]].strip().startswith("Colliers")


def test_listing_broker_pleased_to_present():
    note = "Ciminelli is pleased to exclusively present the opportunity to acquire a dialysis facility."
    r = extract_parties(note)
    assert r["listing_broker"] == "Ciminelli"


def test_buyer_acquired_by():
    note = "The property was acquired by Ridgeline Capital Partners on April 30, 2020 for $26,900,000."
    r = extract_parties(note)
    assert r["buyer"] and "Ridgeline Capital Partners" in r["buyer"]
    assert r["price"] == 26_900_000


def test_buyer_subject_acquired():
    note = "Ridgeline Capital Partners acquired a portfolio of medical office buildings in North Texas."
    r = extract_parties(note)
    assert r["buyer"] and r["buyer"].startswith("Ridgeline Capital Partners")


def test_seller_sold_by():
    note = "The asset was sold by DaVita Inc. to a private investor."
    r = extract_parties(note)
    assert r["seller"] and "DaVita" in r["seller"]


def test_lender_financed_by():
    note = "The acquisition was financed by Wells Fargo Bank with a $12,000,000 loan."
    r = extract_parties(note)
    assert r["lender"] and "Wells Fargo" in r["lender"]


def test_price_million_shorthand():
    note = "Offered at $6.5 million, this is an exceptional investment."
    r = extract_parties(note)
    assert r["price"] == 6_500_000


def test_cap_rate_extraction():
    note = "The deal traded at a 7.25% cap rate, reflecting strong demand."
    r = extract_parties(note)
    assert r["cap_rate"] == 0.0725


def test_federal_and_junk_never_a_party():
    note = "The property is leased to the GSA. The seller was represented by the team."
    r = extract_parties(note)
    # "GSA" and "the team" must never surface as a party
    assert r["buyer"] is None
    for s in r["spans"]:
        assert "gsa" not in (s["text"] or "").lower()
        assert (s["text"] or "").lower() != "the team"


def test_empty_note_returns_all_none():
    r = extract_parties("")
    assert r["backend"] in ("heuristic", "gliner")
    assert all(r[f] is None for f in ("buyer", "seller", "listing_broker", "procuring_broker", "lender"))
    assert r["spans"] == []


def test_route_shape():
    note = "CBRE has been exclusively retained. Acquired by Blue Owl Capital for $10,000,000 at a 6.5% cap."
    r = client.post("/extract-parties", json={"text": note})
    assert r.status_code == 200
    body = r.json()
    assert body["backend"] in ("heuristic", "gliner")
    assert body["listing_broker"] and "CBRE" in body["listing_broker"]
    assert body["price"] == 10_000_000
    assert body["cap_rate"] == 0.065
    assert isinstance(body["spans"], list)


def test_procuring_broker_represented_buyer():
    note = "The buyer was represented by Marcus & Millichap in the transaction."
    r = extract_parties(note)
    assert r["procuring_broker"] and "Marcus" in r["procuring_broker"]
