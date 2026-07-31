# W4.1 — Entity-Resolution Training Corpus (labeled pairs)

> **Status: DELIVERED 2026-07-31.** `storage://entity-resolution/w4_1/labeled_pairs.jsonl`
> on LCC Opps (xengecqvemvfknjvbvrq), 5,342 pairs, sha256
> `47c41a59382ab90c3e57b135e9d04346cb5fab761725584dd841f01c5b448d0d` (1.39 MB).
> Machine-readable summary: `entity-resolution/w4_1/corpus_report.json`.
> Built by the `w41-corpus-export` edge function (Dialysis_DB) — re-runnable,
> deterministic (seeded shuffle + FNV split hash), idempotent (x-upsert).

## Headline numbers

| Metric | Value |
|---|---|
| Total pairs | 5,342 |
| Positives / negatives | 4,044 / 1,298 (76% / 24%) |
| Entity groups (union-find components) | 4,750 |
| Split (by entity, not by pair) | train 4,277 / valid 518 / test 547 |
| Split × label | train 3,245+ / 1,032− · valid 392+ / 126− · test 407+ / 140− |

## Sources

| Source | Raw | Survived dedupe | Label |
|---|---|---|---|
| gov `dq5_owner_merge_map` | 1,294 | — | 1 |
| gov `dq5_true_owner_merge_map` | 1,367 | — | 1 |
| dia `dq5_owner_merge_map` | 435 | — | 1 |
| dia `dq5_true_owner_merge_map` | 175 | — | 1 |
| (dq5 combined after dedupe) | 3,271 | 2,318 | 1 |
| ops `entities` soft merges (`merged_into_entity_id` — incl. Boyd Watterson 20260725120000, merge_duplicate_entities losers) | 2,260 | 1,671 | 1 |
| ops `entity_match_labels` (W3.2 human labels, all same_party) | 50 | 36 | 1 |
| ops `lcc_decisions` owner_reconcile approve | 50 | 19 | 1 |
| ops `lcc_decisions` exact_name_merge merged | 61 | 0 (all norm-collide with dq5 case variants — no signal lost) | 1 |
| Generated hard negatives, same-state (gov 700 / dia 198) | 898 | 898 | 0 |
| Generated hard negatives, same-city (ops entities) | 400 | 400 | 0 |

Cross-source duplicates dropped: 1,648 (unordered normalized-name pair key).

## Methodology notes (honest)

- **Split-by-entity:** union-find over positive pairs → components; component root
  hashed (FNV-1a) → 80/10/10. A negative pair adopts `name_a`'s component. This
  prevents the main leakage channel (same entity's variants in train AND test).
  Residual: a negative's `name_b` entity can appear in another split — minor,
  standard, documented.
- **Negative-label safety guards:** a candidate negative is DROPPED if the two
  names share any rare token (len ≥ 5, legal-form stopwords excluded) or collide
  with a known positive. This trades some hardness for label correctness — a
  false negative label poisons m/u estimation worse than a soft negative helps.
- **Class balance 76/24** (plan target was "report it", not force 50/50). The
  count estimator computes `prior` from the scored pairs, so imbalance is
  handled; if calibration wants more negatives, raise the `want` caps in
  `hardNegatives()` and re-run — deterministic, so old pairs are stable.
- **`sf_account_*` and most `email_*` fields are null** — the merge logs don't
  carry SF accounts. The `owner_sf` and `contact` models therefore still lean on
  the fixture stub archetypes until an SF-linked pair source lands (W4.3's
  reviewed sf_link decisions will be exactly that — feed them back in v2).
- **Excluded sources, with reasons:** `staged_intake_feedback` /
  `staged_intake_promotions` (3.7k implicit approvals) are intake→property
  address matches whose "names" are OM filenames — not entity names; signal
  already consumed by the W1.1 matcher-accuracy rollup. gov `entity_merge_log`
  (182) carries no names and its merged rows are hard-deleted.
  `match_disambiguation` (1,120) has zero decided rows as of export.
- **Exact-string positives:** dq5 case/punctuation variants normalize to
  identical keys, so the corpus retains one pair per normalized pair; trivial
  exact positives still exist via near-identical variants. This is intended.

## Re-run / iterate

```
# summary only (no writes)
curl -s 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/w41-corpus-export?action=preview' \
  -H "X-PA-Webhook-Secret: $PA_WEBHOOK_SECRET"
# rebuild + upload (idempotent upsert of the Storage object)
curl -sXPOST '.../w41-corpus-export?action=export' -H "X-PA-Webhook-Secret: $PA_WEBHOOK_SECRET"
```

New merge decisions accumulate in the same source tables, so re-running the
export IS the W4.4 corpus-refresh step (pair it with the nightly `/train`).

## Next (W4.2 → W4.3 gate)

1. Scott: create the Railway `entity-resolver` service per
   `docs/resolver/RUNBOOK_railway_resolver_service.md` (still pending).
2. Set `SUPABASE_URL` (LCC Opps) + `RESOLVER_STORAGE_KEY` on the service.
3. `POST /train` per model — response `corpus` must read
   `storage://entity-resolution/w4_1/labeled_pairs.jsonl`.
4. Regenerate `docs/resolver/CALIBRATION.md` against the real corpus; approve
   auto-link band (precision ≥ 0.995) → unlocks W4.3 (SF-link 30k backlog run).
