# RATINGS2 — `ratings` upsert still fails (partial-index gotcha) + a new, much larger full-table probe on `clinic_quality_metrics`

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc — the code lives in the other repo, this repo just tracks the ask and the
response.

## 0. Why this is next

CFE-RUNAWAY (#7398), RATINGS-INSERT-COLLISION (branch merged), and PROPREV1 (#7400) are all merged. A
fresh run confirmed CFE-RUNAWAY still holding (no recurrence of its probes in the last check), but
surfaced two problems in the `ratings` fix specifically:

1. **The upsert RATINGS-INSERT-COLLISION shipped does not actually work — zero rows have been written
   to `ratings` across two full test runs.** Verified live on Dialysis_DB: `ratings` is still exactly
   7,013 rows, `max(updated_at)` still 2026-03-12 (six months old), unchanged by either run.
2. **A new full-table probe, much larger in scale than anything measured before, is hitting
   `clinic_quality_metrics`** — 844 times in a single 30-second window. `clinic_quality_metrics` is
   small today (7,555 rows) so it hasn't caused a timeout yet, but this is the same unbounded-probe
   shape as CFE-RUNAWAY on a table that could grow. Fix it now, before it does.

## 1. What is measured

From a Railway log excerpt (~30 s, 2026-09-10 17:43:59–17:44:29 UTC, roughly 22 minutes into a fresh
run) and independently cross-checked live against Dialysis_DB:

**Problem 1 — `ratings` upsert still throws duplicate-key.**
- The write now correctly logs `op=upsert` (RATINGS-INSERT-COLLISION's conversion from `INSERT` did
  land) but still raises `duplicate key value violates unique constraint "ratings_medicare_id_uidx"`
  (Postgres code `23505`) on already-existing rows — a 3-retries-then-fail pattern per `medicare_id`
  (this window: 102594, 102605, 102617 — all from the March backfill, `updated_at` 2026-03-11), then
  `circuit_open:('upsert', 'ratings')` (21× in 30 s, vs `('insert', 'ratings')` before — the breaker key
  changed with the op, same underlying block).
- **Root cause, found and confirmed by this session, not yet by `Dialysis`'s own code:**
  `ratings_medicare_id_uidx` is a **partial unique index**:
  `CREATE UNIQUE INDEX ratings_medicare_id_uidx ON public.ratings USING btree (medicare_id) WHERE
  (medicare_id IS NOT NULL)`. PostgREST's `.upsert(data, on_conflict='medicare_id')` generates
  `INSERT ... ON CONFLICT (medicare_id) DO UPDATE ...` — Postgres can only use a **partial** index as an
  `ON CONFLICT` arbiter when the `ON CONFLICT` clause's predicate matches it exactly. PostgREST's
  standard `on_conflict` query param has no way to express that predicate, so Postgres can't find a
  matching arbiter, falls back to a plain insert path, and that's what's actually throwing the
  `23505` — not a logic bug in the retry code, a genuine PostgREST/partial-index interaction.
  **Confirm this diagnosis independently before fixing it — don't take it on faith from this session.**
- Live confirmation: `postgres_logs` shows 51 matching duplicate-key hits in the same window (real,
  not just app-log noise); `ratings` row count and `max(updated_at)` both unchanged before vs. after
  two separate full runs.

**Problem 2 — a new, large full-table probe against `clinic_quality_metrics`.**
- `count=7555` appeared **844 times in 30 seconds** in the raw `supabase_execute_wrapper` log line —
  confirmed live to match `clinic_quality_metrics`'s exact current row count (7,555).
- **This is not the same call site RATINGS-INSERT-COLLISION's response said it removed** (that was
  `_load_existing_key_set()` against `ratings`, and — see below — even that one doesn't look fully
  gone). Find the actual call site hitting `clinic_quality_metrics` at this rate; state whether it's a
  distinct helper or a shared one also used elsewhere.
