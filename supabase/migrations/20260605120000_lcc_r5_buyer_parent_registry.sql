-- R5 (2026-06-05): SPE->parent reconciliation + buyer-vs-prospect doctrine.
-- File A of two — the buyer-parent REGISTRY + classification (read-only,
-- additive). File B (20260605120500) carries the open-time GATE + queue lane.
--
-- Doctrine (Scott, grounded against live data 2026-06-05):
--   * One buyer, one account. SPE shells controlled by the same parent buyer
--     reconcile to the PARENT — never several open opportunities across SPEs.
--   * Top repeat buyers do NOT get standard prospect opportunities. They are
--     buy-side relationships (showings + buy-side outreach). At most a
--     "Government Buyer" opportunity sits on the PARENT account.
--   * SPE->parent reconciliation is a GATE that runs BEFORE opening.
--
-- This file EXTENDS the existing operator-affiliate machinery (does not fork
-- it): adds a `relationship` discriminator to lcc_operator_affiliate_patterns,
-- registers the verified repeat-buyer parents + their SPE-name prefix patterns,
-- and ships the inspectable classification views. The three pre-existing
-- OPERATOR consumers of the pattern table are re-scoped to relationship =
-- 'operator' so buyer patterns can't corrupt operator concentration / sale-
-- leaseback logic.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. relationship discriminator on the shared pattern table
-- ---------------------------------------------------------------------------
ALTER TABLE public.lcc_operator_affiliate_patterns
  ADD COLUMN IF NOT EXISTS relationship text NOT NULL DEFAULT 'operator';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_affiliate_pattern_relationship'
      AND conrelid = 'public.lcc_operator_affiliate_patterns'::regclass
  ) THEN
    ALTER TABLE public.lcc_operator_affiliate_patterns
      ADD CONSTRAINT chk_affiliate_pattern_relationship
      CHECK (relationship IN ('operator','buyer_parent'));
  END IF;
END $$;

