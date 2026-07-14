# Claude Code (government-lease) — align the gov CM cap-rate/by-term chart base to v_gov_on_market

## Why (surfaced during the Overview canonical-source round, 2026-07-13)

We just made `v_gov_on_market` (active + no-exit + recent-24mo = **278**) THE one
gov "currently on market" definition, read by the Overview, the listings tab, and
the CM report. The CM cap-rate charts correctly stayed on their own view
(`cm_gov_available_cap_dot` = **44**), because that view adds a cap-rate +
firm-term filter — it's the *plottable subset* (a cap-rate dot needs a cap rate),
NOT the on-market count. That distinction is right and must stay.

The remaining nicety: confirm the cap-dot's **base universe** (before the
cap-rate/firm-term plottable filter) is the SAME "currently on market" set as
`v_gov_on_market`. Today the cap-dot / by-term views compute their own
`active + off_market_date IS NULL` base, which is the pre-recency **519** set —
so a plotted cap-rate dot could belong to a listing that is NOT in the canonical
on-market universe (e.g. a 3-year-stale listing that never got an
`off_market_date`). The plottable set should be a **strict subset** of the
canonical on-market 278, so the charts and the on-market count can't tell
different stories.

## The fix

Repoint the base membership of the gov CM available cap-rate / by-term views to
`v_gov_on_market` (by `listing_id`), THEN apply the existing plottable filters
(cap-rate present, firm-term present, cap-rate range, etc.) on top:
- `cm_gov_available_cap_dot` — start from `v_gov_on_market` membership, then keep
  the rows that have a plottable cap rate (+ whatever firm-term/range guard it
  already applies).
- `cm_gov_available_by_term_summary` / `cm_gov_available_by_term_bucket` (and any
  sibling `cm_gov_available_*` view that buckets the "available" set) — same:
  base on `v_gov_on_market`, then bucket.
- Net: every cap-rate dot / term bucket is a listing that IS in the canonical
  on-market 278. The plottable count stays ≈44 (or whatever the cap-rate-present
  subset of 278 is — likely close, possibly a touch different once the base is
  the recency-gated set); that number is legitimately smaller than 278 because
  not every on-market listing has a cap rate. Document that the cap-dot count is
  "on-market listings WITH a plottable cap rate," a strict subset of on-market.

## Boundaries / verify

- government-lease; the `cm_gov_available_*` cap-rate/by-term view definitions
  (SQL, on the gov DB); additive/reversible (re-create the prior bodies to
  revert). No app/JS change required — the CM export reads these views by name.
  No `available_listings` row writes.
- **Verify (live, read-only):** every `listing_id` in `cm_gov_available_cap_dot`
  is present in `v_gov_on_market` (strict subset — an anti-join returns 0 rows);
  the cap-dot count is ≤ 278 and equals the cap-rate-present subset of the
  canonical on-market set; the by-term buckets sum to that same plottable subset.
  Spot-check the CM export still renders the cap-rate scatter + by-term chart with
  no dropped/duplicated points.
- Confirm no regression to the CM quarterly export (the charts still populate;
  the cap-dot is now a clean subset of on-market, not a parallel universe).

## Documentation

Update the gov CLAUDE.md / CM section: the cap-rate/by-term chart base is
`v_gov_on_market` (the canonical on-market universe); the cap-dot is the
plottable subset (on-market listings with a cap rate), a strict subset of the
on-market count — one on-market definition, the charts a subset of it.

## Bottom line

Small consistency closer: base the gov cap-rate/by-term charts on the canonical
`v_gov_on_market` set so every plotted point is genuinely on-market — the charts
become a strict subset of the one on-market number instead of a separate filter,
completing the "one definition, everywhere" cleanup for gov listings.
