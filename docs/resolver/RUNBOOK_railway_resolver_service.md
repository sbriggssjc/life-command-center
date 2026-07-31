# Runbook — `entity-resolver` Railway service (W4.2)

**What:** the entity-resolution scoring microservice (`resolver/`). CPU-only FastAPI +
libpostal + bge-small + splink. **Scores only — never writes to any DB.**
**Where:** Railway project **`handsome-luck`** (same project as `cms-ingestion`,
`public-record-ingest`/county-ingest). **Hosting rule: Railway, CPU-only, NEVER GitHub
Actions.**

This mirrors the county-ingest service-creation pattern: **Scott creates the service in
the Railway dashboard**; this runbook is the exact click-path + verification.

---

## 1. Create the service (Scott, one-time)

1. Railway → project **handsome-luck** → **New → GitHub Repo** →
   `sbriggssjc/life-command-center`.
2. **Settings → Root Directory:** `resolver`  (so the `Dockerfile` there is the build).
3. **Settings → Build:** Dockerfile (auto-detected). No build command override.
4. **Settings → Deploy → Start Command:** leave empty — the Dockerfile `CMD` runs
   `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Railway injects `$PORT`.
5. **Settings → Networking →** generate a public domain (or keep private and call it
   over the Railway private network from the LCC Railway app). Note the URL as
   `RESOLVER_URL`.
6. **Settings → Healthcheck Path:** `/health`.
7. First build compiles libpostal from source (~5–10 min) and pre-downloads bge-small.
   Subsequent deploys are cached.

> **Build-failure note (2026-07-31, session 33):** the first Railway build FAILED at the
> libpostal `make` step — `crf_context.c:366: implicit declaration of 'double_equals'`.
> Cause: `python:3.11-slim` moved to Debian trixie / **GCC 14**, where implicit function
> declarations are hard errors; libpostal v1.1 predates that (calls `double_equals`
> without including `float_utils.h`). Fixed in the Dockerfile by (a) pinning BOTH stages
> to `python:3.11-slim-bookworm` (GCC 12 — glibc must match across stages since the .so
> is copied) and (b) a guarded sed that adds the missing `#include "float_utils.h"` —
> verified against the v1.1 tag source. If a future base bump reintroduces toolchain
> errors, check this note first before touching libpostal itself.
>
> **Build-failure #2 (same day):** with the bookworm pin the C library built, but the
> `postal` Python wheel failed at link — pypostal >=1.1.10 binds
> `libpostal_expand_address_root`, which the 2018 **v1.1 tag doesn't have**. Fix:
> `LIBPOSTAL_REF` now pins master commit `25099c50…` (2026-07 HEAD, fetched as a
> tarball; also carries the upstream GCC-14 fix, making the sed guard a no-op). Rule of
> thumb: pypostal tracks libpostal master, not the ancient release tags.

### Resources
- **CPU-only.** No GPU. bge-small runs fine on CPU; libpostal is C.
- Memory: set **≥ 2 GB** (libpostal data + the embedding model). 1 GB will OOM on the
  model load.

---

## 2. Environment variables

All optional — the service has safe defaults. Set these on the service:

| Var | Value | Why |
|---|---|---|
| `RESOLVER_EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | (default) embedding model for KNN blocking. |
| `RESOLVER_AUTO_LINK` | *(leave unset)* | Bands come from the trained model JSON; only set to override. |
| `RESOLVER_AUTO_REJECT` | *(leave unset)* | ″ |
| `SUPABASE_URL` | `https://xengecqvemvfknjvbvrq.supabase.co` | **Only for `/train`** — the Storage host holding the W4.1 corpus (LCC Opps). |
| `RESOLVER_STORAGE_KEY` | *(the LCC Opps **legacy anon JWT** — Supabase dashboard → LCC Opps → Settings → API keys → "anon" legacy key, `eyJ…`)* | **Read-only, CORRECTED 2026-07-31 (session 33):** must be the legacy anon **JWT**, NOT the `sb_publishable_…` key — corpus.py sends only `Authorization: Bearer <key>`, and publishable keys are valid solely in an `apikey` header (Bearer + publishable → Storage 400). The anon JWT + the `resolver_corpus_read` RLS policy (anon SELECT on storage.objects where bucket_id='entity-resolution') grants download-only access to exactly this bucket; anon has no write policy, so writes are impossible by construction. Do NOT swap in a service-role key. |
| `RESOLVER_CORPUS_BUCKET` | `entity-resolution` | (default) Storage bucket W4.1 writes to. |
| `RESOLVER_CORPUS_PATH` | `w4_1/labeled_pairs.jsonl` | (default) object path. |

> ⚠️ **Do not copy env from `cms-ingestion`/`public-record-ingest`** (the W3.1b footgun —
> those point `SUPABASE_URL` at the wrong project). This service's `SUPABASE_URL` is only
> the **Storage** host for the corpus and is read-only; it needs no domain DB creds at all.

