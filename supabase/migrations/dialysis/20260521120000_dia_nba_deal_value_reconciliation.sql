-- ============================================================================
-- Deal-value reconciliation (2026-05-21, dia mirror): fix the inflated
-- gap_value figures on the Home NBA rail.
--
-- Two issues found:
--
--   1. mv_property_value_signal had a NULL-handling bug. The fallback
--      `LEAST(p.building_size, 200000) * 400` looks like a "cap building_size
--      at 200K SF before multiplying", but PostgreSQL LEAST() ignores NULLs.
--      So when building_size IS NULL, LEAST(NULL, 200000) returns 200000,
--      and the formula degrades to $80M (= 200,000 SF × $400 PSF) for every
--      property with a missing building_size — which is most of them.
--
--      Result: every missing_recorded_owner row displayed gap_value = $160M
--      (= $80M × 2.0 missing-owner weight) regardless of the actual property.
--
--      Also, 200K SF / $400 PSF is wildly off for dialysis clinics
--      (typical free-standing center: 6K-10K SF, $300-450 PSF). The cap
--      was set high to accommodate the rare MOB / hospital pad, but ended
--      up dominating instead of being a tail-case fallback.
--
--   2. v_next_best_action multiplied rev_value by gap-type weight
--      (0.8 to 2.0) and completeness band (0.8 to 1.5) and returned the
--      result as gap_value. The UI rendered that with a "$" sign as if it
--      were the property value — but it was a weighted ranking score that
--      can be 2-3× the actual property value.
--
-- This migration:
--
--   a. Rewrites mv_property_value_signal with explicit NULL guards on the
--      SF-based path, drops the SF cap from 200K → 25K (covers small MOB +
--      free-standing clinic), adds a fallback for last_known_rent / cap, and
--      bumps the baseline to $2M.
--
--   b. Adds a sanity cap of last_known_rent × 25 (implicit 4% floor cap)
--      to prevent runaway when the SF path overstates.
--
--   c. Recreates v_next_best_action with separated columns:
--        gap_value           = rev_value (property value; UI displays this)
--        gap_priority_score  = rev_value × gap-weight × completeness-weight
--                              (used for ranking only)
--        raw_gap_value       = rev_value × gap-weight (pre-completeness)
--
-- Companion to gov 20260521120000 + 20260521121000.
-- ============================================================================

-- Step 1: drop dependents before recreating the materialized view body.
-- v_next_best_action depends on v_property_value_signal which wraps the matview.
DROP VIEW IF EXISTS public.v_next_best_action;
DROP VIEW IF EXISTS public.v_property_value_signal;
DROP MATERIALIZED VIEW IF EXISTS public.mv_property_value_signal;

-- Step 2: recreate the materialized view with corrected NULL handling.
CREATE MATERIALIZED VIEW public.mv_property_value_signal AS
WITH curr_cap AS (
  SELECT cm_dialysis_cap_ttm_q.ttm_weighted_cap_rate AS cap
    FROM cm_dialysis_cap_ttm_q
   WHERE cm_dialysis_cap_ttm_q.subspecialty = 'all'::text
     AND cm_dialysis_cap_ttm_q.ttm_weighted_cap_rate IS NOT NULL
     AND cm_dialysis_cap_ttm_q.ttm_weighted_cap_rate > 0::numeric
   ORDER BY cm_dialysis_cap_ttm_q.period_end DESC
   LIMIT 1
)
SELECT
  p.property_id,
  LEAST(
    -- Sanity cap: implied 4% floor cap rate off last_known_rent when present;
    -- effectively inactive ($25M ceiling) when last_known_rent is NULL.
    COALESCE(p.last_known_rent * 25::numeric, 25000000::numeric),
    COALESCE(
      -- 1. Recent sale within 10 years
      ( SELECT s.sold_price
          FROM sales_transactions s
         WHERE s.property_id = p.property_id
           AND s.sale_date   > (CURRENT_DATE - '10 years'::interval)
           AND s.sold_price  > 100000::numeric
         ORDER BY s.sale_date DESC LIMIT 1
      ),
      -- 2. Active listing's most recent price
      ( SELECT COALESCE(al.last_price, al.initial_price)
          FROM available_listings al
         WHERE al.property_id = p.property_id
           AND al.is_active   = true
         ORDER BY COALESCE(al.last_seen, al.listing_date) DESC LIMIT 1
      ),
      -- 3. Active lease rent / cap-rate (NNN dialysis convention)
      ( SELECT l.annual_rent / GREATEST((SELECT cap FROM curr_cap), 0.04)
          FROM leases l
         WHERE l.property_id = p.property_id
           AND l.is_active   = true
           AND l.annual_rent IS NOT NULL
           AND l.annual_rent > 1000::numeric
           AND l.annual_rent < 5000000::numeric
         ORDER BY l.lease_start DESC NULLS LAST LIMIT 1
      ),
      -- 4. last_known_rent / cap-rate (when no active lease row but rent known)
      ( CASE WHEN p.last_known_rent IS NOT NULL
              AND p.last_known_rent > 1000::numeric
              AND p.last_known_rent < 5000000::numeric
             THEN p.last_known_rent / GREATEST((SELECT cap FROM curr_cap), 0.04)
        END
      ),
      -- 5. current_value_estimate × 0.2 (real-estate share of business valuation;
      --    legacy fallback kept for properties carrying that signal)
      ( CASE WHEN p.current_value_estimate IS NOT NULL
              AND p.current_value_estimate > 0
             THEN p.current_value_estimate * 0.2
        END
      ),
      -- 6. building_size × $400/SF capped at 25K SF — EXPLICIT IS NOT NULL guard
      --    prevents the LEAST() NULL-skip behavior from defaulting to the cap
      --    when the field is missing (the source of the $80M bug).
      ( CASE WHEN p.building_size IS NOT NULL AND p.building_size > 0
             THEN LEAST(p.building_size, 25000::numeric) * 400::numeric
        END
      ),
      -- 7. $2M baseline (median small-clinic comp).
      2000000::numeric
    )
  )::numeric AS rev_value
