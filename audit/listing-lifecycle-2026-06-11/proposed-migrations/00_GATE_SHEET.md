# GATE SHEET — Listing-Lifecycle Remediation (dia + gov)

> **NOTHING IN THIS FOLDER IS APPLIED.** All `.sql` files default to `ROLLBACK`.
> Scott independently verifies the 5 decisions below + the gov 116-multi-active /
> 229-excess counts + the keeper logic, then flips `ROLLBACK`→`COMMIT` (and runs the
> `CONCURRENTLY` index outside the txn). Counts captured 2026-06-11.

Apply order (only after sign-off):
1. `gov_backfill.sql` → re-audit → `gov_writer_guards.sql` (index runs separately, CONCURRENTLY)
2. `dia_backfill.sql` → re-audit → `dia_writer_guards.sql`
3. JS writer guards (see `README.md` — coordinated with the sales-dup root-cause family)

---

## The 5 gate decisions (recommendation first)

### Decision 1 — Keeper-selection rule (which row survives a dedup)
**RECOMMEND: recency-first.** `ORDER BY listing_date DESC NULLS LAST, first_seen_at DESC,
then source-rank (costar_sidebar > crexi > salesforce_ascendix > master_curated_sale >
lcc_intake_om) only as a date tiebreak.`

> **Why not source-first (my Phase-3 first draft was wrong):** on gov property 16350,
> source-rank-first KEEPs the **stale** `salesforce_ascendix` row (listing_date 2026-03-31)
> and supersedes the **11 live** `lcc_intake_om` rows (the actual June marketing). Recency-first
> keeps the 2026-06-09 OM — the genuinely current listing. The 11 supersede; field-value
> authority (CoStar/sales over OM) is handled separately by `field_source_priority`, not by
> which *row* is the live iteration.

**Verify:** the keeper preview in `gov_backfill.sql` step G1 prints `property_id, rn, source,
listing_date, asking_price, verdict` for all 116 dup props before any mutation.

### Decision 2 — Re-ingest vs genuine-relist discriminator (collapse vs keep-as-history)
**RECOMMEND:** rows sharing `(property_id, listing_date)` **or** the current active set for a
property = the **same iteration** → collapse to one row. A materially later `listing_date`
*after the prior iteration closed* = a **genuine new iteration** → keep as a sequential,
non-overlapping history row (end the prior window at the new start).

> **Validated on dia 28749:** collapsing by `(property, listing_date)` reduces 21 rows → 4
> dated iterations (2021-08-02 Sold · 2023-09-15 Sold · 2025-09-12 ×15→1 Superseded ·
> 2026-06-10 active) + 1 windowless. The 15-row 2025-09-12 group is one iteration (intra-day
> re-ingest), the four campaigns are real history. `dia_backfill.sql` D1/D2 preserve the 4 and
> remove only intra-iteration overlap.

### Decision 3 — Close-on-sale window (don't close a listing that legitimately post-dates a sale)
**RECOMMEND: two tiers.**
- **Tier 1 — auto-close** where `sale_date >= listing_date` (sale falls during/after the
  on-market window) OR `listing_date IS NULL`. Unambiguous; matches doctrine. On the 11 gov
  candidates this is: **16306, 16369, 30949, 15516, 927** (5).
- **Tier 2 — DO NOT auto-close** where `listing_date > sale_date` (listing postdates the
  sale): **9905 (×row), 16254, 16027, 3627, 5330**. Could be a stale OM re-capture of an
  already-sold property (most likely on this data) OR a legitimate post-sale re-list. The
  backfill writes these to `listing_lifecycle_review` with `recommended='supersede_stale'`
  and mutates nothing. **Scott's verdict per row at the gate.**

> Go-forward, the gov close-on-sale trigger mirrors dia's accepted behavior (closes within a
> 90-day-back / 12-month-forward window). If you want the trigger to also spare Tier-2
> post-sale re-lists, say so and I'll add the `sale_date >= listing_date` guard to the trigger
> too — flagged as a sub-decision.

### Decision 4 — Provenance & reversibility (never hard-delete)
**RECOMMEND:** every state change is logged to `listing_lifecycle_backfill_log` (old+new
values, per row, per step) and rows are **superseded/closed, never deleted**. gov has **no
`notes` column**, so provenance rides `off_market_reason` + the log table; dia also appends to
`notes`. The log is the reversal key (a documented UPDATE…FROM log restores any step).

### Decision 5 — Recurrence guard placement (DB vs JS)
**RECOMMEND: both, DB-authoritative.** gov gets the partial unique index dia already has
(`one active per property`) as the hard backstop, **plus** a `supersede-prior-active` trigger
so a new active insert auto-supersedes the prior (the index then never throws), **plus** the
JS fix (property-first upsert; drop `listing_date` from the conflict key). The DB guard means
correctness no longer depends on every writer being perfect — same lesson as the sales-dup
family (see README). If you'd rather keep enforcement JS-only and let the index just throw,
that's the sub-decision to flip.

---

## Counts to independently verify (the receipts this plan rests on)

| Claim | DB | Value | Reproduce |
|---|---|---|---|
| Properties with >1 active row (live) | gov | 116 | `SELECT count(*) FROM (SELECT property_id FROM available_listings WHERE is_active AND COALESCE(exclude_from_market_metrics,false)=false AND property_id IS NOT NULL GROUP BY property_id HAVING count(*)>1) x;` |
| Excess active rows | gov | 229 | same set, `sum(n-1)` |
| of which lcc_intake_om re-ingest | gov | 143 | G1 preview, `rn>1 AND source='lcc_intake_om'` |
| Close-on-sale candidates (Tier1+Tier2) | gov | 11 (5+6 rows) | `gov_backfill.sql` G2 preview |
| Phantom over-stamps | gov | 12 | C-category query in the audit doc |
| Stale opens (>90d) | gov | 41 | D-category query |
| Point-in-time overlapping windows (real) | dia | 247 | A-category window query |
| Same-(prop,date) redundant rows | dia | 211 (112 groups, max 15) | D2 preview |
| Active set already 1:1 | dia | 806 = 806 | active vs distinct-property |

## Schema gotcha caught during drafting
**gov `available_listings.is_active` is `GENERATED ALWAYS AS (listing_status IN
('active','under_contract'))`** — it cannot be assigned, not even in a BEFORE trigger
(Postgres `428C9`). Every gov write path here sets `listing_status` and lets `is_active`
follow. (dia `is_active` is a normal column — its existing close trigger assigns it, so dia
writes set both.) The gov SQL was corrected and re-validated after hitting this.

## Validation — proposed SQL dry-run against LIVE data (2026-06-11, all rolled back, ZERO writes)
Both backfills were executed inside `BEGIN … ROLLBACK` against the live DBs to prove
syntax + outcome. Nothing was committed.

**gov_backfill.sql →**
| check | result |
|---|---|
| props with >1 active | **0** (target 0) |
| active rows = distinct props | **572 = 572** (was 818 / 589) |
| tier-1 close-on-sale remaining | **0** |
| phantom backward windows | **0** |
| stale opens >90d | **0** |
| G1 superseded | **229** |
| G2 tier split (post-G1) | **tier1:4, tier2:0** — G1's dedup absorbs the earlier 11 close-on-sale candidates (the postdates-sale rows were duplicate actives); only 4 unambiguous closes survive G1 |

**dia_backfill.sql →**
| check | result |
|---|---|
| strict point-in-time overlaps | **0** (was 247) |
| active snapshot | **806 = 806** (unchanged — history-only repair) |
| active-but-off_market contradictions | **0** |
| D2 same-day dup losers collapsed | **211** |
