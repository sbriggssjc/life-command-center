-- OWN-T0g forward fix: lcc_finalize_entity_portfolios now self-heals the
-- cross-sync-batch supersession gap on every call by delegating to
-- lcc_own_t0g_supersede_by_transfer_evidence(false, ...) after both
-- domains' upserts. This scans the WHOLE table (cheap, ~14k rows), not just
-- this run's payload, which is what actually closes the gap: a property
-- whose ownership history arrives split across two separate sync calls now
-- gets compared correctly regardless of which call each fact came in on.
-- Everything else in this function is byte-for-byte unchanged from the live
-- definition (verified via pg_get_functiondef before editing).

CREATE OR REPLACE FUNCTION public.lcc_finalize_entity_portfolios()
 RETURNS TABLE(domain text, finalized_requests integer, edges_upserted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_finalized int;
  v_upserted int;
BEGIN
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
        -- P175: the domain DB does not know about LCC merges, so it keeps
        -- sending the pre-merge owner id. Resolve it HERE, before GROUP BY, so
        -- two ids collapsing to one survivor aggregate together instead of
        -- colliding inside the INSERT ("cannot affect row a second time").
        COALESCE(public.lcc_entity_survivor((row->>'true_owner_id')::uuid),
                 (row->>'true_owner_id')::uuid) AS entity_id,
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
      -- P175: EXISTS alone passes for a TOMBSTONE (it is still a row in
      -- entities). Require liveness, so an unresolvable id is skipped rather
      -- than resurrected.
      WHERE EXISTS (SELECT 1 FROM public.entities e
                     WHERE e.id = aggregated.entity_id
                       AND e.merged_into_entity_id IS NULL)
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
        COALESCE(public.lcc_entity_survivor((row->>'true_owner_id')::uuid),
                 (row->>'true_owner_id')::uuid) AS entity_id,
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
      WHERE EXISTS (SELECT 1 FROM public.entities e
                     WHERE e.id = normalized.entity_id
                       AND e.merged_into_entity_id IS NULL)
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

  -- OWN-T0g, Scott 2026-09-15: self-heal any property where a
  -- transfer-evidenced current fact (deed/ownership-chain/sale) should
  -- supersede a stale current fact for a different party -- across the
  -- WHOLE table, not just what this call's payload touched. This is what
  -- closes the cross-sync-batch gap: a property split across two separate
  -- sync calls now gets compared correctly regardless of which call each
  -- fact arrived on. Cheap (full-table scan, ~14k rows), idempotent (finds
  -- nothing once resolved), and conservative (never touches a case where
  -- the competing current fact is itself dated LATER than the transfer --
  -- that stays a genuine conflict for v_lcc_portfolio_ownership_conflict).
  PERFORM public.lcc_own_t0g_supersede_by_transfer_evidence(
    false, 'auto_finalize_' || to_char(now(), 'YYYYMMDDHH24MISS')
  );

  DELETE FROM public.lcc_portfolio_sync_inflight
  WHERE issued_at < NOW() - interval '24 hours';
END;
$function$;

REVOKE ALL ON FUNCTION public.lcc_finalize_entity_portfolios() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_finalize_entity_portfolios() TO service_role;

DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.lcc_finalize_entity_portfolios()', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_finalize_entity_portfolios: service_role EXECUTE grant did not take';
  END IF;
  IF has_function_privilege('anon', 'public.lcc_finalize_entity_portfolios()', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_finalize_entity_portfolios: anon must NOT be able to execute this';
  END IF;
  IF has_function_privilege('authenticated', 'public.lcc_finalize_entity_portfolios()', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_finalize_entity_portfolios: authenticated must NOT be able to execute this';
  END IF;
END $$;