---

## 3. Verify the deploy

```bash
RESOLVER_URL=https://entity-resolver-XXXX.up.railway.app

# 1. Health — confirm the real backends are live (libpostal true, embeddings
#    sentence-transformers, splink true in the Docker image).
curl -s $RESOLVER_URL/health | jq
# expect: {"status":"ok","backends":{"libpostal":true,"embeddings":"sentence-transformers","splink":true}, "no_db_writes":true}

# 2. Normalize
curl -sXPOST $RESOLVER_URL/normalize -H 'content-type: application/json' \
  -d '{"names":["Cedar Point Holdings LLC"],"addresses":["100 Main St, Dallas, TX 75201"]}' | jq

# 3. Match (should auto_link the legal-form variant, not the unrelated one)
curl -sXPOST $RESOLVER_URL/match -H 'content-type: application/json' -d '{
  "model":"owner_owner",
  "left":[{"id":"L1","name":"Cedar Point Holdings LLC","address":"100 Main St, Dallas, TX","state":"TX"}],
  "right":[{"id":"R1","name":"Cedar Point Holdings, L.L.C.","address":"100 Main Street, Dallas, TX","state":"TX"},
           {"id":"R2","name":"Smith Partners LP","state":"TX"}]
}' | jq '.pairs[] | {right_id, probability, band}'
```

The image ships **default models trained on the fixture stub** (`resolver/fixtures/model_*.json`),
so `/match` works immediately. The bands are the ones in `docs/resolver/CALIBRATION.md`.

---

## 4. Re-train once the W4.1 corpus lands in Storage

W4.1 (training-data export) is ⬜ not started. The moment Cowork writes the labeled JSONL
to `entity-resolution/w4_1/labeled_pairs.jsonl` on LCC Opps Storage:

1. Set `SUPABASE_URL` + `RESOLVER_STORAGE_KEY` on the service (read-only Storage token).
2. Retrain + recalibrate each model against real labels:

```bash
for m in owner_owner owner_sf contact; do
  curl -sXPOST $RESOLVER_URL/train -H 'content-type: application/json' \
    -d "{\"model\":\"$m\",\"use_storage\":true,\"target_precision\":0.995}" \
  | jq '{model, trainer, corpus, n_train_pairs, n_test_pairs, bands, precision: .calibration.auto_link.precision}'
done
```

- `corpus` in the response must read `storage://entity-resolution/...` (NOT `fixtures`) —
  that confirms it trained on the real set, not the stub.
- The trained models persist to the service's model dir. **Note:** Railway's filesystem is
  ephemeral across redeploys — a redeploy re-bakes the fixture-trained defaults. For
  durable retrained models either (a) re-run `/train` after each deploy (cheap; it's the
  W4.4 nightly loop anyway), or (b) mount a Railway volume at `RESOLVER_MODEL_DIR` and set
  that env. The W4.4 nightly `/train` makes (a) the intended steady state.
3. Copy the fresh calibration into the repo: re-run
   `python resolver/scripts/gen_models_and_calibration.py` against the same corpus (point
   `SUPABASE_URL`/`RESOLVER_STORAGE_KEY` locally) and commit the updated
   `docs/resolver/CALIBRATION.md` + `resolver/fixtures/model_*.json`.

---

## 5. How the scores get consumed (not this service's job)

Per the rollout plan — the resolver only scores; these are the writer paths:

- **W4.3** — Cowork batch-scores `sf_link_research_queue` (30,711 rows) through `/match`
  (`model=owner_sf`), auto-links ≥ auto-link band via the **existing** `admin.js:7396`
  sf-link attach path with `source='splink_v1'`, auto-rejects ≤ reject band, routes the
  middle band to the W3.4 review lane.
- **W4.4** — register `splink_v1` in `field_source_priority`; nightly append new
  `entity_match_labels` → corpus → weekly `/train` + recalibration; point the ORE
  candidate scorer at `/match` (fail-closed to `needs_review` if the service is down —
  never fail-open to a merge).

---

## 6. Troubleshooting

- **`/health` shows `libpostal:false`** → the libpostal build stage failed or the data
  dir didn't copy. Rebuild; check the build log for the `make install` step. The service
  still runs (regex address fallback) but address precision drops.
- **`/health` shows `embeddings:"hashing-fallback"`** → bge-small wasn't downloaded (no
  build-time network). KNN blocking still works but on weaker vectors. Redeploy with
  network, or accept the fallback (token blocking carries most recall).
- **`/train` 502 "corpus load failed"** → `SUPABASE_URL`/`RESOLVER_STORAGE_KEY` unset or
  the object path is wrong. Confirm the W4.1 object exists at
  `RESOLVER_CORPUS_BUCKET/RESOLVER_CORPUS_PATH`.
- **`/train` 422 "corpus is empty"** → the JSONL downloaded but had 0 usable lines.
- **OOM on boot** → bump memory to ≥ 2 GB (model + libpostal data).
