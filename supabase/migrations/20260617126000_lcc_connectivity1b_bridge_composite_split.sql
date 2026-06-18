-- ===========================================================================
-- CONNECTIVITY #1b — Condition #2: ;-composite split in the SQL bridge path
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-17
--
-- The broad owner-bridge runs through lcc_finalize_bridge_eligible_owners (SQL),
-- NOT ensureEntityLink — so the JS splitCompositeOwnerName guard does not apply
-- on that path, and a composite owner cell ("919 Investments LLC; Smbc Leasing &
-- Finance Inc", "Dfwlt 821 Cleveland LLC; Wcol LLC") would mint as ONE dirty
-- entity. Mirror the JS logic in SQL so the bridge mints the FIRM-MOST segment
-- and stashes the original (reversible via metadata.composite_source_name).
--
-- SQL mirror of api/_shared/entity-link.js splitCompositeOwnerName:
--   * split on '|' (always) else ';'
--   * ';' person-couple guard — only split a ';' name when some segment carries
--     a firm suffix (so "Irwin Sherry; Dalia Sherry" mints WHOLE, not junk)
--   * firm-most = first firm-suffixed segment, else the trailing segment
-- Conservative: this is the JS "ambiguous" behavior (mint firm-most + stash) for
-- every composite; the JS clean "<person> | <firm>" person-attach enrichment
-- stays on the ensureEntityLink path only. Idempotent (CREATE OR REPLACE).
-- ===========================================================================

-- Firm-suffix detector (mirror of entity-link.js ENTITY_FIRM_SUFFIX_RE).
CREATE OR REPLACE FUNCTION public.lcc_name_has_firm_suffix(p_name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name IS NOT NULL AND p_name ~* '\m(LLC|L\.L\.C|LP|LLP|Inc|Incorporated|Corp|Corporation|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Property|Associates|Group|Management|Mgmt|Development|Developers|Investments|Investors|Enterprises|Bancorp|Bank|Co)\M';
$$;

-- Resolve a (possibly composite) owner name to the entity name to mint: the
-- firm-most segment for a real composite, else the original name unchanged.
CREATE OR REPLACE FUNCTION public.lcc_composite_owner_firm(p_name text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_delim text;
  v_segs  text[];
  v_firm  text;
BEGIN
  IF p_name IS NULL THEN RETURN p_name; END IF;
  IF position('|' IN p_name) > 0 THEN v_delim := '|';
  ELSIF position(';' IN p_name) > 0 THEN v_delim := ';';
  ELSE RETURN p_name; END IF;

  SELECT array_agg(s) INTO v_segs FROM (
    SELECT btrim(regexp_replace(x, ',\s*$', '')) AS s
    FROM unnest(string_to_array(p_name, v_delim)) AS x
  ) t WHERE btrim(t.s) <> '';

  IF v_segs IS NULL OR array_length(v_segs, 1) < 2 THEN RETURN p_name; END IF;

  -- ';' person-couple / no-firm guard: mint whole (NOT junk) unless a firm-
  -- suffixed segment is present (a clear org composite).
  IF v_delim = ';' AND NOT EXISTS (
    SELECT 1 FROM unnest(v_segs) z WHERE public.lcc_name_has_firm_suffix(z)
  ) THEN
    RETURN p_name;
  END IF;

  -- firm-most: first firm-suffixed segment, else the trailing segment.
  SELECT z INTO v_firm
  FROM unnest(v_segs) WITH ORDINALITY AS u(z, ord)
  WHERE public.lcc_name_has_firm_suffix(z)
  ORDER BY ord LIMIT 1;

  RETURN COALESCE(v_firm, v_segs[array_length(v_segs, 1)]);
END;
$$;

COMMENT ON FUNCTION public.lcc_composite_owner_firm(text) IS
  'CONNECTIVITY #1b: SQL mirror of splitCompositeOwnerName — resolves a composite '
  'owner name to the firm-most segment (so the SQL bridge mints a clean firm, not '
  'a dirty composite); returns the original unchanged for non-composites and ;-'
  'person-couples. The bridge stashes the original in metadata.composite_source_name.';

-- ---------------------------------------------------------------------------
-- Finalize now mints the firm-most segment + stashes the original composite.
-- Everything else (separate-statement mint/link, fill-blanks ON CONFLICT DO
-- NOTHING, junk guard, 2-col-ish return shape) is unchanged from
-- 20260617122000.
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
    DROP TABLE IF EXISTS _bridge_consumed;
    DROP TABLE IF EXISTS _bridge_src;

    CREATE TEMP TABLE _bridge_consumed ON COMMIT DROP AS
      SELECT i.request_id, r.content
      FROM public.lcc_bridge_eligible_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = v_domain AND r.status_code = 200;

    CREATE TEMP TABLE _bridge_src ON COMMIT DROP AS
      SELECT DISTINCT ON (tid)
        tid, name,
        public.lcc_composite_owner_firm(name) AS resolved_name,
        role, src_tag, conf
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

    -- Statement 1: mint NEW owners (firm-most segment; stash original when split).
    WITH m AS (
      INSERT INTO public.entities (id, workspace_id, entity_type, name, canonical_name,
        owner_role, owner_role_source, owner_role_confidence, domain, metadata)
      SELECT tid, v_ws_id, 'organization', resolved_name, LOWER(TRIM(resolved_name)),
        COALESCE(role, 'unknown'), src_tag, conf, v_domain,
        jsonb_build_object('bridge_source', 'connectivity_inuse_owner')
          || CASE WHEN resolved_name <> name
                  THEN jsonb_build_object('composite_source_name', name)
                  ELSE '{}'::jsonb END
      FROM _bridge_src
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    )
    SELECT COUNT(*) INTO v_minted FROM m;

    -- Statement 2 (separate -> sees the just-minted entities): ensure identities.
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
