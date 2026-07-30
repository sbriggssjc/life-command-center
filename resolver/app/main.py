"""FastAPI entrypoint for the entity-resolution microservice (LCC audit W4.2).

Endpoints
  GET  /health     — liveness + which optional backends are live (libpostal, embeddings, splink)
  POST /normalize  — libpostal address + company-name normalization
  POST /match      — blocked, scored candidate pairs with calibrated probabilities +
                     comparison-vector explanations
  POST /train      — rebuild m/u params from the labeled corpus (Storage or fixture stub)
                     and recalibrate the decision bands

INVARIANT: this service performs NO database writes. It only reads (the labeled corpus,
read-only, for /train) and scores. Writers stay in the existing tick/lane paths.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import FastAPI, HTTPException

from . import __version__
from .blocking import block_candidates
from .calibration import calibration_report
from .config import settings
from .corpus import load_corpus, split_of
from .embeddings import backend as embed_backend
from .normalize import (
    libpostal_available,
    normalize_address,
    normalize_company,
)
from .registry import registry
from .schemas import (
    MatchPair,
    MatchRequest,
    MatchResponse,
    NormalizeRequest,
    NormalizeResponse,
    NormalizedAddress,
    NormalizedName,
    TrainRequest,
    TrainResponse,
    MODELS,
)
from .train import splink_available, train_model

app = FastAPI(
    title="LCC Entity-Resolution Resolver",
    version=__version__,
    description="Scores entity-pair matches (owner↔owner, owner↔SF, contact). Read-only; never writes to a DB.",
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": __version__,
        "backends": {
            "libpostal": libpostal_available(),
            "embeddings": embed_backend(settings.embedding_model),
            "splink": splink_available(),
        },
        "models_available": list(MODELS),
        "no_db_writes": True,
    }


@app.post("/normalize", response_model=NormalizeResponse)
def normalize(req: NormalizeRequest):
    names = []
    for n in req.names:
        nc = normalize_company(n)
        names.append(
            NormalizedName(
                input=n,
                clean=nc["clean"],
                core=nc["core"],
                tokens=list(nc["tokens"]),
                core_tokens=list(nc["core_tokens"]),
            )
        )
    addresses = []
    for a in req.addresses:
        na = normalize_address(a)
        addresses.append(
            NormalizedAddress(
                input=a,
                clean=na["clean"],
                tokens=list(na["tokens"]),
                components=na["components"],
                source=na["source"],
            )
        )
    return NormalizeResponse(names=names, addresses=addresses, libpostal=libpostal_available())


@app.post("/match", response_model=MatchResponse)
def match(req: MatchRequest):
    if req.model not in MODELS:
        raise HTTPException(status_code=400, detail=f"unknown model '{req.model}' (valid: {', '.join(MODELS)})")
    fs = registry.get(req.model)

    left = [r.model_dump() for r in req.left]
    right = [r.model_dump() for r in req.right]
    if not left or not right:
        return MatchResponse(
            model=req.model, model_trainer=fs.meta.get("trainer"), model_corpus=fs.meta.get("corpus"),
            bands={"auto_link": fs.auto_link, "auto_reject": fs.auto_reject}, pairs=[],
            blocking={"total_candidate_pairs": 0, "note": "empty left or right"},
        )

    candidates, bstats = block_candidates(left, right, use_embeddings=req.use_embeddings)

    scored: List[MatchPair] = []
    for (li, ri, cos) in candidates:
        res = fs.score_pair(left[li], right[ri], embed_cosine=cos)
        if res["probability"] < settings.return_probability_floor:
            continue
        scored.append(
            MatchPair(
                left_id=left[li].get("id"),
                right_id=right[ri].get("id"),
                left_index=li,
                right_index=ri,
                probability=res["probability"],
                match_weight_log2=res["match_weight_log2"],
                band=res["band"],
                comparison_vector=res["comparison_vector"],
            )
        )

    scored.sort(key=lambda p: p.probability, reverse=True)

    if req.top_k:
        per_left = {}
        kept: List[MatchPair] = []
        for p in scored:
            c = per_left.get(p.left_index, 0)
            if c < req.top_k:
                kept.append(p)
                per_left[p.left_index] = c + 1
        scored = kept

    return MatchResponse(
        model=req.model,
        model_trainer=fs.meta.get("trainer"),
        model_corpus=fs.meta.get("corpus"),
        bands={"auto_link": fs.auto_link, "auto_reject": fs.auto_reject},
        pairs=scored,
        blocking=bstats,
    )


@app.post("/train", response_model=TrainResponse)
def train(req: TrainRequest):
    if req.model not in MODELS:
        raise HTTPException(status_code=400, detail=f"unknown model '{req.model}' (valid: {', '.join(MODELS)})")

    try:
        pairs, source = load_corpus(prefer_storage=req.use_storage)
    except Exception as exc:  # honest error rather than training on nothing
        raise HTTPException(status_code=502, detail=f"corpus load failed: {exc}")

    if not pairs:
        raise HTTPException(status_code=422, detail="corpus is empty (no labeled pairs to train on)")

    train_pairs = [p for p in pairs if split_of(p) in ("train", "valid")]
    test_pairs = [p for p in pairs if split_of(p) == "test"]
    # If the corpus carries no split, train on all and calibrate on all (report says so).
    if not train_pairs:
        train_pairs = pairs
    if not test_pairs:
        test_pairs = pairs

    fs = train_model(train_pairs, req.model)
    fs.meta["corpus"] = source

    report = calibration_report(fs, test_pairs, target_precision=req.target_precision)
    fs.auto_link = report["bands"]["auto_link"]
    fs.auto_reject = report["bands"]["auto_reject"]

    persisted = None
    if req.persist:
        persisted = registry.set(req.model, fs, persist=True)
    else:
        registry.set(req.model, fs, persist=False)

    # Trim the heavy 'scored'/'curve' payload for the response; keep the summary.
    report_summary = {k: v for k, v in report.items() if k not in ("scored",)}

    return TrainResponse(
        model=req.model,
        trainer=fs.meta.get("trainer", "count_estimator"),
        corpus=source,
        n_train_pairs=len(train_pairs),
        n_test_pairs=len(test_pairs),
        bands={"auto_link": fs.auto_link, "auto_reject": fs.auto_reject},
        calibration=report_summary,
        persisted_path=persisted,
    )
