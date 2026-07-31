"""Channel A — span-anchored party extraction from CRE sale-note narrative (W5.1).

Text → {buyer, seller, listing_broker, procuring_broker, lender, price, cap_rate, spans}.
Every NAME field is anchored to a character span in the source text so a claim can be
grounded (the audit's requirement) and NEVER hallucinated — the extractor can only return
substrings of the note.

Two backends, mirroring the resolver's degradation discipline (see README §"Optional heavy
dependencies"):

  • gliner   — `gliner_medium-v2.1` zero-shot NER with CRE-tuned role labels. Baked into
               the Docker image. Deterministic, span-anchored.
  • heuristic — cue-phrase regex extractor used when gliner is absent (bare venv / CI) and
               as the ALWAYS-ON layer for price + cap_rate (pattern-based, not NER). Also
               span-anchored.

Both return the identical shape and honestly report `backend`. price/cap_rate are ALWAYS
regex-derived (they are patterns, not entities), independent of the NER backend.

INVARIANT (shared with the rest of the resolver): NO database writes. Pure text → JSON.
Role attribution here is one opinion; the JS adjudicator only writes a field when Channel B
(the LLM) independently agrees on the normalized company core.
"""
from __future__ import annotations

import os
import re
from typing import Dict, List, Optional, Tuple

# GLiNER is a heavy model dependency; import lazily and degrade gracefully.
try:  # pragma: no cover - exercised in Docker, not the bare test venv
    from gliner import GLiNER  # type: ignore

    _HAS_GLINER = True
except Exception:  # pragma: no cover
    _HAS_GLINER = False

_GLINER_MODEL_NAME = os.environ.get("RESOLVER_GLINER_MODEL", "urchade/gliner_medium-v2.1")
# Notes are almost always front-loaded with the parties; cap the window fed to the NER so a
# 10k-char marketing dump doesn't blow the token budget. Offsets stay valid (measured from 0).
_MAX_TEXT = int(os.environ.get("RESOLVER_PARTY_MAX_CHARS", "6000"))
_GLINER_THRESHOLD = float(os.environ.get("RESOLVER_GLINER_THRESHOLD", "0.45"))

_model = None  # lazy singleton


def gliner_available() -> bool:
    return _HAS_GLINER


def _get_model():  # pragma: no cover - Docker path
    global _model
    if _model is None and _HAS_GLINER:
        _model = GLiNER.from_pretrained(_GLINER_MODEL_NAME)
    return _model


# Canonical fields the pipeline fills. `lender` only has a home on gov.sales_transactions,
# but the extractor returns it uniformly; the JS field-map drops it where there is no column.
FIELDS = ("buyer", "seller", "listing_broker", "procuring_broker", "lender")

# GLiNER zero-shot labels → canonical field. Multiple label phrasings map to one field so the
# model has several natural surface forms to hook onto.
_GLINER_LABELS: Dict[str, str] = {
    "buyer": "buyer",
    "purchaser": "buyer",
    "seller": "seller",
    "vendor": "seller",
    "listing broker": "listing_broker",
    "listing brokerage": "listing_broker",
    "seller's broker": "listing_broker",
    "buyer's broker": "procuring_broker",
    "procuring broker": "procuring_broker",
    "purchasing broker": "procuring_broker",
    "lender": "lender",
    "mortgage lender": "lender",
}

# Junk / non-party spans a marketing note is riddled with — never emit these as a party.
_JUNK_TERMS = {
    "the property", "the seller", "the buyer", "the tenant", "the landlord", "the offering",
    "the asset", "the site", "the building", "the portfolio", "the investment", "the lease",
    "the transaction", "the sale", "the market", "investors", "the company", "the team",
    "n/a", "na", "none", "unknown", "confidential", "undisclosed",
}
# A federal/government tenant is NEVER a private BD party — mirrors the ORE federal guard.
_FEDERAL_TERMS = {
    "gsa", "general services administration", "united states", "u.s. government",
    "us government", "federal government", "the government", "social security administration",
    "department of veterans affairs", "veterans affairs", "va", "irs", "fbi", "dhs",
}

_WS = re.compile(r"\s+")


def _clean_span(text: str) -> str:
    return _WS.sub(" ", text).strip().strip(",.;:—–-").strip()


