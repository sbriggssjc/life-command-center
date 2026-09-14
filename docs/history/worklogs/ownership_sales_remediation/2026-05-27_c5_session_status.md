# Ownership & Sales Remediation — 2026-05-27 Session Status (C5)

Picks up after PR #953 (A4b deed-records orphans, merged + deployed). Focus this round: **C5 — Ownership_history integrity guards**.

## What the investigation found

The plan called for adding:
1. `CHECK` constraints on date ordering
2. `CHECK` on `transaction_type` enum
3. `EXCLUDE USING gist` preventing overlapping ownership periods per property

Reality (after A6a + A6b + A2 had landed):

| Plan assumption | Actual state |
|---|---|
| Single `(ownership_start_date, ownership_end_date)` pair | **Two pairs** — `(start_date, end_date)` AND `(ownership_start, ownership_end)`, populated by different writer generations |
| `transaction_type` column with a 5-value enum | **No such column** — closest equivalent is `ownership_state` ('active' / 'superseded'), with semantics that don't match the plan |
| 0 overlap pairs after A6a | **1,187 overlap pairs** — A6a only handled open-vs-open (which it cleared to 0 multi-open-owner properties), but open-vs-closed and both-closed pairs remained |
| Gov has the same schema | **No** — `gov.ownership_history` has only a single point-in-time `transfer_date`, so EXCLUDE doesn't apply on gov |

So C5 needed to be re-scoped before EXCLUDE could land.

## What landed this session

### 1. CHECK constraint (Phase 1 of C5)

Both date-column pairs now have a date-ordering check:
```sql
CHECK (
  (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
  AND (ownership_end IS NULL OR ownership_start IS NULL OR ownership_end >= ownership_start)
)
```
0 pre-existing violations — landed cleanly. Migration:
`supabase/migrations/dialysis/20260527160000_dia_c5_ownership_history_check_constraints.sql`.

### 2. Pre-EXCLUDE overlap remediation

| Dedup pass | Pairs resolved | Rows superseded |
|---|---:|---:|
| Identical-range duplicates (same start AND same end, mostly same true_owner, different writer paths) | 65 | 27 |
| Same-true_owner overlap pairs (open row + closed row with end_date=2026-04-03 sentinel, both same owner) | 376 | 199 |
| **Total** | **441** | **226** |

**Overlap count: 1,187 → 746.**

The remaining 746 pairs are different-true_owner overlaps — **genuine chain-break situations** (e.g. who actually held title between dates X and Y, when two LLC names overlap on the same property?). Those can't be auto-resolved; they need analyst review.

### 3. Triage view — `v_ownership_overlap_review_queue`

Surfaces the residual 746 pairs with hints:

| Category | Pairs |
|---|---:|
| `open_overlap` + `missing_owner_data` (one row has NULL true_owner) | 240 |
| `both_closed_overlap` + `missing_owner_data` | 209 |
| `both_closed_overlap` + `different_owners_chain_break` | 187 |
| `open_overlap` + `different_owners_chain_break` | 110 |

The 449 `missing_owner_data` pairs are probably easier to resolve in a future round (the row with NULL `true_owner_id` is lower-quality and could be auto-superseded if the surviving row is well-formed). The 297 `different_owners_chain_break` pairs need real analyst attention. Migration:
`supabase/migrations/dialysis/20260527160100_dia_c5_v_ownership_overlap_review_queue.sql`.

### 4. EXCLUDE constraint — deferred (Phase 2)

C5 Phase 2 (the `EXCLUDE USING gist` constraint) is **gated on the triage queue draining to 0**. It can't land while 746 overlaps exist — the migration would fail.

```sql
-- Future migration after the review queue is drained:
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.ownership_history
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
    AND COALESCE(start_date, ownership_start) IS NOT NULL
  );
```

The A6a auto-close trigger still enforces "no two open rows on same property" on every insert — that procedural protection covers the most common forward-only violation. The EXCLUDE adds the structural belt to A6a's procedural suspenders.

### Plan-vs-reality notes

The plan's third CHECK (`transaction_type IN ('deed', 'gsa_lessor_change', 'sos_resolution', 'manual', 'ownership_stub')`) was based on a hypothetical column that doesn't exist. The closest column is `ownership_state` which has a different semantic ('active'/'superseded'). Skipped.

## Plan status

- ✅ **DONE** (25 fully + 1 partial = effectively 25.5/32): F1-F4, C1, C2, C3 (N/A), C4, C6, C8, B8, B1, B2, B4, B5, B7, A1, A2, A3, A4, A5, A6, A7
- ⏳ **PARTIAL** (1): **C5 Phase 1 done; Phase 2 (EXCLUDE) gated on review queue drain**
- ⬜ **TODO** (6): C7, C9, B3, B6, A8, A9

## Symptom tracking

| User complaint | Status |
|---|---|
| Duplicates for the same sale on the same property | ✅ FIXED + can't recur |
| Missing many elements of a sales transaction | ⏳ MEANINGFUL PROGRESS, visible in B8 tile |
| Ownership history not in unison | ✅ FIXED (multi-open=0) + auto-close trigger + **CHECK constraint** + 226 more residual overlap rows superseded; 746 chain-break pairs queued for analyst review |
| RCM/LoopNet 401ing → 0 leads landing | ⏳ RCM working; LoopNet PA flow pending user build |
| deed_records cluttered with synthetic / orphan rows | ✅ FIXED (dia 743→151, gov 88→62, CHECK guards both) |

## Audit-log inventory

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 34 | C5_dia_ownership_history_integrity_2026_05_27_001 | dia | 226 |

## Files changed

| File | Change |
|---|---|
| `supabase/migrations/dialysis/20260527160000_dia_c5_ownership_history_check_constraints.sql` | NEW — CHECK on date ordering |
| `supabase/migrations/dialysis/20260527160100_dia_c5_v_ownership_overlap_review_queue.sql` | NEW — triage view for the 746 residual overlaps |
| `docs/ownership_sales_remediation/2026-05-27_c5_session_status.md` | NEW — this doc |

No code changes. No new cron workers. Gov was not touched (different schema; doesn't apply).

## Recommended priorities for next session

1. **C9 — standard ingest contract** (long-term anti-regression; would have caught both the A4b synthetic deeds AND the same-owner overlap duplicates that C5 just had to dedup)
2. **C5 Phase 2 prep — auto-resolve the 449 `missing_owner_data` pairs** (the row with NULL true_owner_id is lower-quality; supersede it). That would drop the queue from 746 → ~297 chain-break pairs.
3. **B6 — propagate-recompute-tick nightly cron** (small, defensive backstop for AFTER INSERT triggers)
4. **A9 — unified_contacts consolidation in LCC Opps** (decision #1 dependency, biggest remaining scope)