- No statement timeouts yet in `postgres_logs` for this window — `clinic_quality_metrics` is still
  small enough to absorb the rate. Treat this as a live, growing risk, not a hypothetical one: at
  ~28 calls/second sustained, this table will eventually hit the same wall `clinic_financial_estimates`
  did.

**Problem 3 — the `count=7013` probe RATINGS-INSERT-COLLISION's response said was removed still
appears.** 48 occurrences of `count=7013` (matching `ratings`'s row count) in the same 30-second
window. Either `_load_existing_key_set()` is still called from somewhere, a second call site does the
same thing, or the removal didn't actually ship as described — find out which.

## 2. Units

**Unit 1 — confirm or correct the partial-index diagnosis.** Verify `ratings_medicare_id_uidx`'s
definition and confirm (or correct) that this is why the upsert falls through to a plain insert. Trace
the exact `.upsert(...)` call in `_ingest_ratings()` and confirm the `on_conflict` value passed.

**Unit 2 — fix the upsert so it actually works against a partial unique index.** Do not just retry
harder or catch-and-ignore the 23505. Options to weigh (pick one, state why): (a) issue the upsert via
a Postgres function/RPC that can express `ON CONFLICT (medicare_id) WHERE medicare_id IS NOT NULL DO
UPDATE ...` directly; (b) replace the partial unique index with a plain unique constraint on
`medicare_id` if the column is effectively always non-null in practice (confirm this is actually true
before proposing it — check for existing NULL rows first); (c) an explicit two-step
update-then-insert-if-no-rows-affected pattern instead of relying on `ON CONFLICT` at all. State the
tradeoffs, pick one, implement it.

**Unit 3 — find and remove the `clinic_quality_metrics` full-table probe.** Name the exact call site
(file:line). Apply the same fix class as CFE-RUNAWAY and the original RATINGS-INSERT-COLLISION intent:
cache whatever this is fetching once per run, not on (near) every record. Confirm whether it shares a
helper with the `count=7013` probe in Unit 4 below.

**Unit 4 — explain why the `ratings` `count=7013` probe is still present.** RATINGS-INSERT-COLLISION's
response said `_load_existing_key_set()` was removed entirely. Either it wasn't, a different call site
produces the same signature, or something re-added an equivalent check. State which, with file:line.

**Unit 5 — regression tests.** For Unit 2, a test that actually exercises a real upsert against a table
with a partial unique index (not a mock that assumes `ON CONFLICT` works) — this is exactly the kind of
test gap PROPREV1 already found once in this arc; don't repeat it. For Units 3–4, tests asserting the
relevant fetch/count call happens at most once per run.

**Unit 6 — live verification, not just tests.** After the fix, confirm against Dialysis_DB directly
(or as close as the sandbox allows) that (a) a `ratings` row with an existing `medicare_id` actually
gets its `updated_at` bumped by a re-run, and (b) the `clinic_quality_metrics` call count drops to at
most once per run in a follow-up log.

## Out of scope

- `clinic_financial_estimates`/PROPREV1's `properties.estimated_annual_revenue` path — untouched by
  this window's evidence, already separately merged; don't re-open without new evidence.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.

## Verify on

- Unit 1: partial-index diagnosis confirmed or corrected, with the exact `on_conflict` call shown.
- Unit 2: chosen fix implemented; a live check shows an existing `medicare_id`'s row actually updates.
- Unit 3: exact file:line for the `clinic_quality_metrics` probe; demonstrated to run at most once per
  run afterward.
- Unit 4: exact file:line explaining the still-present `count=7013` probe; fixed or explained.
- Unit 5: new tests exercising the real upsert/fetch paths (not mocks assuming success), RED before /
  GREEN after.
- Unit 6: live confirmation on both fronts, not just a green test suite — this arc has twice now had
  "tests pass" and "production still broken" both true at once; don't let this be a third time.
- This repo's own test suite green (`--ignore=tests/integration/`).
