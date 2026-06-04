-- =============================================================================
-- Round 66x.2 (Step 3 close-out) — term backfill onto the r2 master sales
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa) | Date: 2026-06-04
--
-- After the import committed 280 master_xlsx_backfill_r2 sales, backfill
-- firm_term_years_at_sale from the master's term_years (master_curated, LOCKED),
-- matched r2 sale -> master row by (sale_date, sold_price):
--   * 44 termless r2 sales filled from the master term.
--   * 29 audit-overrides of lease_in_effect terms that materially disagreed with
--     the master (|diff| > 1.5 yr -- the Venoy failure class; e.g. 14516 0.18->5.18,
--     14431 0.67->4.68, where the lease-in-effect resolver had picked a nearly-
--     expired/renewal lease). 73 updates total; firm_term_locked=true so the
--     resolver no longer recomputes them.
--   * 58 termless r2 sales stay NULL (the master also lacks a term).
--   * cap backfill was a NO-OP: the 49 capless r2 sales have no in-band master
--     sold_cap (the importer already set every in-band cap on insert).
--
-- ACCEPTANCE (harness re-run; all four consumer views stayed IDENTICAL):
--   Dec-2025  12+ 6.80 / 8-12 6.64 / 6-8 7.04 / <=5 7.45   (mid-cohorts moved up)
--   2019-11   <=5 7.02 smoothed (7.34 raw)
--   2022-08   <=5 7.11
--
-- HONEST FINDING on the 2019 <=5 (expected ~8.6%, the band-compliant master avg):
--   The backfill worked -- the r2 (master) <=5 deals in the 2019-11 TTM average
--   8.18% (~ the deck's master-only value). But the COHORT blends them with 18
--   pre-existing NON-master <=5 deals averaging 7.20%, so the cohort sits at 7.34
--   raw (only 3 of 21 deals are master). The deck's 8.6% is master-ONLY; our chart
--   is the broader universe. So the residual to the deck is NOT only the >12% band
--   choice -- it also includes non-master cohort dilution. Some of those 18 are
--   likely the cross-property DUP_REVIEW twins (CoStar versions, lower cap) that
--   the importer flagged as property-merge candidates; merging them (and auditing
--   the rest) is the path to closing the 2019 <=5 toward the master, and is left as
--   the next decision (master-only chart definition vs. merge+audit the 18).
-- =============================================================================
UPDATE public.sales_transactions s
SET firm_term_years_at_sale = v.term,
    firm_term_locked = true,
    firm_term_source = 'master_curated',
    firm_term_expiration_at_sale = (s.sale_date + (v.term * interval '1 year'))::date,
    firm_term_computed_at = now()
FROM (VALUES (14422,7.2438),(14424,6.1507),(14431,4.6795),(14432,0.726),(14443,1.7096),(14444,9.2603),(14446,6.5863),(14450,9.3151),(14451,9.9671),(14453,0.6959),(14459,5.2247),(14462,1.6099),(14463,5.1699),(14465,13.8822),(14466,13.8849),(14469,10.326),(14474,9.5014),(14498,2.8274),(14500,2.9414),(14504,8.3753),(14508,4.7781),(14510,9.1753),(14512,14.5151),(14516,5.1808),(14519,14.7178),(14521,6.2301),(14523,5.2849),(14527,11.6137),(14531,9.0027),(14532,15.0082),(14533,5.9781),(14536,15.3014),(14545,3.3397),(14549,8.8),(14556,12.4329),(14557,8.5041),(14570,14.4384),(14576,4.8877),(14578,10.6685),(14579,6.0301),(14590,5.0822),(14592,4.7151),(14593,14.9178),(14597,15.0932),(14602,8.7671),(14603,13.9781),(14604,14.6521),(14608,15.9808),(14613,7.5315),(14614,2.9562),(14616,2.5753),(14619,7.8164),(14631,10.9616),(14633,14.2548),(14634,10.4685),(14635,11.7918),(14636,14.1014),(14645,11.0575),(14649,7.8712),(14656,11.9041),(14659,15.0685),(14665,5.9205),(14666,4.6301),(14671,8.6712),(14676,9.1781),(14677,12.2438),(14679,13.0986),(14681,8.1863),(14682,8.4),(14683,13.4356),(14685,15.263),(14686,15.5918),(14690,2.8795)) AS v(sale_id,term)
WHERE s.sale_id = v.sale_id AND s.data_source = 'master_xlsx_backfill_r2';
