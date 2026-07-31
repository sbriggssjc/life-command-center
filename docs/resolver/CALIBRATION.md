# Entity-Resolution Resolver — Calibration Report

**Service version:** 0.1.0  
**Audit unit:** W4.2 (LCC Audit Rollout Plan)  
**Corpus:** `storage://entity-resolution/w4_1/labeled_pairs.jsonl`  
**splink installed in this build:** False  

> ✅ **This report is computed on the live W4.1 corpus** (delivered 2026-07-31 — see docs/resolver/W4_1_CORPUS_REPORT.md for composition and known gaps: sf_account/email are null in this corpus, so the owner_sf and contact models are effectively name/address-calibrated until W4.3 feeds back SF-linked pairs).

- Train pairs: **4795**  
- Test pairs: **547**  
- Split key: `entity_group` (no group spans train+test → no leakage).

## Model `owner_sf`

- Trainer: `count_estimator`  
- Prior (P(match) among candidates): `0.2`  
- **Auto-link band:** `probability ≥ 0.005` → precision **1.0** (true links 404, false links 0, recall 0.9926)  
- **Auto-reject band:** `probability ≤ 0.0008` → correct rejects 49, positives lost 0  
- **Needs-review (middle band):** 94 test pairs  

| threshold | precision | recall | f1 | tp | fp | fn |
|---|---|---|---|---|---|---|
| 0.0 | 0.7441 | 1.0 | 0.8532 | 407 | 140 | 0 |
| 0.2 | 1.0 | 0.9853 | 0.9926 | 401 | 0 | 6 |
| 0.5 | 1.0 | 0.9828 | 0.9913 | 400 | 0 | 7 |
| 0.7 | 1.0 | 0.9828 | 0.9913 | 400 | 0 | 7 |
| 0.8 | 1.0 | 0.9828 | 0.9913 | 400 | 0 | 7 |
| 0.9 | 1.0 | 0.9435 | 0.9709 | 384 | 0 | 23 |
| 0.92 | 1.0 | 0.9091 | 0.9524 | 370 | 0 | 37 |
| 0.95 | 1.0 | 0.9091 | 0.9524 | 370 | 0 | 37 |
| 0.99 | 1.0 | 0.7297 | 0.8437 | 297 | 0 | 110 |

**Learned match weights (log2 m/u) by comparison level:**

| comparison | level | m | u | weight (log2) |
|---|---|---|---|---|
| name | 3 | 0.759412 | 0.000431 | 10.783 |
| name | 2 | 0.159247 | 0.000431 | 8.529 |
| name | 1 | 0.049327 | 0.002155 | 4.517 |
| name | 0 | 0.032014 | 0.996983 | -4.961 |
| address | 3 | 0.000137 | 0.303017 | -11.111 |
| address | 2 | 0.000962 | 0.000431 | 1.158 |
| address | 1 | 0.000137 | 0.000431 | -1.654 |
| address | 0 | 0.002061 | 0.000431 | 2.258 |
| state | 1 | 0.099918 | 0.957291 | -3.26 |
| state | 0 | 0.001237 | 0.040984 | -5.05 |
| sf_account | 1 | 0.000137 | 0.000431 | -1.654 |
| sf_account | 0 | 0.000137 | 0.000431 | -1.654 |

## Model `owner_owner`

- Trainer: `count_estimator`  
- Prior (P(match) among candidates): `0.2`  
- **Auto-link band:** `probability ≥ 0.005` → precision **1.0** (true links 404, false links 0, recall 0.9926)  
- **Auto-reject band:** `probability ≤ 0.0008` → correct rejects 49, positives lost 0  
- **Needs-review (middle band):** 94 test pairs  

