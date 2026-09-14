# HISTORICAL — this directory does not own the government database

**Marked historical 2026-09-12 (ID3a-d, Scott's decision).** `government-lease` owns every migration,
routine, view, trigger and policy on the **government** Supabase project. This directory is the
**record of what `life-command-center` applied in the past** — it is kept for history, it is never
applied again, and no new file is added here.

## Why this exists

ID3a-c (agency canonicalizer contamination fix) shipped live in `government-lease` (PR #398) and was
verified against the deployed database. This directory's own copy of the same fix —
[`20260912030000_gov_id3ab_agency_canonicalizer_contamination_fix.sql`](./20260912030000_gov_id3ab_agency_canonicalizer_contamination_fix.sql)
— is **stale relative to what is actually deployed**: its committed `canonicalize_agency()` has **no
state-qualifier guard** and the **old ICE/CBP branch order**. Re-applying that file today would
silently restore two known-bad mappings:

1. `TEXAS DEPARTMENT OF AGRICULTURE` → `USDA` (a state agency reads as the federal one — the
   missing state-qualifier guard).
2. `Immigration & Customs Enforcement` → `CBP` (the `&` was never normalized to `and`, so ICE fell
   through to CBP's bare `customs` match — the old branch order).

Nothing in either repo said which one owned the database, which is exactly how the two copies were
able to drift apart without anyone noticing. See `CLAUDE.md` → "ONE REPO OWNS EACH DATABASE'S
OBJECTS" and `docs/architecture/data-coherence-invariants.md` **I16** for the full doctrine and the
drift-detector design this incident produced.

## Rules for this directory going forward

- **Never apply any `.sql` file in this directory to the live government database.** They are
  historical, not current. The live, correct copy of every government DB object lives in
  `government-lease`'s `sql/` directory.
- **Never add a new file here.** A new government DB change is a migration in `government-lease`,
  full stop. `test/gov-migrations-directory-retired.test.mjs` enforces that every file here carries
  the historical header (below) and fails if a new, unheadered file appears.
- **If you need to know what a government DB object currently does, read the live database or
  `government-lease`'s committed source — never this directory.** A migration file here is evidence
  of a past intent, not a current fact.
- **Do not delete these files.** They are the audit trail of everything this repo ever applied to
  the government database before ownership was formalized. Retire, never delete.

## Every `.sql` file here carries this header

```sql
-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged — read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.
```

`20260912030000_gov_id3ab_agency_canonicalizer_contamination_fix.sql` is the file that made this
rule necessary — see the "Why this exists" section above before you even consider reading its body
for guidance on `canonicalize_agency()`.
