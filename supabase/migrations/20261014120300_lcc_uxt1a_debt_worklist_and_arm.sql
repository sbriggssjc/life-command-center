-- UX-T1a-debt — the loan_maturity signal resolved to owners, and the third arm of
-- v_lcc_bd_worklist. APPLIED LIVE to xengecqvemvfknjvbvrq 2026-09-03 (as three
-- migrations: _worklist, _bd_worklist_loan_arm, _is_distressed; consolidated here into
-- the FINAL shipped state, which is what a rebuild must produce).
--
-- WHY IT EARNS A HUMAN (operator-doctrine 1.8.0 §0b.2/§0.2): a maturing loan is a reason
-- to sell -- the owner must refinance or exit, and that is a call a person makes. The two
-- existing arms do NOT earn one: ownership_chain is applied automatically by A2/cron 244,
-- and contact_writeback is C1's `sf_link_candidate`, which already has an automated
-- consumer. The Today BD tile had been serving 100% plumbing.
--
-- `suspected_sale` and `owner_source_conflict` remain UNIMPLEMENTED in this view on
-- purpose. Both are labelled by app.js:renderTodayBdActions; neither has an LCC producer.
-- A slot filled with a guess is worse than one that is honestly empty.
-- (The HANDLER does fan out to domain views for those two -- see api/operations.js.)
--
-- ⚠️ ROWS != PROPERTIES != OWNERS, and the gap is structural, not noise. Measured:
-- 172 rows / 122 properties / 109 owners. A property with a sponsor AND its SPE both
-- recorded as current owners emits TWICE (OWN-T0: 756 properties carry >1 current owner;
-- e.g. gov 12899 is `US Fed Properties Trust` + `NGP V DENTON TX LLC`). Both rows are
-- TRUE -- one asset held at two levels -- so neither is suppressed and OWN-T0's refusal
-- to adjudicate sponsor/SPE stands. `owners_on_asset` rides in `detail` so a surface can
-- say so instead of the operator meeting the same building twice with no explanation.
--
-- ⚠️ rank_value IS NULL WHEN THE ASSET IS UNPRICED, NOT 0 (P180). 39 of the 172 rows have
-- no rent on either the fact or the mirror. `0` renders as "$0" and reads as WORTHLESS;
-- NULL means "cannot be sized". This deliberately DIFFERS from the two existing arms,
-- which COALESCE to 0 -- they are not changed here, and the divergence is named rather
-- than silently copied.
--
-- ⚠️ TOMBSTONES ARE EXCLUDED (P175): existence is not liveness, and a merged-away entity
-- still satisfies a plain join. 0 today, and the guard stays because the merge path runs
-- ~285 times a month.
--
-- Guard population, POSITIVE-CONTROLLED (a guard that catches nothing is
-- indistinguishable from one that does not work): brokerage / placeholder /
-- not-prospected each fire on 0 of 172 rows here, while fleet-wide over 66,941 live
-- entities they fire on 813 / 100 / 629. The zero is a property of this population.
--
-- Reverse: DROP VIEW v_lcc_loan_maturity_worklist and re-create v_lcc_bd_worklist from
-- its two-arm body in 20260911120000_lcc_p115_bd_worklist_decorrelate.sql.

CREATE OR REPLACE VIEW public.v_lcc_loan_maturity_worklist AS
WITH win AS (
  -- One row per (domain, property): the SOONEST maturity. A property with several loans
  -- is one conversation, not several; `loans_on_asset` keeps the rest countable.
  -- (Note the domains' own v_loan_maturity_watch picks the LATEST maturity per property
  -- and applies no upper bound at all, so its `<=24mo` label is a catch-all. Soonest is
  -- the actionable one for a reason-to-sell signal.)
  SELECT lm.*,
         row_number() OVER (PARTITION BY lm.source_domain, lm.source_property_id
                            ORDER BY lm.maturity_date ASC, lm.loan_ref ASC) AS rn,
         count(*)    OVER (PARTITION BY lm.source_domain, lm.source_property_id) AS loans_on_asset
    FROM public.lcc_loan_maturity lm
   WHERE lm.maturity_date IS NOT NULL
     AND lm.maturity_date >= CURRENT_DATE
     AND lm.maturity_date <= CURRENT_DATE + interval '24 months'
)
SELECT w.source_domain,
       w.source_property_id,
       f.entity_id,
       e.workspace_id,
       e.name AS owner_name,
       w.maturity_date,
       -- 30.44 = mean days/month. Rounded to whole months: the operator reads "14 mo",
       -- and a spurious decimal would imply a precision a maturity date does not carry.
       round(((w.maturity_date - CURRENT_DATE) / 30.44)::numeric, 0)::int AS months_to_maturity,
       w.lender_name,
       w.original_amount,
       w.current_balance,
       w.is_cmbs,
       w.loan_status,
       w.loan_ref,
       w.loans_on_asset,
       count(*) OVER (PARTITION BY w.source_domain, w.source_property_id) AS owners_on_asset,
       COALESCE(NULLIF(f.annual_rent, 0), NULLIF(pa.annual_rent, 0)) AS rank_value,
       CASE WHEN NULLIF(f.annual_rent, 0) IS NOT NULL THEN 'portfolio_fact_annual_rent'
            WHEN NULLIF(pa.annual_rent, 0) IS NOT NULL THEN 'mirror_annual_rent'
            ELSE 'value_unknown' END AS value_basis,
       pa.address, pa.city, pa.state,
       -- ⚠️ APPENDED, and it must stay last. The first cut of the follow-up migration put
       -- this in the middle of the list and Postgres refused it: 42P16 "cannot change
       -- name of view column loan_ref to is_distressed". CREATE OR REPLACE VIEW matches
       -- columns BY POSITION, so a mid-list insert renames everything after it.
       --
       -- gov records active/defaulted; dia records is_active and its loan_status is a
       -- deliberate NULL, so a dia row can never read distressed -- an honest absence of
       -- the fact, not a claim the loan is healthy.
       -- Positive control: loan_status over the mirror reads active 410 / NULL 155 /
       -- defaulted 3, so the predicate discriminates and is genuinely 0 inside the
       -- 24-month window today rather than structurally unreachable.
       (w.loan_status = 'defaulted') AS is_distressed
  FROM win w
  JOIN public.lcc_entity_portfolio_facts f
    ON f.source_domain = w.source_domain
   AND f.source_property_id = w.source_property_id
   AND f.is_current
  JOIN public.entities e
    ON e.id = f.entity_id
   AND e.merged_into_entity_id IS NULL
  LEFT JOIN public.lcc_property_attributes pa
    ON pa.source_domain = w.source_domain
   AND pa.source_property_id = w.source_property_id
 WHERE w.rn = 1
   AND NOT public.lcc_owner_name_is_brokerage(e.name)
   AND NOT public.lcc_is_placeholder_owner_name(e.name)
   AND NOT public.lcc_owner_name_is_not_prospected(e.name);

