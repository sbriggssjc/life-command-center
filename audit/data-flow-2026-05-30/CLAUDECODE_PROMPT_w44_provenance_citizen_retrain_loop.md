# CLAUDE CODE PROMPT — W4.4: Model as provenance citizen + retraining loop

> **Unit:** W4.4 (LCC Audit Rollout Plan — LAST Wave 4 unit)
> **Written:** 2026-07-31 (Cowork session 33). Every fact below verified live that day.
> **Goal:** Make the resolver a self-maintaining citizen of the provenance system:
> (1) register `splink_v1` / `sf_link_review_human` in `field_source_priority`;
> (2) a nightly corpus-refresh + `/train` loop with a drift alert — which also fixes
> the two open calibration defects from session 33; (3) point the ORE candidate
> scorer at the resolver with a fail-closed fallback.

---

## Standing context (read first, don't rediscover)

- **Resolver service:** Railway `gracious-radiance-production-eeaf.up.railway.app`
  (project handsome-luck, service built from `resolver/`). `/health` reports real
  backends; `/train` reads `storage://entity-resolution/w4_1/labeled_pairs.jsonl`
  (LCC Opps Storage; `RESOLVER_STORAGE_KEY` = the ops **legacy anon JWT** —
  Bearer-only code path; `sb_publishable_` keys do NOT work there; the runbook
  documents this).
- **Band override env vars are DEAD CONFIG (verified 2026-07-31):**
  `RESOLVER_AUTO_LINK=0.9` + `RESOLVER_AUTO_REJECT=0.1` are set on the service,
  and config.py reads them into `settings.auto_link_threshold` — but /match and
  /train use the MODEL's bands (`fs.auto_link`), never the settings values. Part
  of this unit: **wire the env values as a clamp/floor over model bands (or
  delete the dead config)** — an env override that silently does nothing is the
  worst of both worlds. Until then no production consumer may trust /match bands.
  Latest live state: corpus refreshed to 5,420 pairs (incl. the 95 human labels),
  all 3 models retrained 2026-07-31 evening — holdout auto-link precision 0.9951
  (down from a too-easy 1.0; the hard negatives are biting, still ≥ 0.995 target).
- **Corpus machinery:** `w41-corpus-export` edge fn (Dialysis_DB project) rebuilds
  + uploads the labeled-pairs JSONL deterministically — POST `?action=export`
  with `X-PA-Webhook-Secret`. It already reads ALL of `entity_match_labels`
  (`same_party`→1, else→0), so re-running it ingests the sf_link_review verdicts
  (95 as of 2026-07-31 evening, 43 `distinct` hard negatives) with no code
  change. Composition doc: `docs/resolver/W4_1_CORPUS_REPORT.md`.
- **Railway models are ephemeral across redeploys** — a redeploy reverts to the
  committed fixture-trained JSONs until `/train` re-runs. The nightly loop is the
  designed fix (runbook §4 note).

## The two calibration defects this unit must fix (session-33 findings)

1. **Calibration-transfer gap.** The corpus-calibrated auto_link band came out at
   probability **0.005** — precision 1.0 on the held-out split, but on the live
   30k backlog it would have auto-linked ~26k rows including
   `'2200 Main LLC' → '900 South Main LLC'`. Cause: the corpus's generated
   negatives were guarded to be label-safe and therefore easy; the real negative
   population is harder. The W4.3 run used manual 0.9/0.1 bands instead.
   **Fix in this unit:** retrain with the human `sf_link_review` verdicts included
   (43+ real hard negatives, accruing as Scott works the lane), AND add a **band
   floor** to the calibration band-picker (`resolver/app/calibration.py`): the
   auto_link threshold may never fall below a configurable floor (default 0.5)
   regardless of what the threshold sweep finds — a sub-0.5 "safe" band is a
   symptom of easy negatives, not of safety.
2. **splink fallback.** `/train` reports `trainer: count_estimator` even though
   `/health` says `splink: true` — `splink_estimate()` (resolver/app/train.py
   ~107) throws and silently falls back. Diagnose (likely a splink 4.x API-shape
   issue in our wiring), fix or consciously retire the splink path with an honest
   README note. The count estimator is exact-given-labels, so this is quality
   polish, not a correctness bug — timebox it.

## Build items

### 1. Provenance citizenship (`field_source_priority`, LCC Opps xengecqvemvfknjvbvrq)