COMMENT ON COLUMN public.lcc_operator_affiliate_patterns.relationship IS
  'operator = subsidiary brand of an OPERATOR (DaVita/Fresenius...). '
  'buyer_parent = SPE shell of a repeat BUYER (Boyd Watterson/NGP...). '
  'Operator views filter relationship=''operator''; the buyer gate reads '
  '''buyer_parent''. (R5, 2026-06-05)';

-- ---------------------------------------------------------------------------
-- 2. Re-scope the three OPERATOR consumers to relationship='operator'
--    (only views that touch the pattern table — verified via pg_depend).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_operator_affiliates
WITH (security_invoker = true) AS
SELECT e.id AS affiliate_entity_id,
    e.name AS affiliate_name,
    e.canonical_name AS affiliate_canonical_name,
    e.owner_role AS affiliate_owner_role,
    e.domain AS affiliate_domain,
    ( SELECT count(*) FROM public.lcc_entity_portfolio_facts f
       WHERE f.entity_id = e.id) AS affiliate_portfolio_size,
    p.parent_entity_id,
    parent.name AS parent_name,
    parent.owner_role AS parent_owner_role,
    p.pattern_id,
    p.pattern_name,
    p.pattern_type
   FROM public.entities e
     JOIN public.lcc_operator_affiliate_patterns p
       ON COALESCE(p.relationship,'operator') = 'operator'
      AND CASE p.pattern_type
            WHEN 'exact'    THEN lower(e.name) = lower(p.pattern_name)
            WHEN 'prefix'   THEN lower(e.name) LIKE lower(p.pattern_name)
            WHEN 'contains' THEN lower(e.name) LIKE ('%'::text || lower(p.pattern_name) || '%'::text)
            WHEN 'regex'    THEN e.name ~* p.pattern_name
            ELSE NULL::boolean
          END
     JOIN public.entities parent ON parent.id = p.parent_entity_id
  WHERE e.entity_type = 'organization'::entity_type
    AND e.merged_into_entity_id IS NULL
    AND e.id <> p.parent_entity_id;

CREATE OR REPLACE VIEW public.v_lcc_operator_effective_portfolio
WITH (security_invoker = true) AS
WITH operator_parents AS (
  SELECT DISTINCT parent_entity_id
  FROM public.lcc_operator_affiliate_patterns
  WHERE COALESCE(relationship,'operator') = 'operator'
),
distinct_affiliates AS (
  SELECT DISTINCT affiliate_entity_id, parent_entity_id
  FROM public.v_lcc_operator_affiliates
),
membership AS (
  SELECT op.parent_entity_id, op.parent_entity_id AS member_entity_id
  FROM operator_parents op
  UNION
  SELECT da.parent_entity_id, da.affiliate_entity_id AS member_entity_id
  FROM distinct_affiliates da
),
per_member_stats AS (
  SELECT m.parent_entity_id, m.member_entity_id,
    (SELECT COUNT(*) FROM public.lcc_entity_portfolio_facts f
       WHERE f.entity_id = m.member_entity_id) AS member_total,
    (SELECT COUNT(*) FROM public.lcc_entity_portfolio_facts f
       WHERE f.entity_id = m.member_entity_id AND f.is_current = true) AS member_current
  FROM membership m
)
SELECT parent.id AS parent_entity_id,
  parent.name AS parent_name,
  parent.owner_role AS parent_owner_role,
  parent.domain AS parent_domain,
  COUNT(DISTINCT pms.member_entity_id) AS member_count,
  SUM(pms.member_total)::int AS effective_total_property_count,
  SUM(pms.member_current)::int AS effective_current_property_count,
  array_agg(DISTINCT en.name ORDER BY en.name) AS member_names,
  array_agg(DISTINCT pms.member_entity_id ORDER BY pms.member_entity_id) AS member_entity_ids
FROM per_member_stats pms
JOIN public.entities parent ON parent.id = pms.parent_entity_id
JOIN public.entities en ON en.id = pms.member_entity_id
WHERE parent.merged_into_entity_id IS NULL
GROUP BY parent.id, parent.name, parent.owner_role, parent.domain;

-- v_lcc_listing_event_queue: the two "seller/buyer IS itself an operator
-- parent" EXISTS probes must also exclude buyer_parent rows.
CREATE OR REPLACE VIEW public.v_lcc_listing_event_queue
WITH (security_invoker = true) AS
SELECT
  e.event_id, e.source_domain, e.source_property_id, e.source_event_id,
  e.event_date, e.sale_price, e.buyer_name, e.seller_name, e.cap_rate,
  e.data_source, e.detected_at, e.processed_at,
  EXTRACT(day FROM now() - e.detected_at)::int AS days_since_detected,
  pa.address    AS property_address,
  pa.city       AS property_city,
  pa.state      AS property_state,
  pa.building_size_sqft,
  pa.year_built,
  pa.latitude, pa.longitude,
  seller.id     AS seller_entity_id,
  seller.name   AS seller_entity_name,
  seller.owner_role AS seller_owner_role,
  buyer.id      AS buyer_entity_id,
  buyer.name    AS buyer_entity_name,
  buyer.owner_role AS buyer_owner_role,
  seller_op.parent_entity_id AS seller_operator_parent_id,
  seller_op.parent_name      AS seller_operator_parent_name,
  buyer_op.parent_entity_id  AS buyer_operator_parent_id,
  buyer_op.parent_name       AS buyer_operator_parent_name,
  (
    seller_op.parent_entity_id IS NOT NULL
    AND (buyer_op.parent_entity_id IS NULL
         OR buyer_op.parent_entity_id <> seller_op.parent_entity_id)
  ) AS is_sale_leaseback
FROM public.lcc_listing_events e
LEFT JOIN public.lcc_property_attributes pa
  ON pa.source_domain = e.source_domain AND pa.source_property_id = e.source_property_id
LEFT JOIN LATERAL (
  SELECT en.id, en.name, en.owner_role
  FROM public.lcc_entity_portfolio_facts f
  JOIN public.entities en ON en.id = f.entity_id AND en.merged_into_entity_id IS NULL
  WHERE f.source_domain = e.source_domain
    AND f.source_property_id = e.source_property_id
    AND f.ownership_end_date IS NOT NULL
  ORDER BY f.ownership_end_date DESC LIMIT 1
) seller ON true
LEFT JOIN LATERAL (
  SELECT en.id, en.name, en.owner_role
  FROM public.lcc_entity_portfolio_facts f
  JOIN public.entities en ON en.id = f.entity_id AND en.merged_into_entity_id IS NULL
  WHERE f.source_domain = e.source_domain
    AND f.source_property_id = e.source_property_id
    AND f.is_current = true
  ORDER BY f.ownership_start_date DESC NULLS LAST LIMIT 1
) buyer ON true
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (1) a.parent_entity_id, a.parent_name
  FROM public.v_lcc_operator_affiliates a
  WHERE a.affiliate_entity_id = seller.id
  ORDER BY 1, a.pattern_type LIMIT 1
) seller_op_affiliate ON true
LEFT JOIN LATERAL (
  SELECT seller.id AS parent_entity_id, seller.name AS parent_name
  WHERE seller.id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.lcc_operator_affiliate_patterns p
                WHERE p.parent_entity_id = seller.id
                  AND COALESCE(p.relationship,'operator') = 'operator')
) seller_op_self ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(seller_op_self.parent_entity_id, seller_op_affiliate.parent_entity_id) AS parent_entity_id,
    COALESCE(seller_op_self.parent_name,      seller_op_affiliate.parent_name)      AS parent_name
) seller_op ON true
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (1) a.parent_entity_id, a.parent_name
  FROM public.v_lcc_operator_affiliates a
  WHERE a.affiliate_entity_id = buyer.id
  ORDER BY 1, a.pattern_type LIMIT 1
) buyer_op_affiliate ON true
LEFT JOIN LATERAL (
  SELECT buyer.id AS parent_entity_id, buyer.name AS parent_name
  WHERE buyer.id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.lcc_operator_affiliate_patterns p
                WHERE p.parent_entity_id = buyer.id
                  AND COALESCE(p.relationship,'operator') = 'operator')
) buyer_op_self ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(buyer_op_self.parent_entity_id, buyer_op_affiliate.parent_entity_id) AS parent_entity_id,
    COALESCE(buyer_op_self.parent_name,      buyer_op_affiliate.parent_name)      AS parent_name
) buyer_op ON true;

-- ---------------------------------------------------------------------------
-- 3. lcc_buyer_parents — SF parent-account routing map (one row per parent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_buyer_parents (
  parent_entity_id  uuid PRIMARY KEY REFERENCES public.entities(id) ON DELETE CASCADE,
  domain            text,
  sf_account_id     text,
  sf_account_name   text,
  needs_sf_mapping  boolean NOT NULL DEFAULT true,
  confirmed_by      uuid,
  confirmed_at      timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lcc_buyer_parents IS
  'Registry of repeat-buyer PARENT accounts. A Government Buyer opportunity '
  'and all SF routing target parent_entity_id ONLY, never a subsidiary SPE. '
  'sf_account_id NULL => the open-path creates a research task and the '
  'opportunity sync holds. (R5, 2026-06-05)';

-- ---------------------------------------------------------------------------
-- 4. Seed parents + SPE-name prefix patterns. Resolves the canonical parent
--    entity by lookup (reusing the cleanest existing org), else creates it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_ws uuid;
  rec record;
  v_parent uuid;
  pat text;
BEGIN
  SELECT workspace_id INTO v_ws
  FROM public.entities
  WHERE entity_type = 'organization' AND merged_into_entity_id IS NULL
  GROUP BY workspace_id ORDER BY count(*) DESC LIMIT 1;

  FOR rec IN
    SELECT * FROM (VALUES
      -- canonical_name, domain, parent_lookup (NULL=create-only), prefix_patterns
      ('Boyd Watterson','gov','Boyd Watterson%', ARRAY['boyd watterson%','boyd watterson global%','boyd %']),
      ('NGP Capital','gov','NGP Capital%', ARRAY['ngp %','ngp capital%','national government properties%']),
      ('Easterly Government Properties','gov','Easterly Government Properties%', ARRAY['easterly%','egp %']),
      ('Elman Investors','gov','Elman Investors%', ARRAY['elman %']),
      ('Tanenbaum Equity Partners','gov','Tanenbaum Equity Partners%', ARRAY['tanenbaum%','gardner-tan%','gardner tanenbaum%','gardner-tanenbaum%']),
      ('CoreCivic','gov','CoreCivic%', ARRAY['corecivic%','core civic%']),
      ('Saban Capital Group','gov','Saban Capital Group%', ARRAY['saban %','saban real estate%']),
      ('Government Properties Income Trust','gov','Government Properties Income Trust%', ARRAY['gpt %','gpt properties%','government properties income trust%']),
      ('HC Government Realty Trust','gov','HC Government Realty%', ARRAY['hc government realty%']),
      ('RMR Group','gov','RMR Group%', ARRAY['rmr %','rmr group%']),
      ('UIRC (Urban Investment Research Corp)','gov',NULL, ARRAY['uirc%','uirc-gsa%','urban investment research%']),
      ('US Federal Properties Trust','gov',NULL, ARRAY['us federal properties%','u s federal properties%','usfp %']),
      ('USGBF (sponsor unconfirmed)','gov',NULL, ARRAY['usgbf%']),
      ('Elliott Bay Capital','dia','Elliott Bay Capital%', ARRAY['elliott bay%']),
      ('SMBC Leasing & Finance','dia','SMBC Leasing%', ARRAY['smbc %','smbc leasing%','sumitomo%']),
      ('MassMutual','dia','Massmutual%', ARRAY['massmutual%','mass mutual%']),
      ('ExchangeRight','dia','Exchangeright%', ARRAY['exchangeright%','exchange right%']),
      ('AR Global','dia','Ar Global%', ARRAY['ar global%','american finance trust%','american realty capital%']),
      ('Kingsbarn Realty','dia','Kingsbarn%', ARRAY['kingsbarn%']),
      ('AEI Capital','dia','AEI Capital%', ARRAY['aei %','aei net lease%','aei healthcare%','aei income%','aei accredited%']),
      ('Realty Income','dia','Realty Income Corp%', ARRAY['realty income%']),
      ('Agree Realty','dia','Agree Realty%', ARRAY['agree realty%']),
      ('Platform Ventures','dia','Platform Ventures%', ARRAY['platform ventures%']),
      ('Capital Square 1031','dia','Capital Square 1031%', ARRAY['capital square%'])
    ) AS t(canonical_name, domain, parent_lookup, prefix_patterns)
  LOOP
    v_parent := NULL;
    IF rec.parent_lookup IS NOT NULL THEN
      SELECT e.id INTO v_parent
      FROM public.entities e
      LEFT JOIN (SELECT entity_id, count(*) c FROM public.lcc_entity_portfolio_facts GROUP BY 1) pf
        ON pf.entity_id = e.id
      WHERE e.entity_type = 'organization' AND e.merged_into_entity_id IS NULL
        AND e.name ILIKE rec.parent_lookup
      ORDER BY COALESCE(pf.c,0) DESC, e.created_at ASC
      LIMIT 1;
    END IF;

    IF v_parent IS NULL THEN
      INSERT INTO public.entities
        (workspace_id, entity_type, name, canonical_name, domain,
         owner_role, owner_role_source, developer_flag_sources, metadata)
      VALUES
        (v_ws, 'organization', rec.canonical_name, lower(trim(rec.canonical_name)), rec.domain,
         'buyer', 'manual', '[]'::jsonb,
         jsonb_build_object('buyer_parent', true, 'seeded_by', 'R5'))
      RETURNING id INTO v_parent;
    END IF;

    INSERT INTO public.lcc_buyer_parents (parent_entity_id, domain, needs_sf_mapping, notes)
    VALUES (v_parent, rec.domain, true,
            CASE WHEN rec.canonical_name LIKE 'USGBF%'
                 THEN 'Sponsor unconfirmed — Scott to confirm the true controlling parent before SF routing.'
                 ELSE NULL END)
    ON CONFLICT (parent_entity_id) DO NOTHING;

    FOREACH pat IN ARRAY rec.prefix_patterns LOOP
      INSERT INTO public.lcc_operator_affiliate_patterns
        (parent_entity_id, pattern_name, pattern_type, relationship, notes)
      VALUES (v_parent, pat, 'prefix', 'buyer_parent', 'R5 buyer-parent SPE prefix')
      ON CONFLICT (parent_entity_id, pattern_name, pattern_type)
        DO UPDATE SET relationship = 'buyer_parent';
    END LOOP;
  END LOOP;
END $$;

-- Prefill SF parent-account ids where an (salesforce, Account) identity is
-- already linked to the parent entity. Leaves needs_sf_mapping=true otherwise.
UPDATE public.lcc_buyer_parents bp
SET sf_account_id = sub.external_id,
    sf_account_name = sub.entity_name,
    needs_sf_mapping = false,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (ei.entity_id) ei.entity_id, ei.external_id, e.name AS entity_name
  FROM public.external_identities ei
  JOIN public.entities e ON e.id = ei.entity_id
  WHERE ei.source_system = 'salesforce' AND ei.source_type = 'Account'
  ORDER BY ei.entity_id, ei.created_at ASC
) sub
WHERE sub.entity_id = bp.parent_entity_id;

-- ---------------------------------------------------------------------------
-- 5. Classification views (inspectable BEFORE the gate references them)
-- ---------------------------------------------------------------------------

-- All entities that ARE a buyer-SPE (or the parent itself), with the tier that
-- caught them. parent_self lets the gate also block the parent from prospecting.
CREATE OR REPLACE VIEW public.v_lcc_buyer_spe_entities
WITH (security_invoker = true) AS
-- Tier 0: the parent itself
SELECT bp.parent_entity_id AS entity_id,
       bp.parent_entity_id AS parent_entity_id,
       pe.name             AS parent_name,
       'parent_self'::text AS match_tier
FROM public.lcc_buyer_parents bp
JOIN public.entities pe ON pe.id = bp.parent_entity_id
UNION
-- Tier 1: entity name prefix-matches a buyer_parent pattern
SELECT e.id, p.parent_entity_id, parent.name, 'prefix'::text
FROM public.entities e
JOIN public.lcc_operator_affiliate_patterns p
  ON p.relationship = 'buyer_parent'
 AND CASE p.pattern_type
       WHEN 'exact'    THEN lower(e.name) = lower(p.pattern_name)
       WHEN 'prefix'   THEN lower(e.name) LIKE lower(p.pattern_name)
       WHEN 'contains' THEN lower(e.name) LIKE ('%' || lower(p.pattern_name) || '%')
       ELSE NULL::boolean
     END
JOIN public.entities parent ON parent.id = p.parent_entity_id
WHERE e.entity_type = 'organization'
  AND e.merged_into_entity_id IS NULL
  AND e.id <> p.parent_entity_id
UNION
-- Tier 2 (empirical): the entity's current portfolio property's latest sale
-- lists a registered parent as the buyer.
SELECT e.id, par_p.parent_entity_id, parent.name, 'empirical_portfolio'::text
FROM public.entities e
JOIN public.lcc_entity_portfolio_facts f
  ON f.entity_id = e.id AND f.is_current = true
JOIN LATERAL (
  SELECT le.buyer_name
  FROM public.lcc_listing_events le
  WHERE le.source_domain = f.source_domain
    AND le.source_property_id = f.source_property_id
    AND le.buyer_name IS NOT NULL
  ORDER BY le.event_date DESC NULLS LAST LIMIT 1
) lev ON true
JOIN public.lcc_operator_affiliate_patterns par_p
  ON par_p.relationship = 'buyer_parent'
 AND CASE par_p.pattern_type
       WHEN 'exact'    THEN lower(lev.buyer_name) = lower(par_p.pattern_name)
       WHEN 'prefix'   THEN lower(lev.buyer_name) LIKE lower(par_p.pattern_name)
       WHEN 'contains' THEN lower(lev.buyer_name) LIKE ('%' || lower(par_p.pattern_name) || '%')
       ELSE NULL::boolean
     END
JOIN public.entities parent ON parent.id = par_p.parent_entity_id
WHERE e.entity_type = 'organization'
  AND e.merged_into_entity_id IS NULL
  AND e.id <> par_p.parent_entity_id;

-- One row per buyer-SPE (best tier), with names — drives the audit + gate.
CREATE OR REPLACE VIEW public.v_lcc_buyer_spe_candidates
WITH (security_invoker = true) AS
SELECT DISTINCT ON (s.entity_id)
  s.entity_id,
  e.name   AS entity_name,
  e.domain AS entity_domain,
  s.parent_entity_id,
  s.parent_name,
  s.match_tier
FROM public.v_lcc_buyer_spe_entities s
JOIN public.entities e ON e.id = s.entity_id
WHERE s.match_tier <> 'parent_self'
ORDER BY s.entity_id,
  CASE s.match_tier WHEN 'prefix' THEN 1 WHEN 'empirical_portfolio' THEN 2 ELSE 3 END;

-- Parent rollup: SPE portfolio rolled up under the parent for the P-BUYER lane.
CREATE OR REPLACE VIEW public.v_lcc_buyer_parent_rollup
WITH (security_invoker = true) AS
WITH members AS (
  SELECT DISTINCT parent_entity_id, entity_id FROM public.v_lcc_buyer_spe_entities
)
SELECT
  bp.parent_entity_id,
  pe.name   AS parent_name,
  bp.domain,
  count(DISTINCT m.entity_id) FILTER (WHERE m.entity_id <> bp.parent_entity_id) AS spe_count,
  COALESCE(count(*) FILTER (WHERE f.is_current = true), 0)            AS rollup_property_count,
  COALESCE(sum(f.annual_rent) FILTER (WHERE f.is_current = true), 0)  AS rollup_annual_rent,
  max(f.ownership_start_date)                                         AS last_acquisition_date,
  bp.sf_account_id,
  bp.needs_sf_mapping,
  EXISTS (SELECT 1 FROM public.bd_opportunities o
          WHERE o.entity_id = bp.parent_entity_id
            AND o.type = 'government_buyer' AND o.is_open = true) AS has_open_gov_buyer_opp
FROM public.lcc_buyer_parents bp
JOIN public.entities pe ON pe.id = bp.parent_entity_id
LEFT JOIN members m ON m.parent_entity_id = bp.parent_entity_id
LEFT JOIN public.lcc_entity_portfolio_facts f ON f.entity_id = m.entity_id
GROUP BY bp.parent_entity_id, pe.name, bp.domain, bp.sf_account_id, bp.needs_sf_mapping;

-- Item 5: buyer-name fragmentation normalizer for analytics rollups
-- (maps every historical buyer-name spelling -> its canonical parent).
CREATE OR REPLACE VIEW public.v_lcc_buyer_name_canonical
WITH (security_invoker = true) AS
SELECT DISTINCT
  le.source_domain,
  le.buyer_name      AS raw_buyer_name,
  parent.id          AS parent_entity_id,
  parent.name        AS canonical_buyer_name
FROM public.lcc_listing_events le
JOIN public.lcc_operator_affiliate_patterns p
  ON p.relationship = 'buyer_parent'
 AND CASE p.pattern_type
       WHEN 'exact'    THEN lower(le.buyer_name) = lower(p.pattern_name)
       WHEN 'prefix'   THEN lower(le.buyer_name) LIKE lower(p.pattern_name)
       WHEN 'contains' THEN lower(le.buyer_name) LIKE ('%' || lower(p.pattern_name) || '%')
       ELSE NULL::boolean
     END
JOIN public.entities parent ON parent.id = p.parent_entity_id
WHERE le.buyer_name IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Resolver — does an entity reconcile to a buyer parent? (gate feedstock)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_resolve_buyer_parent(p_entity_id uuid)
RETURNS TABLE(parent_entity_id uuid, parent_name text, match_tier text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT bp.parent_entity_id, pe.name, 'parent_self'::text
  FROM public.lcc_buyer_parents bp
  JOIN public.entities pe ON pe.id = bp.parent_entity_id
  WHERE bp.parent_entity_id = p_entity_id
  UNION ALL
  SELECT s.parent_entity_id, s.parent_name, s.match_tier
  FROM public.v_lcc_buyer_spe_candidates s
  WHERE s.entity_id = p_entity_id
  LIMIT 1;
$$;

GRANT SELECT ON public.v_lcc_buyer_spe_entities,
                public.v_lcc_buyer_spe_candidates,
                public.v_lcc_buyer_parent_rollup,
                public.v_lcc_buyer_name_canonical TO authenticated;
GRANT SELECT ON public.lcc_buyer_parents TO authenticated;

COMMIT;
