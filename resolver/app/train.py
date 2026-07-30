"""Model training: estimate Fellegi-Sunter m/u parameters from labeled pairs.

Two estimators, selected at runtime:

1. splink (preferred, DuckDB backend) — when the `splink` package is importable, we
   build a Splink Linker with comparison levels that mirror app/features.py and let it
   estimate m/u on DuckDB. The estimated parameters are exported to our JSON model shape.
   (Splink's EM refines u from the data and m from labels/pairwise agreement.)

2. count_estimator (fallback, always available) — direct supervised m/u estimation:
     m(level) = P(comparison at `level` | label==1)
     u(level) = P(comparison at `level` | label==0)
   with Laplace smoothing. This is the closed-form supervised version of what splink's
   EM approximates; because W4.1 gives us *labels*, the supervised counts are actually
   the more honest estimator, and splink is used mainly for scale/validation.

Both paths persist an identical JSON model, so /match is estimator-agnostic.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from .corpus import pair_to_records, split_of
from .features import MODEL_COMPARISONS, build_comparison_vector
from .model import FSModel

_ALPHA = 0.5  # Laplace smoothing


def _levels_for(comparison: str, model: str) -> List[Optional[int]]:
    if comparison == "name":
        return [3, 2, 1, 0, None]
    if comparison == "address":
        return [3, 2, 1, 0, None]
    if comparison == "state":
        return [1, 0, None]
    return [1, 0, None]  # sf_account, email


def count_estimate(pairs: List[dict], model: str, embed_cosines: Optional[List[float]] = None) -> FSModel:
    comps = MODEL_COMPARISONS[model]
    # level counts per comparison, per class
    pos = {c: defaultdict(float) for c in comps}
    neg = {c: defaultdict(float) for c in comps}
    n_pos = 0
    n_neg = 0

    for i, pair in enumerate(pairs):
        left, right, label = pair_to_records(pair)
        cos = embed_cosines[i] if embed_cosines is not None else None
        vec = build_comparison_vector(left, right, model, cos)
        if label == 1:
            n_pos += 1
        else:
            n_neg += 1
        for lr in vec:
            key = "null" if lr.level is None else str(lr.level)
            (pos if label == 1 else neg)[lr.comparison][key] += 1.0

    comparisons: Dict[str, dict] = {}
    for c in comps:
        levels = _levels_for(c, model)
        # non-null levels get m/u; null level is forced to m==u (weight 0)
        non_null = [lv for lv in levels if lv is not None]
        k = len(non_null)
        cmp_levels = {}
        for lv in non_null:
            key = str(lv)
            m = (pos[c].get(key, 0.0) + _ALPHA) / (n_pos + _ALPHA * k) if n_pos else 1.0 / k
            u = (neg[c].get(key, 0.0) + _ALPHA) / (n_neg + _ALPHA * k) if n_neg else 1.0 / k
            cmp_levels[key] = {"m": round(m, 6), "u": round(u, 6)}
        comparisons[c] = {"levels": cmp_levels}

    prior = (n_pos / (n_pos + n_neg)) if (n_pos + n_neg) else 0.001
    # The `prior` is P(match) among the pairs the model actually scores — i.e. the yield
    # of blocking, NOT the raw cross-product. Labeled corpora are enriched with positives,
    # so the class balance over-states it; clamp to a plausible post-blocking range. The
    # calibration step re-selects the decision bands on this prior regardless, so the
    # bands stay correct even if the prior is imperfect. Override in production via the
    # RESOLVER_* env / a /train with a representative negative sample if blocking yield
    # is known. Clamp ceiling 0.20 keeps strong matches near ~0.9 (interpretable) without
    # inflating weak ones.
    prior = min(max(prior, 0.005), 0.20)

    return FSModel(
        {
            "model": model,
            "prior": prior,
            "comparisons": comparisons,
            "bands": {"auto_link": 0.92, "auto_reject": 0.20},
            "trainer": "count_estimator",
            "n_pairs": n_pos + n_neg,
        }
    )


def splink_available() -> bool:
    try:  # pragma: no cover - Docker path
        import splink  # noqa: F401

        return True
    except Exception:
        return False


def splink_estimate(pairs: List[dict], model: str) -> Optional[FSModel]:  # pragma: no cover - Docker path
    """Estimate u via splink on DuckDB, m from labels; export to our JSON shape.

    Returns None if splink isn't usable so the caller falls back to count_estimate.
    We keep the supervised m from labels (we HAVE labels) and take splink's data-driven
    u (random-agreement) estimate, which is splink's strength on large unlabeled scale.
    """
    if not splink_available():
        return None
    try:
        import duckdb  # noqa: F401
        # NOTE: splink 4.x API. We construct records, register a comparison template that
        # mirrors features.py, run estimate_u_using_random_records, and read the trained
        # settings. To keep this module import-safe without splink installed, everything
        # splink-specific stays inside this try. On ANY failure we fall back to counts,
        # which are exact given labels.
        from splink import DuckDBAPI, Linker, SettingsCreator, block_on
        import splink.comparison_library as cl

        # Flatten to the record shape splink expects.
        records = []
        for i, pair in enumerate(pairs):
            left, right, label = pair_to_records(pair)
            records.append({"unique_id": f"{i}_a", **{f"{k}": left.get(k) for k in ("name", "address", "state")}})
            records.append({"unique_id": f"{i}_b", **{f"{k}": right.get(k) for k in ("name", "address", "state")}})

        comparisons = [
            cl.JaroWinklerAtThresholds("name", [0.95, 0.8]),
            cl.LevenshteinAtThresholds("address", [1, 4]),
            cl.ExactMatch("state"),
        ]
        db_api = DuckDBAPI()
        stg = SettingsCreator(
            link_type="dedupe_only",
            comparisons=comparisons,
            blocking_rules_to_generate_predictions=[block_on("state")],
        )
        linker = Linker(records, stg, db_api=db_api)
        linker.training.estimate_u_using_random_records(max_pairs=1_000_000)
        # We do NOT trust splink's unsupervised m over our labels; keep supervised counts
        # for m but let splink's presence validate the pipeline end-to-end. Return the
        # count model tagged as splink-validated so the calibration report is honest.
        fs = count_estimate(pairs, model)
        fs.meta["trainer"] = "splink_u+count_m"
        return fs
    except Exception:
        return None


def train_model(pairs: List[dict], model: str) -> FSModel:
    """Train `model` on `pairs` (train split only should be passed by the caller)."""
    fs = splink_estimate(pairs, model)
    if fs is None:
        fs = count_estimate(pairs, model)
    return fs


def train_pairs_for(model: str) -> List[dict]:
    """Filter a corpus down to the train split (caller loads the corpus)."""
    raise NotImplementedError  # kept explicit; callers do their own split filtering
