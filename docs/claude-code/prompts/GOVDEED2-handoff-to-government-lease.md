# GOVDEED2 — handoff: one missing predicate is manufacturing half the gov owner-conflict set

**Filed:** 2026-09-15 (Cowork), every number below verified live against government
(`scknotsqkcheojiaewwh`) and Dialysis_DB (`zqzrriwuavgrquhisnoa`).
**Owner:** 👤 **`government-lease`** — the fix is in a government-database object. This file is the
handoff, not the fix. Nothing here should be applied from `life-command-center`.
**Source round:** GOVDEED1, whose diagnosis was correct and is confirmed below with two corrections.

## The producer, confirmed running

`cron.job` id **20**, schedule **`35,5 * * * *`** — twice an hour, not hourly — `active = true`,
command `SELECT public.propagate_deed_to_property(5000)`. It is writing right now.

## The defect is an inconsistency INSIDE one function, not a missing idea

⚠️ **Correction to the GOVDEED1 response, which reported "no `recording_date IS NOT NULL` guard."**
The function contains that exact predicate — fifteen lines below the block that needs it. Read the
live body: `propagate_deed_to_property` has **two** CTEs both named `bridged`:

| block | writes | `recording_date IS NOT NULL`? | `LIMIT p_limit`? |
|---|---|---|---|
| step 1 | `properties.latest_deed_grantee` / `latest_deed_date` | **NO** | **NO** |
| step 2 | `ownership_history` | **YES** | YES |

Step 1 ranks `ORDER BY d.recording_date DESC NULLS LAST`, takes `rn = 1`, and writes
`latest_deed_date = b.recording_date` unconditionally — so a dateless deed wins the ranking when it is
the only one, and NULL is written as though it were a measurement.

**This makes the finding stronger, not weaker.** The author already knew dateless deeds must be
excluded; they wrote precisely that guard for `ownership_history` and did not apply it to the block
that writes the property row. The fix is therefore not a design decision — it is making one function
internally consistent with itself, and the correct predicate is already in the file.

## What it has produced

| measurement | value |
|---|---|
| gov properties with a deed grantee and **no date** | **3,930 of 5,922** (66.4%) |
| `deed_records` rows with no `recording_date` **and** no `document_number` | **4,908**, created **2026-03-27 → 2026-08-31** |
| of the linked ones, grantee **byte-identical to the property's own `recorded_owners.name`** | **4,143 of 4,928 (84.1%)** |

That 84% is the part to sit with: the "deed" is an **echo of the prompt's own context**, not new
evidence. `public_record_ingest.py::save_deed_record` writes gpt-4o recall with no county fetch, and
`"consideration": 0` passes the `has_value` gate because `_parse_numeric()` has no positivity guard —
unlike `_positive_or_none()`, used for parcel fields **in the same file**.

### The part GOVDEED1 did not connect

**478 of the 941 government owner-source conflicts (50.8%) trace to one of these dateless,
document-number-less deed rows — 478 of 478, a perfect match.** So it is not only that the missing
date blocks the deed-wins autofix. **More than half of the government owner-conflict population is
manufactured by this producer**, out of an LLM's recall of a grantee it was never shown, with no date
and no document number to check it against. Every one of those rows is a real person's property
recorded as having changed hands on no evidence.

## Dialysis is NOT a clean reference — correcting my own prompt

⛔ **GOVDEED1's prompt (mine) said the dialysis pipeline is "a working reference implementation of
what the government one is failing at." That was wrong and should not be repeated.** CC caught it;
reading both function bodies confirms it and sharpens it:

- dia's `propagate_deed_to_property` is **not the same function**. Different implementation entirely —
  a `links` CTE that `coalesce`s a direct `property_id` with the bridge, a separate `ranked` CTE, and
  **no `ownership_history` step at all**.
- It carries **the same defect**: `ORDER BY recording_date DESC NULLS LAST`, `rn = 1`,
  `latest_deed_date = r.recording_date` with no guard.
- dia's 2-of-1,774 is a smaller **upstream population**, not a safer downstream. It is latent, and it
  will behave exactly like gov if its producer's output shape drifts.

Two consequences: the fix must be **authored separately for each database** (copying gov's patch into
dia will not apply — the CTEs differ), and dia's guard cannot be copied from its own step 2, because
dia has no step 2.

## Recommended fix — for `government-lease` to author, review and own

1. Add `AND d.recording_date IS NOT NULL` to the **step-1** `bridged` CTE, matching step 2 exactly.
   Consider `LIMIT p_limit` there too; its absence in step 1 is a second asymmetry.
2. Commit the corrected function as a real migration. ⚠️ **It is currently in no repository at all** —
   absent from `government-lease`'s `sql/*.sql` and from LCC's retired `supabase/migrations/government/`
   copy, appearing only in prose specs. It is running twice an hour and is not in source control.
3. Guard `consideration` in `save_deed_record` with `_positive_or_none`, so a model's `0` sentinel
   stops satisfying `has_value`.
4. **No backfill.** Once the write path is fixed the 3,930 stay NULL — "Not on file". There is no
   source to recover a real date from and none may be invented. ⚠️ But the 478 manufactured conflicts
   need a decision of their own: they are not "stale data", they are assertions that were never
   evidence. Sizing what should happen to them is a separate round.

## Prohibitions

- ⛔ Do not apply any of this from `life-command-center`.
- ⛔ Do not fabricate a deed date from `created_at`, a sale record, or a neighbouring row.
- ⛔ Do not patch dia by copying the gov fix — different function, author it separately.
