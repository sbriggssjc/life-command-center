-- ============================================================================
-- Item #4 v3.2 (gov, 2026-05-17): dedupe + junk filter (gov mirror).
-- Same approach as dia. Surfaces dup_count inline in gap_label.
-- Example output from production: "6120 S. Yale Ave., Ste. 300 [7 dup records]"
-- ============================================================================
CREATE OR REPLACE VIEW public.v_next_best_action AS
WITH gaps AS (
  -- 1. missing_recorded_owner (deduped + junk-filtered)
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
    COALESCE(v.rev_value, 1000000)::numeric * 2.0             AS gap_value,
    COALESCE(dedup.updated_at, now())                         AS first_seen_at
  FROM (
    SELECT
      p.*,
      count(*)     OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state) AS dup_count,
      row_number() OVER (PARTITION BY lower(trim(p.address)), lower(trim(p.city)), p.state ORDER BY p.property_id) AS rn
    FROM public.properties p
    WHERE p.recorded_owner_id IS NULL
      AND p.address           IS NOT NULL
      AND length(trim(p.address)) >= 8
      AND p.address ~  '^\d'
      AND p.address !~ '^[\d\s]+$'
      AND p.address NOT ILIKE 'property #%'
  ) dedup
  LEFT JOIN public.v_property_value_signal v ON v.property_id = dedup.property_id
  WHERE dedup.rn = 1

  UNION ALL

  SELECT
    'llc_research_pending'::text                              AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    q.queue_id::text                                          AS gap_pk,
    q.recorded_owner_id::text                                 AS entity_pk,
    q.property_id                                             AS property_id,
    q.search_name                                             AS gap_label,
    'Research LLC manager/agent for ' || q.search_name        AS suggested_action,
    COALESCE(v.rev_value, 1000000)::numeric                   AS gap_value,
    q.created_at                                              AS first_seen_at
  FROM public.llc_research_queue q
  LEFT JOIN public.v_property_value_signal v ON v.property_id = q.property_id
  WHERE q.status = 'queued'

  UNION ALL

  SELECT
    ('agency_drift:' || g.drift_kind)::text                   AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    g.property_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    g.property_id                                             AS property_id,
    COALESCE(g.prop_agency, '(no property agency)') || ' vs Lease:' || g.lease_tenant_agency AS gap_label,
    CASE g.drift_kind
      WHEN 'lease_agency_but_property_agency_null' THEN 'Back-fill properties.agency from lease tenant: ' || g.lease_tenant_agency
      WHEN 'agency_disagreement'                   THEN 'Resolve agency drift: property says "' || g.prop_agency || '", lease says "' || g.lease_tenant_agency || '"'
      ELSE 'Verify agency record'
    END                                                       AS suggested_action,
    COALESCE(v.rev_value, 1000000)::numeric * 1.3             AS gap_value,
    now()                                                     AS first_seen_at
  FROM public.v_gap_agency_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id
  WHERE g.drift_kind IS NOT NULL

  UNION ALL

  SELECT
    'orphan_sale_owner'::text                                 AS gap_type,
    CASE
      WHEN COALESCE(g.sold_price, v.rev_value, 0) >= 5000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    g.sale_id::text                                           AS gap_pk,
    g.property_recorded_owner_id::text                        AS entity_pk,
    g.property_id                                             AS property_id,
    'Sale ' || g.sale_date::text || ' missing owner backlink' AS gap_label,
    'Back-link sale to recorded_owner: ' || COALESCE(g.owner_name, '(unknown)') AS suggested_action,
    (COALESCE(g.sold_price, v.rev_value, 1000000)::numeric) * 0.8 AS gap_value,
    g.sale_date::timestamptz                                  AS first_seen_at
  FROM public.v_gap_orphan_sale_owner g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

  UNION ALL

  SELECT
    'stale_active_listing'::text                              AS gap_type,
    CASE
      WHEN COALESCE(al.last_price, al.asking_price, v.rev_value, 0) >= 5000000 THEN 'high'::text
      WHEN COALESCE(al.last_price, al.asking_price, v.rev_value, 0) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    al.listing_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    al.property_id                                            AS property_id,
    COALESCE(p.address, 'listing #' || al.listing_id::text) || ' (last seen ' ||
      to_char(COALESCE(al.last_seen_at, al.listing_date), 'YYYY-MM-DD') || ')' AS gap_label,
    'Re-verify listing status'                                AS suggested_action,
    COALESCE(al.last_price, al.asking_price, v.rev_value, 1000000)::numeric AS gap_value,
    COALESCE(al.last_seen_at, al.listing_date, now())         AS first_seen_at
  FROM public.available_listings al
  LEFT JOIN public.properties p ON p.property_id = al.property_id
  LEFT JOIN public.v_property_value_signal v ON v.property_id = al.property_id
  WHERE al.listing_status = 'Active'
    AND COALESCE(al.last_seen_at, al.listing_date) < (now() - interval '90 days')
)
SELECT
  ROW_NUMBER() OVER (ORDER BY gap_value DESC NULLS LAST, first_seen_at ASC) AS rank,
  gap_type, gap_severity, gap_pk, entity_pk, property_id,
  gap_label, suggested_action, gap_value, first_seen_at
FROM gaps;
