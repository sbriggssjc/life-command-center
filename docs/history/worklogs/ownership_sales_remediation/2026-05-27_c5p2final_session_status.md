# Ownership & Sales Remediation — 2026-05-27 Session Status (C5 Phase 2 FINAL)

Picks up after the C9 sidebar migration (merged as PR #963; main also carries the user's parallel artifact-offload work). Focus this round: **C5 Phase 2 final — land the EXCLUDE constraint**, moving C5 from PARTIAL to DONE.

## What landed

### The grandfather mechanism

A partial GIST EXCLUDE predicate can only reference a row's own columns — not a subquery against `v_ownership_overlap_review_queue`. So the "currently part of a residual overlap" state is materialized as a column:

1. New `ownership_history.overlap_grandfathered boolean NOT NULL DEFAULT false`
2. Set `true` on all 617 rows participating in the residual review-queue overlaps (both sides of each pair)
3. The EXCLUDE predicate exempts `overlap_grandfathered = true` rows

New rows default `false` → fully constrained. The messy history (different-owner chain breaks + fully-NULL-owner sale stubs) is grandfathered until an analyst resolves it.

### The constraint

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- scalar property_id = operator

ALTER TABLE ownership_history
  ADD CONSTRAINT excl_oh_no_overlap
  EXCLUDE USING gist (
    property_id WITH =,
    daterange(
      COALESCE(start_date, ownership_start),
      COALESCE(end_date, ownership_end, 'infinity'::date),
      '[)'
    ) WITH &&
  )
  WHERE (
    ownership_state = 'active'
    AND property_id IS NOT NULL
    AND overlap_grandfathered = false
    AND COALESCE(start_date, ownership_start) IS NOT NULL
  );
```

`[)` half-open ranges so adjacent periods touching at a single date (prior.end == next.start — the seller-exit convention) don't count as overlap.

### Pre-flight + enforcement test

- **0 invalid coalesced ranges** among the 3,828 in-scope rows (no `start > end` that would break `daterange()` during index build)
- **617 rows grandfathered**, **3,211 rows in constraint scope**, **0 residual overlaps in scope** → build succeeded
- **Live enforcement test PASSED**: a transactional `DO` block inserted two overlapping closed rows on a clean sentinel property; the second raised `exclusion_violation` (23P01) exactly as intended. The block rolled back — **0 leftover test rows** confirmed.

Closed rows were used for the test specifically to bypass the A6a open-row auto-close trigger and exercise the EXCLUDE directly.

## C5 is now DONE — three-layer ownership_history integrity

| Layer | Mechanism | Scope |
|---|---|---|
| **Date ordering** | `chk_oh_start_end_order` CHECK (Phase 1) | both date-column pairs, all rows |
| **Forward-close** | `auto_close_prior_open_ownership` trigger (A6a) | procedural — new open row closes prior open rows |
| **No-overlap** | `excl_oh_no_overlap` EXCLUDE (Phase 2, this round) | structural — new rows can't overlap, even hand-edited or non-trigger paths |

The trigger handles the common forward case (buyer-side insert closes the prior owner); the EXCLUDE is the structural backstop that catches anything the trigger misses (closed-row inserts, direct SQL, multi-row batches). Together they make the "ownership history not in unison" symptom structurally impossible to reintroduce for non-grandfathered rows.

## Residual review queue (the grandfathered 617)

Still surfaced by `v_ownership_overlap_review_queue` for analyst resolution:
- 297 different-owner chain-break pairs (who held title between dates X and Y?)
- 87 fully-NULL-owner sale-stub pairs

As an analyst resolves each (supersede the wrong row, or correct dates), they should also flip `overlap_grandfathered = false` on the survivor so it rejoins the constraint. When the queue drains to 0, a follow-up can simply `UPDATE ... SET overlap_grandfathered = false` across the board and the constraint covers 100% of active rows.

## Plan status

- ✅ **DONE** (28, ↑1): F1-F4, C1, C2, C3 (N/A), **C5**, C4, C6, C8, B8, B6, B1, B2, B4, B5, B7, A1, A2, A3, A4, A5, A6, A7
- ⏳ **PARTIAL** (1): C9 (Phase 1 + Phase 2 writer sweep complete; only the optional commit_* orchestrators remain — a convenience, not a gap)
- ⬜ **TODO** (4): C7, B3, A8, A9

## Audit-log inventory

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 42 | C5_phase2_final_exclude_2026_05_27_001 | dia | 617 |

## Files changed

| File | Change |
|---|---|
| `supabase/migrations/dialysis/20260527180000_dia_c5_phase2_ownership_exclude.sql` | NEW — grandfather column + flag-set + btree_gist + EXCLUDE |
| `docs/ownership_sales_remediation/2026-05-27_c5p2final_session_status.md` | NEW — this doc |

No JS changes. gov not touched (point-in-time `transfer_date` schema; EXCLUDE doesn't apply).

## Symptom tracking — final state

| User complaint | Status |
|---|---|
| Duplicates for the same sale on the same property | ✅ FIXED + structurally prevented |
| Missing many elements of a sales transaction | ⏳ MEANINGFUL PROGRESS, visible in B8 tile, C9 contract prevents new gaps |
| Ownership history not in unison | ✅ **FIXED + structurally prevented** (CHECK + A6a trigger + EXCLUDE constraint) |
| RCM/LoopNet 401ing | ⏳ RCM works; LoopNet PA flow pending user build |
| deed_records orphans / synthetic | ✅ FIXED + CHECK guards both |
| properties.latest_* drift | ✅ FIXED + nightly recompute cron |

## Recommended priorities for next session

1. **A9 — unified_contacts consolidation** (biggest remaining; Decision #1 dependency)
2. **B3 — deed-relink-tick** (defensive cron for future orphans)
3. **A8 — CoStar Contacts retroactive harvest** (depends on payload cache availability)
4. **C7 — SOS adapter framework** (lower priority per user pref for free SOS-direct scrapers)

After these 4, the 32-item plan is fully delivered (modulo the C9 orchestrator nice-to-have).
