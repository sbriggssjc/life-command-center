# LCC Audit Rollout — Living Status Tracker
**Baseline audit:** `docs/audits/LCC_Data_Architecture_Audit_2026-07-29.md`
**Execution plan:** `docs/audits/LCC_Audit_Rollout_Plan.md`
**Convention:** update this file at the end of every working session (Cowork or Claude Code). One line per unit: status, date, session type, verification result. Statuses: ⬜ not started · 🟨 in progress · ✅ done · ⛔ blocked · 🚫 skipped (with reason).

## Baseline metrics (2026-07-29, from live DBs — re-query at each wave verification)

| Metric | dia | gov |
|---|---|---|
| Properties without ownership_history | 8,382/12,312 (68%) | 13,148/20,175 (65%) |
| Live sales missing buyer | 1,315/3,575 | 1,174/5,689 |
| Live sales missing listing broker | 2,216/3,575 | 3,373/5,689 |
| true_owners without contact | 5,588/7,021 | — |
| llc_research_queue deferred | 1,155 | 885 |
| sf_link_research_queue queued | 3,106 | 27,605 |
| ownership_research_queue unverified | — | 57,130 |
| staged_intake_feedback rows (LCC) | 1 | |
| template_sends replies (LCC) | 0/60 | |
| field_provenance enforce: strict/warn/record_only (LCC) | 76 / 78 / 1,851 | |
| CMS patient counts latest real monthly | 2025-03-01 | |

## Wave 0 — Hygiene & guardrails