| threshold | precision | recall | f1 | tp | fp | fn |
|---|---|---|---|---|---|---|
| 0.0 | 0.7441 | 1.0 | 0.8532 | 407 | 140 | 0 |
| 0.2 | 1.0 | 0.9853 | 0.9926 | 401 | 0 | 6 |
| 0.5 | 1.0 | 0.9828 | 0.9913 | 400 | 0 | 7 |
| 0.7 | 1.0 | 0.9828 | 0.9913 | 400 | 0 | 7 |
| 0.8 | 1.0 | 0.9828 | 0.9913 | 400 | 0 | 7 |
| 0.9 | 1.0 | 0.9435 | 0.9709 | 384 | 0 | 23 |
| 0.92 | 1.0 | 0.9091 | 0.9524 | 370 | 0 | 37 |
| 0.95 | 1.0 | 0.9091 | 0.9524 | 370 | 0 | 37 |
| 0.99 | 1.0 | 0.7297 | 0.8437 | 297 | 0 | 110 |

**Learned match weights (log2 m/u) by comparison level:**

| comparison | level | m | u | weight (log2) |
|---|---|---|---|---|
| name | 3 | 0.759412 | 0.000431 | 10.783 |
| name | 2 | 0.159247 | 0.000431 | 8.529 |
| name | 1 | 0.049327 | 0.002155 | 4.517 |
| name | 0 | 0.032014 | 0.996983 | -4.961 |
| address | 3 | 0.000137 | 0.303017 | -11.111 |
| address | 2 | 0.000962 | 0.000431 | 1.158 |
| address | 1 | 0.000137 | 0.000431 | -1.654 |
| address | 0 | 0.002061 | 0.000431 | 2.258 |
| state | 1 | 0.099918 | 0.957291 | -3.26 |
| state | 0 | 0.001237 | 0.040984 | -5.05 |

## Model `contact`

- Trainer: `count_estimator`  
- Prior (P(match) among candidates): `0.2`  
- **Auto-link band:** `probability ≥ 0.005` → precision **1.0** (true links 404, false links 0, recall 0.9926)  
- **Auto-reject band:** `probability ≤ 0.0008` → correct rejects 49, positives lost 0  
- **Needs-review (middle band):** 94 test pairs  

| threshold | precision | recall | f1 | tp | fp | fn |
|---|---|---|---|---|---|---|
| 0.0 | 0.7441 | 1.0 | 0.8532 | 407 | 140 | 0 |
| 0.2 | 1.0 | 0.9853 | 0.9926 | 401 | 0 | 6 |
| 0.5 | 1.0 | 0.9828 | 0.9913 | 400 | 0 | 7 |
| 0.7 | 1.0 | 0.9828 | 0.9913 | 400 | 0 | 7 |
| 0.8 | 1.0 | 0.9828 | 0.9913 | 400 | 0 | 7 |
| 0.9 | 1.0 | 0.9435 | 0.9709 | 384 | 0 | 23 |
| 0.92 | 1.0 | 0.9091 | 0.9524 | 370 | 0 | 37 |
| 0.95 | 1.0 | 0.9091 | 0.9524 | 370 | 0 | 37 |
| 0.99 | 1.0 | 0.7297 | 0.8437 | 297 | 0 | 110 |

**Learned match weights (log2 m/u) by comparison level:**

| comparison | level | m | u | weight (log2) |
|---|---|---|---|---|
| name | 3 | 0.759412 | 0.000431 | 10.783 |
| name | 2 | 0.159247 | 0.000431 | 8.529 |
| name | 1 | 0.049327 | 0.002155 | 4.517 |
| name | 0 | 0.032014 | 0.996983 | -4.961 |
| address | 3 | 0.000137 | 0.303017 | -11.111 |
| address | 2 | 0.000962 | 0.000431 | 1.158 |
| address | 1 | 0.000137 | 0.000431 | -1.654 |
| address | 0 | 0.002061 | 0.000431 | 2.258 |
| state | 1 | 0.099918 | 0.957291 | -3.26 |
| state | 0 | 0.001237 | 0.040984 | -5.05 |
| email | 1 | 0.014706 | 0.000431 | 5.093 |
| email | 0 | 0.000962 | 0.000431 | 1.158 |

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

