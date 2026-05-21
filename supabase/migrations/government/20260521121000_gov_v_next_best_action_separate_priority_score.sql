-- ============================================================================
-- Deal-value reconciliation (2026-05-21): separate displayed property value
-- from the priority ranking score in v_next_best_action.
--
-- Before this change, gap_value was rev_value × gap-type-weight (0.8 to 2.0)
-- × completeness-band-weight (0.8 to 1.5). The Home rail UI rendered it
-- with a "$" sign as if it were the property value, so a $300M property
-- with a critical missing-recorded-owner gap and excellent completeness
-- displayed as $900M.
--
-- After this change:
--   gap_value           = rev_value (the property value; what UI displays)
--   gap_priority_score  = rev_value × gap-type-weight × completeness-weight
--                         (used to ORDER the queue; not displayed)
--   raw_gap_value       = rev_value × gap-type-weight
--                         (existing; pre-completeness multiplier)
--
-- The view's ROW_NUMBER() now orders by gap_priority_score DESC so the
-- highest-value AND highest-quality gaps still rise to the top; only the
-- displayed dollar figure changes.
--
-- Companion to 20260521120000_gov_v_property_value_signal_use_noi.sql.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_next_best_action AS
WITH gaps AS (
  -- 1. missing_recorded_owner
  SELECT
    'missing_recorded_owner'::text AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, 0::numeric) >= 10000000 THEN 'critical'::text
      WHEN COALESCE(v.rev_value, 0::numeric) >=  5000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0::numeric) >=  1000000 THEN 'medium'::text
      ELSE 'low'::text
    END AS gap_severity,
    dedup.property_id::text AS gap_pk,
    NULL::text AS entity_pk,
    dedup.property_id,
    dedup.address ||
      CASE WHEN dedup.dup_count > 1
           THEN ' [' || dedup.dup_count || ' dup records]'
           ELSE '' END AS gap_label,
    ('Research recorded owner for ' || dedup.address) ||
      CASE WHEN dedup.dup_count > 1
           THEN ' (consolidate ' || dedup.dup_count || ' duplicate property records first)'
           ELSE '' END AS suggested_action,
    COALESCE(v.rev_value, 1000000::numeric)        AS rev_value,
    COALESCE(v.rev_value, 1000000::numeric) * 2.0  AS raw_gap_value,
    COALESCE(dedup.updated_at, now())              AS first_seen_at
  FROM (
    SELECT
      p.*,
      count(*)     OVER (PARTITION BY lower(TRIM(p.address)), lower(TRIM(p.city)), p.state) AS dup_count,
      row_number() OVER (PARTITION BY lower(TRIM(p.address)), lower(TRIM(p.city)), p.state ORDER BY p.property_id) AS rn
    FROM public.properties p
    WHERE p.recorded_owner_id IS NULL
      AND p.address IS NOT NULL
      AND length(TRIM(p.address)) >= 8
      AND p.address ~ '^\d'
      AND p.address !~ '^[\d\s]+$'
      AND p.address !~~* 'property #%'
  ) dedup
  LEFT JOIN public.v_property_value_signal v ON v.property_id = dedup.property_id
  WHERE dedup.rn = 1

  UNION ALL

  -- 2. llc_research_pending
  SELECT
    'llc_research_pending'::text,
    CASE
      WHEN COALESCE(v.rev_value, 0::numeric) >= 10000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0::numeric) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END,
    q.queue_id::text,
    q.recorded_owner_id::text,
    q.property_id,
    q.search_name,
    'Research LLC manager/agent for ' || q.search_name,
    COALESCE(v.rev_value, 1000000::numeric),
    COALESCE(v.rev_value, 1000000::numeric),
    q.created_at
  FROM public.llc_research_queue q
  LEFT JOIN public.v_property_value_signal v ON v.property_id = q.property_id
  WHERE q.status = 'queued'

  UNION ALL

  -- 3. agency_drift (gov-specific)
  SELECT
    'agency_drift:' || g.drift_kind,
    CASE
      WHEN COALESCE(v.rev_value, 0::numeric) >= 10000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0::numeric) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END,
    g.property_id::text,
    NULL::text,
    g.property_id,
    COALESCE(g.prop_agency, '(no property agency)') || ' vs Lease:' || g.lease_tenant_agency,
    CASE g.drift_kind
      WHEN 'lease_agency_but_property_agency_null' THEN 'Back-fill properties.agency from lease tenant: ' || g.lease_tenant_agency
      WHEN 'agency_disagreement' THEN 'Resolve agency drift: property says "' || g.prop_agency || '", lease says "' || g.lease_tenant_agency || '"'
      ELSE 'Verify agency record'
    END,
    COALESCE(v.rev_value, 1000000::numeric),
    COALESCE(v.rev_value, 1000000::numeric) * 1.3,
    now()
  FROM public.v_gap_agency_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id
  WHERE g.drift_kind IS NOT NULL

  UNION ALL

  -- 4. orphan_sale_owner
  SELECT
    'orphan_sale_owner'::text,
    CASE
      WHEN COALESCE(g.sold_price, v.rev_value, 0::numeric) >= 5000000 THEN 'medium'::text
      ELSE 'low'::text
    END,
    g.sale_id::text,
    g.property_recorded_owner_id::text,
    g.property_id,
    'Sale ' || g.sale_date::text || ' missing owner backlink',
    'Back-link sale to recorded_owner: ' || COALESCE(g.owner_name, '(unknown)'),
    COALESCE(g.sold_price, v.rev_value, 1000000::numeric),
    COALESCE(g.sold_price, v.rev_value, 1000000::numeric) * 0.8,
    g.sale_date::timestamptz
  FROM public.v_gap_orphan_sale_owner g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

  UNION ALL

  -- 5. stale_active_listing
  SELECT
    'stale_active_listing'::text,
    CASE
      WHEN COALESCE(al.last_price, al.asking_price, v.rev_value, 0::numeric) >= 5000000 THEN 'high'::text
      WHEN COALESCE(al.last_price, al.asking_price, v.rev_value, 0::numeric) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END,
    al.listing_id::text,
    NULL::text,
    al.property_id,
    COALESCE(p.address, 'listing #' || al.listing_id::text) || ' (last seen ' ||
      to_char(COALESCE(al.last_seen_at, al.listing_date), 'YYYY-MM-DD') || ')',
    'Re-verify listing status',
    COALESCE(al.last_price, al.asking_price, v.rev_value, 1000000::numeric),
    COALESCE(al.last_price, al.asking_price, v.rev_value, 1000000::numeric),
    COALESCE(al.last_seen_at, al.listing_date, now())
  FROM public.available_listings al
  LEFT JOIN public.properties p              ON p.property_id  = al.property_id
  LEFT JOIN public.v_property_value_signal v ON v.property_id  = al.property_id
  WHERE al.listing_status = 'Active'
    AND COALESCE(al.last_seen_at, al.listing_date) < (now() - interval '90 days')
),
weighted AS (
  SELECT
    g.gap_type, g.gap_severity, g.gap_pk, g.entity_pk, g.property_id,
    g.gap_label, g.suggested_action,
    g.rev_value, g.raw_gap_value, g.first_seen_at,
    p.completeness_band, p.completeness_score,
    g.raw_gap_value *
      CASE p.completeness_band
        WHEN 'excellent' THEN 1.50
        WHEN 'good'      THEN 1.25
        WHEN 'fair'      THEN 1.00
        WHEN 'poor'      THEN 0.80
        ELSE 1.00
      END AS gap_priority_score
  FROM gaps g
  LEFT JOIN public.properties p ON p.property_id = g.property_id
)
SELECT
  row_number() OVER (ORDER BY gap_priority_score DESC NULLS LAST, first_seen_at) AS rank,
  gap_type, gap_severity, gap_pk, entity_pk, property_id,
  gap_label, suggested_action,
  rev_value          AS gap_value,
  gap_priority_score,
  raw_gap_value,
  first_seen_at,
  completeness_band, completeness_score
FROM weighted;

COMMENT ON VIEW public.v_next_best_action IS
  'Gov NBA queue. gap_value = property value (rev_value from '
  'v_property_value_signal). gap_priority_score = rev_value x gap-type-'
  'weight x completeness-band-weight, used for ranking only. raw_gap_value '
  '= rev_value x gap-type-weight (pre-completeness). 2026-05-21 deal-value '
  'reconciliation.';
