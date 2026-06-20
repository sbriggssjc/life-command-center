-- CONTACT-SELECTION Slice 4 — Phase A routing (LCC Opps): has_deed_doc → parse_deed_signatory
-- ----------------------------------------------------------------------------
-- Carries the dia `has_deed_doc` signal through the owner-signals mirror and
-- routes owners that own a recorded deed/PSA/master doc to the authority-1
-- `parse_deed_signatory` enrichment (over SOS / address). ~14 of the 78
-- contactless dia owners. Additive + reversible; cache-or-live-safe.
--
-- DEPLOY ORDER: apply the dia view (20260620140000_dia_owner_contact_signals_deed_doc.sql)
-- FIRST. The sync selects `*` so the gov leg (no has_deed_doc column) does NOT
-- 400 — gov rows simply carry has_deed_doc=false (gov Phase A deferred).
-- The Phase-A drain stays OFF until OWNER_ENRICH_DEED_URL is set post-deploy
-- (the deed adapter no-ops until then); routing just stamps the pivot so the
-- worker reaches the deed adapter once it's wired.

-- 1. Mirror column.
ALTER TABLE public.lcc_owner_contact_signals
  ADD COLUMN IF NOT EXISTS has_deed_doc boolean NOT NULL DEFAULT false;

-- 2. Sync: select * (uniform across gov/dia; new column flows for dia, gov omits it gracefully).
CREATE OR REPLACE FUNCTION public.lcc_sync_owner_contact_signals(p_domain text DEFAULT 'both'::text)
 RETURNS TABLE(domain text, pages_fired integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    v_max_pages := 5;
    v_pages_fired := 0;
    FOR v_page IN 0..v_max_pages LOOP
      SELECT net.http_get(
        url := v_url || '/rest/v1/v_owner_contact_signals_portfolio'
          || '?select=*&order=true_owner_id.asc&limit=1000&offset=' || (v_page * 1000),
        headers := jsonb_build_object('apikey', v_anon_key, 'Authorization', 'Bearer ' || v_anon_key)
      ) INTO v_request_id;
      INSERT INTO public.lcc_owner_signal_sync_inflight (request_id, source_domain, page_offset)
      VALUES (v_request_id, v_domain, v_page * 1000);
      v_pages_fired := v_pages_fired + 1;
    END LOOP;
    domain := v_domain; pages_fired := v_pages_fired; RETURN NEXT;
  END LOOP;
END;
$function$;

-- 3. Finalize: carry has_deed_doc into the mirror (default false when absent, e.g. gov).
CREATE OR REPLACE FUNCTION public.lcc_finalize_owner_contact_signals()
 RETURNS TABLE(finalized_requests integer, rows_upserted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
      source_domain, source_true_owner_id, true_owner_name, candidates, has_reg_address, has_deed_doc, updated_at)
    SELECT source_domain, (row->>'true_owner_id')::text,
           NULLIF(row->>'true_owner_name',''),
           COALESCE(row->'candidates', '[]'::jsonb),
           COALESCE((row->>'has_reg_address')::boolean, false),
           COALESCE((row->>'has_deed_doc')::boolean, false), now()
    FROM rows WHERE row->>'true_owner_id' IS NOT NULL
    ON CONFLICT (source_domain, source_true_owner_id) DO UPDATE SET
      true_owner_name = EXCLUDED.true_owner_name,
      candidates      = EXCLUDED.candidates,
      has_reg_address = EXCLUDED.has_reg_address,
      has_deed_doc    = EXCLUDED.has_deed_doc,
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
$function$;

-- 4. v_owner_active_contact: mirror_owner carries has_deed_doc; enrichment_action
--    prefers parse_deed_signatory (authority-1) over SOS/address — but AFTER the
--    public-company-IR carve-out (a public REIT routes to known IR, not a deed).
--    Output column list is UNCHANGED (CREATE OR REPLACE safe) — only the
--    enrichment_action EXPRESSION + the internal mirror_owner CTE change.
CREATE OR REPLACE VIEW public.v_owner_active_contact AS
 WITH cand AS (
         SELECT v_owner_contact_candidates.entity_id, v_owner_contact_candidates.owner_name, v_owner_contact_candidates.workspace_id,
            v_owner_contact_candidates.source_domain, v_owner_contact_candidates.candidate_name, v_owner_contact_candidates.contact_role,
            v_owner_contact_candidates.authority_level, v_owner_contact_candidates.source, v_owner_contact_candidates.n_props,
            v_owner_contact_candidates.contact_entity_id, v_owner_contact_candidates.is_named_individual
           FROM v_owner_contact_candidates
        ), ranked AS (
         SELECT c.entity_id, c.owner_name, c.workspace_id, c.source_domain, c.candidate_name, c.contact_role, c.authority_level,
            c.source, c.n_props, c.contact_entity_id, c.is_named_individual,
            row_number() OVER (PARTITION BY c.entity_id ORDER BY c.authority_level, c.is_named_individual DESC, c.n_props DESC, (c.source = 'related_person'::text) DESC, c.candidate_name) AS rn,
            count(*) OVER (PARTITION BY c.entity_id) AS bench_size,
            count(*) FILTER (WHERE c.authority_level = 2) OVER (PARTITION BY c.entity_id) AS n_managers
           FROM cand c
        ), bench AS (
         SELECT cand.entity_id,
            jsonb_agg(jsonb_build_object('name', cand.candidate_name, 'role', cand.contact_role, 'authority', cand.authority_level, 'source', cand.source, 'is_named_individual', cand.is_named_individual, 'n_props', cand.n_props, 'contact_entity_id', cand.contact_entity_id) ORDER BY cand.authority_level, cand.is_named_individual DESC, cand.n_props DESC, cand.candidate_name) AS bench
           FROM cand GROUP BY cand.entity_id
        ), mirror_owner AS (
         SELECT DISTINCT ON (x.source_system, x.external_id) e.id AS entity_id, e.name AS owner_name, e.workspace_id,
            m.has_reg_address, m.has_deed_doc
           FROM lcc_owner_contact_signals m
             JOIN external_identities x ON x.source_type = 'true_owner'::text AND x.source_system = m.source_domain AND x.external_id = m.source_true_owner_id
             JOIN entities e ON e.id = x.entity_id AND e.merged_into_entity_id IS NULL
          WHERE NOT lcc_is_operator_owner_name(e.name)
          ORDER BY x.source_system, x.external_id, e.created_at, e.id
        ), universe AS (
         SELECT ranked.entity_id FROM ranked WHERE ranked.rn = 1
        UNION
         SELECT mirror_owner.entity_id FROM mirror_owner
        )
 SELECT u.entity_id,
    COALESCE(r.owner_name, mo.owner_name) AS owner_name,
    COALESCE(r.workspace_id, mo.workspace_id) AS workspace_id,
    r.candidate_name AS active_contact_name,
    r.contact_role AS active_contact_role,
    r.authority_level AS active_authority_level,
    r.source AS active_source,
    r.contact_entity_id AS active_contact_entity_id,
    r.is_named_individual,
    COALESCE(b.bench, '[]'::jsonb) AS bench,
    COALESCE(r.bench_size, 0::bigint) AS bench_size,
        CASE
            WHEN r.entity_id IS NULL THEN NULL::text
            WHEN r.authority_level <= 2 AND r.is_named_individual THEN 'high'::text
            WHEN r.authority_level <= 3 THEN 'medium'::text
            ELSE 'low'::text
        END AS confidence,
    COALESCE(r.n_managers, 0::bigint) >= 2 OR COALESCE(r.owner_name, mo.owner_name) ~* '\m(jv|joint venture)\M'::text OR COALESCE(r.owner_name, mo.owner_name) ~ '\m\w+ & \w+\M'::text AND NOT COALESCE(r.owner_name, mo.owner_name) ~* '\m(LLC|LP|LLP|LLLP|INC|CORP|COMPANY|CO|TRUST|HOLDINGS|GROUP|MANAGEMENT|PROPERTIES|ASSOCIATES|REALTY|PLLC|LTD|PARTNERS)\M'::text AS partnership,
        CASE
            WHEN r.entity_id IS NOT NULL THEN NULL::text
            WHEN lcc_is_public_company_name(COALESCE(r.owner_name, mo.owner_name)) THEN 'public_company_ir'::text
            WHEN mo.has_deed_doc THEN 'parse_deed_signatory'::text
            WHEN COALESCE(r.owner_name, mo.owner_name) ~* '\m(LLC|L\.?L\.?C|LP|LLP|LLLP|INC|CORP|CORPORATION|COMPANY|TRUST|HOLDINGS|PARTNERS|GROUP|MANAGEMENT|PROPERTIES|ASSOCIATES|VENTURES|REALTY|PLLC|LTD)\M'::text THEN 'sos_manager_lookup'::text
            WHEN mo.has_reg_address THEN 'address_reverse_lookup'::text
            ELSE 'manual_research'::text
        END AS enrichment_action
   FROM universe u
     LEFT JOIN ranked r ON r.entity_id = u.entity_id AND r.rn = 1
     LEFT JOIN bench b ON b.entity_id = u.entity_id
     LEFT JOIN mirror_owner mo ON mo.entity_id = u.entity_id;

-- 5. Seeder: re-route enrichment_action on UNLINKED, non-locked pivots from the
--    freshly-computed value (so the ~14 deed owners pick up parse_deed_signatory
--    once the mirror carries has_deed_doc). NEVER touches the active pick
--    (active_contact_* preserved) or locked/superseded rows.
CREATE OR REPLACE FUNCTION public.lcc_seed_owner_contact_pivots()
 RETURNS TABLE(seeded integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_seeded int;
BEGIN
  INSERT INTO public.owner_contact_pivot (
    entity_id, owner_name, workspace_id, active_contact_name, active_contact_entity_id,
    active_authority_level, active_contact_role, active_source, confidence, enrichment_action, bench)
  SELECT a.entity_id, a.owner_name, a.workspace_id, a.active_contact_name, a.active_contact_entity_id,
         a.active_authority_level, a.active_contact_role, a.active_source, a.confidence, a.enrichment_action, a.bench
  FROM public.v_owner_active_contact a
  ON CONFLICT (entity_id) DO UPDATE SET
    enrichment_action = EXCLUDED.enrichment_action,
    updated_at = now()
  WHERE owner_contact_pivot.active_contact_entity_id IS NULL
    AND owner_contact_pivot.status IN ('active','exhausted');
  GET DIAGNOSTICS v_seeded = ROW_COUNT;
  seeded := v_seeded; RETURN NEXT;
END;
$function$;
