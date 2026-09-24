-- MERGELOG-GAP (2026-09-24) — LCC asset entities that point at a dia/gov
-- property that no longer exists.
--
-- Measured 2026-09-24 (before this change): dia asset entities carry 1,358
-- distinct metadata.domain_property_id values; 47 of them (48 entities) are not
-- in dia `properties`. Only 1 of the 47 is in property_merge_log and 0 are in
-- dia_property_merge_backup. The ledger the reconcile never read is
-- dia_property_redirects: dia_merge_property writes it on EVERY merge (1,267
-- rows), and 6 of the 47 were dropped by the still-running geospatial cron
-- (dia-auto-merge-property-duplicates, jobid 16) between 2026-09-14 and 09-22.
-- So the dangling set was still growing when this was written.
--
-- This migration adds:
--   1. lcc_asset_property_link_resolution — the per-entity evidence ledger for
--      the one-shot mapping (mapped / candidate / unknowable), reversible.
--   2. lcc_unrepoint_entity_property_id — the inverse of
--      lcc_repoint_entity_property_id. It moves back ONLY entities whose
--      _round_76ee_prev_property_id names the restored id, so an entity that was
--      on the kept property all along is never pulled off it.
--   3. The daily guard: lcc_asset_link_census_fetch() pages each domain's
--      anon v_property_id_census (the R22 census view, same pg_net path) and
--      lcc_check_dangling_asset_links() counts asset entities whose property id
--      is absent, logs the count, and opens a lcc_health_alerts row
--      ('dangling_asset_property_links') when the count RISES.
--
-- The guard never trusts a partial census: a domain whose fired pages are not
-- all 200, or whose last page is not empty (not paged past the end), or whose
-- live id set is under 1,000, is logged complete=false and never alerts or
-- resolves. A partial census would otherwise report every entity as dangling.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Evidence ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_asset_property_link_resolution (
  id                  bigserial PRIMARY KEY,
  batch_tag           text NOT NULL,
  domain              text NOT NULL CHECK (domain IN ('dia','gov')),
  entity_id           uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  dropped_property_id text NOT NULL,
  verdict             text NOT NULL CHECK (verdict IN ('mapped','candidate','unknowable')),
  kept_property_id    text,
  evidence            jsonb NOT NULL DEFAULT '{}'::jsonb,
  research_task_id    uuid,
  applied_at          timestamptz,
  reversed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (verdict <> 'mapped' OR kept_property_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lcc_asset_property_link_resolution
  ON public.lcc_asset_property_link_resolution (batch_tag, entity_id, dropped_property_id);

COMMENT ON TABLE public.lcc_asset_property_link_resolution IS
  'MERGELOG-GAP: per-entity verdict for asset entities whose domain_property_id '
  'names a property that no longer exists. mapped = repointed on evidence '
  '(redirect ledger, own live dia/asset identity + address, or address + parcel); '
  'candidate = routed to research (asset_property_link_review); unknowable = '
  'flagged metadata.domain_property_missing, link left as-is. Reverse a mapped '
  'row with lcc_unrepoint_entity_property_id(domain, dropped, kept).';

REVOKE ALL ON public.lcc_asset_property_link_resolution FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The inverse repoint (unmerge follow-through)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_unrepoint_entity_property_id(
  p_domain text, p_restore_id text, p_from_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_rows integer := 0;
  v_num numeric;
  v_short text;
  v_long text;
BEGIN
  v_short := CASE lower(p_domain) WHEN 'dialysis' THEN 'dia' WHEN 'dia' THEN 'dia'
                                  WHEN 'government' THEN 'gov' WHEN 'gov' THEN 'gov' END;
  IF v_short IS NULL THEN
    RAISE EXCEPTION 'p_domain must be dia/dialysis or gov/government, got %', p_domain;
  END IF;
  v_long := CASE v_short WHEN 'dia' THEN 'dialysis' ELSE 'government' END;
  IF p_restore_id IS NULL OR p_from_id IS NULL OR p_restore_id = p_from_id THEN
    RETURN 0;
  END IF;
  BEGIN v_num := p_restore_id::numeric; EXCEPTION WHEN others THEN v_num := NULL; END;

  UPDATE public.entities e
  SET metadata = COALESCE(e.metadata, '{}'::jsonb)
      || jsonb_build_object('domain_property_id', p_restore_id)
      || CASE
           WHEN v_num IS NOT NULL
                AND e.metadata ? '_pipeline_summary'
                AND (e.metadata->'_pipeline_summary') ? 'domain_property_id'
           THEN jsonb_build_object('_pipeline_summary',
                  (e.metadata->'_pipeline_summary') || jsonb_build_object('domain_property_id', v_num))
           ELSE '{}'::jsonb
         END
      || jsonb_build_object('_unrepointed_at', to_jsonb(now()),
                            '_unrepointed_from_property_id', to_jsonb(p_from_id)),
      updated_at = now()
  WHERE e.entity_type = 'asset'
    AND e.domain IN (v_short, v_long)
    -- Only entities the forward repoint moved off p_restore_id.
    AND e.metadata->>'_round_76ee_prev_property_id' = p_restore_id
    AND (e.metadata->>'domain_property_id' = p_from_id
         OR e.metadata->'_pipeline_summary'->>'domain_property_id' = p_from_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$;

REVOKE ALL ON FUNCTION public.lcc_unrepoint_entity_property_id(text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_unrepoint_entity_property_id(text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The guard
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_asset_link_census_inflight (
  request_id    bigint PRIMARY KEY,
  run_id        uuid   NOT NULL,
  source_domain text   NOT NULL CHECK (source_domain IN ('dia','gov')),
  page_offset   int    NOT NULL,
  page_size     int    NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lcc_asset_link_census_log (
  id              bigserial PRIMARY KEY,
  run_id          uuid NOT NULL,
  checked_at      timestamptz NOT NULL DEFAULT now(),
  domain          text NOT NULL CHECK (domain IN ('dia','gov')),
  complete        boolean NOT NULL,
  incomplete_reason text,
  live_ids        integer,
  archived_ids    integer,
  asset_links     integer,   -- asset entities carrying a numeric domain_property_id
  dangling        integer,   -- ... whose id is absent from the domain census
  dangling_archived integer, -- ... whose id is present but archived (gov soft state)
  prev_dangling   integer,
  sample          jsonb
);
CREATE INDEX IF NOT EXISTS idx_lcc_asset_link_census_log_dom
  ON public.lcc_asset_link_census_log (domain, checked_at DESC);

REVOKE ALL ON public.lcc_asset_link_census_inflight FROM public, anon, authenticated;
REVOKE ALL ON public.lcc_asset_link_census_log FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lcc_asset_link_census_fetch(p_max_pages int DEFAULT 60)
 RETURNS TABLE(domain text, run_id uuid, pages_fired integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run uuid := gen_random_uuid();
  v_dom text; v_url text; v_key text; v_req bigint; v_page int; v_n int;
  v_size int := 1000;  -- PostgREST caps a response at 1000 rows
BEGIN
  DELETE FROM public.lcc_asset_link_census_inflight WHERE issued_at < now() - interval '2 days';
  FOREACH v_dom IN ARRAY ARRAY['dia','gov'] LOOP
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = v_dom || '_supabase_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = v_dom || '_supabase_anon_key';
    IF v_url IS NULL OR v_key IS NULL THEN CONTINUE; END IF;
    v_n := 0;
    FOR v_page IN 0..p_max_pages LOOP
      SELECT net.http_get(
        url := v_url || '/rest/v1/v_property_id_census?select=property_id,status&order=property_id.asc'
               || '&limit=' || v_size || '&offset=' || (v_page * v_size),
        headers := jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key),
        timeout_milliseconds := 30000) INTO v_req;
      INSERT INTO public.lcc_asset_link_census_inflight (request_id, run_id, source_domain, page_offset, page_size)
      VALUES (v_req, v_run, v_dom, v_page * v_size, v_size);
      v_n := v_n + 1;
    END LOOP;
    domain := v_dom; run_id := v_run; pages_fired := v_n; RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.lcc_asset_link_census_fetch(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_asset_link_census_fetch(int) TO service_role;

-- Pure decision: does this measurement open an alert? Split out so the rule is
-- testable on its own and the check function has one place that decides.
CREATE OR REPLACE FUNCTION public.lcc_dangling_asset_links_should_alert(
  p_complete boolean, p_dangling integer, p_prev integer)
 RETURNS boolean
 LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(p_complete, false)
     AND p_dangling IS NOT NULL
     AND p_prev IS NOT NULL
     AND p_dangling > p_prev;
$$;

CREATE OR REPLACE FUNCTION public.lcc_check_dangling_asset_links(p_run_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run uuid; v_dom text; v_short_long text[];
  v_fired int; v_ok int; v_last_empty boolean; v_live int; v_arch int;
  v_links int; v_dang int; v_dang_arch int; v_prev int; v_complete boolean; v_reason text;
  v_sample jsonb; v_out jsonb := '{}'::jsonb; v_alert bigint;
BEGIN
  v_run := coalesce(p_run_id,
    (SELECT i.run_id FROM public.lcc_asset_link_census_inflight i ORDER BY i.issued_at DESC LIMIT 1));
  IF v_run IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_census_run'); END IF;

  FOREACH v_dom IN ARRAY ARRAY['dia','gov'] LOOP
    v_short_long := CASE v_dom WHEN 'dia' THEN ARRAY['dia','dialysis'] ELSE ARRAY['gov','government'] END;

    CREATE TEMP TABLE IF NOT EXISTS _census_ids (property_id bigint, status text) ON COMMIT DROP;
    TRUNCATE _census_ids;

    SELECT count(*),
           count(*) FILTER (WHERE r.status_code = 200),
           bool_or(i.page_offset = (SELECT max(i2.page_offset) FROM public.lcc_asset_link_census_inflight i2
                                     WHERE i2.run_id = v_run AND i2.source_domain = v_dom)
                   AND r.status_code = 200 AND jsonb_array_length(r.content::jsonb) = 0)
      INTO v_fired, v_ok, v_last_empty
      FROM public.lcc_asset_link_census_inflight i
      LEFT JOIN net._http_response r ON r.id = i.request_id
     WHERE i.run_id = v_run AND i.source_domain = v_dom;

    INSERT INTO _census_ids
    SELECT (x->>'property_id')::bigint, x->>'status'
      FROM public.lcc_asset_link_census_inflight i
      JOIN net._http_response r ON r.id = i.request_id AND r.status_code = 200
      CROSS JOIN LATERAL jsonb_array_elements(r.content::jsonb) x
     WHERE i.run_id = v_run AND i.source_domain = v_dom;

    SELECT count(DISTINCT property_id), count(DISTINCT property_id) FILTER (WHERE status = 'archived')
      INTO v_live, v_arch FROM _census_ids;

    v_complete := v_fired > 0 AND v_ok = v_fired AND coalesce(v_last_empty, false) AND v_live >= 1000;
    v_reason := CASE
      WHEN v_fired = 0 THEN 'no_pages_fired'
      WHEN v_ok < v_fired THEN format('%s_of_%s_pages_not_200', v_fired - v_ok, v_fired)
      WHEN NOT coalesce(v_last_empty, false) THEN 'did_not_page_past_end'
      WHEN v_live < 1000 THEN 'live_ids_below_floor'
    END;

    WITH links AS (
      SELECT e.id, (coalesce(e.metadata->>'domain_property_id',
                             e.metadata->'_pipeline_summary'->>'domain_property_id')) AS pid
        FROM public.entities e
       WHERE e.entity_type = 'asset' AND e.merged_into_entity_id IS NULL
         AND e.domain = ANY(v_short_long)
    ), l AS (SELECT id, pid::bigint AS pid FROM links WHERE pid ~ '^\d{1,15}$')
    SELECT count(*),
           count(*) FILTER (WHERE c.property_id IS NULL),
           count(*) FILTER (WHERE c.status = 'archived'),
           (SELECT jsonb_agg(s) FROM (SELECT DISTINCT l2.pid FROM l l2
               WHERE NOT EXISTS (SELECT 1 FROM _census_ids c2 WHERE c2.property_id = l2.pid)
               ORDER BY 1 LIMIT 25) s)
      INTO v_links, v_dang, v_dang_arch, v_sample
      FROM l LEFT JOIN (SELECT DISTINCT ON (property_id) property_id, status FROM _census_ids) c
        ON c.property_id = l.pid;

    SELECT g.dangling INTO v_prev FROM public.lcc_asset_link_census_log g
     WHERE g.domain = v_dom AND g.complete ORDER BY g.checked_at DESC LIMIT 1;

    INSERT INTO public.lcc_asset_link_census_log
      (run_id, domain, complete, incomplete_reason, live_ids, archived_ids, asset_links,
       dangling, dangling_archived, prev_dangling, sample)
    VALUES (v_run, v_dom, v_complete, v_reason, v_live, v_arch, v_links,
            CASE WHEN v_complete THEN v_dang END, CASE WHEN v_complete THEN v_dang_arch END,
            v_prev, CASE WHEN v_complete THEN v_sample END);

    v_alert := NULL;
    IF public.lcc_dangling_asset_links_should_alert(v_complete, v_dang, v_prev) THEN
      SELECT alert_id INTO v_alert FROM public.lcc_health_alerts
       WHERE alert_kind = 'dangling_asset_property_links' AND source = 'lcc-dangling-asset-links:' || v_dom
         AND resolved_at IS NULL LIMIT 1;
      IF v_alert IS NULL THEN
        INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
        VALUES ('dangling_asset_property_links', 'lcc-dangling-asset-links:' || v_dom, 'warn',
                format('%s asset entities point at %s properties that no longer exist (was %s)',
                       v_dang, v_dom, v_prev),
                jsonb_build_object('domain', v_dom, 'dangling', v_dang, 'prev_dangling', v_prev,
                                   'baseline', v_prev, 'sample', v_sample, 'run_id', v_run))
        RETURNING alert_id INTO v_alert;
      ELSE
        UPDATE public.lcc_health_alerts
           SET details = details || jsonb_build_object('dangling', v_dang, 'sample', v_sample, 'run_id', v_run),
               summary = format('%s asset entities point at %s properties that no longer exist (baseline %s)',
                                v_dang, v_dom, details->>'baseline')
         WHERE alert_id = v_alert;
      END IF;
    ELSIF v_complete THEN
      -- Back at or below the baseline the alert opened against: resolve it.
      UPDATE public.lcc_health_alerts
         SET resolved_at = now(),
             resolved_note = format('dangling %s <= baseline %s', v_dang, details->>'baseline')
       WHERE alert_kind = 'dangling_asset_property_links' AND source = 'lcc-dangling-asset-links:' || v_dom
         AND resolved_at IS NULL AND v_dang <= coalesce((details->>'baseline')::int, 0);
    END IF;

    v_out := v_out || jsonb_build_object(v_dom, jsonb_build_object(
      'complete', v_complete, 'incomplete_reason', v_reason, 'live_ids', v_live,
      'asset_links', v_links, 'dangling', CASE WHEN v_complete THEN v_dang END,
      'dangling_archived', CASE WHEN v_complete THEN v_dang_arch END,
      'prev_dangling', v_prev, 'alert_id', v_alert));
  END LOOP;
  RETURN v_out || jsonb_build_object('run_id', v_run);
END;
$function$;

REVOKE ALL ON FUNCTION public.lcc_check_dangling_asset_links(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_check_dangling_asset_links(uuid) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.lcc_check_dangling_asset_links(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.lcc_check_dangling_asset_links(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.lcc_asset_link_census_fetch(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.lcc_asset_link_census_fetch(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.lcc_unrepoint_entity_property_id(text,text,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'MERGELOG-GAP: a definer/repoint function is still anon/authenticated-executable';
  END IF;
END $$;

-- Daily: fetch at 06:50 UTC, evaluate at 06:55 (pg_net responses land within
-- seconds; five minutes is margin, well inside net._http_response retention).
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('lcc-asset-link-census-fetch', 'lcc-dangling-asset-links-check');
SELECT cron.schedule('lcc-asset-link-census-fetch', '50 6 * * *',
  $c$SELECT public.lcc_asset_link_census_fetch();$c$);
SELECT cron.schedule('lcc-dangling-asset-links-check', '55 6 * * *',
  $c$SELECT public.lcc_check_dangling_asset_links();$c$);

COMMIT;