COMMENT ON VIEW public.v_lcc_loan_maturity_worklist IS
  'UX-T1a-debt: owners whose current holding carries a loan maturing within 24 months. '
  'Grain: one row per (owner, property) -- 172 rows / 122 properties / 109 owners on '
  '2026-09-03, because a sponsor and its SPE can both be current owners of one asset '
  '(OWN-T0). rank_value is NULL, never 0, when the asset is unpriced.';

GRANT SELECT ON public.v_lcc_loan_maturity_worklist TO authenticated, service_role;

-- `is_distressed` is APPENDED to v_lcc_bd_worklist too: app.js:renderTodayBdActions
-- renders a ⚠ badge titled "Distressed loan" from `it.is_distressed`, and
-- assembleBdWorklist hard-coded `is_distressed: false` for every LCC row -- C10's class
-- one field over: a renderer reading a key no producer sets, invisible because the badge
-- simply never appeared.
CREATE OR REPLACE VIEW public.v_lcc_bd_worklist AS
 SELECT 'contact_writeback'::text AS signal_type,
    cw.domain AS source_domain,
    NULL::text AS property_id,
    cw.entity_id,
    cw.workspace_id,
    'Push contact to Salesforce'::text AS what,
    cw.name AS who,
    cw.rank_value,
    cw.rank_property_count::integer AS rank_property_count,
    NULL::text AS address,
    NULL::text AS city,
    NULL::text AS state,
    jsonb_build_object('email', cw.email, 'company', cw.company, 'sf_account_id', cw.sf_account_id) AS detail,
    false AS is_distressed
   FROM v_lcc_contact_writeback_candidates cw
UNION ALL
 SELECT 'ownership_chain'::text AS signal_type,
    ch.source_domain,
    ch.source_property_id AS property_id,
    ch.current_owner_entity_id AS entity_id,
    ch.workspace_id,
    'Resolve ownership chain to developer'::text AS what,
    ch.current_owner_name AS who,
    ch.rank_value,
    NULL::integer AS rank_property_count,
    ch.address,
    ch.city,
    ch.state,
    jsonb_build_object('gap', ch.gap, 'suggested_research_type', ch.suggested_research_type, 'true_owner_name', ch.true_owner_name, 'developer_name', ch.developer_name) AS detail,
    false AS is_distressed
   FROM v_ownership_chain_worklist ch
UNION ALL
 SELECT 'loan_maturity'::text AS signal_type,
    lm.source_domain,
    lm.source_property_id AS property_id,
    lm.entity_id,
    lm.workspace_id,
    ('Loan matures ' || to_char(lm.maturity_date, 'Mon YYYY')
      || ' (' || lm.months_to_maturity::text || ' mo)'
      || CASE WHEN lm.is_distressed THEN ' - DEFAULTED' ELSE '' END)::text AS what,
    lm.owner_name AS who,
    lm.rank_value,
    NULL::integer AS rank_property_count,
    lm.address,
    lm.city,
    lm.state,
    jsonb_build_object(
      'maturity_date',      lm.maturity_date,
      'months_to_maturity', lm.months_to_maturity,
      'lender_name',        lm.lender_name,
      'original_amount',    lm.original_amount,
      'current_balance',    lm.current_balance,
      'is_cmbs',            lm.is_cmbs,
      'loan_status',        lm.loan_status,
      'loan_ref',           lm.loan_ref,
      'loans_on_asset',     lm.loans_on_asset,
      'owners_on_asset',    lm.owners_on_asset,
      'value_basis',        lm.value_basis
    ) AS detail,
    lm.is_distressed
   FROM v_lcc_loan_maturity_worklist lm;

COMMENT ON VIEW public.v_lcc_bd_worklist IS
  'BD signal worklist feeding /api/operations?action=bd_worklist and the Today BD tile. '
  'Three arms: contact_writeback, ownership_chain, and (UX-T1a-debt, 2026-09-03) '
  'loan_maturity. suspected_sale and owner_source_conflict are labelled by the renderer '
  'and have NO producer here -- deliberately not emitted rather than half-filled. '
  'is_distressed appended for the renderer''s existing (previously unfed) badge.';

-- VERIFIED: signal_type distribution ownership_chain 3,534 / contact_writeback 1,646 /
-- loan_maturity 0 -> 172. The two existing arms are UNMOVED (the positive control).
