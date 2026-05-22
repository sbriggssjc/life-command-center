-- Topic A3 (audit §11.23): LCC cross-vertical entity portfolio facts
-- recurring sync + enriched priority queue.
--
-- Builds on top of the schema added in 20260522230000:
--   public.lcc_entity_portfolio_facts (raw edges)
--   public.v_entity_portfolio_all     (per-entity rollup)
--
-- This migration adds:
--   - lcc_portfolio_sync_inflight: pg_net request tracking
--   - lcc_sync_entity_portfolios(p_domain): fires paginated PostgREST GETs
--     against dia.ownership_history and gov.v_ownership_history_portfolio
--   - lcc_finalize_entity_portfolios(): consumes the responses, upserts
--     into lcc_entity_portfolio_facts with the same dia/gov normalization
--     used in the manual backfill (gov: latest transfer per property is
--     current; earlier transfers stamped with the next transfer date as
--     their disposition).
--   - v_priority_queue_enriched: joins v_priority_queue to
--     v_entity_portfolio_all so the operator console can sort/filter by
--     portfolio size, cross-vertical flag, current property count.
--
-- Initial backfill applied manually on 2026-05-22 (5,888 edges: 1,666 dia
-- + 4,222 gov, covering all 4,003 classified entities that have at least
-- one ownership_history row).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Inflight tracking (mirrors Topic 10's lcc_entity_sync_inflight)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_portfolio_sync_inflight (
  request_id    bigint PRIMARY KEY,
  source_domain text   NOT NULL CHECK (source_domain IN ('dia','gov')),
  page_offset   int    NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_portfolio_sync_inflight IS
  'Tracks pg_net request_ids issued by lcc_sync_entity_portfolios() for '
  'lcc_finalize_entity_portfolios() to consume on its next pass.';

-- ---------------------------------------------------------------------------
-- 2. Fire phase
--
-- dia: pulls public.ownership_history directly (no RLS, anon-readable).
-- gov: pulls public.v_ownership_history_portfolio (the slim PII-stripped
--      view added in government/20260522230000_gov_v_ownership_history
--      _portfolio.sql).
--
-- Both use 1000-row pages. Dia volume is ~7-8k rows (8 pages); gov is
-- ~13-14k rows (15 pages); fire 16 pages per domain to leave headroom.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_sync_entity_portfolios(p_domain text DEFAULT 'both')
RETURNS TABLE(domain text, pages_fired int) AS $$
DECLARE
  v_url      text;
  v_anon_key text;
  v_page     int;
  v_request_id bigint;
  v_pages_fired int;
  v_domain text;
  v_domains text[];
  v_url_path text;
  v_select_cols text;
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
      RAISE NOTICE 'lcc_sync_entity_portfolios(%): missing vault secret, skipping', v_domain;
      CONTINUE;
    END IF;

    IF v_domain = 'dia' THEN
      v_url_path := '/rest/v1/ownership_history';
      v_select_cols := 'true_owner_id,property_id,ownership_start,ownership_end,start_date,end_date,rent,sold_price,cap_rate,ownership_source';
    ELSE
      v_url_path := '/rest/v1/v_ownership_history_portfolio';
      v_select_cols := 'true_owner_id,property_id,transfer_date,annual_rent,sale_price,cap_rate,data_source';
    END IF;

    v_pages_fired := 0;
    FOR v_page IN 0..15 LOOP
      SELECT net.http_get(
        url := v_url || v_url_path
          || '?select=' || v_select_cols
          || '&true_owner_id=not.is.null'
          || '&order=property_id.asc'
          || '&limit=1000&offset=' || (v_page * 1000),
        headers := jsonb_build_object(
          'apikey', v_anon_key,
          'Authorization', 'Bearer ' || v_anon_key
        )
      ) INTO v_request_id;

      INSERT INTO public.lcc_portfolio_sync_inflight
        (request_id, source_domain, page_offset)
      VALUES (v_request_id, v_domain, v_page * 1000);

      v_pages_fired := v_pages_fired + 1;
    END LOOP;

    domain := v_domain;
    pages_fired := v_pages_fired;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_sync_entity_portfolios(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Finalize phase
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_finalize_entity_portfolios()
RETURNS TABLE(domain text, finalized_requests int, edges_upserted int) AS $$
DECLARE
  v_domain text;
  v_finalized int;
  v_upserted int;
BEGIN
  -- ----- dia branch -----
  IF EXISTS (SELECT 1 FROM public.lcc_portfolio_sync_inflight WHERE source_domain = 'dia') THEN
    WITH consumed AS (
      SELECT i.request_id, r.content
      FROM public.lcc_portfolio_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = 'dia' AND r.status_code = 200
    ),
    rows AS (
      SELECT jsonb_array_elements(content::jsonb) AS row FROM consumed
    ),
    normalized AS (
      SELECT
        (row->>'true_owner_id')::uuid AS entity_id,
        'dia'::text AS source_domain,
        (row->>'property_id')::text AS source_property_id,
        COALESCE((row->>'ownership_start')::date, (row->>'start_date')::date) AS owner_start,
        COALESCE((row->>'ownership_end')::date,   (row->>'end_date')::date)   AS owner_end,
        NULLIF(row->>'rent','')::numeric AS annual_rent,
        NULLIF(row->>'sold_price','')::numeric AS sale_price,
        NULLIF(row->>'cap_rate','')::numeric   AS cap_rate,
        row->>'ownership_source' AS ownership_source
      FROM rows
      WHERE row->>'true_owner_id' IS NOT NULL
        AND row->>'property_id' IS NOT NULL
    ),
    aggregated AS (
      SELECT
        entity_id, source_domain, source_property_id,
        MIN(owner_start) AS owner_start,
        CASE WHEN bool_or(owner_end IS NULL) THEN NULL ELSE MAX(owner_end) END AS owner_end,
        AVG(annual_rent) FILTER (WHERE annual_rent IS NOT NULL) AS annual_rent,
        MAX(sale_price)  AS sale_price,
        AVG(cap_rate) FILTER (WHERE cap_rate IS NOT NULL) AS cap_rate,
        MAX(ownership_source) AS ownership_source
      FROM normalized
      GROUP BY entity_id, source_domain, source_property_id
    ),
    upsert AS (
      INSERT INTO public.lcc_entity_portfolio_facts (
        entity_id, source_domain, source_property_id,
        ownership_start_date, ownership_end_date,
        annual_rent, sale_price, cap_rate, ownership_source, updated_at
      )
      SELECT entity_id, source_domain, source_property_id,
             owner_start, owner_end, annual_rent, sale_price, cap_rate,
             ownership_source, now()
      FROM aggregated
      WHERE EXISTS (SELECT 1 FROM public.entities e WHERE e.id = aggregated.entity_id)
      ON CONFLICT (entity_id, source_domain, source_property_id) DO UPDATE SET
        ownership_start_date = LEAST(EXCLUDED.ownership_start_date, public.lcc_entity_portfolio_facts.ownership_start_date),
        ownership_end_date = EXCLUDED.ownership_end_date,
        annual_rent = COALESCE(EXCLUDED.annual_rent, public.lcc_entity_portfolio_facts.annual_rent),
        sale_price = COALESCE(EXCLUDED.sale_price, public.lcc_entity_portfolio_facts.sale_price),
        cap_rate = COALESCE(EXCLUDED.cap_rate, public.lcc_entity_portfolio_facts.cap_rate),
        ownership_source = COALESCE(EXCLUDED.ownership_source, public.lcc_entity_portfolio_facts.ownership_source),
        updated_at = now()
      RETURNING 1
    ),
    cleanup AS (
      DELETE FROM public.lcc_portfolio_sync_inflight
      WHERE request_id IN (SELECT request_id FROM consumed)
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM consumed), (SELECT COUNT(*) FROM upsert)
    INTO v_finalized, v_upserted;

    domain := 'dia';
    finalized_requests := v_finalized;
    edges_upserted := v_upserted;
    RETURN NEXT;
  END IF;

  -- ----- gov branch (with current-vs-former window) -----
  IF EXISTS (SELECT 1 FROM public.lcc_portfolio_sync_inflight WHERE source_domain = 'gov') THEN
    WITH consumed AS (
      SELECT i.request_id, r.content
      FROM public.lcc_portfolio_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = 'gov' AND r.status_code = 200
    ),
    rows AS (
      SELECT jsonb_array_elements(content::jsonb) AS row FROM consumed
    ),
    with_window AS (
      SELECT
        (row->>'true_owner_id')::uuid AS entity_id,
        'gov'::text AS source_domain,
        (row->>'property_id')::text AS source_property_id,
        (row->>'transfer_date')::date AS transfer_date,
        NULLIF(row->>'annual_rent','')::numeric AS annual_rent,
        NULLIF(row->>'sale_price','')::numeric  AS sale_price,
        NULLIF(row->>'cap_rate','')::numeric    AS cap_rate,
        row->>'data_source' AS ownership_source,
        MAX((row->>'transfer_date')::date) OVER (PARTITION BY (row->>'property_id')::text) AS latest_property_transfer
      FROM rows
      WHERE row->>'true_owner_id' IS NOT NULL
        AND row->>'property_id' IS NOT NULL
    ),
    normalized AS (
      SELECT
        entity_id, source_domain, source_property_id,
        MIN(transfer_date) AS owner_start,
        CASE WHEN MAX(transfer_date) = MAX(latest_property_transfer) THEN NULL
             ELSE MAX(latest_property_transfer) END AS owner_end,
        AVG(annual_rent) FILTER (WHERE annual_rent IS NOT NULL) AS annual_rent,
        MAX(sale_price)  AS sale_price,
        AVG(cap_rate) FILTER (WHERE cap_rate IS NOT NULL) AS cap_rate,
        MAX(ownership_source) AS ownership_source
      FROM with_window
      GROUP BY entity_id, source_domain, source_property_id
    ),
    upsert AS (
      INSERT INTO public.lcc_entity_portfolio_facts (
        entity_id, source_domain, source_property_id,
        ownership_start_date, ownership_end_date,
        annual_rent, sale_price, cap_rate, ownership_source, updated_at
      )
      SELECT entity_id, source_domain, source_property_id,
             owner_start, owner_end, annual_rent, sale_price, cap_rate,
             ownership_source, now()
      FROM normalized
      WHERE EXISTS (SELECT 1 FROM public.entities e WHERE e.id = normalized.entity_id)
      ON CONFLICT (entity_id, source_domain, source_property_id) DO UPDATE SET
        ownership_start_date = LEAST(EXCLUDED.ownership_start_date, public.lcc_entity_portfolio_facts.ownership_start_date),
        ownership_end_date = EXCLUDED.ownership_end_date,
        annual_rent = COALESCE(EXCLUDED.annual_rent, public.lcc_entity_portfolio_facts.annual_rent),
        sale_price = COALESCE(EXCLUDED.sale_price, public.lcc_entity_portfolio_facts.sale_price),
        cap_rate = COALESCE(EXCLUDED.cap_rate, public.lcc_entity_portfolio_facts.cap_rate),
        ownership_source = COALESCE(EXCLUDED.ownership_source, public.lcc_entity_portfolio_facts.ownership_source),
        updated_at = now()
      RETURNING 1
    ),
    cleanup AS (
      DELETE FROM public.lcc_portfolio_sync_inflight
      WHERE request_id IN (SELECT request_id FROM consumed)
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM consumed), (SELECT COUNT(*) FROM upsert)
    INTO v_finalized, v_upserted;

    domain := 'gov';
    finalized_requests := v_finalized;
    edges_upserted := v_upserted;
    RETURN NEXT;
  END IF;

  -- Sweep stale inflight rows (24h grace)
  DELETE FROM public.lcc_portfolio_sync_inflight
  WHERE issued_at < NOW() - interval '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_finalize_entity_portfolios() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. v_priority_queue_enriched: join v_priority_queue to v_entity_portfolio_all
--
-- Stable wrapper that adds portfolio context without modifying the original
-- v_priority_queue interface. Operator UI can pick whichever is cheaper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_priority_queue_enriched
WITH (security_invoker = true) AS
SELECT
  q.entity_id,
  q.name,
  q.workspace_id,
  q.vertical,
  q.owner_user_id,
  q.contact_id,
  q.bd_opportunity_id,
  q.priority_band,
  q.reason,
  q.next_touch_due,
  q.days_overdue,
  q.last_touch_at,
  q.last_touch_type,
  q.effective_owner_role,
  q.owner_role_confidence,
  COALESCE(p.total_property_count, 0)      AS total_property_count,
  COALESCE(p.current_property_count, 0)    AS current_property_count,
  COALESCE(p.dia_property_count, 0)        AS dia_property_count,
  COALESCE(p.gov_property_count, 0)        AS gov_property_count,
  COALESCE(p.is_cross_vertical, false)     AS is_cross_vertical,
  p.earliest_acquisition_date,
  p.latest_acquisition_date,
  p.latest_disposition_date,
  COALESCE(p.current_annual_rent_total, 0) AS current_annual_rent_total,
  p.avg_cap_rate
FROM public.v_priority_queue q
LEFT JOIN public.v_entity_portfolio_all p
  ON p.entity_id = q.entity_id;

GRANT SELECT ON public.v_priority_queue_enriched TO authenticated;

COMMENT ON VIEW public.v_priority_queue_enriched IS
  'v_priority_queue + per-entity portfolio rollup (count, current count, '
  'cross-vertical flag, earliest/latest acquisition, current rent total). '
  'Use this in the operator console so the priority list shows "Elliott '
  'Bay: 37 current / 93 lifetime" next to each row.';

COMMIT;
