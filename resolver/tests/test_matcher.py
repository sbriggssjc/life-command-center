"""Fixture match suite (the W4.2 verification set).

Covers: legal-form variants (must score high), address-anchored pairs, and the W3.3
false-merge negatives (semantic-token collapse must NOT auto-link).
"""
import math

from app.model import FSModel, seed_model
from app.registry import registry


def _model(name="owner_owner"):
    # Use the trained default committed under fixtures/; fall back to seed.
    return registry.get(name)


def test_legal_form_variant_scores_high():
    fs = _model()
    r = fs.score_pair(
        {"name": "Cedar Point Holdings LLC", "address": "100 Main St, Dallas, TX 75201", "state": "TX"},
        {"name": "Cedar Point Holdings, L.L.C.", "address": "100 Main Street, Dallas, TX 75201", "state": "TX"},
    )
    assert r["probability"] >= fs.auto_link
    assert r["band"] == "auto_link"
    # name comparison should recognise the exact-core (legal-form) level
    name_lv = [c for c in r["comparison_vector"] if c["comparison"] == "name"][0]
    assert name_lv["level"] in (2, 3)


def test_address_anchored_pair_matches():
    fs = _model()
    r = fs.score_pair(
        {"name": "Boyd Watterson Asset Management LLC", "address": "1301 E 9th St, Cleveland, OH 44114", "state": "OH"},
        {"name": "Boyd Watterson Asset Management", "address": "1301 East 9th Street, Cleveland OH", "state": "OH"},
    )
    assert r["probability"] >= fs.auto_link


def test_w33_semantic_collapse_does_not_autolink():
    fs = _model()
    # Smith Group LLC vs Smith Partners LP — the W3.3 archetype false merge.
    r = fs.score_pair(
        {"name": "Smith Group LLC", "address": "5 Elm St, Austin, TX 78701", "state": "TX"},
        {"name": "Smith Partners LP", "address": "900 Congress Ave, Austin, TX 78701", "state": "TX"},
    )
    assert r["band"] != "auto_link"
    assert r["probability"] < fs.auto_link


def test_cowperwood_co_vs_company_not_autolink():
    fs = _model()
    r = fs.score_pair(
        {"name": "Cowperwood Co.", "address": "12 Wall St, New York, NY 10005", "state": "NY"},
        {"name": "Cowperwood Company", "address": "88 Beacon St, Boston, MA 02108", "state": "MA"},
    )
    assert r["band"] != "auto_link"


def test_same_city_different_owner_rejected():
    fs = _model()
    r = fs.score_pair(
        {"name": "Greenfield Medical LLC", "address": "12 Main St, Columbus, OH 43215", "state": "OH"},
        {"name": "Redstone Capital LLC", "address": "44 High St, Columbus, OH 43215", "state": "OH"},
    )
    assert r["band"] == "auto_reject" or r["probability"] <= fs.auto_reject


def test_comparison_vector_shape():
    fs = _model()
    r = fs.score_pair({"name": "A LLC", "state": "TX"}, {"name": "A LLC", "state": "TX"})
    assert 0.0 <= r["probability"] <= 1.0
    comps = {c["comparison"] for c in r["comparison_vector"]}
    assert comps == {"name", "address", "state"}
    for c in r["comparison_vector"]:
        assert "match_weight_log2" in c and "level_label" in c


def test_null_field_contributes_zero_weight():
    fs = _model()
    # address missing on both sides → address weight must be 0 (no evidence)
    r = fs.score_pair({"name": "X LLC", "state": "TX"}, {"name": "X LLC", "state": "TX"})
    addr = [c for c in r["comparison_vector"] if c["comparison"] == "address"][0]
    assert addr["level"] is None
    assert addr["match_weight_log2"] == 0.0


def test_owner_sf_uses_sf_account_comparison():
    fs = registry.get("owner_sf")
    r = fs.score_pair(
        {"name": "Cedar Point Holdings LLC", "sf_account": "0016000001ABCDE", "state": "TX"},
        {"name": "Cedar Point Holdings", "sf_account": "0016000001ABCDE", "state": "TX"},
    )
    comps = {c["comparison"] for c in r["comparison_vector"]}
    assert "sf_account" in comps
    sf = [c for c in r["comparison_vector"] if c["comparison"] == "sf_account"][0]
    assert sf["level"] == 1  # exact sf id match


def test_seed_model_scores_sanely_without_training():
    fs = seed_model("owner_owner")
    strong = fs.score_pair(
        {"name": "Acme Holdings LLC", "address": "1 A St, Reno, NV", "state": "NV"},
        {"name": "Acme Holdings", "address": "1 A Street, Reno NV", "state": "NV"},
    )
    weak = fs.score_pair(
        {"name": "Acme Holdings LLC", "address": "1 A St, Reno, NV", "state": "NV"},
        {"name": "Zenith Ventures LLC", "address": "9 Z Blvd, Miami, FL", "state": "FL"},
    )
    assert strong["probability"] > weak["probability"]


def test_model_roundtrip_persistence(tmp_path):
    fs = seed_model("owner_owner")
    p = tmp_path / "model_owner_owner.json"
    fs.save(str(p))
    loaded = FSModel.load(str(p))
    assert loaded.model == fs.model
    assert loaded.comparisons == fs.comparisons
