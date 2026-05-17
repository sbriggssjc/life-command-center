# LCC Holistic Audit — Progress Tracker

**Source doc:** `LCC_Holistic_Audit_2026-05-17.docx` (63 findings, 24 pages)
**Sprint started:** 2026-05-17
**Owner:** Scott Briggs
**Workflow:** Direct edits on per-item branches off `main`; code changes delivered as apply scripts under `audit/patches/NN-<slug>/apply.mjs` (sandbox/Windows filesystem coherence issue makes direct sandbox writes invisible to Windows git); Supabase migrations authored AND applied via Supabase MCP.

## Status legend

- 🟦 **PENDING** — not started
- 🟨 **IN PROGRESS** — branch open, work underway
- 🟧 **REVIEW** — code complete, awaiting verification / merge
- ✅ **DONE** — merged to main and verified
- ⛔ **BLOCKED** — needs decision or upstream fix
- ⏸️ **DEFERRED** — moved out of sprint scope

## Top 10 priority queue

| # | Item | Branch | Status | Closes | Notes |
|---|------|--------|--------|--------|-------|
| 1 | Fire `runListingBdPipeline` from sidebar + OM intake | `audit/01-bd-pipeline-trigger` | ✅ DONE | A-1 (part), D-1, D-5 | Merged to main as commit `60f0364` on 2026-05-17 |
| 2 | Drain `llc_research_queue` (cron + UI, no scraper) | `audit/02-research-queue-drain` | ✅ DONE (Phase A) / ⏸️ DEFERRED (Phase B) | A-1, B-5 | Phase A merged to main as `54ee38e` (cron live, verified). Phase B (UI) deferred to follow-up session. D-13 moved to item #5. |
| 3 | Wire `resolveOwnerLinks` for dia + backfill | `audit/03-dia-owner-linkage` | 🟨 IN PROGRESS | A-2 | CRITICAL · Phase A: forward-looking dia owner resolution (this commit). Phase B: one-shot backfill of 13,338 NULL-owner dia properties (deferred). |
| 4 | Build `v_next_best_action` UNION view + Home rail | `audit/04-next-best-action-phase-a` | 🟨 IN PROGRESS | B-1, B-3 (dia), B-13 | CRITICAL · Phase A: 6 gap sources + 3 propagation views on dia (21k+ ranked gaps live). Phase B: gov mirror + LCC Opps view + Home rail UI. |
| 5 | Fix silent-write loop in sidebar-pipeline (provenance integrity) | `audit/05-provenance-integrity` | ✅ DONE (Phase A) / ⏸️ DEFERRED (Phase B) | A-3 | Phase A merged to main as `08846cc`. ingest_write_failures table live + domainQuery instrumented. Phase B (pushProvenance gating + D-13 column-schema fix) deferred until we observe real failure patterns. |
| 6 | Data Completeness rail on `detail.js` + persisted column | `audit/06-completeness-rail` | 🟦 PENDING | B-2, B-15 | HIGH |
| 7 | Seed cadence on new contact writes | `audit/07-contact-cadence-seed` | 🟧 REVIEW | D-2, D-6 (part) | CRITICAL · sidebar path landed. contacts-handler mirror = follow-up. |
| 8 | Sticky next-action bar on `detail.js` | `audit/08-detail-next-action-bar` | 🟦 PENDING | B-9, B-10 | HIGH |
| 9 | Value-weighted sort on every list | `audit/09-value-sort` | 🟦 PENDING | B-3 | HIGH |
| 10 | Global error visibility (window.error, retry CTAs, toast tiering) | `audit/10-global-error-visibility` | 🟦 PENDING | C-5, C-6, C-9, C-10 | HIGH |

## Working agreements

- Each Top-10 item gets its own branch off `main`.
- Code changes delivered as apply scripts (`audit/patches/NN-<slug>/apply.mjs`); the script anchors edits by unique substring + asserts pre-conditions before writing. Run `--dry` then `--apply`.
- Migrations: timestamped `.sql` in `supabase/migrations/` AND applied via Supabase MCP.
- SoS scraper for owner research is **deferred** — cron + UI ships now; manual SOS workflow via `sosBtns` until the scraper is built as a separate effort.
- After each item: update this file (status, branch, commit SHA, verification notes) via the next patch.
- Per-finding remediation notes live in the source `.docx`; this file is the operational tracker.

## Backlog (remaining 53 findings)

After Top 10 ships, follow the 5-phase roadmap from the audit doc (Stop the bleeding → Connect collection to consequence → Make DB visible → Close BD loops → Refinement). Phase membership for each finding is annotated in `LCC_Holistic_Audit_2026-05-17.docx`, "90-Day Improvement Roadmap" section.

---

# Closeout log

