# Entity-Resolution Resolver — Calibration Report

**Service version:** 0.1.0  
**Audit unit:** W4.2 (LCC Audit Rollout Plan)  
**Corpus:** `resolver/fixtures/pairs.jsonl` (STUB — W4.1 corpus not yet in Storage)  
**splink installed in this build:** False  

> ⚠️ **This report is computed on the committed fixture stub, not the live W4.1 training set.** W4.1 (training-data export) is ⬜ not started, so the labeled corpus is not in Supabase Storage yet. The numbers below prove the pipeline, band selection, and precision target end-to-end. **Re-run `POST /train` (or this script) once W4.1 lands** — see the runbook — to regenerate the models and this report against real labels. The band-selection logic and the ≥0.995 auto-link precision target are unchanged; only the m/u parameters and thresholds move.

- Train pairs: **40**  
- Test pairs: **16**  
- Split key: `entity_group` (no group spans train+test → no leakage).

## Model `owner_sf`

- Trainer: `count_estimator`  
- Prior (P(match) among candidates): `0.2`  
- **Auto-link band:** `probability ≥ 0.11` → precision **1.0** (true links 6, false links 0, recall 0.75)  
- **Auto-reject band:** `probability ≤ 0.1076` → correct rejects 6, positives lost 0  
- **Needs-review (middle band):** 4 test pairs  

| threshold | precision | recall | f1 | tp | fp | fn |
|---|---|---|---|---|---|---|
| 0.0 | 0.5 | 1.0 | 0.6667 | 8 | 8 | 0 |
| 0.2 | 1.0 | 0.75 | 0.8571 | 6 | 0 | 2 |
| 0.5 | 1.0 | 0.75 | 0.8571 | 6 | 0 | 2 |
| 0.7 | 1.0 | 0.625 | 0.7692 | 5 | 0 | 3 |
| 0.8 | 1.0 | 0.625 | 0.7692 | 5 | 0 | 3 |
| 0.9 | 1.0 | 0.375 | 0.5455 | 3 | 0 | 5 |
| 0.92 | 1.0 | 0.375 | 0.5455 | 3 | 0 | 5 |
| 0.95 | 1.0 | 0.125 | 0.2222 | 1 | 0 | 7 |
| 0.99 | 1.0 | 0.0 | 0.0 | 0 | 0 | 8 |

**Learned match weights (log2 m/u) by comparison level:**

| comparison | level | m | u | weight (log2) |
|---|---|---|---|---|
| name | 3 | 0.145833 | 0.025 | 2.544 |
| name | 2 | 0.5625 | 0.025 | 4.492 |
| name | 1 | 0.0625 | 0.175 | -1.485 |
| name | 0 | 0.229167 | 0.775 | -1.758 |
| address | 3 | 0.104167 | 0.075 | 0.474 |
| address | 2 | 0.270833 | 0.025 | 3.437 |
| address | 1 | 0.604167 | 0.475 | 0.347 |
| address | 0 | 0.020833 | 0.425 | -4.351 |
| state | 1 | 0.978261 | 0.921053 | 0.087 |
| state | 0 | 0.021739 | 0.078947 | -1.861 |
| sf_account | 1 | 0.065217 | 0.026316 | 1.309 |
| sf_account | 0 | 0.021739 | 0.078947 | -1.861 |

## Model `owner_owner`

- Trainer: `count_estimator`  
- Prior (P(match) among candidates): `0.2`  
- **Auto-link band:** `probability ≥ 0.11` → precision **1.0** (true links 6, false links 0, recall 0.75)  
- **Auto-reject band:** `probability ≤ 0.1076` → correct rejects 6, positives lost 0  
- **Needs-review (middle band):** 4 test pairs  

| threshold | precision | recall | f1 | tp | fp | fn |
|---|---|---|---|---|---|---|
| 0.0 | 0.5 | 1.0 | 0.6667 | 8 | 8 | 0 |
| 0.2 | 1.0 | 0.75 | 0.8571 | 6 | 0 | 2 |
| 0.5 | 1.0 | 0.75 | 0.8571 | 6 | 0 | 2 |
| 0.7 | 1.0 | 0.625 | 0.7692 | 5 | 0 | 3 |
| 0.8 | 1.0 | 0.625 | 0.7692 | 5 | 0 | 3 |
| 0.9 | 1.0 | 0.375 | 0.5455 | 3 | 0 | 5 |
| 0.92 | 1.0 | 0.375 | 0.5455 | 3 | 0 | 5 |
| 0.95 | 1.0 | 0.125 | 0.2222 | 1 | 0 | 7 |
| 0.99 | 1.0 | 0.0 | 0.0 | 0 | 0 | 8 |

