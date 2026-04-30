# Field Source Priority — warn/strict ramp plan

**Status: most rules in `record_only` mode. No active warn/strict for the
dia auto-linker fields.**

This doc captures **when and how** to flip `enforce_mode` from
`record_only` → `warn` → `strict` for a given `(target_table, field_name)`,
specifically for the rules I registered in PR #484 covering the dialysis
auto-linker writes.

## TL;DR — current state, why we're not ramping yet

| Field | Rules registered (PR #484) | Observed writes in `field_provenance` |
|---|---|---|
| `dia.properties.medicare_id` | 6 sources, priorities 20-90 | **0** |
| `dia.medicare_clinics.property_id` | 6 sources, priorities 20-90 | **0** |
| `dia.leases.property_id` | 1 source, priority 30 | **0** |

The rules exist. The writes are happening (hundreds per day from auto-linkers + manual reviews). But none of those writes flow through `lcc_merge_field()`, so `field_provenance` stays empty for these fields and there's nothing for warn/strict mode to observe.

**Flipping warn/strict today changes nothing** — because the integration gap means no events reach the priority engine in the first place.

## What `lcc_merge_field` does (quick recap)

Per `supabase/migrations/20260425210000_lcc_field_provenance_and_priority.sql`:

1. Caller passes `(workspace, target_database, target_table, record_pk, field_name, value, source, source_run_id, confidence)`
2. Function looks up the rule in `field_source_priority` by `(target_table, field_name, source)`
3. Logs the attempt to `field_provenance` (append-only)
4. Returns a decision: `write` / `skip` / `conflict` / `superseded`
5. **In `record_only` mode** the caller is supposed to use the decision purely as audit. The actual write happens regardless.
6. **In `warn` mode** the JS-side helper logs `[field-provenance:warn] skip on dia.properties.medicare_id record=12345 (manual_verify priority 20 < auto_link_high_confidence priority 60)` to function logs. Still no behavior change.
7. **In `strict` mode** the helper short-circuits the write entirely.

The dialysis auto-linkers are SQL functions in `dialysis.public`. They write directly to `properties.medicare_id` and `medicare_clinics.property_id`. None of them call back to LCC Opps' `lcc_merge_field`. So there are no audit rows for the priority engine to consult.

## Two integration paths (pick one before ramping)

### A. Cross-database HTTP RPC from each dialysis function (synchronous)

Every `apply_property_link_outcome` call POSTs to LCC Opps `/rest/v1/rpc/lcc_merge_field` via `pg_net.http_post()`. Wait for the decision, write or skip based on it.

| Pros | Cons |
|---|---|
| Decisions block writes in real time (strict mode actually enforces) | Adds 100-300ms latency to a hot SQL path |
| One integration point per write | Cross-DB failure surface — if LCC Opps is down, dia auto-linker stalls |
| Works with `pg_net` extension already on Dialysis | Needs LCC service-role key in Dialysis Vault |

### B. Periodic LCC-side ingest from `research_queue_outcomes` (asynchronous)

A 5-minute LCC Opps cron pulls recent outcome rows via the `data-query` proxy and replays each as a `lcc_merge_field` call.

| Pros | Cons |
|---|---|
| Decoupled — dia stays fast, no cross-DB dep at write time | Lag (up to 5 min) before audit is current |
| LCC failures don't break dia | Replay logic needs to track last_processed_outcome_id |
| Fits existing cron infrastructure | Two writers (the auto-linker + the ingest) producing the same audit trail — confusing |

### C. Dialysis-side trigger with pg_net (asynchronous)

Trigger on `properties.medicare_id` UPDATE (and others) calls `lcc_merge_field` via `pg_net` fire-and-forget. Decision comes back later as a row in `field_provenance` but isn't consulted at write time.

| Pros | Cons |
|---|---|
| Single integration point per table, covers all writers | Same async lag as B |
| Less code than B (no replay logic) | `pg_net` failures silently drop audit events |
| | Can't enforce strict mode (decision arrives after the write) |

## Recommended sequence

Don't ramp blindly. Walk this:

1. **Confirm warn/strict will actually do something for this field.** Run:
   ```sql
   SELECT count(*) FROM v_field_source_priority_unobserved
    WHERE target_table = 'dia.properties' AND field_name = 'medicare_id';
   ```
   If = number of rules registered → no writes are being observed →
   ramp is a no-op. STOP and pick an integration path first.

2. **Pick an integration path.** Option B is the cheapest experiment.
   Add a 5-min cron that replays the last 5 minutes of
   `research_queue_outcomes` as `lcc_merge_field` calls. If `field_provenance`
   stays empty, the integration is broken; debug.

3. **Wait 24h for `field_provenance` to populate.** Verify
   `v_field_provenance_unranked` doesn't surface unexpected sources.

4. **Flip ONE rule to `warn`.** Start with the highest-priority rule
   (priority 20 = `manual_verify`). Watch Vercel function logs for
   `[field-provenance:warn]` lines. They should fire only on conflicts
   (e.g. an auto_stub overwriting a manual_verify) — which should be 0
   under healthy operation.

5. **Wait another week.** If 0 warn lines fire, flip the rule to `strict`
   for actual enforcement. If warn lines fire, audit each — they're real
   conflicts that should be either tolerated (loosen rule) or fixed
   (enforce now).

6. **Repeat for the next priority band.** Don't bulk-flip.

## Indicators that say "actually ramp this now"

The cheapest version of the priority system is no good unless one of these is true:

- A **second writer** is producing conflicting values for the same field. Today there's only one writer per field for the auto-linker rules — the constraint enforces single-write semantics.
- A **regression risk** — a new ingestion source that could clobber confirmed manual data.
- A **compliance / audit requirement** — needing a paper trail of which source set this field, when, with what confidence.

None of those apply today. The `field_source_priority` rules I registered in PR #484 are **scaffolding for future enforcement**, not active enforcement.

## Useful queries

```sql
-- Rules registered but never exercised
SELECT * FROM v_field_source_priority_unobserved
WHERE target_table LIKE 'dia.%';
-- Was 13 (all my PR #484 rules) at time of writing.

-- Field writes happening WITHOUT a priority rule (the inverse)
SELECT * FROM v_field_provenance_unranked;

-- Current enforce_mode distribution
SELECT enforce_mode, count(*)
FROM field_source_priority
GROUP BY enforce_mode;
-- record_only: 649 / warn: 46 / strict: 6  (as of 2026-04-29 EOD)
```

### Active strict rules (as of 2026-04-29)

> **Phase-5 regression note.** Through the end of 2026-04-29 the
> JS-side strict-mode gate (`shouldWriteField` / `filterByFieldPriority`
> in `api/_shared/field-priority-guard.js`) was a silent no-op: it
> called `lcc_merge_field` with `_*`-prefixed RPC keys but the SQL
> function's parameters use `p_*`. PostgREST returned 404 on every
> call, the catch handler returned `{decision: 'no_rule', write: true}`,
> and writers proceeded regardless of the rule's `enforce_mode`.
> **Provenance audit was correct** (the separate inline
> `recordFieldProvenance` callers in `sidebar-pipeline.js` +
> `intake-promoter.js` use `p_*` and recorded 200+ skip / conflict
> rows correctly), but **strict mode itself never blocked any
> writes**. Fixed in PR #519 alongside the FU6 replay's same-shape
> bug. Skip / conflict counts in the table below are the registry's
> *attempted-write* counts; they were **logged, not blocked**.

| target_table | field | source | observed behavior |
|---|---|---|---|
| `dia.contacts` | `contact_email` | `costar_sidebar` | 205 skips, 17 conflicts logged over 2 days (would-have-been blocked) |
| `dia.leases` | `expense_structure` | `costar_sidebar` | 66 skips, 8 conflicts logged |
| `dia.leases` | `lease_expiration` | `costar_sidebar` | 69 skips, 0 conflicts |
| `dia.leases` | `lease_start` | `costar_sidebar` | 61 skips, 3 conflicts logged |
| `dia.leases` | `leased_area` | `costar_sidebar` | (active) |
| `dia.leases` | `rent_per_sf` | `costar_sidebar` | (active) |

**Now that PR #519 is deployed, those 6 rules actually block writes.**
Implications:

- The next CoStar refresh that tries to overwrite an OM-confirmed
  `lease_start` / `lease_expiration` / `expense_structure` /
  `leased_area` / `rent_per_sf` value will be silently dropped at
  the field level. The sidebar continues writing the rest of the
  fields. Refresh telemetry stays unchanged in the LCC UI; only the
  newly-blocked column stays at its prior (higher-trust) value.
- If any of these 6 rules turn out to over-block in practice
  (e.g. costar refreshes that *should* be allowed because the
  prior value was stale or wrong), demote the rule from `strict`
  back to `warn` rather than tweaking the priority numbers.

## Logical gap captured

Many of the existing rules from earlier phases are also unobserved
(503 total in `v_field_source_priority_unobserved`, not just my 13).
This suggests `lcc_merge_field` is undercovered across the system, not
just on dia auto-linkers. A larger audit pass would identify which
JS writers should already be calling it but aren't.

### Audit pass findings (2026-04-29)

A first audit grouped unobserved rules by `(target_table, source)` and
identified two distinct kinds of unobserved rules:

1. **Sources with no JS writer at all** — `manual_edit`,
   `lease_document`, `salesforce`, `cms_chain_org`, `recorded_deed`.
   These are scaffolding for future writers. ~85% of the 503 rows.
   Each one is its own integration project (manual edits would need
   an LCC UI hook into `lcc_merge_field`; CMS chain reporting would
   need the dialysis CMS sync to call out to LCC; etc.).

2. **Active writer that just isn't covered for some fields** — was the
   case for `om_extraction × dia.properties.{tenant, building_size,
   land_area, anchor_rent_source}`. The Phase 2.1 instrumentation
   loop in `intake-promoter.js` had branches for the original
   2026-04-25 set of fields but never got updated when later patches
   added those four fields to `promoteDiaPropertyFromOm`. **Fixed in
   PR #494** along with two registry typos (`dia.properties.land_acres`
   → `land_area`, missing `anchor_rent_source` rules).

