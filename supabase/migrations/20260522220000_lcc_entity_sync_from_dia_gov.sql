-- LCC entity sync from dia/gov true_owners
--
-- Pulls classified owner rows (developer / buyer / operator / user_owner /
-- seller_flipper) from the dialysis and government Supabase projects via
-- pg_net + PostgREST and upserts them into public.entities, reusing the
-- source true_owner_id as the LCC entities.id so the link is idempotent and
-- callers in either project can resolve the same primary key.
--
-- Each upserted entity also gets an external_identities row tagging the
-- source system, which lets the priority queue (v_priority_queue) and
-- cross-vertical portfolio views (Topic A3) hop from an LCC entity back to
-- the originating dia/gov record.
--
-- This migration:
--   1. Expands entities_owner_role_source_check to include the v5 fact-based
--      source tags emitted by v_dia_owner_role_classification and the
--      equivalent gov view.
--   2. Adds public.lcc_sync_classified_owners(domain text) which fires the
--      pg_net request(s) and stashes the request_ids in a tracking table
--      (lcc_entity_sync_inflight) for a second pass to consume.
--   3. Adds public.lcc_finalize_classified_owners() which reads the
--      tracked responses, upserts into entities + external_identities, and
--      clears the inflight rows.
--
-- The split between fire and finalize keeps the work inside the async
-- pg_net model — a cron pass at :05 fires the requests and a follow-up at
-- :10 finalizes whatever has landed. Initial backfill was already applied
-- manually on 2026-05-22 (627 dia + 3376 gov rows).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Expand the owner_role_source check constraint to include v5 fact-based
--    source tags (mirrors dia/gov check constraints).
-- ---------------------------------------------------------------------------
ALTER TABLE public.entities
  DROP CONSTRAINT IF EXISTS entities_owner_role_source_check;

ALTER TABLE public.entities
  ADD CONSTRAINT entities_owner_role_source_check CHECK (
    owner_role_source IS NULL OR owner_role_source = ANY (ARRAY[
      'computed'::text,
      'manual'::text,
      'behavioral_override'::text,
      'legacy_heuristic'::text,
      'bts_delivered'::text,
      'manual_operator_flag'::text,
      'tenant_relationship_value_creation'::text,
      'acquired_after_lease'::text,
      'sale_leaseback_seller'::text,
      'bts_explicit_with_first_gen'::text,
      'bts_inferred_seller_first_gen'::text,
      'first_landlord_first_gen'::text,
      'pre_lease_owner'::text,
      'sold_after_lease'::text,
      'merged_duplicate'::text,
      'dia_sync'::text,
      'gov_sync'::text
    ])
  );

