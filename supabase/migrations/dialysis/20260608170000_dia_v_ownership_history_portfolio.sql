-- R11 Unit 1 (2026-06-08): dia ownership-history portfolio view — closes the
-- value-ranking integrity gap (the priority queue ranks on current_annual_rent_
-- total, which was $0 on ALL 887 current dia portfolio edges because the dia
-- portfolio sync pulled the RAW dia.ownership_history table and read its `rent`
-- column — NULL on all 7,772 rows, no writer ever populated it).
--
-- dia rent actually lives in leases.annual_rent, projected to CURRENT_DATE per
-- the dia rent doctrine (anchor rent + dia_project_rent_at_date). This view
-- mirrors the gov anon-readable pattern (gov.v_ownership_history_portfolio,
-- 20260522230000) and JOINS the projected lease rent onto each ownership edge so
-- LCC's portfolio sync gains a real rank value.
--
-- Column contract: mirrors the gov view (true_owner_id, property_id,
-- transfer_date, sale_price, cap_rate, data_source) PLUS:
--   - annual_rent       — the property's PRIMARY lease rent, projected to
--                         CURRENT_DATE (the whole point of this round).
--   - ownership_end_date — dia ownership_history carries EXPLICIT start/end
--                         dates (unlike gov's transfer-event model). 44% of dia
--                         rows have a NULL transfer_date, so the gov "latest
--                         transfer = current" window heuristic would misclassify
--                         current vs former here. We keep dia's explicit-end
--                         semantics intact (the LCC dia finalize branch reads
--                         this column), so this round ONLY adds rent — it does
--                         NOT reclassify any edge as current/former.
--
-- PRIMARY-LEASE PICK (multi-active-lease properties, 40 of them): active lease
-- preferred, then largest leased_area, then most recent lease_start. Mirrors the
-- v_sales_comps anchor selection (is_active DESC, ... DESC).
--
-- RENT PROJECTION: identical math to public.v_sales_comps
-- (20260529190000) — anchor = confirmed properties.anchor_rent when
-- anchor_rent_source IN ('lease_confirmed','om_confirmed'), else leases.annual_
-- rent, else leases.rent; projected from lease_start to CURRENT_DATE via
-- public.dia_project_rent_at_date with the property's lease_bump_pct /
-- lease_bump_interval_mo (defaults 0.02 / 12). Reuses the SQL helper — does NOT
-- reinvent the projection.
--
-- PII posture: NAMES/IDS ONLY — true_owner_id (UUID), property_id, dates,
-- prices, rent, cap_rate, data_source. No contact PII, no tenant/operator. Plain
-- (definer-privilege) view so anon can read it while ownership_history / leases /
-- properties stay RLS-protected (mirrors the gov view + true_owners exposure).
--
-- DEPLOY ORDERING: apply this BEFORE the LCC portfolio-sync repoint
-- (lcc 20260608170000), which selects these columns over PostgREST. If the LCC
-- sync fires before this view exists it simply 404s that page — graceful, the
-- dia mirror keeps its pre-round (rent-less) values until this lands.

BEGIN;

DROP VIEW IF EXISTS public.v_ownership_history_portfolio;

CREATE VIEW public.v_ownership_history_portfolio AS
SELECT
  oh.ownership_id,
  oh.property_id,
  oh.true_owner_id,
  COALESCE(oh.ownership_start, oh.start_date) AS transfer_date,
  COALESCE(oh.ownership_end,   oh.end_date)   AS ownership_end_date,
  oh.sold_price                                AS sale_price,
  oh.cap_rate,
  proj.rent_now                                AS annual_rent,
  oh.ownership_source                          AS data_source,
  oh.ownership_type                            AS change_type
FROM public.ownership_history oh
JOIN public.properties p ON p.property_id = oh.property_id
LEFT JOIN LATERAL (
  SELECT l.lease_start, l.annual_rent, l.rent
  FROM public.leases l
  WHERE l.property_id = oh.property_id
  ORDER BY l.is_active DESC NULLS LAST,
           l.leased_area DESC NULLS LAST,
           l.lease_start DESC NULLS LAST
  LIMIT 1
) l ON true
LEFT JOIN LATERAL (
  SELECT public.dia_project_rent_at_date(
    COALESCE(
      CASE WHEN p.anchor_rent_source IN ('lease_confirmed','om_confirmed')
           THEN p.anchor_rent END,
      l.annual_rent, l.rent),
    l.lease_start, CURRENT_DATE,
    COALESCE(p.lease_bump_pct, 0.02), COALESCE(p.lease_bump_interval_mo, 12)
  ) AS rent_now
) proj ON true
WHERE oh.true_owner_id IS NOT NULL;

GRANT SELECT ON public.v_ownership_history_portfolio TO anon, authenticated;

COMMENT ON VIEW public.v_ownership_history_portfolio IS
  'Non-PII slice of dia ownership_history for LCC portfolio sync, with the '
  'property''s primary-lease rent projected to CURRENT_DATE joined as '
  'annual_rent (R11 Unit 1). Mirrors gov.v_ownership_history_portfolio; adds '
  'ownership_end_date because dia uses explicit start/end dates (not gov''s '
  'transfer-event window). Plain (definer-privilege) view so anon can read '
  'while ownership_history / leases / properties stay RLS-protected.';

COMMIT;
