"""Pydantic request/response models for the API."""
from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from .features import MODELS  # single source of truth (no pydantic dep there)


class NormalizeRequest(BaseModel):
    names: List[str] = Field(default_factory=list)
    addresses: List[str] = Field(default_factory=list)


class NormalizedName(BaseModel):
    input: str
    clean: str
    core: str
    tokens: List[str]
    core_tokens: List[str]


class NormalizedAddress(BaseModel):
    input: str
    clean: str
    tokens: List[str]
    components: Dict[str, Optional[str]]
    source: str


class NormalizeResponse(BaseModel):
    names: List[NormalizedName]
    addresses: List[NormalizedAddress]
    libpostal: bool


class Record(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    address: Optional[str] = None
    state: Optional[str] = None
    sf_account: Optional[str] = None
    email: Optional[str] = None


class MatchRequest(BaseModel):
    left: List[Record] = Field(default_factory=list)
    right: List[Record] = Field(default_factory=list)
    model: str = "owner_owner"
    use_embeddings: bool = True
    top_k: Optional[int] = None  # keep only top_k rights per left when set


class MatchPair(BaseModel):
    left_id: Optional[str]
    right_id: Optional[str]
    left_index: int
    right_index: int
    probability: float
    match_weight_log2: float
    band: str
    comparison_vector: List[dict]


class MatchResponse(BaseModel):
    model: str
    model_trainer: Optional[str]
    model_corpus: Optional[str]
    bands: Dict[str, float]
    pairs: List[MatchPair]
    blocking: dict


class TrainRequest(BaseModel):
    model: str = "owner_owner"
    use_storage: bool = True          # pull the W4.1 corpus from Storage when configured
    persist: bool = True              # write the trained model JSON to disk
    target_precision: float = 0.995
    # Hard floor for the calibrated auto_link band (W4.4 defect 1). None → the service
    # default (settings.auto_link_band_floor, 0.5). The band may never fall below this.
    band_floor: Optional[float] = None


class TrainResponse(BaseModel):
    model: str
    trainer: str
    corpus: str
    n_train_pairs: int
    n_test_pairs: int
    bands: Dict[str, float]
    band_floor: float                 # the floor applied to the auto_link band
    auto_link_floored: bool           # True → the floor bound (drift signal: easy negatives)
    calibration: dict
    persisted_path: Optional[str]
