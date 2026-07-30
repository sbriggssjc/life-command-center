-- ============================================================================
-- W3.5 — Listing-BD expiry sweep (audit 3.4.2, Consumption-Layer auto-retire)
-- ============================================================================
-- The listing_bd_trigger producer fans owner-outreach candidates into
-- inbox_items when a new listing is captured. Those candidates go stale the
-- moment the listing SELLS / goes off market — continuing to draft outreach for
-- a property that is no longer available is noise. This sweep is the auto-retire
-- predicate the Consumption-Layer doctrine requires: it auto-dismisses open
-- listing_bd_trigger inbox items whose listing property has a LIVE sale event in
-- lcc_listing_events (the W2.3/W2.4 sale-event mirror), respecting the W2.4
-- retracted_at guard (a retracted sale event does NOT expire the listing).
--
-- Discipline: reversible (metadata tag + prev_status, never hard-deletes),
-- idempotent (only touches open new/triaged, un-expired rows), dry-run default.
-- No temp table (safe to call more than once per transaction).
--
-- The listing→property link resolves through BOTH canonical paths:
--   • external_identities(source_type='asset')  → (source_system, external_id)
--   • entities.metadata->>'domain_property_id'   → (entities.domain, pid)
-- Only a sale event dated on/after the BD run (30-day capture grace) OR detected
-- after it counts, so a stale HISTORICAL sale on a freshly-listed property does
-- not wrongly expire the outreach.
--
-- REVERSAL RUNBOOK (un-dismiss items this sweep closed — note the ::inbox_status
-- cast; status is an enum):
--   UPDATE inbox_items
--     SET status = COALESCE(metadata->>'listing_bd_prev_status','new')::inbox_status,
--         metadata = metadata - 'listing_bd_expired' - 'listing_bd_expired_at'
--                    - 'listing_bd_expired_reason' - 'listing_bd_prev_status'
--   WHERE source_type='listing_bd_trigger'
--     AND (metadata->>'listing_bd_expired')::boolean = true;
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_expire_listing_bd_inbox_items(
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(expired_count integer, sample jsonb)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now    timestamptz := now();
  v_ids    uuid[];
  v_sample jsonb;
BEGIN
  -- Resolve the target ids once (no temp table → safe to call >1×/transaction).
  SELECT array_agg(t.id),
         COALESCE(
           jsonb_agg(jsonb_build_object(
             'id', t.id, 'prev_status', t.status, 'listing_entity_id', t.listing_entity_id))
             FILTER (WHERE t.rn <= 20),
           '[]'::jsonb)
    INTO v_ids, v_sample
  FROM (
    WITH candidates AS (
      SELECT ii.id, ii.status, ii.received_at,
             (ii.metadata->>'listing_entity_id')::uuid AS listing_entity_id
      FROM inbox_items ii
      WHERE ii.source_type = 'listing_bd_trigger'
        AND ii.status IN ('new','triaged')
        AND COALESCE((ii.metadata->>'listing_bd_expired')::boolean, false) = false
        AND (ii.metadata->>'listing_entity_id') IS NOT NULL
    ),
    ent_props AS (
      -- property ids per listing entity via the canonical asset identity link …
      SELECT c.listing_entity_id, ei.source_system AS domain, ei.external_id AS property_id
      FROM candidates c
      JOIN external_identities ei
        ON ei.entity_id = c.listing_entity_id
       AND ei.source_type = 'asset'
       AND ei.external_id IS NOT NULL
      UNION
      -- … and via the listing entity's own metadata pointer.
      SELECT c.listing_entity_id, e.domain AS domain, (e.metadata->>'domain_property_id') AS property_id
      FROM candidates c
      JOIN entities e ON e.id = c.listing_entity_id
      WHERE e.metadata ? 'domain_property_id'
        AND e.domain IN ('dia','gov')
    ),
    sold AS (
      SELECT DISTINCT c.id
      FROM candidates c
      JOIN ent_props ep ON ep.listing_entity_id = c.listing_entity_id
      JOIN lcc_listing_events le
        ON le.retracted_at IS NULL
       AND le.source_event_type = 'sale'
       AND le.source_domain = ep.domain
       AND le.source_property_id = ep.property_id
       AND ( le.event_date >= (c.received_at::date - INTERVAL '30 days')
             OR le.detected_at >= c.received_at )
    )
    SELECT c.id, c.status, c.listing_entity_id,
           row_number() OVER (ORDER BY c.received_at) AS rn
    FROM candidates c
    WHERE c.id IN (SELECT id FROM sold)
  ) t;

  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);

  IF NOT p_dry_run AND array_length(v_ids, 1) > 0 THEN
    UPDATE inbox_items ii
    SET status = 'dismissed',
        metadata = COALESCE(ii.metadata, '{}'::jsonb) || jsonb_build_object(
          'listing_bd_expired', true,
          'listing_bd_expired_at', v_now,
          'listing_bd_expired_reason', 'listing_sold_or_off_market',
          'listing_bd_prev_status', ii.status
        ),
        updated_at = v_now
    WHERE ii.id = ANY(v_ids);
  END IF;

  RETURN QUERY SELECT COALESCE(array_length(v_ids, 1), 0), COALESCE(v_sample, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.lcc_expire_listing_bd_inbox_items(boolean) IS
  'W3.5 Consumption-Layer auto-retire: dismiss open listing_bd_trigger inbox items whose listing has a live lcc_listing_events sale (respects retracted_at). Reversible via metadata.listing_bd_prev_status; dry-run default.';

-- Daily sweep (04:10 UTC — after the W2.3 mirror ticks land the day's sale
-- events). cron.schedule upserts by jobname (idempotent, in-place).
SELECT cron.schedule(
  'lcc-listing-bd-expiry-sweep',
  '10 4 * * *',
  $cmd$SET statement_timeout TO '60s'; SELECT public.lcc_expire_listing_bd_inbox_items(false);$cmd$
);
