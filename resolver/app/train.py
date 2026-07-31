"""Model training: estimate Fellegi-Sunter m/u parameters from labeled pairs.

**count_estimator is THE estimator** — direct supervised m/u estimation:
     m(level) = P(comparison at `level` | label==1)
     u(level) = P(comparison at `level` | label==0)
with Laplace smoothing. Because W4.1 gives us *labels*, the supervised counts are the
exact, honest estimator — nothing to approximate.

splink retirement (W4.4 defect 2, 2026-07-31)
---------------------------------------------
`/train` used to call a `splink_estimate()` smoke-test first. That path NEVER fed the
model: even on success it returned `count_estimate(...)` re-tagged `splink_u+count_m`
(splink's data-driven `u` was deliberately discarded — "we HAVE labels"), so the model
bytes were identical either way. Its only observable effect was the `trainer` label, and
a splink 4.x API-shape mismatch made it throw and *silently* fall back — which is why
`/health` reported `splink:true` while `/train` reported `trainer:count_estimator` and
looked broken. It was not broken: the count estimator is exact given labels.

So the vestigial smoke-test is **retired from the training path**. `train_model` calls
`count_estimate` directly; the `trainer` label is honestly `count_estimator`. `splink`
stays an OPTIONAL import surfaced at `/health` (`splink_available()`) for build parity —
importability there does NOT mean splink trains the model. Re-integrating splink's `u`
(a real change, not a bug fix) is future work; if taken up, wire its estimated `u` into
the persisted JSON and tag the trainer accordingly.
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
    """Whether the `splink` package is importable in this build.

    Surfaced at /health for build parity ONLY. splink is NOT in the training path
    (see the module docstring, W4.4 defect 2) — importability here does not mean it
    trains the model; `train_model` always uses the exact supervised count estimator.
    """
    try:  # pragma: no cover - Docker path
        import splink  # noqa: F401

        return True
    except Exception:
        return False


def train_model(pairs: List[dict], model: str) -> FSModel:
    """Train `model` on `pairs` (train split only should be passed by the caller).

    The count estimator is exact given labels, so it is the sole estimator; the
    trainer label is honestly `count_estimator` (W4.4 defect 2 retired the vestigial
    splink smoke-test that never fed the model).
    """
    return count_estimate(pairs, model)


def train_pairs_for(model: str) -> List[dict]:
    """Filter a corpus down to the train split (caller loads the corpus)."""
    raise NotImplementedError  # kept explicit; callers do their own split filtering
