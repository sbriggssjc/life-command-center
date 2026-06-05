-- R6 (2026-06-06): ownership-resolution gating. File 3 of 4 (LCC Opps).
-- Cross-DB sync that populates public.lcc_property_owner_facts (File 1) from the
-- gov anon view gov.v_property_owner_facts_portfolio. Isolated from the existing
-- property-attributes sync so a failure here can't touch that working path.
--
-- Pattern mirrors lcc_sync_property_attributes / _finalize (pg_net fan-out ->
-- net._http_response -> upsert). gov only this round; dia is deferred (dia owner
-- names live in separate true_owners/recorded_owners tables, not inline on
-- dia.properties — a cheap dia view is a follow-up). Graceful: missing vault
-- secret => NOTICE + skip; empty mirror => resolver/views behave exactly as R5.
--
-- DEPLOY ORDERING: apply AFTER gov 20260606120000 (the anon view) so the
-- PostgREST select resolves. If applied early the http_get just 404s that page;
-- the mirror stays empty (no error, no regression) until the gov view lands.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lcc_owner_facts_sync_inflight (
  request_id    bigint PRIMARY KEY,
  source_domain text   NOT NULL CHECK (source_domain IN ('dia','gov')),
  page_offset   int    NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.lcc_sync_property_owner_facts(p_domain text DEFAULT 'gov')
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
BEGIN
  -- gov only for now; passing 'both'/'dia' simply no-ops the dia leg.
  IF p_domain = 'both' THEN
    v_domains := ARRAY['gov'];
  ELSE
    v_domains := ARRAY[p_domain];
  END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    IF v_domain <> 'gov' THEN
      RAISE NOTICE 'lcc_sync_property_owner_facts(%): only gov is wired this round, skipping', v_domain;
      CONTINUE;
    END IF;

    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'gov_supabase_url';
    SELECT decrypted_secret INTO v_anon_key
    FROM vault.decrypted_secrets WHERE name = 'gov_supabase_anon_key';

    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_sync_property_owner_facts(gov): missing vault secret, skipping';
      CONTINUE;
    END IF;

    v_max_pages := 18;  -- gov has ~17.7k properties
    v_pages_fired := 0;
    FOR v_page IN 0..v_max_pages LOOP
      SELECT net.http_get(
        url := v_url || '/rest/v1/v_property_owner_facts_portfolio'
          || '?select=property_id,recorded_owner_name,true_owner_name,developer_name'
          || '&order=property_id.asc'
          || '&limit=1000&offset=' || (v_page * 1000),
        headers := jsonb_build_object('apikey', v_anon_key, 'Authorization', 'Bearer ' || v_anon_key)
      ) INTO v_request_id;

      INSERT INTO public.lcc_owner_facts_sync_inflight (request_id, source_domain, page_offset)
      VALUES (v_request_id, 'gov', v_page * 1000);

      v_pages_fired := v_pages_fired + 1;
    END LOOP;

    domain := 'gov';
    pages_fired := v_pages_fired;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_sync_property_owner_facts(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.lcc_finalize_property_owner_facts()
RETURNS TABLE(domain text, finalized_requests int, rows_upserted int) AS $$
DECLARE
  v_finalized int;
  v_upserted int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.lcc_owner_facts_sync_inflight WHERE source_domain = 'gov') THEN
    WITH consumed AS (
      SELECT i.request_id, r.content
      FROM public.lcc_owner_facts_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = 'gov' AND r.status_code = 200
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
        'gov', (row->>'property_id')::text,
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

    domain := 'gov';
    finalized_requests := v_finalized;
    rows_upserted := v_upserted;
    RETURN NEXT;
  END IF;

  DELETE FROM public.lcc_owner_facts_sync_inflight
  WHERE issued_at < NOW() - interval '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_finalize_property_owner_facts() FROM PUBLIC;

-- pg_cron: fan-out daily at 04:50, finalize at 04:55 (after the BD attribute
-- sync at :35/:40, so domain DBs aren't hit by everything at once). Idempotent
-- (re)registration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-r6-owner-facts-sync')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-r6-owner-facts-sync');
    PERFORM cron.unschedule('lcc-r6-owner-facts-finalize') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-r6-owner-facts-finalize');
    PERFORM cron.schedule('lcc-r6-owner-facts-sync',     '50 4 * * *', $$SELECT public.lcc_sync_property_owner_facts('gov')$$);
    PERFORM cron.schedule('lcc-r6-owner-facts-finalize', '55 4 * * *', $$SELECT public.lcc_finalize_property_owner_facts()$$);
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule lcc_sync/finalize_property_owner_facts manually.';
  END IF;
END $$;

COMMIT;
