# CFE-RUNAWAY-cms-financial-estimates-repair — response (transcribed 2026-09-10)

> Recovered from Scott's own saved transcript (`CFE Runaway clinic financial estimates surface
> response.docx`, untracked, `docs/claude-code/responses/`) — the same recovery method used for
> `RAILWAY-PA-SECRET-log`. **Repo: `Dialysis`. This session verified this against the transcript only —
> `Dialysis` is not reachable from this session (no credentials), so nothing here is independently
> re-read against the actual diff.** See the STATUS entry for what WAS independently checked
> (Supabase-side traffic, post-report).

## Root cause (exact call site, as reported)

`src/financial_estimate_tracker.py:463-472`, `FinancialEstimateTracker._pk_column()` — called once
per `save_estimate()` (i.e., once per clinic, from the batch loop in
`propagation_utils.py:propagate_clinic_financial_estimates`). It called
`get_live_table_columns(TABLE_NAME, force_refresh=True)` **unconditionally**.
`force_refresh=True` bypasses `schema_introspection.py`'s own cache and, when direct-Postgres
introspection fails, falls through to `_fetch_table_columns_via_supabase()`
(`schema_introspection.py:744-761`) — **this is the exact two-unfiltered-probe pattern measured live**
(`select=*&limit=1`, `select=created_at&limit=1`).

**Fix as reported:** cache the resolved PK column name on the tracker instance; never pass
`force_refresh=True`. The tracker is a batch object (one instance per run), so the probe drops to at
most once per run instead of once per record.

## Adjacent defects — decided, not left open (as reported)

- **`properties.estimated_annual_revenue` propagation:** reported to have worked before — the column
  is real and actively read elsewhere. It was failing because `update_row()` never passed its live
  client into the schema-guard's cache-miss recovery check, which then hit a frequently-`None` module
  global and silently dropped the field. Fixed by threading the client through.
- **"Invalid propagation target" warning:** reported to have been logged unconditionally, even on
  full success — the code comment allegedly said "always logged per test expectations" (a test
  pinning the bug itself). Removed; the real invalid-target case keeps its own accurate early-return
  warning. Two tests corrected.
- **The five `facility_patient_counts` field drops:** decided per-field. Four
  (`payer_mix_assumptions`, `medicare_share_assumed`, `medicaid_share_assumed`,
  `commercial_share_assumed`) reported as intentional — model-methodology diagnostics that belong on
  `clinic_financial_estimates`, which already has dedicated columns for them. `revenue_medicaid`
  reported as a real schema gap (siblings `revenue_medicare`/`revenue_commercial` already have
  columns) — a migration was filed for review, **not applied**. A single helper reported to now
  exclude exactly these five at both write sites.

## Unit 5 (retention) — not executed, as instructed

Proposal only, per the prompt's explicit scope limit: keep N most recent history rows per
`(medicare_id, estimate_source)`, or a date cutoff — sizing needs a live query against Dialysis_DB the
CC sandbox couldn't run.

## B6d-cms-restart — reported as NOT the same mechanism

`tracker.save_estimate()` is reported already wrapped in try/except that logs and continues, so a
timeout here would not crash the run directly by itself. The session flagged it as likely having
worsened overall DB contention without asserting it as B6d-cms-restart's crash mechanism — **that
question stays open**, unconnected to this fix.

## Tests (as reported)

Full suite: **3,153 passed / 7 skipped / 1 xfailed / 0 failed** (`--ignore=tests/integration/`,
matching `Dialysis`'s own CI invocation per its `CLAUDE.md`). 8 new tests added pinning the fix
(including `test_cfe_runaway_pk_column_cache.py`, 187 lines); one stale test stub fixed after an
`update_row()` signature change. 10 files edited total (financial_estimate_tracker.py,
utils_shared.py, propagation_utils.py, two test files named, five more not itemized in the
transcript).

## Delivery

Branch `claude/cfe-runaway-financial-estimates-b913114d`, pushed to `origin`. **PR opened:
`sbriggssjc/Dialysis#7398`** — "CFE-RUNAWAY: stop the per-record full-table schema probe on
`clinic_financial_estimates`." The transcript ends at the PR-open step; merge status is not recorded
in it and this session cannot check `Dialysis` directly (private repo, no credentials, `WebFetch` on
the PR URL 404s). **Confirm merge status with Scott before treating this as deployed.**
