# SEC1-definer-default — anon-executable SECURITY DEFINER triage (2026-09-05)

**Status: guard built (Unit 1, shipped); this doc is the light-touch Unit 2 note — a
starting list for an operator to verify live, not a completed audit.** No live database
was queried to produce this file (the sandbox that built the guard has no Supabase
credentials); everything below is drawn from what CLAUDE.md and the repo's migration
history already say. Every named function needs a live
`has_function_privilege('anon', oid, 'EXECUTE')` check before anyone acts on it.

## What's actually new here

**Unit 1 — the guard.** `test/sql-definer-privilege-stanza.test.mjs` scans every `.sql`
file under `supabase/migrations/**` (root + `dialysis/` + `government/`) for a migration
that creates a `SECURITY DEFINER` function, and requires — in the SAME file — both a
`revoke ... from public, anon, authenticated` statement and a `has_function_privilege(`
assertion. **219 of 220** such migrations in the repo predate this rule and are carried
on a file-path ALLOWLIST (with two deliberate exemptions named below); the guard's job
from here is to stop that count growing, not to retroactively fix 219 files.

The mechanism (revoke from all three roles, assert with `has_function_privilege()`,
never trust the REVOKE statement as proof) is already documented twice in CLAUDE.md —
the **B6d** `compute_feed_cadence`/`compute_feed_freshness` section and the **OCR2**
section — and is not repeated here.

## Known anon-executable mutating SECURITY DEFINER functions (from CLAUDE.md, unverified live)

- **`lcc_apply_cleared_tombstones`** (LCC Opps) — named directly in this task's spec as
  the one anon-executable, mutating, dynamic-SQL function on LCC Opps worth checking
  first. Not independently re-confirmed here; verify with
  `has_function_privilege('anon', 'public.lcc_apply_cleared_tombstones'::regproc, 'EXECUTE')`
  (adjust the signature if it's overloaded) before treating this as settled.
- **`gov_merge_property_apply`** — CLAUDE.md's ADDR1b-merge section: renamed from an
  older name, and the RENAME landed **without** re-applying the revoke — the new name
  stayed `anon`/`authenticated` executable while dia's equivalent was already locked.
  Fixed per that section's dated note, but re-verify live given how many times this
  specific mistake (porting a function without porting its privileges) has recurred.
- **`_dia_merge_fold_one_row` / `dia_merge_fold_table`** and their gov twins
  (**MERGE1 / MERGE1-sec**) — shipped anon-executable in
  `20260905120000_{dia,gov}_merge1_fold_on_collision.sql`, fixed 10 minutes later in
  `20260905130000_{dia,gov}_merge1_fold_function_privileges.sql`. These are the guard's
  own positive control (Unit 1's test file asserts the follow-up migrations satisfy the
  stanza) — they are the reason this task exists, not new information, but worth
  re-verifying live since the fix migration must actually have been APPLIED (a DB
  migration applies instantly once run, but "committed to the repo" and "run against the
  live database" are two different facts — see CLAUDE.md's "merged is not running" /
  "running but not merged" doctrine).
- **`lcc_p195_unmerge` / `lcc_unmerge_entity` / `lcc_a2a_unmerge`** — CLAUDE.md's ENTC
  section says these three were narrowed to `service_role` on 2026-09-03, with `anon`/
  `authenticated` revoked from both the `public` grant and the explicit per-role grants,
  and asserted with `has_function_privilege()`. Recorded as fixed there; still worth a
  live spot-check given the pattern's recurrence rate in this repo.

## Deliberately anon-executable — do not "fix" these

- **`compute_feed_freshness`** / **`compute_feed_cadence`** (gov + dia) — the LCC
  cross-DB pull reads `v_feed_freshness` as `anon`, and revoking that grant would
  silently blind the freshness monitor (CLAUDE.md, B6d section). Both are named in the
  guard's ALLOWLIST with this exact reason so nobody "completes" the sweep by locking
  them down.

## What this doc is NOT

It is not a census of every SECURITY DEFINER function in either live database (LCC
Opps / dia / gov) — that needs Supabase credentials and a proper query against
`pg_proc`/`pg_namespace`/`has_function_privilege()`, which this sandbox cannot run. The
219-entry ALLOWLIST in `test/sql-definer-privilege-stanza.test.mjs` is the closest thing
to a full list of *migrations* that never shipped the stanza; whether the function each
one creates is still live, still anon-executable, and still mutating (vs. read-only,
vs. already re-locked by a later un-triaged migration) is exactly what an operator with
live DB access needs to check next, function by function, starting with the ones named
above.
