# Ownership & Sales Remediation — 2026-05-27 Session Status

Picks up after the 2026-05-24 session. Focus this round: **C4 — owner-entity write-time dedup enforcement**.

## What landed this session

### C4 — write-time entity dedup (all 4 owner tables)

Before this round, only `gov.recorded_owners` had a true write-time UNIQUE on its dedup key. The other three tables had partial constraints with bypass conditions, and the JS-side `upsertDomainOwners` writer was the only thing standing between concurrent ingestions and duplicate owner rows. Now every owner write must produce a unique canonical key — at the schema level.

| Table | Dedup key | What changed |
|---|---|---|
| `dia.recorded_owners` | `normalized_name` | Backfilled 363 NULL keys via `dia_canonicalize_owner_name(name)`; merged 195 collision groups via `apply_owner_merge()`; **new partial UNIQUE** `uq_recorded_owners_normalized_name_active` WHERE merged_into IS NULL AND key not empty; **new trigger** `recorded_owners_canonicalize_biu` auto-populates key on insert/update |
| `dia.true_owners` | `normalized_name` | Backfilled 535 NULL keys; merged 1 collision (Aei Capital Corp → AEI Capital) via new `apply_true_owner_merge()`; existing UNIQUE `true_owners_normalized_name_uidx` already partial; **new trigger** `true_owners_canonicalize_biu` |
| `gov.recorded_owners` | `(canonical_name, COALESCE(state,''))` | 0 collisions already; **tightened** existing UNIQUE `uq_recorded_owners_canonical` to include `merged_into IS NULL` filter; **new trigger** `recorded_owners_canonicalize_biu` |
| `gov.true_owners` | `(canonical_name, COALESCE(state,''))` | Merged 326 losers across ~317 collision groups via `apply_true_owner_merge()`; backfilled 10,412 NULL keys via `compute_canonical_name(name)`; tightened existing UNIQUE; **new trigger** `true_owners_canonicalize_biu` |

**Total state changes: ~11,664 row-edits across the four tables, all reversible via `dq5_owner_merge_log` + the deferred `field_provenance` writes.**

### Function library additions
- `dia.apply_true_owner_merge(survivor, loser, canonical, run_id)` — mirror of `apply_owner_merge` for true_owners; FK-repoints across 12 dependent tables (broker_market_coverage, call_outcomes, contacts, deal_outcomes, developer_scorecard, guarantors, investment_targets, ownership_insights, recorded_owners, registered_entities, touchpoint_schedule, user_interactions).
- `gov.apply_true_owner_merge(survivor, loser, canonical, run_id)` — 3 dependent tables (ownership_history, properties, sam_entities).
- `dia.dia_owner_set_normalized_name()` — trigger function; populates `normalized_name` from `dia_canonicalize_owner_name(name)`.
- `gov.gov_owner_set_canonical_name()` — trigger function; populates `canonical_name` from `compute_canonical_name(name)`.

### Performance fix
Added two missing FK indexes on gov that were forcing seq-scans during the merge run:
- `idx_ownership_history_true_owner_id` ON `gov.ownership_history(true_owner_id) WHERE NOT NULL`
- `idx_properties_true_owner_id` ON `gov.properties(true_owner_id) WHERE NOT NULL`

The first attempt at the gov.true_owners merge timed out at 60s without these.

### Bug fix in the merge primitive
Both `apply_owner_merge` and the new `apply_true_owner_merge` originally did the survivor field-merge UPDATE *before* marking the loser merged. With the tightened partial UNIQUE (now `WHERE merged_into IS NULL`), this hit a self-collision when the COALESCE wrote the loser's still-active canonical_name onto the survivor. Reordered both functions: **mark loser merged first, then field-merge the survivor**. The dia `apply_owner_merge` was updated too even though it didn't bite during A1 — it would have on any future merge where the addresses weren't both NULL.

### JS-side safety net (`sidebar-pipeline.js`)
`ensureRecordedOwner` and the true_owners POST path now catch HTTP 409 / SQLSTATE 23505 and fall back to a GET-by-canonical-key, returning the existing UUID. The pre-existing pre-fetch handles 99% of cases; this catch covers race conditions when two ingestions race for the same canonical name.

## LCC Opps outage (déjà vu)

The LCC Opps SQL endpoint (`xengecqvemvfknjvbvrq`) timed out at the Supabase MCP layer throughout this entire session — same pattern as the 2026-05-24 A6b outage. dia + gov endpoints were fully reachable; only the LCC Opps SQL path was affected. The cleanup completed against dia/gov; `audit_run_log` writes are deferred to `scripts/audit/deferred/2026-05-27_C4_owner_dedup_backfill.sql`, which should be applied once LCC Opps recovers.

The deferred file captures four audit runs:
- `C4_dia_recorded_owners_2026_05_24_001` (245 rows affected)
- `C4_dia_true_owners_2026_05_24_001` (536 rows)
- `C4_gov_recorded_owners_2026_05_24_001` (0 rows — already clean)
- `C4_gov_true_owners_2026_05_24_001` (10,738 rows)

