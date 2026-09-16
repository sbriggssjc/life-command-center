-- =====================================================================
-- C2k: SOS-attested domain truth may compete past `unresolved`
-- Filed 2026-09-16 (Cowork). Decision by Scott 2026-09-16: attested-only
-- widening. Depends on government-lease repo
-- sql/20260916_gov_c2k_true_owner_attestation.sql (gov true_owner_attested /
-- true_owner_attested_by on v_property_owner_facts_portfolio), applied and
-- committed the same day.
-- =====================================================================

-- Step 2: the mirror table + apply function + select= list carry the two
-- new attestation columns through from gov/dia into LCC Opps.

ALTER TABLE public.lcc_property_owner_facts
  ADD COLUMN IF NOT EXISTS true_owner_attested boolean,
  ADD COLUMN IF NOT EXISTS true_owner_attested_by text;

CREATE OR REPLACE FUNCTION public.lcc_apply_property_owner_facts_page(p_domain text, p_content jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_applied int := 0;
BEGIN
  WITH rows AS (SELECT jsonb_array_elements(p_content) AS row),
  up AS (
    INSERT INTO public.lcc_property_owner_facts (
      source_domain, source_property_id, recorded_owner_name, true_owner_name, developer_name,
      recorded_owner_id, true_owner_id, true_owner_effective_id, true_owner_is_operator,
      true_owner_attested, true_owner_attested_by,
      source_updated_at, updated_at)
    SELECT p_domain, (row->>'property_id')::text,
      NULLIF(row->>'recorded_owner_name',''), NULLIF(row->>'true_owner_name',''),
      NULLIF(row->>'developer_name',''),
      NULLIF(row->>'recorded_owner_id','')::uuid,
      NULLIF(row->>'true_owner_id','')::uuid,
      NULLIF(row->>'true_owner_effective_id','')::uuid,
      (row->>'true_owner_is_operator')::boolean,
      (row->>'true_owner_attested')::boolean,
      NULLIF(row->>'true_owner_attested_by',''),
      NULLIF(row->>'updated_at','')::timestamptz, now()
    FROM rows WHERE row->>'property_id' IS NOT NULL
    ON CONFLICT (source_domain, source_property_id) DO UPDATE SET
      recorded_owner_name=EXCLUDED.recorded_owner_name,
      true_owner_name=EXCLUDED.true_owner_name,
      developer_name=EXCLUDED.developer_name,
      recorded_owner_id=EXCLUDED.recorded_owner_id,
      true_owner_id=EXCLUDED.true_owner_id,
      true_owner_effective_id=EXCLUDED.true_owner_effective_id,
      true_owner_is_operator=EXCLUDED.true_owner_is_operator,
      true_owner_attested=EXCLUDED.true_owner_attested,
      true_owner_attested_by=EXCLUDED.true_owner_attested_by,
      source_updated_at=EXCLUDED.source_updated_at, updated_at=now()
    WHERE public.lcc_property_owner_facts.source_updated_at IS NULL
       OR EXCLUDED.source_updated_at IS NULL
       OR EXCLUDED.source_updated_at >= public.lcc_property_owner_facts.source_updated_at
    RETURNING 1)
  SELECT count(*) INTO v_applied FROM up;
  RETURN v_applied;
END $function$;

CREATE OR REPLACE FUNCTION public.lcc_mirror_tick(p_leg text DEFAULT NULL::text, p_domain text DEFAULT NULL::text, p_page_size integer DEFAULT 1000, p_refresh_minutes integer DEFAULT 60, p_response_grace_minutes integer DEFAULT 10, p_listing_lookback_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_legs text[] := CASE WHEN p_leg IS NULL THEN ARRAY['property_attributes','property_owner_facts','listing_events','loan_maturity'] ELSE ARRAY[p_leg] END;
  v_doms text[] := CASE WHEN p_domain IS NULL OR p_domain='both' THEN ARRAY['dia','gov'] ELSE ARRAY[p_domain] END;
  v_leg text; v_domain text; r public.lcc_mirror_sync_watermark%ROWTYPE;
  v_status int; v_content text; v_found boolean;
  v_arr jsonb; v_len int; v_applied int; v_last jsonb;
  v_did_full boolean; v_new_cycle boolean; v_should_fire boolean; v_window boolean;
  v_url text; v_anon text; v_path text; v_select text; v_keycol text; v_extra text;
  v_ts_enc text; v_keyset text; v_order text; v_url_full text; v_req bigint;
  v_wm_ts timestamptz; v_wm_key text;
  v_fired int := 0; v_consumed int := 0; v_applied_total int := 0; v_errors int := 0;
BEGIN
  FOREACH v_leg IN ARRAY v_legs LOOP
    IF v_leg NOT IN ('property_attributes','property_owner_facts','listing_events','loan_maturity') THEN CONTINUE; END IF;
    FOREACH v_domain IN ARRAY v_doms LOOP
      IF v_domain NOT IN ('dia','gov') THEN CONTINUE; END IF;

      SELECT * INTO r FROM public.lcc_mirror_sync_watermark
        WHERE leg=v_leg AND source_domain=v_domain FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;

      v_did_full := false;
      v_wm_ts  := r.watermark_updated_at;
      v_wm_key := r.watermark_source_key;
      v_keycol := CASE WHEN v_leg='listing_events' THEN 'sale_id' WHEN v_leg='loan_maturity' THEN 'loan_ref' ELSE 'property_id' END;
      v_window := (v_leg = 'listing_events');

      IF r.pending_request_id IS NOT NULL THEN
        SELECT status_code, content INTO v_status, v_content FROM net._http_response WHERE id = r.pending_request_id;
        v_found := FOUND;
        IF v_found THEN
          IF v_status IS NOT DISTINCT FROM 200 THEN
            v_arr := COALESCE(v_content,'[]')::jsonb;
            v_len := jsonb_array_length(v_arr);
            IF v_len > 0 THEN
              v_applied := CASE v_leg
                WHEN 'property_attributes' THEN public.lcc_apply_property_attributes_page(v_domain, v_arr)
                WHEN 'property_owner_facts' THEN public.lcc_apply_property_owner_facts_page(v_domain, v_arr)
                WHEN 'loan_maturity' THEN public.lcc_apply_loan_maturity_page(v_domain, v_arr)
                ELSE public.lcc_apply_listing_events_page(v_domain, v_arr) END;
              v_last := v_arr -> (v_len - 1);
              IF v_window THEN
                v_wm_key := v_last->>'sale_id';
              ELSE
                v_wm_ts  := (v_last->>'updated_at')::timestamptz;
                v_wm_key := v_last->>v_keycol;
              END IF;
              r.last_run_pages := r.last_run_pages + 1;
              r.last_run_rows  := r.last_run_rows + v_len;
              r.rows_synced_lifetime := r.rows_synced_lifetime + v_applied;
              v_applied_total := v_applied_total + v_applied;
              IF v_len >= p_page_size THEN
                v_did_full := true; r.last_run_status := 'walking';
              ELSE
                r.last_run_finished_at := now(); r.last_run_status := 'ok';
                IF v_window THEN v_wm_key := NULL; END IF;
              END IF;
            ELSE
              r.last_run_finished_at := now();
              IF (NOT v_window) AND v_wm_key IS NULL THEN
                r.last_run_status := 'suspect_empty_source';
              ELSE
                r.last_run_status := 'ok';
              END IF;
              IF v_window THEN v_wm_key := NULL; END IF;
            END IF;
            DELETE FROM net._http_response WHERE id = r.pending_request_id;
            r.pending_request_id := NULL; r.pending_fired_at := NULL;
            v_consumed := v_consumed + 1;
          ELSE
            r.last_run_status := 'http_error'; r.last_error := 'http '||COALESCE(v_status::text,'null');
            DELETE FROM net._http_response WHERE id = r.pending_request_id;
            r.pending_request_id := NULL; r.pending_fired_at := NULL;
            v_errors := v_errors + 1;
          END IF;
        ELSE
          IF r.pending_fired_at IS NOT NULL AND now() - r.pending_fired_at > (p_response_grace_minutes||' minutes')::interval THEN
            r.pending_request_id := NULL; r.pending_fired_at := NULL; r.last_run_status := 'partial_no_response';
          ELSE
            UPDATE public.lcc_mirror_sync_watermark SET updated_at=now()
              WHERE leg=v_leg AND source_domain=v_domain;
            CONTINUE;
          END IF;
        END IF;
      END IF;

      v_should_fire := r.pending_request_id IS NULL AND (
           v_did_full
        OR r.last_run_finished_at IS NULL
        OR (now() - r.last_run_finished_at) > (p_refresh_minutes||' minutes')::interval
        OR r.last_run_status = 'http_error');

      IF v_should_fire THEN
        SELECT decrypted_secret INTO v_url  FROM vault.decrypted_secrets WHERE name = v_domain||'_supabase_url';
        SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = v_domain||'_supabase_anon_key';
        IF v_url IS NULL OR v_anon IS NULL THEN
          r.last_run_status := 'no_secret';
        ELSE
          v_new_cycle := (NOT v_did_full) AND (r.last_run_status IS DISTINCT FROM 'http_error');
          IF v_new_cycle THEN
            r.last_run_started_at := now(); r.last_run_pages := 0; r.last_run_rows := 0;
            r.last_error := NULL; r.last_run_status := 'walking';
          END IF;

          v_extra := '';
          IF v_leg = 'property_attributes' THEN
            v_path := '/rest/v1/v_property_attributes_portfolio';
            IF v_domain='dia' THEN
              v_select := 'property_id,address,city,state,zip_code,county,latitude,longitude,building_size,year_built,year_renovated,building_type,property_type,tenant,operator,annual_rent,noi,updated_at,lease_commencement,lease_expiration,firm_term_remaining,term_remaining,lease_source,initial_term_years';
            ELSE
              v_select := 'property_id,address,city,state,zip_code,county,metro_area,latitude,longitude,building_size_sqft,land_acres,year_built,year_renovated,building_type,tenant_short,tenant_label,lease_commencement,lease_expiration,firm_term_remaining,term_remaining,annual_rent,noi,updated_at';
            END IF;
          ELSIF v_leg = 'loan_maturity' THEN
            v_path := '/rest/v1/v_loan_maturity_portfolio';
            v_select := 'loan_ref,property_id,maturity_date,original_amount,current_balance,lender_name,loan_type,is_cmbs,loan_status,data_source,updated_at';
          ELSIF v_leg = 'property_owner_facts' THEN
            v_path := '/rest/v1/v_property_owner_facts_portfolio';
            -- Prompt 113: the owner IDs + operator flag MUST stay in this select.
            -- C2k: true_owner_attested / true_owner_attested_by MUST stay too --
            -- lcc_apply_property_owner_facts_page writes NULL for any key absent
            -- from the payload, so dropping one here silently NULLs the mirrored
            -- column on the next incremental page and starves the C2k feeder gate.
            v_select := 'property_id,recorded_owner_name,true_owner_name,developer_name,updated_at,recorded_owner_id,true_owner_id,true_owner_effective_id,true_owner_is_operator,true_owner_attested,true_owner_attested_by';
          ELSE
            IF v_domain='dia' THEN
              v_path := '/rest/v1/v_sales_feed_portfolio';
              v_select := 'sale_id,property_id,sale_date,sold_price,buyer_name,seller_name,updated_at';
              v_extra := '&transaction_state=eq.live';
            ELSE
              v_path := '/rest/v1/v_sales_transactions_portfolio';
              v_select := 'sale_id,property_id,sale_date,sale_price,buyer_name,seller_name,cap_rate,data_source,updated_at';
            END IF;
            v_extra := v_extra || '&sale_date=gte.'||to_char(CURRENT_DATE - p_listing_lookback_days, 'YYYY-MM-DD');
          END IF;

          IF v_window THEN
            IF v_wm_key IS NULL THEN v_keyset := NULL; ELSE v_keyset := 'sale_id=gt.'||v_wm_key; END IF;
            v_order := 'sale_id.asc';
          ELSE
            v_ts_enc := replace(to_char(v_wm_ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'Z', ':','%3A');
            IF v_wm_key IS NULL THEN
              v_keyset := 'updated_at=gt.'||v_ts_enc;
            ELSE
              v_keyset := 'or=(updated_at.gt.'||v_ts_enc||',and(updated_at.eq.'||v_ts_enc||','||v_keycol||'.gt.'||v_wm_key||'))';
            END IF;
            v_order := 'updated_at.asc,'||v_keycol||'.asc';
          END IF;

          v_url_full := v_url||v_path||'?select='||v_select||v_extra
                     || COALESCE('&'||v_keyset,'')
                     || '&order='||v_order||'&limit='||p_page_size;

          SELECT net.http_get(v_url_full, '{}'::jsonb,
            jsonb_build_object('apikey',v_anon,'Authorization','Bearer '||v_anon), 15000) INTO v_req;
          r.pending_request_id := v_req; r.pending_fired_at := now();
          v_fired := v_fired + 1;
        END IF;
      END IF;

      UPDATE public.lcc_mirror_sync_watermark SET
        watermark_updated_at = v_wm_ts,
        watermark_source_key = v_wm_key,
        pending_request_id   = r.pending_request_id,
        pending_fired_at     = r.pending_fired_at,
        last_run_started_at  = r.last_run_started_at,
        last_run_finished_at = r.last_run_finished_at,
        last_run_pages       = r.last_run_pages,
        last_run_rows        = r.last_run_rows,
        last_run_status      = r.last_run_status,
        last_error           = r.last_error,
        rows_synced_lifetime = r.rows_synced_lifetime,
        updated_at           = now()
      WHERE leg=v_leg AND source_domain=v_domain;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('fired',v_fired,'consumed',v_consumed,'applied',v_applied_total,'errors',v_errors);
END $function$;

-- Step 3: v_lcc_domain_owner_candidates admits a second class of row --
-- 'supersede' -- alongside the original 'fill' (unresolved) class. A
-- 'supersede' row is an asset that already carries a resolved owner at a
-- tier BELOW domain_true_owner (never manual), where the mirrored facts row
-- says the SOS/SAM registry attests the true_owner. candidate_kind is
-- appended at the END of the SELECT list (CREATE OR REPLACE VIEW is
-- append-only for columns).

CREATE OR REPLACE VIEW public.v_lcc_domain_owner_candidates AS
WITH asset AS (
  SELECT DISTINCT ei.entity_id, ei.source_system AS source_domain, ei.external_id AS source_property_id
  FROM external_identities ei
  JOIN entities e ON e.id = ei.entity_id
  WHERE ei.source_system = ANY (ARRAY['dia'::text,'gov'::text])
    AND ei.source_type = 'asset'::text
    AND e.entity_type = 'asset'::entity_type
    AND (e.domain = ANY (ARRAY['dia'::text,'gov'::text]))
),
unresolved AS (
  -- fill: asset has no resolved owner at all
  SELECT a_1.entity_id, a_1.source_domain, a_1.source_property_id, 'fill'::text AS candidate_kind
  FROM asset a_1
  WHERE NOT EXISTS (SELECT 1 FROM lcc_property_owner po WHERE po.entity_id = a_1.entity_id AND po.owner_entity_id IS NOT NULL)
),
resolved_but_attested AS (
  -- C2k: supersede -- asset IS resolved, but at a tier BELOW domain_true_owner
  -- (never 'manual'), and the SOS/SAM registry attests the true_owner. Scott,
  -- 2026-09-16: attested-only widening -- a name-pattern match is never enough.
  SELECT a_1.entity_id, a_1.source_domain, a_1.source_property_id, 'supersede'::text AS candidate_kind
  FROM asset a_1
  JOIN lcc_property_owner po ON po.entity_id = a_1.entity_id
  JOIN lcc_property_owner_facts f ON f.source_domain = a_1.source_domain AND f.source_property_id = a_1.source_property_id
  WHERE po.owner_entity_id IS NOT NULL
    AND po.source NOT ILIKE '%manual%'
    AND po.source NOT ILIKE '%domain_true_owner%'
    AND f.true_owner_attested
),
eligible AS (
  SELECT entity_id, source_domain, source_property_id, candidate_kind FROM unresolved
  UNION ALL
  SELECT entity_id, source_domain, source_property_id, candidate_kind FROM resolved_but_attested
),
joined AS (
  SELECT u.entity_id, u.source_domain, u.source_property_id, u.candidate_kind,
    f.true_owner_effective_id, f.true_owner_name,
    COALESCE(f.true_owner_is_operator, false) AS true_owner_is_operator,
    f.source_updated_at,
    (SELECT oi.entity_id FROM external_identities oi
       WHERE oi.source_system = u.source_domain AND oi.source_type = 'true_owner'::text
         AND oi.external_id = f.true_owner_effective_id::text
       ORDER BY oi.entity_id LIMIT 1) AS candidate_owner_entity
  FROM eligible u
  JOIN lcc_property_owner_facts f ON f.source_domain = u.source_domain AND f.source_property_id = u.source_property_id
  WHERE f.true_owner_effective_id IS NOT NULL
),
classified AS (
  SELECT j.entity_id, j.source_domain, j.source_property_id, j.candidate_kind,
    j.true_owner_effective_id, j.true_owner_name, j.true_owner_is_operator, j.source_updated_at,
    j.candidate_owner_entity,
    CASE
      WHEN j.true_owner_is_operator THEN 'operator_blocked'::text
      WHEN NOT lcc_owner_name_promotable(j.true_owner_name) THEN 'name_blocked'::text
      WHEN j.candidate_owner_entity IS NULL THEN 'no_owner_entity'::text
      WHEN j.candidate_owner_entity = j.entity_id THEN 'self_reference'::text
      WHEN EXISTS (SELECT 1 FROM lcc_owner_operator_block b WHERE b.owner_entity_id = j.candidate_owner_entity) THEN 'operator_blocked'::text
      WHEN j.candidate_kind = 'supersede' THEN
        (SELECT CASE WHEN po2.owner_entity_id = j.candidate_owner_entity THEN 'no_change'::text ELSE 'eligible'::text END
           FROM lcc_property_owner po2 WHERE po2.entity_id = j.entity_id)
      ELSE 'eligible'::text
    END AS base_status
  FROM joined j
),
amb AS (
  SELECT classified.entity_id, count(DISTINCT classified.candidate_owner_entity) AS n_candidates
  FROM classified
  WHERE classified.base_status = 'eligible'::text
  GROUP BY classified.entity_id
)
SELECT c.entity_id, c.source_domain, c.source_property_id,
  c.true_owner_effective_id, c.true_owner_name, c.true_owner_is_operator,
  c.candidate_owner_entity, c.source_updated_at,
  CASE WHEN c.base_status = 'eligible'::text AND COALESCE(a.n_candidates, 1::bigint) > 1 THEN 'ambiguous'::text
       ELSE c.base_status END AS status,
  c.candidate_kind
FROM classified c
LEFT JOIN amb a ON a.entity_id = c.entity_id;

-- Step 4: candidate_kind + a prior-state ledger, so a supersession is
-- reversible without ever hand-writing lcc_property_owner.

ALTER TABLE public.lcc_domain_owner_evidence_log
  ADD COLUMN IF NOT EXISTS candidate_kind text,
  ADD COLUMN IF NOT EXISTS prior_owner_entity_id uuid,
  ADD COLUMN IF NOT EXISTS prior_source text,
  ADD COLUMN IF NOT EXISTS prior_confidence numeric;

CREATE OR REPLACE FUNCTION public.lcc_ingest_domain_owner_evidence(p_dry_run boolean DEFAULT true, p_limit integer DEFAULT NULL::integer, p_batch_tag text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag        text := COALESCE(p_batch_tag, 'p113_dom_owner_' || to_char(now(),'YYYYMMDD'));
  v_weight     numeric := 5.0;
  v_counts     jsonb;
  v_eligible   int := 0;
  v_written    int := 0;
  v_resolved   int := 0;
  v_amb_logged int := 0;
  v_superseded int := 0;
  r            record;
  v_res        jsonb;
  v_prior_owner uuid;
  v_prior_source text;
  v_prior_confidence numeric;
BEGIN
  SELECT jsonb_object_agg(status, n) INTO v_counts
    FROM (SELECT status, count(DISTINCT entity_id) AS n
            FROM public.v_lcc_domain_owner_candidates GROUP BY status) s;

  SELECT count(DISTINCT entity_id) INTO v_eligible
    FROM public.v_lcc_domain_owner_candidates WHERE status = 'eligible';

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true, 'dry_run', true, 'batch_tag', v_tag,
      'by_status', COALESCE(v_counts,'{}'::jsonb),
      'eligible_assets', v_eligible,
      'eligible_by_kind', COALESCE((
        SELECT jsonb_object_agg(candidate_kind, n) FROM (
          SELECT candidate_kind, count(DISTINCT entity_id) AS n
            FROM public.v_lcc_domain_owner_candidates WHERE status='eligible' GROUP BY candidate_kind) k),
        '{}'::jsonb),
      'sample', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT source_domain, source_property_id, true_owner_name, candidate_owner_entity, candidate_kind
            FROM public.v_lcc_domain_owner_candidates
           WHERE status='eligible' ORDER BY candidate_kind, source_domain, source_property_id LIMIT 20) x),
        '[]'::jsonb));
  END IF;

  WITH amb AS (
    SELECT entity_id,
           jsonb_agg(jsonb_build_object('domain', source_domain, 'property_id', source_property_id,
                                        'owner_name', true_owner_name,
                                        'candidate', candidate_owner_entity)
                     ORDER BY source_domain, source_property_id) AS candidates
      FROM public.v_lcc_domain_owner_candidates
     WHERE status = 'ambiguous' GROUP BY entity_id
  ), ins AS (
    INSERT INTO public.lcc_domain_owner_ambiguous (entity_id, candidates)
    SELECT entity_id, candidates FROM amb
    ON CONFLICT (entity_id) DO UPDATE SET candidates = EXCLUDED.candidates, updated_at = now()
    RETURNING 1
  ) SELECT count(*) INTO v_amb_logged FROM ins;

  FOR r IN
    SELECT DISTINCT ON (entity_id)
           entity_id, source_domain, source_property_id,
           true_owner_effective_id, candidate_owner_entity, source_updated_at, candidate_kind
      FROM public.v_lcc_domain_owner_candidates
     WHERE status = 'eligible'
     ORDER BY entity_id, source_updated_at DESC NULLS LAST, source_property_id
     LIMIT COALESCE(p_limit, 2147483647)
  LOOP
    v_prior_owner := NULL; v_prior_source := NULL; v_prior_confidence := NULL;
    IF r.candidate_kind = 'supersede' THEN
      SELECT owner_entity_id, source, confidence INTO v_prior_owner, v_prior_source, v_prior_confidence
        FROM public.lcc_property_owner WHERE entity_id = r.entity_id;
    END IF;

    PERFORM public.lcc_record_property_owner_evidence(
      r.entity_id, r.candidate_owner_entity, 'domain_true_owner', v_weight,
      COALESCE(r.source_updated_at, now()),
      jsonb_build_object('batch_tag', v_tag, 'domain', r.source_domain,
                         'property_id', r.source_property_id,
                         'true_owner_id', r.true_owner_effective_id,
                         'candidate_kind', r.candidate_kind));
    v_written := v_written + 1;

    v_res := public.lcc_reconcile_property_owner(r.entity_id);

    INSERT INTO public.lcc_domain_owner_evidence_log (
      batch_tag, entity_id, source_domain, source_property_id, true_owner_effective_id,
      candidate_owner_entity, outcome, owner_entity_id, confidence,
      candidate_kind, prior_owner_entity_id, prior_source, prior_confidence)
    VALUES (v_tag, r.entity_id, r.source_domain, r.source_property_id, r.true_owner_effective_id,
            r.candidate_owner_entity,
            CASE WHEN COALESCE((v_res->>'wrote')::boolean,false) THEN 'resolved' ELSE 'evidence_only' END,
            NULLIF(v_res->>'owner','')::uuid, NULLIF(v_res->>'confidence','')::numeric,
            r.candidate_kind, v_prior_owner, v_prior_source, v_prior_confidence);

    IF COALESCE((v_res->>'wrote')::boolean,false) THEN
      v_resolved := v_resolved + 1;
      IF r.candidate_kind = 'supersede' AND (v_res->>'owner')::uuid IS DISTINCT FROM v_prior_owner THEN
        v_superseded := v_superseded + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'batch_tag', v_tag,
    'by_status', COALESCE(v_counts,'{}'::jsonb),
    'evidence_written', v_written, 'assets_resolved', v_resolved,
    'assets_superseded', v_superseded,
    'ambiguous_logged', v_amb_logged);
