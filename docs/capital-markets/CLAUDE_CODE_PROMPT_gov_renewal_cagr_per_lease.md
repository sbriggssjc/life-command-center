# Claude Code prompt — recompute GSA Renewal CAGR the deck's (per-lease) way (government)

> Run in **GovernmentProject**. EXPLORATION-FIRST: the published deck
> ("State of the Government-Leased…" p.32, "CPI vs GSA Renewal Rent CAGR" and
> "Renewal Rent and its Growth Rate Over Time") shows a renewal-rent CAGR line
> that (a) goes back to ~2014 and (b) sits flat around ~1%. Ours starts 2018 and
> is shaped differently. The deck is built from the same GSA lease events, so the
> data exists — we are computing a DIFFERENT metric. The task is to reproduce the
> deck's per-lease CAGR, which both extends the line back to 2014 and matches its
> shape.

```
GOAL: replace the gov renewal CAGR (currently a 5-yr market-average growth that
can't start before 2018) with the deck's PER-LEASE CAGR — new lease rate vs the
prior rate in place at the same building before renewal, annualized over the
elapsed term, averaged across the renewals in each TTM window.

## Why ours is stuck at 2018 / wrong shape
cm_gov_renewal_rent_growth_m.cagr_5yr = power(ttm_avg_renewal_rent_psf /
lag(ttm_avg_renewal_rent_psf, 60 months), 1/5) - 1. That needs 5 years of prior
market history, and gsa_lease_events 'renewed' rows start Feb-2013 (zero before),
so the first value is Feb-2018. It's also a market-wide growth number, not the
deck's per-lease renewal spread, so the curve doesn't match.

## Deck definition to reproduce (p.32 text, verbatim intent)
"the average compound annual growth rate (CAGR) for all renewed GSA leases during
the past twelve months ... comparing the new lease rate to the previous rate in
place at the same building before renewal ... considers the time elapsed between
the initial lease commencement and the renewal rent." Light-blue dots = TTM
average; the dark line on the right chart is the same series. It also plots upper
/ lower QUARTILES of that per-lease CAGR (the dark vertical bars on the left chart).

## Environment
- Supabase "government", ref scknotsqkcheojiaewwh, schema public.
- gsa_lease_events columns: lease_number, location_code, address, property_id,
  lease_rsf, annual_rent, lease_effective, lease_expiration, event_type,
  event_date, changed_fields (jsonb), ... Renewals are event_type='renewed'.

## Exploration tasks (PROVE the prior rate exists before building the view)
1. FIND THE PRIOR RATE. For each 'renewed' event, locate the rate in place
   immediately before renewal at the same building. Test, in order, whichever
   yields the best coverage:
   (a) self-join on lease_number (or location_code / property_id) to that lease's
       most recent PRIOR event, using its annual_rent / lease_rsf;
   (b) changed_fields jsonb — does it carry the old annual_rent / old rent_psf?
   (c) lease_effective / commencement vs event_date for the elapsed-years term.
   Report prior-rate coverage (% of renewals with a recoverable prior rate) for
   each method.
2. COMPUTE PER-LEASE CAGR. per_lease_cagr = (new_rent_psf / prior_rent_psf) ^
   (1 / years_elapsed) - 1, where years_elapsed = (renewal_date - prior
   commencement) / 365.25. Apply the same outlier trim already used on renewal
   rent (rent_psf in [$5,$100]; drop the >1000/day sentinel event dates).
3. REPRODUCE THE DECK. Average per_lease_cagr over the trailing 12 months per
   month-end; also compute its upper/lower quartile. Confirm the TTM average is
   flat ~1% and EXISTS back to ~2014 (it should, since each renewal is
   self-contained and needs no 5-yr market history). Compare to the deck's shape.

## Then fix
- Add cagr_per_lease (+ cagr_per_lease_uq / _lq) to cm_gov_renewal_rent_growth_m
  and repoint the Renewal Growth chart's CAGR line and the CPI-vs-Renewal-CAGR
  chart (cm_gov_cpi_vs_renewal_cagr) to it. Keep the old cagr_5yr column if other
  consumers need it, but the charts use the per-lease series.

## Validate
- The renewal CAGR line plots from ~2014 (not 2018), flat ~1-1.5%, matching deck
  p.32 within a few tenths of a percent; quartile band brackets it.

## Constraints
- Don't fabricate a prior rate. If a renewal has no recoverable prior rate from
  (1), it's excluded from the per-lease average (report the residual coverage).
  The strong prior is that prior rates ARE recoverable via lease_number history.
```
