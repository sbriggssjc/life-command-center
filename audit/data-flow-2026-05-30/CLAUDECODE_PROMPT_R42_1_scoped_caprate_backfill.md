# Claude Code — R42.1: scope the cap-rate backfill (confidence + sanity band) + flag bad rent

## Why (review of the R42 Unit-2 dry-run, live 2026-06-16)
DO NOT run the blanket `*_recompute_caps_backfill(false, …)`. Reviewing the gov dry-run movers
by confidence + magnitude:
- **88% of drift is high-confidence rent and most big swings are real corrections** — they fix
  garbage ingest caps (e.g. prop 9763 22.5%→~7% from confirmed NOI; 14197 22%→6.15%). Real gov
  net-lease caps are ~6–9%; a 22–29% stored cap is clearly wrong.
- **But some recomputes are ALSO wrong — driven by bad rent.** Prop 1152: high-confidence, rent
  $1.77M on a $4.36M sale (~40% gross yield → 29% cap) — implausible rent (likely portfolio rent
  mis-attributed); old 4.05%→new 29.4% is a REGRESSION. Prop 5405: rent $257K on $17.6M → 1.46%;
  both old (29.6%) and new are nonsense.
A blanket apply would fix hundreds of garbage caps but also publish a few bad-rent caps into the
CM numbers (gov avg −1.56 pts; single moves up to 25–28 pts). Scope it.

## Unit 1 — make the backfill confidence- + sanity-bounded (both domains)
Refine `gov_recompute_caps_backfill` / `dia_recompute_caps_backfill` so the REAL write only
rewrites a derived cap when ALL hold:
- `income_confidence = 'high'` (drop low/medium from the auto-apply set).
- recomputed cap is in a plausible band — **gov ~[0.04, 0.12]**, **dia ~[0.045, 0.11]**
  (confirm each band from the live cap distribution before hard-coding; keep it a parameter).
- the implied **gross yield is sane** — exclude where `rent_gross / sold_price` is absurd
  (e.g. > 0.25), which is the bad-rent signal that caught 1152/5405.
Everything excluded by these guards is NOT applied.

## Unit 2 — emit the excluded movers as a review list (don't silently drop)
Write the excluded rows (low/med confidence, out-of-band, implausible-yield) to a review
artifact — a `caprate_recompute_review` table or a Decision Center lane — with the old cap, the
(rejected) recomputed cap, the rent used, and the reason. These are where the data is suspect;
a human decides, nothing auto-publishes.

## Unit 3 — re-run the scoped dry-run for Scott's sign-off
Produce the NEW before/after under the scoped filter (it should be tighter: fewer events,
smaller avg move, no 25-pt outliers). The cutover is still **gated on Scott's sign-off** because
it moves published CM numbers (gov reads `cap_rate_history.cap_rate`, dia `cap_rate_final`) —
deliver the scoped diff + the review-list count, then apply on his OK. Reversible via the
existing `cap_recompute_backup`.

## Unit 4 (separate follow-up, flag don't fix here) — upstream rent-data quality
The implausible-rent rows (rent/price gross yield > ~25%, e.g. 1152/5405) are BAD LEASE DATA —
the recompute only surfaced them. Capture them as a rent-data-quality review set (the same
review artifact is fine, tagged `bad_rent`) so the underlying leases get fixed at the source.
Don't try to auto-correct rent here.

## Guards
Reuse the authoritative compute fn; preserve raw broker caps + manual overrides; idempotent;
reversible; range guards intact. Forward Unit-1/Unit-3 of R42 (recompute-on-rent-change +
loader) stay as shipped. Apply the scoped backfill only after Scott signs off on the scoped
before/after.

## Bottom line
The backfill is a real correction but must be confidence- and sanity-bounded so it fixes the
garbage caps without publishing bad-rent ones; route the suspect movers + implausible rents to
review, and re-present the tighter before/after for sign-off.
