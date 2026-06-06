-- R8 Unit 1 (2026-06-08): dia owner-facts leg (LCC Opps side). Closes the R6
-- gap — R6 shipped tier-0 domain-truth resolution for gov only; the resolver,
-- mirror table (CHECK already allows 'dia'), and views are domain-agnostic once
-- dia mirror rows exist. This migration:
--   1. Extends lcc_sync_property_owner_facts with the dia leg (vault secrets
--      dia_supabase_url / dia_supabase_anon_key; 2,000/page over ~12.2k dia
--      properties). gov leg unchanged.
--   2. Makes lcc_finalize_property_owner_facts domain-agnostic (drives off the
--      inflight rows instead of hard-coding gov), so the same finalize upserts
--      dia + gov pages. Keeps the post-load ANALYZE.
--   3. Repoints the cron to sync 'both'.
--   4. Extends v_lcc_ownership_chain_completeness + lcc_generate_chain_research_
--      tasks to cover dia as well as gov (rent-prioritized merge, same
--      idempotency — the generator now stamps cand.source_domain instead of a
--      literal 'gov').
--
-- DEPLOY ORDERING: apply AFTER the dia anon view
-- (dialysis/20260608130000_dia_v_property_owner_facts_portfolio.sql). If the dia
-- view is absent the dia pages just 404 and the dia mirror stays empty — the
-- resolver/queue degrade gracefully to the gov-only R6 behaviour (no regression,
-- the cache-or-live pattern). Everything here is additive / backward-compatible.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Sync: add the dia leg. Same signature (text) so REPLACE is clean; default
--    flips gov->both so the cron and manual calls fan out to both domains.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_sync_property_owner_facts(p_domain text DEFAULT 'both')
RETURNS TABLE(domain text, pages_fired int) AS $$
DECLARE
  v_url        text;
  v_anon_key   text;
  v_page       int;
  v_request_id bigint;
  v_pages_fired int;
  v_domain     text;
  v_domains    text[];
  v_max_pages  int;
  v_page_size  int;
