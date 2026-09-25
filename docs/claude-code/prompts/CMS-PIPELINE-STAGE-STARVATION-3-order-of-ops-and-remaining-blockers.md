# CMS-PIPELINE-STAGE-STARVATION-3 — is the ratings/CQM/qip/deficiencies staleness benign, and let's finally clear the three known blockers

**Repo root: `Dialysis` / `DialysisProject`.**

## Context

PR #7428 (branch `claude/modest-feynman-f61w5h`) is deployed. Two more runs have happened since: Scott's manual
trigger (started 2026-09-24 18:30 UTC, closed 20:57 UTC) and the scheduled 2026-09-25 06:05 UTC run (closed 07:53
UTC). Both are genuinely good news on the fixes round 2 shipped:

- `medicare_ingestion`'s self-lock fix holds across both runs — it now opens its own nested tracker row and
  actually runs (1h44m41s on the 09-25 run) instead of reading its own parent's row as a competing lock.
  `medicare_clinics.source_last_seen` moved on both runs.
- `facility_patient_counts`'s new self-reporting instrumentation works exactly as designed both times:
  `patient_counts_outcome: "processed_no_writes (all unchanged / no new CMS period)"`.
- Zero errors logged in `ingestion_run_errors` in either run.

But two things need real answers, not assumptions.

**Question 1 — is the ratings/CQM/qip/deficiencies staleness benign or a new starvation shift?** `ratings`,
`clinic_quality_metrics`, `qip_scores`, and `facility_deficiencies` have not been touched by either of these two
runs — no writes since the 09-24 13:55-15:08 UTC run. Two competing theories, and Cowork can't tell which from
Supabase data alone:

1. CMS genuinely hasn't published a new snapshot since 09-24, so every step correctly finds nothing new (consistent
   with `facility_patient_counts`'s own no-op result holding both times).
2. Now that `medicare_ingestion` actually runs for real (1h45m, not an instant skip), it's consuming enough of the
   run's step budget to prevent these steps from being reached — the exact shape `backfill_financials` had in round
   1, just relocated now that the previously-broken step works.

Read the pipeline's actual step order and whatever gates each step (freshness watermark vs. time budget vs.
something else) and give a real answer with evidence — which theory is it, or is it something else entirely. Don't
guess from the write-rate pattern alone; that's exactly the mistake this arc has made twice already.

**Question 2 — clear the three known blockers, or explain precisely why not.** Round 2 left three items open and
explicitly unfixed:

- `hcris_cost_reports` gets a 404 fetching CMS's `RENAL_COST_REPORT.zip`. Confirm whether the URL moved (find the
  correct one if so) or whether it's a transient/access issue. This table is the *original* target of the
  `HCRIS-TIMEOUT` arc — ten-plus rounds of exception-handling work have been waiting on this table getting any data
  at all.
- `cms_deficiencies` hit its own 900-second step limit after writing 25,837 rows on the run that first reached it.
  Either raise the budget, batch it so it can resume across runs, or explain why 900s is structurally too short for
  this dataset's real size.
- `census_demographics` got a non-JSON response. Confirm what CMS is actually returning (an HTML error page? a
  redirect? rate limiting?) and fix the fetch or the parsing accordingly.

**Also, lower priority — two things flagged last round but never explained:**

- **Unfamiliar tracker states.** A `run_status='recorded'` row (`8f615de8…`, started 2026-09-25 06:25:16 UTC) has
  sat open with `finished_at=null` for 5+ hours as of this write-up, and a `run_status='watermark'` row closed
  instantly at the same timestamp. Neither state has appeared anywhere else in this saga. If these are new
  instrumentation from round 2's fix, document what they mean and confirm the open `recorded` row isn't itself
  stuck; if they're a leftover bug, say so.
- **`recorded_owners`/`bd_flags`**, logged as CB3-class/schema issues in round 2 and not fixed. Fix if quick;
  otherwise leave filed.

## Explicitly not in scope for this round

Don't re-touch `medicare_ingestion`'s self-lock fix, `investment_targets`, or the two PR #7370 schema mismatches —
all confirmed working live across two runs. Don't take on the full `RATINGS-CQM-CB3-upsert-class` census unless it
turns out to be directly relevant to one of the two questions above.

## What "done" looks like

- Question 1 has a concrete, code-and-evidence-based answer, not a guess.
- At least the `hcris_cost_reports` 404 is understood well enough to know whether it's fixable this round or needs
  an external action (e.g., waiting on CMS, or someone confirming the new URL by hand).
- `cms_deficiencies` and `census_demographics` each have either a real fix or a clear, specific explanation of what
  blocks fixing them now.
- The `recorded`/`watermark` tracker states are explained.

## Verify on

- The next run after any fix: does `ratings`/`clinic_quality_metrics`/`qip_scores`/`facility_deficiencies` actually
  move (if Question 1's answer says they should), and does `hcris_cost_reports`/`cms_deficiencies`/
  `census_demographics` finally get real writes.
- Whether the `recorded` tracker row from 06:25:16 UTC 09-25 ever closes on its own, or needs a manual reclaim.
