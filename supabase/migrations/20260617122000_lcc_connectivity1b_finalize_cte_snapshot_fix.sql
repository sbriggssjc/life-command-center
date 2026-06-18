-- ===========================================================================
-- CONNECTIVITY #1b — fix: lcc_finalize_bridge_eligible_owners CTE-snapshot bug
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-17
--
-- Caught on the capped-first dia conservative pass (5 minted / 0 linked): the
-- single mega-CTE finalize put the entity INSERT (minted_rows) and the identity
-- INSERT (linked_rows) in the SAME statement. Postgres runs all CTEs of one
-- statement against one snapshot, so linked_rows' `JOIN entities` did NOT see
-- the rows minted_rows had just inserted — the 5 brand-new entities got no
-- external_identities(dia, true_owner) link (the whole point of the bridge).
--
-- Fix: split mint and link into SEPARATE statements (the link statement runs
-- after the mint statement and therefore sees the new entities), keyed off a
-- per-domain temp table of the eligible rows. The link INSERTs for ALL eligible
-- ids (newly minted OR pre-existing), ON CONFLICT DO NOTHING (idempotent). Return
-- shape unchanged. Capped/gated/dormant posture unchanged (no cron).
-- ===========================================================================

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
    DROP TABLE IF EXISTS _bridge_consumed;
    DROP TABLE IF EXISTS _bridge_src;

    CREATE TEMP TABLE _bridge_consumed ON COMMIT DROP AS
      SELECT i.request_id, r.content
      FROM public.lcc_bridge_eligible_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = v_domain AND r.status_code = 200;

    CREATE TEMP TABLE _bridge_src ON COMMIT DROP AS
      SELECT DISTINCT ON (tid) tid, name, role, src_tag, conf
      FROM (
        SELECT (row->>'true_owner_id')::uuid AS tid,
               row->>'name' AS name,
               NULLIF(row->>'owner_role','') AS role,
               NULLIF(row->>'owner_role_source','') AS src_tag,
               NULLIF(row->>'owner_role_confidence','')::numeric AS conf
        FROM (SELECT jsonb_array_elements(content::jsonb) AS row FROM _bridge_consumed) a
        WHERE row->>'true_owner_id' IS NOT NULL
          AND row->>'name' IS NOT NULL
          AND NOT public.lcc_owner_name_is_junk(row->>'name')
      ) s
      ORDER BY tid;

    -- Statement 1: mint NEW owners only (never clobber a curated archetype).
    WITH m AS (
      INSERT INTO public.entities (id, workspace_id, entity_type, name, canonical_name,
        owner_role, owner_role_source, owner_role_confidence, domain, metadata)
      SELECT tid, v_ws_id, 'organization', name, LOWER(TRIM(name)),
        COALESCE(role, 'unknown'), src_tag, conf, v_domain,
        jsonb_build_object('bridge_source', 'connectivity_inuse_owner')
      FROM _bridge_src
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    )
    SELECT COUNT(*) INTO v_minted FROM m;

    -- Statement 2 (separate -> sees the just-minted entities): ensure the
    -- external identity for EVERY eligible owner.
    WITH l AS (
      INSERT INTO public.external_identities (workspace_id, entity_id, source_system, source_type, external_id)
      SELECT v_ws_id, tid, v_domain, 'true_owner', tid::text
      FROM _bridge_src
      ON CONFLICT (workspace_id, source_system, source_type, external_id) DO NOTHING
      RETURNING entity_id
    )
    SELECT COUNT(*) INTO v_linked FROM l;

    SELECT COUNT(*) INTO v_finalized FROM _bridge_consumed;

    DELETE FROM public.lcc_bridge_eligible_sync_inflight
    WHERE request_id IN (SELECT request_id FROM _bridge_consumed);

    DROP TABLE _bridge_consumed;
    DROP TABLE _bridge_src;

    domain := v_domain;
    finalized_requests := v_finalized;
    minted := v_minted;
    linked := v_linked;
    RETURN NEXT;
  END LOOP;

  DELETE FROM public.lcc_bridge_eligible_sync_inflight
  WHERE issued_at < NOW() - interval '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_finalize_bridge_eligible_owners() FROM PUBLIC;
