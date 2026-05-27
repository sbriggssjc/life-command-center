# Ownership & Sales Remediation — 2026-05-27 Session Status (C5 Phase 2 prep)

Picks up after PR #954 (C5 Phase 1 — ownership_history CHECK + dedup pre-remediation, merged + deployed). Focus this round: **C5 Phase 2 prep — drain the `missing_owner_data` cluster of the overlap review queue**.

## What landed

### Auto-resolve rule

For each pair in `v_ownership_overlap_review_queue` with hint `missing_owner_data`:
- If exactly one row has `true_owner_id IS NULL` AND the other has a populated `true_owner_id` → supersede the NULL-owner row
- If both rows have `true_owner_id IS NULL` BUT exactly one has `recorded_owner_id` populated → supersede the row missing both
- Otherwise leave for analyst review (both rows fully NULL on owners)

The superseded row is purely a sale-event stub (writer set `sale_id` but never resolved the owner). The surviving row carries the canonical ownership record.

### Results

**180 rows superseded → 362 overlap pairs resolved.** (Each superseded row participates in ~2 pairs on average, so fewer rows fix more pairs than the raw pair count suggests.)

Overlap queue progression:

| Phase | Queue size |
|---|---:|
| Pre-A6a | ~3,000+ |
| Post-A6a | 1,187 |
| Post-C5 Phase 1 (identical-range + same-owner dedup) | 746 |
| Post-C5 Phase 2 prep (this session) | **384** |

Queue breakdown now:

| Category | Pairs | Notes |
|---|---:|---|
| `both_closed_overlap` + `different_owners_chain_break` | 187 | Genuine chain breaks — analyst review |
| `open_overlap` + `different_owners_chain_break` | 110 | Genuine chain breaks — analyst review |
| `open_overlap` + `missing_owner_data` | 77 | Both rows fully NULL on owners — can't tiebreak safely |
| `both_closed_overlap` + `missing_owner_data` | 10 | Same |

The 297 chain-break pairs are real history-resolution work — who held title between dates X and Y when two LLCs both appear? Those need a human looking at deed records, not an auto-rule.

The 87 fully-NULL `missing_owner_data` pairs are sale-event stubs with no owner data on either side. Auto-superseding any of them risks erasing a real but under-documented historical period.

### EXCLUDE constraint — still deferred

C5 Phase 2 final (the `EXCLUDE USING gist`) remains gated on either:

- Draining the queue to 0 (full analyst pass on the 297 chain breaks + a decision call on the 87 NULL-only pairs), OR
- Landing EXCLUDE with a `WHERE` clause that grandfathers the residual 384 pairs (the cleanest way: add a `created_at < <cutoff>` filter so only NEW rows are constrained)

The A6a auto-close trigger continues to enforce "no two open rows on same property" for every insert; that procedural protection covers the most common forward-only violation case.

## Plan status

- ✅ **DONE** (25): F1-F4, C1, C2, C3 (N/A), C4, C6, C8, B8, B1, B2, B4, B5, B7, A1, A2, A3, A4, A5, A6, A7
- ⏳ **PARTIAL** (1): C5 Phase 1 + Phase 2 prep landed; Phase 2 final (EXCLUDE) gated on queue drain or grandfather-WHERE decision
- ⬜ **TODO** (6): C7, C9, B3, B6, A8, A9

## Audit-log inventory

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 35 | C5_phase2_prep_missing_owner_2026_05_27_001 | dia | 180 |

## Files changed

| File | Change |
|---|---|
| `docs/ownership_sales_remediation/2026-05-27_c5p2prep_session_status.md` | NEW — this doc |

No code changes. No new migration files (the cleanup was a one-shot UPDATE using the existing C5 triage view; reversal is via `audit_run_log` if needed).

## Symptom tracking

| User complaint | Status |
|---|---|
| Duplicates for the same sale on the same property | ✅ FIXED + can't recur |
| Missing many elements of a sales transaction | ⏳ MEANINGFUL PROGRESS, visible in B8 tile |
| Ownership history not in unison | ✅ FIXED for active state + auto-close trigger + CHECK + **68% reduction in historical overlaps** (1,187 → 384, mostly real chain-break pairs awaiting analyst attention) |
| RCM/LoopNet 401ing | ⏳ RCM working; LoopNet PA flow pending user build |
| deed_records orphans / synthetic | ✅ FIXED + CHECK guards both |

## Recommended priorities for next session

1. **C9 — standard ingest contract** (would have prevented the sale-event-stub writer that caused most of these overlaps; biggest forward-only ROI)
2. **B6 — propagate-recompute-tick nightly cron** (small, defensive, matches B-series pattern)
3. **C5 Phase 2 final** — make the call: land EXCLUDE with a grandfather `WHERE` clause now, OR drain the 297 chain-break pairs first via analyst pass
4. **A9 — unified_contacts consolidation** (biggest remaining scope)
