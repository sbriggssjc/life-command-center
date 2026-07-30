"""Fellegi-Sunter match model: persistence + scoring.

This is the splink-compatible scorer. A trained model is a JSON document:

    {
      "model": "owner_owner",
      "prior": 0.001,                       # P(match) among candidate pairs
      "comparisons": {
        "name":    {"levels": {"3": {"m": .., "u": ..}, ...}},
        "address": {...}, "state": {...}
      },
      "bands": {"auto_link": 0.94, "auto_reject": 0.15},
      "trained_at": "...", "trainer": "splink|count_estimator|seed",
      "n_pairs": 1234, "corpus": "w4_1|fixtures|seed"
    }

Scoring (per pair):
    match_weight(level) = log2(m / u)
    total_log2_odds     = log2(prior/(1-prior)) + Σ match_weight(level_i)
    probability         = 2^odds / (1 + 2^odds)

A `None` level contributes weight 0 (m==u, no evidence). This is exactly splink's
Fellegi-Sunter formulation; splink is used in train.py to ESTIMATE the m/u values on
the DuckDB backend when available, but the numbers live here so /match needs no splink.
"""
from __future__ import annotations

import json
import math
import os
from typing import Dict, List, Optional

from .features import LevelResult, MODEL_COMPARISONS, build_comparison_vector

_EPS = 1e-6


def _log2(x: float) -> float:
    return math.log(max(x, _EPS), 2)


class FSModel:
    def __init__(self, data: dict):
        self.model: str = data["model"]
        self.prior: float = float(data.get("prior", 0.001))
        self.comparisons: Dict[str, dict] = data.get("comparisons", {})
        bands = data.get("bands", {})
        self.auto_link: float = float(bands.get("auto_link", 0.92))
        self.auto_reject: float = float(bands.get("auto_reject", 0.20))
        self.meta = {
            "trained_at": data.get("trained_at"),
            "trainer": data.get("trainer"),
            "n_pairs": data.get("n_pairs"),
            "corpus": data.get("corpus"),
        }

    # --- persistence ---
    @classmethod
    def load(cls, path: str) -> "FSModel":
        with open(path, "r", encoding="utf-8") as fh:
            return cls(json.load(fh))

    def to_dict(self) -> dict:
        return {
            "model": self.model,
            "prior": self.prior,
            "comparisons": self.comparisons,
            "bands": {"auto_link": self.auto_link, "auto_reject": self.auto_reject},
            **self.meta,
        }

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.to_dict(), fh, indent=2, sort_keys=True)

    # --- scoring ---
    def _weight(self, comparison: str, level: Optional[int]) -> float:
        if level is None:
            return 0.0
        cfg = self.comparisons.get(comparison)
        if not cfg:
            return 0.0
        lv = cfg.get("levels", {}).get(str(level))
        if not lv:
            return 0.0
        m = float(lv.get("m", _EPS))
        u = float(lv.get("u", _EPS))
        return _log2(m) - _log2(u)

    def score_vector(self, vector: List[LevelResult]) -> dict:
        base = _log2(self.prior) - _log2(1.0 - self.prior)
        odds = base
        explanation = []
        for lr in vector:
            w = self._weight(lr.comparison, lr.level)
            odds += w
            explanation.append(
                {
                    "comparison": lr.comparison,
                    "level": lr.level,
                    "level_label": lr.label,
                    "match_weight_log2": round(w, 4),
                    "detail": lr.detail,
                }
            )
        prob = (2.0 ** odds) / (1.0 + 2.0 ** odds)
        return {
            "probability": round(prob, 6),
            "match_weight_log2": round(odds, 4),
            "band": self.band(prob),
            "comparison_vector": explanation,
        }

    def score_pair(self, left: dict, right: dict, embed_cosine: Optional[float] = None) -> dict:
        vec = build_comparison_vector(left, right, self.model, embed_cosine)
        return self.score_vector(vec)

    def band(self, prob: float) -> str:
        if prob >= self.auto_link:
            return "auto_link"
        if prob <= self.auto_reject:
            return "auto_reject"
        return "needs_review"


def seed_model(model_name: str) -> FSModel:
    """A hand-tuned prior model so the service scores sanely BEFORE any /train.

    The m/u values encode domain priors: an exact-core name (legal-form variant) plus a
    matching state is strong; a name mismatch is decisive against. These are replaced
    wholesale by /train from the W4.1 corpus — see docs/resolver/CALIBRATION.md.
    """
    name_cmp = {
        "levels": {
            "3": {"m": 0.55, "u": 0.0002},   # exact full name
            "2": {"m": 0.30, "u": 0.0010},   # exact core (legal-form variant)
            "1": {"m": 0.13, "u": 0.0300},   # strong similar (token/embedding)
            "0": {"m": 0.02, "u": 0.9688},   # no match — decisive negative
        }
    }
    addr_cmp = {
        "levels": {
            "3": {"m": 0.45, "u": 0.0010},
            "2": {"m": 0.25, "u": 0.0100},
            "1": {"m": 0.15, "u": 0.0800},
            "0": {"m": 0.15, "u": 0.9090},
        }
    }
    state_cmp = {"levels": {"1": {"m": 0.90, "u": 0.15}, "0": {"m": 0.10, "u": 0.85}}}
    id_cmp = {"levels": {"1": {"m": 0.97, "u": 0.001}, "0": {"m": 0.03, "u": 0.999}}}

    comps: Dict[str, dict] = {}
    for c in MODEL_COMPARISONS[model_name]:
        if c == "name":
            comps[c] = name_cmp
        elif c == "address":
            comps[c] = addr_cmp
        elif c == "state":
            comps[c] = state_cmp
        else:  # sf_account, email
            comps[c] = id_cmp

    return FSModel(
        {
            "model": model_name,
            "prior": 0.001,
            "comparisons": comps,
            "bands": {"auto_link": 0.92, "auto_reject": 0.20},
            "trainer": "seed",
            "corpus": "seed",
            "n_pairs": 0,
        }
    )