FROM properties p;

CREATE UNIQUE INDEX IF NOT EXISTS mv_property_value_signal_pkey
  ON public.mv_property_value_signal(property_id);

CREATE VIEW public.v_property_value_signal AS
SELECT property_id, rev_value FROM public.mv_property_value_signal;

REFRESH MATERIALIZED VIEW public.mv_property_value_signal;

GRANT SELECT ON public.mv_property_value_signal TO anon, authenticated, service_role;

-- Step 3: recreate v_next_best_action with separated gap_value /
--         gap_priority_score columns.
CREATE VIEW public.v_next_best_action AS
WITH gaps AS (
  -- 1. missing_recorded_owner (with address-based dedup, junk filter)
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

  -- 3. cms_chain_drift (dia-specific)
  SELECT
    'cms_chain_drift:' || g.drift_kind,
    CASE
      WHEN COALESCE(v.rev_value, 0::numeric) >= 10000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, 0::numeric) >=  3000000 THEN 'medium'::text
      ELSE 'low'::text
    END,
    g.property_id::text,
    NULL::text,
    g.property_id,
    COALESCE(g.prop_tenant::text, '(no property tenant)') || ' vs CMS:' || g.cms_chain,
    CASE g.drift_kind
      WHEN 'cms_chain_but_property_tenant_null' THEN 'Back-fill property tenant from CMS chain: ' || g.cms_chain
      WHEN 'operator_transition_candidate'      THEN 'Verify operator transition: property says "' || g.prop_tenant || '", CMS says "' || g.cms_chain || '"'
      ELSE 'Resolve chain drift between property + CMS'
    END,
    COALESCE(v.rev_value, 1000000::numeric),
    COALESCE(v.rev_value, 1000000::numeric) * 1.5,
    now()
  FROM public.v_gap_chain_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id
  WHERE g.drift_kind IS NOT NULL

  UNION ALL

  -- 4. lease_tenant_drift (dia-specific)
  SELECT
    'lease_tenant_drift'::text,
    CASE
      WHEN COALESCE(v.rev_value, g.annual_rent * 10, 0::numeric) >= 5000000 THEN 'high'::text
      WHEN COALESCE(v.rev_value, g.annual_rent * 10, 0::numeric) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END,
    g.lease_id::text,
    NULL::text,
    g.property_id,
    'Lease:' || g.lease_tenant || ' vs Property:' || COALESCE(g.prop_tenant::text, '(null)'),
    'Back-fill properties.tenant from active lease tenant',
    COALESCE(v.rev_value, g.annual_rent * 10::numeric, 1000000::numeric),
    COALESCE(v.rev_value, g.annual_rent * 10::numeric, 1000000::numeric) * 1.2,
    now()
  FROM public.v_gap_lease_tenant_drift g
  LEFT JOIN public.v_property_value_signal v ON v.property_id = g.property_id

  UNION ALL

  -- 5. orphan_sale_owner
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

  -- 6. stale_active_listing
  SELECT
    'stale_active_listing'::text,
    CASE
      WHEN COALESCE(al.last_price, al.initial_price, v.rev_value, 0::numeric) >= 5000000 THEN 'high'::text
      WHEN COALESCE(al.last_price, al.initial_price, v.rev_value, 0::numeric) >= 1000000 THEN 'medium'::text
      ELSE 'low'::text
    END,
    al.listing_id::text,
    NULL::text,
    al.property_id,
    COALESCE(p.address, 'listing #' || al.listing_id::text) || ' (last seen ' ||
      to_char(COALESCE(al.last_seen::timestamptz, al.listing_date::timestamptz), 'YYYY-MM-DD') || ')',
    'Re-verify listing status',
    COALESCE(al.last_price, al.initial_price, v.rev_value, 1000000::numeric),
    COALESCE(al.last_price, al.initial_price, v.rev_value, 1000000::numeric),
    COALESCE(al.last_seen::timestamptz, al.listing_date::timestamptz, now())
  FROM public.available_listings al
  LEFT JOIN public.properties p              ON p.property_id  = al.property_id
  LEFT JOIN public.v_property_value_signal v ON v.property_id  = al.property_id
  WHERE al.is_active = true
    AND COALESCE(al.last_seen, al.listing_date) < (now() - interval '90 days')
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

-- Step 4: re-register nightly refresh cron (DROP CASCADE removed any prior
--         job dependency reference; safe to re-add idempotently).
SELECT cron.unschedule('refresh-mv-property-value-signal')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-mv-property-value-signal');
SELECT cron.schedule(
  'refresh-mv-property-value-signal',
  '50 6 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_property_value_signal$$
);
