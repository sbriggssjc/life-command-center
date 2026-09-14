# HCRIS-TIMEOUT — `hcris_cost_reports`/`hcris_propagation` time out on nearly every CMS ingestion run, going back months; `facility_cost_reports` hasn't been updated in 182 days

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention. **Not part of the `PRI` connection-retry arc** — this is a separate, long-standing defect this
session found while investigating what Scott reported as a run "stuck for 2+ days."

## 0. What actually happened — not a hang, but a real, chronic problem underneath

Scott reported the CMS ingestion run as running for "more than 2 days." **It is not one continuous run** —
`ingestion_tracker` shows four separate run cycles back-to-back since 2026-09-12, each taking roughly
10–16 hours, with a new cycle starting immediately after the previous one ends. The pipeline itself is
alive: `properties.estimated_annual_revenue` is being written to in real time (1,800+ rows in the trailing
15 minutes at last check), and the core `cms_medicare_clinics` fetch/upsert step is correctly a no-op each
cycle (zero new rows — this arc already confirmed that specific zero-counter pattern is benign and matches
CMS's near-annual publish cadence, not a defect).

**The actual, previously-unflagged defect**: every one of the last several run cycles' `run_log` summaries
(`"CMS ingestion partial"`) reports `"Failed steps: hcris_cost_reports, hcris_propagation, run_timeout"` (or
a subset of that). This is not new — the same failure signature (`hcris_propagation`, `run_timeout`)
appears in `run_log` going back to **2026-06-25**, predating this whole `PRI` arc. **Confirmed live**:
`facility_cost_reports` — the table `hcris_propagation` is presumably meant to update — has not had a row
touched in **182 days**, last `updated_at` **2026-03-16**.

This means: on essentially every scheduled run for the last several months, a large chunk of the run's
wall-clock time (the bulk of each 10–16 hour cycle, based on `elapsed_seconds` in the `"live run summary"`
log entries — 48,921s and 53,660s on the two most recent cycles, i.e. 13.6h and 14.9h) is being spent on a
step that ultimately times out and fails, while the data it's supposed to produce has been stale for six
months. This has likely been silently costing significant compute/wall-clock on every run this entire time.

## 1. The catalog

**(a) Find out what `hcris_cost_reports`/`hcris_propagation` actually does, and why it never finishes.** Is
it fetching from an external source (HCRIS/CMS cost report files), processing a large existing dataset, or
something else? Get the actual timeout value and what's timing out — a slow external fetch, a slow query
against a large table, an algorithmic complexity problem, or something else entirely. Read the code before
guessing.

**(b) Fix it, or make an honest recommendation if it can't be fixed outright this round.** Candidates,
in order of how well they're likely to fit without knowing the code yet (read the code before picking):
break the step into resumable batches instead of one long unbroken operation; move it out of the main
`run_cms_ingestion()` critical path entirely (a separate, less time-pressured job, if nothing else depends
on it completing in the same run); or if it's a genuinely slow external fetch, add caching/incremental
fetching so it isn't redone in full every run. Don't invent a new mechanism if one of these already fits
the existing design.

**(c) Confirm whether this step's continued failure has been silently affecting anything else in the same
run.** The `"Failed steps"` list on 2026-09-13's two cycles reads `"hcris_cost_reports, hcris_propagation,
run_timeout"` — is `run_timeout` a genuine third failed step, or is it the mechanism that finally kills the
other two after they've each run far past any reasonable single-step budget? If the latter, does hitting
that overall run timeout cut off or skip any other step that would otherwise have completed successfully
in that same cycle?

**(d) State plainly what `facility_cost_reports` being 182 days stale means downstream.** This arc already
knows `DE2`/`DE4` (existing `PLANNED-BACKLOG.md` rows) track HCRIS-derived economics figures and their
confidence-tier labeling — don't duplicate that work, but do confirm whether this timeout is the actual
root cause keeping that data stale, or a separate, unrelated path also feeds `facility_cost_reports`.

## Out of scope

- `cms_medicare_clinics`'s core fetch/upsert logic, `ownership_linker`, `oig_leie_ingestor`,
  `census_demographics`, the `ingestion_lock`/`ingestion_tracker` reclaim mechanics — all confirmed
  unaffected by this issue and already covered by the `PRI` arc.
- `DE2`/`DE4`'s display/labeling policy for HCRIS-derived figures — that's a separate, already-tracked
  question about how to show a number once it exists, not about why the underlying data stopped updating.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.
- Don't assume the currently-running cycle is unhealthy or try to kill it — it's alive and doing real work
  on everything except this one step; let it finish its natural cycle unless told otherwise.

## Verify on

- (a): the actual root cause of the timeout, quoted from the code, not a guess.
- (b): the fix applied (or an honest, specific reason it can't be fully fixed this round, with a concrete
  recommendation for what would fix it), and live before/after — does the next run cycle complete
  `hcris_cost_reports`/`hcris_propagation` successfully, or at least fail faster and cleaner than a
  14-hour timeout.
- (c): a plain answer on whether `run_timeout` has been silently affecting other steps in the same run.
- (d): a plain statement connecting (or explicitly not connecting) this fix to `facility_cost_reports`
  finally being able to update again.