-- ---------------------------------------------------------------------------
-- 2. Inflight tracking table — one row per pg_net request we have not yet
--    finalized.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_entity_sync_inflight (
  request_id    bigint PRIMARY KEY,
  source_domain text   NOT NULL CHECK (source_domain IN ('dia','gov')),
  page_offset   int    NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_entity_sync_inflight IS
  'Tracks pg_net request_ids issued by lcc_sync_classified_owners() that '
  'lcc_finalize_classified_owners() will consume on its next run.';

-- ---------------------------------------------------------------------------
-- 3. Fire phase: lcc_sync_classified_owners(domain)
--
-- Issues paginated PostgREST GETs against the named domain's true_owners
-- table. The Supabase URL + anon key are read from Vault to keep secrets out
-- of source control. Returns the number of pages fired.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_sync_classified_owners(p_domain text DEFAULT 'both')
RETURNS TABLE(domain text, pages_fired int) AS $$
DECLARE
  v_url      text;
  v_anon_key text;
  v_secret_url_name text;
  v_secret_key_name text;
  v_page_offset int;
  v_request_id bigint;
  v_pages_fired int;
  v_domain text;
  v_domains text[];
BEGIN
  IF p_domain = 'both' THEN
    v_domains := ARRAY['dia','gov'];
  ELSE
    v_domains := ARRAY[p_domain];
  END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    v_secret_url_name := CASE v_domain
      WHEN 'dia' THEN 'dia_supabase_url'
      WHEN 'gov' THEN 'gov_supabase_url'
    END;
    v_secret_key_name := CASE v_domain
      WHEN 'dia' THEN 'dia_supabase_anon_key'
      WHEN 'gov' THEN 'gov_supabase_anon_key'
    END;

    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = v_secret_url_name;
    SELECT decrypted_secret INTO v_anon_key
    FROM vault.decrypted_secrets WHERE name = v_secret_key_name;

    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_sync_classified_owners(%): missing vault secret % or %, skipping',
        v_domain, v_secret_url_name, v_secret_key_name;
      CONTINUE;
    END IF;

    -- Fire 5 pages of 1000 rows each = 5000 row ceiling per pass per domain.
    -- gov caps at ~3.4k classified rows today; dia at ~630; both fit
    -- comfortably with headroom for growth.
    v_pages_fired := 0;
    FOR v_page_offset IN 0..4 LOOP
      SELECT net.http_get(
        url := v_url || '/rest/v1/true_owners'
          || '?select=true_owner_id,name,owner_role,owner_role_source,owner_role_confidence'
          || '&owner_role=in.(developer,buyer,operator,user_owner,seller_flipper)'
          || '&merged_into_true_owner_id=is.null'
          || '&order=true_owner_id.asc'
          || '&limit=1000&offset=' || (v_page_offset * 1000),
        headers := jsonb_build_object(
          'apikey', v_anon_key,
          'Authorization', 'Bearer ' || v_anon_key
        )
      ) INTO v_request_id;

      INSERT INTO public.lcc_entity_sync_inflight
        (request_id, source_domain, page_offset)
      VALUES (v_request_id, v_domain, v_page_offset * 1000);

      v_pages_fired := v_pages_fired + 1;
    END LOOP;

    domain := v_domain;
    pages_fired := v_pages_fired;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_sync_classified_owners(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. Finalize phase: lcc_finalize_classified_owners()
--
-- Reads net._http_response for any inflight request_id, upserts the rows
-- into entities (using true_owner_id as the LCC entity id) and writes the
-- external_identities link, then clears the inflight row.
--
-- Idempotent: re-running with no new responses is a no-op. Responses still
-- pending (no row in _http_response yet) are left in inflight for the next
-- pass to pick up.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_finalize_classified_owners()
RETURNS TABLE(domain text, finalized_requests int, upserted int, linked int) AS $$
DECLARE
  v_ws_id constant uuid := 'a0000000-0000-0000-0000-000000000001'::uuid;
  v_domain text;
  v_finalized int;
  v_upserted int;
  v_linked int;
BEGIN
  FOR v_domain IN SELECT DISTINCT source_domain FROM public.lcc_entity_sync_inflight LOOP
    WITH consumed AS (
      SELECT i.request_id, r.content, r.status_code
      FROM public.lcc_entity_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = v_domain
        AND r.status_code = 200
    ),
    all_rows AS (
      SELECT jsonb_array_elements(content::jsonb) AS row
      FROM consumed
    ),
    src AS (
      SELECT
        (row->>'true_owner_id')::uuid AS tid,
        row->>'name' AS name,
        row->>'owner_role' AS role,
        row->>'owner_role_source' AS src_tag,
        COALESCE((row->>'owner_role_confidence')::numeric, 0.75) AS conf
      FROM all_rows
      WHERE row->>'true_owner_id' IS NOT NULL
        AND row->>'name' IS NOT NULL
        AND row->>'owner_role' IN ('developer','buyer','operator','user_owner','seller_flipper')
        AND row->>'owner_role_source' IS NOT NULL
    ),
    upserted_rows AS (
      INSERT INTO public.entities (id, workspace_id, entity_type, name, canonical_name,
        owner_role, owner_role_source, owner_role_confidence, domain)
      SELECT tid, v_ws_id, 'organization',
        name, LOWER(TRIM(name)), role, src_tag, conf, v_domain
      FROM src
      ON CONFLICT (id) DO UPDATE SET
        owner_role = EXCLUDED.owner_role,
        owner_role_source = EXCLUDED.owner_role_source,
        owner_role_confidence = EXCLUDED.owner_role_confidence,
        domain = CASE
          WHEN public.entities.domain IS NULL OR public.entities.domain = ''
            THEN EXCLUDED.domain
          ELSE public.entities.domain
        END,
        updated_at = NOW()
      RETURNING id
    ),
    linked_rows AS (
      INSERT INTO public.external_identities
        (workspace_id, entity_id, source_system, source_type, external_id)
      SELECT v_ws_id, id, v_domain || '_supabase', 'true_owner', id::text
      FROM upserted_rows
      ON CONFLICT (workspace_id, source_system, source_type, external_id) DO NOTHING
      RETURNING entity_id
    ),
    cleanup AS (
      DELETE FROM public.lcc_entity_sync_inflight
      WHERE request_id IN (SELECT request_id FROM consumed)
      RETURNING 1
    )
    SELECT
      (SELECT COUNT(*) FROM consumed),
      (SELECT COUNT(*) FROM upserted_rows),
      (SELECT COUNT(*) FROM linked_rows)
    INTO v_finalized, v_upserted, v_linked;

    domain := v_domain;
    finalized_requests := v_finalized;
    upserted := v_upserted;
    linked := v_linked;
    RETURN NEXT;
  END LOOP;

  -- Sweep stale inflight rows older than 24h that never got a response
  DELETE FROM public.lcc_entity_sync_inflight
  WHERE issued_at < NOW() - interval '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_finalize_classified_owners() FROM PUBLIC;

COMMIT;
