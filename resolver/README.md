# Entity-Resolution Resolver (LCC audit W4.2)

A stateless FastAPI microservice that **scores** entity-pair matches for the LCC
ownership graph. It normalizes names/addresses, blocks candidate pairs, and returns
**calibrated Fellegi-Sunter match probabilities** with per-comparison explanations.

> **Hard invariant: this service performs NO database writes.** It only reads (the
> labeled training corpus, read-only, for `/train`) and scores. The writers stay in the
> existing tick/lane paths — the W3.4 `sf-link` attach, the W3.2 `owner_reconcile` lane,
> and `entity_match_labels`. See the rollout plan §W4.3/W4.4 for how the scores are
> consumed.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + which optional backends are live (libpostal / embeddings / splink). |
| POST | `/normalize` | libpostal address + company-name (legal-form-aware) normalization. |
| POST | `/match` | Blocked, scored candidate pairs → `{probability, band, comparison_vector}`. `model` ∈ `owner_sf` \| `owner_owner` \| `contact`. |
| POST | `/train` | Rebuild the FS m/u params from the labeled corpus (Supabase Storage, or the fixture stub) and recalibrate the decision bands. |
| POST | `/extract-parties` | **Channel A of W5.1** — span-anchored party extraction from a sale-note narrative → `{buyer, seller, listing_broker, procuring_broker, lender, price, cap_rate, spans}`. GLiNER when baked in, else a deterministic cue-phrase heuristic (honest `backend`). Read-only, no writes; every name is anchored to a char span so a claim is groundable and never hallucinated. |

### `/match` example

```bash
curl -sXPOST localhost:8080/match -H 'content-type: application/json' -d '{
  "model": "owner_owner",
  "left":  [{"id":"L1","name":"Cedar Point Holdings LLC","address":"100 Main St, Dallas, TX","state":"TX"}],
  "right": [{"id":"R1","name":"Cedar Point Holdings, L.L.C.","address":"100 Main Street, Dallas, TX","state":"TX"},
            {"id":"R2","name":"Unrelated Ventures LLC","state":"FL"}]
}'
```

Returns pairs sorted by probability, each with the `band` (`auto_link` / `needs_review`
/ `auto_reject`) and the `comparison_vector` (the level and log2 match-weight each field
contributed).

## How it works

1. **Normalize** (`app/normalize.py`) — libpostal `expand_address`+`parse_address` for
   addresses; a legal-form-aware company normalizer that mirrors the gov
   `gov_owner_strict_core()` / dia `dia_norm_owner_name()` discipline (W3.3). The `core`
   strips ONLY pure legal forms (LLC/LP/INC/…) and KEEPS semantic tokens
   (CO/COMPANY/GROUP/PARTNERS/HOLDINGS) so "Smith Group LLC" ≠ "Smith Partners LP".
2. **Block** (`app/blocking.py`) — normalized-token blocks (share a distinctive
   name-core token) ∪ an embedding-KNN fallback (bge-small, cosine ≥ 0.80) for the
   non-overlapping-token case (abbreviations / reorderings / d-b-a).
3. **Score** (`app/model.py`, `app/features.py`) — a Fellegi-Sunter model: each field
   maps a pair to a discrete comparison LEVEL with its own m/u probabilities;
   `match_weight = log2(m/u)`; sum + prior → calibrated probability.
4. **Calibrate** (`app/calibration.py`) — sweep thresholds on the labeled test split,
   pick the **auto-link** band at precision ≥ 0.995 and a recall-safe **auto-reject**
   band. Report: `docs/resolver/CALIBRATION.md`.

**Estimator:** `/train` uses the supervised **count estimator** — exact given the W4.1
labels — as the sole m/u estimator (`trainer: count_estimator`). `splink` is **not** in
the training path: the old `splink_estimate()` smoke-test never fed the model (it
discarded splink's `u` and returned the count model re-labelled), and a splink 4.x API
mismatch made it throw and silently fall back, which is why `/health` reported
`splink:true` while `/train` reported `trainer:count_estimator` and looked broken — it
was not. That vestigial path is **retired** (W4.4 defect 2). `splink` remains an optional
import surfaced at `/health` for build parity only; re-integrating its `u` estimate is
future work. The scorer reads the persisted m/u JSON, so `/match` never depends on splink.

## Optional heavy dependencies (graceful degradation)

The service runs in a bare `pip install fastapi pydantic httpx` venv for development and
CI; the heavy native/model deps are **installed in the Docker image** so production runs
the real path. When a dep is absent the service degrades, honestly reported at `/health`:

| Dependency | Present (Docker) | Absent (bare venv / CI) |
|---|---|---|
| `postal` (libpostal) | full address expand+parse | regex address normalizer |
| `sentence-transformers` bge-small | real embeddings for KNN blocking | deterministic char-n-gram hashing embedding |
| `splink` + `duckdb` | importable, surfaced at `/health` (retired from training — W4.4 defect 2) | supervised count estimator (exact given labels) — the sole estimator in both builds |
| `gliner` (`gliner_medium-v2.1`) | zero-shot NER for `/extract-parties` spans (W5.1) | deterministic cue-phrase heuristic (still span-anchored); `/health` reports `gliner:false` |

## Training corpus

The real corpus is **W4.1** (LCC Audit Rollout Plan) — a labeled-pairs JSONL in Supabase
Storage. **W4.1 is not done yet**, so the service ships a **stub**: `fixtures/pairs.jsonl`
(same schema; legal-form-variant positives, address-anchored positives, W3.3 false-merge
negatives). When W4.1 lands, set `SUPABASE_URL` + `RESOLVER_STORAGE_KEY` (+ optional
`RESOLVER_CORPUS_BUCKET`/`RESOLVER_CORPUS_PATH`) and `POST /train` — no code change. See
the runbook.

## Local dev

```bash
cd resolver
pip install fastapi 'pydantic>=2.6' httpx pytest      # light path (no native deps)
python -m pytest tests/ -q                              # 31 tests
python scripts/gen_models_and_calibration.py           # regen models + CALIBRATION.md
uvicorn app.main:app --reload --port 8080
```

## Deploy

Railway service `entity-resolver` (project `handsome-luck`), CPU-only, built from this
`Dockerfile`. **Never GitHub Actions** (per the hosting rule). Full service-creation +
`/train` runbook: [`docs/resolver/RUNBOOK_railway_resolver_service.md`](../docs/resolver/RUNBOOK_railway_resolver_service.md).
