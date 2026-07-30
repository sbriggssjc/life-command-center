"""Candidate generation (blocking).

Two complementary strategies, unioned:

1. Normalized-token blocks — pair a left with a right when they share at least one
   normalized name-CORE token (legal forms + stopwords removed). This is cheap, high
   recall for the common "shared distinctive word" case, and mirrors how the SQL
   writers block.

2. Embedding-KNN fallback — for lefts that got NO token-block candidate (the
   "non-overlapping token" case: abbreviations, reorderings, d/b/a names), embed the
   name with bge-small and admit rights whose cosine ≥ floor (default 0.80).

Returns candidate (left_idx, right_idx, embed_cosine) triples. `embed_cosine` is passed
through to the scorer so the name comparison's embedding level is free.
"""
from __future__ import annotations

from collections import defaultdict
from typing import List, Optional, Tuple

from .config import settings
from .embeddings import cosine, embed
from .normalize import normalize_company


def _token_index(records: List[dict]) -> dict:
    idx = defaultdict(list)
    for i, rec in enumerate(records):
        norm = normalize_company(rec.get("name"))
        for tok in set(norm["core_tokens"]):
            if len(tok) >= 2:  # skip single chars
                idx[tok].append(i)
    return idx


def block_candidates(
    left: List[dict],
    right: List[dict],
    embedding_floor: Optional[float] = None,
    use_embeddings: bool = True,
    max_pairs: Optional[int] = None,
) -> Tuple[List[Tuple[int, int, Optional[float]]], dict]:
    floor = settings.embedding_cosine_floor if embedding_floor is None else embedding_floor
    cap = settings.max_candidate_pairs if max_pairs is None else max_pairs

    right_tok = _token_index(right)
    seen = set()
    candidates: List[Tuple[int, int, Optional[float]]] = []
    lefts_with_token_hit = set()

    # --- Strategy 1: token blocks ---
    for li, lrec in enumerate(left):
        lnorm = normalize_company(lrec.get("name"))
        hits = set()
        for tok in set(lnorm["core_tokens"]):
            if len(tok) < 2:
                continue
            for ri in right_tok.get(tok, ()):
                hits.add(ri)
        for ri in hits:
            key = (li, ri)
            if key not in seen:
                seen.add(key)
                candidates.append((li, ri, None))
                lefts_with_token_hit.add(li)
                if len(candidates) >= cap:
                    break
        if len(candidates) >= cap:
            break

    stats = {
        "token_block_pairs": len(candidates),
        "embedding_block_pairs": 0,
        "embedding_backend": None,
        "lefts_without_token_hit": 0,
    }

    # --- Strategy 2: embedding-KNN fallback for lefts with NO token candidate ---
    lefts_missing = [li for li in range(len(left)) if li not in lefts_with_token_hit]
    stats["lefts_without_token_hit"] = len(lefts_missing)

    if use_embeddings and lefts_missing and len(candidates) < cap:
        from .embeddings import backend as _backend

        stats["embedding_backend"] = _backend(settings.embedding_model)
        right_names = [normalize_company(r.get("name"))["clean"] or "" for r in right]
        right_vecs = embed(right_names, settings.embedding_model)
        miss_names = [normalize_company(left[li].get("name"))["clean"] or "" for li in lefts_missing]
        miss_vecs = embed(miss_names, settings.embedding_model)
        for mi, li in enumerate(lefts_missing):
            lv = miss_vecs[mi]
            for ri, rv in enumerate(right_vecs):
                c = cosine(lv, rv)
                if c >= floor:
                    key = (li, ri)
                    if key not in seen:
                        seen.add(key)
                        candidates.append((li, ri, c))
                        stats["embedding_block_pairs"] += 1
                        if len(candidates) >= cap:
                            break
            if len(candidates) >= cap:
                break

    stats["total_candidate_pairs"] = len(candidates)
    stats["capped"] = len(candidates) >= cap
    return candidates, stats
