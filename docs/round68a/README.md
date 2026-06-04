# Round 68-A — dia listing-side data depth (verification gate)

Addresses Scott's notes D2/D5/D6/D7/D8/D9/D11. **Gate state: plan artifacts +
code pushed; nothing that changes chart output or writes rows has been applied.**

## What's applied to prod (gate-enablement only, non-destructive)

- `20260605_cm_round68a_listing_provenance_columns.sql` — adds nullable
  `data_source` + `listing_date_source` to `available_listings` (no rewrite).
- `20260605_cm_round68a_synthesis_helper_views.sql` — read-only helper views
  `v_round68a_synth_candidates` / `v_round68a_dom_rule` so the plan is verifiable
  with one SELECT. Verified: 1,608 candidates (1,319 year_median / 289 pooled),
  79 land in 2025.

## Held for the go (post-verification execution)

- `20260605_cm_round68a_synthetic_listing_views.sql` — chart include/exclude
  rules. Authored output-neutral (a no-op until synthetic rows land); the
  active-listings rewrite was syntax/signature-validated in a rolled-back
  transaction. **Apply after the matrix is verified.**
- `20260605_cm_round68a_dia_listing_date_correction_rpc.sql` — Task 1 receipt-
  gated re-date RPC.
- `scripts/round68a-synthesize-listings.mjs --commit` — the ~1,608-row bulk
  insert (workstation, service key). Dry-run first.
- Availability-checker redeploy (`parsers.ts` + `index.ts`) and the sidebar
  Date-on-Market capture (`api/_handlers/sidebar-pipeline.js`) — go-forward
  Task 1 capture.

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
- **Task 3:** re-test the 10+ gated views after Tasks 1+2 land; widen to
  rolling-3-month pooling only where a period has real deals but fails the gate;
  ship the before/after coverage table. (Runs post-backfill — gaps that remain
  genuine will be documented, not fabricated.)
