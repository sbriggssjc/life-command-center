-- CONTACT-SELECTION Slice 1 (2026-06-20) — LCC Opps. The owner-keyed mirror of
-- the domain v_owner_contact_signals_portfolio views + its isolated cross-DB
-- sync (pg_net fan-out -> net._http_response -> upsert), modelled exactly on
-- lcc_sync_property_owner_facts. ISOLATED from the existing owner-facts /
-- attribute syncs so a failure here can't touch a working path. Drop the table
-- -> zero trace (reversible). Empty mirror => the candidate views fall back to
-- LCC-native signals only (graceful, no regression).
--
-- Keyed on (source_domain, source_true_owner_id) where source_true_owner_id is
-- the domain true_owner uuid as text — the SAME id LCC's owner-entity bridge
-- carries in external_identities(source_system=<dia|gov>, source_type='true_owner',
-- external_id=<true_owner_id>). So the candidate view joins the mirror straight
-- onto the bridged LCC owner entity.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lcc_owner_contact_signals (
  source_domain        text NOT NULL CHECK (source_domain IN ('dia','gov')),
  source_true_owner_id text NOT NULL,
  true_owner_name      text,
  candidates           jsonb NOT NULL DEFAULT '[]'::jsonb,
  has_reg_address      boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_domain, source_true_owner_id)
);

-- Full-replace each sync tick (bounded, ~few hundred rows) — harden autovacuum
-- so churn is reclaimed (sf_sync_log lesson), though the table is tiny.
ALTER TABLE public.lcc_owner_contact_signals
  SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05,
       autovacuum_vacuum_threshold = 200, autovacuum_analyze_threshold = 200);

CREATE TABLE IF NOT EXISTS public.lcc_owner_signal_sync_inflight (
  request_id    bigint PRIMARY KEY,
  source_domain text NOT NULL CHECK (source_domain IN ('dia','gov')),
  page_offset   int  NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.lcc_sync_owner_contact_signals(p_domain text DEFAULT 'both')
RETURNS TABLE(domain text, pages_fired int) AS $$
DECLARE
  v_url text; v_anon_key text; v_page int; v_request_id bigint;
  v_pages_fired int; v_domain text; v_domains text[]; v_max_pages int;
BEGIN
  IF p_domain = 'both' THEN v_domains := ARRAY['gov','dia'];
  ELSE v_domains := ARRAY[p_domain]; END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    SELECT decrypted_secret INTO v_url      FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_url';
    SELECT decrypted_secret INTO v_anon_key FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_anon_key';
    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_sync_owner_contact_signals(%): missing vault secret, skipping', v_domain;
      CONTINUE;
    END IF;

    v_max_pages := 5;  -- bounded: the signal views are ~hundreds of owners, not the full book
    v_pages_fired := 0;
    FOR v_page IN 0..v_max_pages LOOP
      SELECT net.http_get(
        url := v_url || '/rest/v1/v_owner_contact_signals_portfolio'
          || '?select=true_owner_id,true_owner_name,candidates,has_reg_address'
          || '&order=true_owner_id.asc'
          || '&limit=1000&offset=' || (v_page * 1000),
        headers := jsonb_build_object('apikey', v_anon_key, 'Authorization', 'Bearer ' || v_anon_key)
      ) INTO v_request_id;

      INSERT INTO public.lcc_owner_signal_sync_inflight (request_id, source_domain, page_offset)
      VALUES (v_request_id, v_domain, v_page * 1000);
      v_pages_fired := v_pages_fired + 1;
    END LOOP;

    domain := v_domain; pages_fired := v_pages_fired; RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_sync_owner_contact_signals(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.lcc_finalize_owner_contact_signals()
RETURNS TABLE(finalized_requests int, rows_upserted int) AS $$
DECLARE v_finalized int; v_upserted int;
BEGIN
  WITH consumed AS (
    SELECT i.request_id, i.source_domain, r.content
    FROM public.lcc_owner_signal_sync_inflight i
    JOIN net._http_response r ON r.id = i.request_id
    WHERE r.status_code = 200
  ),
  rows AS (
    SELECT source_domain, jsonb_array_elements(content::jsonb) AS row FROM consumed
  ),
  upsert AS (
    INSERT INTO public.lcc_owner_contact_signals (
      source_domain, source_true_owner_id, true_owner_name, candidates, has_reg_address, updated_at)
    SELECT source_domain, (row->>'true_owner_id')::text,
           NULLIF(row->>'true_owner_name',''),
           COALESCE(row->'candidates', '[]'::jsonb),
           COALESCE((row->>'has_reg_address')::boolean, false),
           now()
    FROM rows
    WHERE row->>'true_owner_id' IS NOT NULL
    ON CONFLICT (source_domain, source_true_owner_id) DO UPDATE SET
      true_owner_name = EXCLUDED.true_owner_name,
      candidates      = EXCLUDED.candidates,
      has_reg_address = EXCLUDED.has_reg_address,
      updated_at      = now()
    RETURNING 1
  ),
  cleanup AS (
    DELETE FROM public.lcc_owner_signal_sync_inflight
    WHERE request_id IN (SELECT request_id FROM consumed) RETURNING 1
  )
  SELECT (SELECT count(*) FROM consumed), (SELECT count(*) FROM upsert)
  INTO v_finalized, v_upserted;

  DELETE FROM public.lcc_owner_signal_sync_inflight WHERE issued_at < now() - interval '24 hours';
  ANALYZE public.lcc_owner_contact_signals;

  finalized_requests := v_finalized; rows_upserted := v_upserted; RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_finalize_owner_contact_signals() FROM PUBLIC;

-- pg_cron: gentle daily refresh (signals are near-static). Fan-out 05:00,
-- finalize 05:05 — after owner-facts (04:50/04:55), before the mirror reconcile
-- (05:10/05:15). Idempotent (re)registration.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-owner-contact-signals-sync')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-owner-contact-signals-sync');
    PERFORM cron.unschedule('lcc-owner-contact-signals-finalize') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-owner-contact-signals-finalize');
    PERFORM cron.schedule('lcc-owner-contact-signals-sync',     '0 5 * * *', $job$SELECT public.lcc_sync_owner_contact_signals('both')$job$);
    PERFORM cron.schedule('lcc-owner-contact-signals-finalize', '5 5 * * *', $job$SELECT public.lcc_finalize_owner_contact_signals()$job$);
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule lcc_sync/finalize_owner_contact_signals manually.';
  END IF;
END $cron$;

COMMIT;
