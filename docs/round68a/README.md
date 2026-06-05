# Round 68-A — dia listing-side data depth (verification gate)

Addresses Scott's notes D2/D5/D6/D7/D8/D9/D11.

> **STATE UPDATE (2026-06-05): EXECUTED.** The gate has been cleared and all
> three tasks are live in prod (Dialysis_DB `zqzrriwuavgrquhisnoa`) and
> committed. 1,207 synthetic rows + 207/212 LINK updates are live; the view
> include/exclude rules, the Task 3 pooled quartiles, and the go-forward capture
> code are all applied. A post-backfill audit also found and fixed a synthetic
> **price/cap leak** into the cap-quartile / market-size charts. **See
> [`R68A_FINAL_REPORT.md`](./R68A_FINAL_REPORT.md) for the authoritative applied
> state + per-chart before/after.** The plan-state notes below are retained for
> history.

> **Plan v2** (2026-06-04): Scott's v1 review split the synth set into a **LINK
> class** (link the real listing, don't double-count) + a reduced **SYNTH class**.
> See `R68A_SYNTHESIS_PLAN.md`.

## What was applied to prod (originally gate-enablement only, non-destructive)

- `20260605_cm_round68a_listing_provenance_columns.sql` — nullable `data_source`
  + `listing_date_source` on `available_listings` (no rewrite).
- `20260605_cm_round68a_synthesis_helper_views.sql` + `..._v2.sql` — read-only
  helper views `v_round68a_synth_candidates` (1,207), `v_round68a_link_candidates`
  (212), `v_round68a_dom_rule`. Verified: split reconciles (1,608 = 401 LINK +
  1,207 SYNTH), overlap 0, 2025 synth 76.
- `20260605_cm_round68a_dia_listing_date_correction_rpc.sql` — Task 1 receipt-
  gated re-date RPC.

## Held for the go (execution) — ALL EXECUTED 2026-06-05 (see R68A_FINAL_REPORT.md)

- `20260605_cm_round68a_synthetic_listing_views.sql` — chart include/exclude
  rules. Output-neutral until rows land (the active-listings rewrite was
  syntax/signature-validated in a rolled-back transaction). Apply alongside the
  bulk write.
- `scripts/round68a-link-listings.mjs --commit` — 212 LINK updates (real dates).
- `scripts/round68a-synthesize-listings.mjs --commit` — 1,207-row SYNTH insert.
  Both dry-run first, from the workstation (service key).
- Availability-checker redeploy (`parsers.ts` + `index.ts`) + sidebar
  Date-on-Market capture (`api/_handlers/sidebar-pipeline.js`) — go-forward Task 1.

## Documents

| file | what |
|---|---|
| [`R68A_SYNTHESIS_PLAN.md`](./R68A_SYNTHESIS_PLAN.md) | Task 2 — per-year counts, 2025 recovery, DOM medians, derivation classes, gap funnel, sample |
| [`round68a_synthesis_plan.json`](./round68a_synthesis_plan.json) | machine-readable plan (precomputed; script regenerates live) |
| [`R68A_RE_DATE_PLAN.md`](./R68A_RE_DATE_PLAN.md) | Task 1 — why no blind re-dates ship; the go-forward capture mechanism |
| [`R68A_VIEW_MATRIX.md`](./R68A_VIEW_MATRIX.md) | per-view include/exclude/guard/chart + the synthetic-in-zero-price-views assertion |

## Headlines

- **Task 1 hypothesis killed:** no evidence exists to move any listing into 2025
  (`created_at` NULL; zero `raw_text` DOM markers; OM-intake is 2026-only). The
  organic capture channel simply collapsed in 2025. Re-dating is re-scoped to a
  receipt-based, go-forward capture fix — no row re-dates without a page receipt.
- **Task 2 carries the 2025 recovery:** 1,608 price-less synthetic listings from
  unlinked sold deals lift 2025 added-to-market from 20 → 99 and erase the
  pre-2016 active-universe cliff. Synthetic rows are excluded from every
  price/DOM/cap chart.
- **Task 3 (decided):** rolling-3-month pooling on the **10+ series only**; the
  all-cohort series stays single-month gated (it has the n, and pooling would
  smooth the headline away from the master's behavior). Label the 10+ series
  "3-mo pooled" in the chart note. Runs post-backfill (needs the rows present);
  ship the before/after coverage table; genuine gaps documented, not fabricated.
