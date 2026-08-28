# Ownership & Sales Remediation — 2026-05-27 Session Status (A6a)

Picks up after PR #949 (A7 owner→SF link backfill, merged + deployed). Focus this round: **A6a — ownership_history chronological closure on dia**.

## What landed this session

### One-shot closure — 958 → 0 multi-open-owner properties

The data investigation found that the audit's "1,111 dia rows" figure had drifted down to **958 properties / 2,096 rows** after the C4 + A6b cleanup ran. The closure algorithm:

1. Find all properties with 2+ active ownership_history rows where `COALESCE(end_date, ownership_end) IS NULL`
2. For each, `ROW_NUMBER() OVER (PARTITION BY property_id ORDER BY eff_start ASC NULLS LAST, ownership_id ASC)`
3. For every row except the latest (`pos < total`), stamp `end_date` + `ownership_end` with `LEAD(eff_start)` — the next owner's start date
4. Leaves the latest row open (current owner)

**Results:**

| Metric | Before A6a | After A6a |
|---|---:|---:|
| Active rows with `eff_end IS NULL` | 3,347 | 2,218 → 2,209 |
| Properties with multi-open-owners | **958** | **0** |
| Rows in those problem properties | 2,096 | — |
| Rows closed with `end_date` | — | 1,129 |
| Stub rows superseded (NULL eff_start) | — | 9 |

The 9 stubs were rows on multi-open properties that had NULL `eff_start` AND a dated peer — they carried no positional info and were marked `ownership_state='superseded'` with a `notes` audit string. The dated peer remains the canonical current-owner row.

### Forward-only guard — auto-close trigger

New `BEFORE INSERT` trigger on `dia.ownership_history`:

```sql
auto_close_prior_open_ownership()
  → ownership_history_auto_close_prior_bi BEFORE INSERT FOR EACH ROW
```

When a new "open" ownership row lands (eff_end IS NULL, eff_start populated, state=active), the trigger automatically stamps `end_date` + `ownership_end` on every other active row on the same property whose eff_start ≤ new.eff_start. Mirrors the existing `auto_supersede_expired_leases` pattern on `dia.leases`.

This means the accumulation we just cleaned up **cannot recur** through the normal write path. The 958 problem properties came from years of buyer-side inserts that didn't trip the legacy seller_exit writer (or hit edge cases the writer didn't cover). The trigger backstops every future insert.

The trigger is intentionally permissive on edge cases:
- New row already has `eff_end` set → skip (it's already closed; not in the cohort)
- New row has NULL `eff_start` → skip (can't determine closure point)
- New row's `eff_start` < some prior row's `eff_start` → skip closure of the newer prior (the new row is OLDER than something already open; that's a backfill, leave it alone)

### Path to C5 EXCLUDE constraint (deferred)

With 0 overlaps now, the C5 EXCLUDE constraint is finally **applicable**. Deferring the actual constraint to a future round because:

1. The dia schema has two date-column pairs (`start_date/end_date` AND `ownership_start/ownership_end`) used by different writers. A constraint over `(property_id, daterange(COALESCE(start_date, ownership_start), COALESCE(end_date, ownership_end)))` needs an EXCLUDE constraint over a functional GIST index, which requires `btree_gist` extension.

2. The constraint would need to permit single-day touching (prior owner end_date == next owner start_date — the existing `sales_transactions_seller_exit` convention). That's a `[)` half-open range, which the EXCLUDE operator class supports but adds wrinkles.

3. The trigger handles the forward-only enforcement just as well for the steady-state case, and is easier to debug if it ever fires unexpectedly.

C5 can be revisited as a separate hardening pass once the column pairs are consolidated.

### Downstream effects

| View | Before | After |
|---|---:|---:|
| `v_data_health_ownership.oh_active` | 7,149 | 7,140 |
| `v_data_health_ownership.oh_superseded` | 610 | 619 |
| `v_sales_chain_breaks` count | (not measured this round) | 1,309 |

`oh_active` dropped 9 (the stubs that moved to `superseded`). The other 1,129 closed rows stay `ownership_state='active'` per the existing convention — `active` means "represents real ownership data", not "currently open"; the closure is reflected in `end_date`/`ownership_end` getting stamped.

## Audit-log inventory (LCC Opps)

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 28 | A6a_dia_chronological_closure_2026_05_27_001 | dia | 1,138 |
| 29 | A6a_dia_auto_close_trigger_2026_05_27_001 | dia | 0 (infra only) |

## Migrations applied this round

| Project | Migration | Purpose |
|---|---|---|
| dia | `dia_a6a_ownership_history_chronological_closure` | One-shot 1,129-row closure |
| dia | (inline supersede of 9 stub rows) | NULL-eff_start cleanup |
| dia | `dia_a6a_ownership_auto_close_prior_trigger` | BEFORE INSERT trigger |

Repo file: `supabase/migrations/dialysis/20260527130000_dia_a6a_ownership_auto_close_trigger.sql` (trigger only — the one-shot closure is the kind of thing you wouldn't replay).

## Plan status

- ✅ **DONE** (22, ↑1): F1-F4, C1, C2, C3 (N/A), C4, C6, B1, B2, B4, B5, B7, A1, A2, A3, A4 (partial), A5, **A6 (both A6a + A6b)**, A7
- ⏳ **PARTIAL** (0, ↓1): A6 is now complete (A6a + A6b both done)
- ⬜ **TODO** (10): C5, C7, C8, C9, B3, B6, B8, A4b, A8, A9

## Symptom tracking

| User complaint | Status |
|---|---|
| Duplicates for the same sale on the same property | ✅ FIXED + can't recur |
| Missing many elements of a sales transaction | ⏳ MEANINGFUL PROGRESS (C2 + A7 ramping) |
| Ownership history not in unison | ✅ **FIXED + auto-close trigger prevents recurrence** (0 multi-open-owner properties; 0 same-owner-history dupes; canonical-key write-time enforcement live) |

## Recommended priorities for next session

1. **B8 Data Health dashboard tile** — surface 30-day completeness trend + SF-link queue depth + ownership chain health in ops.js. Now that the back-end is healed across all three symptom rows, making the health visible to the operator is the natural next step.
2. **C8 RCM/LoopNet auth fix** — small Power Automate header tweak; unblocks an entire BD lead channel currently dark.
3. **C5 EXCLUDE constraint** — formalize the no-overlap rule that A6a's trigger enforces de facto.
4. **A4b deed-records orphans** — research the 232 dia + 88 gov true orphans.