BEGIN
  IF p_domain = 'both' THEN
    v_domains := ARRAY['gov','dia'];
  ELSE
    v_domains := ARRAY[p_domain];
  END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    IF v_domain NOT IN ('gov','dia') THEN
      RAISE NOTICE 'lcc_sync_property_owner_facts(%): unknown domain, skipping', v_domain;
      CONTINUE;
    END IF;

    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_url';
    SELECT decrypted_secret INTO v_anon_key
    FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_anon_key';

    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_sync_property_owner_facts(%): missing vault secret, skipping', v_domain;
      CONTINUE;
    END IF;

    -- Page size MUST be 1000: Supabase PostgREST caps responses at 1000 rows
    -- (db-max-rows) regardless of the limit param, so any larger stride silently
    -- skips rows. gov ~17.9k -> 18 pages; dia ~12.2k -> 14 pages (1000 * 15 pages
    -- = 15k cap > 12.2k). A handful of http_get fan-outs per domain — time-budgeted.
    v_page_size := 1000;
    IF v_domain = 'gov' THEN
      v_max_pages := 18;
    ELSE
      v_max_pages := 14;
    END IF;

    v_pages_fired := 0;
    FOR v_page IN 0..v_max_pages LOOP
      SELECT net.http_get(
        url := v_url || '/rest/v1/v_property_owner_facts_portfolio'
          || '?select=property_id,recorded_owner_name,true_owner_name,developer_name'
          || '&order=property_id.asc'
          || '&limit=' || v_page_size || '&offset=' || (v_page * v_page_size),
        headers := jsonb_build_object('apikey', v_anon_key, 'Authorization', 'Bearer ' || v_anon_key)
      ) INTO v_request_id;

      INSERT INTO public.lcc_owner_facts_sync_inflight (request_id, source_domain, page_offset)
      VALUES (v_request_id, v_domain, v_page * v_page_size);

      v_pages_fired := v_pages_fired + 1;
    END LOOP;

    domain := v_domain;
    pages_fired := v_pages_fired;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_sync_property_owner_facts(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Finalize: domain-agnostic. Drives off the distinct domains present in the
--    inflight queue, so dia + gov pages both upsert. Keeps the ANALYZE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_finalize_property_owner_facts()
RETURNS TABLE(domain text, finalized_requests int, rows_upserted int) AS $$
DECLARE
  v_domains   text[];
  v_domain    text;
  v_finalized int;
  v_upserted  int;
BEGIN
  SELECT array_agg(DISTINCT source_domain) INTO v_domains
  FROM public.lcc_owner_facts_sync_inflight;
  IF v_domains IS NULL THEN
    v_domains := ARRAY[]::text[];
  END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    WITH consumed AS (
      SELECT i.request_id, r.content
      FROM public.lcc_owner_facts_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = v_domain AND r.status_code = 200
    ),
    rows AS (
      SELECT jsonb_array_elements(content::jsonb) AS row FROM consumed
    ),
    upsert AS (
      INSERT INTO public.lcc_property_owner_facts (
        source_domain, source_property_id,
        recorded_owner_name, true_owner_name, developer_name, updated_at
      )
      SELECT
        v_domain, (row->>'property_id')::text,
        NULLIF(row->>'recorded_owner_name',''),
        NULLIF(row->>'true_owner_name',''),
        NULLIF(row->>'developer_name',''),
        now()
      FROM rows
      WHERE row->>'property_id' IS NOT NULL
      ON CONFLICT (source_domain, source_property_id) DO UPDATE SET
        recorded_owner_name = EXCLUDED.recorded_owner_name,
        true_owner_name     = EXCLUDED.true_owner_name,
        developer_name      = EXCLUDED.developer_name,
        updated_at          = now()
      RETURNING 1
    ),
    cleanup AS (
      DELETE FROM public.lcc_owner_facts_sync_inflight
      WHERE request_id IN (SELECT request_id FROM consumed)
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM consumed), (SELECT COUNT(*) FROM upsert)
    INTO v_finalized, v_upserted;

    domain := v_domain;
    finalized_requests := COALESCE(v_finalized, 0);
    rows_upserted := COALESCE(v_upserted, 0);
    RETURN NEXT;
  END LOOP;

  DELETE FROM public.lcc_owner_facts_sync_inflight
  WHERE issued_at < NOW() - interval '24 hours';

  -- Refresh planner stats after the bulk upsert (R6 hotfix lesson — without
  -- fresh stats the join cardinality in the priority-queue views is badly
  -- misestimated). ANALYZE is transaction-safe inside a function.
  ANALYZE public.lcc_property_owner_facts;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_finalize_property_owner_facts() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Cron: sync 'both' now. Idempotent re-registration; finalize unchanged.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-r6-owner-facts-sync')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-r6-owner-facts-sync');
    PERFORM cron.unschedule('lcc-r6-owner-facts-finalize') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-r6-owner-facts-finalize');
    PERFORM cron.schedule('lcc-r6-owner-facts-sync',     '50 4 * * *', $$SELECT public.lcc_sync_property_owner_facts('both')$$);
    PERFORM cron.schedule('lcc-r6-owner-facts-finalize', '55 4 * * *', $$SELECT public.lcc_finalize_property_owner_facts()$$);
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule lcc_sync/finalize_property_owner_facts manually.';
  END IF;
END $cron$;

