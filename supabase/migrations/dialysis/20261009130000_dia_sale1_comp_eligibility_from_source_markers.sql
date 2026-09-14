-- SALE1 — comp-eligibility from the source's OWN statement about a sale, never
-- from an inference. Four verbatim signals, each verified on named rows before
-- shipping (see docs/audits/SALE1_PRICE_PROPAGATION_AND_COMP_ELIGIBILITY.md):
--
--   1. transaction_type ILIKE '%nominal%'      — CoStar's own deed-classification
--      field. Nominal-consideration transfers (e.g. intra-family, corrective
--      deeds) are not arm's-length by definition.
--   2. transaction_type ILIKE '%foreclosure%'  — same field, same reasoning.
--   3. notes ILIKE '%not suitable for sales comparable purposes%' — CoStar's
--      own disclaimer string, verbatim, when a property "underwent a change
--      in title vesting."
--   4. notes ILIKE '%REO sale%'                — CoStar's own narrative
--      ("This was an REO sale and building financial information was not
--      disclosed…"), read on all 3 live rows before inclusion — genuine
--      distressed-sale disclosure, not an acronym collision.
--
-- Deliberately NOT included: a bare "distressed"/"bank-owned" text match (0
-- rows today, so untested), and any name- or price-based heuristic — this
-- migration touches ONLY what the source itself says about comp-suitability.
--
-- Fill-blanks discipline: only flips exclude_from_market_metrics FALSE -> TRUE
-- (a row already excluded is left alone — its exclusion may have a different,
-- unrelated reason and re-tagging it would blur two decisions into one).
-- Reversible: every row this migration flips is stamped in cap_rate_notes with
-- a dated, greppable marker; nothing else is touched.
--
-- Blast radius measured before shipping: 38 live rows carry at least one of
-- the four signals; 31 currently read exclude_from_market_metrics=false (this
-- migration's target), 23 of those 31 carry a computed cap_rate_final (i.e.
-- are live in the comps/cap-rate surfaces today). 7 are already excluded and
-- are left untouched. 0 false positives found on inspection of all 4 branches.

begin;

with flagged as (
  select sale_id, cap_rate_notes
  from sales_transactions
  where transaction_state = 'live'
    and exclude_from_market_metrics = false
    and (
      transaction_type ilike '%nominal%'
      or transaction_type ilike '%foreclosure%'
      or notes ilike '%not suitable for sales comparable purposes%'
      or notes ilike '%REO sale%'
    )
)
update sales_transactions s
set exclude_from_market_metrics = true,
    cap_rate_notes = trim(both ' | ' from
      coalesce(f.cap_rate_notes || ' | ', '')
      || '[sale1-eligibility-20261009] excluded from market metrics — source states a non-arm''s-length / non-comparable transaction'
    )
from flagged f
where s.sale_id = f.sale_id;

commit;

-- REVERSAL (if ever needed): only reverses rows THIS migration flipped —
-- never touches a pre-existing exclusion.
--
--   update sales_transactions
--   set exclude_from_market_metrics = false,
--       cap_rate_notes = nullif(trim(both ' | ' from
--         regexp_replace(cap_rate_notes, '\[sale1-eligibility-20261009\][^|]*', '', 'g')
--       ), '')
--   where cap_rate_notes ilike '%[sale1-eligibility-20261009]%';