| Unit | What | Status | Notes |
|---|---|---|---|
| W0.1 | Repo root cleanup (.gitignore, move worklogs to docs/history/) | ✅ 2026-07-29 | **PR #1492.** 54 docs → docs/history/ + INDEX.md; 14 artifacts untracked/removed; 18 refs repointed; tests green (2236 pass). AUDIT_PROGRESS.md + SALES_AND_AVAILABLE_COMPS...AUDIT stayed at root (referenced from .js comments — revisit in W6.5 front-end split). |
| W0.2 | Distill CLAUDE.md ≤30KB | ✅ 2026-07-29 | **PR #1493.** CLAUDE.md 569KB→24.5KB (theme-organized: topology, write-surface rules, doctrines, footguns); AGENTS.md 32KB→3.5KB (also corrected stale Vercel invariants); full originals archived verbatim to docs/history/. |
| W0.3 | Archive schema + bloat + agency_debt_programs move | ✅ 2026-07-29 | Cowork. archive schema + manifest on dia+gov. Moved: 36 dia backup/ledger tables (incl. field_cleanups — NOT empty as audit claimed: 838k rows, legacy correction log dormant since 2025-10; and agency_debt_programs 1.6GB, zero code refs, Scott-approved) + 15 gov backup tables + 4 gov DEPRECATED tables. Excluded: _sweep_candidates_2026_06_11 (referenced by cleanup-contaminated-hertz-lease.mjs). VACUUM FULL pending_updates: 196MB→2.2MB. Drop-after dates in archive.manifest (90d default). |
| W0.3v | Independent verification of W0.3 (Code session) | ✅ 2026-07-29 | **PR #1494.** Manifests 1:1 both DBs (dia 35 / gov 17 post-restores), 0 orphans/collisions. Found 2 sibling-repo code refs the Cowork sweep missed (repo-only grep can't see DialysisProject/GovernmentProject): see W0.3h + W0.3i. Standing rule extended: archive sweeps must also grep the SIBLING repos. |
| W0.3f | Remove agency_debt_programs ref from merge_dialysis_dup_property, then re-archive the table | ⬜ | Code session; Scott already approved the archive |
| W0.3g | Restore gov lease_lifecycle_events (reachable user path was erroring) | ✅ 2026-07-29 | Cowork migration `w0_3g`. research_artifacts.py lease-activity promotion → write_services.py:537 INSERT was failing post-archive. |
| W0.3h | Repoint lease-activity promotion path to gsa_lease_events, then re-archive lease_lifecycle_events | ⬜ | Code session on PR #1494 branch (it offered to draft — say yes). GovernmentProject repo. |
| W0.3i | field_cleanups decision: ~15 Dialysis/src modules still reference the archived table (degrades gracefully; engine dormant since 2025-10) | ⬜ | RECOMMENDED: accept archive + retire the run_field_cleanups() path in the W1.5 DialysisProject session (same repo, one trip). |
| W0.4 | Inert-feature registry + briefing digest | ✅ 2026-07-29 | **PR #1495.** feature_flags_registry live on LCC Opps, 22 flags (19 env vars + 3 SOS adapters, 0 phantoms); "Dormant Capabilities" section in briefing email. Corrections: audit's OWNER_ENRICH_SOS_ADDRESS_URL is actually OWNER_ENRICH_ADDRESS_URL; SF_LIST_IMPORT_URL is a PA-flow gate not an env check. Registry is operator-curated — flip state to 'on' when actually enabling. |
| W0.5 | Retention policies for mega-tables | ✅ 2026-07-29 | Cowork. dia: `dia_retention_prune()` + daily 03:20 cron + retention_prune_log; windows: learning_logs 90d / ingestion_run_errors 90d / data_corrections 365d (conservative — first deletes ~2026-12). Backlog cleared in-session: 1,271,186 learning_logs + 160,769 ingestion_run_errors rows. field_aliases EXCLUDED (operational alias→canonical reference, not a log). LCC Opps existing prunes verified active (field_provenance 90d, sf_sync_log 30d, context packets 7d, research tasks, intake artifacts). |
| W0.5b | gov gsa_inventory_snapshot_lines parquet offload decision | ⬜ | Proposal registered: 866k of 1.16M rows (75%) are >24mo old (2013–mid-2024). Offload = export by year to Storage as parquet + delete. Deferred: verify historical analyses read gsa_lease_change_facts/timeline, not raw lines, first. |
| W0.6 | dia Postgres 15.8 → 17 upgrade | ⬜ | MANUAL (Scott, Supabase dashboard; before 6am UTC crons). Decided 2026-07-29: track here, revisit at W1.V |
| W0.7 | anon EXECUTE revoke on SECURITY DEFINER fns (103 LCC / 61 dia / 38 gov) | ⬜ | Code session: grep front-end for anon-key supabase.rpc() calls first, then revoke migration excluding those. Scott-approved audit-first 2026-07-29 |
| W0.8 | Duplicate-index cleanup (28 dia / 13 gov / 3 LCC, from performance advisors) | ⬜ | Safe do-now per PR #1494 triage; Cowork or fold into W0.7 migration session |
| W0.V | Advisors triage (all 3 projects) | ✅ 2026-07-29 | Cowork. 0 ERROR-level on all 3. WARNs: anon/authenticated SECURITY DEFINER execute (→W0.7); function_search_path_mutable (130/150/228 — defer, bundle with W0.7 migration); rls_policy_always_true (6 gov/16 dia — review in W0.7 session); materialized_view_in_api (2/5/13 — review); dia vulnerable_postgres_version (→W0.6); leaked-password protection off on LCC (dashboard toggle). 136/120/224 RLS-no-policy INFO = service-role-only by design, accepted. |
| W0.3v | Archive verification + code-reference audit | ✅ 2026-07-29 | Claude Code. See "W0.3 verification" below. Manifest ↔ archive 1:1 on both DBs (dia 35/35, gov 17/17, 0 orphans, 0 public name-collisions). **2 archived tables still referenced by RUNTIME code** (contradicts W0.3 "no code refs"): dia `field_cleanups` (LOW, graceful) + gov `lease_lifecycle_events` (MEDIUM, user-path errors). dq5_/dq7_ correctly left in public. |
| W0.3h | Repoint gov lease-activity promotion → `gsa_lease_events` | ✅ 2026-07-29 | Claude Code (government-lease `claude/supabase-schema-cleanup-wxcz9x`). Fixes the W0.3v MEDIUM finding: `research_artifacts.py` + `write_services.py` lease-activity screenshot promotion now writes canonical `gsa_lease_events`, not deprecated `lease_lifecycle_events`. Field map + NOT-NULL guards in the commit; 2 unit tests pass. `lease_lifecycle_events` was restored to public 2026-07-29 (w0_3g) so nothing errors now. **⏳ After this deploys AND one successful lease-activity promotion is verified live, `lease_lifecycle_events` gets re-archived** — do NOT drop/archive it before that. |
| W0.3i | Retire dia `field_cleanups` code path | ⬜ | Deferred to a later DialysisProject session (decision W0.3i). LOW: `run_field_cleanups()` degrades gracefully today. Plan = retire the ~8-module read/write path, not un-archive. |

### W0.3 verification (2026-07-29, Claude Code session)

