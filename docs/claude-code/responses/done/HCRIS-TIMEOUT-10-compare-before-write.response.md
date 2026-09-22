# HCRIS-TIMEOUT-10 — compare-before-write on both write paths — response (transcribed 2026-09-22)

> Recovered from Scott's own saved transcript (`"HCRIS TIMEOUT 10 surface response.docx"`, untracked,
> `docs/claude-code/responses/`). **Repo: `Dialysis`/`DialysisProject`.**

## What CC reports

**Root cause targeted directly**: neither of `HCRIS-TIMEOUT`'s own two write paths had compare-before-write logic,
per round 47's code trace. Fixed both:

1. **`src/utils_shared.py::update_row()`** — now fetches the existing row and skips the PATCH entirely for
   `properties`/`facility_patient_counts`/`clinic_financial_estimates` (the three tables named
   `COMPARE_BEFORE_WRITE_TABLES`) when nothing in the payload differs, reusing `DIA-PROPAGATOR1`'s own
   `compare_before_write.diff_changed_fields`/tolerance logic. `leases`/`sales_transactions`/`contacts` untouched —
   already had their own domain-specific handling.
2. **`src/propagate_property_financials.py::propagate_financials_to_properties()`** — extended the existing
   batch-fetch to also pull every column this writer ever sets, diffs each computed update against the current row
   inside the write loop (no extra round trip), and skips the `.update()` call — not counted toward
   `properties_updated` — when nothing changed. `financial_data_updated_at` is explicitly excluded from the
   comparison (a timestamp, not data) and only stamped when a real field changes. New `properties_unchanged` stat.

**Tests**: `tests/test_hcris_timeout_10_compare_before_write.py` (new, 5 tests, proves both no-op skips cheaply
against fake Supabase clients). 109 tests scoped to this change (HCRIS-TIMEOUT/propagator/compare-before-write)
pass together. Full suite: 3,349 passed / 2 failed / 9 skipped / 1 xfailed — both failures independently confirmed
pre-existing and unrelated (reproduced with this change stashed; an order-dependent stub-pollution pattern this
repo's own `CLAUDE.md` already documents, e.g. `B6e-ci-openpyxl`; neither touches `properties`,
`facility_patient_counts`, `clinic_financial_estimates`, `update_row`, or `propagate_property_financials`).

**Delivery**: `sbriggssjc/Dialysis` branch `claude/vigilant-hopper-nvztan`, commit `7da0c72`, **PR
`sbriggssjc/Dialysis#7423`**. CC subscribed to the PR via its own GitHub-connected tooling, watched CI run and the
PR merge, then unsubscribed — a materially stronger merge confirmation than every prior round's "Scott reports
merged," since it's confirmed by CC's own direct observation of GitHub state rather than relayed secondhand.

## Independent verification performed by this session

- **This is the first round targeting the actual root cause** (round 47's compare-before-write finding) rather than
  another timeout/exception-handling patch — a genuine change in kind from rounds 6-9.
- **Merge independently plausible-checked**: no direct GitHub access from this session, but CC's own
  subscribe/watch/unsubscribe sequence against the PR is a materially better signal than prior rounds had.
- **Live proof checked directly and found genuinely not yet available — not assumed either way.** Queried
  `ingestion_tracker` for runs in progress: two rows (`1286da68…`, `5e5b1ffb…`) are still open, both started
  06:04-06:05 UTC today (2026-09-22) — **well before this PR's merge (~13:54 UTC the same day)**. Neither run can
  reflect the fix. `facility_cost_reports` remains frozen at `2026-03-16` (94,473 rows), exactly as expected since
  no post-merge run has occurred yet. **The real test is the next run that starts after today's merge** — the next
  scheduled ~06:00 UTC run tomorrow, or one Scott triggers manually to test sooner, the pattern rounds 7 and 8 both
  used for a faster read.

## Delivery

Code changes in `Dialysis`/`DialysisProject`. **PR `sbriggssjc/Dialysis#7423`
(`claude/vigilant-hopper-nvztan`, commit `7da0c72`) — merged, confirmed by CC's own tooling.** `HCRIS-TIMEOUT`
**stays 🔴** until a post-merge run shows a small `properties_updated`/`properties_unchanged` split and finishes
inside the 2-hour reclaim window — four prior rounds (6, 7, 8, and round 9's DIA-PROPAGATOR1 tangent) all looked
this solid on delivery and all failed their live test, so this one is held to the same bar rather than treated as
resolved on the strength of the code and tests alone.