def _is_junk(value: str) -> bool:
    raw = (value or "").strip()
    v = raw.lower()
    if len(v) < 3:
        return True
    if v in _JUNK_TERMS or v in _FEDERAL_TERMS:
        return True
    # A pure number / price fragment is not a name.
    if re.fullmatch(r"[\$\d,.%\s]+", v):
        return True
    # A span with NO capitalized token is not a company/person name (checked on the
    # ORIGINAL case — single-word capitalized firms like "Ciminelli"/"CBRE" are valid).
    if not re.search(r"[A-Z]", raw):
        return True
    # A leading article + a junk noun ("The Property", "The Offering") is not a party.
    if v.split()[0] in ("the", "a", "an") and " ".join(v.split()[1:]) in {
        "property", "offering", "asset", "site", "building", "portfolio", "seller",
        "buyer", "team", "investment", "opportunity", "transaction", "sale",
    }:
        return True
    return False


# ---------------------------------------------------------------------------
# Heuristic cue-phrase extraction (always available)
# ---------------------------------------------------------------------------
# Each pattern captures the party NAME in group 'name'. Patterns are ordered most-specific
# first; the first hit per field wins. NAME is a run of up to 7 capitalized tokens (legal
# forms like "Inc."/"L.L.C." are just capitalized tokens), joined by spaces and the usual
# lowercase company connectors (& / and / of / de / la). Greedy up to 7 words, so it stops
# at the first lowercase verb/preposition ("acquired", "on", "for", "with", "to") — the
# natural right boundary of a company name in a marketing sentence.
# The cue phrases match case-insensitively (re.I), but the NAME group must stay
# case-SENSITIVE — otherwise re.I lets [A-Z] match lowercase and the name runs on through
# "acquired"/"on"/"for". `(?-i:...)` scopes case-sensitivity to just the name.
_CAPWORD = r"[A-Z][A-Za-z0-9'’.\-]*"
_NAME = r"(?P<name>(?-i:" + _CAPWORD + r"(?:\s+(?:&|and|of|de|la|" + _CAPWORD + r")){0,6}))"

_CUE_PATTERNS: Dict[str, List[re.Pattern]] = {
    "listing_broker": [
        re.compile(_NAME + r"\s+(?:has been|have been|is|are|was|were)\s+(?:exclusively\s+)?(?:retained|engaged)", re.I),
        re.compile(_NAME + r"\s+is\s+pleased\s+to\s+(?:exclusively\s+)?(?:present|offer|announce)", re.I),
        re.compile(r"exclusively\s+(?:listed|marketed|represented|offered|presented)\s+by\s+" + _NAME, re.I),
        re.compile(r"(?:listing|seller'?s?)\s+broker[:\s]+" + _NAME, re.I),
        re.compile(r"on\s+behalf\s+of\s+the\s+seller\s*,?\s*(?:by\s+)?" + _NAME, re.I),
    ],
    "procuring_broker": [
        re.compile(r"(?:buyer|purchaser)\s+was\s+represented\s+by\s+" + _NAME, re.I),
        re.compile(r"(?:procuring|buyer'?s?|purchasing)\s+broker[:\s]+" + _NAME, re.I),
        re.compile(r"represented\s+the\s+(?:buyer|purchaser)[,:\s]+" + _NAME, re.I),
        re.compile(_NAME + r"\s+represented\s+the\s+(?:buyer|purchaser)", re.I),
    ],
    "buyer": [
        re.compile(_NAME + r"\s+(?:acquired|purchased|bought|has\s+acquired)\b", re.I),
        re.compile(r"(?:acquired|purchased|bought)\s+by\s+" + _NAME, re.I),
        re.compile(r"buyer[:\s]+" + _NAME, re.I),
    ],
    "seller": [
        re.compile(r"(?:sold|disposed(?:\s+of)?)\s+by\s+" + _NAME, re.I),
        re.compile(_NAME + r"\s+sold\s+(?:the|its|this)\b", re.I),
        re.compile(r"seller[:\s]+" + _NAME, re.I),
    ],
    "lender": [
        re.compile(r"(?:financed|funded)\s+by\s+" + _NAME, re.I),
        re.compile(r"(?:loan|financing|debt)\s+(?:provided|originated)\s+by\s+" + _NAME, re.I),
        re.compile(r"lender[:\s]+" + _NAME, re.I),
    ],
}


