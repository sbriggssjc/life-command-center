-- ===========================================================================
-- R4-A: canonicalize lcc_finalize_classified_owners() owner-entity writes
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-04
--
-- The BD owner-sync finalize (originally 20260522220000) wrote the owner-entity
-- external_identities row with source_system = v_domain || '_supabase'
-- (-> 'dia_supabase' / 'gov_supabase'), the largest source of the deprecated
-- spelling (3397 + 631 rows). This replaces it to write the canonical
-- source_system 'dia' / 'gov' (source_type stays 'true_owner'), and adds a
-- junk-name guard so phone/email/"Buyer|Seller Contacts" bleed-through never
-- becomes an owner entity.
--
-- Safe to apply independently of the Railway JS deploy — it only changes future
-- cron writes to the canonical form (which the deferred CHECK constraint
-- allows). Idempotent (CREATE OR REPLACE).
-- ===========================================================================

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
        -- R4-A junk-name guard: never mint an owner entity from CoStar panel
        -- header / phone / email bleed-through.
        AND (row->>'name') !~ '\(\d{3}\)\s*\d{3}[-.\s]?\d{4}'
        AND (row->>'name') !~ '\m\d{3}[-.]\d{3}[-.]\d{4}\M'
        AND (row->>'name') !~* '(buyer|seller)\s*contacts?'
        AND (row->>'name') !~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
        AND (row->>'name') !~* '\(\s*[pcmf]\s*\)'
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
      -- R4-A: canonical source_system (v_domain is already 'dia'/'gov'); was
      -- v_domain || '_supabase'. source_type stays 'true_owner'.
      SELECT v_ws_id, id, v_domain, 'true_owner', id::text
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
