-- Topic 15 (audit §11.32): listing-event watcher.
--
-- The A10 fan-out trio (Lanes 1/2/3) is in place but operator-driven —
-- someone has to paste in a (source_domain, source_property_id) for it
-- to fire. This topic closes the loop: a cron pulls new sales_transactions
-- rows from dia + gov via pg_net and persists them as listing events.
-- The operator console reads v_lcc_listing_event_queue to see what's
-- new and clicks through to fire the fan-out functions live.
--
-- Why sales_transactions and not available_listings:
--   • sales_transactions is the closed-loop signal — once a deal lands
--     the BD opportunity is clear and time-bounded.
--   • available_listings churn is noisier (listings come and go,
--     prices change), and would generate more false-positive events.
--   • Easier to add available_listings as a second source_event_type
--     later than to peel out the noise.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lcc_listing_events (
  event_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_domain     text NOT NULL CHECK (source_domain IN ('dia','gov')),
  source_event_type text NOT NULL CHECK (source_event_type IN ('sale')),
  source_event_id   text NOT NULL,
  source_property_id text NOT NULL,
  event_date        date,
  sale_price        numeric,
  buyer_name        text,
  seller_name       text,
  cap_rate          numeric,
  data_source       text,
  detected_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  UNIQUE (source_domain, source_event_type, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_lcc_listing_events_unprocessed
  ON public.lcc_listing_events(detected_at DESC)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lcc_listing_events_property
  ON public.lcc_listing_events(source_domain, source_property_id);

CREATE INDEX IF NOT EXISTS idx_lcc_listing_events_date
  ON public.lcc_listing_events(event_date DESC);

COMMENT ON TABLE public.lcc_listing_events IS
  'New sales_transactions rows pulled from dia + gov via pg_net. Each '
  'row is a candidate listing-event for the BD operator console — they '
  'open it, the UI fires the A10 fan-out (lcc_listing_same_owner_cohort, '
  '_buyer_cohort, _geographic_neighbors) live, then stamps processed_at.';

CREATE TABLE IF NOT EXISTS public.lcc_listing_event_sync_inflight (
  request_id    bigint PRIMARY KEY,
  source_domain text   NOT NULL CHECK (source_domain IN ('dia','gov')),
  issued_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Sync: fire pg_net pulls
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_sync_listing_events(
  p_domain         text DEFAULT 'both',
  p_lookback_days  int  DEFAULT 30
) RETURNS TABLE(domain text, request_id bigint) AS $$
DECLARE
  v_url       text;
  v_anon_key  text;
  v_request   bigint;
  v_domain    text;
  v_domains   text[];
  v_url_path  text;
  v_cutoff    text := (CURRENT_DATE - p_lookback_days)::text;
BEGIN
  IF p_domain = 'both' THEN
    v_domains := ARRAY['dia','gov'];
  ELSE
    v_domains := ARRAY[p_domain];
  END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = (CASE v_domain WHEN 'dia' THEN 'dia_supabase_url' ELSE 'gov_supabase_url' END);

    SELECT decrypted_secret INTO v_anon_key
    FROM vault.decrypted_secrets
    WHERE name = (CASE v_domain WHEN 'dia' THEN 'dia_supabase_anon_key' ELSE 'gov_supabase_anon_key' END);

    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_sync_listing_events(%): missing vault secret, skipping', v_domain;
      CONTINUE;
    END IF;

    -- dia: pull sales_transactions directly (no RLS).
    -- gov: pull the slim v_sales_transactions_portfolio view (companion
    -- migration on the gov side aliases sold_price/buyer/seller into
    -- the dia-style column shape).
    IF v_domain = 'dia' THEN
      v_url_path := '/rest/v1/sales_transactions?select=sale_id,property_id,sale_date,sold_price,buyer_name,seller_name,cap_rate,data_source';
    ELSE
      v_url_path := '/rest/v1/v_sales_transactions_portfolio?select=sale_id,property_id,sale_date,sale_price,buyer_name,seller_name,cap_rate,data_source';
    END IF;

    SELECT net.http_get(
      url := v_url || v_url_path
        || '&sale_date=gte.' || v_cutoff
        || '&order=sale_date.desc'
        || '&limit=1000',
      headers := jsonb_build_object(
        'apikey', v_anon_key,
        'Authorization', 'Bearer ' || v_anon_key
      )
    ) INTO v_request;

    INSERT INTO public.lcc_listing_event_sync_inflight (request_id, source_domain)
    VALUES (v_request, v_domain);

    domain := v_domain;
    request_id := v_request;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_sync_listing_events(text, int) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Finalize: consume responses, insert new events
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_finalize_listing_events()
RETURNS TABLE(domain text, finalized_requests int, events_inserted int) AS $$
#variable_conflict use_column
DECLARE
  v_finalized int;
  v_inserted int;
BEGIN
  FOR domain IN
    SELECT DISTINCT source_domain FROM public.lcc_listing_event_sync_inflight
  LOOP
    WITH consumed AS (
      SELECT i.request_id, r.content
      FROM public.lcc_listing_event_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = domain AND r.status_code = 200
    ),
    rows AS (
      SELECT jsonb_array_elements(content::jsonb) AS row FROM consumed
    ),
    src AS (
      SELECT
        (row->>'sale_id')::text                AS source_event_id,
        (row->>'property_id')::text            AS source_property_id,
        NULLIF(row->>'sale_date','')::date     AS event_date,
        -- dia uses sold_price; gov view aliases sold_price → sale_price
        COALESCE(NULLIF(row->>'sale_price','')::numeric,
                 NULLIF(row->>'sold_price','')::numeric) AS sale_price,
        row->>'buyer_name'                     AS buyer_name,
        row->>'seller_name'                    AS seller_name,
        NULLIF(row->>'cap_rate','')::numeric   AS cap_rate,
        row->>'data_source'                    AS data_source
      FROM rows
      WHERE row->>'sale_id' IS NOT NULL
        AND row->>'property_id' IS NOT NULL
    ),
    inserted AS (
      INSERT INTO public.lcc_listing_events (
        source_domain, source_event_type, source_event_id,
        source_property_id, event_date, sale_price,
        buyer_name, seller_name, cap_rate, data_source
      )
      SELECT
        domain, 'sale', source_event_id,
        source_property_id, event_date, sale_price,
        buyer_name, seller_name, cap_rate, data_source
      FROM src
      ON CONFLICT (source_domain, source_event_type, source_event_id) DO NOTHING
      RETURNING 1
    ),
    cleanup AS (
      DELETE FROM public.lcc_listing_event_sync_inflight
      WHERE request_id IN (SELECT request_id FROM consumed)
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM consumed), (SELECT COUNT(*) FROM inserted)
    INTO v_finalized, v_inserted;

    finalized_requests := v_finalized;
    events_inserted := v_inserted;
    RETURN NEXT;
  END LOOP;

  -- Sweep stale inflight rows (24h grace)
  DELETE FROM public.lcc_listing_event_sync_inflight
  WHERE issued_at < NOW() - interval '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_finalize_listing_events() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- v_lcc_listing_event_queue — operator-facing view for unprocessed events
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_listing_event_queue
WITH (security_invoker = true) AS
SELECT
  e.event_id,
  e.source_domain,
  e.source_property_id,
  e.source_event_id,
  e.event_date,
  e.sale_price,
  e.buyer_name,
  e.seller_name,
  e.cap_rate,
  e.data_source,
  e.detected_at,
  e.processed_at,
  EXTRACT(day FROM now() - e.detected_at)::int AS days_since_detected,
  pa.address          AS property_address,
  pa.city             AS property_city,
  pa.state            AS property_state,
  pa.building_size_sqft,
  pa.year_built,
  pa.latitude,
  pa.longitude,
  -- The seller as an LCC entity (resolved through portfolio_facts via
  -- former-owner edges, matched to the sale_date)
  seller.id           AS seller_entity_id,
  seller.name         AS seller_entity_name,
  seller.owner_role   AS seller_owner_role,
  -- The buyer as an LCC entity (current owner of the property)
  buyer.id            AS buyer_entity_id,
  buyer.name          AS buyer_entity_name,
  buyer.owner_role    AS buyer_owner_role
FROM public.lcc_listing_events e
LEFT JOIN public.lcc_property_attributes pa
  ON pa.source_domain = e.source_domain
 AND pa.source_property_id = e.source_property_id
LEFT JOIN LATERAL (
  -- Most recent former owner of this property (the seller)
  SELECT en.id, en.name, en.owner_role
  FROM public.lcc_entity_portfolio_facts f
  JOIN public.entities en ON en.id = f.entity_id AND en.merged_into_entity_id IS NULL
  WHERE f.source_domain = e.source_domain
    AND f.source_property_id = e.source_property_id
    AND f.ownership_end_date IS NOT NULL
  ORDER BY f.ownership_end_date DESC
  LIMIT 1
) seller ON true
LEFT JOIN LATERAL (
  -- Current owner of this property (the buyer)
  SELECT en.id, en.name, en.owner_role
  FROM public.lcc_entity_portfolio_facts f
  JOIN public.entities en ON en.id = f.entity_id AND en.merged_into_entity_id IS NULL
  WHERE f.source_domain = e.source_domain
    AND f.source_property_id = e.source_property_id
    AND f.is_current = true
  ORDER BY f.ownership_start_date DESC NULLS LAST
  LIMIT 1
) buyer ON true;

GRANT SELECT ON public.v_lcc_listing_event_queue TO authenticated;

COMMENT ON VIEW public.v_lcc_listing_event_queue IS
  'Per-listing-event view joining lcc_listing_events to property '
  'attributes and the resolved seller/buyer entities. Operator console '
  'uses this to render the listing event queue.';

-- ---------------------------------------------------------------------------
-- lcc_mark_listing_event_processed(event_id, processed_at?) helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_mark_listing_event_processed(
  p_event_id     uuid,
  p_processed_at timestamptz DEFAULT now()
) RETURNS boolean AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.lcc_listing_events
  SET processed_at = p_processed_at
  WHERE event_id = p_event_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_mark_listing_event_processed(uuid, timestamptz) FROM PUBLIC;

COMMIT;