For new fields added to a writer, check the corresponding
provenance loop. If you're patching a column the writer didn't
patch before, you need a branch in the provenance call too.

### Warn-mode triage (2026-04-29 EOD)

After ~48h of warn-mode observation across 46 rules, three groups
emerged:

#### Safe ramp candidates (warn → strict)

These have produced **zero conflicts** across 80-125 writes each over
~46h. The costar_sidebar values match what was already there, so
strict mode would be a no-op except as a guardrail against future
regressions:

| target_table | field | writes | conflicts |
|---|---|---|---|
| `dia.deed_records` | `recording_date` | 111 | 0 |
| `dia.deed_records` | `deed_type` | 110 | 0 |
| `dia.deed_records` | `grantee` | 125 | 0 |
| `dia.deed_records` | `grantor` | 102 | 0 |
| `dia.deed_records` | `consideration` | 82 | 0 |
| `dia.deed_records` | `document_number` | 125 | 0 |
| `dia.tax_records` | `tax_year` | 97 | 0 |
| `dia.parcel_records` | `county` | 98 | 0 |
| `dia.parcel_records` | `apn` | 110 | 0 |

Recommend ramping to strict after one more week of zero conflicts.

#### Investigate-before-ramping (high-volume conflicts)

These produced **20+ conflicts** in 2 days. Either the priority is
wrong (costar should win), or the writers are racing on legitimately
distinct values, or strict-mode would block real data updates:

