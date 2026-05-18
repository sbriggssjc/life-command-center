-- ============================================================================
-- QA-25 (2026-05-18, dia): v_prospect_targets — unprospected owners by prop count.
--
-- The dia home dashboard's "Missing SF Link" widget reports 79% (2,722 of
-- 3,422). QA-25 audit found:
--   • 75.4% of dia true_owners (2,580 of 3,422) own ZERO properties — these
--     stubs are inflating the denominator. After filtering to owners that
--     actually own >= 1 property: 532 missing of 842 = 63.2% (real signal).
--   • salesforce_accounts (5,004 rows) has ZERO exact-name matches against
--     the 2,722 unlinked owners. The top 18 unlinked owners by prop count
--     (SMBC Leasing 104, Elliott Bay 65, Massmutual 57, Realty Income 25,
--     AR Global 24, Vereit 19, Healthcare Realty Trust 7, etc.) have
--     best-fuzzy-match similarity 0.23–0.55. The CRM account list is Scott's
--     prospecting contact book, NOT a universe of all property owners — so
--     these aren't a "missing link" bug, they're genuine BD targets.
--
-- This view powers a reframed "Unprospected Owners" widget: top-N owners
-- with property ownership but no SF account link, ordered by prop count.
-- It deliberately:
--   1. Filters out zero-property stubs (the noise that inflates the headline).
--   2. Excludes is_operator_not_owner=TRUE (these are tenant operators like
--      DaVita/Fresenius, not prospects we'd disposition properties for).
--   3. Exposes fields the prospect drawer will need (last_contact_date,
--      prospecting_status, last_sale_date, last_acquisition_date) so the
--      frontend can render a meaningful row without a second query.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_prospect_targets AS
SELECT
  t.true_owner_id,
  t.name,
  COUNT(oh.property_id)                          AS prop_count,
  t.state,
  t.is_developer,
  t.is_prospect,
  t.prospecting_status,
  t.last_contact_date,
  t.last_sale_date,
  t.last_acquisition_date,
  t.is_repeat_buyer,
  t.likely_to_sell,
  t.latest_note_summary
FROM public.true_owners t
JOIN public.ownership_history oh USING (true_owner_id)
WHERE t.salesforce_id IS NULL
  AND (t.is_operator_not_owner IS DISTINCT FROM TRUE)
GROUP BY t.true_owner_id
HAVING COUNT(oh.property_id) >= 1;

COMMENT ON VIEW public.v_prospect_targets IS
  'QA-25 (2026-05-18): owners with property ownership but no SF account link, suitable as BD prospect targets. Excludes zero-prop stubs and operator-only entities.';
