# CMS-PIPELINE-STAGE-STARVATION-2 — response

**Prompt:** `docs/claude-code/prompts/done/CMS-PIPELINE-STAGE-STARVATION-2-post-fix-live-run-gaps.md`
**Original transcript:** `docs/claude-code/responses/done/CMS PIPELINE STAGE STARVATION 2 surface response.docx`
**Filed:** 2026-09-24 (Cowork, from the first live test of PR #7427)
**Answered:** 2026-09-24 (CC / desktop Claude Code)
**Reconciled into STATUS.md / PLANNED-BACKLOG.md:** 2026-09-24 (Cowork)

## Summary of CC's findings

**Diagnostic note, fixed first**: every error from the 13:55 run — including `bd_flags`/`recorded_owners`, which
looked unrelated to this pipeline — was filed under the `facility_patient_counts` lock row's id, not the real
originating step. Cause: `start_run()` points the process-wide error log at whatever row it just opened and clears
it, so a nested lock (the medicare self-lock, see Gap 3) hijacked error recording for the rest of the run. Fixed.

**Gap 1 (patient counts) — not a bug in the way this session read it.** The "994 queued / 2 promoted" counts were
misread by Cowork as `facility_patient_counts`'s own staging queue; they're actually `staged_intake_items`, an
unrelated email/document-intake queue. The real open question — why `patient_counts` derived 0 rows in 2.5 minutes
— can't be settled from Supabase alone (no CMS egress from CC's sandbox); the step now records its own outcome to
its lock row so the next run answers it.

**Gap 2 (financial estimates) — zero writes was correct.** CC ran the repo's own financial calculation against
1,500 live rows: all matched, because the prior run had just finished rewriting everything at 13:06.
Compare-before-write worked as designed. Side finding, not fixed: 5 columns outside the writer's schema
(payer-mix/revenue-share fields) never get written; fixing that means a ~190k-row rewrite.

**Gap 3 (medicare_ingestion) — real bug, fixed, corrects this session's own round-1 framing.** The pipeline opens
its own `cms_medicare_clinics` tracker row; the medicare step then requests a lock on that same dataset, finds its
own parent's row, and reads it as "another run active" — a self-lock scoping bug, not the `start_run()` missing-id
defect this session's round-1 write-up called it. PR #7427 couldn't have fixed this (the parent row's insert always
succeeded, only its id was lost). Fixed: the lock now ignores rows opened by its own process; a lock-denied skip
now fails the step instead of counting as "ok."

**Gap 4 (`run_status='partial'`) — correct, not a bug.** Five steps genuinely failed: `hcris_propagation`
(dataclass missing a field — fixed), `property_financials` (selected a nonexistent column — fixed), both dating to
PR #7370 (2026-08-13) and only now surfacing because this is the first run to reach them. Three left open:
`hcris_cost_reports` gets a **404 on CMS's `RENAL_COST_REPORT.zip`** — possibly the real answer to the ten-round-old
`HCRIS-TIMEOUT` mystery; `cms_deficiencies` hit its own 900-second limit after writing 25,837 rows (matches the
`facility_deficiencies` +25,837 this session independently measured last round); `census_demographics` got a
non-JSON response.

**Gap 5 (tracker `notes`) — not cross-contamination, a real design flaw, fixed.** `finish_run()` stamped a global
intake-queue count onto whichever row it closed and wiped the step heartbeat at close. Fixed: scoped to the
pipeline's own row under a clearer key, heartbeat preserved.

**Also fixed**: `investment_targets` (same CB3-class fix as six other tables). **Also found, not fixed**:
`recorded_owners`'s `ownership_linker` never links a newly-created owner because it reads the new row's id from an
insert response that comes back empty under `return=minimal` — an eighth CB3-class instance. `bd_flags` confirmed
part of this pipeline (a `23502` null-constraint via `create_bd_flag`/`cmbs_propagation`), logged not fixed.

**Tests**: 28 targeted, full suite 3,389 passed / 2 pre-existing unrelated failures. **Delivery**: branch
`claude/modest-feynman-f61w5h`, PR `sbriggssjc/Dialysis#7428` — Scott reports merged.

## Independent verification (Cowork, live Supabase, 2026-09-24)

- No `ingestion_tracker` row has started since the 13:55-15:08 UTC run finished — **no live run has tested PR #7428
  yet**; next scheduled run is 06:00 UTC 2026-09-25.
- Independently confirmed the "two consecutive clean daily runs" claim implied by CC's own prompt context: queried
  `ingestion_run_errors` by day. `ratings` had zero errors on both 2026-09-23 and 2026-09-24 — genuinely meets the
  bar, closed to ✅ in `PLANNED-BACKLOG.md`. `clinic_quality_metrics` had 955 errors on 2026-09-23 (pre-fix) and
  zero on 2026-09-24 — one clean day of the two required, stays 🟡.

## Documentation updates made this round

- `PLANNED-BACKLOG.md` — `CMS-PIPELINE-STAGE-STARVATION`: 🟡 → 🟢, round-2 answer appended with explicit
  corrections to this session's own round-1 framing (Gap 1's queue misread, Gap 3's "same root cause" claim).
- `PLANNED-BACKLOG.md` — `HCRIS-TIMEOUT`: 🔴 → 🟡 after ten rounds, cross-referenced to the newly-found 404.
- `PLANNED-BACKLOG.md` — `RATINGS-CQM-CIRCUIT-BREAKER`: `ratings` closed to ✅ (independently verified 2
  consecutive clean days); `clinic_quality_metrics` stays 🟡 (1 of 2).
- `PLANNED-BACKLOG.md` — `RATINGS-CQM-CB3-upsert-class`: 🔴 → 🟡, two new confirmed instances logged (8 of ~133
  total call sites now hit by name).
- `STATUS.md` — CoStar/PRI open-threads row: round-2 sentence appended.
- `STATUS.md` — new dated section (2026-09-24, round 2 answered).
- **Cleanup**: the CoStar/PRI open-threads table cell had grown to 12,541 characters against its own "one-line
  read" convention. Archived the `HCRIS-TIMEOUT` rounds 1-10 narrative (2026-09-16 to 09-22) verbatim to
  `docs/history/STATUS_open-threads_PR5-PRI-row_to_2026-09-22.md`, same precedent already used for the SBN row.
  Nothing dropped or reworded; the still-active narrative stays in the table.

## Corrections to this session's own prior documentation (explicit, not silent)

1. **Gap 1's "staged-intake queue" was misidentified.** Round 1 wrote that `facility_patient_counts` had its own
   staging queue at 994 queued/2 promoted; it's actually an unrelated email/document-intake queue.
2. **`medicare_ingestion`'s blocker is not "the same root cause" as `RATINGS-CQM-CB3-tracker-close`.** Round 1
   documented it that way; it's a separate self-lock scoping bug, not the `start_run()` missing-id defect.

## Still open / not yet prompted

- Live proof of PR #7428 (next scheduled run, 06:00 UTC 2026-09-25).
- `hcris_cost_reports`'s 404 on `RENAL_COST_REPORT.zip` — needs its own round to confirm/fix the CMS source URL.
- `cms_deficiencies`'s 900s step-timeout hit after 25,837 rows.
- `census_demographics`'s non-JSON response.
- `recorded_owners`'s CB3-class linking bug.
- `bd_flags`'s `23502` null-constraint on `entity_type`.
- `RATINGS-CQM-CB3-upsert-class`'s full census/class-wide sweep (still declined each round in favor of fixing
  instances as they're hit).
- `clinic_quality_metrics`'s second clean day.
