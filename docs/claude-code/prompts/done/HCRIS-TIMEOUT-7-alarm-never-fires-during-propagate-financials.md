# HCRIS-TIMEOUT-7 — `HCRIS-TIMEOUT-6`'s fix did not work: the `StepTimeout` still never fires during `propagate_financials()`

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc. Seventh round. `HCRIS-TIMEOUT-6` (PR #7417, branch `claude/hcris-timeout-6-8f3k2a`,
confirmed merged and redeployed) added `except TimeoutError: raise` at 4 sites in and around
`propagate_financials()`, plus a batched SELECT-prefetch for the patient-counts loop. **A live test of that
fix, on a real scheduled overnight run, shows it did not solve the problem it was meant to solve.** Full
evidence below — this is not a re-litigation of whether #7417 is deployed (it is, confirmed) or whether its
code changes are real (they are) — it's that the fix's stated goal, a clean `StepTimeout` at ~15 minutes, did
not happen.

## 0. What's now independently confirmed live, going into this round

- **Deploy timing is not ambiguous this time.** Scott's Railway screenshot shows the Current Deployment for
  the `cms-ingestion` service as PR #7417, deployed roughly 14 hours before the run below started. There is no
  question of this run having executed pre-fix code.
- A scheduled cron run started 2026-09-17 06:04:28 UTC (`ingestion_tracker` row
  `0cc86da6-554c-4f4d-aaca-e8b2ff0370fd`, `dataset_id='cms_medicare_clinics'`, `source='cms_ingestion'`).
- Same opening error burst every round has shown: 06:04:28–06:17ish UTC, `circuit_open:('insert','ratings')` /
  `circuit_open:('insert','clinic_quality_metrics')` / duplicate-key `APIError`s. Nothing new here.
- Then real, sustained writes: `properties.updated_at` shows continuous activity from shortly after the error
  burst through **15:24:49 UTC**, confirmed by log content (`src.propagation_utils` logging
  `"Propagating to properties: {'estimated_annual_revenue': ...}"`, interleaved with the same
  `"Skipping field '...' - not in Supabase schema for 'facility_patient_counts'"` warnings as every prior
  round) — **9h20m of runtime, 10,243 distinct properties touched** (more than the 6,879 that triggered
  `HCRIS-TIMEOUT-6` in the first place, and longer than the 4h18m run that triggered it).
- **Zero rows in `ingestion_run_errors` for the entire run.** No `StepTimeout`, no exception, nothing — despite
  running more than 37x past the documented 900s per-step budget, and despite the fix that was supposed to make
  exactly that timeout fire and get re-raised instead of swallowed.
- Tracker row never closed: `run_status='started'`, `finished_at=null`, `notes='{}'`. `facility_cost_reports`
  is still frozen at `2026-03-16` — the pipeline has still never reached that step in any round of this arc.
- **One genuinely new, positive signal**: late in the run, the write pattern shifted from the smooth continuous
  per-property ramping seen in the `HCRIS-TIMEOUT-6` run to clean batches of roughly 60 writes every 10 minutes.
  That shape looks like the round-6 SELECT-prefetch batching working as intended — worth confirming, and worth
  keeping rather than touching again if confirmed.
- **One unreconciled data point, presented as-is, not as a settled interpretation.** Railway's Deployments tab
  shows a "Stopping Container" event logged at **"7:34:18"** for this execution. This session has not
  determined what that figure means: it could be an elapsed-duration counter (7h34m18s, which measured from
  the 06:04:28 UTC start would land around 13:38:46 UTC — well before the 15:24:49 UTC last write this session
  observed in Supabase) or a wall-clock timestamp in some timezone (neither straight UTC nor a Central
  conversion lines up cleanly with 15:24:49 UTC either). **Please help reconcile this figure against the
  Supabase timeline above** — state plainly if it can't be reconciled from the code/platform side, rather than
  forcing an interpretation.

## 1. What this round needs to answer

