-- ============================================================================
-- QA-25 (2026-05-18, gov): v_prospect_targets — unprospected owners by prop count.
--
-- The gov home dashboard's "Missing SF Link" widget reports 97% (13,675 of
-- 14,106). QA-25 audit found:
--   • 6,303 of those 13,675 (46%) own ZERO properties — these stubs inflate
--     the denominator. After filtering to owners with >= 1 property: 7,372
--     missing of 7,495 = 98.4% (real signal, not a bug — there's no
--     salesforce_accounts table on gov to match against).
--   • Top unlinked owners by prop count (Boyd Watterson Global 31, Wise
--     Developments 31, Prologis L.P. 24, Highwoods Realty 21, GPT Properties
--     Trust 16, etc.) are genuine BD targets that Scott hasn't entered into
--     SF yet — NOT a data-quality issue.
--
-- This view powers a reframed "Unprospected Owners" widget: top-N owners
-- with property ownership but no SF account link, ordered by prop count.
-- It filters out zero-property stubs so the dashboard surfaces actionable
-- prospects rather than noise.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_prospect_targets AS
SELECT
  t.true_owner_id,
  t.name,
  COUNT(oh.property_id) AS prop_count,
  t.state,
  t.entity_type,
  t.canonical_name
FROM public.true_owners t
JOIN public.ownership_history oh USING (true_owner_id)
WHERE t.sf_account_id IS NULL
GROUP BY t.true_owner_id
HAVING COUNT(oh.property_id) >= 1;

COMMENT ON VIEW public.v_prospect_targets IS
  'QA-25 (2026-05-18): owners with property ownership but no SF account link, suitable as BD prospect targets. Excludes zero-prop stubs.';
