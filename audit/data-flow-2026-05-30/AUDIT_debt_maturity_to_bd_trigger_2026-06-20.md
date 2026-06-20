# Audit — debt maturity → refi-risk / BD trigger (2026-06-20)

**Question (Scott):** the CMBS/loan pipeline captured loans, maturities, and the investment_scores
debt columns. Does a maturing or distressed loan surface as a BD trigger (refi opportunity,
forced-sale signal) and feed scoring/queue — or sit unused?

## Verdict: loan maturity is captured but completely unsurfaced — no BD trigger, no score input; the distress flags were scaffolded and never populated

### Captured (the data is there)
- **gov:** 1,500 loans across **761 properties**; 372 with a maturity date; **155 loans / 106
  active properties maturing within 24 months ($138.9M annual rent)**; 59 already matured.
- **dia:** 526 loans / 344 properties, but only 56 maturities / 8 maturing — thin; gov is the
  meaningful book.
- The `loans` table has the full CMBS distress schema: `watchlist`, `special_servicing`,
  `num_delinquent`, `dscr`, `ltv`, `balloon_maturity`, `status_at_disposal`, `modification`.

### Not fed back (three gaps, same shape as R49/R50)
1. **The distress flags are scaffolded but UNPOPULATED.** watchlist = 0, special_servicing = 0,
   dscr < 1 = 0 across all 1,500 gov loans. The distress dimension — a watchlisted /
   special-serviced loan is an *imminent forced sale*, the sharpest BD signal — was never filled
   by the ingest. Only `maturity_date` is actionable today.
2. **The score stores debt columns but doesn't use them.** `investment_scores` carries 741
   `has_debt`, 178 `loan_maturity_date`, 73 `ltv` — but the 6-factor model (term/credit/location/
   rent/renewal/building) has **no debt/leverage/maturity factor** (identical to the agency-risk
   blindness found in R49). DSCR / county-maturity columns are 0.
3. **No BD trigger exists at all.** The `research_tasks` types are all ownership-related
   (property_missing_recorded_owner, establish_ownership_history, trace_ownership_to_developer,
   …) — **no maturity/refi/debt type**. The priority queue has no debt band (P0-P8 / P-BUYER /
   P-CONTACT). No decision lane. `maturity` appears only as a *displayed field* in the property
   context packet — it never drives an action.

### The gap
A loan maturity is THE classic CRE BD trigger: at maturity the owner must refinance or sell —
acute right now given the rate environment + gov-leased/DOGE pressure. We capture it and ignore
it: **106 gov properties / $139M rent with a near-term maturity** — each a prime refi-advisory or
disposition conversation — are invisible as BD opportunities, and the distress flags that would
sharpen the list are empty. Captured-but-not-fed-back, the same pattern as R49 (risk ignored by
the grade) and R50 (geocode unused before it was wired).

## Fix doctrine → R54 (turn maturity/distress into a value-ranked BD trigger)
Additive read features + a BD signal (no writes to curated data; signals/candidates, not facts),
gov-focused (dia thin):
1. **Maturity-watch BD surface** — `v_loan_maturity_watch` (gov + dia): properties with a loan
   maturing within N months (+ already-matured), value-ranked by rent (and loan balance where
   present), with months-to-maturity + the property's owner (tie to R47/R51 owner resolution → who
   to call). Drive it into a **value-ranked surface the operator works**: a Decision Center lane
   and/or a `refi_or_disposition` research/outreach signal, plus the property detail + context
   packet. The owner of a near-term-maturity property is a prime outreach target.
2. **Populate the distress flags** — fix the CMBS ingest to fill `watchlist` /
   `special_servicing` / `dscr` / `num_delinquent` if the CoStar CMBS source carries them (they're
   scaffolded empty); if the source doesn't provide them, document that and rely on maturity. A
   watchlisted/special-serviced loan should rank at the very top of the watch.
3. **(Optional, gated) feed maturity/leverage into the grade** — as an overlay or a gated v3-style
   factor, mirroring R49's `SCORING_MODEL_ACTIVE` pattern. The headline value is the BD trigger,
   not the grade — defer this unless wanted.

## Bottom line
The debt layer is captured (155 gov loans maturing in 24mo, $139M rent) but dormant: no BD
trigger, no score input, and the distress flags sit empty. R54 turns loan maturity (and, once
populated, distress) into a value-ranked refi/disposition BD trigger wired into the operator's
surfaces — the same "light up the captured layer" move as R50, on the debt data this time.
