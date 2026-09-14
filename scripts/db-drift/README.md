# I16 drift detector — deployed-vs-committed definition drift

**Status: designed 2026-09-12 (ID3a-d), NOT YET RUN under real credentials.** This sandbox has no
network access to Supabase, so the results below are not fabricated — they do not exist yet. Do
not schedule this on the I11 alert path until it has been run once, green, under real credentials
(this repo's own "a new job is not shipped until it has been green once" rule).

## What this closes

`docs/architecture/data-coherence-invariants.md` **I16**: a function, view, trigger, or policy
edited by hand in a database and never committed reads, to every later session, as if the repo
were the source of truth. This bit twice on the government database's `canonicalize_agency()`:
once when the deployed function had already diverged from its own committed migration (word
boundaries the file lacked), and again when a second repo (`life-command-center`) held a stale
committed copy of the same function that would silently regress the fix if ever re-applied.

## Files

- [`gov-deployed-vs-committed-drift.sql`](./gov-deployed-vs-committed-drift.sql) — the "live" half
  of the comparison. Run this against the government Supabase project and it returns one row per
  routine/view/materialized-view/trigger in the `public` schema, with a normalized-definition
  hash. Fully documented inline, including the exact shape of the "expected" half (built by
  replaying `government-lease`'s migrations) and the final diff query.

## How to run it for real

1. Run `gov-deployed-vs-committed-drift.sql` against the **government** project
   (ref `scknotsqkcheojiaewwh`) — via `psql`, the Supabase SQL editor, or
   `mcp__Supabase__execute_sql` with that project selected. Save the output.
2. Build the "expected" hash list by replaying `government-lease`'s `sql/*.sql` migrations in
   date order and, for each object name, hashing the body of the LAST `CREATE OR REPLACE`
   statement seen for it (a small Node script; no DB required — see the SQL file's inline
   instructions for the exact algorithm, which must match the SQL file's normalization so
   formatting alone never produces spurious drift).
3. Diff the two lists on `(object_kind, object_name)`. Anything that isn't `match` is worth a
   look; `drifted` and `expected_but_not_deployed` are the two verdicts that belong on the I11
   alert path once this has been proven out on a real run.

## Scope

This first pass covers the **government** database only — the database where drift has already
bitten twice. Once this is run once and found reliable, the same shape (hash function against
each owning repo's own migrations) generalizes to `Dialysis_DB` (owning repo: the `Dialysis`
repo) and `LCC Opps` (owning repo: `life-command-center` itself, so for LCC Opps this becomes a
same-repo consistency check rather than a cross-repo one).

## Record of this being run

Nothing yet. When this is run for the first time, record the result (drift list, or "0 drift
found") in `docs/claude-code/STATUS.md` and update this README and
`docs/architecture/data-coherence-invariants.md` I16's detector-status line.