## Live ownership state after this round

| Metric | dia before | dia after | gov before | gov after |
|---|---:|---:|---:|---:|
| `prop_with_recorded_owner` (%) | 17.32% | **18.53%** | 44.67% | 44.50% |
| `prop_with_true_owner` (%) | 76.20% | 76.19% | 39.12% | **39.61%** |
| `recorded_owners` active | 3,891 | 3,841 | 15,356 | 15,356 |
| `recorded_owners` merged total | 35 | **230** | 116 | 116 |
| `true_owners` active | 3,775 | 3,774 | 13,219 | 12,893 |
| `true_owners` merged total | 131 | **132** | 887 | **1,213** |

Coverage % moved only slightly because most merges were case-only siblings — they affect entity uniqueness but not how many properties have *some* owner attached. The structural win is **0 active rows with NULL dedup keys on any of the four tables**, meaning every existing row is now under the UNIQUE constraint, and the trigger ensures every future row arrives keyed.

## Cron workers still active (12 total)

No changes this round — all dia + gov continuous workers from the prior session remain active:
- `lcc-{dia,gov}-sales-dedup-tick` (15-min)
- `lcc-{dia,gov}-cap-rate-quality-tick` (nightly)
- `lcc-{dia,gov}-data-health-snapshot` (nightly)
- `lcc-{dia,gov}-owner-merge-tick` (hourly)
- `lcc-{dia,gov}-ownership-chain-tick` (nightly)
- `lcc-{dia,gov}-sales-needs-review-tick` (hourly)

The `owner-merge-tick` hourly worker now has *less* work to do — most legacy duplicates are gone and the trigger + UNIQUE prevent new ones. It remains in place as a backstop for bulk-load scenarios and any edge cases the trigger doesn't cover.

## Plan status

- ✅ **DONE** (19, ↑1): F1-F4, C1, C3 (N/A), C4 **(this round)**, C6, B1, B2, B4, B5, B7, A1, A2, A3, A4 (partial), A5, A6 (A6b only)
- ⏳ **PARTIAL** (1): A6 — A6a (chronological closure across different owners, 1,111 dia rows) still TODO
- ⬜ **TODO** (12, ↓1): C2, C5, C7, C8, C9, B3, B6, B8, A4b, A7, A8, A9

## Symptom tracking

| User complaint | Status |
|---|---|
| Duplicates for the same sale on the same property | ✅ FIXED + can't recur |
| Missing many elements of a sales transaction | ⏳ MAJOR PROGRESS (C2 still pending) |
| Ownership history not in unison | ⏳ **SIGNIFICANT PROGRESS — write-time enforcement now live**. 477 total owner duplicates merged across this round + A1; new duplicates blocked at insert; canonicalization automated via triggers |

## Recommended priorities for next session

1. **C2 sales writer refactor** — biggest user-visible win, persist `recorded_date` / `transaction_type` / `lender_name` / `guarantor` / `financing_type` + buyer/seller PII to contacts. Would lift avg completeness 5-15 points per the 2026-05-24_completeness_findings measurements.
2. **A7 owner→SF link backfill** — now fully unblocked by A1 + C4; lift owner→SF coverage from 1.5–20% baseline.
3. **A6a ownership_history chronological closure** — 1,111 dia rows where different owners are simultaneously "open"; needs inference-based end_date. Then C5 EXCLUDE constraint becomes applicable.
4. **B8 Data Health dashboard tile** — surface snapshot trend + open alerts in `ops.js`.
5. **C8 RCM/LoopNet auth fix** — small Power Automate header tweak; unblocks marketing_leads pipeline.

## Migrations applied this round

| Project | Migration | Purpose |
|---|---|---|
| dia | `dia_apply_true_owner_merge_c4` | New merge primitive for true_owners |
| dia | `dia_apply_true_owner_merge_reorder` | Fix loser-merged-first ordering |
| dia | `dia_recorded_owners_strict_unique_c4` | New partial UNIQUE on normalized_name |
| dia | `dia_owner_canonicalize_triggers_c4` | BEFORE INSERT/UPDATE triggers |
| gov | `gov_apply_true_owner_merge_c4` | Merge primitive for true_owners |
| gov | `gov_apply_true_owner_merge_reorder` | Fix loser-merged-first ordering |
| gov | `gov_index_true_owner_id_for_c4_merge` | Performance: missing FK indexes |
| gov | `gov_owner_unique_add_merged_filter` | Tighten existing UNIQUE to active rows only |
| gov | `gov_owner_canonicalize_triggers_c4` | BEFORE INSERT/UPDATE triggers |
| (LCC Opps deferred) | `2026-05-27_C4_owner_dedup_backfill.sql` | audit_run_log entries — apply on recovery |
