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
| W0.1 | Repo root cleanup (.gitignore, move worklogs to docs/history/) | ⬜ | Claude Code session |
| W0.2 | Distill CLAUDE.md ≤30KB | ⬜ | Claude Code session |
| W0.3 | Archive schema + bloat + agency_debt_programs move | ✅ 2026-07-29 | Cowork. archive schema + manifest on dia+gov. Moved: 36 dia backup/ledger tables (incl. field_cleanups — NOT empty as audit claimed: 838k rows, legacy correction log dormant since 2025-10; and agency_debt_programs 1.6GB, zero code refs, Scott-approved) + 15 gov backup tables + 4 gov DEPRECATED tables. Excluded: _sweep_candidates_2026_06_11 (referenced by cleanup-contaminated-hertz-lease.mjs). VACUUM FULL pending_updates: 196MB→2.2MB. Drop-after dates in archive.manifest (90d default). |
| W0.4 | Inert-feature registry + briefing digest | ⬜ | Claude Code session |
| W0.5 | Retention policies for mega-tables | ⬜ | Cowork |
| W0.6 | dia Postgres 15.8 → 17 upgrade | ⬜ | MANUAL (Scott, Supabase dashboard; before 6am UTC crons). Decided 2026-07-29: track here, revisit at W1.V |
| W0.7 | anon EXECUTE revoke on SECURITY DEFINER fns (103 LCC / 61 dia / 38 gov) | ⬜ | Code session: grep front-end for anon-key supabase.rpc() calls first, then revoke migration excluding those. Scott-approved audit-first 2026-07-29 |
| W0.V | Advisors triage (all 3 projects) | ✅ 2026-07-29 | Cowork. 0 ERROR-level on all 3. WARNs: anon/authenticated SECURITY DEFINER execute (→W0.7); function_search_path_mutable (130/150/228 — defer, bundle with W0.7 migration); rls_policy_always_true (6 gov/16 dia — review in W0.7 session); materialized_view_in_api (2/5/13 — review); dia vulnerable_postgres_version (→W0.6); leaked-password protection off on LCC (dashboard toggle). 136/120/224 RLS-no-policy INFO = service-role-only by design, accepted. |
| W0.3v | Archive verification + code-reference audit | ✅ 2026-07-29 | Claude Code. See "W0.3 verification" below. Manifest ↔ archive 1:1 on both DBs (dia 35/35, gov 17/17, 0 orphans, 0 public name-collisions). **2 archived tables still referenced by RUNTIME code** (contradicts W0.3 "no code refs"): dia `field_cleanups` (LOW, graceful) + gov `lease_lifecycle_events` (MEDIUM, user-path errors). dq5_/dq7_ correctly left in public. |

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

## Session log

- **2026-07-29 (Cowork):** Baseline audit + rollout plan produced and committed to docs/audits/. W0.3 executed: archive schema live on dia+gov, 56 tables archived (incl. agency_debt_programs 1.6GB + field_cleanups 838k rows), pending_updates VACUUMed 196MB→2.2MB. Advisors triaged (0 errors; W0.6/W0.7 opened from findings). CORRECTION to plan Part 1: field_cleanups was NOT empty — stale stats; it is a legacy correction ledger (838k rows, dormant since 2025-10), archived not dropped. Decision logged to Cortex memory.
- **2026-07-29 (Claude Code, W0.3v):** Verification-only pass over the already-applied W0.3 moves (no new migrations; dq5_/dq7_ left in public per Scott). Manifest ↔ archive 1:1 on both DBs (dia 35/35, gov 17/17, 0 orphans, 0 public collisions). Observed a concurrent Cowork/MCP session un-archiving 4 tables mid-pass (dia agency_debt_programs + cap_recompute_backup; gov cap_recompute_backup + gov_sale_lease_date_backup) — manifests stayed consistent. **Code-reference audit found 2 archived tables still referenced by runtime code**, contradicting the W0.3 "no code refs" note: dia `field_cleanups` (LOW — `run_field_cleanups()` degrades gracefully but is now dead-lettered) and gov `lease_lifecycle_events` (MEDIUM — `research_artifacts.py`/`write_services.py` lease-activity promotion SELECT+INSERT now error). Details + recommended actions under "W0.3 verification" above. Advisors re-confirmed (0 errors); duplicate-index cleanup + LCC leaked-password toggle flagged as safe do-now.
