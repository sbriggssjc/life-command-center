-- ============================================================================
-- Item #4 v3.2 (dia, 2026-05-17): dedupe missing_recorded_owner by address
-- + filter junk-address phantom records.
--
-- Closes Discovery #4 (junk records) + Discovery #5 (duplicates at same
-- address). Both surfaced by the v3 NOI/cap fix when the top of the
-- ranked queue exposed:
--   • Garbage addresses ("property #13900", "Juru Pa Va Lley",
--     "15 5 2 2 2 4 3 2 4", "License: Fl") — phantom records.
--   • 7 distinct property_ids all at "6120 S. Yale Ave., Ste. 300"
--     (Tulsa) — same physical property, 7 queue rows wasting time.
--
-- Address quality predicate:
--   • IS NOT NULL and >= 8 chars after trim
--   • Starts with a digit (real US street addresses begin with a number)
--   • NOT pure digits + whitespace
--   • NOT starting with "property #" placeholder
--
-- Dedupe: PARTITION BY lower(trim(address)), lower(trim(city)), state.
-- Keep smallest property_id per group. Surface dup_count > 1 inline in
-- gap_label so Scott sees "[N dup records]" at a glance, and the
-- suggested_action prompts him to consolidate first.
--
-- Result on dia: missing_recorded_owner dropped 13,338 → 10,115 rows.
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
    ('cms_chain_drift:' || g.drift_kind)::text                AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, 0) >= 10000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    g.property_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    g.property_id                                             AS property_id,
    COALESCE(g.prop_tenant, '(no property tenant)') || ' vs CMS:' || g.cms_chain AS gap_label,
    CASE g.drift_kind
      WHEN 'cms_chain_but_property_tenant_null' THEN 'Back-fill property tenant from CMS chain: ' || g.cms_chain
      WHEN 'operator_transition_candidate'      THEN 'Verify operator transition: property says "' || g.prop_tenant || '", CMS says "' || g.cms_chain || '"'
      ELSE 'Resolve chain drift between property + CMS'
    END                                                       AS suggested_action,
    COALESCE(v.rev_value, 1000000)::numeric * 1.5             AS gap_value,
    now()                                                     AS first_seen_at
  FROM public.v_gap_chain_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id
  WHERE g.drift_kind IS NOT NULL

  UNION ALL

  SELECT
    'lease_tenant_drift'::text                                AS gap_type,
    CASE
      WHEN COALESCE(v.rev_value, g.annual_rent * 10, 0) >= 5000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, g.annual_rent * 10, 0) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    g.lease_id::text                                          AS gap_pk,
    NULL::text                                                AS entity_pk,
    g.property_id                                             AS property_id,
    'Lease:' || g.lease_tenant || ' vs Property:' || COALESCE(g.prop_tenant, '(null)') AS gap_label,
    'Back-fill properties.tenant from active lease tenant'    AS suggested_action,
    COALESCE(v.rev_value, g.annual_rent * 10, 1000000)::numeric * 1.2 AS gap_value,
    now()                                                     AS first_seen_at
  FROM public.v_gap_lease_tenant_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

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
      WHEN COALESCE(al.last_price, al.initial_price, v.rev_value, 0) >= 5000000 THEN 'high'::text
      WHEN COALESCE(al.last_price, al.initial_price, v.rev_value, 0) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END                                                       AS gap_severity,
    al.listing_id::text                                       AS gap_pk,
    NULL::text                                                AS entity_pk,
    al.property_id                                            AS property_id,
    COALESCE(p.address, 'listing #' || al.listing_id::text) || ' (last seen ' ||
      to_char(COALESCE(al.last_seen, al.listing_date), 'YYYY-MM-DD') || ')' AS gap_label,
    'Re-verify listing status'                                AS suggested_action,
    COALESCE(al.last_price, al.initial_price, v.rev_value, 1000000)::numeric AS gap_value,
    COALESCE(al.last_seen, al.listing_date, now())            AS first_seen_at
  FROM public.available_listings al
  LEFT JOIN public.properties p ON p.property_id = al.property_id
  LEFT JOIN public.v_property_value_signal v ON v.property_id = al.property_id
  WHERE al.is_active = true
    AND COALESCE(al.last_seen, al.listing_date) < (now() - interval '90 days')
)
SELECT
  ROW_NUMBER() OVER (ORDER BY gap_value DESC NULLS LAST, first_seen_at ASC) AS rank,
  gap_type, gap_severity, gap_pk, entity_pk, property_id,
  gap_label, suggested_action, gap_value, first_seen_at
FROM gaps;
