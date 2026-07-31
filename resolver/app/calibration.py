"""Calibration: precision/recall over probability thresholds + band selection.

Given a trained model and a labeled test split, sweep thresholds and compute the
precision/recall/F1 curve, then select:
  - auto_link band  = lowest threshold whose precision ≥ target (default 0.995)
  - auto_reject band = highest probability among true positives that we can safely
    reject below without dropping recall past the reject-recall budget; concretely,
    the largest threshold t such that P(label==1 | prob ≤ t) is ~0 (no positives lost).

Everything here is pure Python (no numpy needed) so it runs anywhere the API runs.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from .corpus import pair_to_records
from .features import build_comparison_vector
from .model import FSModel


def score_split(fs: FSModel, pairs: List[dict], embed_cosines: Optional[List[float]] = None):
    scored = []
    for i, pair in enumerate(pairs):
        left, right, label = pair_to_records(pair)
        cos = embed_cosines[i] if embed_cosines is not None else None
        vec = build_comparison_vector(left, right, fs.model, cos)
        res = fs.score_vector(vec)
        scored.append((res["probability"], label))
    return scored


def pr_curve(scored: List[Tuple[float, int]], steps: int = 101) -> List[dict]:
    total_pos = sum(1 for _, y in scored if y == 1)
    rows = []
    for s in range(steps):
        t = s / (steps - 1)
        tp = sum(1 for p, y in scored if p >= t and y == 1)
        fp = sum(1 for p, y in scored if p >= t and y == 0)
        fn = total_pos - tp
        precision = tp / (tp + fp) if (tp + fp) else 1.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        rows.append(
            {"threshold": round(t, 4), "tp": tp, "fp": fp, "fn": fn,
             "precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4)}
        )
    return rows


DEFAULT_BAND_FLOOR = 0.5


def select_bands(
    scored: List[Tuple[float, int]],
    target_precision: float = 0.995,
    band_floor: float = DEFAULT_BAND_FLOOR,
) -> Dict[str, float]:
    import math

    curve = pr_curve(scored, steps=201)
    # auto_link: lowest threshold achieving target precision with some recall.
    auto_link_raw = 1.0
    for row in curve:
        if row["precision"] >= target_precision and row["recall"] > 0:
            auto_link_raw = row["threshold"]
            break

    # --- Band-floor invariant (W4.4, defect 1: calibration-transfer gap) ---
    # A precision-targeted sweep can find a *sub-floor* "safe" auto-link threshold when
    # the negative population in the corpus is too easy (the W4.3 finding: corpus
    # negatives were label-safe/easy, so a 0.005 band scored precision 1.0 on the held-out
    # split yet would auto-link ~26k live-backlog rows incl. '2200 Main LLC'→'900 South
    # Main LLC'). A sub-0.5 band is a SYMPTOM of easy negatives, not evidence of safety —
    # so the auto-link threshold may never fall below the floor regardless of the sweep.
    # When the floor binds (`auto_link_floored`), the retrain loop raises a drift alert:
    # the transfer gap has resurfaced and the corpus needs harder negatives.
    band_floor = max(0.0, min(1.0, float(band_floor)))
    auto_link = max(auto_link_raw, band_floor)
    auto_link_floored = auto_link > auto_link_raw + 1e-9

    # auto_reject: the highest threshold that is BOTH (a) strictly below every true
    # positive (recall-safe — no positive is ever auto-rejected) AND (b) strictly below
    # auto_link (bands never cross). When the model separates cleanly, the lowest positive
    # can sit above auto_link; the auto_link cap then governs so the reject band still
    # covers the negative-only region beneath the review band.
    min_pos_prob = min((p for p, y in scored if y == 1), default=1.0)
    cap = max(0.0, min(min_pos_prob, auto_link))
    auto_reject = math.floor(cap * 10000) / 10000.0
    # Nudge one 4dp grid step down if the floored value still touches either bound.
    if auto_reject >= min_pos_prob or auto_reject >= auto_link:
        auto_reject = max(0.0, round(auto_reject - 0.0001, 4))
    return {
        "auto_link": round(auto_link, 4),
        "auto_reject": round(auto_reject, 4),
        "auto_link_raw": round(auto_link_raw, 4),
        "band_floor": round(band_floor, 4),
        "auto_link_floored": auto_link_floored,
    }


def calibration_report(
    fs: FSModel,
    test_pairs: List[dict],
    target_precision: float = 0.995,
    band_floor: float = DEFAULT_BAND_FLOOR,
) -> dict:
    scored = score_split(fs, test_pairs)
    curve = pr_curve(scored, steps=101)
    bands = select_bands(scored, target_precision, band_floor=band_floor)
    n_pos = sum(1 for _, y in scored if y == 1)
    n_neg = sum(1 for _, y in scored if y == 0)

    # Confusion at the selected bands.
    auto_link_tp = sum(1 for p, y in scored if p >= bands["auto_link"] and y == 1)
    auto_link_fp = sum(1 for p, y in scored if p >= bands["auto_link"] and y == 0)
    reject_pos = sum(1 for p, y in scored if p <= bands["auto_reject"] and y == 1)
    reject_neg = sum(1 for p, y in scored if p <= bands["auto_reject"] and y == 0)
    review = sum(1 for p, _ in scored if bands["auto_reject"] < p < bands["auto_link"])

    auto_link_precision = auto_link_tp / (auto_link_tp + auto_link_fp) if (auto_link_tp + auto_link_fp) else 1.0
    return {
        "model": fs.model,
        "n_test_pairs": len(scored),
        "n_pos": n_pos,
        "n_neg": n_neg,
        "target_precision": target_precision,
        "band_floor": bands["band_floor"],
        "auto_link_floored": bands["auto_link_floored"],
        "bands": bands,
        "auto_link": {
            "threshold": bands["auto_link"],
            "true_links": auto_link_tp,
            "false_links": auto_link_fp,
            "precision": round(auto_link_precision, 4),
            "recall_of_positives": round(auto_link_tp / n_pos, 4) if n_pos else 0.0,
        },
        "auto_reject": {
            "threshold": bands["auto_reject"],
            "correct_rejects": reject_neg,
            "positives_lost": reject_pos,
        },
        "needs_review_count": review,
        "curve": curve,
        "scored": scored,
    }