END $function$;

-- C2k: reverse a supersede batch. Retracts the domain_true_owner evidence this
-- batch wrote for each superseded entity and re-runs the SAME reconcile
-- machinery, so the restore is recomputed from the remaining evidence rather
-- than a hand-written snapshot (the doctrine every other reversal in this repo
-- follows: never hand-write lcc_property_owner). Round-trip proven live
-- 2026-09-16 on batch c2k_20260916: 218/218 reverted to prior_owner_entity_id
-- with 0 mismatches, then re-ingesting restored all 218 to their exact
-- original candidate_owner_entity with 0 mismatches.
CREATE OR REPLACE FUNCTION public.lcc_c2k_unsupersede(p_batch_tag text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_count int := 0;
  v_res jsonb;
BEGIN
  IF p_batch_tag IS NULL THEN
    RAISE EXCEPTION 'p_batch_tag is required';
  END IF;

  FOR r IN
    SELECT entity_id, candidate_owner_entity, prior_owner_entity_id
    FROM public.lcc_domain_owner_evidence_log
    WHERE batch_tag = p_batch_tag AND candidate_kind = 'supersede'
  LOOP
    DELETE FROM public.lcc_property_owner_evidence
     WHERE entity_id = r.entity_id
       AND candidate_owner_entity = r.candidate_owner_entity
       AND source = 'domain_true_owner';

    v_res := public.lcc_reconcile_property_owner(r.entity_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'batch_tag', p_batch_tag, 'unsuperseded', v_count);
END $function$;

-- Step 6: the same eligible-set widening on v_lcc_owner_supersession_candidates
-- (the broader, all-evidence-sources tiering view). Previously this view's
-- `unresolved` gate admitted ONLY entities with NO owner on file at all
-- (first-touch-wins across every evidence source), so an asset already
-- resolved at a lower tier never appeared here regardless of what new
-- evidence arrived. It now also admits an entity resolved at a tier BELOW
-- domain_true_owner (never manual) whose facts row is SOS/SAM-attested,
-- exactly mirroring the domain-candidates gate.

CREATE OR REPLACE VIEW public.v_lcc_owner_supersession_candidates AS
WITH ev AS (
  SELECT e.entity_id, e.candidate_owner_entity, e.source, e.weight, e.observed_at, e.detail, e.updated_at
  FROM lcc_property_owner_evidence e
  WHERE NOT (e.candidate_owner_entity IN (SELECT lcc_owner_operator_block.owner_entity_id FROM lcc_owner_operator_block))
),
asset_id AS (
  SELECT DISTINCT ei.entity_id, ei.source_system AS source_domain, ei.external_id AS source_property_id
  FROM external_identities ei
  WHERE ei.source_system = ANY (ARRAY['dia'::text,'gov'::text]) AND ei.source_type = 'asset'::text
),
unresolved AS (
  -- fill: no owner on file at all
  SELECT DISTINCT ev.entity_id
  FROM ev
  LEFT JOIN lcc_property_owner po ON po.entity_id = ev.entity_id
  WHERE po.entity_id IS NULL
),
resolved_but_attested AS (
  -- C2k: supersede -- resolved at a tier BELOW domain_true_owner (never
  -- manual), and the SOS/SAM registry attests the true_owner on file for
  -- this asset.
  SELECT DISTINCT ev.entity_id
  FROM ev
  JOIN lcc_property_owner po ON po.entity_id = ev.entity_id
  JOIN asset_id ai ON ai.entity_id = ev.entity_id
  JOIN lcc_property_owner_facts f ON f.source_domain = ai.source_domain AND f.source_property_id = ai.source_property_id
  WHERE po.owner_entity_id IS NOT NULL
    AND po.source NOT ILIKE '%manual%'
    AND po.source NOT ILIKE '%domain_true_owner%'
    AND f.true_owner_attested
),
eligible_entities AS (
  SELECT entity_id FROM unresolved
  UNION
  SELECT entity_id FROM resolved_but_attested
),
u0 AS (
  SELECT ev.entity_id, ev.candidate_owner_entity, ev.source, ev.weight, ev.observed_at, ev.detail, ev.updated_at
  FROM ev
  JOIN eligible_entities x ON x.entity_id = ev.entity_id
),
suppressed AS (
  SELECT DISTINCT a.entity_id, a.candidate_owner_entity
  FROM u0 a
  JOIN entity_relationships p ON p.to_entity_id = a.candidate_owner_entity AND p.relationship_type = 'associated_with'::text AND (p.metadata ->> 'role'::text) = 'parent_of'::text
  JOIN u0 b ON b.entity_id = a.entity_id AND b.candidate_owner_entity = p.from_entity_id
),
u AS (
  SELECT u0.entity_id, u0.candidate_owner_entity, u0.source, u0.weight, u0.observed_at, u0.detail, u0.updated_at
  FROM u0
  LEFT JOIN suppressed s ON s.entity_id = u0.entity_id AND s.candidate_owner_entity = u0.candidate_owner_entity
  WHERE s.entity_id IS NULL
),
tiered AS (
  SELECT u.entity_id, u.candidate_owner_entity, u.source, u.observed_at,
    CASE u.source
      WHEN 'manual'::text THEN 1
      WHEN 'domain_true_owner'::text THEN 2
      WHEN 'rel_purchase'::text THEN 3
      WHEN 'gov_ownership_transition'::text THEN 3
      WHEN 'sf_seller'::text THEN 4
      ELSE 5
    END AS tier
  FROM u
),
best_tier AS (
  SELECT tiered.entity_id, min(tiered.tier) AS tier FROM tiered GROUP BY tiered.entity_id
),
in_tier AS (
  SELECT t.entity_id, t.candidate_owner_entity, t.source, t.observed_at, t.tier
  FROM tiered t JOIN best_tier b ON b.entity_id = t.entity_id AND b.tier = t.tier
),
latest AS (
  SELECT in_tier.entity_id, max(in_tier.observed_at) AS win_date FROM in_tier GROUP BY in_tier.entity_id
),
runner AS (
  SELECT i_1.entity_id, max(i_1.observed_at) AS runner_up_date
  FROM in_tier i_1 JOIN latest l_1 ON l_1.entity_id = i_1.entity_id
  WHERE i_1.observed_at < l_1.win_date
  GROUP BY i_1.entity_id
)
SELECT i.entity_id, i.candidate_owner_entity AS owner_entity_id, oe.name AS owner_name, oe.entity_type AS owner_entity_type,
  i.tier, i.source AS tier_source, l.win_date, r.runner_up_date,
  count(*) OVER (PARTITION BY i.entity_id) AS winners_at_date,
  count(*) OVER (PARTITION BY i.entity_id) = 1 AS is_unique
FROM in_tier i
JOIN latest l ON l.entity_id = i.entity_id AND i.observed_at = l.win_date
LEFT JOIN runner r ON r.entity_id = i.entity_id
LEFT JOIN entities oe ON oe.id = i.candidate_owner_entity;

-- =====================================================================
-- SEC1-definer-default: lock down the four SECURITY DEFINER functions this
-- migration (re)creates. lcc_c2k_unsupersede is a freshly CREATEd function
-- and inherits Postgres's default PUBLIC grant plus Supabase's default
-- explicit anon/authenticated grant at CREATE time -- two independent
-- grants, so revoking only one is a documented no-op (B6d / OCR2 in
-- CLAUDE.md). The other three are being (re)created in this same file, so
-- they are locked down here too rather than left to a separate migration.
-- None of the four should ever be PostgREST-RPC reachable by anon or
-- authenticated -- they are Cowork/cron-only mutation paths (evidence
-- writes, owner reconciliation, mirror sync, batch reversal).
-- =====================================================================

REVOKE ALL ON FUNCTION public.lcc_apply_property_owner_facts_page(text, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.lcc_mirror_tick(text, text, integer, integer, integer, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.lcc_ingest_domain_owner_evidence(boolean, integer, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.lcc_c2k_unsupersede(text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.lcc_apply_property_owner_facts_page(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_mirror_tick(text, text, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_ingest_domain_owner_evidence(boolean, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_c2k_unsupersede(text) TO service_role;

-- Never trust the REVOKE statement itself as proof (both traps documented
-- in CLAUDE.md's B6d/OCR2 sections shipped, measured live, and were found
-- to be no-ops after the fact) -- ASSERT with has_function_privilege().
DO $$
DECLARE v_bad text[] := ARRAY[]::text[];
BEGIN
  IF has_function_privilege('anon', 'public.lcc_apply_property_owner_facts_page(text, jsonb)', 'execute')
     OR has_function_privilege('authenticated', 'public.lcc_apply_property_owner_facts_page(text, jsonb)', 'execute')
     OR has_function_privilege('public', 'public.lcc_apply_property_owner_facts_page(text, jsonb)', 'execute')
  THEN v_bad := v_bad || 'lcc_apply_property_owner_facts_page'; END IF;

  IF has_function_privilege('anon', 'public.lcc_mirror_tick(text, text, integer, integer, integer, integer)', 'execute')
     OR has_function_privilege('authenticated', 'public.lcc_mirror_tick(text, text, integer, integer, integer, integer)', 'execute')
     OR has_function_privilege('public', 'public.lcc_mirror_tick(text, text, integer, integer, integer, integer)', 'execute')
  THEN v_bad := v_bad || 'lcc_mirror_tick'; END IF;

  IF has_function_privilege('anon', 'public.lcc_ingest_domain_owner_evidence(boolean, integer, text)', 'execute')
     OR has_function_privilege('authenticated', 'public.lcc_ingest_domain_owner_evidence(boolean, integer, text)', 'execute')
     OR has_function_privilege('public', 'public.lcc_ingest_domain_owner_evidence(boolean, integer, text)', 'execute')
  THEN v_bad := v_bad || 'lcc_ingest_domain_owner_evidence'; END IF;

  IF has_function_privilege('anon', 'public.lcc_c2k_unsupersede(text)', 'execute')
     OR has_function_privilege('authenticated', 'public.lcc_c2k_unsupersede(text)', 'execute')
     OR has_function_privilege('public', 'public.lcc_c2k_unsupersede(text)', 'execute')
  THEN v_bad := v_bad || 'lcc_c2k_unsupersede'; END IF;

  IF array_length(v_bad,1) > 0 THEN
    RAISE EXCEPTION 'still anon/authenticated/public executable: %', v_bad;
  END IF;
END $$;