-- ---------------------------------------------------------------------------
-- 4. Ownership-chain completeness + research generation: cover dia AND gov.
--    The view was gov-filtered; drop the filter (the chain CTE already groups by
--    (source_domain, source_property_id) across domains). Columns unchanged, so
--    CREATE OR REPLACE VIEW is safe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_ownership_chain_completeness
WITH (security_invoker = true) AS
WITH cur AS (
  SELECT pf.source_domain, pf.source_property_id, pf.entity_id,
         e.name AS current_owner_name, e.workspace_id, e.domain
  FROM public.lcc_entity_portfolio_facts pf
  JOIN public.entities e ON e.id = pf.entity_id AND e.merged_into_entity_id IS NULL
  WHERE pf.is_current = true
    AND COALESCE(e.behavioral_override, e.owner_role) = 'buyer'
),
chain AS (
  SELECT pf.source_domain, pf.source_property_id,
         count(*) AS owner_links,
         min(pf.ownership_start_date) AS earliest_start,
         (array_agg(e.name ORDER BY pf.ownership_start_date ASC NULLS FIRST))[1] AS earliest_known_owner,
         bool_or(COALESCE(e.behavioral_override, e.owner_role) = 'developer') AS has_developer_in_chain
  FROM public.lcc_entity_portfolio_facts pf
  JOIN public.entities e ON e.id = pf.entity_id AND e.merged_into_entity_id IS NULL
  GROUP BY pf.source_domain, pf.source_property_id
)
SELECT
  cur.source_domain,
  cur.source_property_id,
  cur.entity_id        AS current_owner_entity_id,
  cur.current_owner_name,
  cur.workspace_id,
  pof.true_owner_name,
  pof.developer_name,
  ch.owner_links,
  ch.earliest_known_owner,
  ch.earliest_start,
  COALESCE(ch.has_developer_in_chain, false) AS has_developer_in_chain,
  pa.address, pa.city, pa.state, pa.building_size_sqft,
  COALESCE(f.annual_rent, 0)::numeric AS current_annual_rent,
  (pof.developer_name IS NOT NULL OR COALESCE(ch.has_developer_in_chain, false)) AS chain_complete,
  CASE
    WHEN (pof.developer_name IS NOT NULL OR COALESCE(ch.has_developer_in_chain, false)) THEN NULL
    WHEN COALESCE(ch.owner_links, 0) <= 1 THEN 'no_prior_owners_recorded'
    ELSE 'developer_unidentified'
  END AS missing_segments
FROM cur
LEFT JOIN chain ch
  ON ch.source_domain = cur.source_domain AND ch.source_property_id = cur.source_property_id
LEFT JOIN public.lcc_property_owner_facts pof
  ON pof.source_domain = cur.source_domain AND pof.source_property_id = cur.source_property_id
LEFT JOIN public.lcc_property_attributes pa
  ON pa.source_domain = cur.source_domain AND pa.source_property_id = cur.source_property_id
LEFT JOIN public.lcc_entity_portfolio_facts f
  ON f.entity_id = cur.entity_id AND f.source_domain = cur.source_domain
 AND f.source_property_id = cur.source_property_id AND f.is_current = true;

GRANT SELECT ON public.v_lcc_ownership_chain_completeness TO authenticated;

CREATE OR REPLACE FUNCTION public.lcc_generate_chain_research_tasks(p_limit int DEFAULT 100)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_inserted int;
BEGIN
  WITH cand AS (
    SELECT c.*
    FROM public.v_lcc_ownership_chain_completeness c
    WHERE c.chain_complete = false
    ORDER BY c.current_annual_rent DESC NULLS LAST, c.source_domain, c.source_property_id
    LIMIT GREATEST(p_limit, 0)
  ),
  ins AS (
    INSERT INTO public.research_tasks (
      workspace_id, research_type, title, instructions,
      entity_id, domain, status, priority, source_record_id, source_table, metadata
    )
    SELECT
      cand.workspace_id,
      'trace_ownership_to_developer',
      'Trace ownership to the original developer: ' || COALESCE(cand.address, 'property ' || cand.source_property_id),
      'Current owner ' || COALESCE(cand.current_owner_name, '(unknown)')
        || ' is a categorized buyer (acquisition, not development). Trace '
        || COALESCE(cand.address, 'this property') || ' back through ownership_history + '
        || 'sales to the original developer, and connect each historical owner '
        || '(LCC entity + contact) so the chain is complete.'
        || CASE WHEN cand.missing_segments IS NOT NULL THEN ' Gap: ' || cand.missing_segments ELSE '' END,
      cand.current_owner_entity_id,
      cand.source_domain,
      'queued',
      LEAST(100, GREATEST(1, (cand.current_annual_rent / 10000)::int)),
      cand.source_property_id,
      'v_lcc_ownership_chain_completeness',
      jsonb_strip_nulls(jsonb_build_object(
        'true_owner_name', cand.true_owner_name,
        'earliest_known_owner', cand.earliest_known_owner,
        'missing_segments', cand.missing_segments,
        'current_annual_rent', cand.current_annual_rent))
    FROM cand
    WHERE NOT EXISTS (
      SELECT 1 FROM public.research_tasks t
      WHERE t.research_type = 'trace_ownership_to_developer'
        AND t.source_record_id = cand.source_property_id
        AND t.domain = cand.source_domain
        AND t.status IN ('queued','in_progress')
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_generate_chain_research_tasks(int) FROM PUBLIC;

COMMIT;
