# LCC Round 2 Audit Findings — 2026-05-19

**Companion to:** `LCC_Holistic_Audit_2026-05-17.docx` (63 findings) and `AUDIT_PROGRESS.md` (33 QA passes closed)
**Owner:** Scott Briggs
**Scope:** New findings NOT covered by the original 63-finding audit. Four parallel deep-dives ran on: (X) cross-DB invariants & orphans, (W) silent failures in writers added/modified since 2026-05-17, (L) learning loops, (M) Microsoft 365 connective tissue.
**Verification:** Read-only code + grep + migration inspection. The four findings marked ✓ Verified in this doc were spot-checked against the live code; the remainder are agent observations awaiting confirmation in the next pass.

## Status legend

- 🟦 **PENDING** — not started
- 🟨 **IN PROGRESS** — branch open
- 🟧 **REVIEW** — code complete
- ✅ **DONE** — merged + verified

---

## Top 7 priority queue for Round 2

| # | ID | Severity | Title | Closes | Effort |
|---|----|----------|-------|--------|--------|
| 1 | R2-X-2 | CRITICAL | `dia_merge_property` doesn't repoint 7+ FK child tables | data integrity | 1d |
| 2 | R2-W-1 / W-2 | CRITICAL | QA-22 + QA-24 canonicalize triggers bypass `field_provenance` | provenance integrity | 0.5d |
| 3 | R2-W-6 | HIGH | `diaQueryAll` still parallel after QA-33 reverted gov mirror | perf cliff | 0.25d |
| 4 | R2-L-1 | HIGH | `evaluateTemplateHealth` never scheduled — no learner consumes sends | learning loop | 0.5d |
| 5 | R2-M-5 | HIGH | Weekday daily briefing only posts to Teams (no email) | proactive delivery | 0.5d |
| 6 | R2-M-3 | HIGH | Calendar bridge is read-only — LCC can't write back invites | auto-schedule blocker | 1d |
| 7 | R2-X-3 | HIGH | SF id never back-written to dia.contacts.salesforce_id / gov.true_owners.sf_account_id | dashboard undercount | 0.5d |

Items 1, 2, 3 are the "stop the bleeding" set — every day they stay open, more silent data drift accumulates. Items 4-7 are the connective-tissue items that convert capability into user-visible value.

---

## Deferred follow-ups surfaced by the Round 2 patch work

Closing the Top 7 created a second tier of follow-up findings that were inlined in the closeouts. Surfacing them here so they're tracked alongside the originals rather than buried in patch notes. None are blocking the Top 7 closes; all are graduations of "now that the data plane is in place, here's the polish layer."

