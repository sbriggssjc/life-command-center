-- ============================================================================
-- Item #4 Phase A (2026-05-17): propagation gap views + v_next_best_action (dia)
--
-- Surfaces every known un-propagated / un-researched gap on the dia DB as
-- a unified ranked queue. Each row carries (gap_type, gap_severity,
-- property_id, gap_label, suggested_action, gap_value, first_seen_at) so a
-- single Home rail UI can render them all without case-by-case logic.
--
-- Phase A sources (6):
--   1. missing_recorded_owner         — properties.recorded_owner_id IS NULL
--   2. llc_research_pending            — llc_research_queue.status = 'queued'
--   3. cms_chain_drift                 — medicare_clinics.chain_organization
--                                        disagrees with properties.tenant
--   4. lease_tenant_drift              — active lease tenant disagrees with
--                                        properties.tenant
--   5. orphan_sale_owner               — sales_transactions.recorded_owner_id
--                                        IS NULL where property has one
--   6. stale_active_listing            — available_listings.is_active = true
--                                        AND last_seen < now() - 90 days
--
-- Closes audit findings B-1 (the dia side of unified next-best-action queue),
-- B-3 (the dia side of value-weighted sort), B-13 (replaces the Home Research
-- pulse-card's wrong-table count once the UI lands in Phase B).
--
-- Already applied to dia (zqzrriwuavgrquhisnoa) at 2026-05-17 via Supabase
-- MCP. This file commits the migration to the repo as the historical record.
-- ============================================================================

-- ─── Propagation gap view 1: CMS chain organization drift ───────────────────
CREATE OR REPLACE VIEW public.v_gap_chain_drift AS
WITH normalized AS (
  SELECT
    p.property_id,
    p.tenant                                                  AS prop_tenant,
    mc.chain_organization                                     AS cms_chain,
    lower(regexp_replace(COALESCE(p.tenant, ''),
      '\b(inc|llc|llp|corp|corporation|co|ltd|inc\.|llc\.|corp\.)\b', '', 'gi'
    ))                                                        AS prop_norm,
    lower(regexp_replace(COALESCE(mc.chain_organization, ''),
      '\b(inc|llc|llp|corp|corporation|co|ltd|inc\.|llc\.|corp\.)\b', '', 'gi'
    ))                                                        AS cms_norm,
    p.current_value_estimate                                  AS property_value,
    p.priority_score
  FROM public.properties p
  JOIN public.medicare_clinics mc
    ON mc.medicare_id = p.linked_medicare_facility_id
  WHERE mc.chain_organization IS NOT NULL
)
SELECT
  property_id, prop_tenant, cms_chain, property_value, priority_score,
  CASE
    WHEN prop_tenant IS NULL                          THEN 'cms_chain_but_property_tenant_null'
    WHEN trim(prop_norm) = '' OR trim(cms_norm) = ''  THEN 'cms_or_property_blank'
    WHEN cms_norm = prop_norm                         THEN NULL
    WHEN cms_norm LIKE '%' || prop_norm || '%'
      OR prop_norm LIKE '%' || cms_norm || '%'        THEN NULL
    ELSE 'operator_transition_candidate'
  END AS drift_kind
FROM normalized
WHERE prop_norm IS DISTINCT FROM cms_norm
  AND (
    prop_tenant IS NULL
    OR (trim(prop_norm) <> '' AND trim(cms_norm) <> ''
        AND cms_norm NOT LIKE '%' || prop_norm || '%'
        AND prop_norm NOT LIKE '%' || cms_norm || '%')
  );

COMMENT ON VIEW public.v_gap_chain_drift IS
  'Properties where CMS-reported chain_organization disagrees with properties.tenant (audit A-13). Loose normalized match avoids cosmetic differences. drift_kind values: cms_chain_but_property_tenant_null, operator_transition_candidate.';

-- ─── Propagation gap view 2: lease tenant vs property tenant ────────────────
CREATE OR REPLACE VIEW public.v_gap_lease_tenant_drift AS
SELECT
  p.property_id,
  p.tenant                                                    AS prop_tenant,
  l.tenant                                                    AS lease_tenant,
  l.lease_id,
  l.is_active                                                 AS lease_is_active,
  p.current_value_estimate                                    AS property_value,
  l.annual_rent
FROM public.properties p
JOIN public.leases l ON l.property_id = p.property_id
WHERE l.is_active = true
  AND l.tenant IS NOT NULL
  AND length(trim(l.tenant)) > 1
  AND (
    p.tenant IS NULL
    OR lower(trim(p.tenant)) <> lower(trim(l.tenant))
  );

COMMENT ON VIEW public.v_gap_lease_tenant_drift IS
  'Properties where the active lease tenant disagrees with properties.tenant (audit A-7 dia side). Active lease is authoritative; properties.tenant should be back-filled.';

-- ─── Propagation gap view 3: sales_transactions missing recorded_owner_id ───
CREATE OR REPLACE VIEW public.v_gap_orphan_sale_owner AS
SELECT
  s.sale_id, s.property_id,
  p.recorded_owner_id                                         AS property_recorded_owner_id,
  ro.name                                                     AS owner_name,
  s.sale_date, s.sold_price,
  p.current_value_estimate                                    AS property_value
FROM public.sales_transactions s
JOIN public.properties p          ON p.property_id          = s.property_id
LEFT JOIN public.recorded_owners ro ON ro.recorded_owner_id  = p.recorded_owner_id
WHERE s.recorded_owner_id IS NULL
  AND p.recorded_owner_id IS NOT NULL
  AND s.sale_date > (CURRENT_DATE - interval '5 years');

COMMENT ON VIEW public.v_gap_orphan_sale_owner IS
  'Sales captured before the property had a known owner. Now writable via PATCH since recorded_owner_id column exists on both dia and gov (after audit Discovery #1).';

-- ─── v_next_best_action: unified ranked gap queue ───────────────────────────
-- Severity uses the same COALESCE(current_value_estimate, last_known_rent*10,
-- 0) signal as gap_value so a high-rent low-value-est property isn't mis-
-- labeled "low" while ranking at the top.
CREATE OR REPLACE VIEW public.v_next_best_action AS
WITH gaps AS (
  -- 1. missing_recorded_owner
  SELECT
    'missing_recorded_owner'::text                            AS gap_type,
    CASE
      WHEN COALESCE(p.current_value_estimate, p.last_known_rent * 10, 0) >= 10000000 THEN 'critical'::text
      WHEN COALESCE(p.current_value_estimate, p.last_known_rent * 10, 0) >=  5000000 THEN 'high'::text
      WHEN COALESCE(p.current_value_estimate, p.last_known_rent * 10, 0) >=  1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    p.property_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    p.property_id                                             AS property_id,
    COALESCE(p.address, 'property #' || p.property_id::text)  AS gap_label,
    'Research recorded owner for ' || COALESCE(p.address, 'property #' || p.property_id::text) AS suggested_action,
    (COALESCE(p.current_value_estimate, p.last_known_rent * 10, 1000000)::numeric) * 2.0 AS gap_value,
    COALESCE(p.updated_at, now())                             AS first_seen_at
  FROM public.properties p
  WHERE p.recorded_owner_id IS NULL

  UNION ALL

  -- 2. llc_research_pending
  SELECT
    'llc_research_pending'::text                              AS gap_type,
    CASE
      WHEN COALESCE(p.current_value_estimate, p.last_known_rent * 10, 0) >= 10000000 THEN 'high'::text
      WHEN COALESCE(p.current_value_estimate, p.last_known_rent * 10, 0) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    q.queue_id::text                                          AS gap_pk,
    q.recorded_owner_id::text                                 AS entity_pk,
    q.property_id                                             AS property_id,
    q.search_name                                             AS gap_label,
    'Research LLC manager/agent for ' || q.search_name        AS suggested_action,
    COALESCE(p.current_value_estimate, p.last_known_rent * 10, 1000000)::numeric AS gap_value,
    q.created_at                                              AS first_seen_at
  FROM public.llc_research_queue q
  LEFT JOIN public.properties p ON p.property_id = q.property_id
  WHERE q.status = 'queued'

  UNION ALL

  -- 3. cms_chain_drift
  SELECT
    ('cms_chain_drift:' || drift_kind)::text                  AS gap_type,
    CASE
      WHEN COALESCE(property_value, 0) >= 10000000 THEN 'high'::text
      WHEN COALESCE(property_value, 0) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    property_id::text                                         AS gap_pk,
    NULL::text                                                AS entity_pk,
    property_id                                               AS property_id,
    COALESCE(prop_tenant, '(no property tenant)') || ' vs CMS:' || cms_chain AS gap_label,
    CASE drift_kind
      WHEN 'cms_chain_but_property_tenant_null' THEN 'Back-fill property tenant from CMS chain: ' || cms_chain
      WHEN 'operator_transition_candidate'      THEN 'Verify operator transition: property says "' || prop_tenant || '", CMS says "' || cms_chain || '"'
      ELSE 'Resolve chain drift between property + CMS'
    END                                                       AS suggested_action,
    (COALESCE(property_value, 1000000)::numeric) * 1.5        AS gap_value,
    now()                                                     AS first_seen_at
  FROM public.v_gap_chain_drift
  WHERE drift_kind IS NOT NULL

  UNION ALL

  -- 4. lease_tenant_drift
  SELECT
    'lease_tenant_drift'::text                                AS gap_type,
    CASE
      WHEN COALESCE(property_value, annual_rent * 10, 0) >= 5000000 THEN 'high'::text
      WHEN COALESCE(property_value, annual_rent * 10, 0) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    lease_id::text                                            AS gap_pk,
    NULL::text                                                AS entity_pk,
    property_id                                               AS property_id,
    'Lease:' || lease_tenant || ' vs Property:' || COALESCE(prop_tenant, '(null)') AS gap_label,
    'Back-fill properties.tenant from active lease tenant'    AS suggested_action,
    (COALESCE(property_value, annual_rent * 10, 1000000)::numeric) * 1.2 AS gap_value,
    now()                                                     AS first_seen_at
  FROM public.v_gap_lease_tenant_drift

  UNION ALL

  -- 5. orphan_sale_owner
  SELECT
    'orphan_sale_owner'::text                                 AS gap_type,
    CASE
      WHEN COALESCE(sold_price, property_value, 0) >= 5000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    sale_id::text                                             AS gap_pk,
    property_recorded_owner_id::text                          AS entity_pk,
    property_id                                               AS property_id,
    'Sale ' || sale_date::text || ' missing owner backlink'   AS gap_label,
    'Back-link sale to recorded_owner: ' || COALESCE(owner_name, '(unknown)') AS suggested_action,
    (COALESCE(sold_price, property_value, 1000000)::numeric) * 0.8 AS gap_value,
    sale_date::timestamptz                                    AS first_seen_at
  FROM public.v_gap_orphan_sale_owner

  UNION ALL

  -- 6. stale_active_listing
  SELECT
    'stale_active_listing'::text                              AS gap_type,
    CASE
      WHEN COALESCE(al.last_price, al.initial_price, p.current_value_estimate, 0) >= 5000000 THEN 'high'::text
      WHEN COALESCE(al.last_price, al.initial_price, p.current_value_estimate, 0) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    al.listing_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    al.property_id                                            AS property_id,
    COALESCE(p.address, 'listing #' || al.listing_id::text) || ' (last seen ' ||
      to_char(COALESCE(al.last_seen, al.listing_date), 'YYYY-MM-DD') || ')' AS gap_label,
    'Re-verify listing status'                                AS suggested_action,
    COALESCE(al.last_price, al.initial_price, p.current_value_estimate, 1000000)::numeric AS gap_value,
    COALESCE(al.last_seen, al.listing_date, now())            AS first_seen_at
  FROM public.available_listings al
  LEFT JOIN public.properties p ON p.property_id = al.property_id
  WHERE al.is_active = true
    AND COALESCE(al.last_seen, al.listing_date) < (now() - interval '90 days')
)
SELECT
  ROW_NUMBER() OVER (ORDER BY gap_value DESC NULLS LAST, first_seen_at ASC) AS rank,
  gap_type, gap_severity, gap_pk, entity_pk, property_id,
  gap_label, suggested_action, gap_value, first_seen_at
FROM gaps;

COMMENT ON VIEW public.v_next_best_action IS
  'Unified ranked queue of every actionable data/research gap on dia. Closes audit B-1 / B-3 (dia side) and lays the foundation for B-13 (Home rail UI in Phase B). Phase A: 6 sources, 21k+ rows. Phase B: gov mirror + LCC Opps sources + backend endpoint + UI. Phase C: dismiss/resolve flow.';
