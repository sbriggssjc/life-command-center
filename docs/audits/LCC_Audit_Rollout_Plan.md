# LCC Audit Rollout Plan
**Companion to:** LCC Data Architecture Audit (2026-07-29)
**Purpose:** A wave-sequenced execution plan with copy-paste-ready prompts for Claude Code (repo work on the Surface) and Cowork (database/ops/orchestration work), plus additional cleaning, connecting, and consolidating recommendations found while preparing this plan.

---

## Part 1 — Additional cleaning / connecting / consolidating recommendations

These are new items beyond the audit report, mostly discovered from table-size and repo-layout inspection:

**Database bloat and misplacement (verified live):**

| Item | Detail | Action |
|---|---|---|
| `dia.agency_debt_programs` | **1.6 GB / 1.5M rows of federal agency debt data sitting in the *dialysis* DB.** Gov has the same table with 0 rows. | Move to gov (or LCC Opps if cross-vertical), or archive. Largest single misplacement in the system. |
| `dia.learning_logs` | 454 MB / 2.76M rows | Set a retention window (90d?) + prune cron. |
| `dia.data_corrections` | 395 MB / 796k rows | Same — this is an append-only audit log; offload old rows to storage. |
| `dia.pending_updates` | 196 MB / 3,235 rows | 196MB for 3k rows = severe dead-tuple bloat. `VACUUM FULL` or recreate. |
| `dia.field_cleanups` | ~~110 MB / 0 rows~~ **CORRECTED 2026-07-29:** stats were stale — actually 838k rows; a legacy field-correction ledger dormant since 2025-10, superseded by field_provenance | ✅ Archived (not dropped) in W0.3. |
| `gov.frpp_annual_snapshots` | 2.25 GB / 580k rows | Keep, but confirm only N latest annual vintages are needed hot. |
| `gov.gsa_inventory_snapshot_lines` | 1.6 GB / 1.16M rows | Consider compressing older monthly snapshots to a parquet export in Storage. |
| ~40 `*_backup_*` / `*_purged_*` / round-log tables | Both domain DBs | Move to an `archive` schema with drop-by dates (audit §4.2.8). |
| gov tables marked `DEPRECATED 2026-03-14` | `data_corrections`, `email_log`, `scrub_cache_backing`, `lease_lifecycle_events` | Drop after a final export. |

**Repo hygiene:**
- `report1773930135028.csv` (33 MB) is committed at repo root; plus `plan.json` (350 KB), `dup_review_plan.json`, `r68b_term_plan.json`, stray `attach_check*.csv`, `dupaudit.csv`, `merge_pairs.csv`, `.write_test_xyz`, `_audit_preview_*.jpg`. None belong in git history going forward.
- ~95 markdown docs at repo root (worklogs, round prompts, audits). They're valuable history but make the root unnavigable and inflate every AI-assisted session's context. Consolidate into `docs/history/` with a dated index.
- `CLAUDE.md` is 578 KB — far past useful as an agent memory file; it gets truncated or skimmed by tools. Distill to <30 KB of durable rules + pointers, archive the rest.
- The `_to_delete/` folder I created (4 temp tarballs) — delete it, and make sure it never gets committed.

**Connecting/consolidating:**
- `unified_contacts` lives on gov but `CONTACTS_HUB=ops` can repoint it to LCC Opps at runtime — a canonical table whose *home is a runtime flag*. Pick LCC Opps permanently, migrate, delete the flag.
- Duplicate RCM/LoopNet ingest (`api/sync.js` vs `lead-ingest` edge function) — deprecate the Express copy.
- Two divergent SOS implementations (`sos-lookup.js` stub framework vs `llc-research.js` working FL adapter) — delete the dead framework, keep one registry.
- `lcc_users` duplicated in dia + LCC Opps "kept in step" manually — make LCC Opps canonical, mirror by cron.
- Hosting: Railway app + 21 edge functions on the *dialysis* project (historical accident) + pg_cron on three DBs. Long-term, edge functions that are logically hub functions should live on LCC Opps; you already have `LONG_TERM_HOSTING_STRATEGY.md` — worth refreshing after Wave 2.

---

## Part 2 — How to run this program