| ID | Parent | Severity | Title | Status |
|----|--------|----------|-------|--------|
| **R2-X-2b** | R2-X-2 | HIGH | `gov_merge_property` has the runtime FK loop already, but no MV refresh today (none derives from gov.properties yet). Mirror the dia pattern when one is added. | 🟦 PENDING |
| **R2-W-1b** | R2-W-1 | HIGH | `lcc-provenance-event-flush` cron — drain `dia.provenance_event_log` → LCC Opps `field_provenance` via `lcc_merge_field`. Batched, idempotent, every 15 min. | 🟦 PENDING |
| **R2-W-2b** | R2-W-2 | HIGH | Same flush cron for `gov.provenance_event_log`. One cron drains both (it's the same Edge handler with `domain=both`). | 🟦 PENDING |
| **R2-W-6b** | R2-W-6 | MEDIUM | Throttled-parallel pagination (concurrency=4) for both `govQueryAll` and `diaQueryAll`. QA-33's noted follow-up — gets most of the parallel win without the perf cliff. | 🟦 PENDING |
| **R2-L-1b** | R2-L-1 | MEDIUM | Templates admin tab trend sparkline reading the last 13 weeks of `template_health_history`. Defer until table has >3 rows. | 🟦 PENDING |
| **R2-L-1c** | R2-L-1 | MEDIUM | Daily briefing alert when current week's `needs_revision_count` exceeds last week's by >20%. Depends on D-3 + R2-L-1 history accumulating. | 🟦 PENDING |
| **R2-M-3b** | R2-M-3 | HIGH | LCC outbound caller for the calendar-write flow — `Schedule meeting` button on `detail.js` + `?action=schedule_meeting` in `api/operations.js` that builds the payload and POSTs to `OUTLOOK_CALENDAR_WRITE_FLOW_URL`. | 🟦 PENDING |
| **R2-M-3c** | R2-M-3 | HIGH | `?action=record_calendar_invite` handler in `api/operations.js` — receives PA callback, patches `touchpoint_cadence.last_calendar_event_id`, advances cadence via `recordTouchOutcome('meeting')`. | 🟦 PENDING |
| **R2-M-3d** | R2-M-3 | MEDIUM | Conflict-detection prefix in the PA flow — query `GetEventsCalendarViewV2` for the request window, return 409 if any existing event overlaps. | 🟦 PENDING |
| **R2-M-3e** | R2-M-3 | MEDIUM | Bidirectional sync — when the user moves or cancels the Outlook event, propagate the change back to `touchpoint_cadence` via the existing hourly pull. | 🟦 PENDING |
| **R2-M-5b** | R2-M-5 | LOW | Shrink the weekday Teams card to a one-liner that links to the email (avoid duplicate-content inbox fatigue). | 🟦 PENDING |
| **R2-M-5c** | R2-M-5 | LOW | PTO/pause switch via `user_settings.briefing_pause_until`. | 🟦 PENDING |
| **R2-M-5d** | R2-M-5 | LOW | Unify Sat/Sun + weekday flows into a single `LCC-Briefing-Daily` flow with day-of-week branching. | 🟦 PENDING |
| **R2-X-3b** | R2-X-3 | MEDIUM | Collision-review queue — when `backwriteSfIdToDomain` matches >1 candidate, surface in a `v_sf_backwrite_collisions` view instead of silently skipping. | 🟦 PENDING |
| **R2-X-3c** | R2-X-3 | MEDIUM | SF-id mismatch detection — when the bridge sees a payload for an entity whose denormalized column already holds a DIFFERENT SF id, log to `data_corrections` instead of silently skipping. | 🟦 PENDING |
| **R2-X-3d** | R2-X-3 | LOW | One-shot historical backfill via the new `backwriteSfIdToDomain` helper in batch mode for entities created since Round 76ak. | 🟦 PENDING |
| **R2-X-3e** | R2-X-3 | LOW | Same back-write pattern for `dia.recorded_owners` if/when a SF id column is added (today the table has neither `salesforce_id` nor `sf_account_id`). | 🟦 PENDING |

Detail and rationale for each is captured in the closeout block of the parent finding at the bottom of this doc.

---

# Scope X — Cross-DB invariants & orphans

The original audit's D-15 caught the "172 orphaned assets in 14 days" pattern. Round 2 traces it to specific *causes* — merge functions that lag behind schema growth, and writers that write to one side of a two-sided invariant.

## R2-X-1. [HIGH] `lcc_merge_log_reconcile` only repoints `entity_type=asset`, leaving person/organization metadata orphans

**Status:** 🟦 PENDING

**Evidence:** `api/admin.js:254` — the merge-log reconcile cron filters `entity_type=eq.asset` and only scans `metadata->>domain_property_id` and `metadata->_pipeline_summary->>domain_property_id`. After a dia/gov property merge, entities with `entity_type=person` (broker contacts) or `entity_type=organization` (owner LLCs) whose metadata carries `domain_contact_id` / `domain_owner_id` referencing the dropped row are silently left dangling.

**Impact:** Re-promotes link to the kept property; old person/organization entities accumulate as stale duplicates. Cross-domain "all-deals-by-this-broker" queries see fragmented history. Compounds with A-8 (cross-domain contact dedupe missing).

**Fix:** Drop the `entity_type=eq.asset` filter (or add sibling reconcile passes for `person` and `organization` with the appropriate JSONB metadata keys). Audit which metadata keys are in active use (`domain_contact_id`, `domain_owner_id`, `domain_lease_id`, `domain_sale_id`) and expand the RPC to cover all of them.

## R2-X-2. ✓ Verified · [CRITICAL] `dia_merge_property` doesn't repoint financial / loan / queue child tables

**Status:** 🟧 REVIEW — branch `audit/r2-x2-dia-merge-property-fk-coverage`, migration `20260519100000_dia_round_76r2_x2_merge_property_complete_fk_coverage.sql`. See closeout at bottom of doc.

**Evidence:** `supabase/migrations/20260425240000_dia_property_merge_candidates_and_helper.sql:96-128` — the merge function repoints 9 tables (leases, available_listings, sales_transactions, contacts, ownership_history, parcel_records, tax_records, listing_change_events, property_public_records) then `DELETE FROM properties WHERE property_id = p_drop_id`. The schema has grown since the function was written; the following property_id-keyed tables are NOT in the repoint list:

- `cap_rate_history` — derived cap rate ledger (sales/listings/sale_events all write here via triggers); orphaned rows produce phantom cap rates against a deleted property.
- `loans`, `loan_snapshots`, `loan_commentary`, `loan_top_tenants` — CMBS Round 76ek introduced these; loan history vanishes from the kept property.
- `property_financials` + `expense_line_items` — Round 76ek.a + 76ek.e CMBS financials. Same risk class as the gov.property_financials shadow that caused Round 76ek.k.
- `llc_research_queue.linked_property_id` (Round 76ek.b) — queue rows lose their value anchor.
- `ownership_research_queue.property_id` — same.
- `field_provenance.record_pk_value WHERE target_table='properties'` — provenance ghosts pointing at a deleted property_id (overlaps with R2-X-5).

**Impact:** Every successful merge silently strands financial records, loan snapshots, and research-queue value anchors. Cap-rate analytics over the merge boundary become incorrect. Each merge event = 50-200+ stranded child rows.

**Fix:** Run a `pg_catalog` audit of every public table with a `property_id` FK; extend `dia_merge_property` (and the gov mirror, if it exists — see R2-X-2b) to repoint each. Add a CI guard: a migration that adds a property_id column without updating the merge function fails pre-deploy. Best long-term: replace the hand-coded UPDATE list with a `pg_get_constraintdef` loop that discovers FKs at runtime.

### R2-X-2b. [HIGH] Gov mirror — is there a `gov_merge_property` function with the same gap?

**Status:** 🟦 PENDING

**Evidence:** Search `supabase/migrations/government/` for a merge helper. If absent, the LCC merge UI on gov uses a different path (likely raw entity-side merge) that doesn't repoint domain children at all.

**Fix:** Either build a `gov_merge_property` symmetrical to dia, or wire the existing path through a shared SQL helper.

## R2-X-3. ✓ Verified · [HIGH] SF id back-write never reaches dia/gov denormalized columns

**Status:** 🟧 REVIEW — branch `audit/r2-x-3-sf-id-backwrite`. `backwriteSfIdToDomain` helper added to bridge-handlers-salesforce.js. See closeout at bottom of doc.

**Evidence:** `api/_shared/bridge-handlers-salesforce.js:246-298` — when an SF Contact lands via webhook, the code (a) writes `external_identities` via `linkSalesforce`, (b) writes `unified_contacts.sf_contact_id` on LCC Opps. It does NOT PATCH `dia.contacts.salesforce_id` (column exists per `20260428040000_dia_round_76ak_column_migration.sql`) or `gov.true_owners.sf_account_id` (column exists per QA-25 migration's WHERE clause). Same gap for `entity.upsert` at line 212.

**Impact:** Dashboards that filter on the domain-side column (instead of querying `external_identities`) silently undercount SF-linked records. The QA-25 "Unprospected Owners" widget on gov reads `WHERE t.sf_account_id IS NULL` — every SF link that lands via the bridge but doesn't PATCH the denormalized column is misclassified as unprospected. The metric is wrong by the back-write gap.

**Fix:** After `linkSalesforce` succeeds, PATCH the corresponding dia/gov row with the SF id through `lcc_merge_field` (source=`salesforce_bridge`, priority=20). Add coverage test: every entity with an `external_identities` row of `system='salesforce'` must have the denormalized column populated on the linked domain record.

## R2-X-4. [MEDIUM] `unified_contacts` (LCC Opps) refresh discipline unclear

**Status:** 🟦 PENDING

**Evidence:** Neither `intake-promoter.js` nor `contacts-handler.js` issues `REFRESH MATERIALIZED VIEW unified_contacts` after contact INSERT, and there is no NOTIFY-driven refresh trigger that grep finds. If `unified_contacts` is an MV, there's a staleness window between domain INSERT and UI render. If it's a regular view, it may not filter `deleted_at IS NULL`.

**Impact:** Newly-created contacts may not appear in `/api/queue?view=my_work` immediately, or soft-deleted contacts may still appear. C-6 covers the empty-vs-error confusion at the UI; this is the data-staleness sibling.

**Fix:** Determine which it is (`\d+ unified_contacts` in psql or `pg_matviews` query). If MV, schedule `REFRESH MATERIALIZED VIEW CONCURRENTLY unified_contacts` every 5 min (mirror `mv_work_counts` pattern), or wire a trigger on the underlying tables. If regular view, add `WHERE deleted_at IS NULL` to its definition. Document the choice in `CLAUDE.md`.

## R2-X-5. [MEDIUM] `field_provenance` rows orphan when their target record is deleted

**Status:** 🟦 PENDING

**Evidence:** QA-25 deleted 350 unrecoverable sales rows from `dia.sales_transactions`. QA-32 deleted test artifacts. The original Round 76co bulk-delete of 350 sales for sale_date=NULL also happened. None of these cleanups touched `field_provenance` rows referencing those `record_pk_value`s. The FK is by *value*, not by foreign key constraint (provenance is keyed on `(target_database, target_table, record_pk_value, field_name)` — a composite string key, not a SQL FK), so DELETE doesn't cascade.

**Impact:** Provenance ghosts accumulate. `v_field_provenance_current` may return values for deleted records. When Phase 3 flips more rules to strict mode, ghost provenance can block writes for newly-recreated records at the same `record_pk_value`. Same risk class as A-3 (writes recorded for failed PATCHes), different timing.

**Fix:** Add a nightly cleanup job that LEFT JOINs `field_provenance` against the target table for the top dia/gov tables and DELETEs rows where the target no longer exists. Cap cleanup at 10k rows/night to avoid replication storms. Alternatively, document that provenance is append-only and add an `is_active` flag set by the cleanup job.

## R2-X-6. [LOW] `lcc_merge_log_reconcile` dry-run misses future JSONB FK paths

**Status:** 🟦 PENDING

**Evidence:** `api/admin.js:254-256` — the count query searches only `metadata->>domain_property_id` and `metadata->_pipeline_summary->>domain_property_id`. Future code may add `metadata.related_properties[]` (an array) or `metadata.history[]` blocks — neither will be discovered by the dry-run, leading to inaccurate "would patch N entities" estimates.

**Fix:** Parameterize the JSONB path list. Add a comment in `CLAUDE.md` noting that any new metadata key carrying a domain FK must be added to the reconcile path list.

---

# Scope W — Silent failures in writers added/modified since 2026-05-17

The original audit closed before the QA-22..QA-33 batch landed. Round 2 spot-checked the new SQL/JS for the same failure classes the original audit catalogued (provenance bypass, ungated readers, perf regression).

## R2-W-1. ✓ Verified · [CRITICAL] QA-22 `canonicalize_davita_brand` BEFORE trigger silently rewrites `properties.tenant` with no `field_provenance` record

**Status:** 🟧 REVIEW — branch `audit/r2-w-1-w-2-provenance-event-log`. See closeout at bottom of doc.

**Evidence:** `supabase/migrations/dialysis/20260518200000_dia_qa22_davita_brand_casing.sql:37-51`:
```sql
CREATE OR REPLACE FUNCTION public.properties_tenant_brand_canonicalize_trg()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant IS NOT NULL THEN
    NEW.tenant := public.canonicalize_davita_brand(NEW.tenant);
  END IF;
  RETURN NEW;
END;
$$;
```
No INSERT into `field_provenance`. Same risk class as A-16 (`auto_supersede_expired_leases` trigger).

**Impact:** When a downstream tool reads `tenant='DaVita'`, there is zero audit trail showing whether the value came from the canonicalizer trigger, an OM extraction, a county records dump, or a manual edit. The Phase 4 drift detector (`v_field_provenance_unranked`) cannot surface this writer. Strict-mode rules for `tenant` cannot be authored because the trigger is provenance-blind.

**Fix:** Either (a) add an AFTER trigger that records `lcc_merge_field` with `source='qa22_davita_brand_canonicalize'`, priority=15 (lower than any real ingest source so it never wins a conflict); or (b) restructure the canonicalizer as a normalization step the application calls explicitly before write, so the application is the recorded source.

## R2-W-2. ✓ Verified (via migration read) · [CRITICAL] QA-24 + QA-30 `canonicalize_agency` UPDATE backfill silently rewrites 1,217+ rows with no `field_provenance`

**Status:** 🟧 REVIEW — branch `audit/r2-w-1-w-2-provenance-event-log`. See closeout at bottom of doc.

**Evidence:** `supabase/migrations/government/20260518220000_gov_qa24_canonicalize_agency_veteran_singular.sql:91-95` re-canonicalizes 1,217 rows of `agency_canonical`. The QA-30 migration follow-up adds FBI hyphen + FCC, another 4 rows. Neither migration writes a provenance row tagged `qa24_veteran_affairs_singular_match` or `qa30_canonicalize_agency_fbi_fcc`.

**Impact:** Same as R2-W-1, applied to gov.

**Fix:** Same pattern — record the canonicalizer source in `field_provenance` so `agency_canonical` can be a strict-mode field with a real source ladder.

## R2-W-3. [MEDIUM] `canonicalize_davita_brand` regex misses mixed-case variants and lower-case `davita`

**Status:** 🟦 PENDING

**Evidence:** Migration line 26: `regexp_replace(coalesce(s, ''), '\m(davita|DAVITA|Davita)\M', 'DaVita', 'g')` — case-sensitive alternation. Misses `DaVITA`, `DAVita`, `dAvita`, etc. Also: the migration only touches `properties.tenant` — the QA-23 fix to `norm_text` was needed because `leases.tenant` (2,348 rows) and `medicare_clinics.facility_name` (6 rows) carried the same casing. QA-23 canonicalized at the view layer (`v_property_detail`, `v_lease_detail`, `v_ownership_current`, `v_ownership_chain`) but didn't backfill the source columns.

**Impact:** Future ingests writing "DaVITA" or "DAVita" land unnormalized; only the four QA-23 views catch them. Sales-comps exports, Salesforce reports, briefing tiles that read raw `leases.tenant` still show the bad casing.

**Fix:** (a) Broaden the regex to a case-insensitive lower(s) match. (b) Add the same trigger to `dia.leases.tenant` and `dia.medicare_clinics.facility_name`. (c) One-shot backfill for those two columns to match the properties.tenant backfill QA-22 ran.

## R2-W-4. [HIGH] `gov.js` still reads raw `.agency` in 6+ places after QA-24 fixed only the dashboard groupBy

**Status:** 🟦 PENDING

**Evidence:** Agent grep found `p.agency` (raw, no `|| .agency_canonical` fallback) at approximately `gov.js:6493, 6535, 8939, 8977, 8991, 9218` — in search filter blob, export headers, lease event tables, loan grouping, and detail-panel fallback. QA-24's fix at the Agency Breakdown groupBy was a single site fix; the canonicalizer's reach is incomplete.

**Impact:** Filters and exports show raw "Veterans Affairs" / "US Department of Veterans Affairs - 1" / "US Department of Veteran Affairs" even though the DB has clean `agency_canonical='VA'`. Same fragmentation symptom QA-24 was trying to fix.

**Fix:** Add a `_govGetAgency(p) → p.agency_canonical || p.agency || 'Unknown'` helper at the top of gov.js. Replace every bare `p.agency` reader with the helper. Optionally add an eslint rule banning raw `.agency` reads.

## R2-W-5. [MEDIUM] `v_prospect_targets` (gov) doesn't filter public REITs, federal agencies-as-owner, or aggregators

**Status:** 🟦 PENDING

**Evidence:** `supabase/migrations/government/20260518230000_gov_qa25_v_prospect_targets.sql:28-33` — gov version only filters `WHERE t.sf_account_id IS NULL AND prop_count > 0`. Dia version has an additional `is_operator_not_owner=TRUE` exclusion. Gov has no equivalent. The QA-11 LLC research queue had a public-REIT dedupe added for the same reason — public REITs aren't BD prospects, they're already on every broker's list.

**Impact:** The "Unprospected Owners" gov queue can fill with public REIT owners (already qualified) and federal agency owner entities, drowning the actionable single-asset / private-LLC prospects in noise.

**Fix:** Add a WHERE clause excluding `name ILIKE` patterns for known public REIT suffixes (Properties Trust, Realty Income, AR Global, Prologis, etc.) and federal entity patterns. Better: add an `is_public_reit` boolean to `true_owners` (mirror dia's `is_operator_not_owner`) and let the canonicalizer maintain it.

## R2-W-6. ✓ Verified · [HIGH] `diaQueryAll` still uses `Promise.all` after QA-33 reverted the gov mirror

**Status:** 🟧 REVIEW — branch `audit/r2-w-6-dia-parallel-pagination-revert`. See closeout at bottom of doc.

**Evidence:** `dialysis.js:174-188`:
```js
async function diaQueryAll(table, select, params = {}) {
  const pageSize = 1000;
  const firstPage = await diaQuery(table, select, { ...params, limit: pageSize, offset: 0, includeCount: true });
  ...
  const pages = [];
  for (let off = pageSize; off < total; off += pageSize) {
    pages.push(diaQuery(table, select, { ...params, limit: pageSize, offset: off }));
  }
  const others = await Promise.all(pages);   // ← unbounded parallel
  ...
}
```
QA-33 closeout (line 2917 of AUDIT_PROGRESS.md): "QA-27 (dia parallel) NOT reverted yet — need to probe dia separately."

**Impact:** Dia dashboard at risk of the same ~194s page-load + browser unresponsiveness that QA-33 just fixed on gov. Dia tables are smaller (medicare_clinics 8.5k, true_owners 3.4k) but if the same Phase 2 background-loaders accumulate, the multiplier still hurts.

**Fix:** Three options, pick one:
1. Revert `diaQueryAll` to a serial `while` loop matching the post-QA-33 `govQueryAll`.
2. Implement throttled-parallel (concurrency=4) on both `gov` and `dia` simultaneously — this was QA-33's noted follow-up.
3. Probe dia perf first with Chrome timings before committing to a fix direction.

Pair with the (currently absent) parallel-pagination probe on dia.

## R2-W-7. [LOW] Edge Function allowlist has no automated drift guard

**Status:** 🟦 PENDING

**Evidence:** `audit/supabase-advisor-allowlist.{dia,gov,lcc-opps}.json` files exist as snapshots. The Edge Function `supabase/functions/data-query/index.ts` GOV_READ_TABLES / DIA_READ_TABLES lists are maintained by hand. A migration that adds a new view (like QA-25's `v_prospect_targets`) requires manual allowlist edit; forget and the frontend silently 403s. QA-02 had to be hotfixed for exactly this reason.

**Fix:** Add a pre-deploy guard script that diffs the allowlist against `pg_views` (filtered to the `v_*` naming convention) and fails CI when a view exists in the DB but not in the allowlist (or vice-versa). Compare against `audit/supabase-advisor-allowlist.*.json` as the source of intent.

---

# Scope L — Learning loops & self-improvement

Several feedback systems are instrumented (writer logs events) but no learner consumes the events to adjust behavior. The system is observably-collecting but not yet self-improving.

## R2-L-1. ✓ Confirmed via grep · [HIGH] `evaluateTemplateHealth` exists but no cron schedule reads it

**Status:** 🟧 REVIEW — branch `audit/r2-l-1-template-health-weekly-cron`. See closeout at bottom of doc.

**Evidence:** `api/operations.js:2751` exposes `?_route=draft&action=health` (manual dashboard call). The function `evaluateTemplateHealth()` is implemented in `api/_shared/templates.js` and produces the weekly `lcc-template-health-weekly-latest.md` report. There is no `pg_cron` entry that calls this endpoint on a schedule; the report is regenerated by hand. Combined with D-3 (no `record_send` writer), the loop has neither input nor scheduled output.

**Impact:** Even if Phase 2 lands the `record_send` Power Automate flow (D-3 fix), no scheduled job ever re-evaluates template performance to flag underperformers, suggest variants, or auto-retire stale templates. Templates are a one-time write.

**Fix:** Add `pg_cron` entry `lcc-template-health-rollup` (weekly, e.g. Monday 06:00 UTC) that POSTs `/api/operations?_route=draft&action=health&persist=true`. Persist results to a `template_health_history` table. Surface trend data on the templates admin page.

## R2-L-2. [MEDIUM] `matcher_accuracy_rollup` is dashboard-only; matcher thresholds never auto-adjust

**Status:** 🟦 PENDING

**Evidence:** `supabase/migrations/20260422150000_staged_intake_feedback.sql` defines `compute_matcher_accuracy()` + `matcher_accuracy_stats`. `api/_handlers/intake-feedback.js:296` reads `v_matcher_accuracy_recent` for dashboards only. No code reads the rollup to adjust the matcher's confidence thresholds at `api/_shared/match-utils.js` (the 0.80 fuzzy / 0.60 embedding constants).

**Impact:** When approval rate for a rule consistently exceeds 90%, the rule could safely lower its threshold and catch more matches. When approval rate drops below 60%, the rule should tighten or be retired. Today the thresholds are constants forever.

**Fix:** Add a `matcher_rule_thresholds` table + a weekly job that reads the rollup, computes per-rule approval rates, and PATCHes the threshold within a guarded band (never below 0.55 or above 0.95). Log every adjustment for audit.

## R2-L-3. [MEDIUM] `field_source_priority` warn-mode rules never auto-graduate to strict

**Status:** 🟦 PENDING

**Evidence:** `supabase/migrations/20260426130000_field_source_priority_phase_3_warn_mode.sql:26+54` documents the intent: "Escalation path: after 7 days of clean warn-mode signal, flip these same rules to strict." No subsequent migration implements the graduation. 54+ rules sit in warn mode indefinitely.

**Impact:** Phase 3's intent — confidence-build into strict mode — is stuck at "trust me, eventually" forever. The provenance system is full-featured but its policy engine is half-armed.

**Fix:** Daily `lcc-field-priority-graduation` cron: for each rule in `enforce_mode='warn'`, query `field_provenance` for any decision='conflict' or 'skip' in the last 7 days; if zero, flip to `strict`. Surface graduations + downgrades on the daily briefing.

## R2-L-4. [MEDIUM] `cadence-engine.priority_tier` defaults to 'B' and never auto-adjusts

**Status:** 🟦 PENDING

**Evidence:** `api/_shared/cadence-engine.js:92` initializes every cadence to `priority_tier: 'B'`. `TIER_MULTIPLIERS` (lines 40-44) multiplies spacing by 1.0/1.0/1.0 — every tier is equivalent until something writes `priority_tier='A'` or `'C'`. Grep returns no UPDATE statement for `touchpoint_cadence.priority_tier` outside the initial seed.

**Impact:** Even after D-8's lead-scoring job (planned) lands, there's no automatic feed from engagement metrics to priority_tier. The tier is a dead column.

**Fix:** Pair with the planned D-8 lead-score job — once that exists, mirror the score onto `priority_tier` (score ≥80 → A, 40-79 → B, <40 → C). Also: replace TIER_MULTIPLIERS' uniform 1.0s with real differential spacing (A=tight, C=long).

## R2-L-5. [LOW-MED] Inbox `scoreItem` keyword weights are hard-coded forever

**Status:** 🟦 PENDING

**Evidence:** `api/_shared/briefing-data.js:103-156` — `scoreItem()` weights `DEAL_KEYWORDS +100`, `REVENUE_KEYWORDS +90`, etc. as compiled regex with literal weights. Promote/dismiss actions are written to `inbox_items.status` but no learner reads them to adjust the weights.

**Impact:** When Scott consistently dismisses items that scored 80+ as not actionable, the score function never learns. Briefing prioritization stays static against drift in Scott's actual day.

**Fix:** Log promote/dismiss as `signals` rows; weekly job clusters dismissed items' content vectors and surfaces a "consider downweighting" suggestion. Manual review for now; auto-adjust later when there's enough labeled data.

## R2-L-6. [LOW] `v_data_quality_summary` deltas not tracked over time

**Status:** 🟦 PENDING

**Evidence:** `v_data_quality_issues` + `v_data_quality_summary` exist as live views. No migration creates a `data_quality_snapshots` table that persists daily counts. Without a time-series, the user can't tell whether auto-supersede is shrinking `multi_active_lease` or whether new ingest is creating more issues than the triggers solve.

**Fix:** Daily cron writes `(date, issue_kind, count)` to a `data_quality_snapshots` table. Surface a sparkline per issue_kind on the Ops Admin page so trends are visible.

## R2-L-7. [LOW] AI extraction fallback chain is static — primary never adapts to recurring throttle

**Status:** 🟦 PENDING

**Evidence:** `api/_shared/ai.js` `invokeExtractionAI()` records `tried` array on each artifact's diagnostics but no job reads the diagnostics to adapt the chain order. If Claude (primary) throttles 30% of calls, the fallback is silently used 30% of the time and nobody notices until token spend is examined.

**Fix:** Weekly cron reads `staged_intake_items.raw_payload->'extraction_result'->'diagnostics'`, aggregates `ai_fell_back` rate per primary provider, and emits an `lcc_health_alerts` row when the rate exceeds 25%. Optionally PATCH the chain order automatically; conservative posture is to alert + recommend.

---

# Scope M — Microsoft 365 connective tissue

The pattern: Microsoft is a *data sink* (Outlook, calendar, To Do pull INTO Supabase) but not an *authoring surface* (LCC can't push meetings, tasks, or briefings out consistently).

## R2-M-1. [MEDIUM] No Power Automate flow captures Outlook Sent Items

**Status:** 🟦 PENDING

**Evidence:** `docs/architecture/flows/` directory contains 29+ flow specs. None matches a "sent items" or "record_send" trigger. The original audit D-3 proposed the flow; it remains unbuilt as of 2026-05-19.

**Impact:** Restates D-3 but confirms specifically that the proposed flow was never authored. The cadence-learning starvation is unchanged.

**Fix:** Build `LCC-OutlookSentItemCapture` flow per D-3's spec. Filter to items where Body or Subject contains a template-id signature. POST `/api/operations?_route=draft&action=record_send` with `template_id` + `cadence_id` extracted from the signature.

## R2-M-2. [LOW] Teams adaptive cards exist as templates but have no async dispatcher

**Status:** 🟦 PENDING

**Evidence:** `docs/architecture/teams_lcc_chat_adaptive_card.json` and `_error_adaptive_card.json` are inert JSON. The three Teams flows (`LCC Daily Briefing`, `Manual ForEach Post`, `HTTP-Postmessagechat`) post manually; no API endpoint dispatches cards on async events (e.g., "a high-value listing just landed").

**Fix:** Build `/api/teams-notify` endpoint that accepts `{card_type, context}` and posts to the appropriate Teams channel via Graph. Wire signals (e.g., `listing_created` with value > $20M) to auto-dispatch.

## R2-M-3. ✓ Confirmed via doc · [HIGH] Calendar bridge is one-way (Outlook → Supabase)

**Status:** 🟧 REVIEW (flow spec) — branch `audit/r2-m-3-outlook-calendar-write`. Flow spec at `docs/architecture/flows/lcc-outlook-calendar-write.md`. Loop closes after R2-M-3b (LCC outbound caller) + R2-M-3c (callback handler). See closeout at bottom of doc.

**Evidence:** `docs/architecture/flows/lcc-personal-calendar-sync.md` + `outlookcalendar-lcc-sync.md` both pull calendar events INTO Supabase hourly. `docs/architecture/lcc-microsoft-salesforce-pipeline-gap-analysis.md:line 37` explicitly states "Calendar is read from Outlook into Supabase; LCC cannot write or update Outlook calendar events." No `Create_calendar_event_(V2)` action exists in any flow.

**Impact:** The "auto-schedule meeting when cadence touch fires" workflow has no terminal action. Scott still creates every calendar invite manually. The cadence-engine's "schedule the call" step is conceptual.

**Fix:** Build `LCC-OutlookCalendarWrite` flow (trigger: HTTP POST from LCC, action: `Create_calendar_event_(V2)` in `shared_outlook` connector). Wire the cadence engine to POST when a touch advances to a phone/meeting step.

## R2-M-4. [MEDIUM] SharePoint OM folder watch never built

**Status:** 🟦 PENDING

**Evidence:** `docs/architecture/PHASE2_5_SHAREPOINT_EXTRACT.md` exists as a spec. No `When_a_file_is_created` flow in `docs/architecture/flows/` watches a SharePoint folder for new OMs.

**Impact:** When a broker shares an OM via SharePoint (common for institutional senders), Scott has to forward the email to trigger intake. The SharePoint upload event is invisible to LCC.

**Fix:** Build `LCC-SharePointOMMonitor` flow. Trigger on SharePoint file-created; POST to `/api/intake/stage-om` with `channel='sharepoint'`. Inherits the same `intake-om-pipeline` downstream.

## R2-M-5. ✓ Verified · [HIGH] Weekday daily briefing posts only to Teams; email goes only Sat/Sun

**Status:** 🟧 REVIEW — branch `audit/r2-m-5-weekday-briefing-email`. Flow spec at `docs/architecture/flows/lcc-weekday-briefing-email.md`. See closeout at bottom of doc.

**Evidence:**
- `docs/architecture/flows/lcc-daily-briefing.md` lines 11-14: Recurrence `Monday` to `Friday` → `Post_card_in_a_chat_or_channel` (Teams only).
- `docs/architecture/flows/lcc-morning-briefing.md` lines 11-14: Recurrence `Saturday`, `Sunday` → `Send_an_email_(V2)` (email only).

**Impact:** Mon-Fri, Scott only sees the briefing if he's in Teams. Sat-Sun, only if he's in email. There's no surface where he gets it both places, and if he's road-trip-only-on-phone Tuesday morning, the briefing may never reach him. Daily-briefing-as-flagged-failures dead-letter pane (R2-M-7) inherits this same gap.

**Fix:** Cheapest: change `lcc-daily-briefing` to ALSO `Send_an_email_(V2)` after the Teams post (or build a parallel `LCC-WeekdayBriefingEmail` flow on the same recurrence). Better: a single canonical `LCC-Briefing-Daily` flow that fans out to Teams + email + (optional) SMS based on a config table.

## R2-M-6. [MEDIUM] Flagged-email dedupe via filename, not content hash

**Status:** 🟦 PENDING

**Evidence:** `api/_shared/intake-om-pipeline.js:136-148` filters attachments by filename patterns (signature images, deed PDFs). The dedup key for the intake_id appears to be derived from filename + sender; if Scott flags the same email twice, or PA retries on a 5xx response, two staged_intake_items rows can land.

**Impact:** Inbox triage shows duplicate rows; downstream matcher catches the content dupe but the duplicate audit trail remains.

**Fix:** Compute `intake_id = sha256(workspace_id || sender_email || subject || body_sha256)`; `INSERT … ON CONFLICT(intake_id) DO NOTHING`. Power Automate retry on the same email is then idempotent.

## R2-M-7. [MEDIUM] Power Automate dead-letter pane is in-app only

**Status:** 🟦 PENDING

**Evidence:** `docs/architecture/power-automate-observability-standards.md:line 36` notes dead-letter is "RESOLVED 2026-05-14" with a `flow_run_failures` table populated by 26 flows' fault branches. The information surfaces only in the LCC briefing or via manual SQL. There is no Power Automate-native alert email.

**Impact:** When a flow hits its dead-letter branch on a Tuesday, the only signal is in the (Teams-only) weekday briefing — see R2-M-5. If Scott's not in Teams that morning, the failure is invisible until the weekend email rolls up.

**Fix:** Either (a) wire Power Automate's native flow-failure email alert (each flow's "Notify me if a flow run fails" toggle), or (b) make R2-M-5 fix mandatory so the weekday briefing reaches Scott's inbox.

---

# Cross-cutting themes (Round 2)

1. **Provenance integrity is at a turning point.** The original audit's A-3 + A-16 caught two failure classes (writes-recorded-for-failed-PATCHes, trigger-driven writes bypass provenance). Round 2's R2-W-1, W-2, X-5 show that ANY silent SQL writer (BEFORE trigger, backfill UPDATE, DELETE) needs a provenance record or a documented exemption. Without this discipline, Phase 3 / Phase 4 strict-mode rollout becomes structurally unsound. Recommend a pre-deploy guard: any migration with a BEFORE/AFTER trigger or a backfill UPDATE on a table covered by `field_source_priority` must include a paired `field_provenance` INSERT or document the exemption in a comment.

2. **Merge functions lag schema growth.** R2-X-2 + R2-X-2b show that the merge function written in April 2026 doesn't know about the loan / financials / queue tables added in May 2026 (Round 76ek). This will continue happening as new tables land. Recommend a runtime FK-discovery loop in the merge function instead of hand-coded UPDATE lists; or a CI guard that fails when an FK to `properties.property_id` is added without updating the merge function.

3. **Microsoft is half-wired.** R2-M-1, M-3, M-4, M-5 are all "feature lands in LCC but doesn't reach Scott where he works." The user objective explicitly calls out "intelligently connected" — today it's intelligently collected but only some of the time delivered. The lowest-cost intervention is R2-M-5 (fan-out the daily briefing to both Teams + email every day).

4. **Self-improvement loops are instrumented, not closed.** R2-L-1 through R2-L-7 all share the same shape: a writer fires, the data lands in a table or view, no scheduled learner reads it to adjust a parameter. Recommend a pattern: every "learning loop" gets a paired cron + a target parameter table + a daily delta log. Without this discipline, every loop will look closed in code review and be open in practice.

---

# 30-day proposed sprint plan (Round 2)

Pairs with the original 90-day roadmap; these items either close gaps the original missed or precede dependent items that the original deferred.

## Sprint 1 — Provenance integrity (Week 1)
- R2-X-2 — Extend `dia_merge_property` for the 7+ missing child tables; add `gov_merge_property` if absent (R2-X-2b).
- R2-W-1 + R2-W-2 — Add `field_provenance` writes to QA-22 trigger and QA-24/QA-30 backfills.
- R2-X-5 — Nightly `field_provenance` cleanup for deleted rows.

## Sprint 2 — Perf + UI canonicalization (Week 2)
- R2-W-6 — Revert or throttle-parallelize `diaQueryAll`.
- R2-W-4 — `_govGetAgency(p)` helper; sweep all gov.js raw-`.agency` readers.
- R2-W-3 — Broaden DaVita regex; add trigger to `leases.tenant`.

## Sprint 3 — Bridges out (Week 3)
- R2-M-5 — Daily briefing fan-out to email every day.
- R2-M-3 — Calendar write-back flow.
- R2-X-3 — SF id back-write to dia.contacts.salesforce_id + gov.true_owners.sf_account_id.

## Sprint 4 — Close the learning loops (Week 4)
- R2-L-1 — `evaluateTemplateHealth` cron.
- R2-L-3 — `field_source_priority` graduation cron.
- R2-L-7 — AI fallback rate alerting.

After Sprint 4, every loop the original audit specced as "input then learner" should have both halves wired.


---

# Closeout log

## R2-X-2 closeout (2026-05-19) — R2-X-2 dia_merge_property complete FK coverage 🟧 REVIEW
- **Branch:** `audit/r2-x2-dia-merge-property-fk-coverage`
- **Patch:** `audit/patches/R2-X-2-dia-merge-property-fk-coverage/apply.mjs`
- **Migration:** `supabase/migrations/dialysis/20260519100000_dia_round_76r2_x2_merge_property_complete_fk_coverage.sql`
- **Closes:** R2-X-2 (CRITICAL)
- **Pending:** R2-X-2b (gov merge_property MV refresh — gov has runtime FK loop already but no MV exists yet on gov; no migration needed today)

### Diagnosis (verified 2026-05-19)
`dia_merge_property` (Round 76be / 20260425240000) used a hand-coded 9-table
UPDATE list. Since April:

- Round 76ek (2026-05-08) added `loans` / `property_financials` (FK to properties).
- Round 76ek.j Phase 1 (2026-05-08) added `llc_research_queue` (FK to properties).
- `cap_rate_history`, `property_sale_events`, `property_intel`,
  `property_cms_link`, `property_cms_link_history`, `lease_extensions`,
  `lease_rent_schedule`, `staged_intake_matches`, `cm_features` all carry
  property_id columns added across the same period.

The gov mirror (`gov_merge_property`, Round 76be, 20260428290000) already
uses a runtime `pg_constraint` loop that auto-discovers every FK targeting
public.properties.property_id. The dia helper lagged behind.

### Fix
Ported the gov runtime-discovery pattern verbatim:

- Loop over `pg_constraint` rows where `contype='f'` and
  `confrelid='public.properties'::regclass`, EXECUTE format() per child to
  UPDATE the discovered column from p_drop_id → p_keep_id. Each per-child
  UPDATE in its own BEGIN/EXCEPTION block so a single RLS or missing-column
  edge case doesn't abort the whole merge.
- Recorded per-child row counts (and any SQLERRM) in the JSONB audit map.
- Added pre-flight existence check for both keep_id and drop_id so typos at
  call sites fail loudly instead of silently moving nothing.
- After the FK loop, REFRESH MATERIALIZED VIEW CONCURRENTLY
  `mv_property_value_signal` (QA-06's dia value-signal MV). Non-concurrent
  fallback if the CONCURRENTLY pre-req unique index isn't built yet.
- Bumped audit return shape with `merge_function_version` =
  `r2_x2_runtime_fk_discovery_2026_05_19` so callers can detect the new path.

### Verification (post-apply)
1. `grep -c "c.confrelid = 'public.properties'::regclass" supabase/migrations/dialysis/20260519100000_dia_round_76r2_x2_merge_property_complete_fk_coverage.sql` → 1
2. (Supabase MCP, dia) — sanity-check the FK discovery walks the expected universe:
   ```sql
   SELECT t.relname AS table_name, a.attname AS column_name
     FROM pg_constraint c
     JOIN pg_class      t ON t.oid = c.conrelid
     JOIN pg_namespace  n ON n.oid = t.relnamespace
     JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.properties'::regclass
      AND n.nspname = 'public'
    ORDER BY 1, 2;
   ```
   Expected: ≥14 rows (leases, available_listings, sales_transactions, contacts,
   ownership_history, parcel_records, tax_records, listing_change_events,
   property_public_records, loans, property_financials, llc_research_queue,
   cap_rate_history, property_sale_events, …). If the list is shorter than the
   prior hand-coded 9 tables, abort — the dia DB drifted.
3. (Smoke test on a staging copy) Pick two properties known to share an address
   and have child rows in each: a leases row, a loan, an llc_research_queue
   row, a cap_rate_history row. Call `dia_merge_property(keep, drop)` and
   assert all of those rows now point at keep and the drop properties row is gone.
4. After APPLY of the .sql via Supabase MCP, flip this entry's status from
   🟧 REVIEW to ✅ DONE in a follow-up commit and update the Top 7 table at
   the top of this doc.

### Risks considered
- **RLS denial inside the loop**: per-child SAVEPOINT means a single denial is
  surfaced in the audit JSONB but doesn't abort the merge — opposite of the
  prior hand-coded path where an unexpected EXCEPTION would have rolled back
  the whole merge. Audit JSONB key is `<table>.<col>_error`.
- **CASCADE FKs vs SET NULL**: the loop runs BEFORE the DELETE FROM properties,
  so it captures the row's true association with drop_id while the row still
  exists. ON DELETE SET NULL FKs (e.g. llc_research_queue.property_id) get
  re-pointed to keep_id instead of nulled. ON DELETE CASCADE FKs (e.g.
  property_financials, recorded_owners) — children are repointed first, so
  the subsequent DELETE no longer cascades into them.
- **MV refresh blocking**: CONCURRENTLY is non-blocking; the fallback non-
  concurrent path could in theory pause readers for the MV duration but only
  if the unique index is missing — a one-time edge case, not a recurring
  hazard.

### Out of scope (deferred follow-ups)
- **R2-X-2b (gov side):** gov already uses runtime FK discovery; no MV exists
  on gov today. When gov adds an MV that derives from properties, mirror this
  pattern. Add a CLAUDE.md note ("any future MV derived from gov.properties
  must be added to gov_merge_property's refresh list").
- **Provenance ghosts (R2-X-5):** the DELETE FROM properties still leaves
  field_provenance rows referencing the deleted property_id as ghosts. The
  Round 2 R2-X-5 finding (nightly cleanup cron) addresses this separately.
- **Non-FK property_id columns:** none currently exist on dia or gov per the
  pg_attribute survey on 2026-05-19. If a future writer adds a column named
  property_id WITHOUT a formal FK constraint, the loop will miss it — but
  this is the same gap the gov function has had since April and there are
  no live examples.

### Files changed
- `supabase/migrations/dialysis/20260519100000_dia_round_76r2_x2_merge_property_complete_fk_coverage.sql` (new)
- `audit/ROUND_

## R2-W-1 / R2-W-2 closeout (2026-05-19) — provenance event log + canonicalizer registry 🟧 REVIEW
- **Branch:** `audit/r2-w-1-w-2-provenance-event-log`
- **Patch:** `audit/patches/R2-W-1-W-2-provenance-event-log/apply.mjs`
- **Migrations (3):**
  - LCC Opps: `supabase/migrations/20260519110000_lcc_r2_w1_canonicalizer_source_registry.sql`
  - Dia: `supabase/migrations/dialysis/20260519110000_dia_r2_w1_provenance_event_log_qa22_trigger.sql`
  - Gov: `supabase/migrations/government/20260519110000_gov_r2_w2_provenance_event_log_qa24_qa30_backfill.sql`
- **Closes:** R2-W-1 (CRITICAL), R2-W-2 (CRITICAL)
- **Defers:** R2-W-1b / R2-W-2b (cross-DB flush cron — see Out of Scope below)

### Why three migrations

The original audit pointed out that `lcc_merge_field` lives on LCC Opps but
QA-22's trigger lives on dia and QA-24/QA-30's UPDATEs ran on gov. A row-level
trigger can't make a cross-DB RPC from inside a transaction. We addressed the
gap in three coordinated parts:

1. **LCC Opps** — registered three new sources in `field_source_priority`:
   `qa22_davita_brand_canonicalize`, `qa24_canonicalize_agency`,
   `qa30_canonicalize_agency`. All at priority 90 (record_only) — they're
   post-write normalizers and never compete with real ingest sources. Also
   updated the `priority` column COMMENT to document the new 90-99 band.

2. **Dia** — added `public.provenance_event_log` (target_database='dia_db')
   and rewrote `properties_tenant_brand_canonicalize_trg` to INSERT a log
   row whenever the canonicalizer actually rewrites NEW.tenant. Plus a
   single historical-marker row for the 2,646-row 2026-05-18 UPDATE.

3. **Gov** — added `public.provenance_event_log` (target_database='gov_db')
   and inserted two historical-marker rows (QA-24's 1,218 row impact,
   QA-30's 4 row impact). Gov has no canonicalize_agency trigger to upgrade
   today; the function is called from application code + one-shot
   migrations.

### Future writes are captured

After this patch lands, every future trigger-driven rewrite of
`dia.properties.tenant` writes an audit row to `dia.provenance_event_log`
with `old_value`, `new_value`, the `record_pk_value`, source, and a
`trigger_op` field so we can see whether the canonicalization happened on
INSERT or UPDATE. The flush cron (deferred — see Out of Scope) will drain
those rows into LCC Opps `field_provenance` so the Phase 3 strict-mode
rollout can be authored without surprise from invisible writers.

### Backward compatibility

- Existing application code paths that PATCH `dia.properties.tenant` are
  unchanged — the trigger still does the canonicalization and the application
  doesn't need to know about the new audit log.
- field_source_priority rows are `record_only` mode — they observe, do not
  block any write path.
- The historical-marker rows are visibly distinguished by
  `record_pk_value LIKE '<bulk_backfill_%>'` and a `metadata.kind` of
  `'historical_bulk_update_marker'` so the flush cron can choose either to
  emit them as bulk events on LCC Opps or to skip them.

### Verification (post-apply)

```sql
-- 1. LCC Opps: three new priority rows registered
SELECT target_table, field_name, source, priority, enforce_mode
  FROM public.field_source_priority
 WHERE source IN ('qa22_davita_brand_canonicalize','qa24_canonicalize_agency','qa30_canonicalize_agency')
 ORDER BY target_table, field_name, source;
-- Expected: 3 rows, all priority=90, enforce_mode='record_only'

-- 2. Dia: table created, trigger upgraded, backfill marker present
SELECT count(*) FROM public.provenance_event_log;  -- expect ≥1
SELECT recorded_at, source, record_pk_value, metadata->>'rows_affected' AS rows
  FROM public.provenance_event_log
 WHERE record_pk_value = '<bulk_backfill_QA22>';
-- Expected: 1 row, rows='2646'

-- 3. Gov: table created, two backfill markers present
SELECT recorded_at, source, record_pk_value, metadata->>'rows_affected' AS rows
  FROM public.provenance_event_log
 WHERE record_pk_value LIKE '<bulk_backfill_QA%>'
 ORDER BY recorded_at;
-- Expected: 2 rows (QA-24 rows='1218', QA-30 rows='4')

-- 4. Trigger smoke test on dia (use a known DaVita property)
SELECT property_id, tenant FROM public.properties
 WHERE property_id = <pick_one>;
UPDATE public.properties SET tenant = 'davita Test Site'
 WHERE property_id = <pick_one>;
SELECT property_id, tenant FROM public.properties
 WHERE property_id = <pick_one>;
-- Expected: tenant is now 'DaVita Test Site'
SELECT count(*) FROM public.provenance_event_log
 WHERE record_pk_value = '<pick_one>'::text
   AND source = 'qa22_davita_brand_canonicalize'
   AND recorded_at > now() - interval '1 minute';
-- Expected: 1 row
-- Then revert the test write.
```

### Out of scope (deferred follow-ups)

- **R2-W-1b / R2-W-2b: lcc-provenance-event-flush cron.** Drains
  `provenance_event_log` rows where `flushed_to_lcc_opps_at IS NULL` to
  LCC Opps `field_provenance` via a small HTTP handler that calls
  `lcc_merge_field` for each. Should be batched (e.g., 100 rows per tick)
  and idempotent (PATCH `flushed_to_lcc_opps_at` and increment
  `flush_attempt_count` on each attempt). pg_cron schedule on LCC Opps,
  `*/15 * * * *`. Deferred because we want at least one tick of
  observability on the log table before bridging to LCC Opps.

- **Gov canonicalize_agency trigger.** Today `canonicalize_agency` is called
  from app code + one-shot migrations. If we ever add a BEFORE INSERT/UPDATE
  trigger on `gov.properties.agency_canonical` (mirror of the dia QA-22
  pattern), upgrade that trigger function to write to `provenance_event_log`.

- **Dia QA-23 norm_text canonicalization in view layer.** QA-23 chained
  `canonicalize_davita_brand` into `norm_text` so views surface the canonical
  form even from upstream sources (`leases.tenant`, `medicare_clinics.facility_name`).
  Those reads are non-persisted — no provenance row is needed. But a future
  audit of "do view-layer canonicalizations introduce drift between view and
  base table" should consider whether to instrument them. Out of scope today.

### Files changed
- `supabase/migrations/20260519110000_lcc_r2_w1_canonicalizer_source_registry.sql` (new)
- `supabase/migrations/dialysis/20260519110000_dia_r2_w1_provenance_event_log_qa22_trigger.sql` (new)
- `supabase/migrations/government/20260519110000_gov_r2_w2_provenance_event_log_qa24_qa30_backfill.sql` (new)
- `audit/patches/R2-W-1-W-2-provenance-event-log/` (patch 

## R2-W-6 closeout (2026-05-19) — diaQueryAll parallel pagination revert 🟧 REVIEW
- **Branch:** `audit/r2-w-6-dia-parallel-pagination-revert`
- **Patch:** `audit/patches/R2-W-6-dia-parallel-pagination-revert/apply.mjs`
- **Files changed:** `dialysis.js` only (no SQL, no Edge Function, no allowlist)
- **Closes:** R2-W-6 (HIGH)

### Diagnosis (verified 2026-05-19)
QA-33 reverted gov's parallel-pagination QA-26 because it caused ~60 concurrent
HTTP requests at page-load and a 194-second full-load with browser unresponsiveness.
The QA-33 closeout flagged that "QA-27 (dia parallel) NOT reverted yet — need
to probe dia separately."

Today's R2-W-6 verification confirmed `diaQueryAll` at `dialysis.js:174-188`
still issued every page past the first via `Promise.all` (the exact pattern
QA-33 had to unwind on gov). dia tables are smaller (medicare_clinics 8.5k,
true_owners 3.4k vs gov's properties 17.5k) so the regression is less dramatic,
but the failure mode is identical when dashboards stack multiple
`diaQueryAll` calls in `Promise.all` — and dialysis.js does exactly that
(loadDiaData Phase 1 + ownership-coverage block + sales/contacts widgets).

### Fix
Replaced the parallel implementation with a serial while-loop that:
- Issues one page at a time, accumulating into `all`.
- Breaks early when `rows.length < pageSize` (PostgREST max-rows cap).
- Carries a 120 s total-time fuse with a `console.warn` on overshoot so a
  hung Edge Function can't lock a dashboard load forever.
- Drops the `includeCount=true` first-page request — callers that need a
  true count (the QA-29 v_prospect_targets reader) keep using `diaQuery`
  directly with `includeCount=true`, which is one call, not a fan-out.

Matches `govQueryAll`'s post-QA-33 shape exactly so future maintenance is
symmetric across the two dashboards.

### Sandbox tooling note
`dialysis.js` is 604 KB — above the audit/SANDBOX_TOOLING_NOTES.md threshold
where the Cowork `Edit` tool silently truncates. The actual edit was
performed through Python via `mcp__workspace__bash` (the documented
workaround). `wc -c` post-edit: 604,189 bytes / 10,936 lines. Tail verified
intact. `git diff --stat` reports 26 insertions / 18 deletions — exactly the
expected swap of the OLD 21-line block for the NEW 28-line block.

### Expected perf
Dia dashboard wall-clock returns to QA-26-era serial behaviour (~400 ms per
page × N pages). For dia's biggest reads (medicare_clinics 9 pages, true_owners
4 pages) that's ~3.6 s and ~1.6 s respectively. Slower than the parallel
optimum, but no perf cliff under load.

### Verification (post-apply)
1. `grep -c "R2-W-6 (2026-05-19)" dialysis.js` → 1
2. `grep -c "Promise.all(pages)" dialysis.js` → 0
3. Open the dia dashboard, watch the network tab — requests stack sequentially,
   no burst of 8+ concurrent /api/dia-query calls.
4. Spot-check the QA-29 Unprospected Owners modal — `window._diaUnprospectedTotal`
   should still read 532 (the QA-29 fix uses `diaQuery` with includeCount
   directly, untouched by this revert).

### Risks
- The 120-second total fuse is on the safe side — a real timeout would mean
  ~120 pages × 1 s each = 120k rows, well beyond any dia table.
- Existing callers (~13 sites) expect a flat array return — preserved.
- The diaQuery includeCount opt-in (QA-27 change to diaQuery itself) is NOT
  reverted; it's a useful primitive and the v_prospect_targets caller relies
  on it.

### Out of scope (deferred follow-ups)
- **Throttled-parallel (concurrency=4)** for both `govQueryAll` and
  `diaQueryAll`. QA-33's closeout flagged this as the better long-term
  shape — six independent serial pages plus four concurrent ones gives most
  of the parallel win without the perf cliff. Defer to a focused perf round.
- **dia parallel readers OUTSIDE diaQueryAll** — the ownership-coverage block
  at `dialysis.js:454,869,870` already runs three independent reads in
  parallel via top-level `Promise.all`. That's three concurrent requests,
  not N × pages, so the cliff doesn't apply. Leave as-is.

### Files changed
- `dialysis.js` — diaQueryAll body replaced (lines 168-188)
- `audit/patches/R2-W-6-dia-parallel-paginatio

## R2-L-1 closeout (2026-05-19) — template health weekly rollup + history table 🟧 REVIEW
- **Branch:** `audit/r2-l-1-template-health-weekly-cron`
- **Patch:** `audit/patches/R2-L-1-template-health-weekly-cron/apply.mjs`
- **Migration:** `supabase/migrations/20260519120000_lcc_r2_l1_template_health_history_and_cron.sql`
- **Code change:** `api/operations.js` adds POST `?_route=draft&action=health-rollup` handler
- **Closes:** R2-L-1 (HIGH)

### Diagnosis
`evaluateTemplateHealth()` (api/_shared/template-refinement.js:41) is exposed
at `/api/operations?_route=draft&action=health` and the handler already
auto-flags templates that need revision. But no scheduled job calls it. The
weekly health report at reports/lcc-template-health-weekly-latest.md is
regenerated by hand; the loop has no time-series and no automated cadence.

### Fix
Two coordinated pieces:

1. **`public.template_health_history` table** (LCC Opps) — one row per
   rollup, captures the full structured evaluations payload as JSONB plus
   pre-rolled aggregates (template_count, evaluated_count,
   needs_revision_count, stale_count, total_sends, revisions_flagged,
   run_duration_ms). Indexed on `recorded_at DESC` for the "last 13 weeks
   trend" query and a partial index on rows with non-zero
   needs_revision_count so the daily briefing can flag week-over-week
   regressions in one cheap query.

2. **`?_route=draft&action=health-rollup` handler** — same evaluateTemplateHealth +
   flag-and-suggest pass as `?action=health`, plus persists a row to
   template_health_history. `persist=false` query param lets a UI dashboard
   tab call the endpoint without polluting the time-series. The cron always
   sets `persist=true`.

3. **pg_cron `lcc-template-health-rollup`** — every Monday 06:00 UTC,
   POSTs `/api/operations?_route=draft&action=health-rollup` with
   `{"lookback_days": 120, "persist": true}`. Calls go through
   `public.lcc_cron_post('/api/...', payload, 'vercel')` — same plumbing
   the other 8 LCC crons use.

### Why Monday 06:00 UTC
- Late enough that any Sunday-evening template_sends have already landed
  in template_sends.
- Early enough for the Monday-morning briefing to read the fresh rollup.
- 06:00 UTC = 01:00 ET / 22:00 PT Sunday — outside business hours
  everywhere.

### Sandbox tooling note
`api/operations.js` is 200 KB — under the QA-31 truncation threshold for
the Cowork Edit tool, but the first Edit attempt landed a truncated copy of
the file (missing the last 11 lines). Restored from `git show HEAD` and
re-applied via Python-via-bash with an explicit CRLF preservation step
(HEAD uses CRLF endings; LF write produced a 4,499-line whole-file diff).
Final `git diff --stat`: 74 insertions, 0 deletions. Clean.

### Verification (post-apply)

```sql
-- On LCC Opps
\d public.template_health_history
SELECT * FROM cron.job WHERE jobname = 'lcc-template-health-rollup';
-- Expected: 1 row, schedule='0 6 * * 1', active=true

-- Trigger a one-shot manual run
SELECT public.lcc_cron_post(
  '/api/operations?_route=draft&action=health-rollup',
  '{"lookback_days": 120, "persist": true}'::jsonb,
  'vercel'
);

-- Verify history row landed
SELECT recorded_at, template_count, evaluated_count, needs_revision_count, total_sends, run_duration_ms
  FROM public.template_health_history
 ORDER BY recorded_at DESC LIMIT 5;
```

### Risks
- Today template_sends has zero rows over 120 days (D-3 hasn't shipped),
  so the first ~N weekly rollups will show `total_sends=0` and
  `evaluated_count=0`. That's the correct baseline; the trend table starts
  capturing the moment D-3's record_send flow lands.
- Auto-flag side effect: `?action=health-rollup` runs the same
  `flagTemplateForRevision` pass as `?action=health`. With
  `total_sends=0`, no template hits the EDIT_DISTANCE_FLAG_THRESHOLD
  (which requires hasEnoughData = sends ≥ MIN_SENDS_FOR_EVALUATION=5). So
  no false flags during the empty period.
- generateRevisionSuggestion (called for each needs_revision template)
  uses AI tokens. With no flagged templates today, cost is $0; once D-3
  ships, budget ~$0.10/week for the rollup based on observed flagged
  template counts.

### Out of scope (deferred follow-ups)
- **R2-L-1b: trend sparkline on Templates admin tab.** Read the last 13
  rollups from template_health_history; render per-template avg-edit-distance
  / reply-rate / deal-rate trends. Defer until the table has more than a
  few rows.
- **R2-L-1c: week-over-week regression alert in daily briefing.** When the
  current week's needs_revision_count exceeds last week's by >20%, surface
  in the strategic priorities section. Pair with the D-3 / template-sends
  flow.

### Files changed
- `supabase/migrations/20260519120000_lcc_r2_l1_template_health_history_and_cron.sql` (new)
- `api/operations.js` — added `?action=health-rollup` handler (74 lines)
- `audit/patches/R2-L-1-template-health-weekly-cron/` — patch package
- `audit/ROUND_2_FINDINGS_20

## R2-M-5 closeout (2026-05-19) — weekday daily briefing email (Power Automate flow spec) 🟧 REVIEW
- **Branch:** `audit/r2-m-5-weekday-briefing-email`
- **Patch:** `audit/patches/R2-M-5-weekday-briefing-email/apply.mjs`
- **Doc:** `docs/architecture/flows/lcc-weekday-briefing-email.md` (new)
- **Closes:** R2-M-5 (HIGH)

### Diagnosis (verified 2026-05-19)
- `docs/architecture/flows/lcc-daily-briefing.md` (Mon-Fri 12:30 UTC):
  `Post_card_in_a_chat_or_channel` to Teams. No email.
- `docs/architecture/flows/lcc-morning-briefing.md` (Sat-Sun 12:00 UTC):
  `Send_an_email_(V2)` via Office 365. No weekday counterpart.

Net effect: weekdays Scott only sees the briefing if he opens Teams; if he
starts his day in email, he never sees it. Same gap inverts on weekends:
Teams shows nothing, email shows the digest.

### Fix
New Power Automate flow `LCC Weekday Briefing Email` that:
- Triggers `Recurrence` Mon-Fri at 12:30 UTC (same wall-clock as the Teams
  flow so the email lands at the same instant the Teams card posts).
- GETs `/api/briefing-email` (the existing endpoint the Sat/Sun flow already
  consumes — no API change needed).
- Parses JSON, composes a date-stamped subject, sends an email via
  `shared_office365`.
- Includes a fault branch posting to the dead-letter pane on HTTP step
  failure — mitigates R2-M-7 for this flow from day one.

The Teams flow stays as-is; the weekday Teams card and the email arrive
simultaneously, giving Scott two reliable surfaces.

### Why doc-only
Power Automate flows live in the user's Microsoft 365 account, not in this
repo. The repo carries flow specs (markdown) and exported ZIPs as a
reference but the runtime artefacts live in PA itself. This patch authors
the spec; the user follows the "How to build" section to clone the existing
Sat/Sun flow, change the schedule, and export the result.

### Expected build time
~20 minutes (clone `LCC Morning Briefing` flow, change Recurrence schedule
to Mon-Fri, change start time to 12:30 UTC, add fault branch per the
dead-letter runbook, save + smoke test).

### Verification (post-build)
1. Power Automate UI shows two morning briefing flows:
   - `LCC Morning Briefing` (Sat, Sun, 12:00 UTC)
   - `LCC Weekday Briefing Email` (Mon-Fri, 12:30 UTC)
2. Manual run produces an email in Scott's inbox within 60s.
3. `/api/admin?_route=dead-letter` shows zero entries for the new flow.
4. `FLOW_CHANGES_LOG.md` has a new entry dated when the flow shipped.

### Out of scope (deferred follow-ups, captured in the spec)
- **R2-M-5b**: shrink the Teams card to a one-liner that links to the email.
- **R2-M-5c**: PTO/pause switch via user_settings.`briefing_pause_until`.
- **R2-M-5d**: unify Sat/Sun and weekday flows into a single
  `LCC-Briefing-Daily` flow with a day-of-week branch.

### Files changed
- `docs/architecture/flows/lcc-weekday-briefing-email.md` (new)
- `audit/patches/R2-M-5-weekday-briefing-email/` (patch package)
- `audit/ROUND_2_FINDINGS_2026-05-19.md` — 

## R2-M-3 closeout (2026-05-19) — Outlook calendar write-back (Power Automate flow spec) 🟧 REVIEW
- **Branch:** `audit/r2-m-3-outlook-calendar-write`
- **Patch:** `audit/patches/R2-M-3-outlook-calendar-write/apply.mjs`
- **Doc:** `docs/architecture/flows/lcc-outlook-calendar-write.md` (new)
- **Closes (when paired with R2-M-3b + R2-M-3c):** R2-M-3 (HIGH)

### Diagnosis (verified 2026-05-19)
Calendar bridge is unidirectional Outlook → Supabase:
- `LCC - Personal Calendar Sync` (hourly, GetEventsCalendarView) pulls events into Supabase.
- `docs/architecture/lcc-microsoft-salesforce-pipeline-gap-analysis.md:37` explicitly says "LCC cannot write or update Outlook calendar events."
- `api/_shared/cadence-engine.js:378` has a `touchData.type === 'meeting'` branch that increments `meetings_scheduled` but there is no actual calendar invite created — only a counter increment.

Net: cadence touches "Phone Follow-Up" and "Direct Ask — schedule meeting"
produce LCC-side actions but every actual calendar invite is hand-authored
in Outlook. The cadence-engine already knows the contact, the property, and
the suggested follow-up window; none of that reaches the calendar surface.

### Fix (this round)
Authored the Power Automate flow spec for `LCC-OutlookCalendarWrite`:

- Trigger: HTTP `Request` (LCC POSTs to a PA-generated trigger URL stored
  in Vercel env as `OUTLOOK_CALENDAR_WRITE_FLOW_URL` — Vault-managed).
- Request schema: subject, body_html, start/end ISO + TZ, attendees,
  location, categories, `metadata.lcc_cadence_id` + `lcc_touch` for
  the callback to wire to the right cadence row. `correlation_id` and
  `schema_version` mirror the existing calendar-sync hardening pattern.
- Flow body: `Parse_JSON` → `Create_calendar_event_(V2)` via
  `shared_outlook` → HTTP callback to LCC at
  `/api/operations?_route=draft&action=record_calendar_invite` →
  `Response` 200 with Outlook event ID. Fault branch on the create step
  posts to the dead-letter pane.
- Auth: PA-generated trigger URL (signed) + secondary HMAC header
  `X-LCC-Caller` so a leaked URL alone can't fire events.

### Why doc-only this round
Power Automate flows aren't in the repo — they live in Scott's M365
account. The repo carries the spec; the user builds the flow following
the "How to build" section. Two paired follow-ups are needed before the
end-to-end loop closes:

- **R2-M-3b**: LCC-side `Schedule meeting` button on `detail.js` +
  `api/operations.js` action that builds the request payload and POSTs
  to the PA trigger URL.
- **R2-M-3c**: New `?action=record_calendar_invite` handler in
  `api/operations.js` that accepts the PA callback, patches
  `touchpoint_cadence.last_calendar_event_id`, and advances the cadence
  via `recordTouchOutcome('meeting')`.

R2-M-3b and R2-M-3c are tracked as Round 2 sub-findings so they don't
get lost.

### Additional deferred follow-ups (captured in the spec)
- **R2-M-3d**: Conflict-detection prefix — query
  `GetEventsCalendarViewV2` for the request window inside the flow,
  return 409 if any existing event overlaps.
- **R2-M-3e**: Bidirectional sync — when the user moves or cancels the
  Outlook event, propagate the change back via the existing hourly pull.

### Verification (post-build, after PA flow + R2-M-3b + R2-M-3c ship)
1. Open a dia property detail page; click "Schedule meeting" on the
   sticky action bar. Pick a date/time.
2. Confirm an Outlook event appears on Scott's calendar within 30s with
   the right subject, attendee, and LCC category tag.
3. Confirm `touchpoint_cadence.last_calendar_event_id` is populated
   (matches the Outlook event ID).
4. Confirm the cadence advanced to the next touch.
5. Cancel the Outlook event manually; verify (today) the cancel is
   visible in the next hourly pull (R2-M-3e is needed before LCC reacts
   to the cancel).

### Files changed
- `docs/architectur

## R2-X-3 closeout (2026-05-19) — SF id back-write onto dia/gov denormalized columns 🟧 REVIEW
- **Branch:** `audit/r2-x-3-sf-id-backwrite`
- **Patch:** `audit/patches/R2-X-3-sf-id-backwrite/apply.mjs`
- **File changed:** `api/_shared/bridge-handlers-salesforce.js` (+118 lines, -2 lines)
- **Closes:** R2-X-3 (HIGH)

### Diagnosis (verified 2026-05-19)
When `api/_shared/bridge-handlers-salesforce.js::handleSalesforceContactUpsert`
or `handleSalesforceAccountUpsert` lands an SF webhook payload, it writes:
  (a) `external_identities` via `linkSalesforce` (the LCC bridge row)
  (b) `unified_contacts.sf_contact_id` / `sf_account_id` (LCC Opps cache)

It does **not** PATCH the domain-side denormalized columns:
  - `dia.contacts.salesforce_id`     (column exists per Round 76ak migration)
  - `dia.true_owners.salesforce_id`  (column exists; QA-25's
    `v_prospect_targets` reads it)
  - `gov.true_owners.sf_account_id`  (column exists; QA-25's gov view reads
    `WHERE t.sf_account_id IS NULL`)
  - `gov.contacts.sf_contact_id`     (gov-side convention)

Net effect: QA-25's "Unprospected Owners" widget on gov reads
`sf_account_id IS NULL` — every SF-linked owner that lands via the bridge
without back-write is mis-classified as unprospected. The metric is wrong
by the back-write gap. Same problem on dia for any dashboard that filters
on `contacts.salesforce_id`.

### Fix
Added `backwriteSfIdToDomain({ kind, sfId, email, name })` helper to
bridge-handlers-salesforce.js. Conservative match strategy:

- **Contact** (kind='Contact'): SELECT `dia.contacts` then `gov.contacts`
  by `email=ilike.<lower(p.Email)>` with `<col>=is.null` filter,
  `limit=2`. Per-domain column: dia uses `salesforce_id` (Round 76ak),
  gov uses `sf_contact_id`. PATCH only when exactly 1 candidate.
- **Account** (kind='Account'): SELECT `dia.true_owners` then
  `gov.true_owners` by `canonical_name=ilike.<canonicalized name>` with
  `<col>=is.null`, `limit=2`. dia column `salesforce_id`, gov column
  `sf_account_id`. PATCH only when exactly 1 candidate.

Match safety:
- Never overwrites a curated value (`<col>=is.null` filter).
- Aborts on multi-match (limit=2 + exactly-1 check) — avoids cross-tenant
  collisions where the same email or LLC name appears in both dia and gov
  for unrelated reasons.
- Wrapped in try/catch — any error logs to console and is reported in the
  result's `sf_backwrite` summary but never aborts the bridge handler.
  The SF `external_identities` row remains the authoritative link.

Per-call summary is added to the handler's result as `sf_backwrite` so
the activity log + future audit dashboard can see per-domain success /
failure counts.

### Why limit=2 with exactly-1 PATCH
Two motivations:
- **Single match is the unambiguous case** — patch confidently.
- **Two-or-more candidates** is a real-world signal that the email or
  canonical name maps to multiple domain rows (e.g., a property manager
  who appears as a broker on three dia listings and an owner on five
  gov ones). PATCHing all of them would silently glob unrelated records
  together. Capture as R2-X-3b (collision review queue).

### Verification (post-apply)
1. `grep -c "backwriteSfIdToDomain" api/_shared/bridge-handlers-salesforce.js` → 3
   (1 helper definition + 1 Contact call + 1 Account call)
2. `node -c api/_shared/bridge-handlers-salesforce.js` → no error
3. Smoke: send a synthetic SF Contact upsert with an email that matches one
   dia.contacts row whose salesforce_id is NULL. After the handler:
   - `external_identities` has the new salesforce row
   - `unified_contacts.sf_contact_id` is populated
   - `dia.contacts.salesforce_id` is now the SF id for that row
   - Handler result includes `sf_backwrite: { contact: { dialysis: { rows_patched: 1 } } }`
4. Re-send the same SF payload. The second call's `sf_backwrite.contact.dialysis`
   reports `candidates_found: 0` (because the column is no longer NULL) and
   `rows_patched: 0` — idempotent.
5. Sanity-check the QA-25 "Unprospected Owners" widget — its count should
   drop by the number of SF-linked owners that now have non-NULL
   `sf_account_id` / `salesforce_id`.

### Sandbox tooling note
`bridge-handlers-salesforce.js` is 20 KB — well under the Edit-tool
truncation threshold. Edit was performed via Python-via-bash anyway to
preserve line-ending convention (HEAD uses LF; sibling files in
`api/_shared/` are mixed — `entity-link.js` is CRLF, the rest LF).
Final `git diff --stat`: 118 insertions, 2 deletions. Clean.

### Risks
- **False-negative skip on multi-match.** Today the back-write quietly
  records `candidates_found: 2` and skips. The bridge row in
  `external_identities` still establishes the link, so reads through the
  bridge are correct. Only the denormalized column-based filters under-
  count. R2-X-3b will surface multi-match cases for review.
- **Email-case sensitivity.** Match uses `ilike` (case-insensitive) on a
  lower-cased input — handles common variations.
- **PATCH-on-null guard.** Means a corrupted manual edit (e.g. someone
  pasted the wrong SF id into a dia.contacts row) won't be auto-corrected.
  That's intentional — the bridge should never overwrite curated data.
  R2-X-3c can add a "detect SF-id mismatch and surface as data-quality
  warning" follow-up if needed.

### Out of scope (deferred follow-ups)
- **R2-X-3b**: collision-review queue when a back-write matches >1
  candidate. Today they're silently skipped (with a count in the summary);
  surface them in a `v_sf_backwrite_collisions` view so they can be
  resolved manually.
- **R2-X-3c**: SF-id mismatch detection — when the bridge sees a payload
  for an entity whose denormalized column already holds a DIFFERENT SF id,
  log to `data_corrections` instead of silently skipping.
- **R2-X-3d**: one-shot historical backfill. The 358 dia.contacts rows
  that had `sf_contact_id` migrated to `salesforce_id` in Round 76ak are
  already linked, but every entity created since then that doesn't have
  a column-side id is a candidate for back-write via this new helper run
  in batch mode.
- **R2-X-3e**: same back-write pattern for dia.recorded_owners (different
  table from true_owners). Today recorded_owners has neither
  `salesforce_id` nor `sf_account_id` columns; if/when one is added,
  extend `backwriteSfIdToDomain`.

### Files changed
- `api/_shared/bridge-handlers-salesforce.js` (+118 lines, -2 lines)
- `audit/patches/R2-X-3-sf-id-backwrite/` — patch package
- `audit/ROUND_2_FINDINGS_2026-05-19.md` — this closeout

No SQL. No Edge Function. No allowlist changes.
