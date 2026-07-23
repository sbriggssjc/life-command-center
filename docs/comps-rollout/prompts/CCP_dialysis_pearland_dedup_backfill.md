# Claude Code Prompt — Dialysis Data Cleanup: Pearland Reconciliation, Listings Dedup, Completeness Backfill

## Objective
Fix the source-data problems the comps export just surfaced, so the dialysis DB stores accurate rent/cap
and complete comp attributes for future pulls. Three parts: (1) the Pearland outlier + the listings-dedup
problem behind it, (2) a broader listings-dedup audit, (3) chairs/patients/bumps/options completeness.

## Part 1 — Pearland (property 35837, "11600 Broadway St", dia sale_id 7980) — worked example
Measured live:
- `sales_transactions` 7980: `sold_price = 4,776,704`, `cap_rate_final = 0.07` (source_reported),
  `rent_at_sale = 307,588`, sale_date 2026-03-06.
- `properties.anchor_rent = 254,205` (master), lease-view `annual_rent = 210,087`.
- **Three disagreeing rents** (210k / 254k / 307k) and none ÷ price = 7% (7% needs NOI ≈ 334k).
- `available_listings` for property 35837 has **~11 rows** — duplicates + superseded records, two
  distinct prices ($3,632,000 and $4,776,704), some dated 2015, one `synthetic_from_sale`. The comps RPC's
  lateral surfaced a $3.63M-ask listing against the $4.78M sale → a bogus "$1.1M over ask."

Do:
1. Determine the correct in-place NOI/rent at sale for 35837 and the true going-in cap. Reconcile the
   210k/254k/307k figures (which is the real contractual base rent? is 307k a grossed/NNN-reimbursed
   figure? is the 7% a marketing cap vs the real ~5.3-6.4%?). Use the master workbook + OM/deed if present.
   Store the reconciled rent + cap with correct provenance; supersede the wrong ones (don't just delete).
2. Fix 35837's listings: keep the one true marketing listing that corresponds to sale 7980 (correct ask +
   dates), mark the rest superseded/duplicate. Confirm the RPC then surfaces a sane ask (no false
   "over ask") and a reconciled cap.

## Part 2 — Listings dedup audit (broader)
Property 35837 having 11 listing rows suggests a systemic dedup gap. Report how many dialysis properties
have >1 active/non-superseded listing, and how many sold comps currently surface an ask that implies a
`price_over_ask`/`under_ask` >10% (the same signal the reconciliation layer uses). Propose + apply an
idempotent dedup/supersede pass (FK-aware, keep the best-provenance listing per property+transaction),
consistent with the existing `dia_auto_consolidate_listings` cron — extend it if it's not catching these.

## Part 3 — Completeness backfill (surfaced in the DaVita TTM export)
Genuine gaps on specific properties (not pipeline bugs):
- **chairs**: missing on Terre Haute (dia_db:9031, property 23423).
- **patients**: missing on Coos Bay (8121), Waterbury (14386), Birmingham (14238), Terre Haute (9031).
- **bumps / renewal options**: missing on Jeffersonville (8362, prop 36370) and Pearland (7980, 35837).
Backfill `total_chairs`, `latest_patient_count`/`ttm_total_treatments`, and lease `bumps`/renewal options
for these from the master workbook / OMs / existing enrichment, fill-NULL-only (never overwrite a verified
value). Then report residual NULL counts for chairs/patients/bumps/options across the live dialysis sold
universe so we know the true completeness rate, not just these 8.

## Verify / report
- Re-pull the DaVita TTM sold set; confirm Pearland's ask + cap are sane, and chairs/patients/bumps/options
  now populate for the named properties.
- Report: Pearland's reconciled rent/cap + what was superseded; the listings-dedup audit numbers + what the
  pass consolidated; completeness before/after for chairs/patients/bumps/options.

## Guardrails
- Fill-NULL / supersede, never hard-delete or overwrite verified human/master values. Provenance preserved.
- Idempotent, reversible, dry-run first. Coordinate with the reconciliation queue (prior prompt): resolving
  a `dia_comp_review_queue` row should set its status='resolved' with a note.