**Session types.** Use **Claude Code** (repo checkout on the Surface or cloud clone) for anything that edits code/migrations. Use **Cowork** for anything that is DB-side ops, verification, backlog processing, or multi-step orchestration against Supabase MCP (Cowork has the Supabase connection; it verified this audit's numbers live).

**Ground rules to paste into the top of EVERY Code session** (these come from your own incident history):

> RULES FOR THIS SESSION:
> 1. Work on a branch; never commit directly to main. One logical change per PR.
> 2. NEVER use in-place Edit tools on files >200 KB (app.js, detail.js, dialysis.js, gov.js, ops.js, sidebar-pipeline.js, admin.js, intake.js). GAPS_AND_FINDINGS_REGISTER.md §F documents silent truncation on this mount. For those files: write a small patch script (node/sed on a copy), verify byte counts before/after, and `node --check` is NOT sufficient — grep for the functions you touched.
> 3. Every DB change ships as a migration with: a reversible backup ledger table (project convention), a verification query in the migration footer, and a one-line entry in GAPS_AND_FINDINGS_REGISTER.md if it closes a registered gap.
> 4. Before writing code, read the relevant sections of: AGENTS.md, INFRASTRUCTURE.md, WRITE_SURFACE_POLICY.md, and the audit file for this workstream.
> 5. End the session by writing a short worklog to docs/history/ and listing exact verification steps I can run.

**Cadence.** Waves are sequential; prompts within a wave can run in parallel (separate sessions/branches). Suggested rhythm: 2–3 Code sessions + 1 Cowork verification session per week. Each wave ends with the **Wave Verification prompt** (Cowork) before the next begins. Realistic calendar: Wave 0–1 = weeks 1–2; Wave 2 = weeks 3–4; Wave 3 = weeks 5–7; Wave 4 = weeks 8–10; Wave 5 = weeks 11–13; Wave 6 = quarter-end and ongoing.

---

## Part 3 — The waves and their prompts

### WAVE 0 — Hygiene & guardrails (week 1; everything later is safer/cheaper after this)

#### W0.1 · Repo cleanup — **Claude Code**
```
Clean up the life-command-center repo root. On a branch:
1. Delete from tracking (git rm --cached + .gitignore): report1773930135028.csv (33MB),
   attach_check.csv, attach_check2.csv, dupaudit.csv, merge_pairs.csv, adj_caps.csv,
   plan.json, dup_review_plan.json, r68b_term_plan.json, .write_test_xyz,
   _audit_preview_p1.jpg, _audit_preview_p4.jpg, _to_delete/, *.tar.gz, _commit_msg.txt,
   commitmsg.txt. Add .gitignore rules for *.csv at root, *.tar.gz, _to_delete/, logs/.
2. Move all root-level worklog/audit/prompt .md files (the CLAUDE_CODE_PROMPT_*,
   *_WORKLOG, *_AUDIT_*, Claude_Code_Prompts_*, claude-code-prompts-*, SESSION_*,
   round/fix-list files — NOT README-class docs like AGENTS.md, INFRASTRUCTURE.md,
   RUNBOOK.md, ROLLOUT.md, WRITE_SURFACE_POLICY.md, GAPS_AND_FINDINGS_REGISTER.md)
   into docs/history/, and generate docs/history/INDEX.md grouped by topic + date.
3. Grep the codebase for references to any moved file path and fix them.
4. Do NOT touch any .js source in this session.
Verification: git status clean, npm test (if present) passes, grep shows no dangling
references to moved paths.
```

#### W0.2 · Distill CLAUDE.md — **Claude Code**
```
CLAUDE.md is 578KB and no longer functions as agent memory. On a branch:
1. Read it in chunks. Extract ONLY durable content: architecture invariants, DB
   topology, naming conventions, write-surface rules, known footguns (esp. the §F
   Edit-truncation warning), and pointers to canonical docs.
2. Write a new CLAUDE.md ≤30KB. Move everything else to docs/history/CLAUDE_full_2026-07.md.
3. Same treatment for AGENTS.md (33KB) if >50% is stale worklog.
Verification: new file loads fully in one Read call; nothing referenced by other docs
was deleted (grep).
```

#### W0.3 · Database archive schema + bloat + misplacement — **Cowork**
> ✅ **EXECUTED 2026-07-29 via Cowork** (migrations `w0_3_archive_schema_backup_tables` on dia+gov, `w0_3b_archive_field_cleanups`, `w0_3c_archive_deprecated_tables`, `w0_3d_archive_agency_debt_programs`). Do not re-run.
> ⚠️ **CORRECTION:** the original prompt below listed `dq5_*`/`dq7_*` as candidates — WRONG. Those are LIVE operational ledgers (`apply_owner_merge()` writes `dq5_owner_merge_log`; the maps are FK-repoint references; W3.3 audits them). They stay in `public`. Patterns struck below.
```
In my Supabase projects Dialysis_DB and government, using the Supabase MCP:
1. Create schema `archive` on both. Move every public table matching
   *_backup_*, *_purged_*, *_snapshot_20*, r37_*, r38_*, r40_*, t9b_*, t9c_*, t9d_*,
   t9e_* (NOT dq5_*/dq7_* — live ledgers) (list them first and show me before executing) via
   ALTER TABLE ... SET SCHEMA archive. Record a manifest table archive.manifest
   (table_name, moved_at, drop_after date = moved_at + 90d, reason).
2. gov: after showing me row samples, DROP the four tables commented
   "DEPRECATED 2026-03-14": data_corrections, email_log, scrub_cache_backing,
   lease_lifecycle_events.
3. dia: VACUUM FULL pending_updates and field_cleanups (110MB/0 rows) — or drop
   field_cleanups if nothing references it (grep results from the repo say nothing does;
   confirm with pg_stat_user_tables + a code search first).
4. dia.agency_debt_programs (1.6GB, 1.5M rows) is federal data in the dialysis DB;
   gov has the same table empty. Propose the cheapest move path (pg_dump/restore vs
   FDW insert-select) and execute after my confirmation.
5. Run get_advisors (security + performance) on all three projects and triage the
   top 10 findings each into do-now / defer / accept.
Do everything reversibly; show me the plan before each destructive step.
```

#### W0.4 · Inert-feature registry — **Claude Code**
```
Build the inert-feature registry from the audit (§4.4.3). On a branch:
1. Migration (LCC Opps): table feature_flags_registry(flag text pk, purpose text,
   surface text, env_var text, state text check (state in ('on','off','partial')),
   off_since date, owner text, notes text).
2. Seed rows for every env-gated capability found in the audit: SHAREPOINT_LIST_URL
   (folder-feed), SF_LIST_IMPORT_URL, SF_LIST_SEED_INSTITUTION, OPENCORPORATES_API_KEY,
   OWNER_ENRICH_SOS_URL/_ADDRESS_URL/_DEED_URL/_WEBSEARCH_URL, DECISION_OWNER_DEED_WINS,
   GEOCODIO/Google geocode keys, CONTACTS_HUB, every SOS_STATE_ADAPTERS entry with
   enabled:false. Grep api/ and supabase/functions for `process.env.` and
   `Deno.env.get` to catch ones I missed.
3. Add a "Dormant capabilities" section to the daily briefing email
   (api/_handlers/briefing-email-handler.js): one line per flag off >30 days.
Verification: briefing renders locally with the section; registry count matches grep.
```

#### W0.5 · Retention policies for mega-tables — **Cowork**
```
Design + apply retention for the large append-only tables (show me sizes first,
then the plan, then execute): dia.learning_logs (454MB/2.76M), dia.data_corrections
(395MB/796k), dia.ingestion_run_errors (197k rows), dia.field_aliases (278k),
lcc.field_provenance superseded rows (1.58M total — respect the existing 90d prune,
just verify it's running), lcc.sf_sync_log (213k, existing prune — verify),
gov.gsa_inventory_snapshot_lines (1.6GB — propose parquet offload of snapshots
older than 24 months to Supabase Storage rather than delete).
Each policy = pg_cron prune + a row in the existing feed_freshness/health framework
so a stalled prune is visible.
```

---

### WAVE 1 — Close the built loops (weeks 1–2; small diffs, big returns)

#### W1.1 · Feedback capture — the single highest-leverage change — **Claude Code**
```
Wire human match decisions into the learning loop (audit §4.1.1, finding 3.4.3).
In api/admin.js, the match_disambiguation verdict handler (~line 3069-3082) records
the human's property pick as a staged_intake_matches row with confidence 1.0 but
writes NO staged_intake_feedback row. Fix:
1. On every pick/reject verdict, insert into staged_intake_feedback
   (intake_id, match_id, decision approved/rejected/corrected, corrected_entity info,
   decided_by, match_reason + confidence_band copied from the machine's latest match
   row — read api/_handlers/intake-feedback.js:149 for the canonical shape; reuse
   its writer rather than duplicating).
2. Also emit feedback on staged-intake promotions (api/admin.js promote path) where
   the human accepted the machine's #1 suggestion unchanged = implicit approve.
3. Backfill: staged_intake_promotions (4,234 rows) joined to their final
   staged_intake_matches row → historical feedback rows, batch-tagged
   source='backfill_w1_1'.
4. Confirm the nightly compute_matcher_accuracy() cron is live and
   v_matcher_accuracy_recent returns bands after backfill.
admin.js is >200KB — patch-script method only, per session rules.
Verification SQL in the PR description: counts by decision, by confidence_band.
```

#### W1.2 · Reply propagation → template learning — **Claude Code**
```
Close the template loop (audit finding 3.4.4). sf-activity-ingest.js:679 already
detects a two-way reply and advances cadence. Extend it:
1. When a reply is attributed to a contact with a template_sends row in the last 45
   days, PATCH that row replied=true (+replied_at), and emit a signals row
   signal_type='template_response' (the shape high_performing_templates in
   schema/027_signal_feedback_rules.sql expects).
2. Remove the hardcoded false for replied in api/_shared/templates.js:338-340 —
   initialize null, meaning "not yet observed".
3. Verify evaluateTemplateHealth and chooseBestTemplate read correctly with the new
   data (template-refinement.js:86-111, templates.js:431-462).
Verification: unit test with a fixture reply; weekly template-health report renders
non-zero once one reply exists.
```

#### W1.3 · Bug-fix bundle (five small, verified defects) — **Claude Code**
```
Fix five audited defects in one branch, one commit each:
1. api/admin.js:970-977 fetchExcludedRefs: paginate past 5,000 (copy the paging
   pattern already used at admin.js:9077-9086); on fetch error, fail the lane visibly
   instead of returning an empty exclusion set.
2. get_contact_recommendation_weight called with the wrong ID space: callers pass
   unified_contacts.unified_id but signals.entity_id stores entities.id. Fix BOTH
   call sites (api/_shared/briefing-data.js:608 and
   supabase/functions/daily-briefing/index.ts:749) by resolving unified_id →
   entity_id before the call (or change the function to accept either; pick one,
   document it).
3. Emit recommendation_ignored: when a research task is dismissed in the Research
   page / Decision Center, write a signals row with that type so
   ignored_recommendation_contacts and the generator skip-set
   (admin.js:9062-9066) work.
4. chain-connect-tick starvation (admin.js:6535-6551): replace the
   fetch-window arithmetic with a proper cursor (last processed property_id per
   ledger) so the tick always advances. lcc_chain_connection_log already stores
   the ledger.
5. fl-sos-enrich-link.js:94-96 stage 2: add ORDER BY, a compared_at watermark
   column (migration), and predicate compared_at IS NULL so every enriched owner
   is compared exactly once.
Each fix: verification query/test in the commit message.
```

#### W1.4 · LLC research revival — **Cowork first, then Code**
```
(Cowork) Revive the parked LLC research pipeline (audit finding 3.2, ~2,040 rows
deferred):
1. In dia + gov llc_research_queue, requeue deferred rows whose state='FL':
   status='queued', retry-count reset, batch-tagged. Report how many.
2. Decision point for me: OpenCorporates paid key (adds all 50 states via API,
   ~$/lookup) vs expanding the Sunbiz-style bulk mirror to TX/CA/OK next. Give me
   cost estimates based on the deferred rows' state distribution (query it).
(Code, after my decision) 3. Implement the promised-but-missing bulk requeue path:
   when a new SOS adapter/key becomes available, a tick that requeues deferred and
   failed rows matching the newly-supported jurisdiction (the comment at
   admin.js:6327 promises this; nothing implements it). 4. Also requeue
   status='failed' rows with retry_count < cap on a weekly cron.
```

#### W1.5 · CMS patient-count fix — **Claude Code, in the DialysisProject repo**
```
(Run in the DialysisProject repo, not life-command-center.) The daily CMS
patient-count ingest has written no new real monthly data since snapshot_date
2025-03-01, while logging "New facility_patient_counts inserted: 7534" every run.
Forensics from the LCC audit (see life-command-center/audit/data-flow-2026-05-30/
CLAUDECODE_PROMPT_CMS_patient_counts_snapshot_diagnostic.md):
- The inserted-count log line is a derivation counter, not a DB write counter.
- The upsert keys on (medicare_id, snapshot_date) and the run derives an
  already-loaded snapshot_date, so attempted_writes=0 every day.
Diagnose which upstream CMS dataset/file the snapshot_date is derived from, why it
stopped advancing after 2025-03, and fix so that (a) new CMS monthly releases are
detected and loaded, (b) the log reports actual DB writes, (c) a zero-write run
against a NEW source file raises an alert through the existing ingestion_tracker →
lcc_health_alerts path. Then backfill 2025-04 → present.
Verification: SELECT max(snapshot_date) FROM facility_patient_counts WHERE
date_part('month',snapshot_date) NOT IN (12) — must be within 60 days of today.
```

#### Wave 1 verification — **Cowork**
```
Verify Wave 1 landed: (1) staged_intake_feedback row count > 4,000 and growing after
a day's intake activity; (2) matcher_accuracy_stats populated;
(3) a test reply flips template_sends.replied; (4) llc_research_queue FL deferred
count = 0; (5) fetchExcludedRefs paging — pick the largest decision_type and confirm
excluded refs > 5,000 are honored; (6) facility_patient_counts max monthly
snapshot advanced. Write results to a dated file in docs/history/.
```

---

### WAVE 2 — Provenance spine hardening (weeks 3–4)

#### W2.1 · lcc_merge_field concurrency + invariant — **Claude Code**
```
Harden lcc_merge_field (audit findings 3.3.2): migration on LCC Opps that
1. dedupes existing duplicate live rows (keep newest recorded_at, tiebreak id desc;
   demote losers to decision='superseded', log to a reversible ledger),
2. adds partial unique index on (target_database, target_table, record_pk_value,
   field_name) WHERE decision='write',
3. rewrites lcc_merge_field (current body:
   supabase/migrations/20260616122000_...) to take a per-key advisory lock
   (hashtext of the four key parts) around the read-decide-write, and order by
   recorded_at DESC, id DESC.
Load-test note in PR: sidebar sale PATCH fans ~20 concurrent RPCs (one per column,
field-priority-guard.js:230-240) — test with 20 parallel calls on one record.
```

#### W2.2 · Record effect, not intent — **Claude Code**
```
Fix provenance/diagnostics recording order in sidebar-pipeline.js (audit 3.3.3).
Currently: provenance is written before the PATCH, and the post-write flush at
:6011-6034 pushes the UNFILTERED saleData, so fields blocked by the strict gate are
recorded as written; recordSalesParserDiagnostic (:6268-6302) reads ctx.saleData so
written_* booleans measure intent. Change:
1. Flush provenance AFTER a successful PATCH, from the filtered payload actually sent.
2. On PATCH failure, write the provenance rows with decision='failed_write' (add the
   enum value) so the ledger never claims a value that didn't land.
3. Point recordSalesParserDiagnostic's written_* fields at the filtered+succeeded set.
4. Also: add 'updated_at' to BOOKKEEPING_PROV_FIELDS (:260-265) — it currently gets
   its own provenance row on every capture; and stop recordFieldProvenance dropping
   explicit nulls (:270) — record them as decision='cleared' so cleared fields can
   be refilled under warn/strict (audit 3.3.8).
sidebar-pipeline.js is 11k lines — patch-script method, verify function-level greps
after write. This change re-baselines v_sales_parser_miss_rates_7d; note the metric
discontinuity date in the migration comment.
```

#### W2.3 · Watermark mirror sync — **Claude Code**
```
Replace page-ceiling pg_net mirrors with watermark sync (audit 3.3.4/5). For each of
lcc_sync_property_attributes (ceilings 14/18 pages,
migrations/20260522280000:100-104), lcc_sync_property_owner_facts
(20260608130000:70-72), lcc_sync_listing_events (bare limit=1000, 20260529200000:52):
1. Add a per-(leg, domain) watermark table; fetch WHERE updated_at > watermark
   ORDER BY updated_at LIMIT page, loop in the finalize step until an empty page or
   a hard time budget; advance watermark only on consumed 200s (drop the blind TTL
   discard of inflight rows).
2. Guard the stale-overwrite: finalize must skip a page whose fetch watermark is
   older than the row's current mirrored updated_at.
3. Add per-mirror freshness rows (all four mirrors, not just property_attributes) to
   lcc_check_bd_sync_freshness (20260602:50-51), and add every lcc-*-sync/finalize
   cron + dia/gov propagate-recompute crons to the disabled-cron watchdog allowlist
   (20260615121000:51-60).
Gov is at 20,175 properties vs an 18-page ceiling — treat as urgent.
Verification: row counts LCC mirror vs domain source per table, must match ±0.1%.
```

#### W2.4 · Null semantics + listing-event retraction — **Claude Code**
```
1. Document + unify mirror null semantics (audit 3.3.6): property_attributes stays
   fill-blanks (add a cleared-field tombstone path: domain null + provenance
   'cleared' → clear the mirror); owner_facts stays last-writer-wins — but add
   comments in both migrations stating the chosen model.
2. lcc_listing_events retraction: recurring step in the mirror-reconcile cron that
   marks events whose source sale flipped to transaction_state != 'live' as
   retracted, and exclude retracted from v_lcc_buyer_spe_entities_live and the
   P-BUYER pool (20260615132000:15-23).
```

#### W2.5 · Drain the provenance event logs — **Claude Code**
```
Build the two "future" flush crons (audit 3.3.1): dia.provenance_event_log (94 rows)
and gov.provenance_event_log (16,860 rows) were designed to drain to LCC Opps
field_provenance via lcc-provenance-event-flush (see the R2-W-1b/2b comments in the
20260519110000 migrations, both DBs). Implement: batched pg_net pull from each
domain (watermark on event id), transform to lcc_merge_field calls with
source='domain_trigger', mark drained. Then field_source_priority decisions stop
arbitrating against phantom state for trigger-driven writes.
After it's live + backlog drained, re-audit the warn-mode conflict rate
(v_field_source_priority summary views) and propose the next strict-mode cohort.
```

#### Wave 2 verification — **Cowork**
```
Verify Wave 2: (1) zero duplicate live field_provenance keys (query the partial
index's predicate); (2) mirror counts match domain sources on all four mirrors;
(3) gov provenance_event_log undrained count trending to 0; (4) parser diagnostics
now show written_*=false for a deliberately blocked strict-field test capture;
(5) all propagation crons appear in the watchdog. Write results to docs/history/.
```

---

### WAVE 3 — Ownership engine activation + queue triage (weeks 5–7)

#### W3.1 · County scraper fix — **Claude Code, in the GovernmentProject repo**
```
(Run in GovernmentProject.) Per SPEC_deed_county_ingestion_fix.md and
GAPS_AND_FINDINGS_REGISTER.md item on parcel orphaning in life-command-center:
the county scraper knows property_id at fetch time but doesn't persist it, and drops
situs_address/apn/mailing_address — 9,402 gov parcel owner names are orphaned.
1. Persist property_id, apn, situs_address, mailing_address, county FIPS on every
   parcel_records/deed_records write.
2. Re-scrape the orphaned parcels' counties for currently-tracked properties
   (worklist = gov properties with no parcel linkage, ranked by property value).
3. Stand up the recurring county-ingest cron both specs say doesn't exist —
   monthly per county authority, cursored, with per-county failure isolation and a
   gsa_source_pull_log-style ledger.
Note: mailing_address is the fuel for the ORE shared_mailing_address signal
(weight 50) which is currently starved — this unblocks W3.2.
```

#### W3.2 · ORE activation — **Claude Code**
```
Activate the owner reconcile engine (audit 3.2.3): 
1. Schedule lcc-owner-reconcile-engine (the drain deliberately left unscheduled in
   20260716141000:13-19) at a conservative limit (25/hour) with auto-merge OFF —
   verdicts only.
2. Surface v_lcc_owner_reconcile_review as a Decision Center lane (follow the
   existing lane pattern in ops.js:1661-1680 + admin.js federated lanes), showing
   the evidence trace (lcc_owner_reconcile_evidence) per candidate with
   approve/reject.
3. Approvals call the existing lcc_merge_entity path; decisions write
   lcc_decisions (don't-re-ask) AND a labeled pair into a new
   entity_match_labels table (owner_a, owner_b, verdict, evidence_json,
   decided_at) — this is training data for Wave 4.
4. Add queue-depth alert for lcc_owner_reconcile_queue (986 queued today).
ops.js is >200KB — patch-script method.
```

#### W3.3 · Retire the dangerous mergers — **Claude Code**
```
Two auto-writers contradict the ORE's evidence standard (audit 3.2.1/3.2.2):
1. gov owner_merge_tick() (gov migration 20260524110000:36-73) hourly auto-merges
   recorded_owners on canonical_name equality, where the normalizer strips
   group/partners/company/co — "Smith Group LLC" + "Smith Partners LP" merge. 
   Change: keep the tick but require the merged names to be name-core variants
   under the ORE's stricter lcc_institution_norm-style check AND route non-trivial
   collapses (>1 token stripped) into owner_unification_review_queue instead of
   merging. Audit the last 90 days of its merges (dq5_owner_merge_log) for
   false merges; produce an unmerge worklist.
2. The gov recorded→true owner resolver is an unanchored substring ilike with no
   threshold (sidebar-pipeline.js:9411-9483). Replace with: exact normalized match
   auto-links; non-exact goes to entity_match_candidates with a similarity score;
   never write true_owner_id from a substring hit. 
Both: reversible ledgers, before/after counts in PR.
```

#### W3.4 · Orphan queue sweep — **Claude Code** (one session per queue, or one big session)
```
Give every orphan queue a drain or a funeral (audit 3.4, table of dangling loops):
1. dia/gov_comp_review_queue (86+96 open): add an MCP tool list_comp_reviews +
   resolve action in mcp/comps-tools.js, and a Decision Center lane. The comps
   engine already preserves human status on re-pull — the disposition column just
   needs a writer.
2. owner_unification_review_queue (gov, 2,574): fold into the W3.2 review lane
   (same verdict shape) — it becomes a second seeder for entity_match_labels.
3. entity_match_candidates (1,340 dia + 1,483 gov, status='pending_review',
   zero readers): same lane, third seeder.
4. property_metadata_backfill_queue: its manual-review view is psql-only; surface
   the prioritized worklist (v_property_metadata_backfill_queue, has suggested
   CoStar URLs) as a simple page under Research.
5. Render the six computed-but-unrendered /api/review-counts lanes in ops.js
   (:1649-1653 currently extracts only sos_owner_links).
6. gov ownership_research_queue (57,130 rows, write-only, still growing): STOP the
   writer first (find it — it's in the external pipeline; add a gate), then triage:
   rows with ai_confidence ≥ threshold + corroborating current data → auto-verify
   batch; rest → archive with a sampling lane. Do NOT surface 57k rows to a human.
Every queue gets: depth alert + SLA row in the health framework.
```

#### W3.5 · Listing-BD consumer — **Claude Code**
```
Fix the largest producer/consumer imbalance (audit 3.4.2): listing_bd_runs produced
~1,080 runs/14d of inbox fan-out; the templates it feeds have 0 sends in 120 days.
1. Inbox: add a listing_bd filter chip + grouped-by-listing view (one card per
   listing with its N matched contacts, not N cards).
2. Wire the batch-draft action: selected contacts → POST /api/operations?_route=
   draft&action=listing_bd (endpoint exists at operations.js:6381, no caller).
3. Dedupe: a contact matched by 3 listings in a week gets ONE draft covering all
   three (group by contact in the drain).
4. Expiry sweep: listing_bd inbox items auto-dismiss when their listing goes
   off-market/sold (join lcc_listing_events).
5. template_sends wiring from the drafts so W1.2's reply loop measures this
   channel from day one.
```

#### Wave 3 verification — **Cowork**
```
Verify Wave 3: ORE lane live with evidence rendering; owner_merge_tick false-merge
audit results; substring resolver retired (grep + a test capture);
entity_match_labels accumulating; all six orphan queues have a drain and a depth
alert; ownership_research_queue writer gated; listing-BD: one end-to-end draft from
a real listing. Also re-run the audit's coverage queries (props without ownership,
sales missing parties) and log the trend vs the 2026-07-29 baseline in docs/history/.
```

---

### WAVE 4 — Entity-resolution modeling (weeks 8–10)

#### W4.1 · Training-data export — **Cowork**
```
Assemble the entity-resolution training set from live DBs into a single labeled
pairs dataset (CSV/parquet in the session, then to Supabase Storage):
positives: dq5_owner_merge_log (dia 2,946 + gov 2,374), dq5_true_owner_merge_map,
dq7 maps, entity_merge_log (gov 182), lcc_decisions where decision_type is a
merge/link type (3,566 total — filter), _recon_merge_log (1,116), the Boyd
Watterson reconciliation (20260725120000 migration), entity_match_labels (new,
from W3.2); implicit positives: staged_intake_promotions where the machine's #1
match was accepted. negatives: lcc_decisions rejections, staged_intake_feedback
rejections, and hard negatives sampled from same-city different-owner pairs.
Normalize each record to {name_a, name_b, addr_a, addr_b, state_a, state_b,
sf_account_a/b, label, source, decided_at}. Report class balance and a 80/10/10
split by entity (not by pair, to avoid leakage).
```

#### W4.2 · Splink + libpostal resolver service — **Claude Code**
```
Build the entity-resolution microservice (audit §4.3.1-2). New top-level dir
resolver/ (Python, FastAPI, DuckDB + splink + libpostal(postal) + 
sentence-transformers bge-small-en-v1.5):
1. Endpoints: POST /normalize (libpostal address + company-name normalization),
   POST /match {left:[], right:[], model:'owner_sf'|'owner_owner'|'contact'} →
   calibrated probabilities + comparison vector explanations,
   POST /train (rebuild m/u params from the labeled set in Storage).
2. Blocking: normalized-token blocks + pgvector-style embedding KNN fallback for
   non-overlapping-token cases (embed with bge-small, cosine > 0.8 candidates).
3. Deploy: Dockerfile targeting a Railway service (CPU-only). Health endpoint.
4. Calibration report on the W4.1 test split: precision/recall at thresholds;
   pick auto-link (target precision ≥0.995) and auto-reject bands; write the
   report to docs/resolver/CALIBRATION.md.
No writes to any DB from this service — it only scores.
```

#### W4.3 · SF-link backlog run — **Cowork** (after W4.2 calibration approved)
```
Drain sf_link_research_queue (30,711 rows) through the resolver:
1. Batch-score all queued rows (gov 27,605 + dia 3,106) against SF accounts via
   the resolver service.
2. Auto-link ≥ auto-link band: write through the EXISTING sf-link attach path
   (admin.js:7396 logic — call the endpoint, don't reimplement) with
   source='splink_v1' and the probability as confidence, provenance-registered.
3. Auto-reject ≤ reject band: status='no_match', batch-tagged.
4. Middle band → needs_review, and confirm the W3.4 lane picks them up.
Report the split sizes first; I approve before writes. Target: human middle band
< 3,000 rows. Every human verdict on the middle band writes entity_match_labels
(retraining data).
```

#### W4.4 · Model as provenance citizen + retraining loop — **Claude Code**
```
1. Register splink_v1 in field_source_priority for the link fields it writes,
   priority between costar_sidebar and manual (record_only first).
2. Nightly job: new entity_match_labels rows → append to the training set in
   Storage; weekly /train + recalibration report; alert if precision on the
   holdout drops >1pt.
3. Point the ORE's candidate scorer at the resolver for its name-similarity
   signal (replace the whole-token-prefix heuristic in 20260716140000:385-410
   with a resolver call, keeping the SQL heuristic as fallback when the service
   is down — fail closed to 'needs_review', never fail open to merge).
```

---

### WAVE 5 — Extraction models + signal automation (weeks 11–13)

#### W5.1 · Party extraction from sale notes — **Claude Code**
```
Stand up GLiNER-based party extraction (audit §4.3.4) in the resolver/ service:
1. Endpoint POST /extract-parties: text → {buyer, seller, listing_broker,
   procuring_broker, lender, price, cap_rate, spans}. Use gliner_medium-v2.1 with
   CRE-tuned labels; fall back to the existing regex extractors as a comparison
   channel, logging disagreements.
2. Backlog job (Cowork can orchestrate): run over sale_notes_raw where the sale is
   live and missing buyer/seller/broker (dia: 1,315 missing buyer, 2,216 missing
   listing broker; gov: 1,174 / 3,373). Writes go through the field-priority
   guard with source='gliner_extract', confidence 0.55 (below costar_sidebar) —
   fill-blanks only, never override.
3. Sample 100 extractions to a review sheet for me before enabling the bulk run.
Success metric: missing-broker rate on live sales drops by >20 points.
```

#### W5.2 · Signal → task automation — **Claude Code**
```
Give the three orphaned signal streams a path to BD work (audit 3.4.1):
state_lease_events (577 rows, processed_at seam already in schema),
agency_risk_signals (13,888), and NPI signals (mv_npi_inventory_signals).
For each: a consumer tick that (a) filters to high-value events (rank thresholds —
propose them from the data), (b) creates a research_task or priority-queue entry
with a structured payload (NOT prose instructions — the task carries entity ids +
a deep link), (c) marks processed, (d) don't-re-ask via lcc_decisions.
Model it on the working listing_event consumer (admin.js:2008-2070 +
20260619210000 migration). Kill the pattern where a task's instructions tell the
human to run SQL by hand.
```

#### W5.3 · Local LLM tail (optional, decide after W4/W5.1) — **Cowork to evaluate**
```
Evaluate whether a local 7-8B model earns its keep for the judgment tail
(LLC→sponsor inference, SOS officer-name interpretation, research triage):
1. Sample 200 recent cases; run gpt-4o-mini (current) vs Qwen3-8B-Q4 via Ollama on
   a rented GPU box; score agreement with human labels from entity_match_labels.
2. Report monthly API spend on these paths (gpt_usage_logs) vs hosting cost.
Recommend adopt/skip. Skip is a fine answer — volumes may not justify it.
```

---

### WAVE 6 — Structural consolidation (quarter-end, ongoing)

Run these as capacity allows; none block Waves 1–5:

- **W6.1 (Code):** Fetcher/extension CI contract — bring `GovernmentProject`, `DialysisProject`, and the Chrome extension into the monorepo (or git submodules + a CI job that greps fetcher writes against `domain_table_columns`); stamp `extension_version` on every sidebar capture; reject captures from versions older than N.
- **W6.2 (Code):** dia/gov SQL templating — one `.sql.tpl` + build script generating both migrations; retrofit the known-diverged pairs first (`propagate_sales_recompute`, `recompute_caps_for_property`); CI diff of function bodies between the two DBs as a drift alarm.
- **W6.3 (Code):** `unified_contacts` home decision — migrate to LCC Opps permanently, delete `CONTACTS_HUB`, add the missing dia/gov id backlinks (`gov_contact_id`/`dia_contact_id` are 0-populated today).
- **W6.4 (Code):** Deprecate `api/sync.js`'s RCM/LoopNet copy; delete the dead `sos-lookup.js` stub framework; delete `pipeline/` FastAPI dead code or give it a real deploy — decide, don't leave it ambiguous.
- **W6.5 (Code):** Front-end decomposition — split `detail.js` (879KB) and `app.js` (643KB) by tab/route behind a bundler; this directly de-risks the documented Edit-truncation incidents in your AI-assisted workflow.
- **W6.6 (Cowork, monthly):** Standing audit cadence — re-run the coverage + queue-health queries from the 2026-07-29 baseline, `get_advisors` on all three projects, archive-schema drop-date sweep, and a one-page trend report. (I can set this up as a scheduled task whenever you want.)

---

## Part 4 — Sequencing rationale (why this order)

1. **Wave 0 before everything:** clean root + distilled CLAUDE.md makes every subsequent AI session cheaper and safer; the archive schema shrinks the blast radius of later migrations; the inert-feature registry prevents "built but silently off" from recurring during the rollout itself.
2. **Wave 1 before modeling:** every model in Wave 4–5 trains on labels; W1.1 starts accumulating them 6+ weeks before the first model needs them.
3. **Wave 2 before Wave 3–4 writes:** ORE activation and the SF-link backlog run push thousands of writes through the provenance system — harden concurrency and record-effect first, so those runs are measured accurately and reversibly.
4. **W3.1 (county) before full ORE trust:** the address signal is the ORE's second-strongest and currently has ~zero fuel; activating the engine at scale before feeding it addresses would burn human review time on weak-evidence verdicts.
5. **Wave 4 before draining the 30k backlog by hand:** the resolver turns a 30k-decision human job into a <3k one; doing the backlog manually first would waste the labels' leverage.
6. **Wave 6 whenever:** consolidation reduces recurring tax but nothing in it gates the value delivery of Waves 1–5.
