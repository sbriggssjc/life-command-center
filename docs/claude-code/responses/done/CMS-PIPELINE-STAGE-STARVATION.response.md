# CMS-PIPELINE-STAGE-STARVATION — response

**Prompt:** `docs/claude-code/prompts/done/CMS-PIPELINE-STAGE-STARVATION-fpc-inactive-and-downstream-tables-stale.md`
**Original transcript:** `docs/claude-code/responses/done/CMS PIPELINE STAGE STARVATION desktop response.docx`
**Filed:** 2026-09-24 (Cowork, during a full CMS-ingestion table-health sweep requested by Scott)
**Answered:** 2026-09-24 (CC / desktop Claude Code)
**Reconciled into STATUS.md / PLANNED-BACKLOG.md:** 2026-09-24 (Cowork)

## Summary of CC's findings

Two separate, error-free-but-broken problems, neither the one the prompt assumed:

**Problem 1 — `facility_patient_counts` doesn't run because `ingestion_tracker.start_run()`'s own INSERT returns `None`.**
The shared Supabase client's `Prefer: return=minimal` header overrides the insert's own `return=representation`
request (the same defect family already found on `ratings`' UPDATE — round 2 — and `clinic_quality_metrics`'
upsert — round 3 — this time on an INSERT). No caller ever gets the new tracker row's id back, so the ingestion
lock reads as "another run is active" and `facility_patient_counts` skips itself every day; the daily
`run_status='started'` row is an orphaned lock, not work. `medicare_ingestion` has the same problem since
~2026-09-12. Onset: 2026-08-31. **This is the same root cause `RATINGS-CQM-CB3-tracker-close` was filed under a
"hard kill" theory — that theory was wrong, corrected in place.** Fixed via a new `src/postgrest_prefer.py`
helper, applied to `start_run()` only.

**Problem 2 — the real starvation cause is `backfill_financials`, not `properties` decelerating.** CC found the
`properties` write rate was flat the whole time; the "deceleration" this session tracked and reported across many
hours on 2026-09-23 was an artifact of the metric (distinct properties touched levels off because each property
is rewritten ~20x per clinic across patient-count snapshots). The real long pole: `backfill_financials`
unconditionally rewrites all 189,851 `facility_patient_counts` rows every run (~9h at ~21k rows/hr, only 67 of
the first 112k actually changed), and its per-row `except Exception` swallows the step's own timeout alarm, so
the 90-minute whole-run cap trips at the next step boundary and starves everything scheduled after it. Fixed:
compare-before-write, honor `force_recalculate`, let `StepTimeout` propagate.

**Also fixed:** four more bare `.upsert(on_conflict=...)` calls with the same CB3 plain-INSERT shape —
`qip_scores`, `facility_deficiencies`, `facility_cost_reports`, `facility_economics`.

**Found, not fixed:** `facility_cost_reports`'s freeze is not explained by starvation — its own step never
reaches the upsert; cause is inside the step (probably the CMS download), visible only in Railway logs.
`facility_payer_mix` is dead code in practice (CMS source file has no usable payer-mix columns). `medicare_ingestion`
skipping since ~2026-09-12 (same lock defect, filed separately).

**Proposal, not built:** give `qip_scores`/`facility_deficiencies`/HCRIS their own Railway cron so a slow main
run can't starve them.

**Tests:** 14 new, full suite 3,377 passed / 2 pre-existing failures (also fail on unmodified `main`).

**Delivery:** branch `claude/great-hawking-8yu0q2`, PR `sbriggssjc/Dialysis#7427`. CC's own transcript is
internally inconsistent about whether a PR existed at time of writing; Scott reports #7427 merged — not
independently confirmed from this session (no direct read access to the `Dialysis` repo here).

## Independent verification (Cowork, live Supabase, 2026-09-24)

Checked before reconciling documentation, per standing discipline of never accepting "merged"/"fixed" at face
value:

- The `ingestion_tracker` run open at check time (`318baf19…` `facility_patient_counts` / `35bb3368…`
  `cms_medicare_clinics`, both started 06:02:53-06:02:59 UTC 2026-09-24) was still active 7h24m+ in — it started
  before any merge of #7427 could take effect, so it is running the pre-fix code.
- `facility_patient_counts` last write: 2026-08-31 (unchanged). `qip_scores`/`facility_deficiencies`: 2026-05-16
  (unchanged). `facility_cost_reports`: 2026-03-16 (unchanged).
- `clinic_financial_estimates` was still being actively written minutes before this check (3,906,688 rows as of
  the check) — consistent with `backfill_financials` still running the old unconditional-rewrite code.
- **Conclusion: no live proof yet that PR #7427's fixes hold.** The next full run after a genuine merge is the
  real test. Watch for: the patient-counts lock row closing `success`; `backfill_financials` finishing in minutes
  rather than ~9 hours; `qip_scores`/`facility_deficiencies` getting new `created_at` values.

## Documentation updates made this round

- `PLANNED-BACKLOG.md` — `CMS-PIPELINE-STAGE-STARVATION` row: 🔴 → 🟡, full answer appended.
- `PLANNED-BACKLOG.md` — `RATINGS-CQM-CB3-tracker-close` row: 🔴 → 🟡, "hard kill" theory explicitly corrected to
  the real (same-header-defect) cause, fix cross-referenced to PR #7427.
- `STATUS.md` — CoStar/PRI open-threads row: new 👤 2026-09-24 sentence appended.
- `STATUS.md` — new dated section added (2026-09-24, CMS-PIPELINE-STAGE-STARVATION answered), including an
  explicit, non-silent correction of this session's own prior "properties deceleration" reporting from
  2026-09-23.

## Corrections to this session's own prior documentation (explicit, not silent)

1. **"`properties`' write pace is decelerating" (tracked live across many hours on 2026-09-23, written into
   STATUS.md/PLANNED-BACKLOG.md) was wrong.** CC found the write rate was flat; the apparent deceleration was an
   artifact of counting distinct properties touched rather than raw writes.
2. **`RATINGS-CQM-CB3-tracker-close`'s "hard kill or something else, unconfirmed" framing was wrong.** The real
   cause is the same `Prefer: return=minimal` header-override defect already seen on `ratings`/`clinic_quality_metrics`,
   this time on `ingestion_tracker.start_run()`'s own INSERT.

## Still open / not yet prompted

- Live proof of PR #7427 (both problems, and the four bare-upsert fixes).
- `medicare_ingestion`'s skip since ~2026-09-12 — filed by CC, not yet its own backlog row or prompt.
- `facility_cost_reports`'s own-step freeze (not starvation) — not investigated.
- The "separate Railway cron per downstream stage" proposal — not built.
- `RATINGS-CQM-CB3-upsert-class` (133 other `.upsert()` call sites repo-wide, filed round 3) — still not addressed
  as a class; this round only fixed four of them by name.
