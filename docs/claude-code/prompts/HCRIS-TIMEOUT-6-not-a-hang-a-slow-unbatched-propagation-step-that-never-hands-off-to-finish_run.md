# HCRIS-TIMEOUT-6 — not a hang: a real, slow, likely-unbatched propagation step that gets nearly to the end and then never hands off to `finish_run()`

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc. Sixth round. `HCRIS-TIMEOUT-5` (PR #7413, commit `226f7e3`) fixed two real
structural bugs — `start_run()`'s discarded run id, and `aux_cms_tables`'s swallowed `StepTimeout` — and a
fresh post-fix run was triggered and live-monitored end-to-end from this side. **The live-monitoring itself
went through a wrong turn worth stating up front: the first read of this run was "genuine hang, likely killed
by Railway before it could close its own tracker row." That was wrong, and corrected same-day once the full
`properties.updated_at` time series (not just two point-in-time snapshots) was checked.** The run was not
hung. Full evidence below.

## 0. What's now independently confirmed live, going into this round

- Scott triggered a fresh run 2026-09-16 14:39:20 UTC (`ingestion_tracker` row `d45f27ff-dfef-459b-afd0-4d7ee9f91e19`,
  `dataset_id='cms_medicare_clinics'`, `source='cms_ingestion'`). The two pre-fix stuck runs were cleanly
  reclaimed at that same moment — one small confirming sign the `HCRIS-TIMEOUT-5` reclaim path works.
- The run shows the same 15-minute `ratings`/`clinic_quality_metrics` circuit-breaker error burst
  (14:39:32–14:54:55 UTC, ~8,900 errors) every prior round has shown — **but this time, unlike every prior
  round, that's followed by real sustained work, not silence.**
- **`properties.updated_at`, checked minute-by-minute across the full run window** (not the two isolated
  snapshots that produced an earlier wrong reading): continuous writes from 14:55:00 UTC through 18:57:00 UTC,
  ramping from ~5–10/minute early on to 60–100/minute by the end, **6,879 distinct properties touched**,
  stopping within a minute of Railway's own reported end time for this execution.
- Scott independently confirmed via the Railway dashboard (Cron Runs tab for the `cms-ingestion` service) that
  this exact execution (merge of PR #7413, started 09:38 local) ran **4h18m**, matching the DB timeline almost
  exactly (14:39:20 UTC start + 4h18m ≈ 18:57 UTC end).
- Scott's uploaded log tail (18:56:46–18:57:11 UTC, the last ~25 seconds before the run ended) confirms what
  the writes are: `src.propagation_utils` logging `"Propagating to properties: {'estimated_annual_revenue': ...}"`,
  interleaved with `"Skipping field '...' - not in Supabase schema for 'facility_patient_counts'"` warnings —
  this is the `facility_patient_counts` dataset's revenue-propagation step, actively running, not stuck.
- **Despite 4+ hours of real, visible progress, the run never reached its own finish line**: `facility_cost_reports`
  is still frozen at `2026-03-16` (94,473 rows, unchanged); `ingestion_tracker.notes` is still `'{}'` on both
  `d45f27ff…` (the top-level `cms_ingestion` tracker) and `ec39768b-47a3-4868-8536-75da0677c1fe` (the
  `facility_patient_counts` ingestion-lock row, opened the same minute); **neither row ever got `finished_at`
  set**; zero rows in `ingestion_run_errors` of any kind since `14:54:55` — no exception, no crash, nothing
  logged as a failure. The process appears to have simply stopped.
- Do the arithmetic on the propagation rate: 6,879 properties over roughly 4 hours is **~2 seconds per
  property** — far slower than a bulk/batched Supabase write would take, and the same shape (one row, one or
  more sequential round trips, repeat) already root-caused and fixed once before in this exact codebase for
  `hcris_propagation`'s old `save_estimate()` path (replaced with `save_estimates_batch()` in a prior round).
  Worth checking whether `facility_patient_counts`'s propagation path shares that same unbatched pattern, or a
  different one with the same symptom.

## 1. What this round needs to answer

**(a) Is the `facility_patient_counts`→`properties` propagation step genuinely unbatched, and can it be fixed
the same way `hcris_propagation` already was?** Find the actual code path this log line comes from
(`src.propagation_utils`, called from wherever `facility_patient_counts`'s ingestor lives) and confirm whether
it's doing N sequential single-row Supabase calls, or something else that would explain ~2 seconds/property at
this scale. If it's the same unbatched anti-pattern, the existing `save_estimates_batch()` precedent from the
`hcris_propagation` fix may be directly reusable.

**(b) What actually stops execution right after this step's last write, and why does it never reach
`finish_run()`?** The process didn't crash (nothing in `ingestion_run_errors`), didn't get reclaimed as
abandoned (still `run_status='started'`), and didn't log a timeout message the way `aux_cms_tables` used to.
Candidates worth checking directly against the deployed code, not assumed:
  - Does `run_cms_ingestion`'s overall step sequence place `hcris_cost_reports` **after** the
    `facility_patient_counts`/propagation step? If so, does whatever comes between them throw an unhandled
    exception that's swallowed somewhere without a log line (the same class of bug `HCRIS-TIMEOUT-4` found in
    `aux_cms_tables`, possibly recurring in a different step)?
  - Is there a Railway-side execution/timeout limit on this cron job (separate from the app's own
    `run_timeout`/`CMS_STEP_TIMEOUT_SEC` budgets) that could SIGKILL the container right at this point,
    with no chance for the app to log anything or call `finish_run()`? If this is plausible, say so plainly as
    an app-side-unfixable constraint rather than continuing to look for a code bug that isn't there.
  - Does the overall `run_timeout` budget (previously documented as a 5400s/90-minute check performed *between*
    steps) even apply here — since this single step alone ran ~4h18m (15,480s), if `run_timeout` is checked at
    step boundaries only, it would never interrupt a step already in progress. Confirm this understanding is
    still accurate for the current code, and if so, whether it's finally the reason nothing else in the
    pipeline (including `hcris_cost_reports`) has run in any of the rounds this arc has monitored.

**(c) Now that the pipeline has gotten meaningfully further than any prior round (past `aux_cms_tables`
entirely, unlike every pre-`HCRIS-TIMEOUT-5` run), does that on its own confirm this run carried the
`HCRIS-TIMEOUT-5` fix?** State this plainly either way — it's a reasonable inference but hasn't been directly
confirmed against a deploy timestamp from this session.

**(d) Fix whatever (a)/(b) turn out to require**, with the same bar as every prior round in this arc: describe
the actual mechanism found, not a re-description of what was intended; add regression tests that would have
caught it; and be explicit about what live proof would look like for the *next* round, given a single step
taking 4+ hours makes "trigger a run and wait" an expensive way to verify anything.

## Out of scope

- Re-litigating whether `HCRIS-TIMEOUT-5`'s two bugs are actually fixed — they're fixed and confirmed merged;
  this round is about what's next in the pipeline, not re-verifying that fix.
- `HCRIS-QIP-DEFICIENCY-TIMEOUT-PATTERN`, `DEED1`/`DEED1-reconcile`/any Dialysis PR unrelated to this pipeline.
- No `life-command-center` code changes — entirely in `Dialysis`.
- No retention/deletion of any rows in any table.

## Verify on

- (a): a direct answer, quoted from the actual deployed code, on whether the propagation step is unbatched —
  and if so, a description of the fix mirroring the `hcris_propagation` precedent, or an explanation of why
  that precedent doesn't apply.
- (b): a direct, evidenced answer for why the run stops without reaching `finish_run()` — not another
  plausible-sounding theory presented as settled.
- (c): a plain statement on whether this run's depth of progress confirms the fix was live.
- (d): the actual fix (if one is needed), tests, and an honest statement of what live proof will require given
  the step's own multi-hour runtime.