**(a) Why does the 900s `StepTimeout` still never fire during this step, even though the `except TimeoutError:
raise` fix from `HCRIS-TIMEOUT-6` is confirmed deployed?** A re-raise only matters if the exception is ever
raised in the first place. Check directly against the deployed code, not by re-describing intent:
  - Is `propagate_financials()` (or whatever wraps the `facility_patient_counts` propagation step) actually
    inside a call to `run_with_timeout()` / wherever `signal.alarm(900)` gets armed for this step? Confirm this
    was never actually true, rather than assumed — `aux_cms_tables` had the wrapper (per `HCRIS-TIMEOUT-4`/`-5`);
    it has not been directly confirmed that this later step does too.
  - If the wrapper is present and the alarm is armed, is `SIGALRM` simply not being delivered during this
    step's execution — e.g. because it spends its time in blocking native I/O (a blocking Supabase/HTTP socket
    call) that a Python-level signal can't interrupt? This is the same class of concern already flagged in
    `HCRIS-TIMEOUT-5` for `aux_cms_tables` ("`SIGALRM` can't interrupt a blocked native socket read") — confirm
    whether it applies here too, now with direct live evidence (37x the budget, zero timeout log lines) rather
    than as a hypothetical.
  - Is there any other place in this call chain that could reset, cancel, or re-arm the alarm mid-step (for
    example, a nested call that also uses `signal.alarm()` for its own purpose and clobbers the outer one)?

**(b) Reconcile the "Stopping Container at 7:34:18" Railway event against the Supabase timeline** (06:04:28 UTC
start, 15:24:49 UTC last write, run never closes its own tracker row). Is this something CC/the code can speak
to at all (e.g., does the app log anything at container shutdown that would explain the discrepancy), or is
this purely a Railway platform-side artifact outside the app's visibility — say so plainly either way.

**(c) Confirm (or correct) the read that the round-6 SELECT-prefetch batching is working.** The shift from
smooth per-property writes to ~60-per-10-minute batches late in the run is this session's own inference from
the data, not a claim from the code. If confirmed, this is something to build on, not redo — the fix for this
round should be scoped to the timeout-delivery problem in (a), not a re-batching of work already fixed.

**(d) Fix whatever (a) turns out to require**, with the same bar as every round in this arc: describe the
actual mechanism found, not a re-description of what was intended. If the fix is "wrap this step in the
timeout mechanism for the first time" or "replace the alarm-based timeout with something that can actually
interrupt blocking I/O" (e.g., a watchdog thread that checks elapsed wall-clock time between round trips,
since the step is already doing many discrete Supabase calls), say which approach was taken and why. Add
regression tests that would have caught the specific gap found in (a) — not just tests that a `TimeoutError`
gets re-raised once raised, which round 6 already covered and which live evidence now shows isn't the actual
gap. Be explicit about what live proof would look like for the next round, given this step's own multi-hour
runtime makes "trigger a run and wait" expensive — ideally something closer to a fast, targeted way to confirm
the alarm actually interrupts this step (e.g., a deliberately short timeout override tested against a real
Supabase call in a lower-stakes environment) rather than another full overnight run.

## Out of scope

- Re-litigating whether `HCRIS-TIMEOUT-6`'s code changes are deployed — they are, confirmed via Railway
  deploy-timing screenshot.
- Re-doing the SELECT-prefetch batching from round 6 unless (c) shows it isn't actually working.
- `HCRIS-QIP-DEFICIENCY-TIMEOUT-PATTERN`, `DEED1`/`DEED1-reconcile`/any Dialysis PR unrelated to this pipeline.
- No `life-command-center` code changes — entirely in `Dialysis`.
- No retention/deletion of any rows in any table.

## Verify on

- (a): a direct, evidenced answer for why the alarm/timeout never fires during this step — quoted from the
  actual deployed code, not a plausible-sounding theory presented as settled.
- (b): either a reconciliation of "7:34:18" against the Supabase timeline, or a plain statement that it can't
  be reconciled from the app side.
- (c): a direct confirmation or correction of the batching-is-working read.
- (d): the actual fix (if one is needed), tests, and an honest, cheaper proposal for how to prove it live next
  round.
