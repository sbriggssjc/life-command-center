"""Normalization: company-name core discipline + address canonicalization."""
from app.normalize import (
    normalize_address,
    normalize_company,
    normalize_state,
)


def test_legal_form_variants_share_core():
    a = normalize_company("Cedar Point Holdings LLC")
    b = normalize_company("Cedar Point Holdings, L.L.C.")
    c = normalize_company("Cedar Point Holdings LP")
    assert a["core"] == b["core"] == c["core"] == "cedar point holdings"
    # full clean names differ by the legal form (that's the level-2 signal)
    assert a["clean"] != c["clean"]


def test_core_keeps_semantic_tokens_w33():
    # W3.3: CO/COMPANY/GROUP/PARTNERS/HOLDINGS must NOT be stripped from the core, or
    # distinct owners collapse. Cores must DIFFER here.
    assert normalize_company("Smith Group LLC")["core"] == "smith group"
    assert normalize_company("Smith Partners LP")["core"] == "smith partners"
    assert normalize_company("Cowperwood Co")["core"] == "cowperwood co"
    assert normalize_company("Cowperwood Company")["core"] == "cowperwood company"
    assert normalize_company("Highland Company")["core"] == "highland company"


def test_pllc_does_not_bleed_into_group():
    # The bleed guard: "X Group PLLC"/"X Group LLC" cores must keep 'group'.
    assert "group" in normalize_company("Acme Group LLC")["core"].split()
    assert normalize_company("Acme Group LLC")["core"] == "acme group"


def test_name_only_legal_form_falls_back_to_clean():
    n = normalize_company("The LLC")
    assert n["core"]  # not empty


def test_empty_name():
    n = normalize_company(None)
    assert n["clean"] == "" and n["core"] == "" and n["core_tokens"] == ()


def test_address_pobox_variants_collapse():
    a = normalize_address("P.O. Box 123, Dallas, TX 75201")
    b = normalize_address("PO Box 123, Dallas TX 75201")
    assert "po box 123" in a["clean"]
    assert "po box 123" in b["clean"]


def test_address_tokens_and_source():
    a = normalize_address("100 Main St, Dallas, TX 75201")
    assert "main" in a["tokens"]
    assert a["source"] in ("libpostal", "regex")


def test_state_normalization():
    assert normalize_state("Texas") == "TX"
    assert normalize_state("tx") == "TX"
    assert normalize_state("CA") == "CA"
    assert normalize_state(None) is None
    assert normalize_state("Nowhere") is None
