# Audit — inverse propagation: do new SALES refresh the NOI/opex anchors future comps lean on? (2026-06-16)

**Question (Scott):** the symmetric of the rent→cap-rate audit — when a new sale lands with a
trusted cap, does it create/refresh the property's opex anchor + confirmed NOI that FUTURE
comps and tier-1/tier-2 cap computations use, or is the anchor side frozen/one-shot?

## Verdict: the inverse direction is WORKING — actively, not frozen (good news)
Unlike the forward direction (caps were frozen at ingest → R42), the sale→anchor/NOI
propagation is live and ongoing:
- **Opex anchors** (`cap_rate_history.opex_at_event`, tier-2 feedstock): 2,095 total, **847
  created in the last 60 days, latest today** — the sale cap-rate trigger writes an anchor on
  every qualifying new sale (trusted cap + validated rent + opex_implied>0). Live.
- **Confirmed-sale NOI** (`properties.noi_source='confirmed_sale'`, tier-1 of
  `gov_compute_cap_rate`): 474 properties, **all updated in the last 7 days, 329 in the last
  day** — written actively by the sale-ingest path (app-layer; no SQL function writes it, only
  `gov_compute_cap_rate` reads it). So a new sale's cap → confirmed NOI on the property → used
  by future computations. Live.
- Future computations DO consume these: `gov_compute_cap_rate` tier-1 (confirmed NOI) and
  tier-2 (lease rent minus anchored opex) read them at query time. Verified earlier — the R42
  recompute income_source showed both `property_noi_confirmed` and
  `lease_rent_minus_anchored_opex`.
- A sale also **closes the property's listing** (`close_listing_on_sale`), so there's no
  stale-active-listing-after-sale problem in the normal flow.

## Why the "recompute siblings on a new sale" symmetry is intentionally NOT applied
1,105 properties have multiple live sales — but those are mostly **genuine re-trades** (sold
2018 and 2023 = two real sales). Each sale's cap is correctly **point-in-time** (computed from
the rent/anchors as of that sale). You must NOT recompute a 2018 sale's cap because a 2026
sale happened — that would corrupt historical comp integrity. This is the key asymmetry vs
the rent case: newer rent improves a CURRENT valuation (R42 was right to recompute), but a
newer sale does not retroactively change an older sale's historical cap. So the absence of a
"sale → recompute prior sales" path is correct, not a bug.

## The only genuine (tiny) residual
- **42 active listings sit on a property that carries a `confirmed_sale` NOI** — their cap was
  set at listing-ingest and could be refreshed with the fresher confirmed NOI. Edge case
  (usually a sale closes the listing; these are likely relistings/quirks). Optional micro-fix.
- 199 of 474 confirmed NOIs are >120 months old → too old for tier-1 by design (point-in-time
  NOI ages out). Not a propagation bug.

## Recommendation: NO new round needed (right-sized)
The inverse propagation is wired and active — sales refresh the opex anchors + confirmed NOI
that future comps use, and the point-in-time integrity of historical caps is correctly
preserved. This is a clean bill of health. The only optional item is refreshing the **42**
active-listing caps on confirmed-NOI properties — small enough to fold into the R42 recompute
change-detection (have it also key on `properties.noi`/`noi_source` changes for ACTIVE
listings only) if you want full symmetry, but not worth a dedicated round on its own.

## Net (paired with the forward audit)
- Forward (rent/NOI → cap): was frozen; FIXED (R42 recompute-on-change + scoped backfill +
  review lanes).
- Inverse (sale → opex anchor + confirmed NOI): already working/active; no fix needed; 42-row
  optional micro-item.
Cap-rate accuracy is now bidirectionally sound: new rent refreshes caps, and new sales refresh
the anchors/NOI future caps lean on — both at the source.
