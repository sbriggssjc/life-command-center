-- Prompt 113 / BREAK-3 — keep the INCREMENTAL mirror carrying the owner IDs.
--
-- Companion to 20260906120000_lcc_p113_domain_owner_feeder.sql, which adds
-- recorded_owner_id / true_owner_id / true_owner_effective_id /
-- true_owner_is_operator to lcc_property_owner_facts.
--
-- ⚠️ WHY THIS FILE EXISTS (the one real footgun in the round). lcc_mirror_tick is
-- the live keyset mirror and builds an explicit PostgREST `select=` list per leg.
-- lcc_apply_property_owner_facts_page writes NULL for any key ABSENT from the
-- payload. So leaving the property_owner_facts select list untouched would not
-- merely fail to refresh the new columns -- the very next incremental page would
-- NULL true_owner_effective_id / true_owner_is_operator on every row it touched,
-- silently starving the owner feeder AND disarming the operator guard that stops
-- DaVita/Fresenius being stamped as building owners.
--
-- The ONLY change from the previous definition is the v_select line for the
-- 'property_owner_facts' leg; every other line is verbatim. The function is
-- re-created in full because it has no seam to patch.

CREATE OR REPLACE FUNCTION public.lcc_mirror_tick(p_leg text DEFAULT NULL::text, p_domain text DEFAULT NULL::text, p_page_size integer DEFAULT 1000, p_refresh_minutes integer DEFAULT 60, p_response_grace_minutes integer DEFAULT 10, p_listing_lookback_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_legs text[] := CASE WHEN p_leg IS NULL THEN ARRAY['property_attributes','property_owner_facts','listing_events'] ELSE ARRAY[p_leg] END;
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
    IF v_leg NOT IN ('property_attributes','property_owner_facts','listing_events') THEN CONTINUE; END IF;
    FOREACH v_domain IN ARRAY v_doms LOOP
      IF v_domain NOT IN ('dia','gov') THEN CONTINUE; END IF;

      SELECT * INTO r FROM public.lcc_mirror_sync_watermark
        WHERE leg=v_leg AND source_domain=v_domain FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;

      v_did_full := false;
      v_wm_ts  := r.watermark_updated_at;
      v_wm_key := r.watermark_source_key;
      v_keycol := CASE WHEN v_leg='listing_events' THEN 'sale_id' ELSE 'property_id' END;
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
              v_select := 'property_id,address,city,state,zip_code,county,latitude,longitude,building_size,year_built,year_renovated,building_type,property_type,tenant,operator,annual_rent,noi,updated_at';
            ELSE
              v_select := 'property_id,address,city,state,zip_code,county,metro_area,latitude,longitude,building_size_sqft,land_acres,year_built,year_renovated,building_type,tenant_short,tenant_label,lease_commencement,lease_expiration,firm_term_remaining,term_remaining,annual_rent,noi,updated_at';
            END IF;
          ELSIF v_leg = 'property_owner_facts' THEN
            v_path := '/rest/v1/v_property_owner_facts_portfolio';
            -- Prompt 113: the owner IDs + operator flag MUST stay in this select.
            -- lcc_apply_property_owner_facts_page writes NULL for any key absent
            -- from the payload, so dropping one here silently NULLs the mirrored
            -- column on the next incremental page and starves the owner feeder.
            v_select := 'property_id,recorded_owner_name,true_owner_name,developer_name,updated_at,recorded_owner_id,true_owner_id,true_owner_effective_id,true_owner_is_operator';
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
