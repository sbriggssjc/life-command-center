# RATINGS3 — `ratings` still has zero successful writes after two claimed fixes; prove the fix live this time, before reporting done

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc — the code lives in the other repo, this repo just tracks the ask and the
response.

## 0. Why this prompt is different from the last two

This is the **third** attempt at the same bug. Both prior attempts (RATINGS-INSERT-COLLISION, RATINGS2)
were reported fixed, with tests reported green, and both turned out to still fail 100% of the time in
production — confirmed live against Dialysis_DB after each merge. This is not a new bug to diagnose;
the diagnosis has been right twice in a row (a partial-index/`ON CONFLICT` mismatch on
`ratings_medicare_id_uidx`). **What has been wrong twice in a row is confidence that the fix actually
works, arrived at from tests alone.** Do not repeat that. This prompt requires live proof against
Dialysis_DB before the response says "done" — not because live proof is nice to have, but because it
is the only thing that has been missing both times.

**The Supabase MCP connector is reauthorized as of this prompt.** If it disconnects again mid-session,
stop and say so explicitly in the response rather than reporting the fix as complete without it — a
response that says "live verification not done" is honest and useful; a response that omits the caveat
and reports success anyway is what caused this to take three rounds.

## 1. What is measured — same facts, now with a fuller picture across an entire run

A fresh run (2026-09-10, all of CFE-RUNAWAY / RATINGS-INSERT-COLLISION / PROPREV1 / RATINGS2 merged
beforehand) was tracked end-to-end via Dialysis_DB's own Postgres logs, not just a short Railway
excerpt:

- The `ratings`-ingestion phase of this run spanned roughly **18:00–18:59 UTC (59 minutes)**.
  Throughout that ENTIRE hour, `duplicate key value violates unique constraint
  "ratings_medicare_id_uidx"` fired at a sustained **15–20 times per minute — 876 total**. It did not
  taper off or improve partway through; it was constant for the full hour, then stopped only because
  that phase of the pipeline ended (moved on to other tables), not because anything succeeded.
- **6 genuine Postgres `canceling statement due to statement timeout` events occurred during that same
  hour** — new collateral damage that hadn't appeared in earlier, shorter-window checks of this bug.
- Live confirmation, before and after this run: `ratings` is still exactly **7,013 rows**,
  `max(updated_at)` still **2026-03-12** (the March backfill date) — unchanged. Not one row was
  successfully written or updated by RATINGS2's fix, across a full hour of the ingestion phase
  dedicated to writing them.
- **For contrast, in the same run:** PROPREV1's fix (a different bug, same arc) DID work —
  `properties.estimated_annual_revenue`'s null count dropped by 273 rows, confirmed live. So a fix
  reported the same way, with the same kind of test coverage, can and did work this run. The difference
  is not that live verification is impossible in this sandbox — it's that RATINGS2 either wasn't
  actually verified live, or was verified against something that doesn't match what's deployed.

## 2. Units

**Unit 1 — read the ACTUAL deployed code, not the PR description.** Before writing anything, read
`_direct_upsert_record` and `_ingest_ratings()` exactly as they exist in `main` right now (post
RATINGS2 merge). Confirm word-for-word what `conflict_where` value is passed, what the REST fallback's
update-then-insert logic actually does, and whether either path is reachable at all given how
`_ingest_ratings()` calls them. State this plainly — if the deployed code doesn't match RATINGS2's own
response description, say so explicitly; that would itself be the root cause of this round.

**Unit 2 — reproduce the failure live, first, before touching any code.** Using the now-reauthorized
Supabase MCP, run the actual upsert call (or as close to the real call as you can construct — same
client, same table, same `on_conflict`/`conflict_where` arguments the code uses) against Dialysis_DB
directly, targeting an existing `medicare_id` (e.g. 102594, 213503, or any row from the March backfill —
confirm one still exists first). Confirm you can reproduce the exact `23505`/`42P10` failure live,
in this session, before proposing a fix. If you cannot reproduce it, that is itself important
information — it would mean the bug is something else, or intermittent, or environment-specific.

**Unit 3 — fix it, then prove the fix on the SAME live row.** Once a fix is made, run it against
Dialysis_DB directly — not a test double, not a mock, the actual client hitting the actual table —
targeting the same existing `medicare_id` used in Unit 2. Confirm its `updated_at` timestamp actually
changes. This is the one check that has been skipped or reported-but-not-actually-done twice now.
Screenshot-equivalent for a sandbox: paste the actual before/after row content and timestamps into the
response, not just "verified."

**Unit 4 — re-check the 6 statement timeouts.** Confirm whether they were caused by the duplicate-key
storm itself (e.g., lock contention or retry pressure from hundreds of failed inserts per minute) or
something unrelated. If related, note that fixing the upsert should eliminate them as a side effect,
but don't assume it — check after the fix if a live re-run is feasible in this session.

**Unit 5 — regression test AND a live smoke test, not either/or.** A unit test with a real (not mocked)
connection to a scratch/test schema if the sandbox allows one, in addition to whatever mocked tests are
appropriate for CI. If no live-database test is possible in CI, say so explicitly and explain why the
existing tests didn't catch this twice — that gap itself needs naming, not just working around.

**Unit 6 — do not report "done" without Unit 3's live proof.** If Supabase access is lost mid-session
and Unit 3 cannot be completed, the response must say exactly that — "fix implemented, tests green,
live proof NOT obtained because [reason]" — rather than a summary that reads as complete. This session
(life-command-center) will decline to mark this backlog item anything but 🔴/unverified without an
explicit before/after row shown in the response.

## Out of scope

- `clinic_quality_metrics`'s probe fix (RATINGS2's other half) — not implicated by this window's
  evidence, leave untouched unless Unit 1's code read finds it's entangled with the `ratings` fix.
- `clinic_financial_estimates`/PROPREV1 — confirmed working this run, don't touch.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.

## Verify on

- Unit 1: the actual deployed code quoted verbatim, confirmed to match or explicitly found to differ
  from RATINGS2's own description.
- Unit 2: the failure reproduced live, in this session, with the actual error shown — not asserted.
- Unit 3: **an actual before/after row from Dialysis_DB, `updated_at` changed, pasted into the
  response.** This is the one non-negotiable requirement of this prompt.
- Unit 4: the statement timeouts explained, related or ruled unrelated.
- Unit 5: real test coverage plus an explanation of the prior gap.
- Unit 6: if live proof isn't obtained, the response says so in plain language rather than reading as
  a success report.