Verified the already-applied W0.3/W0.3c archive moves against live DB state and repo code (`api/`, `mcp/`, `supabase/functions/`, domain `src/`). **No new DB migrations created — verification only** (per Scott's directive to stand down on further moves).

**Manifest consistency — PASS (current live state):**
- **dia** `archive.manifest` = 35 rows ↔ 35 archive tables (excl. manifest), 1:1 both directions, 0 tables missing a manifest row, 0 manifest rows without a table, **0 name-collisions with `public`**.
- **gov** `archive.manifest` = 17 rows ↔ 17 archive tables, same 1:1 / 0-orphan / 0-collision result.
- `_sweep_candidates_2026_06_11` correctly **retained in dia `public`** (not archived) — referenced by `scripts/cleanup-contaminated-hertz-lease.mjs`. ✅
- `dq5_*` / `dq7_*` correctly **left in `public`** — live merge ledgers, not backups (`apply_owner_merge()` wrote `dq5_owner_merge_log` 2026-07-23, 6 days before this audit). ✅

**⚠️ State moved during the session (concurrent Cowork/MCP editing):** counts dropped from my first read (dia 37→35, gov 19→17) because these tables were **un-archived (moved back to `public`)** mid-session: dia `agency_debt_programs` (1.6 GB — the contested federal-data table) + `cap_recompute_backup`; gov `cap_recompute_backup` + `gov_sale_lease_date_backup`. Manifests were updated to match, so the sets remain internally consistent. `gov.public.agency_debt_programs` remains the empty 0-row counterpart (never archived). Net: the W0.3 log's "36 dia + agency_debt_programs / 15 gov + 4 deprecated" is now **dia 35 / gov 17** live.

**Code-reference audit — 2 genuine findings (the W0.3 "zero code refs" claim was incomplete):**
1. **dia `field_cleanups` — LOW (graceful degradation).** ~15 files in `Dialysis/src` still target it, incl. read/write via `client.table("field_cleanups")` in `cleanup_manager.run_field_cleanups()`, `utils_shared.py`, `ai_scrubber.py`, `learn_aliases.py`, `data_cleaner.py`, `post_data_cleaning.py`, digest modules. `run_field_cleanups()` degrades gracefully (`safe_execute` → "aborted: failed to fetch field_cleanups", returns — **no crash**), but the field-cleanups engine is now permanently dead-lettered since the table left `public`. Table was dormant since 2025-10 (superseded by `field_provenance`), so functionally near-neutral. **Action:** accept (dormant) OR un-archive `field_cleanups` to `public` to keep the engine live; ideally retire the code path in a later wave.
2. **gov `lease_lifecycle_events` — MEDIUM (user-triggered path errors).** Reachable runtime path: `research_artifacts.py` "lease_activity" screenshot-observation promotion does a SELECT (`research_artifacts.py:793`) then `apply_evidence_promotion(..., lifecycle_event_row=...)` which INSERTs (`write_services.py:537`). Both now raise (table moved out of `public`) if a gov user promotes a lease-activity observation. Table was already DEPRECATED (replaced by `gsa_lease_events`), so the branch should be retired — but archiving broke it in the interim. **Action:** confirm whether that promotion path is exercised; if yes, repoint it to `gsa_lease_events` OR un-archive `lease_lifecycle_events` before its 2026-10-27 `drop_after`.

**Benign (no action):** dia `data_corrections` refs = the **live** `dia.public.data_corrections` (795k rows), not the gov-archived 0-row table. gov `db_audit.py` lists `data_corrections`/`email_log` as catalog entries ("not used yet") — diagnostic only. All other archived-name hits are the original `CREATE TABLE` statements in `supabase/migrations/**` and `sql/**` (one-time historical DDL, harmless).

**Advisors (Step 5 / W0.V) — re-confirmed consistent:** 0 ERROR-level on all 3 projects. Safe do-now not yet actioned: drop redundant **duplicate indexes** (28 dia / 13 gov / 3 LCC WARN — each is two identical indexes, drop-one is reversible); enable LCC **leaked-password protection** (dashboard toggle); dia **Postgres 15.8→17** patch (→W0.6). Deferred: `function_search_path_mutable`, SECURITY DEFINER anon EXECUTE (→W0.7), `materialized_view_in_api`, `rls_policy_always_true`. Accepted: RLS-enabled-no-policy INFO (service-role-only by design; incl. the new `archive.*` tables, which are not in the exposed API schema).

## Wave 1 — Close the built loops

| Unit | What | Status | Notes |
|---|---|---|---|
| W1.1 | Feedback capture (match picks → staged_intake_feedback + backfill) | ⬜ | HIGHEST LEVERAGE — run first |
| W1.2 | Reply propagation → template_sends + template_response signal | ⬜ | |
| W1.3 | Bug-fix bundle (excludedRefs paging, weight ID space, recommendation_ignored, chain-connect cursor, fl-sos stage2) | ⬜ | |
| W1.4 | LLC research revival (requeue FL deferred; OpenCorporates decision) | ⬜ | Cowork then Code |
| W1.5 | CMS patient-count fix | ⬜ | Code session in DialysisProject repo |
| W1.V | Wave 1 verification | ⬜ | |

## Wave 2 — Provenance spine

| Unit | What | Status | Notes |
|---|---|---|---|
| W2.1 | lcc_merge_field concurrency + unique invariant | ⬜ | |
| W2.2 | Record effect not intent (sidebar provenance ordering) | ⬜ | |
| W2.3 | Watermark mirror sync (gov at 18-page ceiling NOW) | ⬜ | |
| W2.4 | Null semantics + listing_events retraction | ⬜ | |
| W2.5 | provenance_event_log flush crons (gov backlog 16,860) | ⬜ | |
| W2.V | Wave 2 verification | ⬜ | |

## Wave 3 — Ownership engine + queue triage

| Unit | What | Status | Notes |
|---|---|---|---|
| W3.1 | County scraper fix + recurring cron | ⬜ | Code session in GovernmentProject repo |
| W3.2 | ORE activation + review lane + entity_match_labels | ⬜ | |
| W3.3 | Retire lossy owner_merge_tick + substring true-owner resolver | ⬜ | |
| W3.4 | Orphan queue sweep (6 queues) | ⬜ | |
| W3.5 | Listing-BD consumer | ⬜ | |
| W3.V | Wave 3 verification + coverage trend | ⬜ | |

## Wave 4 — Entity-resolution modeling

| Unit | What | Status | Notes |
|---|---|---|---|
| W4.1 | Training-data export (labeled pairs) | ⬜ | Cowork |
| W4.2 | Splink + libpostal resolver service | ⬜ | |
| W4.3 | SF-link 30k backlog run | ⬜ | Cowork, after calibration approval |
| W4.4 | Model as provenance citizen + retrain loop | ⬜ | |

## Wave 5 — Extraction models + signal automation

| Unit | What | Status | Notes |
|---|---|---|---|
| W5.1 | GLiNER party extraction over sale_notes_raw | ⬜ | |
| W5.2 | Signal → task automation (state lease / agency risk / NPI) | ⬜ | |
| W5.3 | Local LLM tail evaluation | ⬜ | Optional |

## Wave 6 — Structural consolidation

| Unit | What | Status | Notes |
|---|---|---|---|
| W6.1 | Fetcher/extension CI contract + extension_version stamping | ⬜ | |
| W6.2 | dia/gov SQL templating + drift alarm | ⬜ | |
| W6.3 | unified_contacts home decision (→ LCC Opps) | ⬜ | |
| W6.4 | Delete dead code (api/sync.js copy, sos-lookup stubs, pipeline/) | ⬜ | |
| W6.5 | Front-end decomposition | ⬜ | |
| W6.6 | Monthly standing audit (scheduled task) | ⬜ | |

## Corrections log

- **2026-07-29:** W0.3 prompt in the plan wrongly listed `dq5_*`/`dq7_*` as archive candidates. They are LIVE ledgers (`apply_owner_merge()` writes dq5_owner_merge_log; hourly gov owner_merge_tick is an active caller; W3.3 audits them). They were never moved; plan text corrected. Lesson applied: before archiving anything, check pg function bodies (`pg_get_functiondef`) for table references, not just views + app code.
- **2026-07-29:** field_cleanups "0 rows" claim was stale planner stats; actually 838k rows (legacy ledger, archived not dropped).
- **2026-07-29 (W0.3e):** The pg-function reference check found 4 archived tables that are live write-targets of running functions: `cap_recompute_backup` (dia AND gov — written by the nightly `*_recompute_caps_*` functions), `gov_sale_lease_date_backup` (written by `gov_guard_sale_lease_dates`), and `agency_debt_programs` (`merge_dialysis_dup_property` repoints `matched_property_id` on every dia property merge). All 4 restored to public via `w0_3e_restore_function_referenced_tables`; manifest cleaned. Post-check: 0 remaining function references to archived tables on both DBs. FOLLOW-UP (W0.3f, Code session): remove the `agency_debt_programs` UPDATE from `merge_dialysis_dup_property`, then re-archive that table per Scott's standing approval. Rule for all future archive/drop work: the sweep MUST include `pg_proc.prosrc` + trigger + view + app-code checks.
- **2026-07-29:** gov's 4 DEPRECATED tables: archived with drop_after=2026-10-27 is the INTENDED end state (Claude Code question answered — no further action; the manifest policy handles the hard drop). EXCEPTION: lease_lifecycle_events restored 2026-07-29 (W0.3g) pending path repoint (W0.3h).
- **2026-07-29 (from PR #1494):** the "zero code refs" check for archived tables was repo-local only. Sibling repos (DialysisProject, GovernmentProject) had live references: field_cleanups (~15 Dialysis/src modules, graceful degradation) and lease_lifecycle_events (erroring user path — restored). RULE: archive/drop sweeps must grep pg functions + triggers + views + THIS repo + BOTH sibling repos.
- **2026-07-29 (from PR #1495):** audit env-var name correction: OWNER_ENRICH_ADDRESS_URL (not OWNER_ENRICH_SOS_ADDRESS_URL); SF_LIST_IMPORT_URL gates a Power Automate flow, not a process.env check.
- **2026-07-29 (from PR #1493):** the "§F Edit-truncation warning" lives in GAPS_AND_FINDINGS_REGISTER.md §F (not in CLAUDE.md/AGENTS.md — the W0.2 session grepped only the latter two and reported it missing). The session-rules block in the rollout plan cites the right source; no change needed, noted to avoid future confusion.

## Session log

- **2026-07-29 (Cowork):** Baseline audit + rollout plan produced and committed to docs/audits/. W0.3 executed: archive schema live on dia+gov, 56 tables archived (incl. agency_debt_programs 1.6GB + field_cleanups 838k rows), pending_updates VACUUMed 196MB→2.2MB. Advisors triaged (0 errors; W0.6/W0.7 opened from findings). CORRECTION to plan Part 1: field_cleanups was NOT empty — stale stats; it is a legacy correction ledger (838k rows, dormant since 2025-10), archived not dropped. Decision logged to Cortex memory.
- **2026-07-29 (Claude Code, W0.3v):** Verification-only pass over the already-applied W0.3 moves (no new migrations; dq5_/dq7_ left in public per Scott). Manifest ↔ archive 1:1 on both DBs (dia 35/35, gov 17/17, 0 orphans, 0 public collisions). Observed a concurrent Cowork/MCP session un-archiving 4 tables mid-pass (dia agency_debt_programs + cap_recompute_backup; gov cap_recompute_backup + gov_sale_lease_date_backup) — manifests stayed consistent. **Code-reference audit found 2 archived tables still referenced by runtime code**, contradicting the W0.3 "no code refs" note: dia `field_cleanups` (LOW — `run_field_cleanups()` degrades gracefully but is now dead-lettered) and gov `lease_lifecycle_events` (MEDIUM — `research_artifacts.py`/`write_services.py` lease-activity promotion SELECT+INSERT now error). Details + recommended actions under "W0.3 verification" above. Advisors re-confirmed (0 errors); duplicate-index cleanup + LCC leaked-password toggle flagged as safe do-now.
- **2026-07-29 (Claude Code, W0.3h):** Repointed the gov lease-activity screenshot-observation promotion from deprecated `lease_lifecycle_events` to canonical `gsa_lease_events` (government-lease: `src/research_artifacts.py` + `src/write_services.py`). Field map: `new_state`→`changed_fields`, `event_type`→`latest_action`, `detected_by`+free-text `notes`→`prospect_notes`; `event_date` coalesced to the promotion date and `lease_number` resolved from the property (both NOT NULL on `gsa_lease_events`); skips (no crash, `skipped_no_lease_number`) when `lease_number` is unresolvable. `tests/unit/test_evidence_promotion_gsa_events.py` (2 tests) pass; both modules import clean. **Pending:** verify one live promotion post-deploy, then re-archive `lease_lifecycle_events` (restored to public via w0_3g). dia `field_cleanups` deferred → W0.3i (DialysisProject session).
- **2026-07-29 (Claude Code ×4, Scott-run):** W0.1 (PR #1492), W0.2 (PR #1493), W0.3 verification (PR #1494), W0.4 (PR #1495) all complete — details in the Wave 0 table. PRs pending merge to main.
- **2026-07-29 (Cowork, session 2):** W0.3g restore (lease_lifecycle_events), W0.5 retention executed (1.43M rows pruned, daily cron live), W0.5b offload proposal registered, W0.8 opened. Wave 0 remaining: W0.3f, W0.3h, W0.3i, W0.6 (manual), W0.7, W0.8, W0.5b — none block Wave 1. **Wave 1 is clear to start; W1.1 (feedback capture) first.**