**Learned match weights (log2 m/u) by comparison level:**

| comparison | level | m | u | weight (log2) |
|---|---|---|---|---|
| name | 3 | 0.145833 | 0.025 | 2.544 |
| name | 2 | 0.5625 | 0.025 | 4.492 |
| name | 1 | 0.0625 | 0.175 | -1.485 |
| name | 0 | 0.229167 | 0.775 | -1.758 |
| address | 3 | 0.104167 | 0.075 | 0.474 |
| address | 2 | 0.270833 | 0.025 | 3.437 |
| address | 1 | 0.604167 | 0.475 | 0.347 |
| address | 0 | 0.020833 | 0.425 | -4.351 |
| state | 1 | 0.978261 | 0.921053 | 0.087 |
| state | 0 | 0.021739 | 0.078947 | -1.861 |

## Model `contact`

- Trainer: `count_estimator`  
- Prior (P(match) among candidates): `0.2`  
- **Auto-link band:** `probability ≥ 0.11` → precision **1.0** (true links 6, false links 0, recall 0.75)  
- **Auto-reject band:** `probability ≤ 0.1076` → correct rejects 6, positives lost 0  
- **Needs-review (middle band):** 4 test pairs  

| threshold | precision | recall | f1 | tp | fp | fn |
|---|---|---|---|---|---|---|
| 0.0 | 0.5 | 1.0 | 0.6667 | 8 | 8 | 0 |
| 0.2 | 1.0 | 0.75 | 0.8571 | 6 | 0 | 2 |
| 0.5 | 1.0 | 0.75 | 0.8571 | 6 | 0 | 2 |
| 0.7 | 1.0 | 0.625 | 0.7692 | 5 | 0 | 3 |
| 0.8 | 1.0 | 0.625 | 0.7692 | 5 | 0 | 3 |
| 0.9 | 1.0 | 0.375 | 0.5455 | 3 | 0 | 5 |
| 0.92 | 1.0 | 0.375 | 0.5455 | 3 | 0 | 5 |
| 0.95 | 1.0 | 0.125 | 0.2222 | 1 | 0 | 7 |
| 0.99 | 1.0 | 0.0 | 0.0 | 0 | 0 | 8 |

**Learned match weights (log2 m/u) by comparison level:**

| comparison | level | m | u | weight (log2) |
|---|---|---|---|---|
| name | 3 | 0.145833 | 0.025 | 2.544 |
| name | 2 | 0.5625 | 0.025 | 4.492 |
| name | 1 | 0.0625 | 0.175 | -1.485 |
| name | 0 | 0.229167 | 0.775 | -1.758 |
| address | 3 | 0.104167 | 0.075 | 0.474 |
| address | 2 | 0.270833 | 0.025 | 3.437 |
| address | 1 | 0.604167 | 0.475 | 0.347 |
| address | 0 | 0.020833 | 0.425 | -4.351 |
| state | 1 | 0.978261 | 0.921053 | 0.087 |
| state | 0 | 0.021739 | 0.078947 | -1.861 |
| email | 1 | 0.021739 | 0.026316 | -0.276 |
| email | 0 | 0.021739 | 0.026316 | -0.276 |

## How the bands are chosen

- **Auto-link** = the lowest probability threshold whose precision on the test split is ≥ the target (0.995) with non-zero recall. Pairs at/above it are safe to write through the existing sf-link / owner_reconcile paths with `source='splink_v1'` and the probability as confidence.
- **Auto-reject** = the highest threshold below which no true positive falls (recall-safe). Pairs at/below it close as `no_match`.
- **Needs-review** = everything between. These flow to the W3.2 owner_reconcile / entity_match_candidates lane; every human verdict there becomes an `entity_match_labels` row = retraining data (W4.4 loop).

## Reproduce

```bash
cd resolver && pip install -r requirements.txt
python scripts/gen_models_and_calibration.py   # regenerates models + this report
# or, against the live W4.1 Storage corpus once it exists:
curl -XPOST $RESOLVER_URL/train -H 'content-type: application/json' \
     -d '{"model":"owner_owner","use_storage":true,"target_precision":0.995}'
```

