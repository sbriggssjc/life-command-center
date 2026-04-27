# Round 76 Recap — Intake Promotion Restoration

**Period:** 2026-04-26 → 2026-04-27
**Final outcome:** 226/230 stalled OM intakes recovered (98.3%) → fully end-to-end after the parseCurrency follow-up (Bug Z #8).

## The Cascade — 9 distinct bugs in series

| # | Tag | Bug | Fix |
|---|---|---|---|
| 1 | 76    | `handleIntakeQueue`/`handleIntakePromote` `SELECT`-ed `source_email_subject`/`source_email_sender` columns that don't exist. PostgREST 400'd; client saw a misleading 404 "Intake item not found". | Drop missing columns; pull subject/sender from `raw_payload.seed_data.subject/sender` instead. |
| 2 | 76b   | Couldn't tell if Railway had picked up a deploy because the queue endpoint returned a generic error with no detail. | Added `build_marker` + `pg_status` + `pg_detail` to the error response so smoke tests can verify code freshness in one call. |
| 3 | 76c   | `handleIntakeQueue` embedded `staged_intake_matches(...)` via PostgREST relationship — but **the FK from `staged_intake_items.intake_id` to `staged_intake_matches.intake_id` doesn't exist**. PGRST200 "no relationship found". | Drop the embed entirely. Match data already lives inline in `raw_payload.extraction_result` so we read from there. |
| 4 | 76d   | Status enum drifted at some point. Old code filtered for `status IN ('extracted','matched','review_needed')` — none of which exist anymore (actual values: `review_required`/`queued`/`failed`/`finalized`/`discarded`). Queue returned 0 rows. | Update to current enum. |
| 5 | 76e   | `ensureEntityLink` writes metadata to **`external_identities.metadata`** but the sidebar pipeline reads **`entities.metadata`**. New entities had empty metadata; pipeline short-circuited with "No actionable sidebar data". | After ensureEntityLink, PATCH the entity's own metadata column with the merged metadata; pass `force:true` to processSidebarExtraction. |
| 6 | 76f   | Body-only emails arrive with `extraction.address=null`. Even though the matcher already resolved a dia property, the metadata sent to the sidebar pipeline had no address — classifier saw only `tenant + property <uuid>` and couldn't link to the right property. | When `extraction.address` is null but matcher resolved a property_id, look up the property's address from the dia/gov DB and inject into metadata. |
| 7 | 76g   | `classifyAndUpdateDomain` falls back to `entity.domain` (the column) when its tenant-pattern classifier returns null — but our fix only set `metadata.domain`. Centria Healthcare matched dialysis via the matcher but the classifier doesn't have a Centria pattern, so domain stayed null. | Also PATCH `entity.domain` when matcher resolved a trusted dialysis/government domain. |
| 8 | 76h   | When `match_domain='lcc'`, the matcher's `match_property_id` is an LCC entity UUID (not a numeric dia/gov property_id). The address-lookup path skipped these because it expected a numeric id. | Unwrap LCC entity UUIDs via `external_identities` to find the underlying dia/gov property_id, then resolve the address from there. |
| 9 | 76i   | Sidebar's `upsertDomainProperty` reads `entity.address/city/state` columns when looking up the dia property, not `metadata.address`. Multi-tenant medical OMs with JSON-array `tenant_name` had clean addresses but those weren't promoted to the entity columns. | After ensureEntityLink, PATCH `entity.address/city/state` from the metadata along with `entity.domain`. |
| 10 | 76j  | `parseCurrency` only accepted strings (CoStar's `"$2,792,962"` form). OM extraction stores `asking_price` as a number. `parseCurrency(2792962)` → `null` → `upsertDialysisListings` early-exit guard fired → **listings silently not created** even when everything else worked. | Make `parseCurrency` tolerant of numbers. |
| 11 | 76k  | Audit follow-up: `parseDate(2030)` interprets number as ms-since-epoch and returns "1970-01-01T00:00:02.030Z". AI prompt says strings only, but a year-only leak would silently write 1970 dates. | Type-guard `parseDate` against numeric inputs. |

## Sibling-helper audit (Round 76 follow-up, 2026-04-27)

Triggered by Bug #10 (parseCurrency). Audited every `parse*` helper in
`api/_handlers/sidebar-pipeline.js` against AI-extracted (numeric) input.

| Helper | Number-tolerant? | Source of safety |
|---|---|---|
| `parseCurrency` | yes | Bug #10 fix — explicit `typeof val === 'number'` guard. |
| `parseSF` | yes | Pre-existing `if (typeof val === 'number') return val`. |
| `parsePercent` | yes | Pre-existing `if (typeof val === 'number') return val`. |
| `parseCapRateDecimal` | yes | Delegates to `parsePercent`. |
| `parseAcres` | yes | Pre-existing `if (typeof val === 'number') return val`. |
| `parseLotSF` | yes | Falls through to `parseSF` for non-AC inputs. |
| `parseParkingRatio` | yes | `String(num).match(/[\d.]+/)` finds digits. |
| `parseIntSafe` | yes | `parseInt(String(2019), 10)` works. |
| `parseYearSafe` | yes | Same as `parseIntSafe` plus range guard. |
| `parseCoord` | yes | Explicit `typeof val === 'number'` branch. |
| `parseDate` | **yes** (after Bug #11 fix) | Was silently coercing numbers via `new Date(num)`. |

All helper callers in `sidebar-pipeline.js` are co-located, so the helper-level
fix covers every consumer. `intake-promoter.js` doesn't use these helpers — it
uses direct `Number(snapshot.foo)` conversions which already accept both
strings and numbers.

## What this surfaced about the architecture

1. **Schema drift compounds.** Each rename (`extracted` → `review_required`, dropping `source_email_subject` columns) breaks consumers silently. A test that just hits each ?_route= endpoint with a known good intake would have caught items #1, #4, and #10 immediately.

2. **PostgREST relationship embeds need real FKs.** A table named `staged_intake_matches` exists but isn't FK-linked to `staged_intake_items` — PostgREST's relationship resolver refuses to embed without the FK. Either add the FK, or query inline.

3. **Two different metadata "homes" with different read/write conventions.** `ensureEntityLink` writes to `external_identities.metadata`; `processSidebarExtraction` reads from `entities.metadata`. The split is invisible until you look at why the pipeline sees nothing. Same pattern with `entity.address/city/state/domain` — set on one, read from the other.

4. **Type-shape divergence between data sources.** CoStar scrapes give strings; OM AI extraction gives numbers; sidebar pipeline's `parseCurrency` only handled strings. Generally, helpers that touch multi-source data should accept both.

5. **Self-describing error responses are non-negotiable.** Round 76b (adding `build_marker` + `pg_detail`) cut diagnosis time from "guess and push" to "read the response body." Every API that calls a downstream service should propagate that downstream's error detail.

## Regression tests to add

### Static / boot-time

1. **Schema column existence audit** — at boot, query `information_schema.columns` for each curated handler's referenced columns. Log a startup error if any referenced column is missing. Add to `api/_shared/lifecycle.js` boot check.
2. **Status enum reconciliation** — same idea for enum filter strings: parse them out of handler files at boot and verify against actual `status` values present in the table over the last 30 days.

### Integration

3. **`?_route=queue` returns ≥1 row in seeded test workspace** — run on every PR. Catches column drift, relationship drift, enum drift in one shot.
4. **`?_route=promote` end-to-end test** — given a known stalled intake with `extraction_snapshot.asking_price` as both a NUMBER and a STRING, verify a listing row is created. Catches the `parseCurrency` regression and the metadata-flow gap together.
5. **Round-trip metadata test** — call `?_route=promote`, then immediately `select metadata from entities where id = ?`. Verify the metadata that came in matches what's stored. Catches the ensureEntityLink-vs-entity.metadata split.

### Self-describing error responses

6. **All 4xx/5xx error responses include `build_marker`** — lint rule that finds every `res.status(>=400).json(...)` call and verifies the body has a build marker key. Without this, any future bug hides behind a generic "Failed to ..." string and you spend hours chasing nothing.

## Where the audit found leaks beyond the deploy chain

The 24-48h audit also surfaced:

- **`sales_transactions.sale_date NULL` had 363 rows** — all from legacy CSV import. Bulk-cleaned + added `CHECK NOT NULL` constraint.
- **`v_data_quality_summary`/`v_data_quality_issues` views** were not surfaced anywhere in the LCC UI. Now they are (Data Quality page).
- **24 priority rules flipped to `warn` mode** to start surfacing CoStar attempting to overwrite county-of-record data.
- **Phase 4 schema-drift detector** caught 20 unranked field/source triples actively writing to `field_provenance`. Now seeded.

## Files touched (deploy-critical)

```
api/intake.js                              (handlers + matcher-bridge + entity-column patch)
api/_handlers/intake-promoter.js           (doctype normalizer + tenant back-write + listing-snapshot fallback)
api/_handlers/sidebar-pipeline.js          (parseCurrency number tolerance + Phase 2.2.b/c provenance)
api/_handlers/entities-handler.js          (quality_provenance action)
api/_shared/allowlist.js                   (data-quality views)
ops.js                                     (Data Quality UI panels + Re-promote button)
supabase/functions/data-query/index.ts     (allowlist for v_data_quality_*)
supabase/migrations/20260427000000_dia_sales_transactions_sale_date_not_null.sql
+ 5 priority/view migrations (Phase 2.2/3/4)
scripts/recover-stalled-intakes.mjs
scripts/smoke-test-promote.mjs
scripts/Run-IntakeRecovery.ps1
```

## Bottom line

What started as "the queue endpoint 400s" turned out to be **9 separate failures in series**, each one masking the next. Each fix individually was small (1-30 lines); the total restoration was 9 commits. The lesson: when stuck, add observability (build_marker + pg_detail) FIRST. That alone collapsed our diagnosis loop from minutes-per-deploy to seconds-per-response-body.
