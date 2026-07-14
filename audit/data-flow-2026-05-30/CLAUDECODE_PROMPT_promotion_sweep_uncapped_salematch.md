# Claude Code (life-command-center) — availability-promotion-sweep: promote confirmed sale-matches regardless of age

## Why (proven live, dia + gov, 2026-07-14)

The listing "needs manual confirmation" queue accumulates confirmed-sold listings
that the promotion sweep permanently skips. `v_listings_needing_manual_confirmation`
(dia + gov) self-classifies each `unverified_assumed_off` listing:

- `sale_match_promote` — has a `candidate_sale_id` that is a **1:1 same-property
  match** to a recorded `sales_transactions` row (listing.property_id =
  sale.property_id, prices identical). A confirmed sale → the listing should be
  **Sold**.
- `aged_needs_research` — off-market >90d, no sale match → genuinely manual.
- `awaiting_sweep` — transient.

**Root cause:** `api/admin.js handleAvailabilityPromotionSweep`
(`?_route=availability-promotion-sweep`, cron `lcc-availability-promotion-sweep`)
only promotes listings whose `off_market_date` is within `max_age_days` (default
90, capped 180). But a confirmed **same-property deed/sale match is a confirmed
sale at ANY age** — the age cap made sense for the "did it quietly withdraw?"
aging heuristic, NOT for a matched sale. Live, the stranded confirmed-match set
was dia **124** (110 aged >90d) + gov **9** (all aged >90d) — sitting unresolved
for 413–3,332 days despite a recorded sale on the exact property.

**Already cleared manually (2026-07-14, operator-approved):** all 133 promoted to
Sold via `lcc_record_listing_check(…, 'manual_user', 'sold', …)` (notes tagged
`auto-resolve backfill: candidate_sale_id=…`; reversible). The queue dropped dia
499→375, gov 67→58. This round makes it durable so it doesn't refill.

## The fix

In `handleAvailabilityPromotionSweep` (both domains — the handler is
domain-parameterized), **decouple the sale-match promotion from `max_age_days`**:
a listing whose `confirmation_state='sale_match_promote'` (i.e. it has a
`candidate_sale_id` 1:1 same-property match) is promoted to Sold **regardless of
`off_market_date` age**. Keep `max_age_days` governing ONLY the non-matched aging
behavior (the `unverified_assumed_off` → research/off-market timer), if any.

- Drive the promotion straight off the view's classification
  (`v_listings_needing_manual_confirmation WHERE confirmation_state =
  'sale_match_promote'`) rather than re-deriving a recency-gated candidate set —
  the view already encodes the exact "confirmed sale, promote" doctrine.
- Promote via the existing `lcc_record_listing_check(p_listing_id, p_method,
  'sold', …, p_off_market_reason => 'sold', p_effective_at => candidate_sale_date,
  p_notes => 'auto-resolve: candidate_sale_id=…')`. It sets `is_active=false`,
  `status='Sold'`, `off_market_reason='sold'`, writes verification +
  status-history rows (auditable, reversible), and preserves the existing
  `off_market_date`.

### ⚠️ Constraint gotcha (hit live — must respect)

`lcc_record_listing_check` passes its single `p_method` to BOTH
`listing_verification_history.method` (CHECK `lvh_method_check`:
`auto_scrape|manual_user|sidebar_capture|sold_imported`) AND
`listing_status_history.source` (CHECK `lsh_source_check`:
`auto_scrape|sidebar_capture|manual_user|sale_imported|matcher_inferred|seed_import`).
**The two CHECKs disagree** — `sold_imported` (lvh) vs `sale_imported` (lsh) — so
the only method values valid for both are **`auto_scrape` / `manual_user` /
`sidebar_capture`**. Use `auto_scrape` for the cron path (it's an automated
promotion). **Also (small, do it here):** reconcile the two CHECKs on both dia +
gov so a proper `'sale_imported'` / `'sold_imported'` label is accepted by both
(add the missing value to each ARRAY), and switch the sweep's method to that
semantic label — additive/reversible migration, so the sold-from-match rows are
labeled honestly instead of as a generic auto_scrape.

## Boundaries / verify

- life-command-center: `api/admin.js handleAvailabilityPromotionSweep` (no new
  api/*.js). Optional additive migration on dia + gov to align the two listing
  CHECK constraints. No change to the availability-checker or auto-scrape crons.
- **Verify:** a GET dry-run of the sweep reports the `sale_match_promote` set for
  a domain independent of age; a POST promotes them all to Sold (verification +
  status-history written, `is_active=false`, `status`=sold). After a run,
  `v_listings_needing_manual_confirmation WHERE confirmation_state=
  'sale_match_promote'` returns **0** for both domains (the queue holds only
  `aged_needs_research` + transient `awaiting_sweep`). Re-run is idempotent (0
  left to promote).
- Reversible: the manual backfill + the cron both write tagged verification rows;
  a promoted listing can be reverted (is_active=true / status back / delete the
  tagged history rows).

## Documentation

Update CLAUDE.md (availability-promotion-sweep section): a confirmed same-property
sale match (`confirmation_state='sale_match_promote'`) is promoted to Sold
regardless of `off_market_date` age — the `max_age_days` cap governs only the
no-match aging path. Note the `lvh_method_check` ∩ `lsh_source_check` intersection
(and that they were reconciled). One doctrine: a deed match is a sale at any age.

## Bottom line

Confirmed-sale listings were stranded in the confirmation queue forever because
the promotion sweep's 90-day age cap skipped them (dia 124 + gov 9, up to 9 years
old, all 1:1 property-matched to a recorded sale). Cleared manually today;
this fix promotes any `sale_match_promote` regardless of age so the queue stays
clean and holds only genuine research/transient items. Respect the two-CHECK
method intersection (and reconcile them). Verify the queue's sale_match_promote
count is 0 after a run, both domains.
