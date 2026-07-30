"""Embedding provider for the KNN blocking fallback.

Primary: sentence-transformers `bge-small-en-v1.5` (CPU). Fallback: a deterministic
char-n-gram hashing embedding so blocking still functions (and tests run) when the
model isn't installed/downloaded. Both return L2-normalized vectors so a dot product
IS the cosine similarity.

The fallback is intentionally simple and documented as such — it is a *recall aid* for
the "non-overlapping token" case, not a scoring signal. All final scoring goes through
the Fellegi-Sunter model, whose name-embedding comparison level uses this same provider
(so a Docker deployment scores on real bge-small vectors, a bare venv on the fallback).
"""
from __future__ import annotations

import hashlib
import math
from typing import List, Sequence

try:  # pragma: no cover - Docker path
    import numpy as _np
except Exception:  # pragma: no cover
    _np = None

_MODEL = None
_MODEL_NAME = None
_TRIED = False
_DIM_FALLBACK = 256


def _try_load(model_name: str):
    global _MODEL, _MODEL_NAME, _TRIED
    if _TRIED:
        return _MODEL
    _TRIED = True
    try:  # pragma: no cover - Docker path
        from sentence_transformers import SentenceTransformer

        _MODEL = SentenceTransformer(model_name)
        _MODEL_NAME = model_name
    except Exception:
        _MODEL = None
        _MODEL_NAME = None
    return _MODEL


def backend(model_name: str = "BAAI/bge-small-en-v1.5") -> str:
    return "sentence-transformers" if _try_load(model_name) is not None else "hashing-fallback"


def _hash_embed(text: str, dim: int = _DIM_FALLBACK) -> List[float]:
    """Deterministic char 3-gram hashing embedding, L2-normalized."""
    vec = [0.0] * dim
    t = f"  {text.lower().strip()}  "
    if not t.strip():
        return vec
    for i in range(len(t) - 2):
        gram = t[i : i + 3]
        h = int(hashlib.md5(gram.encode("utf-8")).hexdigest(), 16)
        idx = h % dim
        sign = 1.0 if (h >> 8) & 1 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec


def embed(texts: Sequence[str], model_name: str = "BAAI/bge-small-en-v1.5") -> List[List[float]]:
    model = _try_load(model_name)
    if model is not None:  # pragma: no cover - Docker path
        arr = model.encode(list(texts), normalize_embeddings=True, show_progress_bar=False)
        return [list(map(float, row)) for row in arr]
    return [_hash_embed(t) for t in texts]


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if _np is not None:  # pragma: no cover - Docker path
        av, bv = _np.asarray(a, dtype=float), _np.asarray(b, dtype=float)
        na, nb = _np.linalg.norm(av), _np.linalg.norm(bv)
        if na == 0 or nb == 0:
            return 0.0
        return float(av.dot(bv) / (na * nb))
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)
