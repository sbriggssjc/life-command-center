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