## Closeout — item 1 — Fire runListingBdPipeline from sidebar + OM intake
- **Branch:** `audit/01-bd-pipeline-trigger`
- **Patch:** `audit/patches/01-bd-pipeline-trigger/apply.mjs`
- **Closes:** A-1 (partial — paired with item #2 for owner research drain), D-1 (sidebar), D-5 (OM intake)
- **Files changed:**
  - `api/_handlers/sidebar-pipeline.js` — writer return shape `{count, insertedListingId}`, BD trigger wiring, workspaceId/userId threaded through propagateToDomainDb
  - `api/_handlers/intake-promoter.js` — BD trigger fires when listingResult was a genuine INSERT (not updated, not merged_into_existing)
  - `AUDIT_PROGRESS.md` — this file, created via Node fs.writeFile so Windows git sees it
- **Verification (post-apply, post-commit):**
  1. `grep -c "runListingBdPipeline" api/_handlers/sidebar-pipeline.js` → ≥ 2 (import + call)
  2. `grep -c "runListingBdPipeline" api/_handlers/intake-promoter.js` → ≥ 2
  3. `grep -c "insertedListingId" api/_handlers/sidebar-pipeline.js` → ≥ 6 (writer returns + reader)
  4. `node -c api/_handlers/sidebar-pipeline.js` → parses
  5. `node -c api/_handlers/intake-promoter.js` → parses
  6. (Smoke) Capture a CoStar listing for an asset+state with known peer-owner contacts; confirm new `inbox_items` rows with `source_type='listing_bd_trigger'`. Re-capture the same listing; confirm NO duplicate inbox items are queued.
- **Commit SHA:** _paste after `git commit`_
- **Date applied:** _paste at apply time_

---


## Closeout — item 1 — Fire runListingBdPipeline from sidebar + OM intake
- **Status:** ✅ DONE
- **Branch:** `audit/01-bd-pipeline-trigger`
- **Item commit:** `7f058d6 audit(item-1): fire runListingBdPipeline from sidebar + OM intake`
- **Merge commit:** `60f0364 Merge audit/01-bd-pipeline-trigger: fire runListingBdPipeline from sidebar + OM intake`
- **Merged into main:** 2026-05-17
- **Closes:** A-1 (partial — full closure pairs with item #2), D-1 ✓, D-5 ✓
- **Smoke test recommended:** Capture a CoStar listing for an asset+state with known peer-owner contacts; confirm new `inbox_items` rows with `source_type='listing_bd_trigger'`. Re-capture; confirm no duplicate inbox items.

## Closeout — item 2 — Phase A (cron migration)
- **Status:** 🟨 IN PROGRESS (Phase A landed; Phase B = UI, in flight)
- **Branch:** `audit/02-research-queue-drain`
- **Patch:** `audit/patches/02-research-queue-drain/apply.mjs`
- **Files changed:**
  - `supabase/migrations/20260517140000_lcc_llc_research_tick_cron.sql` — pg_cron schedule for `lcc-llc-research-tick` (every 30 min, calls existing handler in safe-mode without API key)
  - `AUDIT_PROGRESS.md` — this file
- **Migration applied via Supabase MCP** on LCC Opps (`xengecqvemvfknjvbvrq`) at 2026-05-17 14:42 UTC. Verified `cron.job` row: `jobid=30, jobname='lcc-llc-research-tick', schedule='*/30 * * * *', active=true`.
- **Initial queue depths at preflight (2026-05-17 14:30 UTC):**
  - dia.llc_research_queue: 1,267 queued
  - gov.llc_research_queue: 199 queued
- **Verification (post-commit):**
  1. `grep -F "lcc-llc-research-tick" supabase/migrations/20260517140000_lcc_llc_research_tick_cron.sql` → present
  2. (LCC Opps SQL) `SELECT * FROM cron.job WHERE jobname='lcc-llc-research-tick'` → 1 row, active=true
  3. Wait until the next :00 or :30 minute boundary, then `SELECT * FROM cron.job_run_details WHERE jobid=30 ORDER BY end_time DESC LIMIT 5` → run records appear, status='succeeded'
- **Phase B (next):** apply script that adds Owner Research Queue UI to gov.js + dialysis.js. Ranked by linked-property estimated value, sosBtns one-click SOS links, inline Mark-researched form writing back to `recorded_owners.manager_name`/`registered_agent_name`.

---

# Discoveries — 2026-05-17 (item #2 investigation)

## D-discovery-1: `ownership_research_queue` is a working AI pipeline, NOT a missing system

The audit doc finding **D-13** ("ownership_research_queue has a writer; no contact-resolution worker") was incorrect on the consumer side. The actual gov-DB table has columns `research_id`/`lead_id`/`task_type`/`task_status`/`ai_prompt`/`ai_response`/`ai_confidence`/`ai_sources`/`human_verified` — i.e., a full AI research + human-verification workflow, NOT a simple first-name-only broker resolver. As of 2026-05-17, the queue carries **32,437 complete / 15,662 skipped / 691 queued / 142 failed** rows across 9 task types: `county_lookup`, `entity_resolution`, `deed_owner_verify`, `entity_registry_verify`, `parcel_verify`, `contact_discovery`, `mortgage_extract`, `public_record_extract`, `tax_mailing_verify`. The Python file `pipeline/ai_research.py` is the producer/consumer; most-recent rows are from 2026-05-11, so the pipeline is actively running.

## D-discovery-2: sidebar-pipeline.js writers to ownership_research_queue have been silently failing

`api/_handlers/sidebar-pipeline.js:1759-1769` and `:2592-2603` POST to `ownership_research_queue` with these columns: `property_id`, `address`, `city`, `state`, `recorded_owner_name`, `source`, `priority`, `status`, `created_at`. **None of those columns exist on the real table** (the schema is `research_id`, `lead_id`, `task_type`, `task_status`, `ai_prompt`, ...). Every one of those POSTs has been failing with PostgREST 400 ("column does not exist"). Because `domainQuery` swallows non-2xx responses without throwing (the silent-write bug in finding **A-3 / D-3**), nobody noticed. Date range of the bug is unknown — needs git-blame on those two writer call sites.

**Resolution:** moved D-13 from item #2 to item #5 ("Fix silent-write loop in sidebar-pipeline"). When item #5 lands the silent-write fix, those writes will start surfacing errors. The writers should then be either (a) rewritten to use the correct AI-pipeline schema (`task_type='contact_discovery'` for first-name-only brokers, `task_type='entity_resolution'` for unknown true_owner), or (b) deleted as redundant since the existing Python pipeline already covers both cases.



## Closeout — item 3 — Phase A (resolveOwnerLinksDia)
- **Status:** 🟨 IN PROGRESS (Phase A landed; Phase B = one-shot backfill, deferred)
- **Branch:** `audit/03-dia-owner-linkage`
- **Patch:** `audit/patches/03-dia-owner-linkage/apply.mjs`
- **Closes:** A-2 (forward-looking half) — backfill of historical 13,338 NULL-owner dia properties is Phase B.
- **Files changed:**
  - `api/_handlers/intake-promoter.js`
    - New `resolveOwnerLinksDia(match, snapshot)` sibling function (~120 lines). Mirrors the gov `resolveOwnerLinks` pattern with dia column names (`normalized_name` instead of `canonical_name`, `sf_company_id`/`salesforce_id` instead of `sf_account_id`). Owner-name signal: `snapshot.seller_name` → `property.assessed_owner` → parsed from `property.notes`. Patches `true_owner_id` and `recorded_owner_id` on `dia.properties` when a fuzzy ILIKE match is found.
    - Updated `resolveOwnerLinks` dispatcher to route dia matches to the new sibling instead of returning the `owner_resolution_not_implemented_for_dialysis` skip.
    - After FK patches, calls `reconcilePropertyOwnership('dialysis', propertyId)` to denormalize `recorded_owner_name` + `true_owner_name` onto `dia.properties` (matching what `sidebar-pipeline.js` already does for CoStar captures).
    - New import: `reconcilePropertyOwnership` from `./sidebar-pipeline.js`.
  - `AUDIT_PROGRESS.md` — this file.
- **Scope of impact:**
  - **Forward-looking:** Every new dia OM intake from this commit forward will get owner FK linkage if a matching `recorded_owners` / `true_owners` row exists. Audit baseline (pre-patch): 13,338 of 15,219 dia properties (87.6%) have NULL `recorded_owner_id`. Phase A doesn't fix the historical backlog; Phase B will.
  - **Backward-looking (Phase B, deferred):** A one-shot Node script that walks the 13,338 NULL-owner properties and applies the same fuzzy-match logic. Will need rate-limiting + progress tracking + resumability (13k+ PostgREST round trips). ~200 lines of Node.
- **Verification (post-commit):**
  1. `grep -c "resolveOwnerLinksDia" api/_handlers/intake-promoter.js` → ≥ 2 (definition + dispatch call)
  2. `grep -c "reconcilePropertyOwnership" api/_handlers/intake-promoter.js` → ≥ 2 (import + call)
  3. `node -c api/_handlers/intake-promoter.js` → parses
  4. (Smoke test) Re-promote an existing dia OM intake by re-flagging it in Power Automate; query `SELECT recorded_owner_id, true_owner_id FROM dia.properties WHERE property_id = <X>` before and after; the FKs should now populate when a matching owner exists.
- **Commit SHA:** _paste after `git commit`_



## Closeout — item 5 — Phase A (surface silent domain-DB write failures)
- **Status:** 🟨 IN PROGRESS (Phase A landed; Phase B = call-site migration + D-13 column-schema fix, deferred)
- **Branch:** `audit/05-provenance-integrity`
- **Patch:** `audit/patches/05-provenance-integrity/apply.mjs`
- **Closes:** A-3 (the instrumentation + tracking-table half). Phase B will close the call-site migration + D-13.
- **Files changed:**
  - `supabase/migrations/20260517160000_lcc_ingest_write_failures_table.sql` — new table + 2 views on LCC Opps. Already applied via Supabase MCP at 2026-05-17.
  - `api/_shared/ops-db.js` — new `recordWriteFailure({...})` helper. Fire-and-forget POST to LCC Opps. Never throws.
  - `api/_shared/domain-db.js` — `domainQuery` now takes an `opts` parameter (`label`, `sourceRunId`, `callerFile`) and auto-calls `recordWriteFailure` on every non-2xx POST/PATCH/PUT/DELETE. GETs are NOT instrumented (those failures are usually about missing rows, not silent corruption).
  - `api/_handlers/sidebar-pipeline.js` — `domainPatch` passes its `label` through to `domainQuery` so the new ingest_write_failures rows carry meaningful tags. (Polish — instrumentation works even without this.)
  - `AUDIT_PROGRESS.md` — this file.
- **Scope of impact:**
  - Every domain DB write from every code path (sidebar-pipeline, intake-promoter, admin handlers, etc.) is now instrumented automatically — no per-call-site change required.
  - **Important:** Existing silent failures (the ones from D-13: ownership_research_queue writers POSTing wrong columns) will START surfacing in `ingest_write_failures` after this lands. We expect to see a burst of 4xx rows from `sidebar-pipeline.js:1759` (BROKER_FIRSTNAME_ONLY enqueue) and `:2592` (auto-enqueue with property_id). Phase B will fix those writers.
- **Verification (post-commit):**
  1. `grep -c "recordWriteFailure" api/_shared/ops-db.js` → ≥ 1 (definition)
  2. `grep -c "recordWriteFailure" api/_shared/domain-db.js` → ≥ 2 (import + call)
  3. `node -c api/_shared/ops-db.js` and `node -c api/_shared/domain-db.js` → both parse
  4. (LCC Opps SQL, after first sidebar capture or intake post-deploy)
     `SELECT * FROM v_ingest_write_failures_recent LIMIT 20;`
     Expected to surface the D-13 silent-write rows (ownership_research_queue 4xx).
  5. `SELECT label, domain, n, http_statuses FROM v_ingest_write_failures_by_label LIMIT 20;` → triage rollup.



## Closeout — item 7 — Seed cadence + inbox triage on new contact entities
- **Status:** 🟧 REVIEW (pending merge to main)
- **Branch:** `audit/07-contact-cadence-seed`
- **Patch:** `audit/patches/07-contact-cadence-seed/apply.mjs`
- **Closes:** D-2 (sidebar new-contact dead-end) ✓. D-6 (cadence engine only covers contacts) is partially addressed — the contact half now seeds automatically; the broader `subject_kind = property | listing | owner` extension stays open as a separate finding.
- **Files changed:**
  - `api/_handlers/sidebar-pipeline.js`
    - Added `getCadenceState` import from `./cadence-engine.js`.
    - Inside `unpackContacts` (the entity-creation pass), after `ensureEntityLink` returns `link.createdEntity === true` for a person entity AND workspaceId/userId are present:
      1. Call `getCadenceState({ entity_id: link.entityId }, { domain })` to initialize the cadence row at touch 0 (idempotent — returns existing row if already there).
      2. If `cadenceRes.is_new === true` (genuinely-new entity, not a re-link of an existing one), POST an `inbox_items` row with `source_type='new_contact_qualify'`, the entity_id, role-aware title, and contact metadata (firm, email, phone, title, property_entity_id) for Scott's triage flow.
    - Whole block wrapped in try/catch. A failure here NEVER rolls back the unpackContacts core work.
  - `AUDIT_PROGRESS.md` — item #5 flipped to DONE (Phase A) with merge SHA `08846cc`; item #7 to REVIEW; new closeout section.
- **Scope of impact:**
  - Every CoStar sidebar capture that produces a new person contact will now create a triage inbox item AND a cadence row.
  - Re-captures of the same broker (existing entity) are a no-op for both calls — no spam.
  - Companies (org-type entities) are NOT seeded into cadence — only persons.
- **What this does NOT do:**
  - Does NOT mirror the seed for non-sidebar contact creates (contacts-handler / Salesforce-sync paths). Those producers create LCC entities through a different path; covering them requires reading `contacts-handler.js` and adding a similar hook. **Deferred to a follow-up.**
  - Does NOT extend the cadence engine to property / listing / owner subjects (the broader D-6). The audit lists that as a separate fix.
- **Verification (post-commit, post-deploy):**
  1. `grep -c "getCadenceState" api/_handlers/sidebar-pipeline.js` → ≥ 2 (import + call)
  2. `grep -c "contact-cadence-seed" api/_handlers/sidebar-pipeline.js` → ≥ 1
  3. `node -c api/_handlers/sidebar-pipeline.js` → parses
  4. After deploy, capture a CoStar listing on a property with brokers you've never seen before. On LCC Opps SQL:
     ```sql
     SELECT * FROM inbox_items
     WHERE source_type = 'new_contact_qualify'
       AND created_at > now() - interval '15 minutes'
     ORDER BY created_at DESC LIMIT 20;

     SELECT * FROM touchpoint_cadence
     WHERE current_touch = 0
       AND created_at > now() - interval '15 minutes'
     ORDER BY created_at DESC LIMIT 20;
     ```
     Both should return rows matching the new brokers.
- **Commit SHA:** _paste after `git commit`_



## Discovery patch #1 — gov schema mirror + loans CHECK expansion (2026-05-17)
- **Trigger:** Item #5 instrumentation (`ingest_write_failures`) went live ~17:55 UTC. Within 2 minutes, 48 silent-write failures landed across 5 distinct patterns. Three are fixed by this discovery patch.
- **Branch:** `audit/discovery-01-gov-schema-mirror`
- **Patch:** `audit/patches/discovery-01-gov-schema-mirror/apply.mjs`
- **Migration applied via Supabase MCP** on gov (`scknotsqkcheojiaewwh`) at 2026-05-17 18:05 UTC. Verified: all 3 columns + expanded CHECK present.

### Fixes (live on gov)
| Pattern | Fix |
|---|---|
| 14x 400 on `sales_transactions.recorded_owner_id`/`recorded_owner_name` (column not found) | Added both columns to gov (UUID FK to recorded_owners + text). |
| 10x 400 on `ownership_history.sale_id` (column not found) | Added column to gov (UUID FK to sales_transactions). |
| 2-10x 400 on `loans.loan_type` CHECK violation | Expanded gov's `loans_loan_type_check` to include 'Refinance' and 'Acquisition' (dia's event vocabulary) alongside gov's existing product taxonomy. |

### Still open (tracked as separate items)
- **12x 409 on `sales_transactions` uq_st_property_date_price** per gov capture. JS-level fix: sidebar sales POST needs `on_conflict=property_id,sale_date,sold_price` + `Prefer: resolution=merge-duplicates`. Tracked as Task #23.
- **D-13 ownership_research_queue column-schema mismatch.** Tracked in item #5 Phase B (Task #21).

### Why this happened
A-5-class schema drift: dia and gov are sibling Supabase projects with their own migration lineage. A migration that added `ownership_history.sale_id` + `sales_transactions.recorded_owner_id` + `sales_transactions.recorded_owner_name` to dia was never mirrored to gov. Same story for the loans CHECK: the dia constraint was authored when only 'Refinance'/'Acquisition' values were needed; gov's was authored later with a richer product vocabulary that doesn't overlap. Both drifts were invisible because of the silent-write loop (audit finding A-3), which item #5 just fixed.

### Verification (live)
```sql
-- On gov (scknotsqkcheojiaewwh) — all should return true
SELECT col, exists FROM (VALUES
  ('ownership_history.sale_id'),
  ('sales_transactions.recorded_owner_id'),
  ('sales_transactions.recorded_owner_name')
) AS expected(col)
JOIN LATERAL (
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND (table_name||'.'||column_name)=col)
) AS check(exists) ON true;

-- On LCC Opps: silent-failure counts should DROP after next sidebar capture
SELECT label, count(*) AS n
FROM v_ingest_write_failures_recent
WHERE occurred_at > now() - interval '15 minutes'
GROUP BY label ORDER BY n DESC;
```



## Discovery patch #2 — sales_transactions 409 dedupe recovery (2026-05-17)
- **Trigger:** After Discovery #1 silenced the schema-drift failures, the residual silent-failure pattern visible in `v_ingest_write_failures_by_label` was 26+ HTTP 409s per gov sidebar capture against the `uq_st_property_date_price` partial unique index.
- **Branch:** `audit/discovery-02-sales-409-dedupe`
- **Patch:** `audit/patches/discovery-02-sales-409-dedupe/apply.mjs`

### What was failing
The `uq_st_property_date_price` partial unique index on `gov.sales_transactions` enforces uniqueness on `(property_id, sale_date, sold_price) WHERE sale_date IS NOT NULL AND exclude_from_market_metrics IS NOT TRUE`. `upsertDomainSales`'s upstream lookup uses fuzzy match (`price ±5%` AND `date ±14d`), which misses cases where another writer (deed parser, RCA capture, sidebar-pipeline-from-prior-version) inserted an exact-match row. The POST then 409s against the unique index and the work is silently dropped.

### Fix
Defensive 409 recovery at the POST call site (`api/_handlers/sidebar-pipeline.js:4711`):
1. On 409 whose error_detail mentions `uq_st_property_date_price`, GET the existing row by EXACT `(property_id, sale_date, sold_price)`.
2. PATCH the row with the refreshed payload (gated through the same `filterByFieldPriority` as the normal upstream-lookup branch).
3. Continue the same post-write flow (close listings, link brokers, push provenance) using the recovered sale_id.
4. Skip the dialysis `createSaleAlert` call on recovery (it's a re-ingest, not a new sale signal).

The unique-index error message string is matched conservatively so future schema-renames don't accidentally trigger recovery on different conflicts.

### Verification (post-deploy)
```sql
-- On LCC Opps: 409 count should drop after next gov sidebar capture
SELECT label, http_status, count(*) AS n
FROM v_ingest_write_failures_recent
WHERE http_status = 409
  AND occurred_at > now() - interval '15 minutes'
GROUP BY label, http_status
ORDER BY n DESC;

-- A new label 'upsertDomainSales:409Recovery' may appear in Vercel logs
-- (console.log) confirming the recovery path is firing successfully.
```



## Closeout — item 4 Phase A — propagation gap views + v_next_best_action (dia)
- **Status:** 🟨 IN PROGRESS (Phase A landed on dia; Phase B = gov mirror + LCC Opps view + UI)
- **Branch:** `audit/04-next-best-action-phase-a`
- **Patch:** `audit/patches/04-next-best-action-phase-a/apply.mjs`
- **Migration applied** to dia (`zqzrriwuavgrquhisnoa`) at 2026-05-17 via Supabase MCP. Verified: 4 views live (3 propagation + v_next_best_action), 21,056 ranked gap rows.

### What landed
| View | Rows live |
|---|---|
| `v_gap_chain_drift` | ~2,600 (subset of 5,136 linked properties; cosmetic matches filtered out) |
| `v_gap_lease_tenant_drift` | ~3,500 |
| `v_gap_orphan_sale_owner` | ~280 (last 5 years only) |
| `v_next_best_action` | 21,056 unified ranked rows |

### Severity distribution after fix (gap_severity now mirrors gap_value)
| Severity | Count | Value range |
|---|---|---|
| critical | 898 | $20M – $575M |
| high | 1,447 | $5.6M – $345M |
| medium | 4,079 | $1.15M – $29M |
| low | 14,632 | $0 – $4.5M |

### Try it
```sql
-- Top 20 highest-value research gaps on dia right now
SELECT rank, gap_type, gap_severity, property_id, gap_label, suggested_action, gap_value
FROM public.v_next_best_action
ORDER BY rank
LIMIT 20;

-- Just the operator-transition candidates (CMS shows a different chain
-- than properties.tenant) — these are real BD intelligence signals
SELECT rank, property_id, gap_label, gap_value
FROM public.v_next_best_action
WHERE gap_type LIKE 'cms_chain_drift%'
ORDER BY gap_value DESC
LIMIT 20;
```

### What this enables for Scott
The dia side of "every gap that needs manual attention, in value-ranked order"
is now queryable in a single SELECT. Top 898 critical gaps are properties
worth ≥ $20M with un-researched owners or unresolved chain transitions —
that's a priority BD outreach hit list. The view also surfaced a concrete
A-13 instance discovered during build (property #25278: Liberty Dialysis
Hawaii → Fresenius operator transition, value $127M).

### Phase B — next session
1. **gov mirror** — same 3 propagation views + v_next_best_action on gov,
   adapted to gov column names (asking_price vs initial_price, etc.).
2. **LCC Opps view** — `v_next_best_action_ops` aggregating:
   - v_field_provenance_conflicts (Phase 3 of provenance system)
   - v_field_provenance_unranked
   - inbox_items with source_type IN ('new_contact_qualify','listing_bd_trigger','provenance_conflict')
   - lcc_health_alerts
3. **Backend endpoint** `/api/admin?_route=next-best-action` — fans out to
   dia/gov/LCC Opps, merges + re-ranks, returns top N.
4. **Home rail UI** in app.js — replaces the wrong-table Research pulse-card
   (B-13). Click-through to property_id detail or entity_pk detail.



## Closeout — item 4 Phase B-1 — gov mirror of v_next_best_action
- **Status:** 🟨 IN PROGRESS (gov mirror landed; Phase B-2 = backend endpoint + LCC Opps view; Phase C = Home rail UI)
- **Branch:** `audit/04-next-best-action-phase-b1`
- **Patch:** `audit/patches/04-next-best-action-phase-b1/apply.mjs`
- **Migration applied** to gov (`scknotsqkcheojiaewwh`) at 2026-05-17 via Supabase MCP. 3 views live (v_gap_agency_drift + v_gap_orphan_sale_owner + v_next_best_action).

### What landed
| View | Rows live |
|---|---|
| `v_gap_agency_drift` | ~842 (796 disagreement + 46 property-agency-null) |
| `v_gap_orphan_sale_owner` | ~2,362 (last 5 years; previously impossible to write — Discovery #1 unblocked) |
| `v_next_best_action` | ~13,240 unified ranked rows |

### Gap distribution on gov
| gap_type | Count | Max value |
|---|---|---|
| missing_recorded_owner | 9,816 | $967M |
| orphan_sale_owner | 2,362 | $319M |
| agency_drift:agency_disagreement | 796 | $1.3M |
| llc_research_pending | 220 | $347M |
| agency_drift:lease_agency_but_property_agency_null | 46 | $1.3M |

### Notes vs dia
Federal property values dwarf dialysis clinic values — a single missing-recorded-owner gap on a $967M federal property outranks 200+ medium-value dia gaps. The unified rank order is dominated by these top federal properties when both views are merged at the application layer (Phase B-2 endpoint).

Skipped vs dia:
- `v_gap_chain_drift` — no medicare_clinics analog on gov.
- `v_gap_lease_tenant_drift` — folded into the broader `v_gap_agency_drift`.

### Phase B-2 (next)
LCC Opps view + backend endpoint that fans out to dia + gov + LCC Opps, merges + re-ranks by gap_value, returns top N. ~150 lines of JS.

### Phase C (after that)
Home rail UI in app.js — replaces the wrong-table Research pulse-card (B-13) with the live merged top-20 ranked gaps.



## Closeout — item 4 Phase B-2 — cross-domain endpoint for v_next_best_action
- **Status:** 🟨 IN PROGRESS (B-2 landed; B-3 = LCC Opps view, deferred; C = Home rail UI, deferred)
- **Branch:** `audit/04-next-best-action-phase-b2`
- **Patch:** `audit/patches/04-next-best-action-phase-b2/apply.mjs`
- **Files changed:**
  - `api/admin.js` — adds `case 'next-best-action'` to the route dispatcher; new `handleNextBestAction(req, res)` function (~80 lines) that fans out to dia + gov in parallel via `domainQuery`, merges, globally re-ranks by gap_value DESC (tiebreak first_seen_at ASC), applies offset + limit, returns tagged with source_domain.

### Endpoint contract
```
GET /api/admin?_route=next-best-action
  ?domain=both|dia|gov          (default 'both')
  &limit=50                      (1-500, default 50)
  &offset=0                      (default 0)
  &severity=critical|high|medium|low   (optional)
  &gap_type=missing_recorded_owner     (optional exact match)

Response:
{
  "ok": true,
  "total_merged": 34219,
  "returned": 50,
  "limit": 50, "offset": 0,
  "severity": null, "gap_type": null,
  "by_domain": { "dialysis": { "ok": true, "fetched": 100 }, "government": { "ok": true, "fetched": 100 } },
  "items": [
    {
      "rank": 1,
      "gap_type": "missing_recorded_owner",
      "gap_severity": "critical",
      "property_id": 12345,
      "gap_label": "1234 Federal Plaza",
      "suggested_action": "Research recorded owner for 1234 Federal Plaza",
      "gap_value": 966854484,
      "first_seen_at": "2026-05-17T...",
      "source_domain": "government"
    },
    ...
  ]
}
```

### Verification (post-deploy, requires LCC_API_KEY)
```bash
# Top 10 unified gaps across both domains
curl -H "X-LCC-Key: $LCC_API_KEY" \
  "https://tranquil-delight-production-633f.up.railway.app/api/admin?_route=next-best-action&limit=10"

# Just critical gaps
curl -H "X-LCC-Key: $LCC_API_KEY" \
  "https://tranquil-delight-production-633f.up.railway.app/api/admin?_route=next-best-action&severity=critical&limit=20"

# Just CMS chain transitions on dia
curl -H "X-LCC-Key: $LCC_API_KEY" \
  "https://tranquil-delight-production-633f.up.railway.app/api/admin?_route=next-best-action&domain=dia&gap_type=cms_chain_drift:operator_transition_candidate&limit=20"
```

### Phase B-3 (deferred)
Build `v_next_best_action_ops` on LCC Opps surfacing:
- `v_field_provenance_conflicts` (Phase 3 of provenance system)
- `v_field_provenance_unranked` (schema-drift detector)
- `inbox_items` with `source_type` IN ('new_contact_qualify', 'listing_bd_trigger', 'provenance_conflict')
- `lcc_health_alerts` (unresolved)
- `v_ingest_write_failures_recent` (last 24h)

Then extend handleNextBestAction to also fetch from LCC Opps via opsQuery.

### Phase C (deferred)
Home rail UI in `app.js` calling `/api/admin?_route=next-best-action`, rendering the merged top-20 with click-through to property_id detail or entity_pk detail. Replaces the wrong-table Research pulse-card (audit B-13).



## Closeout — item 4 valuation v3 — NOI ÷ cap_rate (broker methodology)
- **Status:** ✅ DONE (live on dia + gov)
- **Branch:** `audit/04-valuation-v3`
- **Patch:** `audit/patches/04-next-best-action-valuation-v3/apply.mjs`
- **Migrations applied** via Supabase MCP at 2026-05-17:
  - dia: `20260517210000_dia_next_best_action_valuation_v3.sql`
  - gov: `20260517210000_gov_next_best_action_valuation_v3.sql`

### Discovery that motivated this
Scott's input — sold 33820 Weyerhaeuser Way (Federal Way, WA) for ~$115M; v_next_best_action ranked it at $575M. Investigation found multiple polluted columns:
- `dia.properties.current_value_estimate` — stores dialysis-operator BUSINESS valuations (revenue × ~5× EBITDA), not real estate. Top ranked properties showed implausible $/SF ($12,363/SF on a 5,880 SF Maryland building).
- `dia.properties.last_known_rent` — same pollution class.
- `dia.leases.annual_rent` — same pollution on the same rows (operator revenue loaded into rent column).

### Fix
Per Scott's broker methodology: NOI ÷ TTM cap rate from CM reports. NOI ≈ active NNN lease annual_rent (with $5M sanity cap). Cap rate from `cm_dialysis_cap_ttm_q` (overall subspecialty, 7.85% Q1 2026) and `cm_gov_cap_by_term_q` (by lease term tier; today only cap_outside_firm populated ≈ 9.76% Q1 2026, fallback to TTM).

### Value signal priority (final)
1. Most recent sale within 10y (truth)
2. Active listing price (market signal)
3. **NOI ÷ cap_rate (broker methodology)**
4. SF × $400/SF, capped at 200K (dia) or 500K (gov)
5. estimated_value (gov) or current_value_estimate × 0.2 (dia, polluted)
6. gross_rent × 10 (gov) or last_known_rent × 2 capped (dia, polluted)
7. $1M baseline

### Coverage breakdown on dia (15,219 properties)
| Signal source | Count | Quality |
|---|---|---|
| Recent sale | 1,504 | ✅ Truth |
| Active listing | 346 | ✅ Market |
| **NOI ÷ cap_rate** | **2,920** | ✅ Broker methodology |
| SF × $400 capped | 7,031 | OK proxy |
| Polluted CVE × 0.2 | 350 | Discounted |
| Polluted rent × 2 | 13 | Marginal |
| $1M baseline | 3,055 | No signal |

**4,770 properties (31%) now have high-quality real-estate-grounded value signals** vs zero before.

### Open follow-ups
- **Discovery #4 (junk property records)**: Top 10 ranks still tied at $160M cluster — properties with garbage addresses ("property #13900", "Juru Pa Va Lley", "15 5 2 2 2 4 3 2 4") that have no usable data. Either filter from view via address-quality predicate, or investigate upstream ingestion path. **Task #25**.
- **Upstream rent/value column pollution**: The same writer path is loading operator-revenue into properties.current_value_estimate, properties.last_known_rent, AND leases.annual_rent. Worth tracing once item #5 Phase B (silent-write fix) lands more completely.
- **dia cap-rate term tiers**: `cm_dialysis_cap_ttm_q` only has `subspecialty='all'` today. When the CM pipeline adds term-tier slicing (matching gov's structure), the dia view can be extended to use it.



## Closeout — item 4 v3.2 — dedupe + junk filter on missing_recorded_owner
- **Status:** ✅ DONE (live on dia + gov)
- **Branch:** `audit/04-dedupe-and-junk-filter`
- **Patch:** `audit/patches/04-next-best-action-dedupe-and-junk-filter/apply.mjs`
- **Closes:** Discovery #4 (junk property records) + Discovery #5 (duplicate property records at same address) — both surfaced by the v3 NOI/cap fix.

### Cleanup applied to v_next_best_action.missing_recorded_owner
- **Address quality predicate:** must be NOT NULL, ≥ 8 chars after trim, start with a digit, not pure digits + whitespace, not start with "property #".
- **Dedupe:** PARTITION BY `lower(trim(address)), lower(trim(city)), state` → keep smallest property_id per group. Surface `[N dup records]` inline in gap_label so duplicates are visible at a glance. Suggested action prompts consolidation first.

### Impact (dia)
- missing_recorded_owner: 13,338 → **10,115 rows** (−3,223; junk + dedupe).
- Top 15 dia entries now all real street addresses; no phantom records visible at the top.

### Impact (gov)
- Top 15 dominated by real federal addresses + 1 explicit duplicate notation: `6120 S. Yale Ave., Ste. 300 [7 dup records]`.

### Edge cases remaining (smaller follow-ups)
- "**2 locations**" still passes the filter — starts with "2", >8 chars. Would need a street-suffix predicate (`address ~ '\b(St|Rd|Ave|Blvd|Dr|Hwy|Way|Pkwy|Ln|Ct|Pl)\b'`) to catch.
- Two distinct ranks for "6120 S. Yale Ave., Ste. 300" remain (property_ids 16458 and 16451) because subtle city/state variations in some records keep them in separate partition groups. A more aggressive dedupe could normalize on address only.
- These two edge cases were small enough to defer; the major signal cleanup is in.



## Closeout — item 4 Phase C — Next Best Action rail on Home tab
- **Status:** ✅ DONE
- **Branch:** `audit/05-nba-home-rail`
- **Patch:** `audit/patches/05-nba-home-rail/apply.mjs`
- **Closes:** B-1 (cross-domain) + B-3 (next-best-action surfacing) — user-visible payoff for the entire Item #4 build.

### What this adds
- New widget on Home, immediately after the 4 stat cards and before Weather.
- Renders the top 10 globally-ranked gaps merged across dia + gov.
- Each row is clickable and opens the unified property detail panel for that record.
- Domain switch (All / Dialysis / Government) persisted in localStorage as 'lcc.nba.domain'.
- Refresh button + automatic refresh on the existing 5-minute auto-refresh interval and on tab regain-focus (visibilitychange).

### Data flow
GET /api/admin?_route=next-best-action&domain={both|dia|gov}&limit=15  →  handleNextBestAction  →  fan-out to dia.v_next_best_action + gov.v_next_best_action  →  global re-rank by gap_value DESC  →  top-N slice  →  {items, by_domain, total_merged}

### Row layout
- Rank number, severity chip (CRIT/HIGH/MED/LOW color-coded), domain tag (DIA/GOV), label (with the `[N dup records]` annotation from v3.2 when present), suggested action (1-line summary), value estimate (NOI/cap from v3).
- Left border stripe color-coded by severity.
- Click row → openUnifiedDetail(db, { property_id }). Fallback navTo(pageDia|pageGov) if detail not loaded yet.

### Files changed
- index.html — widget block after Home stats grid
- styles.css — .nba-* block (layout + severity colors)
- app.js — state vars, handlePageLoad pageHome wiring, render/load fns, bootApp Promise.all entry, auto-refresh + visibilitychange entries
- AUDIT_PROGRESS.md — this closeout

### Verification (post-apply, post-commit)
1. grep -c "renderNextBestActionPanel" app.js   → 4 or more
2. grep -c "loadNextBestActionData"   app.js   → 5 or more
3. grep -c "nextBestActionWidget"     index.html → 1
4. grep -c ".nba-row"                 styles.css → 1 or more
5. Smoke: hard-reload the app, land on Home. Rail visible with 10 ranked rows, top entry has expected value, clicking a row opens the unified detail panel.


# Sprint preflight — 2026-05-17

- **Working tree state at start:** 477 line-ending-only diffs + 2 real diffs (`docs/architecture/sf_file_backfill_flow6_next_steps.md` added, `supabase/functions/intake-salesforce-files/index.ts` 1-line edit). Untracked: audit preview JPGs, `docs/architecture/sf_connected_app_setup.md`. 1 unpushed commit `f967172` (Nixpacks fix) — auto-cleared between sessions.
- **Decision:** stash everything; branch off clean `main`. PowerShell stash reported "no local changes to save" — working tree was already clean by the time the stash ran (auto-cleared upstream).
- **Resolved blocker (2026-05-17 14:13):** `.git/` had 40+ stale lock files from prior sessions; cleared from PowerShell via `Get-ChildItem -Recurse -Filter "*.lock*" | Remove-Item -Force`.
- **Discovered (2026-05-17 14:25):** Sandbox writes physically reach NTFS (visible to `dir`) but **not** to Windows git's directory enumeration. PowerShell writes are seen normally. Confirmed by test (`sync_test.txt` visible, `AUDIT_PROGRESS.md` invisible). Workflow shifted to apply-script delivery: I author `audit/patches/NN/apply.mjs`; Scott runs from PowerShell — all file writes happen via Node's fs API which the Windows-side git enumerates normally.
- **Discovered (2026-05-17 14:38):** Repo working tree is 100% CRLF on both target files (`sidebar-pipeline.js` 8,799/8,799, `intake-promoter.js` 2,531/2,531). First apply.mjs draft used LF anchors → aborted cleanly on the first anchor. Script rewritten with per-file EOL detection (`detectEol`) + normalization (`toEol`); LF-formatted anchors in the script source are converted to the file's EOL before matching, so the same script works on LF/CRLF/mixed without producing mixed-EOL output.
