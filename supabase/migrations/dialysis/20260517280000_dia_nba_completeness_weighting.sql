-- ============================================================================
-- Item #6 Phase B-2 (dia, 2026-05-17): completeness-weighted NBA queue.
--
-- Multiplies the existing per-gap-type gap_value by a completeness factor
-- so "near-finished" records' open gaps rank higher than same-dollar gaps
-- on mostly-empty records.
--
-- Multipliers (CASE on properties.completeness_band):
--   excellent → 1.50x   good → 1.25x   fair → 1.00x   poor → 0.80x   NULL → 1.00x
--
-- API surface:
--   • gap_value         — now the weighted value (rank reflects this)
--   • raw_gap_value     — pre-weighting (preserved for transparency)
--   • completeness_band — exposed for UI hints
--   • completeness_score— precise score for sort tiebreaks
-- ============================================================================
CREATE OR REPLACE VIEW public.v_next_best_action AS
WITH gaps AS (
  SELECT
    'missing_recorded_owner'::text                            AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'critical'::text
      WHEN COALESCE(v.rev_value, 0) >=  5000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0) >=  1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    dedup.property_id::text                                   AS gap_pk,
    NULL::text                                                AS entity_pk,
    dedup.property_id                                         AS property_id,
    dedup.address ||
      CASE WHEN dedup.dup_count > 1
        THEN ' [' || dedup.dup_count || ' dup records]'
        ELSE '' END                                           AS gap_label,
    'Research recorded owner for ' || dedup.address ||
      CASE WHEN dedup.dup_count > 1
        THEN ' (consolidate ' || dedup.dup_count || ' duplicate property records first)'
        ELSE '' END                                           AS suggested_action,
    COALESCE(v.rev_value, 1000000)::numeric * 2.0             AS raw_gap_value,
    COALESCE(dedup.updated_at, now())                         AS first_seen_at
  FROM (
    SELECT p.*,
      count(*)     OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state) AS dup_count,
      row_number() OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state ORDER BY p.property_id) AS rn
    FROM public.properties p
    WHERE p.recorded_owner_id IS NULL
      AND p.address IS NOT NULL AND length(trim(p.address)) >= 8
      AND p.address ~  '^\d' AND p.address !~ '^[\d\s]+$'
      AND p.address NOT ILIKE 'property #%'
  ) dedup
  LEFT JOIN public.v_property_value_signal v ON v.property_id = dedup.property_id
  WHERE dedup.rn = 1

  UNION ALL

  SELECT 'llc_research_pending'::text,
    CASE WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high' WHEN COALESCE(v.rev_value, 0) >= 3000000 THEN 'medium' ELSE 'low' END,
    q.queue_id::text, q.recorded_owner_id::text, q.property_id, q.search_name,
    'Research LLC manager/agent for ' || q.search_name,
    COALESCE(v.rev_value, 1000000)::numeric, q.created_at
  FROM public.llc_research_queue q
  LEFT JOIN public.v_property_value_signal v ON v.property_id = q.property_id
  WHERE q.status = 'queued'

  UNION ALL

  SELECT ('cms_chain_drift:' || g.drift_kind)::text,
    CASE WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high' WHEN COALESCE(v.rev_value, 0) >= 3000000 THEN 'medium' ELSE 'low' END,
    g.property_id::text, NULL::text, g.property_id,
    COALESCE(g.prop_tenant, '(no property tenant)') || ' vs CMS:' || g.cms_chain,
    CASE g.drift_kind
      WHEN 'cms_chain_but_property_tenant_null' THEN 'Back-fill property tenant from CMS chain: ' || g.cms_chain
      WHEN 'operator_transition_candidate'      THEN 'Verify operator transition: property says "' || g.prop_tenant || '", CMS says "' || g.cms_chain || '"'
      ELSE 'Resolve chain drift between property + CMS'
    END,
    COALESCE(v.rev_value, 1000000)::numeric * 1.5, now()
  FROM public.v_gap_chain_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id
  WHERE g.drift_kind IS NOT NULL

  UNION ALL

  SELECT 'lease_tenant_drift'::text,
    CASE WHEN COALESCE(v.rev_value, g.annual_rent * 10, 0) >= 5000000 THEN 'high'
         WHEN COALESCE(v.rev_value, g.annual_rent * 10, 0) >= 1000000 THEN 'medium' ELSE 'low' END,
    g.lease_id::text, NULL::text, g.property_id,
    'Lease:' || g.lease_tenant || ' vs Property:' || COALESCE(g.prop_tenant, '(null)'),
    'Back-fill properties.tenant from active lease tenant',
    COALESCE(v.rev_value, g.annual_rent * 10, 1000000)::numeric * 1.2, now()
  FROM public.v_gap_lease_tenant_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

  UNION ALL

  SELECT 'orphan_sale_owner'::text,
    CASE WHEN COALESCE(g.sold_price, v.rev_value, 0) >= 5000000 THEN 'medium' ELSE 'low' END,
    g.sale_id::text, g.property_recorded_owner_id::text, g.property_id,
    'Sale ' || g.sale_date::text || ' missing owner backlink',
    'Back-link sale to recorded_owner: ' || COALESCE(g.owner_name, '(unknown)'),
    (COALESCE(g.sold_price, v.rev_value, 1000000)::numeric) * 0.8,
    g.sale_date::timestamptz
  FROM public.v_gap_orphan_sale_owner g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

  UNION ALL

  SELECT 'stale_active_listing'::text,
    CASE WHEN COALESCE(al.last_price, al.initial_price, v.rev_value, 0) >= 5000000 THEN 'high'
         WHEN COALESCE(al.last_price, al.initial_price, v.rev_value, 0) >= 1000000 THEN 'medium' ELSE 'low' END,
    al.listing_id::text, NULL::text, al.property_id,
    COALESCE(p.address, 'listing #' || al.listing_id::text) || ' (last seen ' ||
      to_char(COALESCE(al.last_seen, al.listing_date), 'YYYY-MM-DD') || ')',
    'Re-verify listing status',
    COALESCE(al.last_price, al.initial_price, v.rev_value, 1000000)::numeric,
    COALESCE(al.last_seen, al.listing_date, now())
  FROM public.available_listings al
  LEFT JOIN public.properties p ON p.property_id = al.property_id
  LEFT JOIN public.v_property_value_signal v ON v.property_id = al.property_id
  WHERE al.is_active = true AND COALESCE(al.last_seen, al.listing_date) < (now() - interval '90 days')
),
weighted AS (
  SELECT g.*, p.completeness_band, p.completeness_score,
    (g.raw_gap_value * CASE p.completeness_band
       WHEN 'excellent' THEN 1.50 WHEN 'good' THEN 1.25
       WHEN 'fair' THEN 1.00 WHEN 'poor' THEN 0.80 ELSE 1.00 END)::numeric AS weighted_gap_value
  FROM gaps g LEFT JOIN public.properties p ON p.property_id = g.property_id
)
SELECT
  ROW_NUMBER() OVER (ORDER BY weighted_gap_value DESC NULLS LAST, first_seen_at ASC) AS rank,
  gap_type, gap_severity, gap_pk, entity_pk, property_id,
  gap_label, suggested_action,
  weighted_gap_value AS gap_value,
  first_seen_at,
  raw_gap_value,
  completeness_band,
  completeness_score
FROM weighted;

COMMENT ON VIEW public.v_next_best_action IS
  'Item #6 Phase B-2 (2026-05-17): completeness-weighted NBA queue. '
  'gap_value is now completeness-weighted (excellent 1.5x, good 1.25x, '
  'fair 1.0x, poor 0.8x). raw_gap_value preserves pre-weighting figure. '
  'Ranking uses weighted_gap_value DESC.';
