-- ===========================================================================
-- CONNECTIVITY #1b — Step B (SQL): one-place owner-name junk guard for the bridge
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-17
--
-- The JS choke point (api/_shared/entity-link.js isJunkEntityName) gained a
-- placeholder/form-field/account-number guard so the gov + broad owner-bridge
-- passes never mint cells like "1031 Exchange Buyer" / "200512484 IRA" /
-- "Buyer 1031 Exchange: Yes". But the classified-owner SYNC bridges in SQL
-- (lcc_finalize_classified_owners), not through ensureEntityLink — so the SQL
-- side needs the same guard, in ONE place, so every SQL bridge path inherits it.
--
-- public.lcc_owner_name_is_junk(text) is the SQL mirror of isJunkEntityName's
-- owner-relevant set: the existing structural junk (phone / email / contacts-
-- header / phone-type bleed — previously inline in the finalize) PLUS the new
-- placeholder patterns. lcc_finalize_classified_owners now calls it instead of
-- repeating the regexes, keeping the canonical R4-A source_system writes and the
-- 2-col-shape return byte-identical otherwise.
--
-- IMMUTABLE / address-safe / owner-safe (the JS regression set passes): a real
-- street-numbered owner ("1121 California Avenue LLC") never matches the bare-
-- number anchor; a name that merely contains "1031" ("Cottonwood 1031
-- Properties") never matches the exchange-buyer anchor. Idempotent.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.lcc_owner_name_is_junk(p_name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name IS NULL OR btrim(p_name) = '' OR (
    -- Structural junk (phone / email / contacts-header / phone-type bleed).
       p_name ~  '\(\d{3}\)\s*\d{3}[-.\s]?\d{4}'
    OR p_name ~  '\m\d{3}[-.]\d{3}[-.]\d{4}\M'
    OR p_name ~* '(buyer|seller)\s*contacts?'
    OR p_name ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    OR p_name ~* '\(\s*[pcmf]\s*\)'
    -- Placeholder / form-field / account-number owner cells (CONNECTIVITY #1b).
    OR p_name ~* '^\s*\d{5,}\s*(ira|llc|l\.l\.c|lp|llp|inc|corp|trust)?\s*$'
    OR p_name ~* '^\s*\d{4,}\s+ira\s*$'
    OR p_name ~* ':\s*(yes|no)\s*$'
    OR p_name ~* '^\s*(1031\s+)?exchange\s+buyer\s*$'
    OR p_name ~* '^\s*(buyer|seller|escrow)\s*$'
  );
$$;

COMMENT ON FUNCTION public.lcc_owner_name_is_junk(text) IS
  'CONNECTIVITY #1b: SQL mirror of entity-link.js isJunkEntityName (owner set). '
  'True when an owner name is structural junk (phone/email/contacts-header/phone-'
  'type) or a placeholder/form-field/account-number cell. The single SQL guard '
  'for every owner-bridge path (lcc_finalize_classified_owners + the gov/broad '
  'passes). Address-safe + owner-safe.';

-- ---------------------------------------------------------------------------
-- Rewire lcc_finalize_classified_owners to call the one guard (replaces the
-- five inline structural regexes). Everything else — canonical R4-A
-- source_system, the upsert, the 2-col return shape — is unchanged.
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
        -- CONNECTIVITY #1b: single junk guard (was five inline regexes).
        AND NOT public.lcc_owner_name_is_junk(row->>'name')
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
