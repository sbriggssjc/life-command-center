-- R11 Unit 1 (2026-06-08): repoint the LCC entity-portfolio sync's DIA leg at
-- dia.v_ownership_history_portfolio (which now joins the property's primary-lease
-- rent projected to CURRENT_DATE) so dia portfolio edges gain a real annual_rent.
--
-- Before: the dia leg pulled the RAW dia.ownership_history table and read its
-- `rent` column — NULL on all 7,772 rows — so all 887 current dia portfolio
-- edges ranked at $0. The priority queue / P-CONTACT / Decision-Center lanes all
-- rank on current_annual_rent_total, so dia was effectively unranked.
--
-- After: the dia leg pulls the slim anon view (dia 20260608170000) with the
-- gov-aligned column names (transfer_date / annual_rent / sale_price / cap_rate /
-- data_source) PLUS ownership_end_date.
--
-- WHY NOT collapse the dia + gov finalize branches: gov's view is a transfer-
-- EVENT model (latest transfer = current), but dia carries EXPLICIT ownership
-- start/end dates and 44% of dia rows have a NULL transfer_date — the gov
-- "latest transfer = current" window heuristic would misclassify current vs
-- former for dia. So the dia branch keeps its explicit-end aggregation
-- (bool_or(owner_end IS NULL)); this round ONLY adds rent and does NOT
-- reclassify any edge. The gov branch is left BYTE-IDENTICAL (no regression).
--
-- DEPLOY ORDERING: apply AFTER the dia view (dia 20260608170000). If this runs
-- first the dia pages 404 and the mirror keeps its pre-round (rent-less) values
-- — graceful, no error.
--
-- Cache note: lcc_entity_portfolio_facts feeds v_entity_portfolio_all →
-- v_priority_queue_enriched (live) and the v_priority_queue P-BUYER rollup. After
-- this sync runs, refresh lcc_priority_queue_resolved so the materialized queue
-- picks up the new rents (done live in the round; the */4h cron + */5 queue cron
-- keep it current thereafter).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Fire phase — dia leg repointed to the rent-bearing view
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
      -- R11: repointed from raw ownership_history (rent always NULL) to the
      -- rent-bearing view. ownership_end_date preserves dia's explicit-end
      -- current/former semantics; annual_rent is the projected primary-lease rent.
      v_url_path := '/rest/v1/v_ownership_history_portfolio';
      v_select_cols := 'true_owner_id,property_id,transfer_date,ownership_end_date,annual_rent,sale_price,cap_rate,data_source';
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
-- 2. Finalize phase — dia branch reads the new column names; current/former
--    aggregation is UNCHANGED. Gov branch is byte-identical to the prior def.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_finalize_entity_portfolios()
RETURNS TABLE(domain text, finalized_requests int, edges_upserted int) AS $$
DECLARE
  v_finalized int;
  v_upserted int;
BEGIN
  -- ----- dia branch (explicit start/end current/former, now with rent) -----
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
        NULLIF(row->>'transfer_date','')::date       AS owner_start,
        NULLIF(row->>'ownership_end_date','')::date  AS owner_end,
        NULLIF(row->>'annual_rent','')::numeric AS annual_rent,
        NULLIF(row->>'sale_price','')::numeric  AS sale_price,
        NULLIF(row->>'cap_rate','')::numeric    AS cap_rate,
        row->>'data_source' AS ownership_source
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

  -- ----- gov branch (with current-vs-former window) — BYTE-IDENTICAL -----
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

COMMIT;
