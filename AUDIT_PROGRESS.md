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
| 4 | Build `v_next_best_action` UNION view + Home rail | `audit/04-next-best-action` | 🟦 PENDING | B-1, B-3, B-13 | CRITICAL |
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


# Sprint preflight — 2026-05-17

- **Working tree state at start:** 477 line-ending-only diffs + 2 real diffs (`docs/architecture/sf_file_backfill_flow6_next_steps.md` added, `supabase/functions/intake-salesforce-files/index.ts` 1-line edit). Untracked: audit preview JPGs, `docs/architecture/sf_connected_app_setup.md`. 1 unpushed commit `f967172` (Nixpacks fix) — auto-cleared between sessions.
- **Decision:** stash everything; branch off clean `main`. PowerShell stash reported "no local changes to save" — working tree was already clean by the time the stash ran (auto-cleared upstream).
- **Resolved blocker (2026-05-17 14:13):** `.git/` had 40+ stale lock files from prior sessions; cleared from PowerShell via `Get-ChildItem -Recurse -Filter "*.lock*" | Remove-Item -Force`.
- **Discovered (2026-05-17 14:25):** Sandbox writes physically reach NTFS (visible to `dir`) but **not** to Windows git's directory enumeration. PowerShell writes are seen normally. Confirmed by test (`sync_test.txt` visible, `AUDIT_PROGRESS.md` invisible). Workflow shifted to apply-script delivery: I author `audit/patches/NN/apply.mjs`; Scott runs from PowerShell — all file writes happen via Node's fs API which the Windows-side git enumerates normally.
- **Discovered (2026-05-17 14:38):** Repo working tree is 100% CRLF on both target files (`sidebar-pipeline.js` 8,799/8,799, `intake-promoter.js` 2,531/2,531). First apply.mjs draft used LF anchors → aborted cleanly on the first anchor. Script rewritten with per-file EOL detection (`detectEol`) + normalization (`toEol`); LF-formatted anchors in the script source are converted to the file's EOL before matching, so the same script works on LF/CRLF/mixed without producing mixed-EOL output.