def _heuristic_names(text: str) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for field, patterns in _CUE_PATTERNS.items():
        for pat in patterns:
            m = pat.search(text)
            if not m:
                continue
            raw = m.group("name")
            value = _clean_span(raw)
            if _is_junk(value):
                continue
            start = m.start("name")
            out[field] = {
                "field": field,
                "text": value,
                "start": start,
                "end": start + len(raw),
                "score": None,        # heuristic — no probability
                "label": "cue_phrase",
            }
            break
    return out


# ---------------------------------------------------------------------------
# price + cap_rate (always regex — patterns, not entities)
# ---------------------------------------------------------------------------
_PRICE_RE = re.compile(
    r"\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(million|mm|m|billion|bn|b)?\b",
    re.I,
)
_CAP_RE = re.compile(
    r"(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:cap|capitalization\s+rate)|cap(?:\s+rate)?\s+of\s+(\d{1,2}(?:\.\d{1,2})?)\s*%",
    re.I,
)


def _extract_price(text: str) -> Optional[dict]:
    best = None
    for m in _PRICE_RE.finditer(text):
        num = float(m.group(1).replace(",", ""))
        unit = (m.group(2) or "").lower()
        if unit in ("million", "mm", "m"):
            num *= 1_000_000
        elif unit in ("billion", "bn", "b"):
            num *= 1_000_000_000
        # Ignore obvious non-price figures (psf, small dollar amounts).
        if num < 100_000:
            continue
        cand = {"field": "price", "value": num, "text": _clean_span(m.group(0)),
                "start": m.start(), "end": m.end(), "label": "regex"}
        if best is None or num > best["value"]:
            best = cand
    return best


def _extract_cap_rate(text: str) -> Optional[dict]:
    m = _CAP_RE.search(text)
    if not m:
        return None
    raw = m.group(1) or m.group(2)
    try:
        pct = float(raw)
    except (TypeError, ValueError):
        return None
    if not (1.0 <= pct <= 20.0):  # sane CRE cap-rate band
        return None
    return {"field": "cap_rate", "value": round(pct / 100.0, 6), "text": _clean_span(m.group(0)),
            "start": m.start(), "end": m.end(), "label": "regex"}


# ---------------------------------------------------------------------------
# GLiNER span extraction (Docker path)
# ---------------------------------------------------------------------------
def _gliner_names(text: str) -> Dict[str, dict]:  # pragma: no cover - Docker path
    model = _get_model()
    if model is None:
        return {}
    labels = list(dict.fromkeys(_GLINER_LABELS.keys()))
    try:
        ents = model.predict_entities(text, labels, threshold=_GLINER_THRESHOLD)
    except Exception:
        return {}
    best: Dict[str, dict] = {}
    for e in ents:
        field = _GLINER_LABELS.get((e.get("label") or "").lower())
        if not field:
            continue
        value = _clean_span(e.get("text") or "")
        if _is_junk(value):
            continue
        score = float(e.get("score") or 0.0)
        prev = best.get(field)
        if prev is None or score > (prev.get("score") or 0.0):
            best[field] = {
                "field": field,
                "text": value,
                "start": int(e.get("start", -1)),
                "end": int(e.get("end", -1)),
                "score": round(score, 4),
                "label": e.get("label"),
            }
    return best


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def extract_parties(text: Optional[str]) -> dict:
    """Return the party extraction result for one sale note.

    Shape:
      {
        buyer, seller, listing_broker, procuring_broker, lender: str|None,
        price: float|None, cap_rate: float|None,
        spans: [{field, text, start, end, score, label}, ...],
        backend: 'gliner' | 'heuristic',
      }
    """
    result = {f: None for f in FIELDS}
    result.update({"price": None, "cap_rate": None, "spans": [], "backend": "heuristic"})

    if not text or not str(text).strip():
        return result

    window = str(text)[:_MAX_TEXT]

    names: Dict[str, dict] = {}
    if _HAS_GLINER:  # pragma: no cover - Docker path
        names = _gliner_names(window)
        result["backend"] = "gliner"
    # Heuristic fills any field GLiNER missed (and is the sole source in the bare venv).
    for field, span in _heuristic_names(window).items():
        names.setdefault(field, span)

    spans: List[dict] = []
    for field in FIELDS:
        span = names.get(field)
        if span:
            result[field] = span["text"]
            spans.append(span)

    price = _extract_price(window)
    if price:
        result["price"] = price["value"]
        spans.append(price)
    cap = _extract_cap_rate(window)
    if cap:
        result["cap_rate"] = cap["value"]
        spans.append(cap)

    result["spans"] = spans
    return result
