"""Comparison-vector construction for the Fellegi-Sunter model.

A "comparison" (splink's term) is a field-level function that maps a record pair to a
discrete LEVEL. Each level carries its own m/u probabilities in the trained model, so
the match weight is level-specific — e.g. an exact address is far stronger evidence
than a token-overlap address. A level of `None` means "no information" (a required
field is missing on one side); the model gives it weight 0.

Levels are ordered strongest→weakest; the builder returns the FIRST (strongest) level
that fires. The set of comparisons used depends on the model:
  owner_owner : name, address, state
  owner_sf    : name, address, state, sf_account
  contact     : name, address, state, email
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from .normalize import normalize_address, normalize_company, normalize_state


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


@dataclass
class LevelResult:
    comparison: str
    level: Optional[int]      # None = null/no-info
    label: str
    detail: Dict[str, object]


# --- Comparison definitions ---------------------------------------------------------
# Each returns a LevelResult. `embed_cosine` is precomputed by the caller (blocking
# already embeds names) and passed in to avoid re-embedding.

NAME_LEVELS = {3: "exact_full", 2: "exact_core", 1: "strong_similar", 0: "no_match"}
ADDR_LEVELS = {3: "exact", 2: "token_high", 1: "token_low", 0: "no_match"}
STATE_LEVELS = {1: "match", 0: "mismatch"}
EXACTID_LEVELS = {1: "match", 0: "mismatch"}


def compare_name(left: dict, right: dict, embed_cosine: Optional[float]) -> LevelResult:
    l = normalize_company(left.get("name"))
    r = normalize_company(right.get("name"))
    if not l["clean"] or not r["clean"]:
        return LevelResult("name", None, "null", {})
    if l["clean"] == r["clean"]:
        return LevelResult("name", 3, NAME_LEVELS[3], {})
    if l["core"] and l["core"] == r["core"]:
        # cores equal but full names differ ⇒ legal-form variant (safe-merge class)
        return LevelResult("name", 2, NAME_LEVELS[2], {"l_core": l["core"], "r_core": r["core"]})
    jac = _jaccard(set(l["core_tokens"]), set(r["core_tokens"]))
    cos = embed_cosine if embed_cosine is not None else 0.0
    if jac >= 0.5 or cos >= 0.85:
        return LevelResult("name", 1, NAME_LEVELS[1], {"token_jaccard": round(jac, 3), "cosine": round(cos, 3)})
    return LevelResult("name", 0, NAME_LEVELS[0], {"token_jaccard": round(jac, 3), "cosine": round(cos, 3)})


def compare_address(left: dict, right: dict) -> LevelResult:
    la = normalize_address(left.get("address"))
    ra = normalize_address(right.get("address"))
    if not la["clean"] or not ra["clean"]:
        return LevelResult("address", None, "null", {})
    if la["clean"] == ra["clean"]:
        return LevelResult("address", 3, ADDR_LEVELS[3], {})
    jac = _jaccard(set(la["tokens"]), set(ra["tokens"]))
    if jac >= 0.6:
        return LevelResult("address", 2, ADDR_LEVELS[2], {"token_jaccard": round(jac, 3)})
    if jac >= 0.3:
        return LevelResult("address", 1, ADDR_LEVELS[1], {"token_jaccard": round(jac, 3)})
    return LevelResult("address", 0, ADDR_LEVELS[0], {"token_jaccard": round(jac, 3)})


def compare_state(left: dict, right: dict) -> LevelResult:
    ls = normalize_state(left.get("state"))
    rs = normalize_state(right.get("state"))
    if not ls or not rs:
        return LevelResult("state", None, "null", {})
    if ls == rs:
        return LevelResult("state", 1, STATE_LEVELS[1], {})
    return LevelResult("state", 0, STATE_LEVELS[0], {"l": ls, "r": rs})


def _compare_exact_id(name: str, lval, rval) -> LevelResult:
    lv = (str(lval).strip().lower() if lval not in (None, "") else "")
    rv = (str(rval).strip().lower() if rval not in (None, "") else "")
    if not lv or not rv:
        return LevelResult(name, None, "null", {})
    if lv == rv:
        return LevelResult(name, 1, EXACTID_LEVELS[1], {})
    return LevelResult(name, 0, EXACTID_LEVELS[0], {})


def compare_sf_account(left: dict, right: dict) -> LevelResult:
    return _compare_exact_id("sf_account", left.get("sf_account"), right.get("sf_account"))


def compare_email(left: dict, right: dict) -> LevelResult:
    return _compare_exact_id("email", left.get("email"), right.get("email"))


MODEL_COMPARISONS = {
    "owner_owner": ["name", "address", "state"],
    "owner_sf": ["name", "address", "state", "sf_account"],
    "contact": ["name", "address", "state", "email"],
}

# The canonical model-name tuple, defined here (no pydantic dep) so the offline
# trainer/scripts and the core modules can import it without the API layer.
MODELS = ("owner_sf", "owner_owner", "contact")

_COMPARATORS = {
    "name": compare_name,
    "address": compare_address,
    "state": compare_state,
    "sf_account": compare_sf_account,
    "email": compare_email,
}


def build_comparison_vector(
    left: dict, right: dict, model: str, embed_cosine: Optional[float] = None
) -> List[LevelResult]:
    comps = MODEL_COMPARISONS.get(model, MODEL_COMPARISONS["owner_owner"])
    out: List[LevelResult] = []
    for c in comps:
        if c == "name":
            out.append(compare_name(left, right, embed_cosine))
        else:
            out.append(_COMPARATORS[c](left, right))
    return out