Registry shape: `(target_table, field_name, source, priority, min_confidence,
enforce_mode, notes)`; consult `api/_shared/field-priority-guard.js` for the
consumer contract. Current landscape (verified live): `costar_sidebar` = 70,
sidebar/listing feeds 70–80, QA canonicalizers 90, folder feeds 9999 (strict).
Look up `manual`'s current priority before choosing values.
- Register **`splink_v1`** (the batch writer) for the link fields it writes —
  ops-side representation of gov `true_owners.sf_account_id` /
  `recorded_owners.sf_account_id` and dia `true_owners.sf_company_id` (use the
  same target_table naming convention `provenance-flush.js` normalizes to) —
  priority **between costar_sidebar (70) and manual**, `enforce_mode='record_only'`
  first (plan's instruction), `min_confidence=0.9` (the band the batch used).
- Register **`sf_link_review_human`** at manual-equivalent priority (it IS a
  human decision).
- The W4.3 batch + review-lane provenance rows already flow to ops via the
  provenance flush (gov rows carry `flushed_to_lcc_opps_at` machinery — verify
  the flush picks up `source='splink_v1'`/`'sf_link_review_human'` rows and that
  `provenance-flush.js` normalization handles the gov/dia table names).

### 2. Nightly retrain loop

Hosting rule: **Railway or pg_cron → edge fn; NEVER GitHub Actions.** Suggested
shape (follow the existing cron conventions — pg_cron on Dialysis_DB calling edge
fns with `X-PA-Webhook-Secret`, like `sf-files-stage-queued-15m`):
1. **Nightly corpus refresh:** pg_cron POST → `w41-corpus-export?action=export`.
   Deterministic + idempotent; new entity_match_labels rows flow in automatically.
2. **Nightly `/train`:** for each model (`owner_owner`, `owner_sf`, `contact`)
   POST the resolver's `/train` with `use_storage:true, target_precision:0.995`.
   This ALSO heals the ephemeral-model problem after any redeploy. Needs an HTTP
   caller with the resolver URL — either the same pg_cron tick (net.http_post) or
   a small edge fn `w44-retrain-tick` that fans out and records results.
3. **Drift alert:** persist each night's calibration summary (a small
   `resolver_calibration_history` table on Dialysis_DB or ops: model, corpus sha,
   n_train/n_test, auto_link threshold+precision+recall, trainer). Alert via the
   existing `lcc_health_alerts` pattern when (a) holdout precision drops >1pt,
   (b) the trainer falls back unexpectedly, or (c) the auto_link band hits the
   floor (= negatives still too easy — the transfer gap resurfacing).
4. After the loop is live, regenerate `docs/resolver/CALIBRATION.md` + committed
   model JSONs from the refreshed corpus
   (`resolver/scripts/gen_models_and_calibration.py` now honors
   `SUPABASE_URL`/`RESOLVER_STORAGE_KEY`) and commit.

### 3. ORE candidate scorer → resolver

Replace the whole-token-prefix heuristic (`lcc_reconcile_name_match`, migration
`20260716140000_lcc_ore_multi_signal_reconciliation.sql` ~385–410; the reconcile
engine consumes it from the discovery scan) with a resolver `/match` call
(`owner_owner` model) as the name-similarity signal:
- Caller lives where the engine's orchestration lives (find the tick that drives
  it — if the scan is pure SQL, add the resolver signal at the JS layer that
  consumes scan output rather than calling HTTP from plpgsql).
- **Fail-closed:** resolver unreachable/timeout (suggest 3s) → keep the SQL
  heuristic result but cap the outcome at `needs_review` — NEVER auto-merge on
  the fallback path. Log fallback occurrences.
- Config: `RESOLVER_URL` env on the LCC Railway app; feature flag
  (`ORE_USE_RESOLVER=1`) so it can be reverted without redeploy.

## Non-negotiables

1. The resolver stays **read-only** — all writes happen in LCC/edge-fn/cron land.
2. Nightly loop failure = loud (`lcc_health_alerts`), never silent; a failed
   corpus refresh must NOT run `/train` against a stale/partial object (the
   export is atomic via x-upsert, so ordering is the only concern — refresh,
   then train, sequenced).
3. Band floor is a hard invariant in calibration.py with a unit test.
4. ORE fallback path fail-closed test (service down → needs_review, no merge).
5. Update `docs/audits/ROLLOUT_STATUS.md` (W4.4 row + session log; **Wave 4
   closes with this unit** — say so),
   `docs/resolver/RUNBOOK_railway_resolver_service.md` (nightly loop = steady
   state; delete the manual-retrain-after-deploy caveat AND the interim band
   override note — remove the env override as part of rollout), and
   `docs/resolver/W4_1_CORPUS_REPORT.md` (corpus v2+ = accruing, refreshed
   nightly).

## Verification (live)

1. `field_source_priority` rows exist for `splink_v1` + `sf_link_review_human`;
   `field-priority-guard` resolves them (unit test with the registry shapes).
2. Force-run the nightly tick once: corpus re-exports (sha changes or matches),
   all three `/train` responses cite `storage://…`, calibration history rows land.
3. Redeploy the resolver → nightly tick restores real-corpus models (the
   ephemeral-model gap is closed).
4. With ≥ the current 95 human labels in corpus: auto_link band comes out ≥ the
   floor; report old vs new bands in the PR description.
5. ORE: one reconcile tick with `ORE_USE_RESOLVER=1` shows resolver-scored
   candidates; kill the URL → tick degrades to needs_review with a logged
   fallback, zero merges.
