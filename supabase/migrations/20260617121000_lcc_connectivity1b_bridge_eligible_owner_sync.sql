-- ===========================================================================
-- CONNECTIVITY #1b — durable steady-state: bridge in-use owners (any archetype)
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-17
--
-- The Step-C per-domain v_bridge_eligible_owners views define WHICH owners
-- belong in the entity graph (in-use, non-operator, non-junk) off the LIVE join,
-- not the stale current_property_count. This is their consumer: a parallel
-- fire/finalize sync (modeled on the proven lcc_sync/finalize_classified_owners
-- pg_net pattern) that mints the eligible owners' LCC entities +
-- external_identities(<domain>, true_owner).
--
-- Differences from the classified sync (the #1b doctrine):
--   * Source is v_bridge_eligible_owners (in-use real owners), not the
--     classified-only true_owners filter.
--   * owner_role is kept AS-IS from the view ('unknown' is honest for the
--     pre-classification set) and is NEVER overwritten — the finalize INSERTs
--     ON CONFLICT (id) DO NOTHING, so an already-classified/bridged entity keeps
--     its curated archetype. (The existing classified cron still upgrades any of
--     these to a real archetype on top — enrichment, automatic.)
--   * Every mint passes public.lcc_owner_name_is_junk (the one-place SQL guard).
--   * New entities are tagged metadata.bridge_source='connectivity_inuse_owner'
--     so the bridge is reversible by tag (mirrors the #1 batch's tag).
--
-- GATED / CAPPED BY DESIGN: there is NO cron. Each pass is a deliberate capped
-- call (p_current_only / p_max_pages / p_page_size), per the project's
-- "capped batch -> gate -> drain, every pass" doctrine. Scott green-lights each
-- pass. Reversible: every minted entity carries the bridge_source tag.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE). Empty/absent view
-- => no-op (graceful), exactly like the classified sync.
-- ===========================================================================

-- Inflight tracker — separate from the classified sync so the two never collide.
CREATE TABLE IF NOT EXISTS public.lcc_bridge_eligible_sync_inflight (
  request_id    bigint PRIMARY KEY,
  source_domain text   NOT NULL CHECK (source_domain IN ('dia','gov')),
  page_offset   int    NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_bridge_eligible_sync_inflight IS
  'CONNECTIVITY #1b: tracks pg_net request_ids issued by '
  'lcc_sync_bridge_eligible_owners() for lcc_finalize_bridge_eligible_owners().';

-- ---------------------------------------------------------------------------
-- Fire: paginate v_bridge_eligible_owners for the named domain(s).
--   p_current_only  TRUE  -> conservative tier (is_current_owner=true)
--                   FALSE -> broad in-use set
--   p_max_pages / p_page_size  -> per-pass cap (gate-then-drain discipline)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_sync_bridge_eligible_owners(
  p_domain       text    DEFAULT 'both',
  p_current_only boolean DEFAULT true,
  p_max_pages    int     DEFAULT 5,
  p_page_size    int     DEFAULT 1000
)
RETURNS TABLE(domain text, pages_fired int) AS $$
DECLARE
  v_url      text;
  v_anon_key text;
  v_secret_url_name text;
  v_secret_key_name text;
  v_page int;
  v_request_id bigint;
  v_pages_fired int;
  v_domain text;
  v_domains text[];
  v_filter text;
BEGIN
  v_domains := CASE WHEN p_domain = 'both' THEN ARRAY['dia','gov'] ELSE ARRAY[p_domain] END;
  v_filter  := CASE WHEN p_current_only THEN '&is_current_owner=is.true' ELSE '' END;

  FOREACH v_domain IN ARRAY v_domains LOOP
    v_secret_url_name := CASE v_domain WHEN 'dia' THEN 'dia_supabase_url' WHEN 'gov' THEN 'gov_supabase_url' END;
    v_secret_key_name := CASE v_domain WHEN 'dia' THEN 'dia_supabase_anon_key' WHEN 'gov' THEN 'gov_supabase_anon_key' END;

    SELECT decrypted_secret INTO v_url     FROM vault.decrypted_secrets WHERE name = v_secret_url_name;
    SELECT decrypted_secret INTO v_anon_key FROM vault.decrypted_secrets WHERE name = v_secret_key_name;

    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_sync_bridge_eligible_owners(%): missing vault secret, skipping', v_domain;
      CONTINUE;
    END IF;

    v_pages_fired := 0;
    FOR v_page IN 0..(p_max_pages - 1) LOOP
      SELECT net.http_get(
        url := v_url || '/rest/v1/v_bridge_eligible_owners'
          || '?select=true_owner_id,name,owner_role,owner_role_source,owner_role_confidence,is_current_owner'
          || v_filter
          || '&order=true_owner_id.asc'
          || '&limit=' || p_page_size || '&offset=' || (v_page * p_page_size),
        headers := jsonb_build_object('apikey', v_anon_key, 'Authorization', 'Bearer ' || v_anon_key)
      ) INTO v_request_id;

      INSERT INTO public.lcc_bridge_eligible_sync_inflight (request_id, source_domain, page_offset)
      VALUES (v_request_id, v_domain, v_page * p_page_size);

      v_pages_fired := v_pages_fired + 1;
    END LOOP;

    domain := v_domain;
    pages_fired := v_pages_fired;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_sync_bridge_eligible_owners(text, boolean, int, int) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Finalize: mint NEW eligible owners (fill-blanks; never clobber a curated
-- archetype) + ensure the external_identities link, then clear inflight.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_finalize_bridge_eligible_owners()
RETURNS TABLE(domain text, finalized_requests int, minted int, linked int) AS $$
DECLARE
  v_ws_id constant uuid := 'a0000000-0000-0000-0000-000000000001'::uuid;
  v_domain text;
  v_finalized int;
  v_minted int;
  v_linked int;
BEGIN
  FOR v_domain IN SELECT DISTINCT source_domain FROM public.lcc_bridge_eligible_sync_inflight LOOP
    WITH consumed AS (
      SELECT i.request_id, r.content
      FROM public.lcc_bridge_eligible_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = v_domain AND r.status_code = 200
    ),
    all_rows AS (
      SELECT jsonb_array_elements(content::jsonb) AS row FROM consumed
    ),
    src AS (
      SELECT DISTINCT ON ((row->>'true_owner_id')::uuid)
        (row->>'true_owner_id')::uuid AS tid,
        row->>'name'  AS name,
        NULLIF(row->>'owner_role','') AS role,
        NULLIF(row->>'owner_role_source','') AS src_tag,
        NULLIF(row->>'owner_role_confidence','')::numeric AS conf
      FROM all_rows
      WHERE row->>'true_owner_id' IS NOT NULL
        AND row->>'name' IS NOT NULL
        AND NOT public.lcc_owner_name_is_junk(row->>'name')
    ),
    -- Mint NEW owners only. ON CONFLICT (id) DO NOTHING => an existing entity
    -- (already classified/bridged) keeps its curated owner_role untouched.
    minted_rows AS (
      INSERT INTO public.entities (id, workspace_id, entity_type, name, canonical_name,
        owner_role, owner_role_source, owner_role_confidence, domain, metadata)
      SELECT tid, v_ws_id, 'organization', name, LOWER(TRIM(name)),
        COALESCE(role, 'unknown'), src_tag, conf, v_domain,
        jsonb_build_object('bridge_source', 'connectivity_inuse_owner')
      FROM src
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    ),
    -- Ensure the external identity for EVERY eligible owner that now exists as
    -- an entity (newly minted OR pre-existing) — idempotent.
    linked_rows AS (
      INSERT INTO public.external_identities (workspace_id, entity_id, source_system, source_type, external_id)
      SELECT v_ws_id, s.tid, v_domain, 'true_owner', s.tid::text
      FROM src s
      JOIN public.entities e ON e.id = s.tid
      ON CONFLICT (workspace_id, source_system, source_type, external_id) DO NOTHING
      RETURNING entity_id
    ),
    cleanup AS (
      DELETE FROM public.lcc_bridge_eligible_sync_inflight
      WHERE request_id IN (SELECT request_id FROM consumed)
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM consumed),
           (SELECT COUNT(*) FROM minted_rows),
           (SELECT COUNT(*) FROM linked_rows)
    INTO v_finalized, v_minted, v_linked;

    domain := v_domain;
    finalized_requests := v_finalized;
    minted := v_minted;
    linked := v_linked;
    RETURN NEXT;
  END LOOP;

  -- Sweep stale inflight rows older than 24h that never got a response.
  DELETE FROM public.lcc_bridge_eligible_sync_inflight
  WHERE issued_at < NOW() - interval '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_finalize_bridge_eligible_owners() FROM PUBLIC;

COMMENT ON FUNCTION public.lcc_sync_bridge_eligible_owners(text, boolean, int, int) IS
  'CONNECTIVITY #1b durable bridge (DORMANT — no cron; capped per-pass call, '
  'Scott-gated). Fires paginated v_bridge_eligible_owners reads. p_current_only '
  'TRUE = conservative tier. Pair: lcc_finalize_bridge_eligible_owners().';
