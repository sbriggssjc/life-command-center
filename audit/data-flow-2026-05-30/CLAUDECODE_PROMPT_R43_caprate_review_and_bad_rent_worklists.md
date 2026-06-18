# Claude Code — R43: value-ranked worklists for the cap-rate review queue + bad-rent leases

## Why (R42.1 follow-up, live 2026-06-16)
The scoped cap-rate backfill applied the clean corrections and parked the suspect movers in
`caprate_recompute_review` (gov 169 = 103 low_confidence / 47 out_of_band / 19 implausible_yield;
dia 244 = 227 / 17 / 0). Two distinct human follow-ups now need a surface so they actually get
worked instead of sitting in a table:
1. **Review queue** — the low-confidence + out-of-band movers: a human decides apply / keep-old
   / fix-rent.
2. **Bad-rent leases** (`reason='bad_rent'` / implausible_yield, 19 gov) — these are genuinely
   bad LEASE data the recompute surfaced (e.g. prop 1152: rent $1.77M on a $4.36M sale = ~40%
   gross yield); the fix is to correct the rent at the source, not the cap.

## Unit 1 — surface `caprate_recompute_review` as a value-ranked worklist
- A view `v_caprate_review_worklist` over `caprate_recompute_review` (exclude `resolved_at IS
  NOT NULL`), joined to the property for value context, **ranked by $ impact** — e.g.
  `sold_price * abs(old_cap - recomputed_cap)` (dollars-of-value the cap discrepancy moves),
  then drift. Columns: property, address, old cap, recomputed cap, drift, reason, rent used,
  income_confidence, sold_price, domain.
- Render it as a **Decision Center lane** (reuse the existing lane pattern), with per-row
  verdicts that ride existing machinery: **apply** (write the recomputed cap via the same
  bounded path, stamp `resolved_at`/`resolution='applied'`), **keep_old** (`resolution=
  'kept'`), **needs_rent_fix** (route to Unit 2's bad-rent set). Self-propelling/advance like
  the other lanes; `resolved_at` drops the row out.
- Domain-aware (gov + dia review tables).

## Unit 2 — bad-rent lease-fix worklist (fix the SOURCE)
- A view `v_bad_rent_leases` for the `bad_rent` / implausible-yield rows: property, the
  offending lease(s), the rent value, sold_price, **implied gross yield**, and the plausible
  rent range (from comps / the property's size × market rent) so the operator can see what it
  *should* be. Ranked by $ value.
- This is the highest-value cut — bad rent corrupts caps, comps, and value ranking everywhere.
  Surface it (Decision Center lane or the Research/Data-Quality surface) with a link to the
  lease record so the rent is corrected at source. When the lease is fixed, the R42 Unit-1
  recompute-on-rent-change automatically refreshes that property's caps — closing the loop.
- Do NOT auto-correct rent (no reliable single right value) — this is operator-judgment work;
  the worklist just makes it findable and ranked.

## Guards / house rules
- Read-mostly: the worklist views + lanes are additive; verdicts reuse the bounded cap-write
  path (Unit 1 apply) and the existing recompute (no new compute logic). `resolved_at` is the
  done-signal so rows don't re-surface. ≤12 `api/*.js`; `node --check`; suite green.
- Verify: gov 169 / dia 244 review rows appear ranked by $ impact; the 19 bad_rent rows appear
  in the lease-fix worklist with their implied yield; working a row (apply/keep/fix) drops it
  from the lane; a fixed lease triggers the R42 recompute.

## Bottom line
Turns the parked review + bad-rent sets into value-ranked, workable lanes so the suspect
cap-rate movers get human disposition and the genuinely-bad leases get fixed at the source —
after which the live recompute keeps the caps accurate automatically. Closes the cap-rate
accuracy loop.
