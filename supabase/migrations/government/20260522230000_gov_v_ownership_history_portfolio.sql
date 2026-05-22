-- Topic A3: expose a slim, anon-readable ownership_history view for LCC
-- portfolio sync.
--
-- gov.ownership_history has RLS blocking anon SELECT (good — it contains
-- contact PII in columns like recorded_owner_phone, true_owner_address,
-- principal_names, research_notes). LCC needs the non-PII ownership edges
-- (true_owner_id, property_id, transfer_date, sale_price, cap_rate,
-- annual_rent) for the v_entity_portfolio_all view it ships in §11.23.
--
-- This view exposes only those non-PII columns and grants SELECT to anon.
-- It mirrors the existing pattern used for true_owners (which already has
-- an anon_read policy for the same cross-database use case).

BEGIN;

-- NOTE: deliberately NOT using security_invoker = true here. With invoker
-- semantics the view would honor the caller's RLS, which blocks anon on the
-- underlying ownership_history. The view itself is the security boundary —
-- it strips PII columns — so we accept the default SECURITY DEFINER
-- semantics, which lets anon read the safe slice while leaving
-- ownership_history itself fully RLS-protected.
DROP VIEW IF EXISTS public.v_ownership_history_portfolio;

CREATE VIEW public.v_ownership_history_portfolio AS
SELECT
  ownership_id,
  property_id,
  true_owner_id,
  transfer_date,
  transfer_price,
  sale_price,
  annual_rent,
  cap_rate,
  data_source,
  change_type
FROM public.ownership_history
WHERE true_owner_id IS NOT NULL;

GRANT SELECT ON public.v_ownership_history_portfolio TO anon, authenticated;

COMMENT ON VIEW public.v_ownership_history_portfolio IS
  'Non-PII slice of ownership_history for LCC cross-vertical portfolio sync. '
  'Mirrors the anon-read pattern already used for public.true_owners. PII '
  'columns (phone/address/principal_names/research_notes) are intentionally '
  'omitted. SECURITY DEFINER (default) so anon can read it while underlying '
  'ownership_history stays RLS-protected.';

COMMIT;