| target_table | field | source | writes | skips | conflicts |
|---|---|---|---|---|---|
| `dia.contacts` | `contact_name` | `costar_sidebar` | 547 | 208 | **213** |
| `dia.contacts` | `company` | `costar_sidebar` | 221 | 179 | 74 |
| `dia.leases` | `tenant` | `costar_sidebar` | 477 | 92 | 70 |
| `dia.available_listings` | `last_price` | `costar_sidebar` | 162 | 67 | 57 |
| `dia.available_listings` | `initial_price` | `costar_sidebar` | 162 | 67 | 57 |
| `dia.properties` | `year_built` | `costar_sidebar` | 217 | 110 | 53 |
| `dia.available_listings` | `current_cap_rate` | `costar_sidebar` | 155 | 66 | 47 |
| `dia.available_listings` | `initial_cap_rate` | `costar_sidebar` | 155 | 66 | 47 |
| `dia.properties` | `lot_sf` | `costar_sidebar` | 135 | 88 | 49 |

Spot-check 10-20 conflict rows from each before deciding. The
`v_field_provenance_actionable` view exposes both the attempted and
current values, which is the relevant comparison.

#### Don't ramp (legitimate update paths)

`assessed_value`, `annual_rent`, `parcel_number` produce conflicts
that look like legitimate annual updates. Strict mode here would
block real refreshes. Keep as warn (or `record_only`) until a
different mechanism handles versioned updates.

### `matched_property_id` is intentional, not a logical gap

`agency_debt_programs.matched_property_id` and
`federal_loan_records.matched_property_id` use a column name distinct
from the standard `property_id` because the linkage is fuzzy /
confidence-scored rather than a strong FK. The merge function's
special-case for these two columns is correct — keep it. Don't
rename them to `property_id`.

---

*Author: Claude Code (claude/field-source-priority-ramp-plan-PGmsy).
Migration that registered the 13 rules: LCC PR #484. Migration that
added v_field_source_priority_unobserved: PR #490.
Audit-pass findings + Phase 2.1 coverage fix: PR #494.
Schema-validity check (catches column-name typos automatically): PR #502.
Warn-mode triage + current-state refresh: this PR.*
