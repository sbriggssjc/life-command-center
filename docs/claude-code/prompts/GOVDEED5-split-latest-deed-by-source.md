# GOVDEED5 — `properties.latest_deed_*` has three writers and the name lies; split it by source

**Filed:** 2026-09-16 (Cowork). Decision made by Scott 2026-09-16: **split by source**.
**Owner:** 👤 **government-lease** (`sql/` migration + `src/sync_properties_from_sources.py` +
the intel sweep). This is a handoff; ⛔ nothing here is applied from `life-command-center`. dia is not
in scope (its `latest_deed_*` provenance was not measured — measure before touching).
**Found:** verifying GOVDEED4 (LCC backlog `GOVDEED5`; STATUS 2026-09-16).

## What is true today (gov, `scknotsqkcheojiaewwh`, measured 2026-09-16 after GOVDEED4)

| measurement | value |
|---|---:|
| properties with `latest_deed_date` | **2,401** |
| … traceable to a bridged `deed_records` row with that `recording_date` | **43** |
| … equal to a `sales_transactions.sale_date` on the property | **2,263** |
| … traceable to nothing (no deed, no sale, no `ownership_history`) | **75** |
| … day-of-month = 01 among the non-deed values | 718 (CoStar sale-month convention, not GOVDEED4) |
| properties with `latest_deed_grantee` | **5,787** |
| … without any *dated* deed naming that grantee | **5,744** |
| fully undated deed rows (no `recording_date`, no approx, no `document_number`) | **4,995** |

**Three writers, none aware of the others, all SET-only (none ever clears):**

1. `propagate_deed_to_property()` (SQL) — from `deed_records`, dated rows only since GOVDEED2.
2. `sql/20260508_gov_intel_sweep_tier3c_and_true_owner.sql` l.191 —
   `latest_deed_date = l.sale_date, latest_deed_grantee = coalesce(p.latest_deed_grantee, l.buyer)`
   from `sales_transactions`, gated on `latest_sale_price IS NULL`. This is where ~94% of the values come from.
3. `src/sync_properties_from_sources.py` l.1723 — from bridged deeds via Python, including (before
   GOVDEED4) undated ones; this is where most of the 5,744 grantees came from.

Every consumer that reads `latest_deed_date` as "a deed was recorded on this date" — LCC's
`gov_ownership_transition` feeder, `v_owner_source_conflict`, dossiers — is reading a sale date
about 94% of the time and a placeholder about 3% of the time.

## What to build

1. **New columns on `properties`** (nullable):
   `latest_transfer_date date`, `latest_transfer_party text`,
   `latest_transfer_source text CHECK (IN ('deed','sale'))`, `latest_transfer_ref text` (deed_id
   or sales_transactions id). One row of truth per property: the most recent *evidenced* transfer,
   whatever its source, with the source written next to it.
2. **Backfill by evidence, not by copying the old columns:** for each property take the max of
   (latest dated bridged deed, latest `sales_transactions` row with a date) and write date/party/
   source/ref from that row. Properties with neither get NULLs — including the **75** untraceable,
   which do **not** get carried over (their current value has no source; "Not on file" beats a
   value nobody can explain). Snapshot the old `latest_deed_*` for all 5,787 rows to a
   `_gov_govdeed5_prior_latest_deed_20260916` table first.
3. **`latest_deed_*` become deed-only:** recompute from dated bridged deeds (today: 43 properties),
   NULL elsewhere. Column comments say so.
4. **Writers:** the intel sweep writes `latest_transfer_*` with `source='sale'` and stops writing
   `latest_deed_*`; `propagate_deed_to_property` writes both `latest_deed_*` and, if newer than the
   current transfer, `latest_transfer_*` with `source='deed'`; `sync_properties_from_sources.py`
   l.1723 block either goes through the same rule or is removed — say which, and why.
   **Every writer must be able to clear** what it set when its source row goes away (GOVDEED4
   needed a hand-run clear because none can).
5. **Consumers:** `v_owner_source_conflict` and anything else in gov that reads `latest_deed_*`
   switches to `latest_transfer_*` + `latest_transfer_source`. List them in the response.
6. Tests: a property with only a sale gets `source='sale'` and NULL `latest_deed_date`; only a dated
   deed → `'deed'` in both; both → the newer wins with the right source; an undated deed alone
   → NULLs everywhere. Positive control that the old writer path no longer touches `latest_deed_date`.

## Prohibitions

- ⛔ No value is invented; no date is inferred from `created_at`, lease dates, or neighbours.
- ⛔ The 4,995 undated deed rows are GOVDEED-478's disposition, not this round's — do not delete or
  mark them here.
- ⛔ Do not touch dia.
- ⛔ Do not apply from `life-command-center`; the migration is applied to gov by whoever runs gov
  migrations, with before/after counts reported.

## Reporting

Before/after counts for every row of the table above, the 5,787-row snapshot count, the list of
consumers switched, and the 75 untraceable properties' ids exported to the snapshot table with
`reason='untraceable'`. If any step was skipped, say so.
