"""Runtime configuration (env-driven, all optional with safe defaults).

Every knob is a single tunable value with a documented default. The service is
CPU-only and holds no secrets that let it WRITE — the Supabase key it accepts is a
read-only Storage token used solely to fetch the labeled training corpus for /train.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _i(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass
class Settings:
    # --- Model persistence ---
    # Directory holding trained model JSON files (one per model name). The repo ships
    # a default model under fixtures/ so /match works before the first /train.
    model_dir: str = os.environ.get("RESOLVER_MODEL_DIR", "")

    # --- Blocking ---
    # Embedding-KNN fallback fires only for pairs that share no normalized token.
    embedding_cosine_floor: float = _f("RESOLVER_EMBED_COSINE_FLOOR", 0.80)
    # Cap on candidate pairs evaluated per /match request (guards a full cross-product).
    max_candidate_pairs: int = _i("RESOLVER_MAX_CANDIDATE_PAIRS", 50_000)
    # Below this FS probability a candidate pair is not returned at all.
    return_probability_floor: float = _f("RESOLVER_RETURN_PROB_FLOOR", 0.05)

    # --- Decision bands (populated from the calibration report; see CALIBRATION.md) ---
    # Defaults are the calibrated bands for the shipped default model. /train rewrites
    # them per model from the W4.1 test split.
    auto_link_threshold: float = _f("RESOLVER_AUTO_LINK", 0.92)
    auto_reject_threshold: float = _f("RESOLVER_AUTO_REJECT", 0.20)

    # --- Supabase Storage (read-only, for /train corpus fetch) ---
    supabase_url: Optional[str] = os.environ.get("SUPABASE_URL")
    supabase_storage_key: Optional[str] = os.environ.get("RESOLVER_STORAGE_KEY")
    corpus_bucket: str = os.environ.get("RESOLVER_CORPUS_BUCKET", "entity-resolution")
    corpus_path: str = os.environ.get("RESOLVER_CORPUS_PATH", "w4_1/labeled_pairs.jsonl")

    # --- Embedding model ---
    embedding_model: str = os.environ.get("RESOLVER_EMBED_MODEL", "BAAI/bge-small-en-v1.5")

    def resolved_model_dir(self) -> str:
        if self.model_dir:
            return self.model_dir
        # Default to the repo's fixtures dir so the shipped default model loads.
        here = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(os.path.dirname(here), "fixtures")


settings = Settings()
