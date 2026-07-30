"""Address + company-name normalization.

Two public entry points:
  - normalize_address(): libpostal expand+parse when available, regex fallback otherwise.
  - normalize_company(): legal-form-aware company-name canonicalization.

The company normalizer mirrors the gov `gov_owner_strict_core()` / dia
`dia_norm_owner_name()` discipline from the ORE (see government-lease CLAUDE.md §20):
`core` strips ONLY pure legal-entity suffixes (LLC/LP/INC/CORP/LTD/DST/…) and KEEPS
semantic tokens (CO/COMPANY/GROUP/PARTNERS/HOLDINGS/REALTY/…). Two owners whose cores
differ only by a legal form are safe-merge; a collapse that drops a semantic token is
NOT — that distinction is the whole point of the W3.3 false-merge gate, and this
service must reproduce it so its scores agree with the SQL writers.
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Dict, List, Optional

# libpostal is a heavy C dependency; import lazily and degrade gracefully.
try:  # pragma: no cover - exercised in Docker, not the bare test venv
    from postal.expand import expand_address as _pg_expand
    from postal.parser import parse_address as _pg_parse

    _HAS_POSTAL = True
except Exception:  # pragma: no cover
    _HAS_POSTAL = False


# Pure legal-entity forms — stripped from the strict CORE (mirrors gov_owner_strict_core).
# Deliberately EXCLUDES bleed-prone short forms (pllc/plc/pa/pc/lc/na): with spaces
# removed, `pllc` would eat the `p` of "grou|p llc". If you extend this set, re-run the
# fixture negative suite and the W3.3 448-pair audit before trusting it.
LEGAL_FORMS = [
    "limited liability company", "limited liability co", "limited partnership",
    "limited liability limited partnership", "professional corporation",
    "professional association",
    "llc", "l l c", "llp", "l l p", "lllp", "lp", "l p", "ltd", "limited",
    "inc", "incorporated", "corp", "corporation", "dst", "reit", "trust",
    "gp", "fund", "spe",
]
# Longest-first so "limited liability company" matches before "limited"/"company".
LEGAL_FORMS = sorted(set(LEGAL_FORMS), key=len, reverse=True)

# Company stop tokens dropped from token-set comparisons (not from the display name).
COMPANY_STOPWORDS = {"the", "and", "of", "a", "an", "for"}

_WS = re.compile(r"\s+")
_NONALNUM = re.compile(r"[^a-z0-9 ]+")
_AMP = re.compile(r"\s*&\s*")

# US state abbreviation set (for cheap state normalization).
_STATE_ABBR = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI",
    "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA",
    "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    "district of columbia": "DC",
}


def normalize_state(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    v = value.strip().lower()
    if len(v) == 2 and v.upper().isalpha():
        return v.upper()
    return _STATE_ABBR.get(v)


def _basic_clean(value: str) -> str:
    v = value.strip().lower()
    v = _AMP.sub(" and ", v)
    v = _NONALNUM.sub(" ", v)
    v = _WS.sub(" ", v).strip()
    return v


@lru_cache(maxsize=8192)
def normalize_company(name: Optional[str]) -> Dict[str, object]:
    """Return {clean, core, tokens, core_tokens} for a company / owner name.

    clean       - lowercased, punctuation-stripped full name (legal form kept)
    core        - strict core: pure legal forms removed, semantic tokens kept
    tokens      - clean tokens minus stopwords
    core_tokens - core tokens minus stopwords (the token-block key set)
    """
    if not name or not str(name).strip():
        return {"clean": "", "core": "", "tokens": (), "core_tokens": ()}

    clean = _basic_clean(str(name))

    # Strip trailing/embedded pure legal forms to build the core.
    core = clean
    changed = True
    while changed:
        changed = False
        for form in LEGAL_FORMS:
            # word-boundary match; strip anywhere but re-loop (handles "... llc trust").
            pat = r"(?:^| )" + re.escape(form) + r"(?= |$)"
            new = re.sub(pat, " ", core)
            if new != core:
                core = _WS.sub(" ", new).strip()
                changed = True
    if not core:  # name was ONLY a legal form ("The LLC") — fall back to clean
        core = clean

    tokens = tuple(t for t in clean.split() if t not in COMPANY_STOPWORDS)
    core_tokens = tuple(t for t in core.split() if t not in COMPANY_STOPWORDS)
    return {"clean": clean, "core": core, "tokens": tokens, "core_tokens": core_tokens}


def _regex_parse_address(value: str) -> Dict[str, Optional[str]]:
    """Cheap structured parse without libpostal.

    Pulls a trailing 5(+4) ZIP and a 2-letter state token; the rest is the street/city
    blob. Good enough for token-set comparison; libpostal (Docker) does the real work.
    """
    raw = value.strip()
    zip_m = re.search(r"\b(\d{5})(?:-\d{4})?\b", raw)
    zipcode = zip_m.group(1) if zip_m else None
    state = None
    st_m = re.search(r"\b([A-Za-z]{2})\b(?:[ ,]+\d{5}(?:-\d{4})?)?\s*$", raw)
    if st_m and st_m.group(1).upper() in set(_STATE_ABBR.values()):
        state = st_m.group(1).upper()
    return {"road": None, "city": None, "state": state, "postcode": zipcode, "house_number": None}


@lru_cache(maxsize=8192)
def normalize_address(value: Optional[str]) -> Dict[str, object]:
    """Return {clean, tokens, components, source} for a free-text address.

    Uses libpostal expand_address + parse_address when available; otherwise a regex
    fallback. PO-box punctuation ("P.O. Box"/"PO Box") is collapsed so variants match.
    """
    if not value or not str(value).strip():
        return {"clean": "", "tokens": (), "components": {}, "source": "empty"}

    raw = str(value)
    # Collapse PO-box variants (matches the punctuation-insensitive gov dedup key).
    pobox = re.sub(r"\bp\.?\s*o\.?\s*box\b", "po box", raw, flags=re.IGNORECASE)

    if _HAS_POSTAL:  # pragma: no cover - Docker path
        try:
            expansions = _pg_expand(pobox)
            clean = expansions[0] if expansions else _basic_clean(pobox)
            comps = {label: val for (val, label) in _pg_parse(pobox)}
            clean = _basic_clean(clean)
            tokens = tuple(t for t in clean.split() if t not in COMPANY_STOPWORDS)
            state = normalize_state(comps.get("state"))
            components = {
                "house_number": comps.get("house_number"),
                "road": comps.get("road"),
                "city": comps.get("city"),
                "state": state,
                "postcode": comps.get("postcode"),
            }
            return {"clean": clean, "tokens": tokens, "components": components, "source": "libpostal"}
        except Exception:
            pass

    clean = _basic_clean(pobox)
    tokens = tuple(t for t in clean.split() if t not in COMPANY_STOPWORDS)
    comps = _regex_parse_address(pobox)
    return {"clean": clean, "tokens": tokens, "components": comps, "source": "regex"}


def libpostal_available() -> bool:
    return _HAS_POSTAL
