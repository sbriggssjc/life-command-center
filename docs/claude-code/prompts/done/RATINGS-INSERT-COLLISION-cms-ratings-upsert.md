# RATINGS-INSERT-COLLISION — `ratings` insert path collides with existing rows, no upsert

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the same
convention as `CFE-RUNAWAY-cms-financial-estimates-repair.md` — the code lives in the other repo, this
repo just tracks the ask and the response.

## 0. Why this is next

CFE-RUNAWAY (PR #7398, merged) fixed a per-record full-table probe against
`clinic_financial_estimates`. Scott triggered a fresh CMS ingestion run to confirm that fix. Ten
minutes in, before the run even reached the financial-estimates phase, its `ratings`-table insert path
was already jammed — a circuit breaker open, retries cascading, and duplicate-key rejections at the
database. This is a **separate bug** from CFE-RUNAWAY (different table, different failure shape, no
statement timeouts observed), but it's blocking the same pipeline and was found live during the same
test. Fix it before re-running, or the next test run tells you nothing new about `ratings`.

## 1. What is measured (do not re-derive from scratch — confirm, then fix)

From a Railway log excerpt (~30 seconds, mid-run, service `3a084723-add6-4923-b790-2f1e3a8d35d2`) and
independently cross-checked live against Dialysis_DB (Supabase project `zqzrriwuavgrquhisnoa`):

- `WARNING:src.run_error_ledger:safe_execute error [medium] table=ratings op=insert:
  circuit_open:('insert', 'ratings')` — **349 times in 30 seconds.** The circuit breaker for
  `ratings` inserts is open and staying open; almost nothing is getting through.
- `WARNING:src.cms_aux_ingestion:Retrying insert ratings with a fresh client for medicare_id=X` —
  **174 times.**
- `WARNING:src.cms_aux_ingestion:Skipping clinic_quality_metrics for missing medicare_clinics parent
  medicare_id=X` — **210 times** — a cascade off the ratings failures (quality metrics need a
  `ratings` parent row that never lands).
- 12 log lines (3 distinct `medicare_id`s: 213503, 222587, 232554) showing
  `duplicate key value violates unique constraint "ratings_medicare_id_uidx"`, each in a 3-line
  pattern: two `INFO:src.supabase_execute_wrapper` lines carrying the Postgres `APIError`, then one
  `ERROR:src.core_utils:supabase.execute FAILED` line, then the `run_error_ledger` warning above.
- **Verified live on Dialysis_DB, same window:** 39 matching `duplicate key … ratings_medicare_id_uidx`
  entries in `postgres_logs` (real DB-level rejections, not just app-log noise). **Zero**
  `statement timeout`/`canceling statement` entries in the same window — this is not causing the
  cascading-500s damage CFE-RUNAWAY did; treat it as a correctness/retry-storm bug, not a DB-outage one.
- The three flagged `medicare_id`s each already have **exactly one row** in `ratings`,
  `updated_at` = **2026-03-11** (a prior backfill, ~6 months old).
- `ratings` currently holds **7,013 rows total**, and the table's **most recent `updated_at` across
  every row is 2026-03-12** — nothing has actually written to `ratings` in six months, despite this
  run actively hammering it for 10+ minutes.
- A value of `count=7013` appears twice per iteration in the raw `supabase_execute_wrapper` log line
  (previously unidentified) — it matches `ratings`'s exact current row count. Treat this as a second
  unfiltered full-table probe against `ratings` on (or near) every iteration — the same species of bug
  as CFE-RUNAWAY's two probes against `clinic_financial_estimates`, just not yet timing out because
  7,013 rows is trivial next to 1.24M. **Find this call site too — don't fix only the insert collision
  and leave a second probe in place.**

**Working hypothesis, to confirm not assume:** the `ratings` write path in `cms_aux_ingestion.py` (or
wherever it lives) issues a plain `INSERT` with no `ON CONFLICT`/upsert. Any run against a
`medicare_id` already present (e.g., anything from the March backfill) collides on the unique index
every time, the circuit breaker trips as a defensive response (correctly — not "stuck"), and the retry
loop makes it worse rather than recovering.

## 2. Units

**Unit 1 — name the exact call site(s).** Find where `ratings` rows are written in the CMS
ingestion path (likely `src/cms_aux_ingestion.py`, given the log's own module name) and where the
`count=7013`-style probe originates. State both file:line, confirm or correct the plain-INSERT
hypothesis, and confirm whether the same pattern exists anywhere else the pipeline writes to `ratings`.

**Unit 2 — fix the insert to upsert.** The `ratings_medicare_id_uidx` constraint means one row per
`medicare_id` is the intended shape — so a re-run should update the existing row, not fail. Convert
the write to a real upsert (`ON CONFLICT (medicare_id) DO UPDATE`, or the project's existing update-if-
exists pattern if it has one elsewhere — check `financial_estimate_tracker.py`'s `save_estimate()` from
the CFE-RUNAWAY fix for a precedent in this same codebase). Do not paper over this with more retries or
a longer backoff — the row already exists; retrying an insert that will always collide is exactly the
loop measured above.

**Unit 3 — remove the second full-table probe.** Once Unit 1 names its call site, apply the same fix
class as CFE-RUNAWAY: cache whatever it's fetching (schema, PK column, row count — whatever `count=7013`
turns out to be) once per run, not once per record. State explicitly whether this was actually the same
`_pk_column()`/`get_live_table_columns(force_refresh=True)` pattern CFE-RUNAWAY fixed elsewhere in the
codebase but missed on `ratings`, or a distinct call site.

**Unit 4 — the circuit breaker itself.** Confirm it resets/closes once inserts start succeeding again
(i.e., it's not independently stuck regardless of the upsert fix). If it never resets on its own and
needs a process restart, say so plainly — that's a second, smaller defect worth fixing or flagging, not
something to leave implicit.

**Unit 5 — cascade check.** Once `ratings` inserts succeed, confirm `clinic_quality_metrics` stops
skipping for "missing parent" — that dependency should resolve itself once Unit 2 lands, but verify it
rather than assume it.

## Out of scope

- No changes to `clinic_financial_estimates`/`financial_estimate_tracker.py` (CFE-RUNAWAY is separate
  and already merged) unless Unit 3 turns out to share a helper with it — if so, reuse the fix, don't
  duplicate it.
- No retention/deletion of any `ratings` rows.
- No `life-command-center` code changes — this is entirely in `Dialysis`.

## Verify on

- Unit 1: exact file:line for both the insert call site and the `count=7013` probe, confirmed or
  corrected hypothesis.
- Unit 2: an upsert in place; a rerun against an already-existing `medicare_id` succeeds (updates)
  instead of raising `duplicate key`.
- Unit 3: the second probe demonstrated to run at most once per run, not once per record.
- Unit 4: circuit-breaker reset behavior stated explicitly, not left implicit.
- Unit 5: `clinic_quality_metrics` skip-for-missing-parent count drops to ~0 in a follow-up run once
  Unit 2 is live.
- This repo's own test suite green, same invocation as CFE-RUNAWAY's (`--ignore=tests/integration/`
  per `Dialysis`'s `CLAUDE.md`), with new tests pinning the upsert behavior (an insert against an
  existing `medicare_id` must update, not raise).
